import type { StoreCapabilities } from '../../core/capabilities.ts';
import { DEFAULT_OFFER_ID, type Availability, type NormalizedProduct, type NormalizedSnapshot, type PriceQuote } from '../../core/domain.ts';
import { sha256OfCanonicalJson } from '../../core/hash.ts';
import { normalizeUtcIso } from '../../core/time.ts';
import { IssueCollector, type ValidationResult } from '../../core/validation.ts';
import type { StoreSnapshotAdapter } from '../../stores/adapter.ts';
import { MARUTSU_STORE_ID, isMarutsuPageId, marutsuProductUrl } from './identity.ts';
import {
  MARUTSU_INQUIRY_TEXT, MARUTSU_PAGE_SIZE, MARUTSU_SEARCH_CAP, MARUTSU_SHIP_LINK_TEXT, MARUTSU_TOP_CATEGORY_PATHS,
  isMarutsuCategoryPath, parseMarutsuItem, record, type MarutsuItem, type MarutsuPriceTier, type MarutsuSnapshot,
} from './rawSchema.ts';

export const MARUTSU_CAPABILITIES: StoreCapabilities = {
  supportsExactPrice: true, supportsPriceRange: false, supportsVariants: false, supportsCompareAtPrice: false,
  supportsTaxIncluded: true, supportsTaxExcluded: true, supportsAvailability: true,
  supportsInventoryQuantity: true, inventoryQuantitySemantics: 'site_reported',
  primaryQuote: { quoteKind: 'selling', taxTreatment: 'tax_included' },
};

function checkListings(s: Record<string, unknown>): Map<string, number> {
  if (!Array.isArray(s['listings']) || s['listings'].length === 0) throw new Error('listings missing');
  const totals = new Map<string, number>();
  for (const value of s['listings']) {
    const l = record(value, 'listing');
    const path = l['categoryPath'];
    if (typeof path !== 'string' || !isMarutsuCategoryPath(path)) throw new Error(`invalid listing path ${JSON.stringify(path)}`);
    if (totals.has(path)) throw new Error(`listing ${path} appears twice`);
    if (typeof l['name'] !== 'string' || l['name'].trim() === '') throw new Error(`listing ${path}: name missing`);
    const total = l['listedTotal'];
    if (!Number.isSafeInteger(total) || (total as number) < 1 || (total as number) >= MARUTSU_SEARCH_CAP) throw new Error(`listing ${path}: listedTotal ${JSON.stringify(total)} is not below the search cap`);
    if (l['pageCount'] !== Math.ceil((total as number) / MARUTSU_PAGE_SIZE)) throw new Error(`listing ${path}: pageCount does not cover listedTotal`);
    totals.set(path, total as number);
  }
  const split = s['splitListings'];
  if (!Array.isArray(split) || split.some((path) => typeof path !== 'string' || !MARUTSU_TOP_CATEGORY_PATHS.includes(path as string) || totals.has(path as string))) {
    throw new Error('splitListings is not a list of top categories apart from the listings read');
  }
  for (const path of totals.keys()) {
    const top = path.slice(0, 2);
    if (!MARUTSU_TOP_CATEGORY_PATHS.includes(top)) throw new Error(`listing ${path}: its top category ${top} is not one the crawl reads`);
    if ((split as string[]).includes(top) === (path === top)) throw new Error(`listing ${path}: a split top category is read through subcategories, an unsplit one directly`);
  }
  return totals;
}

/**
 * Checks the snapshot against its own listings: every listing read must
 * hold exactly as many distinct products as it reported, and every
 * product must come from a listing that was read.
 */
export function validateMarutsuRaw(value: unknown): ValidationResult {
  const c = new IssueCollector();
  try {
    const s = record(value, 'snapshot');
    if (s['schemaVersion'] !== 1) throw new Error(`unsupported schemaVersion ${JSON.stringify(s['schemaVersion'])}`);
    if (typeof s['retrievedAt'] !== 'string') throw new Error('retrievedAt missing');
    normalizeUtcIso(s['retrievedAt']);
    if (s['complete'] !== true || !Array.isArray(s['errors']) || s['errors'].length) throw new Error('snapshot is not a complete collection');
    if (JSON.stringify(s['categories']) !== JSON.stringify(MARUTSU_TOP_CATEGORY_PATHS)) throw new Error(`unexpected categories ${JSON.stringify(s['categories'])}`);
    const totals = checkListings(s);
    if (!Array.isArray(s['items']) || s['items'].length === 0) throw new Error('items missing');
    const ids = new Set<string>();
    const found = new Map<string, number>();
    let noStock = 0;
    let stockLink = 0;
    let noPrice = 0;
    let noModel = 0;
    let noCode = 0;
    for (const value of s['items']) {
      const item = parseMarutsuItem(value);
      if (ids.has(item.pageId)) throw new Error(`product ${item.pageId} appears twice`);
      ids.add(item.pageId);
      for (const path of item.listings) {
        if (!totals.has(path)) throw new Error(`product ${item.pageId}: listing ${path} was not read`);
        found.set(path, (found.get(path) ?? 0) + 1);
      }
      if (item.stockQuantity === null) noStock += 1;
      if (item.stockNote !== null) stockLink += 1;
      if (item.priceTiers.length === 0) noPrice += 1;
      if (item.model === null) noModel += 1;
      if (item.marutsuCode === null) noCode += 1;
    }
    for (const [path, total] of totals) {
      if (found.get(path) !== total) throw new Error(`listing ${path}: ${found.get(path) ?? 0} products for a listed total of ${total}`);
    }
    c.metrics['itemCount'] = ids.size;
    c.metrics['listingCount'] = totals.size;
    c.metrics['noStockCount'] = noStock;
    c.metrics['stockLinkCount'] = stockLink;
    c.metrics['noPriceCount'] = noPrice;
    c.metrics['noModelCount'] = noModel;
    c.metrics['noCodeCount'] = noCode;
  } catch (e) {
    c.error('marutsu.raw', (e as Error).message);
  }
  return c.result();
}

/**
 * The price basis of a tier, the way せんごく names it: the first tier's
 * `1個以上` is a per-piece price `1個`; a tier that only applies from a
 * larger quantity keeps that in the label, `1個（100個から）`.
 */
export function marutsuUnitLabel(tier: MarutsuPriceTier): string {
  const basis = `1${tier.quantityUnit}`;
  return tier.minQuantity <= 1 ? basis : `${basis}（${tier.minQuantity}${tier.quantityUnit}から）`;
}

/**
 * The price is the first tier's tax-included amount, the way the row
 * offers the product first; the larger-quantity tiers stay in the raw
 * snapshot. A row with no price block gives no price.
 */
function normalizePrice(item: MarutsuItem): PriceQuote {
  const first = item.priceTiers[0];
  if (first === undefined) {
    return { quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', state: 'unavailable', minAmountMinor: null, maxAmountMinor: null, unitLabel: null };
  }
  return {
    quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', state: 'exact',
    minAmountMinor: first.amountIncludingTaxYen, maxAmountMinor: first.amountIncludingTaxYen, unitLabel: marutsuUnitLabel(first),
  };
}

const SHIP_DATE = /^\d{4}\/\d{1,2}\/\d{1,2}$/;
const SHIP_SPAN = /^\d+営業日程度$/;

/**
 * A printed stock quantity is in stock, counted by the shop. Without one,
 * a marketplace row points at its source (`checking`), a dated or
 * business-day shipping text is a restocking lead time, and
 * `お問合せ下さい` says nothing (`unknown`).
 */
export function normalizeAvailability(item: MarutsuItem): Availability {
  if (item.stockQuantity !== null) {
    return { state: 'in_stock', purchasable: true, quantity: item.stockQuantity, quantitySemantics: 'site_reported', rawStatus: item.shipText };
  }
  if (item.stockNote !== null) {
    return { state: 'checking', purchasable: null, quantity: null, quantitySemantics: 'not_exposed', rawStatus: item.stockNote };
  }
  const ship = item.shipText;
  const state = ship !== null && (SHIP_DATE.test(ship) || SHIP_SPAN.test(ship) || ship === MARUTSU_SHIP_LINK_TEXT) ? 'restocking'
    : ship === MARUTSU_INQUIRY_TEXT ? 'unknown'
    : 'unknown';
  return { state, purchasable: null, quantity: null, quantitySemantics: 'not_exposed', rawStatus: ship };
}

export function normalizeMarutsuItem(item: MarutsuItem): NormalizedProduct {
  return {
    externalProductId: item.pageId,
    pageKey: item.pageId,
    aliases: item.marutsuCode === null ? [] : [{ kind: 'marutsuCode', value: item.marutsuCode }],
    metadata: { name: item.name.trim(), modelNumber: item.model?.trim() || null, category: null, canonicalUrl: marutsuProductUrl(item.pageId) },
    offers: [{
      externalOfferId: DEFAULT_OFFER_ID, offerKind: 'default', sku: null, variantName: null,
      priceQuotes: [normalizePrice(item)], availability: normalizeAvailability(item),
    }],
  };
}

export const marutsuSnapshotAdapter: StoreSnapshotAdapter = {
  storeId: MARUTSU_STORE_ID,
  capabilities: MARUTSU_CAPABILITIES,
  validateRaw: validateMarutsuRaw,
  normalize(value, rawSha256): NormalizedSnapshot {
    const validation = validateMarutsuRaw(value);
    if (validation.errors.length) throw new Error(validation.errors.map((e) => e.message).join('; '));
    const s = value as MarutsuSnapshot;
    const body = {
      storeId: MARUTSU_STORE_ID, observedAt: normalizeUtcIso(s.retrievedAt), sourceSchemaVersion: '1', complete: true,
      coverageId: `stocked:${MARUTSU_TOP_CATEGORY_PATHS.join(',')}`,
      products: s.items.map((item) => normalizeMarutsuItem(parseMarutsuItem(item))).sort((a, b) => (a.pageKey < b.pageKey ? -1 : a.pageKey > b.pageKey ? 1 : 0)),
    };
    return { ...body, rawSha256, normalizedHash: sha256OfCanonicalJson(body) };
  },
  isValidPageKey: isMarutsuPageId,
  productUrlForPageKey: (key) => (isMarutsuPageId(key) ? marutsuProductUrl(key) : null),
};
