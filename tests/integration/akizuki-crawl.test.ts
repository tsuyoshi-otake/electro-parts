import { describe, expect, it } from 'vitest';
import { akizukiSnapshotAdapter } from '../../src/adapters/akizuki/snapshotAdapter.ts';
import { crawlAkizuki } from '../../src/collectors/akizuki/crawl.ts';
import { isAkizukiMaintenancePage } from '../../src/collectors/akizuki/listingParser.ts';
import { PoliteFetcher, RequestBudgetExceededError, type HttpTransport } from '../../src/collectors/politeFetcher.ts';
import { MAINTENANCE_PAGE, renderListingPage, syntheticItem, type SyntheticListing, type SyntheticPage } from '../helpers/akizukiHtml.ts';
import { readHtmlFixture } from '../helpers/fixtures.ts';

const BASE = 'https://akizuki.test';

interface FakeSite {
  pages: Map<string, string | (() => string)>;
  /** URL → remaining failures before the page is served. */
  failures: Map<string, number>;
  log: string[];
}

function site(): FakeSite {
  return { pages: new Map(), failures: new Map(), log: [] };
}

function addGenre(s: FakeSite, slug: string, name: string, items: SyntheticListing[], perPage: number, listedTotal = items.length): void {
  const lastPage = Math.max(1, Math.ceil(items.length / perPage));
  for (let page = 1; page <= lastPage; page++) {
    const p: SyntheticPage = { genreSlug: slug, genreName: name, listedTotal, currentPage: page, lastPage, items: items.slice((page - 1) * perPage, page * perPage) };
    s.pages.set(page === 1 ? `${BASE}/catalog/r/${slug}/` : `${BASE}/catalog/r/${slug}_p${page}/`, renderListingPage(p));
  }
}

function fetcherFor(s: FakeSite, overrides: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}): PoliteFetcher {
  const transport: HttpTransport = async (url) => {
    s.log.push(url);
    const remaining = s.failures.get(url) ?? 0;
    if (remaining > 0) {
      s.failures.set(url, remaining - 1);
      return { status: 503, header: () => null, text: async () => 'busy' };
    }
    const page = s.pages.get(url);
    if (page === undefined) return { status: 404, header: () => null, text: async () => 'missing' };
    return { status: 200, header: () => null, text: async () => (typeof page === 'function' ? page() : page) };
  };
  return new PoliteFetcher({
    userAgent: 'test',
    transport,
    minIntervalMs: 0,
    jitterMs: 0,
    backoffBaseMs: 0,
    sleep: async () => undefined,
    isTransientBody: (_s, body) => isAkizukiMaintenancePage(body),
    ...overrides,
  });
}

const fixedClock = (() => {
  let t = Date.parse('2026-09-07T00:00:00.000Z');
  return () => new Date((t += 60_000));
})();

describe('Akizuki crawl against a fake site', () => {
  it('walks every page, deduplicates across genres and produces an importable snapshot', async () => {
    const s = site();
    const kits = Array.from({ length: 25 }, (_, i) => syntheticItem(i + 1));
    // The second genre shares 5 products with the first, one of them with a differing quantity only.
    const shared = kits.slice(0, 5).map((k, i) => (i === 0 ? { ...k, availableQuantity: 1 } : k));
    const sensors = [...shared, ...Array.from({ length: 7 }, (_, i) => syntheticItem(100 + i, { statuses: ['在庫僅少'] }))];
    sensors.push(syntheticItem(200, { priceYen: 65400, statuses: ['販売終了'], purchasable: false, availableQuantity: null }));
    sensors.push(syntheticItem(201, { statuses: ['入荷未定'], purchasable: false, availableQuantity: null, modelNumber: null, category: null }));
    addGenre(s, 'rkit', '組立キット', kits, 10);
    addGenre(s, 'rsensor', 'センサー', sensors, 10);
    const fetcher = fetcherFor(s);
    const result = await crawlAkizuki({ fetcher, genres: ['rkit', 'rsensor'], baseUrl: BASE, now: fixedClock });
    const snap = result.snapshot;

    expect(s.log).toEqual([
      `${BASE}/catalog/r/rkit/`,
      `${BASE}/catalog/r/rkit_p2/`,
      `${BASE}/catalog/r/rkit_p3/`,
      `${BASE}/catalog/r/rsensor/`,
      `${BASE}/catalog/r/rsensor_p2/`,
    ]);
    expect(snap.complete).toBe(true);
    expect(snap.schemaVersion).toBe(2);
    expect(snap.source).toBe(`${BASE}/catalog/r/`);
    expect(snap.retrievedAt).toBe(result.finishedAt);
    expect(Date.parse(result.finishedAt)).toBeGreaterThan(Date.parse(result.startedAt));
    expect(snap.genreCount).toBe(2);
    expect(snap.occurrenceTotal).toBe(25 + 14);
    expect(snap.extractedTotal).toBe(25 + 9);
    expect(snap.deduplication).toEqual({ enabled: true, primaryKey: 'salesCode', fallbackKey: 'canonical product URL', uniqueKeyTotal: 34, duplicatesDetected: 5, duplicatesRemoved: 5 });
    expect(snap.dataQuality).toEqual({ missingSalesCode: 0, missingModelNumber: 1, missingName: 0 });
    expect(snap.requests).toEqual({ logicalPages: 5, httpAttemptsIncludingRetries: 5, successfulResponses: 5, intervalMs: 0 });
    expect(snap.validation).toEqual({ genreMismatches: 0, errors: [], warnings: [] });
    expect(snap.genres).toEqual([
      { name: '組立キット', url: `${BASE}/catalog/r/rkit/`, listedTotal: 25, totalPages: 3, successfulPages: 3, failedPages: 0, extractedOccurrences: 25, matchesListedTotal: true },
      { name: 'センサー', url: `${BASE}/catalog/r/rsensor/`, listedTotal: 14, totalPages: 2, successfulPages: 2, failedPages: 0, extractedOccurrences: 14, matchesListedTotal: true },
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
      sourceGenres: [
        { name: '組立キット', url: `${BASE}/catalog/r/rkit/` },
        { name: 'センサー', url: `${BASE}/catalog/r/rsensor/` },
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
    expect(normalized.coverageId).toBe('rkit+rsensor');
    expect(normalized.observedAt).toBe(snap.retrievedAt);
  });

  it('warns when the same sales code is listed differently in two genres', async () => {
    const s = site();
    const a = syntheticItem(1);
    addGenre(s, 'rkit', 'A', [a], 10);
    addGenre(s, 'rled', 'B', [{ ...a, priceYen: 999 }], 10);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), genres: ['rkit', 'rled'], baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.validation.warnings).toEqual(['100001: listing differs between genres (￥110(税込) "在庫あり" vs ￥999(税込) "在庫あり")']);
    // First occurrence wins; the warning is kept for the run summary.
    expect(snapshot.items[0]!.prices[0]!.amountYen).toBe(110);
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).warnings.map((w) => w.code)).toContain('raw.collector_warning');
  });

  it('keeps an item without a price block and reports it as a warning', async () => {
    const s = site();
    addGenre(s, 'rkit', 'A', [syntheticItem(1, { priceYen: null })], 10);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), genres: ['rkit'], baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.items[0]!.prices).toEqual([]);
    expect(snapshot.validation.warnings).toEqual(['rkit page 1: item 1 (100001): no price block']);
    // Every real listing carries a price (even discontinued ones), so the adapter treats a missing one as a markup change and refuses the run.
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).errors.map((e) => e.code)).toEqual(['item.prices']);
  });

  it('retries a flaky page and still completes', async () => {
    const s = site();
    addGenre(s, 'rkit', 'A', Array.from({ length: 12 }, (_, i) => syntheticItem(i)), 10);
    s.failures.set(`${BASE}/catalog/r/rkit_p2/`, 2);
    const fetcher = fetcherFor(s);
    const { snapshot } = await crawlAkizuki({ fetcher, genres: ['rkit'], baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.requests).toEqual({ logicalPages: 2, httpAttemptsIncludingRetries: 4, successfulResponses: 2, intervalMs: 0 });
  });

  it('marks the snapshot incomplete when a page keeps failing, without dropping the other pages', async () => {
    const s = site();
    addGenre(s, 'rkit', 'A', Array.from({ length: 25 }, (_, i) => syntheticItem(i)), 10);
    addGenre(s, 'rled', 'B', [syntheticItem(500)], 10);
    s.failures.set(`${BASE}/catalog/r/rkit_p2/`, 99);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s, { maxAttempts: 2 }), genres: ['rkit', 'rled'], baseUrl: BASE });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.genres[0]).toMatchObject({ successfulPages: 2, failedPages: 1, extractedOccurrences: 15, listedTotal: 25, matchesListedTotal: false });
    expect(snapshot.genres[1]).toMatchObject({ successfulPages: 1, failedPages: 0, matchesListedTotal: true });
    expect(snapshot.validation.genreMismatches).toBe(1);
    expect(snapshot.validation.errors).toEqual([`rkit page 2: GET ${BASE}/catalog/r/rkit_p2/ failed after 2 attempts: HTTP 503`]);
    expect(snapshot.extractedTotal).toBe(16);
    const v = akizukiSnapshotAdapter.validateRaw(snapshot);
    expect(v.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['raw.incomplete', 'raw.collector_errors', 'raw.genre_mismatch', 'raw.genre_failed_pages', 'raw.genre_total_mismatch']));
  });

  it('flags a genre whose counter disagrees with the extracted occurrences', async () => {
    const s = site();
    addGenre(s, 'rkit', 'A', Array.from({ length: 8 }, (_, i) => syntheticItem(i)), 10, 9);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), genres: ['rkit'], baseUrl: BASE });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.genres[0]).toMatchObject({ listedTotal: 9, extractedOccurrences: 8, matchesListedTotal: false });
    expect(snapshot.validation.genreMismatches).toBe(1);
    expect(snapshot.validation.errors).toEqual([]);
  });

  it('treats the maintenance page as a transient failure and gives up politely', async () => {
    const s = site();
    s.pages.set(`${BASE}/catalog/r/rkit/`, MAINTENANCE_PAGE);
    const fetcher = fetcherFor(s, { maxAttempts: 3 });
    const { snapshot } = await crawlAkizuki({ fetcher, genres: ['rkit'], baseUrl: BASE });
    expect(snapshot.complete).toBe(false);
    expect(fetcher.stats.httpAttempts).toBe(3);
    expect(snapshot.validation.errors[0]).toMatch(/rkit page 1: .*transient body/);
    expect(snapshot.items).toEqual([]);
  });

  it('rejects a page that is not the page it asked for', async () => {
    const s = site();
    addGenre(s, 'rkit', 'A', Array.from({ length: 12 }, (_, i) => syntheticItem(i)), 10);
    // Page 2 URL serves page 1 again (a redirect-to-first-page failure mode).
    s.pages.set(`${BASE}/catalog/r/rkit_p2/`, s.pages.get(`${BASE}/catalog/r/rkit/`)!);
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), genres: ['rkit'], baseUrl: BASE });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.validation.errors).toEqual(['rkit page 2: server returned page 1']);
    expect(snapshot.extractedTotal).toBe(10);
  });

  it('refuses a genre that announces more pages than the cap, and a duplicated genre', async () => {
    const s = site();
    addGenre(s, 'rkit', 'A', Array.from({ length: 30 }, (_, i) => syntheticItem(i)), 10);
    const fetcher = fetcherFor(s);
    const { snapshot } = await crawlAkizuki({ fetcher, genres: ['rkit', 'rkit'], baseUrl: BASE, maxPagesPerGenre: 2 });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.validation.errors).toEqual(['rkit: 3 pages exceed the cap of 2', 'genre rkit configured twice']);
    expect(fetcher.stats.httpAttempts).toBe(1);
  });

  it('propagates an exhausted request budget instead of publishing a partial catalogue', async () => {
    const s = site();
    addGenre(s, 'rkit', 'A', Array.from({ length: 30 }, (_, i) => syntheticItem(i)), 10);
    await expect(crawlAkizuki({ fetcher: fetcherFor(s, { maxRequests: 2 }), genres: ['rkit'], baseUrl: BASE })).rejects.toBeInstanceOf(RequestBudgetExceededError);
  });

  it('parses the recorded real pages when served by the fake site', async () => {
    const s = site();
    s.pages.set(`${BASE}/catalog/r/rsbcomp1/`, await readHtmlFixture('rsbcomp1'));
    // Page 2 of the real genre was not recorded; serve a synthetic page with the remaining 16 items.
    s.pages.set(
      `${BASE}/catalog/r/rsbcomp1_p2/`,
      renderListingPage({ genreSlug: 'rsbcomp1', genreName: 'シングルボードコンピューター本体', listedTotal: 76, currentPage: 2, lastPage: 2, items: Array.from({ length: 16 }, (_, i) => syntheticItem(900 + i)) }),
    );
    const { snapshot } = await crawlAkizuki({ fetcher: fetcherFor(s), genres: ['rsbcomp1'], baseUrl: BASE });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.extractedTotal).toBe(76);
    expect(snapshot.genres[0]!.name).toBe('シングルボードコンピューター本体');
    expect(akizukiSnapshotAdapter.validateRaw(snapshot).errors).toEqual([]);
  });
});
