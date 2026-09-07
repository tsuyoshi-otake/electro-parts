/**
 * Switch Science's XML sitemap: the oracle the catalogue walk is checked
 * against.
 *
 * `robots.txt` advertises `/sitemap.xml`, an index of 15 children. Only the
 * `sitemap_products_*.xml` ones are read — the pages, collections and blog
 * sitemaps describe content this crawler does not collect, and fetching them
 * would be load taken for nothing.
 *
 * The check matters because the catalogue API can end a walk early (a short
 * page, a collection that quietly excludes products) and still look like a
 * complete answer. Comparing against the sitemap is what turns that into a
 * visible gap instead of thousands of products appearing to be delisted.
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
import { isValidSwitchScienceHandle } from '../../adapters/switch-science/snapshotAdapter.ts';

export interface SwitchScienceSitemap {
  /** Handles of every product page in the sitemap, sorted, deduplicated. */
  handles: string[];
  /** Product URLs whose handle cannot be a page key; a sample, for diagnosis. */
  unsupportedHandles: string[];
  /** The product sub-sitemaps read, in the order the index listed them. */
  sources: SitemapIndexEntry[];
  /** How many children the index offered in total, product or otherwise. */
  indexEntryCount: number;
  lastModified: string | null;
}

const PRODUCT_URL = /^https?:\/\/[^/]+\/products\/([^/?#]+)\/?$/;
const PRODUCT_SITEMAP = /\/sitemap_products_\d+\.xml(\?|$)/;
const UNSUPPORTED_SAMPLE_LIMIT = 20;

export function sitemapIndexUrl(baseUrl: string): string {
  return `${baseUrl}/sitemap.xml`;
}

/**
 * The handle in a product URL, or `null` when the URL is not one. Sitemap URLs
 * are percent-encoded, so a handle is decoded before it is judged — otherwise a
 * perfectly ordinary handle could be rejected for its encoding.
 */
export function handleFromProductUrl(url: string): string | null {
  const m = PRODUCT_URL.exec(url);
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1] as string);
  } catch {
    return null;
  }
}

export function isProductSitemapUrl(url: string): boolean {
  return PRODUCT_SITEMAP.test(url);
}

/** Adds the product handles of one sub-sitemap to the accumulating sets. */
export function collectSitemapHandles(
  xml: string,
  into: { handles: Set<string>; unsupported: Set<string> },
): void {
  for (const url of parseSitemapLocs(xml)) {
    const handle = handleFromProductUrl(url);
    if (handle === null) continue;
    if (isValidSwitchScienceHandle(handle)) into.handles.add(handle);
    else into.unsupported.add(handle);
  }
}

export interface FetchSitemapOptions {
  fetcher: PoliteFetcher;
  baseUrl: string;
  /** Safety cap on product sub-sitemaps read. Default 64. */
  maxSubSitemaps?: number;
  log?: (message: string) => void;
}

/** Reads the product sitemaps. Throws when they cannot be read; there is no partial oracle. */
export async function fetchSwitchScienceSitemap(options: FetchSitemapOptions): Promise<SwitchScienceSitemap> {
  const { fetcher, baseUrl } = options;
  const max = options.maxSubSitemaps ?? 64;
  const indexXml = await fetcher.fetchText(sitemapIndexUrl(baseUrl));
  const entries = parseSitemapIndex(indexXml);
  const sources = entries.filter((e) => isProductSitemapUrl(e.url));
  if (sources.length === 0) throw new SitemapError('sitemap index lists no product sub-sitemaps');
  if (sources.length > max) throw new SitemapError(`sitemap index lists ${sources.length} product sub-sitemaps, above the cap of ${max}`);
  const sets = { handles: new Set<string>(), unsupported: new Set<string>() };
  for (const entry of sources) {
    const xml = decodeSitemapBody(await fetcher.fetchBytes(entry.url), entry.url);
    collectSitemapHandles(xml, sets);
  }
  if (sets.handles.size === 0) throw new SitemapError('sitemap contains no product URLs');
  const sitemap: SwitchScienceSitemap = {
    handles: [...sets.handles].sort(),
    unsupportedHandles: [...sets.unsupported].sort().slice(0, UNSUPPORTED_SAMPLE_LIMIT),
    sources,
    indexEntryCount: entries.length,
    lastModified: newestLastModified(sources),
  };
  options.log?.(
    `[sitemap] ${sitemap.handles.length} products from ${sources.length}/${entries.length} sub-sitemaps` +
      (sets.unsupported.size > 0 ? `, ${sets.unsupported.size} unusable handle(s)` : ''),
  );
  return sitemap;
}
