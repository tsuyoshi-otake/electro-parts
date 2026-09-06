import { AKIZUKI_STORE_ID } from '../../adapters/akizuki/capabilities.ts';
import type { CollectDeps, CollectOutcome, StoreCollector } from '../../stores/collector.ts';
import { PoliteFetcher, type PoliteFetcherOptions } from '../politeFetcher.ts';
import { crawlAkizuki } from './crawl.ts';
import { AKIZUKI_BASE_URL, AKIZUKI_DEFAULT_GENRES, AKIZUKI_GENRE_SLUG_PATTERN } from './genres.ts';
import { isAkizukiMaintenancePage } from './listingParser.ts';

/**
 * `collector` section of `config/akizuki.json`. Every field is optional
 * except `userAgent`, which must identify the project (the site's WAF blocks
 * generic "crawler" agents, and anonymous traffic is impolite anyway).
 */
export interface AkizukiCollectorConfig {
  userAgent: string;
  baseUrl: string;
  genres: readonly string[];
  minIntervalMs: number;
  jitterMs: number;
  maxAttempts: number;
  timeoutMs: number;
  maxRequests: number;
  maxPagesPerGenre: number;
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
  const genres = config['genres'] ?? AKIZUKI_DEFAULT_GENRES;
  if (!Array.isArray(genres) || genres.length === 0 || !genres.every((g) => typeof g === 'string' && AKIZUKI_GENRE_SLUG_PATTERN.test(g))) {
    throw new Error('collector.genres must be a non-empty list of genre slugs such as "rkit"');
  }
  return {
    userAgent: ua,
    baseUrl,
    genres: genres as string[],
    minIntervalMs: num(config['minIntervalMs'], 'minIntervalMs', 1000, 500),
    jitterMs: num(config['jitterMs'], 'jitterMs', 500, 0),
    maxAttempts: num(config['maxAttempts'], 'maxAttempts', 4, 1),
    timeoutMs: num(config['timeoutMs'], 'timeoutMs', 30_000, 1000),
    maxRequests: num(config['maxRequests'], 'maxRequests', 2000, 1),
    maxPagesPerGenre: num(config['maxPagesPerGenre'], 'maxPagesPerGenre', 200, 1),
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
      genres: c.genres,
      baseUrl: c.baseUrl,
      maxPagesPerGenre: c.maxPagesPerGenre,
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
        genres: s.genreCount,
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
