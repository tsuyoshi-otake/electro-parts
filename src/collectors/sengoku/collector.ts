import { SENGOKU_ORIGIN, SENGOKU_STORE_ID } from '../../adapters/sengoku/identity.ts';
import { SENGOKU_PAGE_SIZE, SENGOKU_ROOT_CID, SENGOKU_SEARCH_CAP, type SengokuItem, type SengokuSnapshot } from '../../adapters/sengoku/rawSchema.ts';
import type { StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher } from '../politeFetcher.ts';
import { parseSengokuCategoryTree, parseSengokuListingPage, type SengokuCategory, type SengokuListingRow } from './pages.ts';

/**
 * せんごくネット通販 collector (ADR-0024).
 *
 * Reads the category tree of 電子工作部品 from its category page, then every
 * top category's listing in pages of 40. A search returns at most 4000
 * products and says so in its counter, so a listing that reports 4000 is
 * read through its subcategories instead, one level down, then another; a
 * capped listing without subcategories ends the crawl as incomplete.
 *
 * Every page must repeat the listing's total and cover exactly the rows its
 * counter names (S = st + 1, E = min(st + 40, T), E − S + 1 rows). The shop
 * prints an exactly full last page after the first as E = st (「241件～240件
 * (全280件)」); that page must still hold 40 rows. A product
 * listed in several categories is kept once, with every listing it appeared
 * in. Plain GETs, no cookies, the shop's own listing URLs.
 */

function configNumber(c: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const n = c[key] ?? fallback;
  if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) throw new Error(`Invalid collector.${key}`);
  return n as number;
}

export function sengokuCollectorConfig(c: Record<string, unknown>) {
  if (typeof c['userAgent'] !== 'string' || c['userAgent'].trim().length < 8) throw new Error('collector.userAgent must identify the project');
  return {
    userAgent: c['userAgent'],
    minIntervalMs: configNumber(c, 'minIntervalMs', 2000, 1000, 60000),
    jitterMs: configNumber(c, 'jitterMs', 1000, 0, 60000),
    maxAttempts: configNumber(c, 'maxAttempts', 4, 1, 8),
    timeoutMs: configNumber(c, 'timeoutMs', 30000, 1000, 60000),
    maxRequests: configNumber(c, 'maxRequests', 2000, 1, 5000),
  };
}

export function sengokuCategoryUrl(cid: number): string {
  return `${SENGOKU_ORIGIN}/mod/sgk_cart/category.php?cid=${cid}`;
}

/** The listing URLs the shop's own pager links to. */
export function sengokuListingUrl(cid: number, st: number): string {
  return `${SENGOKU_ORIGIN}/mod/sgk_cart/search.php?cid=${cid}${st === 0 ? '' : `&st=${st}`}`;
}

function sameFacts(a: SengokuListingRow, b: SengokuListingRow): boolean {
  return a.name === b.name && a.maker === b.maker && a.model === b.model && a.outOfStockClass === b.outOfStockClass
    && a.stockMark === b.stockMark && JSON.stringify(a.priceLines) === JSON.stringify(b.priceLines);
}

export const sengokuCollector: StoreCollector = {
  storeId: SENGOKU_STORE_ID,
  validateConfig(c) {
    sengokuCollectorConfig(c);
  },
  async collect(config, deps) {
    const c = sengokuCollectorConfig(config);
    const fetcher = new PoliteFetcher({
      ...c,
      headers: { accept: 'text/html' },
      log: deps.log,
      ...(deps.transport === undefined ? {} : { transport: deps.transport }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.random === undefined ? {} : { random: deps.random }),
      ...(deps.now === undefined ? {} : { now: () => deps.now!().getTime() }),
    });
    const s: SengokuSnapshot = { schemaVersion: 1, retrievedAt: '', complete: false, rootCid: SENGOKU_ROOT_CID, listings: [], splitListings: [], items: [], errors: [] };
    const byCode = new Map<string, SengokuItem>();
    const warnings: string[] = [];
    let differing = 0;
    let emptyListings = 0;
    let listPages = 0;

    const keep = (row: SengokuListingRow, cid: number) => {
      const known = byCode.get(row.code);
      if (known === undefined) {
        byCode.set(row.code, { ...row, listings: [cid] });
        return;
      }
      if (!sameFacts(known, row)) {
        differing += 1;
        if (warnings.length < 20) warnings.push(`product ${row.code}: listing ${cid} shows it differently from listing ${known.listings[0]!}; the first is kept`);
      }
      known.listings.push(cid);
    };

    const readPage = async (cid: number, st: number) => {
      const html = await fetcher.fetchText(sengokuListingUrl(cid, st));
      try {
        return parseSengokuListingPage(html);
      } catch (e) {
        throw new Error(`Listing ${cid} at ${st}: ${(e as Error).message}`);
      } finally {
        listPages += 1;
      }
    };

    const readListing = async (category: SengokuCategory): Promise<void> => {
      const { cid, name } = category;
      const first = await readPage(cid, 0);
      const total = first.total;
      if (total >= SENGOKU_SEARCH_CAP) {
        if (category.children.length === 0) throw new Error(`Listing ${cid} (${name}) reports ${total} products, the search cap, and has no subcategories to read instead`);
        deps.log(`[sengoku] ${cid} ${name}: ${total} (the cap), reading its ${category.children.length} subcategories`);
        s.splitListings.push(cid);
        for (const child of category.children) await readListing(child);
        return;
      }
      if (total === 0) {
        if (first.rows.length !== 0) throw new Error(`Listing ${cid}: ${first.rows.length} rows under a total of 0`);
        emptyListings += 1;
        return;
      }
      const codes = new Set<string>();
      let page = first;
      for (let st = 0; st < total; st += SENGOKU_PAGE_SIZE) {
        if (st > 0) page = await readPage(cid, st);
        const at = `Listing ${cid} at ${st}`;
        if (page.total !== total) throw new Error(`${at}: the listed total changed from ${total} to ${page.total} during the crawl`);
        const end = Math.min(st + SENGOKU_PAGE_SIZE, total);
        // The shop prints an exactly full last page after the first as S–(S−1): 「241件～240件(全280件)」.
        const fullLastPage = st > 0 && end === st + SENGOKU_PAGE_SIZE && end === total && page.end === st;
        if (page.start !== st + 1 || (page.end !== end && !fullLastPage)) throw new Error(`${at}: the counter says ${page.start}–${page.end} where ${st + 1}–${end} was asked for`);
        if (page.rows.length !== end - st) throw new Error(`${at}: ${page.rows.length} rows where the counter promised ${end - st}`);
        for (const row of page.rows) {
          if (codes.has(row.code)) throw new Error(`${at}: repeated product ${row.code}`);
          codes.add(row.code);
          keep(row, cid);
        }
      }
      s.listings.push({ cid, name, listedTotal: total, pageCount: Math.ceil(total / SENGOKU_PAGE_SIZE) });
      deps.log(`[sengoku] ${cid} ${name}: ${total} products (${byCode.size} distinct so far)`);
    };

    try {
      const tree = parseSengokuCategoryTree(await fetcher.fetchText(sengokuCategoryUrl(SENGOKU_ROOT_CID)), SENGOKU_ROOT_CID);
      for (const category of tree) await readListing(category);
      if (byCode.size === 0) throw new Error('Empty catalogue');
      s.items = [...byCode.values()].map((item) => ({ ...item, listings: [...item.listings].sort((a, b) => a - b) }));
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
        listPages, differingDuplicates: differing,
        httpAttempts: fetcher.stats.httpAttempts, retries: fetcher.stats.retries, waitedMs: fetcher.stats.waitedMs,
      },
    };
  },
};
