import type { ProductPageInventoryRaw } from '../adapters/productPageInventory.ts';
import { observationDayCount } from '../core/observationDay.ts';
import { FetchFailedError, RequestBudgetExceededError, type PoliteFetcher } from './politeFetcher.ts';

/**
 * Reads stock counts from product pages, one request per product (ADR-0027).
 * A store's catalogue may be too large to read every page on every
 * observation day, so the products are split into `shards` fixed slices by a
 * hash of their key and each observation day reads the next slice. The stage
 * never fails the run: the catalogue it enriches is already complete, and a
 * product it does not read keeps its previous count.
 */
export interface ProductPagesConfig {
  /** Slices the eligible products rotate through; 1 reads every product each run. */
  shards: number;
  /** Pages read per run at most, after slicing. */
  maxPages: number;
  /** Stop once more than this many selected pages failed. */
  maxFailures: number;
  /** Stop once the stage has run this long; the crawl job is shared by every store. */
  maxMinutes: number;
}

export interface ProductPageTarget {
  /** The product's stable key; it decides the slice. */
  key: string;
  url: string;
  /** The offers (variants) a count may be reported for. */
  offerIds: readonly string[];
}

/** Reads the counts a product page shows, by offer id. Throws on a page it does not recognise. */
/** Counts by offer id; `null` = the page was read but shows no usable count for that offer. */
export type ProductPageReader = (html: string, target: ProductPageTarget) => Record<string, number | null>;

/** Consecutive fetch failures (other than a removed product) that mean the store is not answering. */
const MAX_CONSECUTIVE_FETCH_FAILURES = 3;

function int(v: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) {
    throw new Error(`collector.productPages.${name} must be an integer from ${min} to ${max}`);
  }
  return v as number;
}

/** The optional `collector.productPages` config section; null when the store does not read product pages. */
export function parseProductPagesConfig(value: unknown): ProductPagesConfig | null {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('collector.productPages must be an object');
  const v = value as Record<string, unknown>;
  return {
    shards: int(v['shards'], 'shards', 1, 30),
    maxPages: int(v['maxPages'], 'maxPages', 1, 5000),
    maxFailures: int(v['maxFailures'], 'maxFailures', 0, 500),
    maxMinutes: int(v['maxMinutes'], 'maxMinutes', 1, 180),
  };
}

/** FNV-1a: a stable hash, so a product stays in the same slice across runs and machines. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function shardOf(key: string, shards: number): number {
  return fnv1a(key) % shards;
}

/**
 * This round's slice of the targets, capped at `maxPages`. The order is a hash
 * of the key and the round, so when a cap or the time limit cuts a slice short,
 * a different part of it goes unread each round rather than the same products.
 */
export function selectRotation(targets: readonly ProductPageTarget[], round: number, config: Pick<ProductPagesConfig, 'shards' | 'maxPages'>) {
  const shard = ((round % config.shards) + config.shards) % config.shards;
  const order = (key: string) => fnv1a(`${round}:${key}`);
  const slice = targets
    .filter((t) => shardOf(t.key, config.shards) === shard)
    .map((t) => ({ t, o: order(t.key) }))
    .sort((a, b) => a.o - b.o || (a.t.key < b.t.key ? -1 : a.t.key > b.t.key ? 1 : 0))
    .slice(0, config.maxPages)
    .map((x) => x.t);
  return { shard, slice };
}

export interface ReadProductPagesOptions {
  fetcher: PoliteFetcher;
  targets: readonly ProductPageTarget[];
  reader: ProductPageReader;
  config: ProductPagesConfig;
  /** The run's observation time: it picks the slice. */
  observedAtMs: number;
  /** Clock for the stage's time limit. */
  nowMs: () => number;
  log: (message: string) => void;
  tag: string;
}

export async function readProductPages(o: ReadProductPagesOptions): Promise<ProductPageInventoryRaw> {
  const round = observationDayCount(o.observedAtMs);
  const { shard, slice } = selectRotation(o.targets, round, o.config);
  const out: ProductPageInventoryRaw = {
    round, shards: o.config.shards, shard, eligible: o.targets.length, selected: slice.length, read: 0,
    failures: [], stopped: null, quantities: {},
  };
  o.log(`${o.tag} product pages: slice ${shard + 1}/${o.config.shards}, ${slice.length} of ${o.targets.length} eligible`);
  const startedAt = o.nowMs();
  let consecutive = 0;
  for (const target of slice) {
    if (o.nowMs() - startedAt >= o.config.maxMinutes * 60_000) {
      out.stopped = `time limit of ${o.config.maxMinutes} min reached after ${out.read} pages`;
      break;
    }
    let html: string;
    try {
      html = await o.fetcher.fetchText(target.url);
    } catch (e) {
      if (e instanceof RequestBudgetExceededError) { out.stopped = e.message; break; }
      if (!(e instanceof FetchFailedError)) throw e;
      out.failures.push({ key: target.key, reason: e.message });
      // A removed product answers 404 or 410; anything else means the store is
      // struggling or asking us to stop, so give up rather than keep asking.
      if (e.status === 404 || e.status === 410) {
        consecutive = 0;
      } else if (e.status === 429 || ++consecutive >= MAX_CONSECUTIVE_FETCH_FAILURES) {
        out.stopped = e.status === 429 ? `rate limited: ${e.message}` : `${consecutive} consecutive fetch failures: ${e.message}`;
        break;
      }
      if (out.failures.length > o.config.maxFailures) { out.stopped = `more than ${o.config.maxFailures} failed pages`; break; }
      continue;
    }
    consecutive = 0;
    try {
      const counts = o.reader(html, target);
      for (const [offerId, n] of Object.entries(counts)) {
        if (!target.offerIds.includes(offerId)) throw new Error(`count for unknown offer ${offerId}`);
        if (n !== null && (!Number.isSafeInteger(n) || n < 0)) throw new Error(`invalid count ${n} for offer ${offerId}`);
      }
      Object.assign(out.quantities, counts);
      out.read += 1;
    } catch (e) {
      out.failures.push({ key: target.key, reason: `unrecognised page: ${(e as Error).message}` });
      if (out.failures.length > o.config.maxFailures) { out.stopped = `more than ${o.config.maxFailures} failed pages`; break; }
    }
    if (out.read > 0 && out.read % 100 === 0) o.log(`${o.tag} product pages: ${out.read}/${slice.length} read`);
  }
  o.log(`${o.tag} product pages: ${out.read}/${slice.length} read, ${out.failures.length} failed${out.stopped === null ? '' : `, stopped: ${out.stopped}`}`);
  return out;
}

/** The warnings a stage result adds to the run report. */
export function productPageWarnings(raw: ProductPageInventoryRaw): string[] {
  const warnings: string[] = [];
  if (raw.stopped !== null) warnings.push(`Product pages stopped early (${raw.read}/${raw.selected} read): ${raw.stopped}`);
  if (raw.failures.length > 0) {
    warnings.push(`${raw.failures.length} product page(s) not read, e.g. ${raw.failures.slice(0, 3).map((f) => `${f.key}: ${f.reason}`).join('; ')}`);
  }
  return warnings;
}
