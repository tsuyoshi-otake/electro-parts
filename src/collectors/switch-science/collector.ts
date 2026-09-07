import { SWITCH_SCIENCE_STORE_ID } from '../../adapters/switch-science/capabilities.ts';
import type { CollectDeps, CollectOutcome, StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher, type PoliteFetcherOptions } from '../politeFetcher.ts';
import { CATALOG_PAGE_LIMIT, DEFAULT_COLLECTION, SWITCH_SCIENCE_BASE_URL } from './catalog.ts';
import { crawlSwitchScience, DEFAULT_MAX_PAGES } from './crawl.ts';

/**
 * `collector` section of `config/switch-science.json`. Every field is optional
 * except `userAgent`, which must identify the project: the store publishes a
 * read-only browsing policy for agents, and reading it politely means being
 * identifiable while doing so.
 */
export interface SwitchScienceCollectorConfig {
  userAgent: string;
  baseUrl: string;
  collection: string;
  pageLimit: number;
  maxPages: number;
  minIntervalMs: number;
  jitterMs: number;
  maxAttempts: number;
  timeoutMs: number;
  maxRequests: number;
  maxSubSitemaps: number;
  maxUncoveredProducts: number;
}

function num(v: unknown, name: string, fallback: number, min: number, max?: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(`collector.${name} must be a number >= ${min}`);
  if (max !== undefined && v > max) throw new Error(`collector.${name} must be a number <= ${max}`);
  return v;
}

export function parseSwitchScienceCollectorConfig(config: Record<string, unknown>): SwitchScienceCollectorConfig {
  const ua = config['userAgent'];
  if (typeof ua !== 'string' || ua.trim().length < 8) throw new Error('collector.userAgent must identify this project');
  const baseUrl = config['baseUrl'] ?? SWITCH_SCIENCE_BASE_URL;
  if (typeof baseUrl !== 'string' || !/^https?:\/\/[^/]+$/.test(baseUrl)) throw new Error('collector.baseUrl must be an origin without a path');
  const collection = config['collection'] ?? DEFAULT_COLLECTION;
  if (typeof collection !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(collection)) {
    throw new Error('collector.collection must be a Shopify collection handle');
  }
  return {
    userAgent: ua,
    baseUrl,
    collection,
    // Above 250 the API silently returns 250, and a config that lies about its
    // page size makes the short-page stop condition wrong.
    pageLimit: num(config['pageLimit'], 'pageLimit', CATALOG_PAGE_LIMIT, 1, CATALOG_PAGE_LIMIT),
    maxPages: num(config['maxPages'], 'maxPages', DEFAULT_MAX_PAGES, 1),
    minIntervalMs: num(config['minIntervalMs'], 'minIntervalMs', 1500, 500),
    jitterMs: num(config['jitterMs'], 'jitterMs', 500, 0),
    maxAttempts: num(config['maxAttempts'], 'maxAttempts', 4, 1),
    timeoutMs: num(config['timeoutMs'], 'timeoutMs', 30_000, 1000),
    maxRequests: num(config['maxRequests'], 'maxRequests', 500, 1),
    maxSubSitemaps: num(config['maxSubSitemaps'], 'maxSubSitemaps', 64, 1),
    maxUncoveredProducts: num(config['maxUncoveredProducts'], 'maxUncoveredProducts', 0, 0),
  };
}

export const switchScienceCollector: StoreCollector = {
  storeId: SWITCH_SCIENCE_STORE_ID,
  validateConfig(config) {
    parseSwitchScienceCollectorConfig(config);
  },
  async collect(config, deps: CollectDeps): Promise<CollectOutcome> {
    const c = parseSwitchScienceCollectorConfig(config);
    const fetcherOptions: PoliteFetcherOptions = {
      userAgent: c.userAgent,
      minIntervalMs: c.minIntervalMs,
      jitterMs: c.jitterMs,
      maxAttempts: c.maxAttempts,
      timeoutMs: c.timeoutMs,
      maxRequests: c.maxRequests,
      headers: { accept: 'application/json, application/xml;q=0.9, */*;q=0.1' },
      log: deps.log,
      ...(deps.transport === undefined ? {} : { transport: deps.transport }),
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.random === undefined ? {} : { random: deps.random }),
      ...(deps.now === undefined ? {} : { now: () => deps.now!().getTime() }),
    };
    const fetcher = new PoliteFetcher(fetcherOptions);
    const result = await crawlSwitchScience({
      fetcher,
      baseUrl: c.baseUrl,
      collection: c.collection,
      pageLimit: c.pageLimit,
      maxPages: c.maxPages,
      maxSubSitemaps: c.maxSubSitemaps,
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
        catalogProducts: s.catalog.productTotal,
        catalogCovered: s.catalog.covered,
        catalogUncovered: s.catalog.uncovered,
        catalogUnlisted: s.catalog.unlisted,
        sitemapPages: s.catalog.sitemapPages,
        catalogPages: s.pageCount,
        items: s.extractedTotal,
        duplicatesRemoved: s.deduplication.duplicatesRemoved,
        unsupportedHandles: s.dataQuality.unsupportedHandle,
        unparsablePrices: s.dataQuality.unparsablePrice,
        unavailableItems: s.dataQuality.unavailable,
        logicalPages: s.requests.logicalPages,
        httpAttempts: s.requests.httpAttemptsIncludingRetries,
        retries: fetcher.stats.retries,
        waitedMs: fetcher.stats.waitedMs,
        durationMs: result.durationMs,
      },
    };
  },
};
