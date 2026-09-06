import { describe, expect, it } from 'vitest';
import { akizukiSnapshotAdapter } from '../../src/adapters/akizuki/snapshotAdapter.ts';
import { crawlAkizuki } from '../../src/collectors/akizuki/crawl.ts';
import { parseAkizukiListingPage } from '../../src/collectors/akizuki/listingParser.ts';
import { RequestBudgetExceededError } from '../../src/collectors/politeFetcher.ts';
import { MAINTENANCE_PAGE, renderListingPage, syntheticItem } from '../helpers/akizukiHtml.ts';
import {
  addIndexCategory,
  addListing,
  addOrphanProduct,
  FAKE_BASE as BASE,
  FAKE_SITEMAP_INDEX,
  FAKE_SITEMAP_PART,
  fakeSite as site,
  fetcherFor,
} from '../helpers/fakeAkizukiSite.ts';
import { readHtmlFixture } from '../helpers/fixtures.ts';

const fixedClock = (() => {
  let t = Date.parse('2026-09-07T00:00:00.000Z');
  return () => new Date((t += 60_000));
})();

const c = (slug: string) => ({ kind: 'c' as const, slug });
const SITEMAP_REQUESTS = [FAKE_SITEMAP_INDEX, FAKE_SITEMAP_PART];

describe('Akizuki crawl against a fake site', () => {
  it('discovers listings from the sitemap, deduplicates and produces an importable snapshot', async () => {
    const s = site();
    const kits = Array.from({ length: 25 }, (_, i) => syntheticItem(i + 1));
    // The second listing shares 5 products with the first, one of them with a differing quantity only.
    const shared = kits.slice(0, 5).map((k, i) => (i === 0 ? { ...k, availableQuantity: 1 } : k));
    const sensors = [...shared, ...Array.from({ length: 7 }, (_, i) => syntheticItem(100 + i, { statuses: ['在庫僅少'] }))];
    sensors.push(syntheticItem(200, { priceYen: 65400, statuses: ['販売終了'], purchasable: false, availableQuantity: null }));
    sensors.push(syntheticItem(201, { statuses: ['入荷未定'], purchasable: false, availableQuantity: null, modelNumber: null, category: null }));
    addListing(s, c('ckit'), '組立キット', kits, 10);
    addListing(s, c('csensor'), 'センサー', sensors, 10);
    const fetcher = fetcherFor(s);
    const result = await crawlAkizuki({ fetcher, baseUrl: BASE, now: fixedClock });
    const snap = result.snapshot;

    // The sitemap is read first; listings are then walked in sitemap order.
    expect(s.log).toEqual([
      ...SITEMAP_REQUESTS,
      `${BASE}/catalog/c/ckit/`,
      `${BASE}/catalog/c/ckit_p2/`,
      `${BASE}/catalog/c/ckit_p3/`,
      `${BASE}/catalog/c/csensor/`,
      `${BASE}/catalog/c/csensor_p2/`,
    ]);
    expect(snap.complete).toBe(true);
    expect(snap.schemaVersion).toBe(3);
    expect(snap.source).toBe(`${BASE}/catalog/`);
    expect(snap.retrievedAt).toBe(result.finishedAt);
    expect(Date.parse(result.finishedAt)).toBeGreaterThan(Date.parse(result.startedAt));
    expect(snap.listingCount).toBe(2);
    expect(snap.occurrenceTotal).toBe(25 + 14);
    expect(snap.extractedTotal).toBe(25 + 9);
    expect(snap.catalog).toEqual({
      sitemapUrl: FAKE_SITEMAP_INDEX,
      sitemapLastModified: '2026-09-01T00:00:00+09:00',
      productTotal: 34,
      listingTotal: 2,
      listingsCrawled: 2,
      covered: 34,
      uncovered: 0,
      uncoveredSample: [],
      unlisted: 0,
    });
    expect(snap.deduplication).toEqual({ enabled: true, primaryKey: 'salesCode', fallbackKey: 'canonical product URL', uniqueKeyTotal: 34, duplicatesDetected: 5, duplicatesRemoved: 5 });
    expect(snap.dataQuality).toEqual({ missingSalesCode: 0, missingModelNumber: 1, missingName: 0 });
    expect(snap.requests).toEqual({ logicalPages: 7, httpAttemptsIncludingRetries: 7, successfulResponses: 7, intervalMs: 0 });
    expect(snap.validation).toEqual({ listingMismatches: 0, errors: [], warnings: [] });
    expect(snap.listings).toEqual([
      { kind: 'c', slug: 'ckit', name: '組立キット', url: `${BASE}/catalog/c/ckit/`, listedTotal: 25, truncated: false, totalPages: 3, successfulPages: 3, failedPages: 0, extractedOccurrences: 25, matchesListedTotal: true },
      { kind: 'c', slug: 'csensor', name: 'センサー', url: `${BASE}/catalog/c/csensor/`, listedTotal: 14, truncated: false, totalPages: 2, successfulPages: 2, failedPages: 0, extractedOccurrences: 14, matchesListedTotal: true },
    ]);

    const first = snap.items.find((i) => i.salesCode === '100001')!;
    expect(first).toEqual({
      salesCode: '100001',
      modelNumber: 'SYN-1',
      name: 'Synthetic part 1 & co',
      category: 'Category(1)',
      url: 'https://akizukidenshi.com/catalog/g/g100001/',
      prices: [{ amountYen: 110, display: '￥110(税込)', quantityUnit: '1個', taxIncluded: true }],
      stock: { status: '在庫あり', availableQuantity: 51, quantityUnit: '個', quantityDisplay: '51個', purchasable: true },
      sourceListings: [
        { name: '組立キット', url: `${BASE}/catalog/c/ckit/` },
        { name: 'センサー', url: `${BASE}/catalog/c/csensor/` },
      ],
      sourcePage: 1,
      positionOnPage: 1,
      duplicateOccurrences: 1,
    });
    const item13 = snap.items.find((i) => i.salesCode === '100013')!;
    expect([item13.sourcePage, item13.positionOnPage, item13.duplicateOccurrences]).toEqual([2, 3, 0]);
    const ended = snap.items.find((i) => i.salesCode === '100200')!;
    expect(ended.prices).toEqual([{ amountYen: 65400, display: '￥65,400(税込)', quantityUnit: '1個', taxIncluded: true }]);
    expect(ended.stock).toEqual({ status: '販売終了', availableQuantity: null, quantityUnit: null, quantityDisplay: null, purchasable: false });

    // The adapter accepts the crawler output as-is and the normalized identity is the sales code.
    const validation = akizukiSnapshotAdapter.validateRaw(snap);
    expect(validation.errors).toEqual([]);
    const normalized = akizukiSnapshotAdapter.normalize(snap, 'deadbeef');
    expect(normalized.products).toHaveLength(34);
    expect(normalized.coverageId).toBe('sitemap:c');
    expect(normalized.observedAt).toBe(snap.retrievedAt);
  });

  it('fails closed when a catalogue product appears in no listing', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', [syntheticItem(1)], 10);
    // 131975 is in the sitemap but in none of the crawled listings — the exact
    // shape of the defect that made the panel show "no records" for it.
    addOrphanProduct(s, '131975');
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.catalog).toMatchObject({ productTotal: 2, covered: 1, uncovered: 1, uncoveredSample: ['131975'] });
    expect(snapshot.validation.errors).toEqual(['1 sitemap product(s) appear in no listing (allowed 0), e.g. 131975']);
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).errors.map((e) => e.code)).toEqual(expect.arrayContaining(['raw.incomplete', 'raw.collector_errors']));
  });

  it('tolerates a configured number of uncovered products, reporting them as warnings', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', [syntheticItem(1)], 10);
    addOrphanProduct(s, '131975');
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE, maxUncoveredProducts: 1 });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.validation.errors).toEqual([]);
    expect(snapshot.validation.warnings).toEqual(['1 sitemap product(s) appear in no listing: 131975']);
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).warnings.map((w) => w.code)).toContain('raw.catalog_gap');
  });

  it('walks a category that only links to its children without counting it as a failure', async () => {
    const s = site();
    addIndexCategory(s, 'ckeyboard', 'キーボード', ['ckeytop', 'ckeysw']);
    addListing(s, c('ckeytop'), 'キートップ', [syntheticItem(1)], 10);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.listings[0]).toMatchObject({ slug: 'ckeyboard', name: 'キーボード', listedTotal: 0, totalPages: 1, successfulPages: 1, extractedOccurrences: 0, matchesListedTotal: true });
    expect(snapshot.extractedTotal).toBe(1);
  });

  it('accepts a listing the site truncates at its 3,000-result limit', async () => {
    const s = site();
    // The site claims 4,000 items but only ever pages through 3,000.
    const items = Array.from({ length: 30 }, (_, i) => syntheticItem(i + 1));
    addListing(s, c('c0'), '全商品', items, 10, 4000);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
    // The counter is unusable once the cap is reached, so the count check is
    // skipped rather than failed; the sitemap coverage check is what decides
    // whether the products it could not show were found elsewhere.
    expect(snapshot.listings[0]).toMatchObject({ listedTotal: 4000, truncated: true, extractedOccurrences: 30, matchesListedTotal: true });
    expect(snapshot.validation.listingMismatches).toBe(0);
    expect(snapshot.complete).toBe(true);
  });

  it('treats a counter that saturates at the cap as truncated', async () => {
    // `/catalog/c/c0/` ("仕様からさがす") announces exactly 3,000 while serving
    // about 7,900 items over 50 pages of 180. Comparing against the announced
    // 3,000 would mark the real catalogue's largest listing broken every day.
    const s = site();
    const items = Array.from({ length: 30 }, (_, i) => syntheticItem(i + 1));
    addListing(s, c('c0'), '仕様からさがす', items, 10, 3000);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
    expect(snapshot.listings[0]).toMatchObject({ listedTotal: 3000, truncated: true, matchesListedTotal: true });
    expect(snapshot.complete).toBe(true);
  });

  it('warns when the same sales code is listed differently in two listings', async () => {
    const s = site();
    const a = syntheticItem(1);
    addListing(s, c('ckit'), 'A', [a], 10);
    addListing(s, c('cled'), 'B', [{ ...a, priceYen: 999 }], 10);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.validation.warnings).toEqual(['100001: listing differs between listings (￥110(税込) "在庫あり" vs ￥999(税込) "在庫あり")']);
    // First occurrence wins; the warning is kept for the run summary.
    expect(snapshot.items[0]!.prices[0]!.amountYen).toBe(110);
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).warnings.map((w) => w.code)).toContain('raw.collector_warning');
  });

  it('prefers the product-card reading over the spec-table one for the same product', async () => {
    // The spec table states no cart and no stock quantity. Whichever listing
    // the crawl reaches first must not decide whether the product gets an
    // inventory series, so the card reading wins in either order.
    for (const tableFirst of [true, false]) {
      const s = site();
      const a = syntheticItem(1);
      const table = () => addListing(s, c('cheatsink'), 'Table', [a], 10, 1, 'table');
      const cards = () => addListing(s, c('cled'), 'Cards', [a], 10);
      if (tableFirst) {
        table();
        cards();
      } else {
        cards();
        table();
      }
      const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
      expect(snapshot.complete).toBe(true);
      expect(snapshot.items).toHaveLength(1);
      const item = snapshot.items[0]!;
      expect(item.stock.purchasable).toBe(true);
      expect(item.stock.availableQuantity).toBe(51);
      expect(item.sourceListings).toHaveLength(2);
      expect(item.duplicateOccurrences).toBe(1);
      // The table prints "￥N～" for the same price the card prints as "￥N".
      // The kept reading is the card's, and the wording difference is not a
      // disagreement — treating it as one warned about 221 real products.
      expect(item.prices[0]!.display).toBe('￥110(税込)');
      expect(snapshot.validation.warnings).toEqual([]);
    }
  });

  it('keeps an item without a price block and reports it as a warning', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', [syntheticItem(1, { priceYen: null })], 10);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.items[0]!.prices).toEqual([]);
    expect(snapshot.validation.warnings).toEqual(['c/ckit page 1: item 1 (100001): no price block']);
    // Every real listing carries a price (even discontinued ones), so the adapter treats a missing one as a markup change and refuses the run.
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).errors.map((e) => e.code)).toEqual(['item.prices']);
  });

  it('retries a flaky page and still completes', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', Array.from({ length: 12 }, (_, i) => syntheticItem(i)), 10);
    s.failures.set(`${BASE}/catalog/c/ckit_p2/`, 2);
    const fetcher = fetcherFor(s);
    const { snapshot } = await crawlAkizuki({ fetcher, baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.requests).toEqual({ logicalPages: 4, httpAttemptsIncludingRetries: 6, successfulResponses: 4, intervalMs: 0 });
  });

  it('marks the snapshot incomplete when a page keeps failing, without dropping the other pages', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', Array.from({ length: 25 }, (_, i) => syntheticItem(i)), 10);
    addListing(s, c('cled'), 'B', [syntheticItem(500)], 10);
    s.failures.set(`${BASE}/catalog/c/ckit_p2/`, 99);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s, { maxAttempts: 2 }), baseUrl: BASE, maxUncoveredProducts: 10 });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.listings[0]).toMatchObject({ successfulPages: 2, failedPages: 1, extractedOccurrences: 15, listedTotal: 25, matchesListedTotal: false });
    expect(snapshot.listings[1]).toMatchObject({ successfulPages: 1, failedPages: 0, matchesListedTotal: true });
    expect(snapshot.validation.listingMismatches).toBe(1);
    expect(snapshot.validation.errors).toEqual([`c/ckit page 2: GET ${BASE}/catalog/c/ckit_p2/ failed after 2 attempts: HTTP 503`]);
    expect(snapshot.extractedTotal).toBe(16);
    const v = akizukiSnapshotAdapter.validateRaw(snapshot);
    expect(v.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['raw.incomplete', 'raw.collector_errors', 'raw.listing_mismatch', 'raw.listing_failed_pages', 'raw.listing_total_mismatch']),
    );
  });

  it('flags a listing whose counter disagrees with the extracted occurrences', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', Array.from({ length: 8 }, (_, i) => syntheticItem(i)), 10, 9);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.listings[0]).toMatchObject({ listedTotal: 9, extractedOccurrences: 8, matchesListedTotal: false });
    expect(snapshot.validation.listingMismatches).toBe(1);
    expect(snapshot.validation.errors).toEqual([]);
  });

  it('treats the maintenance page as a transient failure and gives up politely', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', [syntheticItem(1)], 10);
    s.pages.set(`${BASE}/catalog/c/ckit/`, MAINTENANCE_PAGE);
    const fetcher = fetcherFor(s, { maxAttempts: 3 });
    const { snapshot } = await crawlAkizuki({ fetcher, baseUrl: BASE, maxUncoveredProducts: 1 });
    expect(snapshot.complete).toBe(false);
    // Two sitemap reads plus three attempts at the one listing page.
    expect(fetcher.stats.httpAttempts).toBe(5);
    expect(snapshot.validation.errors[0]).toMatch(/c\/ckit page 1: .*transient body/);
    expect(snapshot.items).toEqual([]);
  });

  it('rejects a page that is not the page it asked for', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', Array.from({ length: 12 }, (_, i) => syntheticItem(i)), 10);
    // Page 2 URL serves page 1 again (a redirect-to-first-page failure mode).
    s.pages.set(`${BASE}/catalog/c/ckit_p2/`, s.pages.get(`${BASE}/catalog/c/ckit/`)!);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE, maxUncoveredProducts: 2 });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.validation.errors).toEqual(['c/ckit page 2: server returned page 1']);
    expect(snapshot.extractedTotal).toBe(10);
  });

  it('refuses a listing that announces more pages than the cap, and a duplicated listing', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', Array.from({ length: 30 }, (_, i) => syntheticItem(i)), 10);
    const fetcher = fetcherFor(s);
    const { snapshot } = await crawlAkizuki({ fetcher, baseUrl: BASE, listings: [c('ckit'), c('ckit')], maxPagesPerListing: 2, maxUncoveredProducts: 30 });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.validation.errors).toEqual(['c/ckit: 3 pages exceed the cap of 2', 'listing c/ckit configured twice']);
    expect(fetcher.stats.httpAttempts).toBe(3);
  });

  it('propagates an exhausted request budget instead of publishing a partial catalogue', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', Array.from({ length: 30 }, (_, i) => syntheticItem(i)), 10);
    await expect(crawlAkizuki({ fetcher: fetcherFor(s, { maxRequests: 3 }), baseUrl: BASE })).rejects.toBeInstanceOf(RequestBudgetExceededError);
  });

  it('fails the whole run when the sitemap cannot be read', async () => {
    const s = site();
    addListing(s, c('ckit'), 'A', [syntheticItem(1)], 10);
    s.sitemapMissing = true;
    await expect(crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE })).rejects.toThrow(/Sitemap_index/);
  });

  it('parses the recorded real pages when served by the fake site', async () => {
    const s = site();
    const ref = { kind: 'r' as const, slug: 'rsbcomp1' };
    s.listings.push(ref);
    const fixture = await readHtmlFixture('rsbcomp1');
    s.pages.set(`${BASE}/catalog/r/rsbcomp1/`, fixture);
    // Page 2 of the real genre was not recorded; serve a synthetic page with the remaining 16 items.
    const rest = Array.from({ length: 16 }, (_, i) => syntheticItem(900 + i));
    s.pages.set(
      `${BASE}/catalog/r/rsbcomp1_p2/`,
      renderListingPage({ kind: 'r', slug: 'rsbcomp1', name: 'シングルボードコンピューター本体', listedTotal: 76, currentPage: 2, lastPage: 2, items: rest }),
    );
    // The sitemap must know the same products the pages show.
    for (const item of parseAkizukiListingPage(fixture).items) s.products.add(item.salesCode);
    for (const item of rest) s.products.add(item.salesCode);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE, listingKinds: ['r'] });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.extractedTotal).toBe(76);
    expect(snapshot.listings[0]!.name).toBe('シングルボードコンピューター本体');
    expect(akizukiSnapshotAdapter.normalize(snapshot, 'deadbeef').coverageId).toBe('sitemap:r');
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).errors).toEqual([]);
  });
});
