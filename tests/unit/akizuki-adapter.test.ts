import { describe, expect, it } from 'vitest';
import { mapAkizukiAvailabilityState } from '../../src/adapters/akizuki/availability.ts';
import {
  akizukiCoverageId,
  akizukiSnapshotAdapter,
  normalizeAkizukiItem,
  validateAkizukiRaw,
} from '../../src/adapters/akizuki/snapshotAdapter.ts';
import type { AkizukiRawItem, AkizukiRawSnapshot } from '../../src/adapters/akizuki/rawSchema.ts';
import { DEFAULT_OFFER_ID } from '../../src/core/domain.ts';

function item(overrides: Partial<AkizukiRawItem> = {}): AkizukiRawItem {
  return {
    salesCode: '109951',
    modelNumber: 'AE-TTL-232R',
    name: 'FT232RQ USBシリアル変換モジュールキット',
    category: 'USB変換モジュール(usb-serial)',
    url: 'https://akizukidenshi.com/catalog/g/g109951/',
    prices: [{ amountYen: 1200, display: '￥1,200', quantityUnit: '1セット', taxIncluded: true }],
    stock: { status: '在庫あり', availableQuantity: 100, quantityUnit: 'セット', quantityDisplay: '100セット', purchasable: true },
    ...overrides,
  };
}

function snapshot(overrides: Partial<AkizukiRawSnapshot> = {}): AkizukiRawSnapshot {
  const items = overrides.items ?? [item()];
  return {
    schemaVersion: 3,
    source: 'https://akizukidenshi.com/catalog/',
    retrievedAt: '2026-09-06T09:54:15.029Z',
    complete: true,
    catalog: {
      sitemapUrl: 'https://akizukidenshi.com/Sitemap_index.xml',
      sitemapLastModified: '2026-09-06T00:00:00.000Z',
      productTotal: items.length,
      listingTotal: 1,
      listingsCrawled: 1,
      covered: items.length,
      uncovered: 0,
      uncoveredSample: [],
      unlisted: 0,
    },
    listingCount: 1,
    occurrenceTotal: items.length,
    extractedTotal: items.length,
    deduplication: {
      enabled: true,
      primaryKey: 'salesCode',
      fallbackKey: 'url',
      uniqueKeyTotal: items.length,
      duplicatesDetected: 0,
      duplicatesRemoved: 0,
    },
    dataQuality: { missingSalesCode: 0, missingModelNumber: 0, missingName: 0 },
    requests: { logicalPages: 1, httpAttemptsIncludingRetries: 1, successfulResponses: 1, intervalMs: 1500 },
    validation: { listingMismatches: 0, errors: [], warnings: [] },
    listings: [
      {
        kind: 'c',
        slug: 'ckit',
        name: 'キット',
        url: 'https://akizukidenshi.com/catalog/c/ckit/',
        listedTotal: items.length,
        truncated: false,
        totalPages: 1,
        successfulPages: 1,
        failedPages: 0,
        extractedOccurrences: items.length,
        matchesListedTotal: true,
      },
    ],
    ...overrides,
    items,
  };
}

/** A schema 2 snapshot exactly as the hand-written genre collector wrote it. */
function legacySnapshot(): Record<string, unknown> {
  const s = snapshot() as unknown as Record<string, unknown>;
  delete s['catalog'];
  delete s['listings'];
  delete s['listingCount'];
  return {
    ...s,
    schemaVersion: 2,
    source: 'https://akizukidenshi.com/',
    genreCount: 2,
    validation: { genreMismatches: 0, errors: [], warnings: [] },
    genres: [
      { name: 'AI', url: 'https://akizukidenshi.com/catalog/r/rai/', listedTotal: 1, totalPages: 1, successfulPages: 1, failedPages: 0, extractedOccurrences: 1, matchesListedTotal: true },
      { name: 'キット', url: 'https://akizukidenshi.com/catalog/r/rkit/', listedTotal: 1, totalPages: 1, successfulPages: 1, failedPages: 0, extractedOccurrences: 1, matchesListedTotal: true },
    ],
  };
}

describe('Akizuki availability mapping', () => {
  it.each([
    ['販売終了', false, 'discontinued'],
    ['販売終了', true, 'discontinued'],
    ['在庫あり', true, 'in_stock'],
    ['在庫あり（八潮店在庫あり）', true, 'in_stock'],
    ['在庫僅少', true, 'low_stock'],
    ['入荷未定', false, 'out_of_stock'],
    ['納期未定 / 入荷未定', false, 'out_of_stock'],
    ['納期確認中 / 入荷未定', false, 'out_of_stock'],
    ['9月下旬入荷予定', false, 'restocking'],
    ['', true, 'in_stock'],
    ['', false, 'unknown'],
    ['何か別の文言', false, 'out_of_stock'],
  ] as const)('maps %s / purchasable=%s to %s', (status, purchasable, expected) => {
    expect(mapAkizukiAvailabilityState(status, purchasable)).toBe(expected);
  });
});

describe('Akizuki item normalization', () => {
  it('maps identity, price, unit and availability', () => {
    const p = normalizeAkizukiItem(item());
    expect(p.externalProductId).toBe('109951');
    expect(p.pageKey).toBe('109951');
    expect(p.aliases).toEqual([{ kind: 'salesCode', value: '109951' }]);
    expect(p.metadata.canonicalUrl).toBe('https://akizukidenshi.com/catalog/g/g109951/');
    expect(p.offers).toHaveLength(1);
    const offer = p.offers[0]!;
    expect(offer.externalOfferId).toBe(DEFAULT_OFFER_ID);
    expect(offer.priceQuotes).toEqual([
      {
        quoteKind: 'selling',
        taxTreatment: 'tax_included',
        currency: 'JPY',
        state: 'exact',
        minAmountMinor: 1200,
        maxAmountMinor: 1200,
        unitLabel: '1セット',
      },
    ]);
    expect(offer.availability).toEqual({
      state: 'in_stock',
      purchasable: true,
      quantity: 100,
      quantitySemantics: 'site_reported',
      rawStatus: '在庫あり',
    });
  });

  it('keeps null quantity as unknown semantics, never as zero', () => {
    const p = normalizeAkizukiItem(
      item({ stock: { status: '入荷未定', availableQuantity: null, purchasable: false } }),
    );
    const a = p.offers[0]!.availability;
    expect(a.quantity).toBeNull();
    expect(a.quantitySemantics).toBe('unknown');
    expect(a.state).toBe('out_of_stock');
    expect(a.purchasable).toBe(false);
  });

  it('produces an unavailable quote when the amount is null', () => {
    const p = normalizeAkizukiItem(
      item({ prices: [{ amountYen: null, display: '', quantityUnit: '1個', taxIncluded: true }] }),
    );
    const q = p.offers[0]!.priceQuotes[0]!;
    expect(q.state).toBe('unavailable');
    expect(q.minAmountMinor).toBeNull();
    expect(q.unitLabel).toBe('1個');
  });

  it('trims metadata and turns empty strings into null', () => {
    const p = normalizeAkizukiItem(item({ modelNumber: '  ', category: '' }));
    expect(p.metadata.modelNumber).toBeNull();
    expect(p.metadata.category).toBeNull();
  });
});

describe('Akizuki raw validation', () => {
  it('accepts a well-formed snapshot', () => {
    const r = validateAkizukiRaw(snapshot());
    expect(r.errors).toEqual([]);
    expect(r.metrics['itemCount']).toBe(1);
  });

  it.each([
    ['schema version', { schemaVersion: 1 }, 'raw.schema_version'],
    ['incomplete', { complete: false }, 'raw.incomplete'],
    ['naive timestamp', { retrievedAt: '2026-09-06T09:54:15' }, 'raw.retrieved_at'],
    ['collector errors', { validation: { listingMismatches: 0, errors: ['boom'], warnings: [] } }, 'raw.collector_errors'],
    ['listing mismatch', { validation: { listingMismatches: 1, errors: [], warnings: [] } }, 'raw.listing_mismatch'],
    ['extracted total mismatch', { extractedTotal: 99 }, 'raw.extracted_total'],
    ['empty items', { items: [] }, 'raw.items_empty'],
  ] as const)('rejects %s', (_label, overrides, code) => {
    const r = validateAkizukiRaw(snapshot(overrides as Partial<AkizukiRawSnapshot>));
    expect(r.errors.map((e) => e.code)).toContain(code);
  });

  it('rejects failed listing pages', () => {
    const s = snapshot();
    s.listings[0]!.failedPages = 1;
    expect(validateAkizukiRaw(s).errors.map((e) => e.code)).toContain('raw.listing_failed_pages');
  });

  it('warns when the sitemap holds products no listing showed', () => {
    const s = snapshot();
    s.catalog.uncovered = 3;
    s.catalog.covered = s.catalog.productTotal - 3;
    const r = validateAkizukiRaw(s);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('raw.catalog_gap');
    expect(r.metrics['catalogUncovered']).toBe(3);
  });

  it('rejects a schema 3 snapshot without the catalogue coverage block', () => {
    const s = snapshot() as unknown as Record<string, unknown>;
    delete s['catalog'];
    expect(validateAkizukiRaw(s).errors.map((e) => e.code)).toContain('raw.catalog_missing');
  });

  it.each([
    ['bad sales code', item({ salesCode: '12a' }), 'item.sales_code'],
    ['path traversal sales code', item({ salesCode: '../x' }), 'item.sales_code'],
    ['url mismatch', item({ url: 'https://akizukidenshi.com/catalog/g/g999/' }), 'item.url'],
    ['negative price', item({ prices: [{ amountYen: -1, display: '', quantityUnit: '1個', taxIncluded: true }] }), 'item.price_amount'],
    ['float price', item({ prices: [{ amountYen: 10.5, display: '', quantityUnit: '1個', taxIncluded: true }] }), 'item.price_amount'],
    ['tax excluded', item({ prices: [{ amountYen: 10, display: '', quantityUnit: '1個', taxIncluded: false }] }), 'item.price_tax'],
    ['no prices', item({ prices: [] }), 'item.prices'],
    ['purchasable not boolean', item({ stock: { status: 'x', availableQuantity: 1, purchasable: 'yes' as unknown as boolean } }), 'item.purchasable'],
    ['negative quantity', item({ stock: { status: 'x', availableQuantity: -3, purchasable: true } }), 'item.quantity'],
  ] as const)('rejects item with %s', (_label, bad, code) => {
    const r = validateAkizukiRaw(snapshot({ items: [bad] }));
    expect(r.errors.map((e) => e.code)).toContain(code);
  });

  it('accepts a discontinued row whose price cell states no amount', () => {
    // Akizuki prints 販売終了 where the price would be. There is no amount, so
    // there is no tax treatment to state either, and `normalizeAkizukiItem`
    // turns it into an `unavailable` quote. Rejecting it here quarantined a
    // whole 12,772-item snapshot over three such rows.
    const ended = item({
      prices: [{ amountYen: null, display: '販売終了', quantityUnit: '1パック30枚入', taxIncluded: false }],
      stock: { status: '販売終了', availableQuantity: null, quantityUnit: null, quantityDisplay: null, purchasable: false },
    });
    const r = validateAkizukiRaw(snapshot({ items: [ended] }));
    expect(r.errors).toEqual([]);
    const product = normalizeAkizukiItem(ended);
    expect(product.offers[0]!.priceQuotes[0]).toMatchObject({ state: 'unavailable', minAmountMinor: null, taxTreatment: 'tax_included' });
    expect(product.offers[0]!.availability.state).toBe('discontinued');
  });

  it('rejects duplicate sales codes', () => {
    const r = validateAkizukiRaw(snapshot({ items: [item(), item()] }));
    expect(r.errors.map((e) => e.code)).toContain('item.duplicate');
  });

  it('caps repeated issues so a broken snapshot does not produce a huge report', () => {
    const items = Array.from({ length: 50 }, (_, i) => item({ salesCode: String(100000 + i), url: 'https://x/' }));
    const r = validateAkizukiRaw(snapshot({ items }));
    const urlIssues = r.errors.filter((e) => e.code === 'item.url');
    expect(urlIssues.length).toBeLessThanOrEqual(21);
    expect(r.metrics['issue.item.url']).toBe(50);
  });

  it('normalize throws on an invalid snapshot', () => {
    expect(() => akizukiSnapshotAdapter.normalize(snapshot({ complete: false }), 'x')).toThrow(/rejected/);
  });
});

describe('Akizuki adapter contract', () => {
  it('names the listing families a sitemap-driven run covered', () => {
    const s = snapshot();
    expect(akizukiCoverageId(s)).toBe('sitemap:c');
    s.listings.push({ ...s.listings[0]!, kind: 'r', slug: 'rkit', url: 'https://akizukidenshi.com/catalog/r/rkit/' });
    // Adding a category to the shop must not change what a run claims to
    // cover, so the id names the families rather than the slugs.
    expect(akizukiCoverageId(s)).toBe('sitemap:c+r');
  });

  it('keeps reading the archived schema 2 snapshots, including their coverage id', () => {
    const legacy = legacySnapshot();
    const r = validateAkizukiRaw(legacy);
    expect(r.errors).toEqual([]);
    expect(akizukiCoverageId(legacy as unknown as AkizukiRawSnapshot)).toBe('rai+rkit');
    expect(akizukiSnapshotAdapter.normalize(legacy, 'sha').products).toHaveLength(1);
  });

  it('sorts products by external id and hashes deterministically', () => {
    const a = akizukiSnapshotAdapter.normalize(snapshot({ items: [item({ salesCode: '2', url: 'https://akizukidenshi.com/catalog/g/g2/' }), item({ salesCode: '1', url: 'https://akizukidenshi.com/catalog/g/g1/' })] }), 'sha');
    const b = akizukiSnapshotAdapter.normalize(snapshot({ items: [item({ salesCode: '1', url: 'https://akizukidenshi.com/catalog/g/g1/' }), item({ salesCode: '2', url: 'https://akizukidenshi.com/catalog/g/g2/' })] }), 'sha');
    expect(a.products.map((p) => p.externalProductId)).toEqual(['1', '2']);
    expect(a.normalizedHash).toBe(b.normalizedHash);
    expect(a.observedAt).toBe('2026-09-06T09:54:15.029Z');
    expect(a.storeId).toBe('akizuki');
  });

  it('normalizes timestamps with an offset to UTC', () => {
    const s = akizukiSnapshotAdapter.normalize(snapshot({ retrievedAt: '2026-09-06T18:54:15.029+09:00' }), 'sha');
    expect(s.observedAt).toBe('2026-09-06T09:54:15.029Z');
  });

  it.each(['109951', '1', '123456789012'])('accepts page key %s', (k) => {
    expect(akizukiSnapshotAdapter.isValidPageKey(k)).toBe(true);
    expect(akizukiSnapshotAdapter.productUrlForPageKey(k)).toBe(`https://akizukidenshi.com/catalog/g/g${k}/`);
  });

  it.each(['', 'abc', '1234567890123', '../1', '10/9', '１２３'])('rejects page key %j', (k) => {
    expect(akizukiSnapshotAdapter.isValidPageKey(k)).toBe(false);
    expect(akizukiSnapshotAdapter.productUrlForPageKey(k)).toBeNull();
  });
});
