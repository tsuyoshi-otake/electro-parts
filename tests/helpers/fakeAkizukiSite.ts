/**
 * In-memory stand-in for akizukidenshi.com: genre listing pages rendered
 * from synthetic items, optional transient failures per URL, and a request
 * log. Used by the crawl and pipeline integration tests.
 */
import { isAkizukiMaintenancePage } from '../../src/collectors/akizuki/listingParser.ts';
import { PoliteFetcher, type HttpTransport } from '../../src/collectors/politeFetcher.ts';
import { renderListingPage, type SyntheticListing, type SyntheticPage } from './akizukiHtml.ts';

export const FAKE_BASE = 'https://akizuki.test';

export interface FakeSite {
  pages: Map<string, string | (() => string)>;
  /** URL → remaining failures before the page is served. */
  failures: Map<string, number>;
  log: string[];
}

export function fakeSite(): FakeSite {
  return { pages: new Map(), failures: new Map(), log: [] };
}

export function addGenre(s: FakeSite, slug: string, name: string, items: SyntheticListing[], perPage: number, listedTotal = items.length): void {
  const lastPage = Math.max(1, Math.ceil(items.length / perPage));
  for (let page = 1; page <= lastPage; page++) {
    const p: SyntheticPage = { genreSlug: slug, genreName: name, listedTotal, currentPage: page, lastPage, items: items.slice((page - 1) * perPage, page * perPage) };
    s.pages.set(page === 1 ? `${FAKE_BASE}/catalog/r/${slug}/` : `${FAKE_BASE}/catalog/r/${slug}_p${page}/`, renderListingPage(p));
  }
}

export function transportFor(s: FakeSite): HttpTransport {
  return async (url) => {
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
