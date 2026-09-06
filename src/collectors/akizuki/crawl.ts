/**
 * Akizuki catalogue crawl.
 *
 * The site's own sitemap decides both what to crawl and what "complete" means:
 * it enumerates every product page and every listing page. The crawler walks
 * the listings, deduplicates product occurrences by sales code, and then checks
 * the result back against the sitemap's product set. A hand-written listing set
 * cannot do that — it silently misses whatever nobody wrote down.
 *
 * Completeness is explicit and fails closed (ADR-0004): a failed page, a
 * listing whose extracted count differs from the site's own counter, a parse
 * error, or a sitemap product no listing showed marks the snapshot
 * `complete: false`, which the adapter refuses to import. A collection gap must
 * never be published as a delisting.
 */
import type { AkizukiRawCatalog, AkizukiRawItem, AkizukiRawListing, AkizukiRawSnapshot } from '../../adapters/akizuki/rawSchema.ts';
import { AKIZUKI_RAW_SCHEMA_VERSION } from '../../adapters/akizuki/rawSchema.ts';
import { FetchFailedError, PoliteFetcher, RequestBudgetExceededError } from '../politeFetcher.ts';
import {
  AKIZUKI_BASE_URL,
  AKIZUKI_LISTING_PAGE_CAP,
  AKIZUKI_LISTING_RESULT_CAP,
  akizukiListingUrl,
  listingId,
  type ListingKind,
  type ListingRef,
} from './listings.ts';
import { ListingParseError, parseAkizukiListingPage, type ListingItem, type ListingPage } from './listingParser.ts';
import { fetchAkizukiSitemap, sitemapIndexUrl, type AkizukiSitemap } from './sitemap.ts';

/** How many uncovered sales codes are named in the snapshot for diagnosis. */
const UNCOVERED_SAMPLE_SIZE = 20;
const MAX_REPORTED_DISAGREEMENTS = 20;

export interface CrawlOptions {
  fetcher: PoliteFetcher;
  baseUrl?: string;
  /** Listing families to walk, in order. Default `['c']`, the category tree. */
  listingKinds?: readonly ListingKind[];
  /** Explicit listing set; skips sitemap discovery but not the coverage check. */
  listings?: readonly ListingRef[];
  /** Safety cap; a listing with more pages is reported as an error. Default 50, the site's own limit. */
  maxPagesPerListing?: number;
  /** Sitemap products allowed to be absent from every listing before the run is incomplete. Default 0. */
  maxUncoveredProducts?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface CrawlResult {
  snapshot: AkizukiRawSnapshot;
  sitemap: AkizukiSitemap;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface Occurrence {
  item: ListingItem;
  listing: { name: string; url: string };
  page: number;
}

interface ListingCrawl {
  record: AkizukiRawListing;
  occurrences: Occurrence[];
  errors: string[];
  warnings: string[];
}

type ListingCrawlOptions = Required<Pick<CrawlOptions, 'fetcher' | 'baseUrl' | 'maxPagesPerListing'>> & Pick<CrawlOptions, 'log'>;

async function crawlListing(ref: ListingRef, o: ListingCrawlOptions): Promise<ListingCrawl> {
  const id = listingId(ref);
  const url = akizukiListingUrl(o.baseUrl, ref);
  const errors: string[] = [];
  const warnings: string[] = [];
  const occurrences: Occurrence[] = [];
  let name = ref.slug;
  let listedTotal = 0;
  let totalPages = 0;
  let successfulPages = 0;
  let failedPages = 0;

  const fetchPage = async (page: number): Promise<ListingPage | null> => {
    const pageUrl = akizukiListingUrl(o.baseUrl, ref, page);
    try {
      const html = await o.fetcher.fetchText(pageUrl);
      const parsed = parseAkizukiListingPage(html);
      if (!parsed.indexOnly && parsed.currentPage !== page) {
        errors.push(`${id} page ${page}: server returned page ${parsed.currentPage}`);
        failedPages++;
        return null;
      }
      for (const issue of parsed.issues) warnings.push(`${id} page ${page}: ${issue}`);
      successfulPages++;
      return parsed;
    } catch (e) {
      if (e instanceof RequestBudgetExceededError) throw e;
      const reason = e instanceof FetchFailedError || e instanceof ListingParseError ? e.message : `unexpected ${String(e)}`;
      errors.push(`${id} page ${page}: ${reason}`);
      failedPages++;
      return null;
    }
  };

  const firstPage = await fetchPage(1);
  // The site pages through at most 3,000 results, so a bigger listing can only
  // ever be seen in part. That is not a failure of this listing; the sitemap
  // coverage check decides whether those products were found somewhere else.
  //
  // The counter saturates at the same cap, so it stops being a usable expected
  // count there: `c0` ("仕様からさがす") announces exactly 3,000 while serving
  // about 7,900 items over its 50 pages of 180. A listing at the cap is
  // therefore counted as truncated and its count check is skipped.
  const truncated = firstPage !== null && firstPage.listedTotal >= AKIZUKI_LISTING_RESULT_CAP;
  if (firstPage !== null) {
    name = firstPage.listingName;
    listedTotal = firstPage.listedTotal;
    totalPages = firstPage.lastPage;
    if (totalPages > o.maxPagesPerListing) {
      errors.push(`${id}: ${totalPages} pages exceed the cap of ${o.maxPagesPerListing}`);
      totalPages = 0;
    } else {
      const listing = { name, url };
      for (const item of firstPage.items) occurrences.push({ item, listing, page: 1 });
      for (let page = 2; page <= totalPages; page++) {
        const parsed = await fetchPage(page);
        if (parsed === null) continue;
        for (const item of parsed.items) occurrences.push({ item, listing, page });
        if (parsed.nextPath === null && page < totalPages) {
          errors.push(`${id} page ${page}: no next link although ${totalPages} pages were announced`);
          break;
        }
      }
    }
  }
  const extractedOccurrences = occurrences.length;
  const record: AkizukiRawListing = {
    kind: ref.kind,
    slug: ref.slug,
    name,
    url,
    listedTotal,
    truncated,
    totalPages,
    successfulPages,
    failedPages,
    extractedOccurrences,
    matchesListedTotal: failedPages === 0 && errors.length === 0 && (truncated || extractedOccurrences === listedTotal),
  };
  o.log?.(
    `[crawl] ${id} "${name}" pages=${successfulPages}/${totalPages} occurrences=${extractedOccurrences}/${truncated ? 'capped' : listedTotal}` +
      `${record.matchesListedTotal ? '' : ' MISMATCH'}`,
  );
  return { record, occurrences, errors, warnings };
}

/**
 * What a price means, without how the page happened to render it. The
 * spec-table layout prints every price as "￥770～" where the card prints
 * "￥770" — measured on `c/cantenna-`, all 54 rows carry the 〜 and the product
 * pages show a single price, so it is the table template's wording, not a
 * range. Comparing the display text would report all 221 such products as
 * disagreeing every run; comparing what is actually recorded reports only the
 * cases where the site really says two different things.
 */
function priceFacts(item: ListingItem): unknown {
  return item.prices.map((p) => [p.amountYen, p.taxIncluded, p.quantityUnit]);
}

function sameListing(a: ListingItem, b: ListingItem): boolean {
  // `purchasable` is only comparable when both layouts reported it; the
  // spec-table layout has no cart affordance and reports null.
  const comparablePurchasable =
    a.stock.purchasable === null || b.stock.purchasable === null || a.stock.purchasable === b.stock.purchasable;
  return (
    comparablePurchasable &&
    JSON.stringify([priceFacts(a), a.stock.status]) === JSON.stringify([priceFacts(b), b.stock.status])
  );
}

/**
 * The spec-table layout states no cart and no stock quantity, so an occurrence
 * read from it is strictly poorer than one read from a product card. Which
 * listing the crawl happens to reach first must not decide whether a product
 * gets an inventory series, so a card occurrence replaces a table one.
 */
function isRicher(candidate: ListingItem, current: ListingItem): boolean {
  return current.stock.purchasable === null && candidate.stock.purchasable !== null;
}

export function deduplicateOccurrences(occurrences: readonly Occurrence[], warnings: string[]): AkizukiRawItem[] {
  const byKey = new Map<string, AkizukiRawItem>();
  const firstSeen = new Map<string, ListingItem>();
  let disagreements = 0;
  for (const occ of occurrences) {
    const key = occ.item.salesCode;
    const existing = byKey.get(key);
    if (existing === undefined) {
      const { positionOnPage, ...item } = occ.item;
      byKey.set(key, { ...item, sourceListings: [occ.listing], sourcePage: occ.page, positionOnPage, duplicateOccurrences: 0 });
      firstSeen.set(key, occ.item);
      continue;
    }
    existing.duplicateOccurrences = (existing.duplicateOccurrences ?? 0) + 1;
    if (!existing.sourceListings!.some((l) => l.url === occ.listing.url)) existing.sourceListings!.push(occ.listing);
    if (isRicher(occ.item, firstSeen.get(key)!)) {
      existing.prices = occ.item.prices;
      existing.stock = occ.item.stock;
      existing.sourcePage = occ.page;
      existing.positionOnPage = occ.item.positionOnPage;
      firstSeen.set(key, occ.item);
      continue;
    }
    const first = firstSeen.get(key)!;
    if (!sameListing(first, occ.item)) {
      disagreements++;
      if (disagreements <= MAX_REPORTED_DISAGREEMENTS) {
        warnings.push(
          `${key}: listing differs between listings (${first.prices[0]?.display ?? 'no price'} "${first.stock.status}" vs ${occ.item.prices[0]?.display ?? 'no price'} "${occ.item.stock.status}")`,
        );
      }
    }
  }
  if (disagreements > MAX_REPORTED_DISAGREEMENTS) {
    warnings.push(`${disagreements} sales codes showed differing listings across listings (first ${MAX_REPORTED_DISAGREEMENTS} reported)`);
  }
  return [...byKey.values()];
}

/** Expands the sitemap into the listing set to walk. */
export function listingsFromSitemap(sitemap: AkizukiSitemap, kinds: readonly ListingKind[]): ListingRef[] {
  const refs: ListingRef[] = [];
  for (const kind of kinds) {
    for (const slug of kind === 'c' ? sitemap.categorySlugs : sitemap.genreSlugs) refs.push({ kind, slug });
  }
  return refs;
}

export async function crawlAkizuki(options: CrawlOptions): Promise<CrawlResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const baseUrl = options.baseUrl ?? AKIZUKI_BASE_URL;
  const kinds = options.listingKinds ?? (['c'] as const);
  const maxUncovered = options.maxUncoveredProducts ?? 0;
  const o: ListingCrawlOptions = {
    fetcher: options.fetcher,
    baseUrl,
    maxPagesPerListing: options.maxPagesPerListing ?? AKIZUKI_LISTING_PAGE_CAP,
    ...(options.log === undefined ? {} : { log: options.log }),
  };
  const errors: string[] = [];
  const warnings: string[] = [];

  const sitemap = await fetchAkizukiSitemap({ fetcher: options.fetcher, baseUrl, ...(options.log === undefined ? {} : { log: options.log }) });
  const listings = options.listings ?? listingsFromSitemap(sitemap, kinds);

  const listingRecords: AkizukiRawListing[] = [];
  const occurrences: Occurrence[] = [];
  const seenIds = new Set<string>();
  for (const ref of listings) {
    const id = listingId(ref);
    if (seenIds.has(id)) {
      errors.push(`listing ${id} configured twice`);
      continue;
    }
    seenIds.add(id);
    const l = await crawlListing(ref, o);
    listingRecords.push(l.record);
    occurrences.push(...l.occurrences);
    errors.push(...l.errors);
    warnings.push(...l.warnings);
  }
  const items = deduplicateOccurrences(occurrences, warnings);

  const expectedCodes = new Set(sitemap.productCodes);
  const observedCodes = new Set(items.map((i) => i.salesCode));
  const uncovered = sitemap.productCodes.filter((code) => !observedCodes.has(code));
  const unlisted = items.filter((i) => !expectedCodes.has(i.salesCode)).length;
  const catalog: AkizukiRawCatalog = {
    sitemapUrl: sitemapIndexUrl(baseUrl),
    sitemapLastModified: sitemap.lastModified,
    productTotal: sitemap.productCodes.length,
    listingTotal: sitemap.categorySlugs.length + sitemap.genreSlugs.length,
    listingsCrawled: listingRecords.length,
    covered: expectedCodes.size - uncovered.length,
    uncovered: uncovered.length,
    uncoveredSample: uncovered.slice(0, UNCOVERED_SAMPLE_SIZE),
    unlisted,
  };
  if (uncovered.length > maxUncovered) {
    errors.push(`${uncovered.length} sitemap product(s) appear in no listing (allowed ${maxUncovered}), e.g. ${catalog.uncoveredSample.slice(0, 5).join(', ')}`);
  } else if (uncovered.length > 0) {
    warnings.push(`${uncovered.length} sitemap product(s) appear in no listing: ${catalog.uncoveredSample.join(', ')}`);
  }
  if (unlisted > 0) warnings.push(`${unlisted} listed product(s) are not in the sitemap yet`);

  const finishedAt = now();
  const listingMismatches = listingRecords.filter((l) => !l.matchesListedTotal).length;
  const failedPages = listingRecords.reduce((n, l) => n + l.failedPages, 0);
  const stats = options.fetcher.stats;
  const snapshot: AkizukiRawSnapshot = {
    schemaVersion: AKIZUKI_RAW_SCHEMA_VERSION,
    source: `${baseUrl}/catalog/`,
    retrievedAt: finishedAt.toISOString(),
    complete: errors.length === 0 && failedPages === 0 && listingMismatches === 0 && items.length > 0,
    catalog,
    listingCount: listingRecords.length,
    occurrenceTotal: occurrences.length,
    extractedTotal: items.length,
    deduplication: {
      enabled: true,
      primaryKey: 'salesCode',
      fallbackKey: 'canonical product URL',
      uniqueKeyTotal: items.length,
      duplicatesDetected: occurrences.length - items.length,
      duplicatesRemoved: occurrences.length - items.length,
    },
    dataQuality: {
      missingSalesCode: 0,
      missingModelNumber: items.filter((i) => i.modelNumber === null).length,
      missingName: items.filter((i) => i.name === '').length,
    },
    requests: {
      logicalPages: stats.logicalPages,
      httpAttemptsIncludingRetries: stats.httpAttempts,
      successfulResponses: stats.successfulResponses,
      intervalMs: options.fetcher.intervalMs,
    },
    validation: { listingMismatches, errors, warnings },
    listings: listingRecords,
    items,
  };
  return { snapshot, sitemap, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime() };
}
