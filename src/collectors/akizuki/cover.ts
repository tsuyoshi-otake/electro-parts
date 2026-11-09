/**
 * Akizuki cover crawl: read the listings a weighted set cover picked instead of
 * all of them (#93, ADR-0032).
 *
 * A product sits in 5 to 9 listings on average, so reading every listing reads
 * every product about 6.6 times. The time of a crawl is the number of requests
 * times the polite interval, so the lever is the number of pages, not CPU. A
 * full crawl records which products each listing showed (`CoverSource`); the
 * days after it read only a greedy cover of that membership (`planCover`), put
 * back what the cover missed (`pickRepair`) and read everything again when too
 * much is missing. Nothing here touches the network or the file system: the
 * crawl owns the requests and the collector owns the cache file.
 *
 * Only the card layout states a cart and a stock quantity, so the cover takes
 * card listings first and falls back to table listings (and to listings the
 * site truncates at 3,000 results, whose membership is not stable) only for
 * products no card listing shows. A full crawl prefers a card occurrence over
 * a table one for the same reason (`isRicher` in `crawl.ts`).
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ListingKind } from './listings.ts';
import type { AkizukiSitemap } from './sitemap.ts';

export const COVER_SOURCE_VERSION = 1;

/** One listing as a full crawl saw it. */
export interface CoverListing {
  /** `c/<slug>` or `r/<slug>`. */
  id: string;
  /** Pages a read of the whole listing costs. */
  pages: number;
  layout: 'card' | 'table';
  /** The site stops a listing at 3,000 results; what it shows then depends on its ordering. */
  truncated: boolean;
  /** Indexes into `CoverSource.products`, ascending and unique. */
  codes: number[];
}

/** What the last complete full crawl learned about which listing shows which product. */
export interface CoverSource {
  version: typeof COVER_SOURCE_VERSION;
  /** When that full crawl finished (its `retrievedAt`). */
  builtAt: string;
  /** Listing families it walked; a cover run must walk the same ones. */
  families: ListingKind[];
  /** Sales codes it saw, ascending. */
  products: string[];
  listings: CoverListing[];
}

export interface CoverSettings {
  /** A full crawl at least this many days after the one the cover was built from. */
  fullCrawlEveryDays: number;
  /** Listings a cover run may read beyond the plan to find products the plan missed. */
  maxRepairListings: number;
  /** A cover run still missing more products than this after repair reads every other listing too. */
  escalateAfterMissing: number;
}

export interface ListingMembership {
  id: string;
  pages: number;
  layout: 'card' | 'table';
  truncated: boolean;
  codes: readonly string[];
}

export function buildCoverSource(builtAt: string, families: readonly ListingKind[], memberships: readonly ListingMembership[]): CoverSource {
  const products = [...new Set(memberships.flatMap((m) => m.codes))].sort();
  const indexOf = new Map(products.map((code, i) => [code, i]));
  const listings = memberships
    .filter((m) => m.codes.length > 0)
    .map((m): CoverListing => ({
      id: m.id,
      pages: Math.max(1, m.pages),
      layout: m.layout,
      truncated: m.truncated,
      codes: [...new Set(m.codes.map((code) => indexOf.get(code) as number))].sort((a, b) => a - b),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { version: COVER_SOURCE_VERSION, builtAt, families: [...families].sort(), products, listings };
}

const isStable = (l: CoverListing): boolean => l.layout === 'card' && !l.truncated;

/**
 * The pool is walked greedily: the listing that adds the most uncovered
 * products per page goes first (ties: more products, then the smaller id), so
 * the order is also the order to read in. `covered` and `remaining` are shared
 * with the next pool.
 */
function greedy(pool: readonly CoverListing[], covered: Uint8Array, remaining: { n: number }, chosen: CoverListing[]): void {
  let alive = [...pool];
  while (remaining.n > 0 && alive.length > 0) {
    let best: CoverListing | null = null;
    let bestGain = 0;
    let bestScore = 0;
    const next: CoverListing[] = [];
    for (const l of alive) {
      let gain = 0;
      for (const i of l.codes) if (covered[i] === 0) gain += 1;
      if (gain === 0) continue; // gains only shrink, so it never comes back
      next.push(l);
      const score = gain / l.pages;
      if (best === null || score > bestScore || (score === bestScore && (gain > bestGain || (gain === bestGain && l.id < best.id)))) {
        best = l;
        bestGain = gain;
        bestScore = score;
      }
    }
    alive = next;
    if (best === null) break;
    chosen.push(best);
    for (const i of best.codes) {
      if (covered[i] === 0) {
        covered[i] = 1;
        remaining.n -= 1;
      }
    }
    alive = alive.filter((l) => l !== best);
  }
}

/** The listings to read, in reading order: card listings that cover everything they can, then the rest for what is left. */
export function planCover(source: CoverSource): CoverListing[] {
  const covered = new Uint8Array(source.products.length);
  const remaining = { n: source.products.length };
  const chosen: CoverListing[] = [];
  greedy(source.listings.filter(isStable), covered, remaining, chosen);
  greedy(source.listings.filter((l) => !isStable(l)), covered, remaining, chosen);
  return chosen;
}

/**
 * The cheapest not-yet-read listing that shows some of the `missing` products
 * (indexes into `source.products`), a stable card listing before any other; null
 * when none of the unread listings shows one.
 */
export function pickRepair(source: CoverSource, missing: ReadonlySet<number>, read: ReadonlySet<string>): CoverListing | null {
  let best: { l: CoverListing; stable: boolean; gain: number; score: number } | null = null;
  for (const l of source.listings) {
    if (read.has(l.id)) continue;
    let gain = 0;
    for (const i of l.codes) if (missing.has(i)) gain += 1;
    if (gain === 0) continue;
    const stable = isStable(l);
    const score = gain / l.pages;
    const better =
      best === null ||
      (stable && !best.stable) ||
      (stable === best.stable && (score > best.score || (score === best.score && (gain > best.gain || (gain === best.gain && l.id < best.l.id)))));
    if (better) best = { l, stable, gain, score };
  }
  return best === null ? null : best.l;
}

export type CoverDecision = { mode: 'full'; reason: string } | { mode: 'cover'; plan: CoverListing[]; reason: string };

/** Slack so a daily schedule whose full run finished a few hours into its day comes back to a full run exactly N days later. */
export const FULL_CRAWL_SLACK_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

export interface DecideInput {
  source: CoverSource | null;
  settings: CoverSettings | undefined;
  kinds: readonly ListingKind[];
  sitemap: AkizukiSitemap;
  now: Date;
  /** The caller named the listings itself; there is nothing to plan. */
  explicitListings: boolean;
}

/** Full or cover, and why. Every doubt resolves to a full crawl: that is what ran every day before. */
export function decideCrawl(input: DecideInput): CoverDecision {
  const { source, settings, kinds, sitemap, now } = input;
  if (settings === undefined) return { mode: 'full', reason: 'the cover crawl is not configured' };
  if (input.explicitListings) return { mode: 'full', reason: 'the listings were given explicitly' };
  if (source === null) return { mode: 'full', reason: 'no cover source from an earlier full run' };
  const wanted = [...kinds].sort().join('+');
  if (source.families.join('+') !== wanted) return { mode: 'full', reason: `the cover source covers ${source.families.join('+')}, this run walks ${wanted}` };
  const age = now.getTime() - Date.parse(source.builtAt);
  if (!(age >= 0)) return { mode: 'full', reason: `the cover source is dated ${source.builtAt}, not before this run` };
  if (age >= settings.fullCrawlEveryDays * DAY_MS - FULL_CRAWL_SLACK_MS) {
    return { mode: 'full', reason: `the last full run was ${(age / DAY_MS).toFixed(1)} days ago (a full run every ${settings.fullCrawlEveryDays} days)` };
  }
  const plan = planCover(source);
  const known = new Set([...sitemap.categorySlugs.map((s) => `c/${s}`), ...sitemap.genreSlugs.map((s) => `r/${s}`)]);
  const gone = plan.filter((l) => !known.has(l.id)).map((l) => l.id);
  if (gone.length > 0) return { mode: 'full', reason: `${gone.length} planned listing(s) are no longer in the sitemap, e.g. ${gone.slice(0, 3).join(', ')}` };
  return { mode: 'cover', plan, reason: `${plan.length} listings (${plan.reduce((n, l) => n + l.pages, 0)} pages) planned from the full run of ${source.builtAt}` };
}

export function serializeCoverSource(source: CoverSource): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(source), 'utf8')));
}

const ID = /^[cr]\/[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/;
const CODE = /^\d{1,12}$/;

function isAscendingInts(a: unknown, below: number): a is number[] {
  if (!Array.isArray(a)) return false;
  let previous = -1;
  for (const v of a) {
    if (!Number.isInteger(v) || (v as number) <= previous || (v as number) >= below) return false;
    previous = v as number;
  }
  return true;
}

/** A cover source is a cache: anything wrong with it is an error string, never a throw, and the caller reads everything instead. */
export function parseCoverSource(bytes: Uint8Array): { source: CoverSource } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch (e) {
    return { error: `unreadable: ${(e as Error).message}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r['version'] !== COVER_SOURCE_VERSION) return { error: `version ${JSON.stringify(r['version'])} is not ${COVER_SOURCE_VERSION}` };
  if (typeof r['builtAt'] !== 'string' || Number.isNaN(Date.parse(r['builtAt']))) return { error: 'builtAt is not a date' };
  const families = r['families'];
  if (!Array.isArray(families) || families.length === 0 || !families.every((f) => f === 'c' || f === 'r') || new Set(families).size !== families.length || [...families].sort().join() !== families.join()) {
    return { error: 'families must be a sorted, non-empty list of c / r' };
  }
  const products = r['products'];
  if (!Array.isArray(products) || products.length === 0 || !products.every((p, i) => typeof p === 'string' && CODE.test(p) && (i === 0 || (products[i - 1] as string) < p))) {
    return { error: 'products must be a non-empty ascending list of sales codes' };
  }
  const listings = r['listings'];
  if (!Array.isArray(listings) || listings.length === 0) return { error: 'listings missing or empty' };
  const seen = new Set<string>();
  const covered = new Uint8Array(products.length);
  for (const [i, l] of listings.entries()) {
    if (typeof l !== 'object' || l === null) return { error: `listings[${i}] is not an object` };
    const o = l as Record<string, unknown>;
    if (typeof o['id'] !== 'string' || !ID.test(o['id']) || seen.has(o['id'])) return { error: `listings[${i}] has a bad or repeated id` };
    seen.add(o['id']);
    if (!Number.isInteger(o['pages']) || (o['pages'] as number) < 1 || (o['pages'] as number) > 50) return { error: `${o['id']}: pages out of range` };
    if (o['layout'] !== 'card' && o['layout'] !== 'table') return { error: `${o['id']}: layout is neither card nor table` };
    if (typeof o['truncated'] !== 'boolean') return { error: `${o['id']}: truncated is not a boolean` };
    if (!isAscendingInts(o['codes'], products.length) || (o['codes'] as number[]).length === 0) return { error: `${o['id']}: codes must be ascending product indexes` };
    for (const c of o['codes'] as number[]) covered[c] = 1;
  }
  if (covered.includes(0)) return { error: 'a product is shown by no listing' };
  return { source: raw as CoverSource };
}
