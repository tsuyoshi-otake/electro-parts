import type { StoreCapabilities } from '../../core/capabilities.ts';
import { DEFAULT_OFFER_ID, type Availability, type NormalizedProduct, type NormalizedSnapshot, type PriceQuote } from '../../core/domain.ts';
import { sha256OfCanonicalJson } from '../../core/hash.ts';
import { normalizeUtcIso } from '../../core/time.ts';
import { IssueCollector, type ValidationResult } from '../../core/validation.ts';
import type { StoreSnapshotAdapter } from '../../stores/adapter.ts';
import { SENGOKU_STORE_ID, isSengokuCode, sengokuProductUrl } from './identity.ts';
import {
  SENGOKU_OUT_OF_STOCK_MARK, SENGOKU_PAGE_SIZE, SENGOKU_ROOT_CID, SENGOKU_SEARCH_CAP,
  parseSengokuItem, record, type SengokuItem, type SengokuPriceLine, type SengokuSnapshot,
} from './rawSchema.ts';

export const SENGOKU_CAPABILITIES: StoreCapabilities = {
  supportsExactPrice: true, supportsPriceRange: true, supportsVariants: false, supportsCompareAtPrice: false,
  supportsTaxIncluded: true, supportsTaxExcluded: false, supportsAvailability: true,
  supportsInventoryQuantity: false, inventoryQuantitySemantics: 'not_exposed',
  primaryQuote: { quoteKind: 'selling', taxTreatment: 'tax_included' },
};

function checkListings(s: Record<string, unknown>): Map<number, number> {
  if (!Array.isArray(s['listings']) || s['listings'].length === 0) throw new Error('listings missing');
  const totals = new Map<number, number>();
  for (const value of s['listings']) {
    const l = record(value, 'listing');
    const cid = l['cid'];
    if (!Number.isSafeInteger(cid) || (cid as number) < 1) throw new Error(`invalid listing cid ${JSON.stringify(cid)}`);
    if (totals.has(cid as number)) throw new Error(`listing ${String(cid)} appears twice`);
    if (typeof l['name'] !== 'string' || l['name'].trim() === '') throw new Error(`listing ${String(cid)}: name missing`);
    const total = l['listedTotal'];
    if (!Number.isSafeInteger(total) || (total as number) < 1 || (total as number) >= SENGOKU_SEARCH_CAP) throw new Error(`listing ${String(cid)}: listedTotal ${JSON.stringify(total)} is not below the search cap`);
    if (l['pageCount'] !== Math.ceil((total as number) / SENGOKU_PAGE_SIZE)) throw new Error(`listing ${String(cid)}: pageCount does not cover listedTotal`);
    totals.set(cid as number, total as number);
  }
  const split = s['splitListings'];
  if (!Array.isArray(split) || split.some((cid) => !Number.isSafeInteger(cid) || totals.has(cid as number))) throw new Error('splitListings is not a list of cids apart from the listings read');
  return totals;
}

/**
 * Checks the snapshot against its own listings: every listing read must hold
 * exactly as many distinct products as it reported, and every product must
 * come from a listing that was read.
 */
export function validateSengokuRaw(value: unknown): ValidationResult {
  const c = new IssueCollector();
  try {
    const s = record(value, 'snapshot');
    if (s['schemaVersion'] !== 1) throw new Error(`unsupported schemaVersion ${JSON.stringify(s['schemaVersion'])}`);
    if (typeof s['retrievedAt'] !== 'string') throw new Error('retrievedAt missing');
    normalizeUtcIso(s['retrievedAt']);
    if (s['complete'] !== true || !Array.isArray(s['errors']) || s['errors'].length) throw new Error('snapshot is not a complete collection');
    if (s['rootCid'] !== SENGOKU_ROOT_CID) throw new Error(`unexpected rootCid ${JSON.stringify(s['rootCid'])}`);
    const totals = checkListings(s);
    if (!Array.isArray(s['items']) || s['items'].length === 0) throw new Error('items missing');
    const codes = new Set<string>();
    const found = new Map<number, number>();
    let outOfStock = 0;
    let multiPrice = 0;
    let priceRange = 0;
    let noPrice = 0;
    let noModel = 0;
    for (const value of s['items']) {
      const item = parseSengokuItem(value);
      if (codes.has(item.code)) throw new Error(`product ${item.code} appears twice`);
      codes.add(item.code);
      for (const cid of item.listings) {
        if (!totals.has(cid)) throw new Error(`product ${item.code}: listing ${cid} was not read`);
        found.set(cid, (found.get(cid) ?? 0) + 1);
      }
      if (normalizeAvailability(item).state === 'out_of_stock') outOfStock += 1;
      if (item.priceLines.length > 1) multiPrice += 1;
      const price = normalizePrice(item).state;
      if (price === 'range') priceRange += 1;
      if (price === 'unavailable') noPrice += 1;
      if (item.model === null) noModel += 1;
    }
    for (const [cid, total] of totals) {
      if (found.get(cid) !== total) throw new Error(`listing ${cid}: ${found.get(cid) ?? 0} products for a listed total of ${total}`);
    }
    c.metrics['itemCount'] = codes.size;
    c.metrics['listingCount'] = totals.size;
    c.metrics['outOfStockCount'] = outOfStock;
    c.metrics['multiPriceCount'] = multiPrice;
    c.metrics['priceRangeCount'] = priceRange;
    c.metrics['noPriceCount'] = noPrice;
    c.metrics['noModelCount'] = noModel;
  } catch (e) {
    c.error('sengoku.raw', (e as Error).message);
  }
  return c.result();
}

/**
 * The price basis of a line, built from what the row shows:
 * 【数量1個〜】単価 → 1個, 【数量1本〜】1本単価 → 1本, 【数量1組〜】5個1組 → 5個1組,
 * and a line from more than one, 【数量10個〜】単価 → 1個（10個から）; from 0
 * (【数量0個〜】) is no minimum, as from 1. A line
 * without a quantity keeps its label as shown: 特価, 5枚綴り.
 */
export function sengokuUnitLabel(line: SengokuPriceLine): string {
  if (line.minQuantity === null) return line.label;
  const basis = line.label === '単価' ? `1${line.quantityUnit}`
    : line.label.endsWith('単価') ? line.label.slice(0, -'単価'.length)
    : line.label;
  return line.minQuantity <= 1 ? basis : `${basis}（${line.minQuantity}${line.quantityUnit}から）`;
}

/**
 * The price is the first line's, the way the row offers the product first;
 * the other lines (larger quantities, packs, reels) stay in the raw snapshot.
 * When another line repeats the first one's basis with a different amount,
 * the price is the range of those amounts rather than a pick of one. An
 * empty price block, or a first line that asks for a quote (価格お見積り),
 * gives no price.
 */
function normalizePrice(item: SengokuItem): PriceQuote {
  const first = item.priceLines[0];
  if (first === undefined || first.amountYen === null) {
    return { quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', state: 'unavailable', minAmountMinor: null, maxAmountMinor: null, unitLabel: null };
  }
  const amounts = item.priceLines
    .filter((l) => l.minQuantity === first.minQuantity && l.quantityUnit === first.quantityUnit && l.label === first.label)
    .map((l) => l.amountYen!);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  return {
    quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', state: min === max ? 'exact' : 'range',
    minAmountMinor: min, maxAmountMinor: max, unitLabel: sengokuUnitLabel(first),
  };
}

/**
 * Listings show no quantity and no cart, only an out-of-stock mark. Both
 * signs of it agreeing is out of stock, neither is in stock; anything else
 * is shown as it is, unmapped.
 */
export function normalizeAvailability(item: SengokuItem): Availability {
  const marked = item.stockMark === SENGOKU_OUT_OF_STOCK_MARK;
  const state = !item.outOfStockClass && item.stockMark === null ? 'in_stock'
    : item.outOfStockClass && marked ? 'out_of_stock'
    : 'unknown';
  return { state, purchasable: null, quantity: null, quantitySemantics: 'not_exposed', rawStatus: item.stockMark };
}

export function normalizeSengokuItem(item: SengokuItem): NormalizedProduct {
  return {
    externalProductId: item.code,
    pageKey: item.code,
    aliases: [{ kind: 'managementCode', value: item.code }],
    metadata: { name: item.name.trim(), modelNumber: item.model?.trim() || null, category: null, canonicalUrl: sengokuProductUrl(item.code) },
    offers: [{
      externalOfferId: DEFAULT_OFFER_ID, offerKind: 'default', sku: null, variantName: null,
      priceQuotes: [normalizePrice(item)], availability: normalizeAvailability(item),
    }],
  };
}

export const sengokuSnapshotAdapter: StoreSnapshotAdapter = {
  storeId: SENGOKU_STORE_ID,
  capabilities: SENGOKU_CAPABILITIES,
  validateRaw: validateSengokuRaw,
  normalize(value, rawSha256): NormalizedSnapshot {
    const validation = validateSengokuRaw(value);
    if (validation.errors.length) throw new Error(validation.errors.map((e) => e.message).join('; '));
    const s = value as SengokuSnapshot;
    const body = {
      storeId: SENGOKU_STORE_ID, observedAt: normalizeUtcIso(s.retrievedAt), sourceSchemaVersion: '1', complete: true,
      coverageId: `category:${SENGOKU_ROOT_CID}`,
      products: s.items.map((item) => normalizeSengokuItem(parseSengokuItem(item))).sort((a, b) => (a.pageKey < b.pageKey ? -1 : a.pageKey > b.pageKey ? 1 : 0)),
    };
    return { ...body, rawSha256, normalizedHash: sha256OfCanonicalJson(body) };
  },
  isValidPageKey: isSengokuCode,
  productUrlForPageKey: (key) => (isSengokuCode(key) ? sengokuProductUrl(key) : null),
};
