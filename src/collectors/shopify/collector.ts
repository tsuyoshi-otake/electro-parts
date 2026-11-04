import { shopifyCurrencyEvidence, shopifyPageKey, shopifyProductUrl, type ShopifyStore } from '../../adapters/shopify/identity.ts';
import { parseShopifyPage, record, type ShopifySnapshot } from '../../adapters/shopify/rawSchema.ts';
import type { StoreCollector } from '../../stores/collector.ts';
import { noRedirectTransport, PoliteFetcher } from '../politeFetcher.ts';
import { parseProductPagesConfig, productPageWarnings, readProductPages, type ProductPageReader } from '../productPageInventory.ts';
import { decodeSitemapBody, parseSitemapIndex, parseSitemapLocs } from '../sitemapXml.ts';

function configNumber(c: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const n = c[key] ?? fallback;
  if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) throw new Error(`Invalid collector.${key}`);
  return n as number;
}
export function shopifyCollectorConfig(c: Record<string, unknown>) {
  if (typeof c['userAgent'] !== 'string' || c['userAgent'].trim().length < 8) throw new Error('collector.userAgent must identify the project');
  return {userAgent:c['userAgent'],
    pageLimit:configNumber(c,'pageLimit',250,1,250),maxPages:configNumber(c,'maxPages',40,1,200),
    maxSubSitemaps:configNumber(c,'maxSubSitemaps',16,1,64),
    minIntervalMs:configNumber(c,'minIntervalMs',1500,500,60000),jitterMs:configNumber(c,'jitterMs',750,0,60000),
    maxAttempts:configNumber(c,'maxAttempts',4,1,8),timeoutMs:configNumber(c,'timeoutMs',30000,1000,60000),
    // The longest Retry-After this store's run waits out; a longer one stops its requests.
    maxWaitMs:configNumber(c,'maxWaitMs',120000,1000,600000),
    maxRequests:configNumber(c,'maxRequests',100,1,5000),productPages:parseProductPagesConfig(c['productPages'])};
}
/**
 * products.json has no currency field. Pin the base currency on every run,
 * without session cookies or a market path, before interpreting decimal amounts.
 */
async function proveCurrency(store: ShopifyStore, fetcher: PoliteFetcher): Promise<void> {
  if (store.currencyEvidence === 'storefront') {
    const home=await fetcher.fetchText(`${store.origin}/`);
    const currency=JSON.parse(/Shopify\.currency\s*=\s*(\{[^;]+\})\s*;/.exec(home)?.[1] ?? 'null') as {active?:string;rate?:string}|null;
    if(currency?.active!==store.currency||String(currency.rate)!=='1.0') throw new Error(`Store currency is not unconverted ${store.currency}`);
    return;
  }
  const meta=record(JSON.parse(await fetcher.fetchText(`${store.origin}/meta.json`)));
  if(meta['currency']!==store.currency) throw new Error(`Store base currency is not ${store.currency}`);
}
/**
 * `productPageReader` reads the stock counts a store's product page shows
 * (ADR-0027). With it and a `collector.productPages` section, a complete
 * catalogue is followed by one request per product in this run's slice.
 */
export function shopifyCollector(store: ShopifyStore, productPageReader?: ProductPageReader): StoreCollector {
  const tag=`[${store.storeId}]`;
  const configOf=(config: Record<string, unknown>)=>{
    const c=shopifyCollectorConfig(config);
    if(c.productPages!==null&&productPageReader===undefined) throw new Error(`collector.productPages: ${store.label} has no product page reader`);
    return c;
  };
  return {
    storeId:store.storeId,
    validateConfig(c) {configOf(c);},
    async collect(config,deps) {
      const c=configOf(config);
      const transport=deps.transport ?? (store.currencyEvidence==='meta' ? noRedirectTransport : undefined);
      const fetcher=new PoliteFetcher({...c,log:deps.log,
        ...(transport===undefined?{}:{transport}),
        ...(deps.sleep===undefined?{}:{sleep:deps.sleep}),
        ...(deps.random===undefined?{}:{random:deps.random}),
        ...(deps.now===undefined?{}:{now:()=>deps.now!().getTime()})});
      const s:ShopifySnapshot={schemaVersion:1,currency:store.currency,currencyEvidence:'',retrievedAt:'',complete:false,
        catalogHandles:[],pageCount:0,items:[],errors:[]};
      let exhausted=false;
      try {
        await proveCurrency(store, fetcher);
        s.currencyEvidence=shopifyCurrencyEvidence(store);
        const index=parseSitemapIndex(await fetcher.fetchText(`${store.origin}/sitemap.xml`));
        // Root product sitemaps only: market copies (`/en-eu/sitemap_products_1.xml`) list the same products.
        const sources=index.filter(e=>/^\/sitemap_products_\d+\.xml$/.test(new URL(e.url).pathname));
        if(!sources.length||sources.length>c.maxSubSitemaps) throw new Error('Missing or excessive product sitemaps');
        const expected=new Set<string>();
        for(const source of sources) {
          if(new URL(source.url).origin!==store.origin) throw new Error('Foreign sitemap origin');
          const xml=decodeSitemapBody(await fetcher.fetchBytes(source.url),source.url);
          let productCount=0;
          for(const loc of parseSitemapLocs(xml)) {
            const u=new URL(loc);
            if(u.origin!==store.origin) throw new Error('Foreign product origin');
            if(u.pathname==='/') continue; // Shopify includes its home page.
            const match=/^\/products\/([^/]+)\/?$/.exec(u.pathname);
            if(!match||u.search||u.hash) throw new Error(`Invalid product sitemap URL: ${loc}`);
            const handle=decodeURIComponent(match[1]!);shopifyPageKey(store,handle);
            expected.add(handle);productCount++;
          }
          if(!productCount) throw new Error('Empty product sitemap');
        }
        s.catalogHandles=[...expected].sort();
        const seen=new Set<string>();const ids=new Set<number>();
        for(let page=1;page<=c.maxPages;page++) {
          const items=parseShopifyPage(store,JSON.parse(await fetcher.fetchText(`${store.origin}/products.json?limit=${c.pageLimit}&page=${page}`)));
          if(items.length>c.pageLimit) throw new Error(`Page ${page}: excessive products`);
          for(const p of items) {
            if(seen.has(p.handle)||ids.has(p.id)) throw new Error(`Page ${page}: repeated product ${p.handle}`);
            seen.add(p.handle);ids.add(p.id);s.items.push(p);
          }
          s.pageCount=page;
          deps.log(`${tag} page ${page}: ${items.length} products (${s.items.length} total)`);
          if(items.length<c.pageLimit) {exhausted=true;break;}
        }
        if(!exhausted) throw new Error('Catalogue page cap reached before completion');
        const missing=s.catalogHandles.filter(h=>!seen.has(h));
        if(missing.length) throw new Error(`${missing.length} uncovered sitemap products: ${missing.slice(0,5).join(', ')}`);
        if(!s.items.length) throw new Error('Empty catalogue');
        s.complete=true;
      } catch(e) {s.errors.push((e as Error).message);}
      // Only a complete catalogue is worth enriching: an incomplete run is rejected anyway.
      if(s.complete&&c.productPages!==null&&productPageReader!==undefined) {
        const now=()=>(deps.now?.()??new Date()).getTime();
        s.pageInventory=await readProductPages({fetcher,reader:productPageReader,config:c.productPages,observedAtMs:now(),nowMs:now,log:deps.log,tag,
          targets:s.items.map(p=>({key:p.handle,url:shopifyProductUrl(store,p.handle),offerIds:p.variants.map(v=>String(v.id))}))});
      }
      s.retrievedAt=(deps.now?.()??new Date()).toISOString();
      return {raw:s,retrievedAt:s.retrievedAt,complete:s.complete,errors:s.errors,warnings:s.pageInventory===undefined?[]:productPageWarnings(s.pageInventory),
        metrics:{items:s.items.length,variants:s.items.reduce((n,p)=>n+p.variants.length,0),catalogProducts:s.catalogHandles.length,
          catalogPages:s.pageCount,
          ...(s.pageInventory===undefined?{}:{productPagesSelected:s.pageInventory.selected,productPagesRead:s.pageInventory.read,productPagesFailed:s.pageInventory.failures.length}),
          httpAttempts:fetcher.stats.httpAttempts,retries:fetcher.stats.retries,waitedMs:fetcher.stats.waitedMs}};
    },
  };
}
