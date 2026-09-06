/**
 * Akizuki catalogue crawl: walks every configured genre listing page by page,
 * deduplicates product occurrences by sales code and assembles a raw
 * snapshot (`schemaVersion: 2`) in the exact shape the Akizuki snapshot
 * adapter validates. The crawler never interprets prices or stock; it only
 * records what the listing shows.
 *
 * Completeness is explicit: any failed page, any genre whose extracted
 * occurrence count differs from the site's own "N件あります" counter, or any
 * parse error marks the snapshot `complete: false`, which the adapter refuses
 * to import. Partial catalogues are never mistaken for delistings.
 */
import type { AkizukiRawGenre, AkizukiRawItem, AkizukiRawSnapshot } from '../../adapters/akizuki/rawSchema.ts';
import { AKIZUKI_RAW_SCHEMA_VERSION } from '../../adapters/akizuki/rawSchema.ts';
import { FetchFailedError, PoliteFetcher, RequestBudgetExceededError } from '../politeFetcher.ts';
import { AKIZUKI_BASE_URL, AKIZUKI_DEFAULT_GENRES, akizukiGenreUrl } from './genres.ts';
import { ListingParseError, parseAkizukiListingPage, type ListingItem, type ListingPage } from './listingParser.ts';

export interface CrawlOptions {
  fetcher: PoliteFetcher;
  genres?: readonly string[];
  baseUrl?: string;
  /** Safety cap; a genre with more pages is reported as an error. Default 200. */
  maxPagesPerGenre?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface CrawlResult {
  snapshot: AkizukiRawSnapshot;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface Occurrence {
  item: ListingItem;
  genre: { name: string; url: string };
  page: number;
}

interface GenreCrawl {
  record: AkizukiRawGenre;
  occurrences: Occurrence[];
  errors: string[];
  warnings: string[];
}

async function crawlGenre(slug: string, o: Required<Pick<CrawlOptions, 'fetcher' | 'baseUrl' | 'maxPagesPerGenre'>> & Pick<CrawlOptions, 'log'>): Promise<GenreCrawl> {
  const url = akizukiGenreUrl(o.baseUrl, slug);
  const errors: string[] = [];
  const warnings: string[] = [];
  const occurrences: Occurrence[] = [];
  let name = slug;
  let listedTotal = 0;
  let totalPages = 0;
  let successfulPages = 0;
  let failedPages = 0;

  const fetchPage = async (page: number): Promise<ListingPage | null> => {
    const pageUrl = akizukiGenreUrl(o.baseUrl, slug, page);
    try {
      const html = await o.fetcher.fetchText(pageUrl);
      const parsed = parseAkizukiListingPage(html);
      if (parsed.currentPage !== page) {
        errors.push(`${slug} page ${page}: server returned page ${parsed.currentPage}`);
        failedPages++;
        return null;
      }
      for (const issue of parsed.issues) warnings.push(`${slug} page ${page}: ${issue}`);
      successfulPages++;
      return parsed;
    } catch (e) {
      if (e instanceof RequestBudgetExceededError) throw e;
      const reason = e instanceof FetchFailedError || e instanceof ListingParseError ? e.message : `unexpected ${String(e)}`;
      errors.push(`${slug} page ${page}: ${reason}`);
      failedPages++;
      return null;
    }
  };

  const firstPage = await fetchPage(1);
  if (firstPage !== null) {
    name = firstPage.genreName;
    listedTotal = firstPage.listedTotal;
    totalPages = firstPage.lastPage;
    if (totalPages > o.maxPagesPerGenre) {
      errors.push(`${slug}: ${totalPages} pages exceed the cap of ${o.maxPagesPerGenre}`);
      totalPages = 0;
    } else {
      const genre = { name, url };
      for (const item of firstPage.items) occurrences.push({ item, genre, page: 1 });
      for (let page = 2; page <= totalPages; page++) {
        const parsed = await fetchPage(page);
        if (parsed === null) continue;
        for (const item of parsed.items) occurrences.push({ item, genre, page });
        if (parsed.nextPath === null && page < totalPages) {
          errors.push(`${slug} page ${page}: no next link although ${totalPages} pages were announced`);
          break;
        }
      }
    }
  }
  const extractedOccurrences = occurrences.length;
  const record: AkizukiRawGenre = {
    name,
    url,
    listedTotal,
    totalPages,
    successfulPages,
    failedPages,
    extractedOccurrences,
    matchesListedTotal: failedPages === 0 && errors.length === 0 && extractedOccurrences === listedTotal,
  };
  o.log?.(`[crawl] ${slug} "${name}" pages=${successfulPages}/${totalPages} occurrences=${extractedOccurrences}/${listedTotal}${record.matchesListedTotal ? '' : ' MISMATCH'}`);
  return { record, occurrences, errors, warnings };
}

function sameListing(a: ListingItem, b: ListingItem): boolean {
  return JSON.stringify([a.prices, a.stock.status, a.stock.purchasable]) === JSON.stringify([b.prices, b.stock.status, b.stock.purchasable]);
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
      byKey.set(key, { ...item, sourceGenres: [occ.genre], sourcePage: occ.page, positionOnPage, duplicateOccurrences: 0 });
      firstSeen.set(key, occ.item);
      continue;
    }
    existing.duplicateOccurrences = (existing.duplicateOccurrences ?? 0) + 1;
    if (!existing.sourceGenres!.some((g) => g.url === occ.genre.url)) existing.sourceGenres!.push(occ.genre);
    const first = firstSeen.get(key)!;
    if (!sameListing(first, occ.item)) {
      disagreements++;
      if (disagreements <= 20) {
        warnings.push(`${key}: listing differs between genres (${first.prices[0]?.display ?? 'no price'} "${first.stock.status}" vs ${occ.item.prices[0]?.display ?? 'no price'} "${occ.item.stock.status}")`);
      }
    }
  }
  if (disagreements > 20) warnings.push(`${disagreements} sales codes showed differing listings across genres (first 20 reported)`);
  return [...byKey.values()];
}

export async function crawlAkizuki(options: CrawlOptions): Promise<CrawlResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const genres = options.genres ?? AKIZUKI_DEFAULT_GENRES;
  const o = { fetcher: options.fetcher, baseUrl: options.baseUrl ?? AKIZUKI_BASE_URL, maxPagesPerGenre: options.maxPagesPerGenre ?? 200, ...(options.log === undefined ? {} : { log: options.log }) };
  const errors: string[] = [];
  const warnings: string[] = [];
  const genreRecords: AkizukiRawGenre[] = [];
  const occurrences: Occurrence[] = [];
  const seenSlugs = new Set<string>();
  for (const slug of genres) {
    if (seenSlugs.has(slug)) {
      errors.push(`genre ${slug} configured twice`);
      continue;
    }
    seenSlugs.add(slug);
    const g = await crawlGenre(slug, o);
    genreRecords.push(g.record);
    occurrences.push(...g.occurrences);
    errors.push(...g.errors);
    warnings.push(...g.warnings);
  }
  const items = deduplicateOccurrences(occurrences, warnings);
  const finishedAt = now();
  const genreMismatches = genreRecords.filter((g) => !g.matchesListedTotal).length;
  const failedPages = genreRecords.reduce((n, g) => n + g.failedPages, 0);
  const stats = options.fetcher.stats;
  const snapshot: AkizukiRawSnapshot = {
    schemaVersion: AKIZUKI_RAW_SCHEMA_VERSION,
    source: `${o.baseUrl}/catalog/r/`,
    retrievedAt: finishedAt.toISOString(),
    complete: errors.length === 0 && failedPages === 0 && genreMismatches === 0 && items.length > 0,
    genreCount: genreRecords.length,
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
    validation: { genreMismatches, errors, warnings },
    genres: genreRecords,
    items,
  };
  return { snapshot, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime() };
}
