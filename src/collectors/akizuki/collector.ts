import { AKIZUKI_STORE_ID } from '../../adapters/akizuki/capabilities.ts';
import type { CollectDeps, CollectOutcome, StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher, type PoliteFetcherOptions } from '../politeFetcher.ts';
import { crawlAkizuki } from './crawl.ts';
import { AKIZUKI_BASE_URL, AKIZUKI_LISTING_PAGE_CAP, type ListingKind } from './listings.ts';
import { isAkizukiMaintenancePage } from './listingParser.ts';

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
  };
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
    const result = await crawlAkizuki({
      fetcher,
      listingKinds: c.listingKinds,
      baseUrl: c.baseUrl,
      maxPagesPerListing: c.maxPagesPerListing,
      maxUncoveredProducts: c.maxUncoveredProducts,
      log: deps.log,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
    const s = result.snapshot;
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
      },
    };
  },
};
