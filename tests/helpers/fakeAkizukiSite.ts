/**
 * In-memory stand-in for akizukidenshi.com: a gzipped XML sitemap, listing
 * pages rendered from synthetic items, optional transient failures per URL,
 * and a request log. Used by the crawl and pipeline integration tests.
 *
 * The sitemap is generated from whatever the test registered, so a crawl
 * against this site exercises the real discovery path — including the coverage
 * check that compares the crawl against the sitemap's product set.
 */
import { gzipSync } from 'node:zlib';
import { isAkizukiMaintenancePage } from '../../src/collectors/akizuki/listingParser.ts';
import { akizukiListingUrl, type ListingRef } from '../../src/collectors/akizuki/listings.ts';
import { PoliteFetcher, type HttpTransport } from '../../src/collectors/politeFetcher.ts';
import { renderIndexOnlyPage, renderListingPage, type SyntheticLayout, type SyntheticListing, type SyntheticPage } from './akizukiHtml.ts';

export const FAKE_BASE = 'https://akizuki.test';
export const FAKE_SITEMAP_INDEX = `${FAKE_BASE}/Sitemap_index.xml`;
export const FAKE_SITEMAP_PART = `${FAKE_BASE}/Sitemap_1.xml.gz`;

/** Transport bodies are bytes; the fetcher does the decoding. */
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export interface FakeSite {
  pages: Map<string, string | (() => string)>;
  /** URL → remaining failures before the page is served. */
  failures: Map<string, number>;
  log: string[];
  /** Product sales codes the sitemap advertises. */
  products: Set<string>;
  /** Listings the sitemap advertises, in registration order. */
  listings: ListingRef[];
  /** Set to drop the sitemap entirely (to test the failure path). */
  sitemapMissing: boolean;
}

export function fakeSite(): FakeSite {
  return { pages: new Map(), failures: new Map(), log: [], products: new Set(), listings: [], sitemapMissing: false };
}

/** Clears the shop so a test can register the next day's catalogue from scratch. */
export function resetSite(s: FakeSite): void {
  s.pages.clear();
  s.listings.length = 0;
  s.products.clear();
}

/** Registers a paged listing and the products it shows. */
export function addListing(
  s: FakeSite,
  ref: ListingRef,
  name: string,
  items: SyntheticListing[],
  perPage: number,
  listedTotal = items.length,
  layout: SyntheticLayout = 'cards',
): void {
  s.listings.push(ref);
  for (const it of items) s.products.add(it.salesCode);
  const lastPage = Math.max(1, Math.ceil(items.length / perPage));
  for (let page = 1; page <= lastPage; page++) {
    const p: SyntheticPage = {
      kind: ref.kind,
      layout,
      slug: ref.slug,
      name,
      listedTotal,
      currentPage: page,
      lastPage,
      items: items.slice((page - 1) * perPage, page * perPage),
    };
    s.pages.set(akizukiListingUrl(FAKE_BASE, ref, page), renderListingPage(p));
  }
}

/** Registers a category that only links to its children — no counter, no products. */
export function addIndexCategory(s: FakeSite, slug: string, name: string, children: readonly string[] = []): void {
  const ref: ListingRef = { kind: 'c', slug };
  s.listings.push(ref);
  s.pages.set(akizukiListingUrl(FAKE_BASE, ref), renderIndexOnlyPage(slug, name, children));
}

/** Adds a product to the sitemap without putting it in any listing (a coverage gap). */
export function addOrphanProduct(s: FakeSite, salesCode: string): void {
  s.products.add(salesCode);
}

function sitemapIndexXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>${FAKE_SITEMAP_PART}</loc><lastmod>2026-09-01T00:00:00+09:00</lastmod></sitemap>
</sitemapindex>`;
}

function sitemapPartXml(s: FakeSite): string {
  const locs = [
    ...[...s.products].sort().map((code) => `${FAKE_BASE}/catalog/g/g${code}/`),
    ...s.listings.map((ref) => akizukiListingUrl(FAKE_BASE, ref)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('\n')}
</urlset>`;
}

export function transportFor(s: FakeSite): HttpTransport {
  return async (url) => {
    s.log.push(url);
    const remaining = s.failures.get(url) ?? 0;
    if (remaining > 0) {
      s.failures.set(url, remaining - 1);
      return { status: 503, header: () => null, bytes: async () => utf8('busy') };
    }
    if (url === FAKE_SITEMAP_INDEX || url === FAKE_SITEMAP_PART) {
      if (s.sitemapMissing) return { status: 404, header: () => null, bytes: async () => utf8('missing') };
      const body = url === FAKE_SITEMAP_INDEX ? utf8(sitemapIndexXml()) : new Uint8Array(gzipSync(Buffer.from(sitemapPartXml(s), 'utf8')));
      return { status: 200, header: () => null, bytes: async () => body };
    }
    const page = s.pages.get(url);
    if (page === undefined) return { status: 404, header: () => null, bytes: async () => utf8('missing') };
    return { status: 200, header: () => null, bytes: async () => utf8(typeof page === 'function' ? page() : page) };
  };
}

export function fetcherFor(s: FakeSite, overrides: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}): PoliteFetcher {
  return new PoliteFetcher({
    userAgent: 'test',
    transport: transportFor(s),
    minIntervalMs: 0,
    jitterMs: 0,
    backoffBaseMs: 0,
    sleep: async () => undefined,
    isTransientBody: (_s, body) => isAkizukiMaintenancePage(body),
    ...overrides,
  });
}
