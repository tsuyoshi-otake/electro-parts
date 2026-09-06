import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  AKIZUKI_LISTING_PAGE_CAP,
  AKIZUKI_LISTING_RESULT_CAP,
  akizukiListingUrl,
  listingId,
  parseListingRef,
} from '../../src/collectors/akizuki/listings.ts';
import {
  collectSitemapUrls,
  decodeSitemapBody,
  fetchAkizukiSitemap,
  parseSitemapIndex,
  sitemapIndexUrl,
  SitemapError,
} from '../../src/collectors/akizuki/sitemap.ts';
import { PoliteFetcher, type HttpTransport } from '../../src/collectors/politeFetcher.ts';

const BASE = 'https://akizuki.test';

function indexXml(entries: readonly { loc: string; lastmod?: string }[]): string {
  const body = entries
    .map((e) => `<sitemap><loc>${e.loc}</loc>${e.lastmod === undefined ? '' : `<lastmod>${e.lastmod}</lastmod>`}</sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>`;
}

function urlsetXml(locs: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n${locs.map((l) => `<url><loc>${l}</loc></url>`).join('\n')}\n</urlset>`;
}

/** A fetcher over a fixed URL -> body map; bodies may be text or gzipped bytes. */
function fetcherOver(bodies: Map<string, string | Uint8Array>): PoliteFetcher {
  const transport: HttpTransport = async (url) => {
    const body = bodies.get(url);
    const bytes = body === undefined ? new TextEncoder().encode('missing') : typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const type = typeof body === 'string' ? 'text/xml; charset=utf-8' : 'application/x-gzip';
    return { status: body === undefined ? 404 : 200, header: (n) => (n.toLowerCase() === 'content-type' ? type : null), bytes: async () => bytes };
  };
  return new PoliteFetcher({
    userAgent: 'electro-parts-price-history/0.1 (+https://example.test; test)',
    minIntervalMs: 0,
    jitterMs: 0,
    maxAttempts: 1,
    timeoutMs: 1000,
    maxRequests: 50,
    transport,
    sleep: async () => {},
  });
}

describe('Akizuki listing references', () => {
  it('builds the paged URL form the site uses', () => {
    expect(akizukiListingUrl(BASE, { kind: 'c', slug: 'cheatsink' })).toBe(`${BASE}/catalog/c/cheatsink/`);
    expect(akizukiListingUrl(BASE, { kind: 'r', slug: 'rkit' }, 3)).toBe(`${BASE}/catalog/r/rkit_p3/`);
    expect(listingId({ kind: 'r', slug: 'rkit' })).toBe('r/rkit');
  });

  it('refuses a slug or page it cannot express safely', () => {
    expect(() => akizukiListingUrl(BASE, { kind: 'c', slug: '../../etc' })).toThrow(/invalid listing slug/);
    expect(() => akizukiListingUrl(BASE, { kind: 'c', slug: '' })).toThrow(/invalid listing slug/);
    expect(() => akizukiListingUrl(BASE, { kind: 'x' as 'c', slug: 'ckit' })).toThrow(/invalid listing kind/);
    expect(() => akizukiListingUrl(BASE, { kind: 'c', slug: 'ckit' }, 0)).toThrow(/invalid page/);
  });

  it('reads a reference back out of a URL, paged or not', () => {
    expect(parseListingRef('https://akizukidenshi.com/catalog/c/ckit/')).toEqual({ kind: 'c', slug: 'ckit' });
    // Trailing dashes are real slugs: `ckit-` is a different category from `ckit`.
    expect(parseListingRef('https://akizukidenshi.com/catalog/c/ckit-/')).toEqual({ kind: 'c', slug: 'ckit-' });
    expect(parseListingRef('https://akizukidenshi.com/catalog/r/rkit_p12/')).toEqual({ kind: 'r', slug: 'rkit' });
    expect(parseListingRef('https://akizukidenshi.com/catalog/g/g109951/')).toBeNull();
    expect(parseListingRef('https://akizukidenshi.com/')).toBeNull();
    expect(parseListingRef(undefined)).toBeNull();
  });

  it('states the site limits it cannot exceed', () => {
    expect(AKIZUKI_LISTING_RESULT_CAP).toBe(3000);
    expect(AKIZUKI_LISTING_PAGE_CAP).toBe(50);
  });
});

describe('Akizuki sitemap parsing', () => {
  it('reads sub-sitemap entries with their lastmod', () => {
    const entries = parseSitemapIndex(indexXml([{ loc: `${BASE}/a.xml.gz`, lastmod: '2026-09-05' }, { loc: `${BASE}/b.xml.gz` }]));
    expect(entries).toEqual([
      { url: `${BASE}/a.xml.gz`, lastModified: '2026-09-05' },
      { url: `${BASE}/b.xml.gz`, lastModified: null },
    ]);
  });

  it('refuses an index that lists nothing', () => {
    expect(() => parseSitemapIndex('<sitemapindex></sitemapindex>')).toThrow(SitemapError);
  });

  it('sorts product URLs from listing URLs and ignores everything else', () => {
    const sets = { products: new Set<string>(), categories: new Set<string>(), genres: new Set<string>() };
    collectSitemapUrls(
      urlsetXml([
        `${BASE}/catalog/g/g109951/`,
        `${BASE}/catalog/g/g109951/`,
        `${BASE}/catalog/g/gABC/`,
        `${BASE}/catalog/c/ckit/`,
        `${BASE}/catalog/r/rkit/`,
        `${BASE}/catalog/r/rkit_p2/`,
        `${BASE}/goods/search`,
      ]),
      sets,
    );
    expect([...sets.products]).toEqual(['109951']);
    expect([...sets.categories]).toEqual(['ckit']);
    // A paged listing URL is the same listing, not a second one.
    expect([...sets.genres]).toEqual(['rkit']);
  });

  it('decodes both gzipped and plain sub-sitemaps, and reports a body it cannot read', () => {
    const xml = urlsetXml([`${BASE}/catalog/g/g100001/`]);
    expect(decodeSitemapBody(gzipSync(Buffer.from(xml)), 'u')).toBe(xml);
    expect(decodeSitemapBody(new TextEncoder().encode(xml), 'u')).toBe(xml);
    // Gzip magic with a broken payload must fail loudly, not silently yield "".
    expect(() => decodeSitemapBody(new Uint8Array([0x1f, 0x8b, 0x00, 0x01]), 'u')).toThrow(SitemapError);
  });
});

describe('Akizuki sitemap fetch', () => {
  const bodies = (): Map<string, string | Uint8Array> =>
    new Map<string, string | Uint8Array>([
      [sitemapIndexUrl(BASE), indexXml([{ loc: `${BASE}/s1.xml.gz`, lastmod: '2026-09-04' }, { loc: `${BASE}/s2.xml.gz`, lastmod: '2026-09-06' }])],
      [`${BASE}/s1.xml.gz`, gzipSync(Buffer.from(urlsetXml([`${BASE}/catalog/g/g100002/`, `${BASE}/catalog/c/cled/`])))],
      [`${BASE}/s2.xml.gz`, gzipSync(Buffer.from(urlsetXml([`${BASE}/catalog/g/g100001/`, `${BASE}/catalog/r/rled/`, `${BASE}/catalog/c/caudio/`])))],
    ]);

  it('unions every sub-sitemap and keeps the newest lastmod', async () => {
    const sitemap = await fetchAkizukiSitemap({ fetcher: fetcherOver(bodies()), baseUrl: BASE });
    expect(sitemap.productCodes).toEqual(['100001', '100002']);
    expect(sitemap.categorySlugs).toEqual(['caudio', 'cled']);
    expect(sitemap.genreSlugs).toEqual(['rled']);
    expect(sitemap.lastModified).toBe('2026-09-06');
    expect(sitemap.sources).toHaveLength(2);
  });

  it('fails rather than returning a catalogue with no products in it', async () => {
    const b = bodies();
    b.set(`${BASE}/s1.xml.gz`, gzipSync(Buffer.from(urlsetXml([`${BASE}/catalog/c/cled/`]))));
    b.set(`${BASE}/s2.xml.gz`, gzipSync(Buffer.from(urlsetXml([`${BASE}/catalog/r/rled/`]))));
    await expect(fetchAkizukiSitemap({ fetcher: fetcherOver(b), baseUrl: BASE })).rejects.toThrow(/no product URLs/);
  });

  it('refuses an index far larger than the site has ever served', async () => {
    const b = bodies();
    b.set(sitemapIndexUrl(BASE), indexXml([{ loc: `${BASE}/s1.xml.gz` }, { loc: `${BASE}/s2.xml.gz` }]));
    await expect(fetchAkizukiSitemap({ fetcher: fetcherOver(b), baseUrl: BASE, maxSubSitemaps: 1 })).rejects.toThrow(/above the cap/);
  });

  it('propagates a sub-sitemap that cannot be fetched instead of undercounting the catalogue', async () => {
    const b = bodies();
    b.delete(`${BASE}/s2.xml.gz`);
    await expect(fetchAkizukiSitemap({ fetcher: fetcherOver(b), baseUrl: BASE })).rejects.toThrow();
  });
});
