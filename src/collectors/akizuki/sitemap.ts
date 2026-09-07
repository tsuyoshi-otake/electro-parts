/**
 * Akizuki's XML sitemap: the authoritative list of what the catalogue holds.
 *
 * `robots.txt` advertises `/Sitemap_index.xml`, which points at gzipped
 * sub-sitemaps. Between them they enumerate every product page
 * (`/catalog/g/g<salesCode>/`) and every listing page — the category tree
 * (`/catalog/c/<slug>/`) and the genre tags (`/catalog/r/<slug>/`).
 *
 * The crawler uses this for two things: it discovers which listings to walk
 * instead of hard-coding them, and it checks afterwards that every product the
 * sitemap names was actually seen. Without that check a listing the site
 * silently drops would look like a delisting.
 *
 * Only the Akizuki-specific part lives here; reading sitemap XML itself is
 * shared with every other store in `../sitemapXml.ts`.
 */
import type { PoliteFetcher } from '../politeFetcher.ts';
import {
  decodeSitemapBody,
  newestLastModified,
  parseSitemapIndex,
  parseSitemapLocs,
  SitemapError,
  type SitemapIndexEntry,
} from '../sitemapXml.ts';
import { AKIZUKI_SALES_CODE_PATTERN } from '../../adapters/akizuki/rawSchema.ts';
import { parseListingRef } from './listings.ts';

export { SitemapError, type SitemapIndexEntry };

export interface AkizukiSitemap {
  /** Sales codes of every product page in the sitemap, sorted, deduplicated. */
  productCodes: string[];
  /** Category-tree slugs (`/catalog/c/<slug>/`), sorted. */
  categorySlugs: string[];
  /** Genre-tag slugs (`/catalog/r/<slug>/`), sorted. */
  genreSlugs: string[];
  /** The sub-sitemaps read, in the order the index listed them. */
  sources: SitemapIndexEntry[];
  /** Newest `lastmod` across the index, or null when none was given. */
  lastModified: string | null;
}

const PRODUCT_URL = /\/catalog\/g\/g(\d+)\/?$/;

export function sitemapIndexUrl(baseUrl: string): string {
  return `${baseUrl}/Sitemap_index.xml`;
}

/** Sorts the `<loc>` URLs of one sub-sitemap into products and listings. */
export function collectSitemapUrls(xml: string, into: { products: Set<string>; categories: Set<string>; genres: Set<string> }): void {
  for (const url of parseSitemapLocs(xml)) {
    const product = PRODUCT_URL.exec(url);
    if (product !== null) {
      const code = product[1] as string;
      if (AKIZUKI_SALES_CODE_PATTERN.test(code)) into.products.add(code);
      continue;
    }
    const listing = parseListingRef(url);
    if (listing === null) continue;
    (listing.kind === 'c' ? into.categories : into.genres).add(listing.slug);
  }
}

export interface FetchSitemapOptions {
  fetcher: PoliteFetcher;
  baseUrl: string;
  /** Safety cap on sub-sitemaps read. Default 32. */
  maxSubSitemaps?: number;
  log?: (message: string) => void;
}

/** Reads the whole sitemap. Throws when it cannot be read; there is no partial answer. */
export async function fetchAkizukiSitemap(options: FetchSitemapOptions): Promise<AkizukiSitemap> {
  const { fetcher, baseUrl } = options;
  const max = options.maxSubSitemaps ?? 32;
  const indexXml = await fetcher.fetchText(sitemapIndexUrl(baseUrl));
  const sources = parseSitemapIndex(indexXml);
  if (sources.length > max) throw new SitemapError(`sitemap index lists ${sources.length} sub-sitemaps, above the cap of ${max}`);
  const sets = { products: new Set<string>(), categories: new Set<string>(), genres: new Set<string>() };
  for (const entry of sources) {
    const xml = decodeSitemapBody(await fetcher.fetchBytes(entry.url), entry.url);
    collectSitemapUrls(xml, sets);
  }
  if (sets.products.size === 0) throw new SitemapError('sitemap contains no product URLs');
  const sitemap: AkizukiSitemap = {
    productCodes: [...sets.products].sort(),
    categorySlugs: [...sets.categories].sort(),
    genreSlugs: [...sets.genres].sort(),
    sources,
    lastModified: newestLastModified(sources),
  };
  options.log?.(`[sitemap] ${sitemap.productCodes.length} products, ${sitemap.categorySlugs.length} categories, ${sitemap.genreSlugs.length} genres from ${sources.length} sub-sitemaps`);
  return sitemap;
}
