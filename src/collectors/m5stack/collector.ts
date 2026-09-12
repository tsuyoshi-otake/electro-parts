import { M5STACK_ORIGIN, m5stackPageKey } from '../../adapters/m5stack/identity.ts';
import { parseM5StackPage, type M5StackSnapshot } from '../../adapters/m5stack/rawSchema.ts';
import type { StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher } from '../politeFetcher.ts';
import { decodeSitemapBody, parseSitemapIndex, parseSitemapLocs } from '../sitemapXml.ts';

function configNumber(c: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const n = c[key] ?? fallback;
  if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) throw new Error(`Invalid collector.${key}`);
  return n as number;
}
export function m5stackCollectorConfig(c: Record<string, unknown>) {
  if (typeof c['userAgent'] !== 'string' || c['userAgent'].trim().length < 8) throw new Error('collector.userAgent must identify the project');
  return {userAgent:c['userAgent'],
    pageLimit:configNumber(c,'pageLimit',250,1,250),maxPages:configNumber(c,'maxPages',40,1,200),
    maxSubSitemaps:configNumber(c,'maxSubSitemaps',16,1,64),
    minIntervalMs:configNumber(c,'minIntervalMs',1500,500,60000),jitterMs:configNumber(c,'jitterMs',750,0,60000),
    maxAttempts:configNumber(c,'maxAttempts',4,1,8),timeoutMs:configNumber(c,'timeoutMs',30000,1000,60000),
    maxRequests:configNumber(c,'maxRequests',100,1,1000)};
}
export const m5stackCollector: StoreCollector = {
  storeId:'m5stack',
  validateConfig(c) {m5stackCollectorConfig(c);},
  async collect(config,deps) {
    const c=m5stackCollectorConfig(config);
    const fetcher=new PoliteFetcher({...c,log:deps.log,
      ...(deps.transport===undefined?{}:{transport:deps.transport}),
      ...(deps.sleep===undefined?{}:{sleep:deps.sleep}),
      ...(deps.random===undefined?{}:{random:deps.random}),
      ...(deps.now===undefined?{}:{now:()=>deps.now!().getTime()})});
    const s:M5StackSnapshot={schemaVersion:1,currency:'USD',currencyEvidence:'',retrievedAt:'',complete:false,
      catalogHandles:[],pageCount:0,items:[],errors:[]};
    let exhausted=false;
    try {
      // products.json has no currency field. Pin the public base currency on every run,
      // without session cookies/localization, before interpreting decimal amounts.
      const home=await fetcher.fetchText(`${M5STACK_ORIGIN}/`);
      const currency=JSON.parse(/Shopify\.currency\s*=\s*(\{[^;]+\})\s*;/.exec(home)?.[1] ?? 'null') as {active?:string;rate?:string}|null;
      if(currency?.active!=='USD'||String(currency.rate)!=='1.0') throw new Error('Store currency is not unconverted USD');
      s.currencyEvidence='Shopify.currency:USD:1.0';
      const index=parseSitemapIndex(await fetcher.fetchText(`${M5STACK_ORIGIN}/sitemap.xml`));
      const sources=index.filter(e=>/^\/sitemap_products_\d+\.xml$/.test(new URL(e.url).pathname));
      if(!sources.length||sources.length>c.maxSubSitemaps) throw new Error('Missing or excessive product sitemaps');
      const expected=new Set<string>();
      for(const source of sources) {
        if(new URL(source.url).origin!==M5STACK_ORIGIN) throw new Error('Foreign sitemap origin');
        const xml=decodeSitemapBody(await fetcher.fetchBytes(source.url),source.url);
        let productCount=0;
        for(const loc of parseSitemapLocs(xml)) {
          const u=new URL(loc);
          if(u.origin!==M5STACK_ORIGIN) throw new Error('Foreign product origin');
          if(u.pathname==='/') continue; // Shopify includes its home page.
          const match=/^\/products\/([^/]+)\/?$/.exec(u.pathname);
          if(!match||u.search||u.hash) throw new Error(`Invalid product sitemap URL: ${loc}`);
          const handle=decodeURIComponent(match[1]!);m5stackPageKey(handle);
          expected.add(handle);productCount++;
        }
        if(!productCount) throw new Error('Empty product sitemap');
      }
      s.catalogHandles=[...expected].sort();
      const seen=new Set<string>();const ids=new Set<number>();
      for(let page=1;page<=c.maxPages;page++) {
        const items=parseM5StackPage(JSON.parse(await fetcher.fetchText(`${M5STACK_ORIGIN}/products.json?limit=${c.pageLimit}&page=${page}`)));
        if(items.length>c.pageLimit) throw new Error(`Page ${page}: excessive products`);
        for(const p of items) {
          if(seen.has(p.handle)||ids.has(p.id)) throw new Error(`Page ${page}: repeated product ${p.handle}`);
          seen.add(p.handle);ids.add(p.id);s.items.push(p);
        }
        s.pageCount=page;
        deps.log(`[m5stack] page ${page}: ${items.length} products (${s.items.length} total)`);
        if(items.length<c.pageLimit) {exhausted=true;break;}
      }
      if(!exhausted) throw new Error('Catalogue page cap reached before completion');
      const missing=s.catalogHandles.filter(h=>!seen.has(h));
      if(missing.length) throw new Error(`${missing.length} uncovered sitemap products: ${missing.slice(0,5).join(', ')}`);
      if(!s.items.length) throw new Error('Empty catalogue');
      s.complete=true;
    } catch(e) {s.errors.push((e as Error).message);}
    s.retrievedAt=(deps.now?.()??new Date()).toISOString();
    return {raw:s,retrievedAt:s.retrievedAt,complete:s.complete,errors:s.errors,warnings:[],
      metrics:{items:s.items.length,variants:s.items.reduce((n,p)=>n+p.variants.length,0),catalogProducts:s.catalogHandles.length,
        catalogPages:s.pageCount,httpAttempts:fetcher.stats.httpAttempts,retries:fetcher.stats.retries,waitedMs:fetcher.stats.waitedMs}};
  },
};
