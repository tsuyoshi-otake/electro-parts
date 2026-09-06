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
 */
import { gunzipSync } from 'node:zlib';
import type { PoliteFetcher } from '../politeFetcher.ts';
import { AKIZUKI_SALES_CODE_PATTERN } from '../../adapters/akizuki/rawSchema.ts';
import { parseListingRef } from './listings.ts';

export interface SitemapIndexEntry {
  url: string;
  lastModified: string | null;
}

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

export class SitemapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SitemapError';
  }
}

const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
const SITEMAP_ENTRY = /<sitemap>([\s\S]*?)<\/sitemap>/g;
const LASTMOD = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/;
const PRODUCT_URL = /\/catalog\/g\/g(\d+)\/?$/;
const GZIP_MAGIC = [0x1f, 0x8b];

export function sitemapIndexUrl(baseUrl: string): string {
  return `${baseUrl}/Sitemap_index.xml`;
}

/** Parses the sitemap index into its sub-sitemap entries. */
export function parseSitemapIndex(xml: string): SitemapIndexEntry[] {
  const entries: SitemapIndexEntry[] = [];
  SITEMAP_ENTRY.lastIndex = 0;
  for (let m = SITEMAP_ENTRY.exec(xml); m !== null; m = SITEMAP_ENTRY.exec(xml)) {
    const block = m[1] as string;
    LOC.lastIndex = 0;
    const loc = LOC.exec(block)?.[1];
    if (loc === undefined) continue;
    entries.push({ url: loc, lastModified: LASTMOD.exec(block)?.[1] ?? null });
  }
  if (entries.length === 0) throw new SitemapError('sitemap index lists no sub-sitemaps');
  return entries;
}

/** Sorts the `<loc>` URLs of one sub-sitemap into products and listings. */
export function collectSitemapUrls(xml: string, into: { products: Set<string>; categories: Set<string>; genres: Set<string> }): void {
  LOC.lastIndex = 0;
  for (let m = LOC.exec(xml); m !== null; m = LOC.exec(xml)) {
    const url = m[1] as string;
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

/** Decompresses a sub-sitemap body; plain XML is accepted as well. */
export function decodeSitemapBody(bytes: Uint8Array, url: string): string {
  const gzipped = bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  try {
    return new TextDecoder().decode(gzipped ? gunzipSync(bytes) : bytes);
  } catch (e) {
    throw new SitemapError(`${url}: cannot decode sitemap body (${(e as Error).message})`);
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
  const lastModified = sources.reduce<string | null>((newest, s) => (s.lastModified !== null && (newest === null || s.lastModified > newest) ? s.lastModified : newest), null);
  const sitemap: AkizukiSitemap = {
    productCodes: [...sets.products].sort(),
    categorySlugs: [...sets.categories].sort(),
    genreSlugs: [...sets.genres].sort(),
    sources,
    lastModified,
  };
  options.log?.(`[sitemap] ${sitemap.productCodes.length} products, ${sitemap.categorySlugs.length} categories, ${sitemap.genreSlugs.length} genres from ${sources.length} sub-sitemaps`);
  return sitemap;
}
