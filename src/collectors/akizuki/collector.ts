import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AKIZUKI_STORE_ID } from '../../adapters/akizuki/capabilities.ts';
import type { CollectDeps, CollectOutcome, StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher, type PoliteFetcherOptions } from '../politeFetcher.ts';
import { crawlAkizuki } from './crawl.ts';
import { AKIZUKI_BASE_URL, AKIZUKI_LISTING_PAGE_CAP, type ListingKind } from './listings.ts';
import { isAkizukiMaintenancePage } from './listingParser.ts';
import { parseCoverSource, serializeCoverSource, type CoverSettings, type CoverSource } from './cover.ts';

/** In `CollectDeps.carryDir`: what the last complete full run learned about which listing shows which product. */
export const AKIZUKI_COVER_SOURCE_FILE = 'akizuki-cover.json.gz';

/**
 * `collector` section of `config/akizuki.json`. Every field is optional
 * except `userAgent`, which must identify the project (the site's WAF blocks
 * generic "crawler" agents, and anonymous traffic is impolite anyway).
 */
export interface AkizukiCollectorConfig {
  userAgent: string;
  baseUrl: string;
  /** Listing families to walk. `c` is the category tree, `r` the genre tags. */
  listingKinds: readonly ListingKind[];
  minIntervalMs: number;
  jitterMs: number;
  maxAttempts: number;
  timeoutMs: number;
  maxRequests: number;
  maxPagesPerListing: number;
  maxUncoveredProducts: number;
  /** The cover crawl (#93); undefined: every run walks every listing. */
  cover: CoverSettings | undefined;
}

function coverSettings(v: unknown): CoverSettings | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('collector.cover must be an object');
  const o = v as Record<string, unknown>;
  const int = (name: string, fallback: number, min: number, max: number): number => {
    const n = o[name] ?? fallback;
    if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) throw new Error(`collector.cover.${name} must be an integer between ${min} and ${max}`);
    return n as number;
  };
  return {
    fullCrawlEveryDays: int('fullCrawlEveryDays', 7, 1, 30),
    maxRepairListings: int('maxRepairListings', 40, 0, 200),
    escalateAfterMissing: int('escalateAfterMissing', 30, 0, 2000),
  };
}

function num(v: unknown, name: string, fallback: number, min: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(`collector.${name} must be a number >= ${min}`);
  return v;
}

export function parseAkizukiCollectorConfig(config: Record<string, unknown>): AkizukiCollectorConfig {
  const ua = config['userAgent'];
  if (typeof ua !== 'string' || ua.trim().length < 8) throw new Error('collector.userAgent must identify this project');
  if (/crawler|bot|spider/i.test(ua)) throw new Error('collector.userAgent: the site rejects agents named like generic crawlers; use the project name and contact URL');
  const baseUrl = config['baseUrl'] ?? AKIZUKI_BASE_URL;
  if (typeof baseUrl !== 'string' || !/^https?:\/\/[^/]+$/.test(baseUrl)) throw new Error('collector.baseUrl must be an origin without a path');
  if (config['genres'] !== undefined) {
    throw new Error('collector.genres was removed in raw schema 3; listings are discovered from the sitemap, see collector.listingKinds');
  }
  const kinds = config['listingKinds'] ?? ['c'];
  if (!Array.isArray(kinds) || kinds.length === 0 || !kinds.every((k) => k === 'c' || k === 'r')) {
    throw new Error('collector.listingKinds must be a non-empty list of "c" (category tree) and/or "r" (genre tags)');
  }
  return {
    userAgent: ua,
    baseUrl,
    listingKinds: kinds as ListingKind[],
    minIntervalMs: num(config['minIntervalMs'], 'minIntervalMs', 1000, 500),
    jitterMs: num(config['jitterMs'], 'jitterMs', 500, 0),
    maxAttempts: num(config['maxAttempts'], 'maxAttempts', 4, 1),
    timeoutMs: num(config['timeoutMs'], 'timeoutMs', 30_000, 1000),
    maxRequests: num(config['maxRequests'], 'maxRequests', 2000, 1),
    maxPagesPerListing: num(config['maxPagesPerListing'], 'maxPagesPerListing', AKIZUKI_LISTING_PAGE_CAP, 1),
    maxUncoveredProducts: num(config['maxUncoveredProducts'], 'maxUncoveredProducts', 0, 0),
    cover: coverSettings(config['cover']),
  };
}

/** The cover source is a cache: a missing or damaged file means a full run, never a failed one. */
async function readCoverSource(file: string, log: (message: string) => void): Promise<CoverSource | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(file);
  } catch (e) {
    log(`[crawl] no cover source (${(e as NodeJS.ErrnoException).code ?? 'unreadable'}); this run reads every listing`);
    return null;
  }
  const parsed = parseCoverSource(bytes);
  if ('error' in parsed) {
    log(`[crawl] cover source ignored: ${parsed.error}; this run reads every listing`);
    return null;
  }
  return parsed.source;
}

/** Written beside itself and renamed, so a run that dies half-way never leaves a file the next run would half-read. */
async function writeCoverSource(file: string, source: CoverSource, log: (message: string) => void): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(temporary, serializeCoverSource(source));
    await rename(temporary, file);
    log(`[crawl] cover source written: ${source.listings.length} listings, ${source.products.length} products (full run of ${source.builtAt})`);
  } catch (e) {
    log(`[crawl] cover source not written: ${(e as Error).message}; the next run reads every listing`);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export const akizukiCollector: StoreCollector = {
  storeId: AKIZUKI_STORE_ID,
  validateConfig(config) {
    parseAkizukiCollectorConfig(config);
  },
  async collect(config, deps: CollectDeps): Promise<CollectOutcome> {
    const c = parseAkizukiCollectorConfig(config);
    const fetcherOptions: PoliteFetcherOptions = {
      userAgent: c.userAgent,
      minIntervalMs: c.minIntervalMs,
      jitterMs: c.jitterMs,
      maxAttempts: c.maxAttempts,
      timeoutMs: c.timeoutMs,
      maxRequests: c.maxRequests,
      isTransientBody: (_status, body) => isAkizukiMaintenancePage(body),
      log: deps.log,
      ...(deps.transport === undefined ? {} : { transport: deps.transport }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.random === undefined ? {} : { random: deps.random }),
      ...(deps.now === undefined ? {} : { now: () => deps.now!().getTime() }),
    };
    const fetcher = new PoliteFetcher(fetcherOptions);
    const coverFile = deps.carryDir === undefined ? null : path.join(deps.carryDir, AKIZUKI_COVER_SOURCE_FILE);
    const source = c.cover === undefined || coverFile === null ? null : await readCoverSource(coverFile, deps.log);
    const result = await crawlAkizuki({
      fetcher,
      listingKinds: c.listingKinds,
      baseUrl: c.baseUrl,
      maxPagesPerListing: c.maxPagesPerListing,
      maxUncoveredProducts: c.maxUncoveredProducts,
      ...(c.cover === undefined ? {} : { cover: { source, settings: c.cover } }),
      log: deps.log,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
    const s = result.snapshot;
    if (result.coverSource !== null && coverFile !== null) await writeCoverSource(coverFile, result.coverSource, deps.log);
    return {
      raw: s,
      retrievedAt: s.retrievedAt,
      complete: s.complete,
      errors: s.validation.errors,
      warnings: s.validation.warnings,
      metrics: {
        listings: s.listingCount,
        catalogProducts: s.catalog.productTotal,
        catalogCovered: s.catalog.covered,
        catalogUncovered: s.catalog.uncovered,
        occurrences: s.occurrenceTotal,
        items: s.extractedTotal,
        duplicatesRemoved: s.deduplication.duplicatesRemoved,
        logicalPages: s.requests.logicalPages,
        httpAttempts: s.requests.httpAttemptsIncludingRetries,
        retries: fetcher.stats.retries,
        waitedMs: fetcher.stats.waitedMs,
        durationMs: result.durationMs,
        ...(s.crawl === undefined
          ? {}
          : {
              coverRun: s.crawl.mode === 'cover' ? 1 : 0,
              plannedListings: s.crawl.plannedListings,
              repairListings: s.crawl.repairListings,
              missingAfterRepair: s.crawl.missingAfterRepair,
              escalated: s.crawl.escalated ? 1 : 0,
            }),
      },
    };
  },
};
