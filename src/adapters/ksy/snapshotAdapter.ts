import type { StoreCapabilities } from '../../core/capabilities.ts';
import { DEFAULT_OFFER_ID, type Availability, type NormalizedProduct, type NormalizedSnapshot, type PriceQuote } from '../../core/domain.ts';
import { sha256OfCanonicalJson } from '../../core/hash.ts';
import { normalizeUtcIso } from '../../core/time.ts';
import { IssueCollector, type ValidationResult } from '../../core/validation.ts';
import type { StoreSnapshotAdapter } from '../../stores/adapter.ts';
import { KSY_STORE_ID, isKsyProductId, ksyProductUrl } from './identity.ts';
import { KSY_MAX_PAGE_SIZE, KSY_MIN_PAGE_SIZE, KSY_UNPRICED, parseKsyItem, record, type KsyItem, type KsySnapshot } from './rawSchema.ts';

export const KSY_CAPABILITIES: StoreCapabilities = {
  supportsExactPrice: true, supportsPriceRange: false, supportsVariants: false, supportsCompareAtPrice: false,
  supportsTaxIncluded: true, supportsTaxExcluded: false, supportsAvailability: true,
  supportsInventoryQuantity: true, inventoryQuantitySemantics: 'site_reported',
  primaryQuote: { quoteKind: 'selling', taxTreatment: 'tax_included' },
};

/** The shop's product status for a current product; other statuses are shown next to the stock state. */
const CURRENT_STATUS = '現行品';

export function validateKsyRaw(value: unknown): ValidationResult {
  const c = new IssueCollector();
  try {
    const s = record(value, 'snapshot');
    if (s['schemaVersion'] !== 1) throw new Error(`unsupported schemaVersion ${JSON.stringify(s['schemaVersion'])}`);
    if (typeof s['retrievedAt'] !== 'string') throw new Error('retrievedAt missing');
    normalizeUtcIso(s['retrievedAt']);
    if (s['complete'] !== true || !Array.isArray(s['errors']) || s['errors'].length) throw new Error('snapshot is not a complete collection');
    const pageSize = s['pageSize'];
    if (!Number.isSafeInteger(pageSize) || (pageSize as number) < KSY_MIN_PAGE_SIZE || (pageSize as number) > KSY_MAX_PAGE_SIZE) throw new Error('invalid page size');
    const total = s['listedTotal'];
    if (!Number.isSafeInteger(total) || (total as number) <= 0) throw new Error('listedTotal missing or not positive');
    if (s['pageCount'] !== Math.ceil((total as number) / (pageSize as number))) throw new Error('pageCount does not cover listedTotal');
    if (!Array.isArray(s['items'])) throw new Error('items missing');
    if (s['items'].length !== total) throw new Error(`${s['items'].length} items for a listed total of ${String(total)}`);
    const ids = new Set<number>();
    let unpriced = 0;
    let noPrice = 0;
    let inStock = 0;
    for (const value of s['items']) {
      const item = parseKsyItem(value);
      if (ids.has(item.id)) throw new Error(`product ${item.id} appears twice`);
      ids.add(item.id);
      if (item.price === KSY_UNPRICED) unpriced += 1;
      if (item.price === 0) noPrice += 1;
      if (item.stock > 0) inStock += 1;
    }
    c.metrics['itemCount'] = ids.size;
    c.metrics['unpricedCount'] = unpriced;
    c.metrics['zeroPriceCount'] = noPrice;
    c.metrics['inStockCount'] = inStock;
  } catch (e) {
    c.error('ksy.raw', (e as Error).message);
  }
  return c.result();
}

function normalizeAvailability(item: KsyItem): Availability {
  const status = item.status.name.trim();
  const state = status === '終了品' ? 'discontinued'
    : item.stock > 0 ? 'in_stock'
    : status === '販売予定品' ? 'preparing'
    : 'out_of_stock';
  return {
    state,
    // The storefront enables the cart exactly when the stock is not zero.
    purchasable: item.stock > 0,
    quantity: item.stock,
    quantitySemantics: 'site_reported',
    rawStatus: status === CURRENT_STATUS ? null : status,
  };
}

function normalizePrice(item: KsyItem): PriceQuote {
  // 価格未定 and the 0 of series index entries are not prices.
  const amount = item.price === KSY_UNPRICED || item.price === 0 ? null : item.price;
  return {
    quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY',
    state: amount === null ? 'unavailable' : 'exact',
    minAmountMinor: amount, maxAmountMinor: amount, unitLabel: null,
  };
}

export function normalizeKsyItem(item: KsyItem): NormalizedProduct {
  const key = String(item.id);
  const model = String(item.model).trim();
  return {
    externalProductId: key,
    pageKey: key,
    aliases: [{ kind: 'productId', value: key }],
    metadata: { name: item.name.trim(), modelNumber: model || null, category: null, canonicalUrl: ksyProductUrl(key) },
    offers: [{
      externalOfferId: DEFAULT_OFFER_ID, offerKind: 'default', sku: null, variantName: null,
      priceQuotes: [normalizePrice(item)], availability: normalizeAvailability(item),
    }],
  };
}

export const ksySnapshotAdapter: StoreSnapshotAdapter = {
  storeId: KSY_STORE_ID,
  capabilities: KSY_CAPABILITIES,
  validateRaw: validateKsyRaw,
  normalize(value, rawSha256): NormalizedSnapshot {
    const validation = validateKsyRaw(value);
    if (validation.errors.length) throw new Error(validation.errors.map((e) => e.message).join('; '));
    const s = value as KsySnapshot;
    const body = {
      storeId: KSY_STORE_ID, observedAt: normalizeUtcIso(s.retrievedAt), sourceSchemaVersion: '1', complete: true,
      coverageId: 'list:public',
      products: s.items.map((item) => normalizeKsyItem(parseKsyItem(item))).sort((a, b) => Number(a.pageKey) - Number(b.pageKey)),
    };
    return { ...body, rawSha256, normalizedHash: sha256OfCanonicalJson(body) };
  },
  isValidPageKey: isKsyProductId,
  productUrlForPageKey: (key) => (isKsyProductId(key) ? ksyProductUrl(key) : null),
};
