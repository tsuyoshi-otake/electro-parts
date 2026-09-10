import { readFile } from 'node:fs/promises';
import { DEFAULT_SANITY_THRESHOLDS, type SanityThresholds } from '../core/sanity.ts';
import { assertStoreId } from '../core/identity.ts';
import { DEFAULT_INVENTORY_RETENTION_DAYS } from '../db/inventoryRetention.ts';
import { DEFAULT_INVENTORY_POINT_LIMIT } from '../publisher/generate.ts';
import type { ObservationCadence } from '../publisher/contract.ts';

/**
 * Per-store pipeline configuration (`config/<store>.json`). The `collector`
 * section is opaque to the pipeline core; the store's collector validates it.
 * Nothing in here is secret: the user agent, genre list and thresholds are
 * meant to be reviewed in pull requests.
 */
export interface PipelineConfig {
  storeId: string;
  collector: Record<string, unknown>;
  sanity: SanityThresholds;
  inventory: { retentionDays: number; pointLimit: number };
  /** How often the workflow crawls this store. Must match the schedule. */
  observation: { cadence: ObservationCadence };
  paths: { snapshots: string; work: string; site: string; reports: string };
  /** Base URL of the published `state/` directory (previous run), if deployed. */
  previousStateUrl: string | null;
  /** Total deadline for downloading state.json and its database. */
  previousStateTimeoutMs: number;
}

export const DEFAULT_PATHS: PipelineConfig['paths'] = { snapshots: 'snapshots', work: 'state/work', site: 'site', reports: 'reports' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function ratio(v: unknown, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new Error(`config: ${name} must be a number between 0 and 1`);
  return v;
}

function positiveInt(v: unknown, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || (v as number) <= 0) throw new Error(`config: ${name} must be a positive integer`);
  return v as number;
}

function cadence(v: unknown): ObservationCadence {
  if (v === undefined) return 'monthly';
  if (v !== 'every_two_days' && v !== 'weekly' && v !== 'monthly') throw new Error("config: observation.cadence must be 'every_two_days', 'weekly' or 'monthly'");
  return v;
}

function optionalString(v: unknown, name: string, fallback: string): string {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || v === '') throw new Error(`config: ${name} must be a non-empty string`);
  return v;
}

export function parsePipelineConfig(value: unknown): PipelineConfig {
  if (!isRecord(value)) throw new Error('config: root must be an object');
  if (typeof value['storeId'] !== 'string') throw new Error('config: storeId is required');
  const storeId = assertStoreId(value['storeId']);
  if (!isRecord(value['collector'])) throw new Error('config: collector section is required');
  const sanity = isRecord(value['sanity']) ? value['sanity'] : {};
  const inventory = isRecord(value['inventory']) ? value['inventory'] : {};
  const paths = isRecord(value['paths']) ? value['paths'] : {};
  const observation = isRecord(value['observation']) ? value['observation'] : {};
  const previous = value['previousStateUrl'];
  if (previous !== undefined && previous !== null && (typeof previous !== 'string' || !/^https:\/\//.test(previous))) {
    throw new Error('config: previousStateUrl must be an https URL or null');
  }
  return {
    storeId,
    collector: value['collector'],
    sanity: {
      maxItemCountDropRatio: ratio(sanity['maxItemCountDropRatio'], 'sanity.maxItemCountDropRatio', DEFAULT_SANITY_THRESHOLDS.maxItemCountDropRatio),
      maxMissingProductRatio: ratio(sanity['maxMissingProductRatio'], 'sanity.maxMissingProductRatio', DEFAULT_SANITY_THRESHOLDS.maxMissingProductRatio),
      maxPriceChangeRatio: ratio(sanity['maxPriceChangeRatio'], 'sanity.maxPriceChangeRatio', DEFAULT_SANITY_THRESHOLDS.maxPriceChangeRatio),
      maxUnavailablePriceRatio: ratio(sanity['maxUnavailablePriceRatio'], 'sanity.maxUnavailablePriceRatio', DEFAULT_SANITY_THRESHOLDS.maxUnavailablePriceRatio),
    },
    inventory: {
      retentionDays: positiveInt(inventory['retentionDays'], 'inventory.retentionDays', DEFAULT_INVENTORY_RETENTION_DAYS),
      pointLimit: positiveInt(inventory['pointLimit'], 'inventory.pointLimit', DEFAULT_INVENTORY_POINT_LIMIT),
    },
    observation: { cadence: cadence(observation['cadence']) },
    paths: {
      snapshots: optionalString(paths['snapshots'], 'paths.snapshots', DEFAULT_PATHS.snapshots),
      work: optionalString(paths['work'], 'paths.work', DEFAULT_PATHS.work),
      site: optionalString(paths['site'], 'paths.site', DEFAULT_PATHS.site),
      reports: optionalString(paths['reports'], 'paths.reports', DEFAULT_PATHS.reports),
    },
    previousStateUrl: typeof previous === 'string' ? previous.replace(/\/+$/, '') : null,
    previousStateTimeoutMs: positiveInt(value['previousStateTimeoutMs'], 'previousStateTimeoutMs', 60_000),
  };
}

export async function loadPipelineConfig(file: string): Promise<PipelineConfig> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new Error(`config ${file}: ${(e as Error).message}`);
  }
  return parsePipelineConfig(json);
}
