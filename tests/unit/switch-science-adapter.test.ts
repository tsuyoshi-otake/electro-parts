import { describe, expect, it } from 'vitest';
import { normalizeSwitchScienceAvailability, mapSwitchScienceAvailabilityState } from '../../src/adapters/switch-science/availability.ts';
import {
  parseShopifyYen,
  switchScienceProductUrl,
  SWITCH_SCIENCE_RAW_SCHEMA_VERSION,
  type SwitchScienceRawItem,
  type SwitchScienceRawSnapshot,
  type SwitchScienceRawVariant,
} from '../../src/adapters/switch-science/rawSchema.ts';
import {
  isValidSwitchScienceHandle,
  normalizeSwitchScienceItem,
  switchScienceCoverageId,
  switchScienceSnapshotAdapter,
  validateSwitchScienceRaw,
} from '../../src/adapters/switch-science/snapshotAdapter.ts';
import { getStoreAdapter, listStoreIds } from '../../src/stores/registry.ts';

function variant(overrides: Partial<SwitchScienceRawVariant> = {}): SwitchScienceRawVariant {
  return {
    variantId: 42_987_508_662_470,
    sku: '9381',
    title: 'Default Title',
    priceYen: 165,
    priceRaw: '165',
    compareAtPriceYen: null,
    compareAtPriceRaw: null,
    available: true,
    position: 1,
    ...overrides,
  };
}

function item(overrides: Partial<SwitchScienceRawItem> = {}): SwitchScienceRawItem {
  const handle = overrides.handle ?? '9381';
  return {
    handle,
    productId: 7_895_635_787_974,
    title: 'カメラケーブル',
    vendor: 'ArduCAM',
    productType: null,
    url: switchScienceProductUrl(handle),
    publishedAt: '2024-01-25T15:29:11+09:00',
    updatedAt: '2026-09-07T09:04:41+09:00',
    variants: [variant()],
    sourcePage: 1,
    positionOnPage: 1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SwitchScienceRawSnapshot> = {}): SwitchScienceRawSnapshot {
  const items = overrides.items ?? [item()];
  return {
    schemaVersion: SWITCH_SCIENCE_RAW_SCHEMA_VERSION,
    source: 'https://www.switch-science.com/collections/all/products.json',
    retrievedAt: '2026-09-07T00:05:56.401Z',
    complete: true,
    catalog: {
      sitemapUrl: 'https://www.switch-science.com/sitemap.xml',
      sitemapLastModified: null,
      productTotal: items.length,
      sitemapPages: 11,
      covered: items.length,
      uncovered: 0,
      uncoveredSample: [],
      unlisted: 0,
    },
    collection: 'all',
    pageCount: 1,
    extractedTotal: items.length,
    deduplication: { enabled: true, primaryKey: 'handle', uniqueKeyTotal: items.length, duplicatesDetected: 0, duplicatesRemoved: 0 },
    dataQuality: {
      unsupportedHandle: 0,
      unsupportedHandleSample: [],
      missingSku: 0,
      unparsablePrice: 0,
      multiVariant: 0,
      unavailable: 0,
    },
    requests: { logicalPages: 1, httpAttemptsIncludingRetries: 1, successfulResponses: 1, intervalMs: 1500 },
    validation: { errors: [], warnings: [] },
    ...overrides,
    items,
  };
}

const codes = (result: { errors: { code: string }[] }): string[] => result.errors.map((e) => e.code);
const warningCodes = (result: { warnings: { code: string }[] }): string[] => result.warnings.map((w) => w.code);

describe('parseShopifyYen', () => {
  it('accepts the integer strings the API sends, in either JSON type', () => {
    expect(parseShopifyYen('165')).toBe(165);
    expect(parseShopifyYen('0')).toBe(0);
    expect(parseShopifyYen(' 8910000 ')).toBe(8_910_000);
    expect(parseShopifyYen(1100)).toBe(1100);
  });

  it('accepts a fractional part only when it is zero: yen has no minor unit', () => {
    expect(parseShopifyYen('165.00')).toBe(165);
    expect(parseShopifyYen('165.0')).toBe(165);
    expect(parseShopifyYen('165.50')).toBeNull();
    expect(parseShopifyYen(165.5)).toBeNull();
  });

  it('refuses anything it would have to guess about', () => {
    for (const bad of ['', '-1', 'free', '1e3', '1,100', '¥165', '1 100', null, undefined, {}, [], true, NaN, Infinity]) {
      expect(parseShopifyYen(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseShopifyYen(String(Number.MAX_SAFE_INTEGER + 2))).toBeNull();
  });
});

describe('Switch Science handles', () => {
  it('accepts the shapes the catalogue actually uses', () => {
    for (const good of ['9381', '10', 'rpicm-pl', 'a', 'esp32-devkitc.v4', 'm5stack_core2']) {
      expect(isValidSwitchScienceHandle(good), good).toBe(true);
    }
  });

  it('refuses handles that could not be a file name or a URL segment', () => {
    for (const bad of ['', 'ABC', '-lead', '.hidden', 'a/b', 'a b', 'ネジ', '..', 'x'.repeat(65)]) {
      expect(isValidSwitchScienceHandle(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('builds the URL the page itself declares canonical (no trailing slash)', () => {
    expect(switchScienceProductUrl('9381')).toBe('https://www.switch-science.com/products/9381');
    expect(switchScienceSnapshotAdapter.productUrlForPageKey('9381')).toBe('https://www.switch-science.com/products/9381');
    expect(switchScienceSnapshotAdapter.productUrlForPageKey('../etc')).toBeNull();
    expect(switchScienceSnapshotAdapter.isValidPageKey('rpicm-pl')).toBe(true);
  });
});

describe('validateSwitchScienceRaw', () => {
  it('accepts a well-formed snapshot and reports what it saw', () => {
    const r = validateSwitchScienceRaw(snapshot());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.metrics).toMatchObject({ itemCount: 1, variantCount: 1, missingSku: 0, unparsablePrice: 0, multiVariant: 0 });
  });

  it('refuses a snapshot that is not this schema, and stops there', () => {
    expect(codes(validateSwitchScienceRaw(null))).toEqual(['raw.not_object']);
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), schemaVersion: 2 }))).toEqual(['raw.schema_version']);
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), schemaVersion: undefined }))).toEqual(['raw.schema_version']);
  });

  it('refuses an incomplete crawl and a crawl whose collector reported errors (fail closed)', () => {
    expect(codes(validateSwitchScienceRaw(snapshot({ complete: false })))).toContain('raw.incomplete');
    const withErrors = snapshot();
    withErrors.validation = { errors: ['page 3: HTTP 503'], warnings: [] };
    expect(codes(validateSwitchScienceRaw(withErrors))).toContain('raw.collector_errors');
  });

  it('refuses a snapshot missing the blocks that make it interpretable', () => {
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), catalog: undefined }))).toContain('raw.catalog_missing');
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), validation: undefined }))).toContain('raw.validation_missing');
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), collection: '' }))).toContain('raw.collection');
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), retrievedAt: 'yesterday' }))).toContain('raw.retrieved_at');
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), items: undefined }))).toEqual(['raw.items']);
    expect(codes(validateSwitchScienceRaw(snapshot({ items: [] })))).toContain('raw.items_empty');
  });

  it('refuses items whose identity or URL does not hold together', () => {
    expect(codes(validateSwitchScienceRaw(snapshot({ items: [item({ handle: 'ABC' })] })))).toEqual(['item.handle']);
    expect(codes(validateSwitchScienceRaw(snapshot({ items: [item(), item()] })))).toContain('item.duplicate');
    expect(codes(validateSwitchScienceRaw(snapshot({ items: [{ ...item(), url: 'https://www.switch-science.com/products/9381/' }] })))).toContain('item.url');
    expect(codes(validateSwitchScienceRaw(snapshot({ items: [{ ...item(), productId: '7895635787974' as unknown as number }] })))).toContain('item.product_id');
    expect(codes(validateSwitchScienceRaw(snapshot({ items: [{ ...item(), title: '  ' }] })))).toContain('item.title');
    expect(codes(validateSwitchScienceRaw(snapshot({ items: [{ ...item(), variants: [] }] })))).toContain('item.variants');
  });

  it('refuses variants whose price or identity is not usable, and only warns about the rest', () => {
    const bad = (v: Partial<SwitchScienceRawVariant>): string[] => codes(validateSwitchScienceRaw(snapshot({ items: [item({ variants: [variant(v)] })] })));
    expect(bad({ priceYen: -1 })).toEqual(['variant.price']);
    expect(bad({ priceYen: 1.5 })).toEqual(['variant.price']);
    expect(bad({ variantId: 1.5 })).toEqual(['variant.id']);
    expect(bad({ available: 'yes' as unknown as boolean })).toEqual(['variant.available']);
    expect(bad({ priceRaw: 165 as unknown as string })).toEqual(['variant.price_raw']);
    expect(bad({ compareAtPriceYen: -2 })).toEqual(['variant.compare_at']);

    const warn = (v: Partial<SwitchScienceRawVariant>): string[] =>
      warningCodes(validateSwitchScienceRaw(snapshot({ items: [item({ variants: [variant(v)] })] })));
    // An unparsable price is one unavailable quote, not a rejected store.
    expect(warn({ priceYen: null, priceRaw: 'お問い合わせ' })).toEqual(['variant.price_unparsable']);
    expect(warn({ priceYen: 0, priceRaw: '0' })).toEqual(['variant.price_zero']);
    expect(warn({ compareAtPriceYen: 100, compareAtPriceRaw: '100' })).toEqual(['variant.compare_at_below_price']);
  });

  it('refuses a snapshot whose own count disagrees with its items', () => {
    expect(codes(validateSwitchScienceRaw({ ...snapshot(), extractedTotal: 2 }))).toContain('raw.extracted_total');
  });

  it('reports a catalogue gap as a warning: the collector decides whether it is fatal', () => {
    const gap = snapshot();
    gap.catalog = { ...gap.catalog, uncovered: 3, uncoveredSample: ['a', 'b', 'c'] };
    const r = validateSwitchScienceRaw(gap);
    expect(r.errors).toEqual([]);
    expect(warningCodes(r)).toEqual(['raw.catalog_gap']);
    expect(r.metrics['catalogUncovered']).toBe(3);
  });

  it('caps repeated issues of one code instead of listing thousands', () => {
    const many = Array.from({ length: 25 }, (_, i) => item({ handle: String(1000 + i), variants: [variant({ priceYen: 0, priceRaw: '0' })] }));
    const r = validateSwitchScienceRaw(snapshot({ items: many }));
    expect(r.warnings).toHaveLength(21);
    expect(r.warnings.at(-1)?.message).toBe('further variant.price_zero issues suppressed');
    expect(r.metrics['issue.variant.price_zero']).toBe(25);
  });
});

describe('Switch Science normalization', () => {
  it('keeps the handle as the identity and the variant id as the offer', () => {
    const p = normalizeSwitchScienceItem(item());
    expect(p.externalProductId).toBe('9381');
    expect(p.pageKey).toBe('9381');
    expect(p.metadata.canonicalUrl).toBe('https://www.switch-science.com/products/9381');
    expect(p.aliases).toEqual([
      { kind: 'handle', value: '9381' },
      { kind: 'shopifyProductId', value: '7895635787974' },
      { kind: 'sku', value: '9381' },
    ]);
    expect(p.offers).toHaveLength(1);
    expect(p.offers[0]).toMatchObject({ externalOfferId: '42987508662470', offerKind: 'variant', sku: '9381', variantName: null });
  });

  it('records the selling price as tax-included yen, with no invented unit', () => {
    const [offer] = normalizeSwitchScienceItem(item()).offers;
    expect(offer?.priceQuotes).toEqual([
      { quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', state: 'exact', minAmountMinor: 165, maxAmountMinor: 165, unitLabel: null },
    ]);
  });

  it('turns an unparsable price into an unavailable quote rather than a guess', () => {
    const [offer] = normalizeSwitchScienceItem(item({ variants: [variant({ priceYen: null, priceRaw: 'お問い合わせ' })] })).offers;
    expect(offer?.priceQuotes[0]).toMatchObject({ state: 'unavailable', minAmountMinor: null, maxAmountMinor: null });
  });

  it('adds compare-at as a second quote when the store publishes one', () => {
    const [offer] = normalizeSwitchScienceItem(item({ variants: [variant({ compareAtPriceYen: 220, compareAtPriceRaw: '220' })] })).offers;
    expect(offer?.priceQuotes.map((q) => [q.quoteKind, q.minAmountMinor])).toEqual([
      ['selling', 165],
      ['compare_at', 220],
    ]);
  });

  it('maps availability from the store flag alone, with no quantity invented', () => {
    expect(mapSwitchScienceAvailabilityState(true)).toBe('in_stock');
    expect(mapSwitchScienceAvailabilityState(false)).toBe('out_of_stock');
    expect(normalizeSwitchScienceAvailability(variant({ available: false }))).toEqual({
      state: 'out_of_stock',
      purchasable: false,
      // Not zero: the bulk API never sends a quantity, and `null` is the
      // difference between "sold out" and "never told us".
      quantity: null,
      quantitySemantics: 'not_exposed',
      // The store shows no status text, only a boolean the other fields carry.
      rawStatus: null,
    });
    expect(normalizeSwitchScienceAvailability(variant({ available: true }))).toMatchObject({ state: 'in_stock', purchasable: true, rawStatus: null });
  });

  it('drops Shopify placeholders: "Default Title" is not a variant name, an empty product type is not a category', () => {
    const named = normalizeSwitchScienceItem(item({ productType: 'Sensor', variants: [variant({ title: '5V版' })] }));
    expect(named.metadata.category).toBe('Sensor');
    expect(named.offers[0]?.variantName).toBe('5V版');
    const blank = normalizeSwitchScienceItem(item({ productType: '   ' }));
    expect(blank.metadata.category).toBeNull();
    expect(blank.offers[0]?.variantName).toBeNull();
  });

  it('orders offers by the store position so a reordered response is not a change', () => {
    const two = item({
      variants: [
        variant({ variantId: 2, position: 2, sku: 'B' }),
        variant({ variantId: 1, position: 1, sku: 'A' }),
      ],
    });
    const p = normalizeSwitchScienceItem(two);
    expect(p.offers.map((o) => o.externalOfferId)).toEqual(['1', '2']);
    // The first variant's SKU is the closest thing to a model number.
    expect(p.metadata.modelNumber).toBe('A');
    expect(p.aliases.filter((a) => a.kind === 'sku').map((a) => a.value)).toEqual(['A', 'B']);
  });

  it('names the collection it walked as the coverage, so a narrowed run is not a collapse', () => {
    expect(switchScienceCoverageId(snapshot())).toBe('shopify:collections/all');
    expect(switchScienceCoverageId(snapshot({ collection: 'new-products' }))).toBe('shopify:collections/new-products');
  });

  it('refuses to normalize a snapshot it would have rejected', () => {
    expect(() => switchScienceSnapshotAdapter.normalize(snapshot({ complete: false }), 'a'.repeat(64))).toThrow(/raw.incomplete/);
  });

  it('is registered next to the other stores', () => {
    expect(listStoreIds()).toEqual(['akizuki', 'switch-science', 'm5stack']);
    expect(getStoreAdapter('switch-science')).toBe(switchScienceSnapshotAdapter);
    expect(switchScienceSnapshotAdapter.capabilities).toMatchObject({
      supportsVariants: true,
      supportsInventoryQuantity: false,
      inventoryQuantitySemantics: 'not_exposed',
      primaryQuote: { quoteKind: 'selling', taxTreatment: 'tax_included' },
    });
  });
});
