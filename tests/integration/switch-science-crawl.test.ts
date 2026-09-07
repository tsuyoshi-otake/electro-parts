import { describe, expect, it } from 'vitest';
import { switchScienceSnapshotAdapter } from '../../src/adapters/switch-science/snapshotAdapter.ts';
import { switchScienceCollector, parseSwitchScienceCollectorConfig } from '../../src/collectors/switch-science/collector.ts';
import { crawlSwitchScience, walkCatalog } from '../../src/collectors/switch-science/crawl.ts';
import { addProducts, fakeShop, fetcherFor, shopifyProduct, transportFor, FAKE_BASE, FAKE_SITEMAP_INDEX, type FakeShop } from '../helpers/fakeShopifySite.ts';

const fixedClock = (() => {
  let t = Date.parse('2026-09-07T00:00:00.000Z');
  return () => new Date((t += 60_000));
})();

const crawl = (shop: FakeShop, options: Partial<Parameters<typeof crawlSwitchScience>[0]> = {}) =>
  crawlSwitchScience({ fetcher: fetcherFor(shop), baseUrl: FAKE_BASE, pageLimit: 10, now: fixedClock, ...options });

const apiPage = (page: number, limit = 10): string => `${FAKE_BASE}/collections/all/products.json?limit=${limit}&page=${page}`;

describe('Switch Science crawl against a fake Shopify storefront', () => {
  it('reads the sitemap first, then walks the collection until a page comes back short', async () => {
    const shop = fakeShop();
    addProducts(shop, 25);
    const result = await crawl(shop);
    const snap = result.snapshot;

    expect(shop.log).toEqual([
      FAKE_SITEMAP_INDEX,
      `${FAKE_BASE}/sitemap_products_1.xml?from=100&to=199`,
      apiPage(1),
      apiPage(2),
      apiPage(3),
    ]);
    expect(snap.complete).toBe(true);
    expect(snap.extractedTotal).toBe(25);
    expect(snap.pageCount).toBe(3);
    expect(snap.collection).toBe('all');
    expect(snap.catalog).toMatchObject({ productTotal: 25, covered: 25, uncovered: 0, unlisted: 0, sitemapPages: 1 });
    expect(snap.validation).toEqual({ errors: [], warnings: [] });
    expect(snap.items.map((i) => i.handle)).toEqual(shop.products.map((p) => p.handle));
    expect(snap.requests).toMatchObject({ logicalPages: 5, httpAttemptsIncludingRetries: 5, successfulResponses: 5 });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('produces a snapshot the adapter accepts and normalizes', async () => {
    const shop = fakeShop();
    addProducts(shop, 12);
    const snap = (await crawl(shop)).snapshot;
    const validation = switchScienceSnapshotAdapter.validateRaw(snap);
    expect(validation.errors).toEqual([]);
    const normalized = switchScienceSnapshotAdapter.normalize(snap, 'f'.repeat(64));
    expect(normalized.products).toHaveLength(12);
    expect(normalized.storeId).toBe('switch-science');
    expect(normalized.coverageId).toBe('shopify:collections/all');
    expect(normalized.observedAt).toBe(snap.retrievedAt);
  });

  it('needs one more page when the catalogue is an exact multiple of the page size', async () => {
    const shop = fakeShop();
    addProducts(shop, 20);
    const snap = (await crawl(shop)).snapshot;
    expect(shop.log.filter((u) => u.includes('products.json'))).toEqual([apiPage(1), apiPage(2), apiPage(3)]);
    expect(snap.pageCount).toBe(3);
    expect(snap.extractedTotal).toBe(20);
    expect(snap.complete).toBe(true);
  });

  it('keeps the first occurrence of a product served on two pages and counts the repeat', async () => {
    const shop = fakeShop();
    addProducts(shop, 12);
    // Page 2 repeats the first product of page 1, as a shifting sort would.
    shop.products.splice(10, 0, shop.products[0]!);
    const snap = (await crawl(shop)).snapshot;
    expect(snap.extractedTotal).toBe(12);
    expect(snap.deduplication).toMatchObject({ duplicatesDetected: 1, duplicatesRemoved: 1, uniqueKeyTotal: 12 });
    expect(snap.items.find((i) => i.handle === '1001')?.duplicateOccurrences).toBe(2);
    expect(snap.validation.warnings).toContain('1 product(s) appeared on more than one page');
    expect(snap.complete).toBe(true);
  });

  it('fails closed when the collection returns fewer products than the sitemap lists', async () => {
    const shop = fakeShop({ sitemapOnly: ['4001', '4002', '4003'] });
    addProducts(shop, 5);
    const snap = (await crawl(shop)).snapshot;
    expect(snap.catalog).toMatchObject({ productTotal: 8, covered: 5, uncovered: 3, uncoveredSample: ['4001', '4002', '4003'] });
    expect(snap.complete).toBe(false);
    expect(snap.validation.errors[0]).toMatch(/3 sitemap product\(s\) were not returned by the collection \(allowed 0\)/);
  });

  it('accepts a gap the operator allowed, as a warning', async () => {
    const shop = fakeShop({ sitemapOnly: ['4001', '4002'] });
    addProducts(shop, 5);
    const snap = (await crawl(shop, { maxUncoveredProducts: 2 })).snapshot;
    expect(snap.complete).toBe(true);
    expect(snap.validation.errors).toEqual([]);
    expect(snap.validation.warnings).toContain('2 sitemap product(s) were not returned by the collection: 4001, 4002');
  });

  it('treats a product the sitemap has not caught up with as ordinary lag', async () => {
    const shop = fakeShop({ apiOnly: new Set(['1003']) });
    addProducts(shop, 5);
    const snap = (await crawl(shop)).snapshot;
    expect(snap.catalog).toMatchObject({ productTotal: 4, covered: 4, uncovered: 0, unlisted: 1 });
    expect(snap.complete).toBe(true);
    expect(snap.validation.warnings).toContain('1 product(s) are in the collection but not in the sitemap yet');
  });

  it('stops at a failing page and marks the snapshot incomplete rather than reporting a short catalogue', async () => {
    const shop = fakeShop();
    addProducts(shop, 25);
    shop.failures.set(apiPage(2), 9);
    const snap = (await crawl(shop, { fetcher: fetcherFor(shop, { maxAttempts: 2 }) })).snapshot;
    expect(snap.complete).toBe(false);
    expect(snap.pageCount).toBe(1);
    expect(snap.extractedTotal).toBe(10);
    expect(snap.validation.errors[0]).toMatch(/^page 2: /);
    expect(shop.log).not.toContain(apiPage(3));
  });

  it('stops at a page whose shape drifted: past it every count would be a guess', async () => {
    const shop = fakeShop();
    addProducts(shop, 25);
    shop.bodyOverrides.set(apiPage(2), '{"items":[]}');
    const snap = (await crawl(shop)).snapshot;
    expect(snap.complete).toBe(false);
    expect(snap.validation.errors[0]).toBe('page 2: "products" is missing or not an array');

    const broken = fakeShop();
    addProducts(broken, 25);
    broken.bodyOverrides.set(apiPage(2), '{"products": [');
    const snap2 = (await crawl(broken)).snapshot;
    expect(snap2.complete).toBe(false);
    expect(snap2.validation.errors[0]).toMatch(/^page 2: /);
  });

  it('has no oracle to check itself against when the sitemap cannot be read, so it does not run', async () => {
    const shop = fakeShop({ sitemapMissing: true });
    addProducts(shop, 5);
    await expect(crawl(shop)).rejects.toThrow(/HTTP 404/);
    expect(shop.log.filter((u) => u.includes('products.json'))).toEqual([]);
  });

  it('stops inside the request budget instead of running away', async () => {
    const shop = fakeShop();
    addProducts(shop, 100);
    const snap = (await crawl(shop, { fetcher: fetcherFor(shop, { maxRequests: 5 }) })).snapshot;
    expect(snap.complete).toBe(false);
    expect(snap.validation.errors[0]).toMatch(/^page 4: request budget of 5 HTTP attempts exhausted$/);
  });

  it('stops at the page cap and says the catalogue is bigger than configured', async () => {
    const shop = fakeShop();
    addProducts(shop, 100);
    const walk = await walkCatalog({ fetcher: fetcherFor(shop), baseUrl: FAKE_BASE, collection: 'all', pageLimit: 10, maxPages: 2 });
    expect(walk.items).toHaveLength(20);
    expect(walk.errors).toEqual(['page cap of 2 reached with a full page; the catalogue is larger than configured']);
  });

  it('reports what the data looked like, so a quality change is visible in the run summary', async () => {
    const shop = fakeShop();
    addProducts(shop, 4);
    shop.products.push(
      shopifyProduct(5, { handle: 'Uppercase' }),
      shopifyProduct(6, { variants: [{ ...shopifyProduct(6).variants[0]!, sku: null, price: 'ask', available: false }] }),
    );
    shop.apiOnly.add('Uppercase');
    const snap = (await crawl(shop)).snapshot;
    expect(snap.dataQuality).toMatchObject({
      unsupportedHandle: 1,
      unsupportedHandleSample: ['Uppercase'],
      missingSku: 1,
      unparsablePrice: 1,
      multiVariant: 0,
      unavailable: 1,
    });
    expect(snap.validation.warnings).toContain('1 product(s) dropped for an unusable handle: Uppercase');
  });
});

describe('switchScienceCollector', () => {
  it('rejects a config that would make the run impolite or unattributable', () => {
    const base = { userAgent: 'electro-parts-price-history/0.1 (+https://example.test; research)' };
    expect(() => parseSwitchScienceCollectorConfig({})).toThrow(/userAgent/);
    expect(() => parseSwitchScienceCollectorConfig({ userAgent: 'bot' })).toThrow(/userAgent/);
    expect(() => parseSwitchScienceCollectorConfig({ ...base, baseUrl: 'https://shop.test/collections' })).toThrow(/origin without a path/);
    expect(() => parseSwitchScienceCollectorConfig({ ...base, collection: 'All Products' })).toThrow(/collection handle/);
    expect(() => parseSwitchScienceCollectorConfig({ ...base, minIntervalMs: 100 })).toThrow(/minIntervalMs/);
    expect(() => parseSwitchScienceCollectorConfig({ ...base, pageLimit: 500 })).toThrow(/pageLimit/);
    expect(() => parseSwitchScienceCollectorConfig({ ...base, maxUncoveredProducts: -1 })).toThrow(/maxUncoveredProducts/);
  });

  it('defaults to the whole catalogue at the maximum page size the API allows', () => {
    const c = parseSwitchScienceCollectorConfig({ userAgent: 'electro-parts-price-history/0.1 (+https://example.test)' });
    expect(c).toMatchObject({
      baseUrl: 'https://www.switch-science.com',
      collection: 'all',
      pageLimit: 250,
      minIntervalMs: 1500,
      maxUncoveredProducts: 0,
    });
  });

  it('collects through the pipeline boundary and reports store-neutral metrics', async () => {
    const shop = fakeShop();
    addProducts(shop, 15);
    const logs: string[] = [];
    const outcome = await switchScienceCollector.collect(
      {
        userAgent: 'electro-parts-price-history/0.1 (+https://example.test; research)',
        baseUrl: FAKE_BASE,
        pageLimit: 10,
        minIntervalMs: 500,
        jitterMs: 0,
      },
      { log: (m) => logs.push(m), transport: transportFor(shop), sleep: async () => undefined, now: fixedClock },
    );
    expect(outcome.complete).toBe(true);
    expect(outcome.errors).toEqual([]);
    expect(outcome.retrievedAt).toMatch(/^2026-09-07T/);
    expect(outcome.metrics).toMatchObject({ catalogProducts: 15, catalogCovered: 15, catalogUncovered: 0, items: 15, catalogPages: 2 });
    expect(switchScienceSnapshotAdapter.validateRaw(outcome.raw).errors).toEqual([]);
    expect(logs.some((l) => l.startsWith('[crawl]'))).toBe(true);
  });
});
