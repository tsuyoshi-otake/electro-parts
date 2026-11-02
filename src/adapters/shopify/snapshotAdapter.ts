import type { StoreCapabilities } from '../../core/capabilities.ts';
import type { NormalizedProduct, NormalizedSnapshot, PriceQuote } from '../../core/domain.ts';
import { sha256OfCanonicalJson } from '../../core/hash.ts';
import { normalizeUtcIso } from '../../core/time.ts';
import { IssueCollector } from '../../core/validation.ts';
import type { StoreSnapshotAdapter } from '../../stores/adapter.ts';
import { shopifyCurrencyEvidence, shopifyHandleFromKey, shopifyPageKey, shopifyProductUrl, type ShopifyStore } from './identity.ts';
import { decimalMinor, parseShopifyItem, record, type ShopifyItem, type ShopifySnapshot } from './rawSchema.ts';

/**
 * `taxTreatment` is `unknown`: the catalogue does not say whether its amounts
 * include tax, and what a buyer abroad pays differs from the store's own
 * country anyway.
 */
export const SHOPIFY_CAPABILITIES: StoreCapabilities = {
  supportsExactPrice: true, supportsPriceRange: true, supportsVariants: true, supportsCompareAtPrice: true,
  supportsTaxIncluded: false, supportsTaxExcluded: false, supportsAvailability: true,
  supportsInventoryQuantity: false, inventoryQuantitySemantics: 'not_exposed',
  primaryQuote: { quoteKind: 'selling', taxTreatment: 'unknown' },
};
export function validateShopifyRaw(store: ShopifyStore, value: unknown) {
  const c = new IssueCollector();
  try {
    const s = record(value);
    if (s['schemaVersion'] !== 1 || s['currency'] !== store.currency || s['currencyEvidence'] !== shopifyCurrencyEvidence(store)) throw new Error('Unsupported schema/currency evidence');
    if (typeof s['retrievedAt'] !== 'string') throw new Error('Missing observation time');
    normalizeUtcIso(s['retrievedAt']);
    if (s['complete'] !== true || !Array.isArray(s['errors']) || s['errors'].length) throw new Error('Incomplete collection');
    if (!Number.isSafeInteger(s['pageCount']) || (s['pageCount'] as number) <= 0) throw new Error('Invalid page count');
    if (!Array.isArray(s['items']) || !s['items'].length || !Array.isArray(s['catalogHandles']) || !s['catalogHandles'].length) throw new Error('Missing catalogue');
    const handles = new Set<string>(); const ids = new Set<number>();
    for (const item of s['items']) {
      const p = parseShopifyItem(store, item);
      if (handles.has(p.handle) || ids.has(p.id)) throw new Error('Duplicate product');
      handles.add(p.handle); ids.add(p.id);
    }
    const expected = new Set<string>();
    for (const h of s['catalogHandles']) {
      if (typeof h !== 'string') throw new Error('Invalid sitemap handle');
      shopifyPageKey(store, h); expected.add(h);
      if (!handles.has(h)) throw new Error(`Uncovered sitemap product: ${h}`);
    }
    if (expected.size !== s['catalogHandles'].length) throw new Error('Duplicate sitemap product');
    c.metrics['itemCount'] = handles.size;
    c.metrics['catalogUncovered'] = 0;
  } catch (e) { c.error(`${store.storeId}.raw`, (e as Error).message); }
  return c.result();
}
export function normalizeShopifyItem(store: ShopifyStore, p: ShopifyItem): NormalizedProduct {
  const key = shopifyPageKey(store, p.handle);
  return {
    externalProductId: key, pageKey: key,
    aliases: [{kind:'handle',value:p.handle},{kind:'shopifyProductId',value:String(p.id)},
      ...[...new Set(p.variants.map(v=>v.sku).filter((s): s is string=>s!==null))].map(value=>({kind:'sku',value}))],
    metadata: {name:p.title, modelNumber:p.variants.length === 1 ? p.variants[0]!.sku : null,
      category:p.product_type, canonicalUrl:shopifyProductUrl(store, p.handle)},
    offers:p.variants.map(v=>{
      const quote = (raw: string, quoteKind: 'selling'|'compare_at'): PriceQuote => ({quoteKind,taxTreatment:'unknown',currency:store.currency,
        state:'exact',minAmountMinor:decimalMinor(raw, store.currency),maxAmountMinor:decimalMinor(raw, store.currency),unitLabel:null});
      return {externalOfferId:String(v.id),offerKind:'variant',sku:v.sku,
        variantName:v.title==='Default Title'?null:v.title,
        priceQuotes:[quote(v.price,'selling'),...(v.compare_at_price===null?[]:[quote(v.compare_at_price,'compare_at')])],
        availability:{state:v.available?'in_stock':'out_of_stock',purchasable:v.available,
          quantity:null,quantitySemantics:'not_exposed',rawStatus:null}};
    }),
  };
}
export function shopifySnapshotAdapter(store: ShopifyStore): StoreSnapshotAdapter {
  return {
    storeId:store.storeId,capabilities:SHOPIFY_CAPABILITIES,validateRaw:value=>validateShopifyRaw(store,value),
    normalize(value,rawSha256): NormalizedSnapshot {
      const validation = validateShopifyRaw(store, value);
      if (validation.errors.length) throw new Error(validation.errors.map(e=>e.message).join('; '));
      const s=value as ShopifySnapshot;
      const body={storeId:store.storeId,observedAt:normalizeUtcIso(s.retrievedAt),sourceSchemaVersion:'1',complete:true,
        coverageId:'shopify:products',products:s.items.map(p=>normalizeShopifyItem(store,parseShopifyItem(store,p))).sort((a,b)=>a.pageKey.localeCompare(b.pageKey,'en'))};
      return {...body,rawSha256,normalizedHash:sha256OfCanonicalJson(body)};
    },
    isValidPageKey:key=>shopifyHandleFromKey(store,key)!==null,
    productUrlForPageKey(key) { const handle=shopifyHandleFromKey(store,key);return handle===null?null:shopifyProductUrl(store,handle); },
  };
}
