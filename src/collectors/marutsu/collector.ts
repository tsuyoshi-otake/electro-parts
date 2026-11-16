import { MARUTSU_ORIGIN, MARUTSU_STORE_ID } from '../../adapters/marutsu/identity.ts';
import {
  MARUTSU_PAGE_SIZE, MARUTSU_SEARCH_CAP, MARUTSU_TOP_CATEGORIES,
  type MarutsuItem, type MarutsuSnapshot,
} from '../../adapters/marutsu/rawSchema.ts';
import type { StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher } from '../politeFetcher.ts';
import { parseMarutsuListingPage, parseMarutsuSubcategories, type MarutsuListingPage, type MarutsuListingRow } from './pages.ts';

/**
 * マルツオンライン collector (ADR-0036).
 *
 * Reads the stocked-only listings (`ids=1`, the shop's 「明日出荷在庫品」
 * filter) of seven top categories. A listing never serves more than
 * 4000 rows, so a category whose stocked total reaches the cap is read
 * through its subcategories instead, discovered from the shop's category
 * index (`GoodsAllCategoryList.jsp`); a subcategory that still reports
 * the cap ends the crawl as incomplete.
 *
 * Every page must repeat the listing's total, say it is the page that
 * was asked for, and hold exactly the rows its counter names. A product
 * listed in several categories is kept once, with every listing it
 * appeared in. Plain GETs, no cookies, the shop's own listing URLs.
 *
 * Pages are read by number, so a product added or removed while a
 * listing is being read shifts every later row: the pass is
 * inconsistent, and the counter shows it (the total changes). Such a
 * pass is discarded whole and the listing is read again from its first
 * page, after a wait that doubles with each further pass, up to
 * `maxListingPasses` passes; one that never holds still ends the crawl
 * incomplete (the same discipline as せんごく, #88).
 */

/** The wait before the second pass over a listing; each further pass doubles it, and random jitter up to half of it is added. */
export const MARUTSU_REREAD_SETTLE_MS = 60_000;

function configNumber(c: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const n = c[key] ?? fallback;
  if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) throw new Error(`Invalid collector.${key}`);
  return n as number;
}

export function marutsuCollectorConfig(c: Record<string, unknown>) {
  if (typeof c['userAgent'] !== 'string' || c['userAgent'].trim().length < 8) throw new Error('collector.userAgent must identify the project');
  return {
    userAgent: c['userAgent'],
    minIntervalMs: configNumber(c, 'minIntervalMs', 2000, 1000, 60000),
    jitterMs: configNumber(c, 'jitterMs', 1000, 0, 60000),
    maxAttempts: configNumber(c, 'maxAttempts', 4, 1, 8),
    timeoutMs: configNumber(c, 'timeoutMs', 30000, 1000, 60000),
    maxRequests: configNumber(c, 'maxRequests', 2000, 1, 5000),
    maxListingPasses: configNumber(c, 'maxListingPasses', 2, 1, 4),
  };
}

/** The stocked-only listing URL the shop's own filter button leads to. */
export function marutsuListingUrl(categoryPath: string, page: number): string {
  return `${MARUTSU_ORIGIN}/GoodsListNavi.jsp?category=${categoryPath}&ids=1&page=${page}&perpage=${MARUTSU_PAGE_SIZE}&sort_order=no_order`;
}

export function marutsuCategoryIndexUrl(): string {
  return `${MARUTSU_ORIGIN}/GoodsAllCategoryList.jsp`;
}

/** A pass over one listing that saw its total change: the pass is unusable, whether to read again is the caller's decision. */
class ListingChangedError extends Error {
  constructor(readonly at: string, readonly from: number, readonly to: number) {
    super(`${at}: the listed total changed from ${from} to ${to} during the crawl`);
  }
}

function sameFacts(a: MarutsuListingRow, b: MarutsuListingRow): boolean {
  return a.name === b.name && a.maker === b.maker && a.model === b.model && a.marutsuCode === b.marutsuCode
    && a.stockQuantity === b.stockQuantity && a.stockNote === b.stockNote && a.shipText === b.shipText
    && a.qualityRank === b.qualityRank && a.minOrderQuantity === b.minOrderQuantity
    && JSON.stringify(a.priceTiers) === JSON.stringify(b.priceTiers);
}

export const marutsuCollector: StoreCollector = {
  storeId: MARUTSU_STORE_ID,
  validateConfig(c) {
    marutsuCollectorConfig(c);
  },
  async collect(config, deps) {
    const { maxListingPasses, ...fetchOptions } = marutsuCollectorConfig(config);
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const random = deps.random ?? Math.random;
    const fetcher = new PoliteFetcher({
      ...fetchOptions,
      headers: { accept: 'text/html' },
      log: deps.log,
      ...(deps.transport === undefined ? {} : { transport: deps.transport }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.random === undefined ? {} : { random: deps.random }),
      ...(deps.now === undefined ? {} : { now: () => deps.now!().getTime() }),
    });
    const s: MarutsuSnapshot = {
      schemaVersion: 1, retrievedAt: '', complete: false,
      categories: MARUTSU_TOP_CATEGORIES.map((c) => c.path), listings: [], splitListings: [], items: [], errors: [],
    };
    const byId = new Map<string, MarutsuItem>();
    const warnings: string[] = [];
    let differing = 0;
    let emptyListings = 0;
    let listPages = 0;
    let rereads = 0;
    let rereadWaitedMs = 0;
    let categoryIndexHtml: string | null = null;

    const keep = (row: MarutsuListingRow, path: string) => {
      const known = byId.get(row.pageId);
      if (known === undefined) {
        byId.set(row.pageId, { ...row, listings: [path] });
        return;
      }
      if (!sameFacts(known, row)) {
        differing += 1;
        if (warnings.length < 20) warnings.push(`product ${row.pageId}: listing ${path} shows it differently from listing ${known.listings[0]!}; the first is kept`);
      }
      if (!known.listings.includes(path)) known.listings.push(path);
    };

    const readPage = async (path: string, page: number) => {
      const html = await fetcher.fetchText(marutsuListingUrl(path, page));
      try {
        return parseMarutsuListingPage(html);
      } catch (e) {
        throw new Error(`Listing ${path} page ${page}: ${(e as Error).message}`);
      } finally {
        listPages += 1;
      }
    };

    /** One pass over the pages of a listing. Rows are returned, not kept: nothing is recorded until every page of the pass agrees. */
    const readPass = async (path: string, first: MarutsuListingPage): Promise<MarutsuListingRow[]> => {
      const total = first.total;
      const rows: MarutsuListingRow[] = [];
      const ids = new Set<string>();
      const pageCount = Math.ceil(total / MARUTSU_PAGE_SIZE);
      for (let page = 1; page <= pageCount; page += 1) {
        const current = page === 1 ? first : await readPage(path, page);
        const at = `Listing ${path} page ${page}`;
        if (current.total !== total) throw new ListingChangedError(at, total, current.total);
        if (current.page !== page) throw new Error(`${at}: the page says it is page ${current.page}`);
        if (current.perPage !== MARUTSU_PAGE_SIZE) throw new Error(`${at}: the page shows ${current.perPage} rows per page, not ${MARUTSU_PAGE_SIZE}`);
        const expected = Math.min(page * MARUTSU_PAGE_SIZE, total) - (page - 1) * MARUTSU_PAGE_SIZE;
        if (current.rows.length !== expected) throw new Error(`${at}: ${current.rows.length} rows where the counter promised ${expected}`);
        for (const row of current.rows) {
          if (ids.has(row.pageId)) throw new Error(`${at}: repeated product ${row.pageId}`);
          ids.add(row.pageId);
          rows.push(row);
        }
      }
      return rows;
    };

    const subcategoriesOf = async (topPath: string) => {
      categoryIndexHtml ??= await fetcher.fetchText(marutsuCategoryIndexUrl());
      try {
        return parseMarutsuSubcategories(categoryIndexHtml, topPath);
      } catch (e) {
        throw new Error(`Category index: ${(e as Error).message}`);
      }
    };

    const readListing = async (category: { path: string; name: string }, isSubcategory = false, pass = 1): Promise<void> => {
      const { path, name } = category;
      const first = await readPage(path, 1);
      const total = first.total;
      if (total >= MARUTSU_SEARCH_CAP) {
        if (isSubcategory) throw new Error(`Listing ${path} (${name}) reports ${total} products, the search cap, and is not read any deeper`);
        const subcategories = await subcategoriesOf(path);
        deps.log(`[marutsu] ${path} ${name}: ${total} (the cap), reading its ${subcategories.length} subcategories`);
        s.splitListings.push(path);
        for (const sub of subcategories) await readListing(sub, true);
        return;
      }
      if (total === 0) {
        if (first.rows.length !== 0) throw new Error(`Listing ${path}: ${first.rows.length} rows under a total of 0`);
        emptyListings += 1;
        return;
      }
      let rows: MarutsuListingRow[];
      try {
        rows = await readPass(path, first);
      } catch (e) {
        if (!(e instanceof ListingChangedError) || pass >= maxListingPasses) throw e;
        rereads += 1;
        warnings.push(`listing ${path} (${name}): the listed total changed from ${e.from} to ${e.to} during the crawl; read again from its first page (pass ${pass + 1} of ${maxListingPasses})`);
        const waitMs = MARUTSU_REREAD_SETTLE_MS * 2 ** (pass - 1) * (1 + random() / 2);
        deps.log(`[marutsu] ${path} ${name}: ${e.message}; waiting ${Math.round(waitMs / 1000)} s, then reading it again (pass ${pass + 1} of ${maxListingPasses})`);
        rereadWaitedMs += waitMs;
        await sleep(waitMs);
        return readListing(category, isSubcategory, pass + 1);
      }
      for (const row of rows) keep(row, path);
      s.listings.push({ categoryPath: path, name, listedTotal: total, pageCount: Math.ceil(total / MARUTSU_PAGE_SIZE) });
      deps.log(`[marutsu] ${path} ${name}: ${total} products (${byId.size} distinct so far)`);
    };

    try {
      for (const category of MARUTSU_TOP_CATEGORIES) await readListing(category);
      if (byId.size === 0) throw new Error('Empty catalogue');
      s.items = [...byId.values()];
      s.complete = true;
    } catch (e) {
      s.errors.push((e as Error).message);
    }
    if (differing > warnings.length) warnings.push(`${differing - warnings.length} more products differ between listings`);
    s.retrievedAt = (deps.now?.() ?? new Date()).toISOString();
    return {
      raw: s, retrievedAt: s.retrievedAt, complete: s.complete, errors: s.errors, warnings,
      metrics: {
        items: s.items.length, listings: s.listings.length, splitListings: s.splitListings.length, emptyListings,
        listPages, rereads, rereadWaitedMs, differingDuplicates: differing,
        httpAttempts: fetcher.stats.httpAttempts, retries: fetcher.stats.retries, waitedMs: fetcher.stats.waitedMs,
      },
    };
  },
};
