import { KSY_ORIGIN, KSY_STORE_ID } from '../../adapters/ksy/identity.ts';
import { KSY_MAX_PAGE_SIZE, KSY_MIN_PAGE_SIZE, KSY_UNPRICED, parseKsyListPage, type KsySnapshot } from '../../adapters/ksy/rawSchema.ts';
import type { StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher } from '../politeFetcher.ts';

/**
 * Raspberry Pi Shop by KSY collector (ADR-0023).
 *
 * Reads the storefront's public product list, the JSON its own page loads
 * from `remote_proxy.cfc`, with plain GETs: no cookies, no session and no
 * page token are needed. Only the public list is read. Products hidden from
 * it are reachable by id, but those include customer-specific payment items,
 * so ids are never enumerated.
 *
 * Pages are addressed by `offset` (a `page` parameter is ignored and returns
 * the first page again) in registration order, oldest first, so a product
 * added during the crawl lands after every page already read. The list's own
 * `size` is the completeness oracle: every page must repeat it and the
 * collected ids must reach it exactly. Anything else ends the crawl as
 * incomplete rather than guessing.
 */

function configNumber(c: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const n = c[key] ?? fallback;
  if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) throw new Error(`Invalid collector.${key}`);
  return n as number;
}

export function ksyCollectorConfig(c: Record<string, unknown>) {
  if (typeof c['userAgent'] !== 'string' || c['userAgent'].trim().length < 8) throw new Error('collector.userAgent must identify the project');
  return {
    userAgent: c['userAgent'],
    pageSize: configNumber(c, 'pageSize', 50, KSY_MIN_PAGE_SIZE, KSY_MAX_PAGE_SIZE),
    maxPages: configNumber(c, 'maxPages', 40, 1, 200),
    minIntervalMs: configNumber(c, 'minIntervalMs', 1500, 500, 60000),
    jitterMs: configNumber(c, 'jitterMs', 750, 0, 60000),
    maxAttempts: configNumber(c, 'maxAttempts', 4, 1, 8),
    timeoutMs: configNumber(c, 'timeoutMs', 30000, 1000, 60000),
    maxRequests: configNumber(c, 'maxRequests', 100, 1, 1000),
  };
}

/** One page of the public list, registration date ascending. */
export function ksyListUrl(offset: number, pageSize: number): string {
  const args = { ev: 'product.list', conditions: { offset, max: pageSize, sort: 7, sortdesc: 0 } };
  const query = new URLSearchParams({ method: 'process', returnFormat: 'json', argumentCollection: JSON.stringify({ args }) });
  return `${KSY_ORIGIN}/remote_proxy.cfc?${query.toString()}`;
}

export const ksyCollector: StoreCollector = {
  storeId: KSY_STORE_ID,
  validateConfig(c) {
    ksyCollectorConfig(c);
  },
  async collect(config, deps) {
    const c = ksyCollectorConfig(config);
    const fetcher = new PoliteFetcher({
      ...c,
      headers: { accept: 'application/json' },
      log: deps.log,
      ...(deps.transport === undefined ? {} : { transport: deps.transport }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.random === undefined ? {} : { random: deps.random }),
      ...(deps.now === undefined ? {} : { now: () => deps.now!().getTime() }),
    });
    const s: KsySnapshot = { schemaVersion: 1, retrievedAt: '', complete: false, listedTotal: 0, pageSize: c.pageSize, pageCount: 0, items: [], errors: [] };
    try {
      const ids = new Set<number>();
      let total: number | null = null;
      let exhausted = false;
      for (let page = 1; page <= c.maxPages; page++) {
        const offset = (page - 1) * c.pageSize;
        const list = parseKsyListPage(await fetcher.fetchText(ksyListUrl(offset, c.pageSize)));
        if (list.offset !== offset) throw new Error(`Page ${page}: the shop answered offset ${list.offset} for ${offset}`);
        if (total === null) total = list.size;
        else if (list.size !== total) throw new Error(`Page ${page}: the listed total changed from ${total} to ${list.size} during the crawl`);
        s.listedTotal = total;
        const expected = Math.max(0, Math.min(c.pageSize, total - offset));
        if (list.items.length !== expected) throw new Error(`Page ${page}: ${list.items.length} products where the list promised ${expected}`);
        for (const item of list.items) {
          if (ids.has(item.id)) throw new Error(`Page ${page}: repeated product ${item.id}`);
          ids.add(item.id);
          s.items.push(item);
        }
        s.pageCount = page;
        deps.log(`[ksy] page ${page}: ${list.items.length} products (${s.items.length}/${total})`);
        if (offset + c.pageSize >= total) {
          exhausted = true;
          break;
        }
      }
      if (!exhausted) throw new Error('List page cap reached before completion');
      if (!s.items.length) throw new Error('Empty catalogue');
      s.complete = true;
    } catch (e) {
      s.errors.push((e as Error).message);
    }
    s.retrievedAt = (deps.now?.() ?? new Date()).toISOString();
    return {
      raw: s, retrievedAt: s.retrievedAt, complete: s.complete, errors: s.errors, warnings: [],
      metrics: {
        items: s.items.length, listedTotal: s.listedTotal, listPages: s.pageCount,
        unpriced: s.items.filter((item) => item.price === KSY_UNPRICED).length,
        httpAttempts: fetcher.stats.httpAttempts, retries: fetcher.stats.retries, waitedMs: fetcher.stats.waitedMs,
      },
    };
  },
};
