/**
 * Switch Science catalogue crawl.
 *
 * The walk itself is short — one JSON page per 250 products — so almost all of
 * this module is about knowing when the answer is trustworthy. The sitemap
 * decides that: it enumerates every product page, the walk is checked back
 * against it, and a page the collection API never returned is a collection gap,
 * not a delisting.
 *
 * Completeness is explicit and fails closed (ADR-0004): a failed page, a
 * malformed response, or more uncovered products than configured marks the
 * snapshot `complete: false`, which the adapter refuses to import.
 */
import {
  SWITCH_SCIENCE_RAW_SCHEMA_VERSION,
  type SwitchScienceRawCatalog,
  type SwitchScienceRawItem,
  type SwitchScienceRawSnapshot,
} from '../../adapters/switch-science/rawSchema.ts';
import { FetchFailedError, PoliteFetcher, RequestBudgetExceededError } from '../politeFetcher.ts';
import {
  CATALOG_PAGE_LIMIT,
  CatalogFormatError,
  DEFAULT_COLLECTION,
  SWITCH_SCIENCE_BASE_URL,
  catalogPageUrl,
  parseCatalogPage,
} from './catalog.ts';
import { fetchSwitchScienceSitemap, sitemapIndexUrl, type SwitchScienceSitemap } from './sitemap.ts';

/** How many uncovered handles are named in the snapshot for diagnosis. */
const UNCOVERED_SAMPLE_SIZE = 20;
const UNSUPPORTED_SAMPLE_SIZE = 20;
/** Safety cap on catalogue pages; 200 pages of 250 is 50,000 products. */
export const DEFAULT_MAX_PAGES = 200;

export interface CrawlOptions {
  fetcher: PoliteFetcher;
  baseUrl?: string;
  /** Collection to walk. `all` is every published product. */
  collection?: string;
  /** Products per page; Shopify caps this at 250. */
  pageLimit?: number;
  maxPages?: number;
  /** Sitemap products allowed to be absent from the walk before the run is incomplete. */
  maxUncoveredProducts?: number;
  maxSubSitemaps?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface CrawlResult {
  snapshot: SwitchScienceRawSnapshot;
  sitemap: SwitchScienceSitemap;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface CatalogWalk {
  items: SwitchScienceRawItem[];
  pageCount: number;
  rawTotal: number;
  duplicates: number;
  unsupportedHandles: string[];
  unparsablePrices: number;
  errors: string[];
  warnings: string[];
}

interface WalkOptions {
  fetcher: PoliteFetcher;
  baseUrl: string;
  collection: string;
  pageLimit: number;
  maxPages: number;
  log?: (message: string) => void;
}

/**
 * Walks the collection until a page comes back short, which is how this API
 * says "that was the last one". Stopping there costs one fewer request than
 * waiting for an empty page; the risk that a page is short for some other
 * reason is what the sitemap check is for.
 */
export async function walkCatalog(o: WalkOptions): Promise<CatalogWalk> {
  const items: SwitchScienceRawItem[] = [];
  const byHandle = new Map<string, SwitchScienceRawItem>();
  const unsupported: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let pageCount = 0;
  let rawTotal = 0;
  let duplicates = 0;
  let unparsablePrices = 0;

  for (let page = 1; page <= o.maxPages; page += 1) {
    const url = catalogPageUrl(o.baseUrl, o.collection, page, o.pageLimit);
    let body: string;
    try {
      body = await o.fetcher.fetchText(url);
    } catch (e) {
      if (e instanceof RequestBudgetExceededError) {
        errors.push(`page ${page}: ${e.message}`);
        break;
      }
      if (e instanceof FetchFailedError) {
        errors.push(`page ${page}: ${e.message}`);
        break;
      }
      throw e;
    }
    let parsed;
    try {
      parsed = parseCatalogPage(JSON.parse(body), page);
    } catch (e) {
      // A malformed page is not a page to skip: past it, every count would be
      // a guess. Stop and let the snapshot be incomplete. A format error already
      // names the page it happened on; anything else is labelled here.
      errors.push(e instanceof CatalogFormatError ? e.message : `page ${page}: ${e instanceof SyntaxError ? e.message : String(e)}`);
      break;
    }
    pageCount += 1;
    rawTotal += parsed.rawCount;
    unparsablePrices += parsed.unparsablePrices;
    unsupported.push(...parsed.unsupportedHandles);
    for (const item of parsed.items) {
      const existing = byHandle.get(item.handle);
      if (existing === undefined) {
        byHandle.set(item.handle, item);
        items.push(item);
      } else {
        duplicates += 1;
        existing.duplicateOccurrences = (existing.duplicateOccurrences ?? 1) + 1;
      }
    }
    o.log?.(`[catalog] page ${page}: ${parsed.rawCount} product(s), ${items.length} unique so far`);
    if (parsed.rawCount < o.pageLimit) break;
    if (page === o.maxPages) errors.push(`page cap of ${o.maxPages} reached with a full page; the catalogue is larger than configured`);
  }
  if (duplicates > 0) warnings.push(`${duplicates} product(s) appeared on more than one page`);
  if (unsupported.length > 0) {
    warnings.push(`${unsupported.length} product(s) dropped for an unusable handle: ${unsupported.slice(0, 5).join(', ')}`);
  }
  if (unparsablePrices > 0) warnings.push(`${unparsablePrices} variant price(s) were not exact yen amounts`);
  return { items, pageCount, rawTotal, duplicates, unsupportedHandles: unsupported, unparsablePrices, errors, warnings };
}

export async function crawlSwitchScience(options: CrawlOptions): Promise<CrawlResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const baseUrl = options.baseUrl ?? SWITCH_SCIENCE_BASE_URL;
  const collection = options.collection ?? DEFAULT_COLLECTION;
  const pageLimit = options.pageLimit ?? CATALOG_PAGE_LIMIT;
  const maxUncovered = options.maxUncoveredProducts ?? 0;

  const sitemap = await fetchSwitchScienceSitemap({
    fetcher: options.fetcher,
    baseUrl,
    ...(options.maxSubSitemaps === undefined ? {} : { maxSubSitemaps: options.maxSubSitemaps }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  const walk = await walkCatalog({
    fetcher: options.fetcher,
    baseUrl,
    collection,
    pageLimit,
    maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
    ...(options.log === undefined ? {} : { log: options.log }),
  });
  const errors = [...walk.errors];
  const warnings = [...walk.warnings];

  const expected = new Set(sitemap.handles);
  const observed = new Set(walk.items.map((i) => i.handle));
  const uncovered = sitemap.handles.filter((h) => !observed.has(h));
  const unlisted = walk.items.filter((i) => !expected.has(i.handle)).length;
  const catalog: SwitchScienceRawCatalog = {
    sitemapUrl: sitemapIndexUrl(baseUrl),
    sitemapLastModified: sitemap.lastModified,
    productTotal: sitemap.handles.length,
    sitemapPages: sitemap.sources.length,
    covered: expected.size - uncovered.length,
    uncovered: uncovered.length,
    uncoveredSample: uncovered.slice(0, UNCOVERED_SAMPLE_SIZE),
    unlisted,
  };
  if (uncovered.length > maxUncovered) {
    errors.push(
      `${uncovered.length} sitemap product(s) were not returned by the collection (allowed ${maxUncovered}), e.g. ${catalog.uncoveredSample.slice(0, 5).join(', ')}`,
    );
  } else if (uncovered.length > 0) {
    warnings.push(`${uncovered.length} sitemap product(s) were not returned by the collection: ${catalog.uncoveredSample.join(', ')}`);
  }
  // The reverse direction is ordinary: the sitemap is regenerated on its own
  // schedule, so a product published minutes ago is in the API and not yet in
  // the sitemap. It is reported, never fatal.
  if (unlisted > 0) warnings.push(`${unlisted} product(s) are in the collection but not in the sitemap yet`);

  const finishedAt = now();
  const stats = options.fetcher.stats;
  const variants = walk.items.reduce((n, i) => n + i.variants.length, 0);
  const snapshot: SwitchScienceRawSnapshot = {
    schemaVersion: SWITCH_SCIENCE_RAW_SCHEMA_VERSION,
    source: `${baseUrl}/collections/${collection}/products.json`,
    retrievedAt: finishedAt.toISOString(),
    complete: errors.length === 0 && walk.items.length > 0,
    catalog,
    collection,
    pageCount: walk.pageCount,
    extractedTotal: walk.items.length,
    deduplication: {
      enabled: true,
      primaryKey: 'handle',
      uniqueKeyTotal: walk.items.length,
      duplicatesDetected: walk.duplicates,
      duplicatesRemoved: walk.duplicates,
    },
    dataQuality: {
      unsupportedHandle: walk.unsupportedHandles.length,
      unsupportedHandleSample: walk.unsupportedHandles.slice(0, UNSUPPORTED_SAMPLE_SIZE),
      missingSku: walk.items.reduce((n, i) => n + i.variants.filter((v) => v.sku === null).length, 0),
      unparsablePrice: walk.unparsablePrices,
      multiVariant: walk.items.filter((i) => i.variants.length > 1).length,
      unavailable: walk.items.filter((i) => i.variants.every((v) => !v.available)).length,
    },
    requests: {
      logicalPages: stats.logicalPages,
      httpAttemptsIncludingRetries: stats.httpAttempts,
      successfulResponses: stats.successfulResponses,
      intervalMs: options.fetcher.intervalMs,
    },
    validation: { errors, warnings },
    items: walk.items,
  };
  options.log?.(
    `[crawl] ${snapshot.extractedTotal} product(s), ${variants} variant(s), covered ${catalog.covered}/${catalog.productTotal}, complete=${snapshot.complete}`,
  );
  return {
    snapshot,
    sitemap,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
