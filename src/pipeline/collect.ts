import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writeRawSnapshotFile } from '../core/snapshotFile.ts';
import { parseUtcMs } from '../core/time.ts';
import type { CollectDeps } from '../stores/collector.ts';
import { getStoreCollector } from '../stores/collectorRegistry.ts';
import type { PipelineConfig } from './config.ts';
import type { PipelineReport } from './report.ts';

/** Under the work directory: what a collector keeps between runs (`CollectDeps.carryDir`). The workflow caches it. */
export const CARRY_DIR_NAME = 'carry';

export const COLLECT_RECORD_VERSION = 1;

/**
 * What one collection produced, written next to the snapshot so another job
 * can report it. The job that imports a snapshot did not run the collector, so
 * without this its report would have nothing to say about the crawl (its
 * metrics, its errors, how long it took).
 */
export interface CollectRecord {
  recordVersion: 1;
  storeId: string;
  /** Base name of the snapshot file (no directory). */
  snapshotFile: string;
  rawSha256: string;
  bytes: number;
  retrievedAt: string;
  complete: boolean;
  errors: string[];
  warnings: string[];
  metrics: Record<string, number>;
  startedAt: string;
  durationMs: number;
}

export function snapshotFileName(storeId: string, retrievedAt: string): string {
  return `${storeId}-${retrievedAt.replace(/[:.]/g, '-')}.json.gz`;
}

export interface CollectArgs {
  config: PipelineConfig;
  /** Root for relative paths from the config. */
  cwd: string;
  deps: CollectDeps;
  /** Overrides the config's snapshot directory (the `crawl` command's `--out`). */
  snapshotsDir?: string;
}

/**
 * Runs a store's collector and writes the raw snapshot file. The one place
 * that does this, for the pipeline's live collect stage and for the `crawl`
 * command, so a store's crawl cannot behave differently depending on which
 * entry point ran it (the weekly-cover collector needs the carry directory
 * in both).
 */
export async function collectToFile(args: CollectArgs): Promise<{ record: CollectRecord; raw: unknown; file: string }> {
  const { config, cwd, deps } = args;
  const now = deps.now ?? (() => new Date());
  const started = now();
  const collector = getStoreCollector(config.storeId);
  const carryDir = path.join(path.resolve(cwd, config.paths.work), CARRY_DIR_NAME);
  const outcome = await collector.collect(config.collector, { ...deps, carryDir });
  const dir = args.snapshotsDir === undefined ? path.resolve(cwd, config.paths.snapshots) : path.resolve(cwd, args.snapshotsDir);
  await mkdir(dir, { recursive: true });
  const snapshotFile = snapshotFileName(config.storeId, outcome.retrievedAt);
  const file = path.join(dir, snapshotFile);
  const written = await writeRawSnapshotFile(file, outcome.raw);
  deps.log(`snapshot written: ${file} (${written.bytes} bytes, complete=${String(outcome.complete)})`);
  const record: CollectRecord = {
    recordVersion: COLLECT_RECORD_VERSION,
    storeId: config.storeId,
    snapshotFile,
    rawSha256: written.rawSha256,
    bytes: written.bytes,
    retrievedAt: outcome.retrievedAt,
    complete: outcome.complete,
    errors: outcome.errors,
    warnings: outcome.warnings,
    metrics: outcome.metrics,
    startedAt: started.toISOString(),
    durationMs: now().getTime() - started.getTime(),
  };
  return { record, raw: outcome.raw, file };
}

export async function writeCollectRecord(file: string, record: CollectRecord): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(field: string, why: string): never {
  throw new Error(`collect record: ${field} ${why}`);
}

function text(value: Record<string, unknown>, field: string): string {
  const v = value[field];
  if (typeof v !== 'string' || v === '') fail(field, 'must be a non-empty string');
  return v;
}

function timestamp(value: Record<string, unknown>, field: string): string {
  const v = text(value, field);
  try {
    parseUtcMs(v);
  } catch {
    fail(field, 'must be an ISO-8601 timestamp with an explicit offset');
  }
  return v;
}

function strings(value: Record<string, unknown>, field: string): string[] {
  const v = value[field];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) fail(field, 'must be an array of strings');
  return v as string[];
}

/** Validates a record read from another job's artifact; throws naming the first bad field. */
export function parseCollectRecord(value: unknown): CollectRecord {
  if (!isRecord(value)) throw new Error('collect record: the record is not an object');
  if (value['recordVersion'] !== COLLECT_RECORD_VERSION) fail('recordVersion', `must be ${COLLECT_RECORD_VERSION}`);
  const storeId = text(value, 'storeId');
  const snapshotFile = text(value, 'snapshotFile');
  if (/[\\/]/.test(snapshotFile)) fail('snapshotFile', 'must be a base name without a directory');
  const rawSha256 = text(value, 'rawSha256');
  if (!/^[0-9a-f]{64}$/.test(rawSha256)) fail('rawSha256', 'must be 64 lowercase hex characters');
  const bytes = value['bytes'] as number;
  if (!Number.isSafeInteger(bytes) || bytes < 0) fail('bytes', 'must be a non-negative integer');
  const retrievedAt = timestamp(value, 'retrievedAt');
  if (typeof value['complete'] !== 'boolean') fail('complete', 'must be a boolean');
  const errors = strings(value, 'errors');
  const warnings = strings(value, 'warnings');
  const metrics = value['metrics'];
  if (!isRecord(metrics) || Object.values(metrics).some((m) => !Number.isFinite(m))) {
    fail('metrics', 'must be an object of finite numbers');
  }
  const startedAt = timestamp(value, 'startedAt');
  const durationMs = value['durationMs'] as number;
  if (!Number.isFinite(durationMs) || durationMs < 0) fail('durationMs', 'must be a non-negative number');
  return {
    recordVersion: COLLECT_RECORD_VERSION,
    storeId,
    snapshotFile,
    rawSha256,
    bytes,
    retrievedAt,
    complete: value['complete'],
    errors,
    warnings,
    metrics: metrics as Record<string, number>,
    startedAt,
    durationMs,
  };
}

/**
 * The single place a collection is copied into a pipeline report: the stage's
 * details and the `collect: ` / `collect error: ` warnings that
 * `scripts/crawl-alerts.ts` reads back. A live collect stage and an import of
 * another job's snapshot both go through here, so their reports agree.
 */
export function applyCollectRecord(report: PipelineReport, details: Record<string, unknown>, record: CollectRecord): void {
  Object.assign(details, record.metrics, {
    complete: record.complete,
    errors: record.errors.length,
    bytes: record.bytes,
    rawSha256: record.rawSha256,
  });
  report.warnings.push(...record.warnings.map((w) => `collect: ${w}`));
  report.warnings.push(...record.errors.map((w) => `collect error: ${w}`));
}
