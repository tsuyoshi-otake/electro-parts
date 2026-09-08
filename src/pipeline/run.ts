import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NormalizedSnapshot } from '../core/domain.ts';
import { sanityCheck } from '../core/sanity.ts';
import { readRawSnapshotFile, writeRawSnapshotFile } from '../core/snapshotFile.ts';
import { parseUtcMs } from '../core/time.ts';
import { isImportable, mergeValidation, type ValidationResult } from '../core/validation.ts';
import { openDatabase, type Db } from '../db/connection.ts';
import { finalizeDatabase } from '../db/finalize.ts';
import { importSnapshot, recordRejectedRun } from '../db/importSnapshot.ts';
import { compactInventory } from '../db/inventoryRetention.ts';
import { migrate, SQLITE_SCHEMA_VERSION } from '../db/migrations/index.ts';
import { listRuns, readStoreHistory } from '../db/read.ts';
import { latestSnapshotSummary } from '../db/sanitySummary.ts';
import { generateStoreDataset } from '../publisher/generate.ts';
import { writeStoreDataset } from '../publisher/write.ts';
import type { CollectDeps } from '../stores/collector.ts';
import { getStoreCollector } from '../stores/collectorRegistry.ts';
import { getStoreAdapter } from '../stores/registry.ts';
import type { PipelineConfig } from './config.ts';
import { acquirePreviousState, type FetchLike, type PreviousStateSource } from './previousState.ts';
import { EXIT_CODES, newReport, runStage, StageFailedError, type PipelineOutcome, type PipelineReport } from './report.ts';
import { verifyPublication } from './verifyPublication.ts';

export const SITE_STATE_DIR = 'state';

export interface RunDeps extends CollectDeps {
  fetchImpl?: FetchLike;
}

export interface RunOptions {
  config: PipelineConfig;
  /** First run only: start from an empty history. Refused when a previous state exists. */
  bootstrap: boolean;
  /** Overrides the config's `previousStateUrl` (e.g. a local directory in tests / dry runs). */
  previous?: PreviousStateSource;
  /** Import this raw snapshot instead of crawling. */
  snapshotPath?: string;
  /**
   * Regenerate and republish the site from the published history without
   * observing anything: no crawl, no import, no new run. For changes that
   * live in the site rather than in the data (the userscript bundle, the
   * landing page, a generator fix). Contradicts `bootstrap` and
   * `snapshotPath`, which both bring an observation with them.
   */
  republish?: boolean;
  /** Root for relative paths from the config. */
  cwd: string;
  deps: RunDeps;
}

export interface RunResult {
  report: PipelineReport;
  exitCode: number;
  reportPath: string;
}

class Quarantine extends Error {
  constructor(
    readonly stageName: 'validate',
    readonly result: ValidationResult,
  ) {
    super(`snapshot quarantined: ${result.errors.map((e) => e.code).join(', ')}`);
    this.name = 'Quarantine';
  }
}

function snapshotFileName(storeId: string, retrievedAt: string): string {
  return `${storeId}-${retrievedAt.replace(/[:.]/g, '-')}.json.gz`;
}

function safeObservedAt(iso: string | null): number | null {
  if (iso === null) return null;
  try {
    return parseUtcMs(iso);
  } catch {
    return null;
  }
}

/**
 * The whole run as a linear state machine:
 *   previous_state → collect → validate → import → compact → generate → finalize → verify
 * Every stage is recorded in the report; the first failure stops the run and
 * leaves `publishable` false. A snapshot that fails validation or the
 * store-neutral sanity check is quarantined (recorded in `rejected_runs`);
 * the site is still regenerated from the unchanged history so the rejection
 * becomes part of the published state, and the exit code says so.
 */
export async function runPipeline(options: RunOptions): Promise<RunResult> {
  const { config, deps } = options;
  const now = deps.now ?? (() => new Date());
  const log = deps.log;
  const report = newReport(config.storeId, now);
  const resolve = (p: string): string => path.resolve(options.cwd, p);
  const workDir = resolve(config.paths.work);
  const siteDir = resolve(config.paths.site);
  const snapshotsDir = resolve(config.paths.snapshots);
  const reportPath = path.join(resolve(config.paths.reports), `pipeline-${config.storeId}.json`);
  const adapter = getStoreAdapter(config.storeId);
  const previous: PreviousStateSource = options.previous ?? (config.previousStateUrl === null ? {} : { url: config.previousStateUrl });

  let db: Db | null = null;
  let outcome: PipelineOutcome = 'failed';
  try {
    // Both of these bring an observation with them, which is exactly what a
    // republish must not do.
    if (options.republish === true && (options.bootstrap || options.snapshotPath !== undefined)) {
      throw new Error('republish cannot be combined with bootstrap or a snapshot: both add an observation');
    }

    // previous_state
    const state = await runStage(report, 'previous_state', now, async (d) => {
      const r = await acquirePreviousState(previous, workDir, options.bootstrap, deps.fetchImpl, config.previousStateTimeoutMs);
      d['mode'] = r.mode;
      if (r.meta !== null) {
        d['previousSha256'] = r.meta.sha256;
        d['previousProducedAt'] = r.meta.producedAt;
        d['previousRuns'] = r.meta.stores[config.storeId]?.runCount ?? 0;
      }
      db = openDatabase(r.workingDbPath);
      const m = migrate(db);
      d['schema'] = `${m.from}→${m.to}`;
      return r;
    });
    report.mode = state.mode;
    const working = db as unknown as Db;

    // collect / validate / import / compact. A republish skips all four: the
    // published history is regenerated as it stands, so a fix that only
    // changes what the site serves never has to invent an observation to
    // reach Pages, and never inflates the run count.
    if (options.republish === true) {
      log('republish: regenerating the site from the published history; nothing observed');
      outcome = 'unchanged';
    } else {
      // collect
      const collected = await runStage(report, 'collect', now, async (d) => {
        if (options.snapshotPath !== undefined) {
          const file = await readRawSnapshotFile(resolve(options.snapshotPath));
          d['source'] = 'file';
          d['bytes'] = file.bytes;
          d['rawSha256'] = file.rawSha256;
          report.snapshotPath = options.snapshotPath;
          return { raw: file.json, rawSha256: file.rawSha256, retrievedAt: null as string | null };
        }
        const collector = getStoreCollector(config.storeId);
        const outcome = await collector.collect(config.collector, deps);
        Object.assign(d, outcome.metrics, { complete: outcome.complete, errors: outcome.errors.length });
        report.warnings.push(...outcome.warnings.map((w) => `collect: ${w}`));
        report.warnings.push(...outcome.errors.map((w) => `collect error: ${w}`));
        await mkdir(snapshotsDir, { recursive: true });
        const file = path.join(snapshotsDir, snapshotFileName(config.storeId, outcome.retrievedAt));
        const written = await writeRawSnapshotFile(file, outcome.raw);
        d['bytes'] = written.bytes;
        d['rawSha256'] = written.rawSha256;
        report.snapshotPath = path.relative(options.cwd, file);
        log(`snapshot written: ${file} (${written.bytes} bytes, complete=${String(outcome.complete)})`);
        return { raw: outcome.raw, rawSha256: written.rawSha256, retrievedAt: outcome.retrievedAt };
      });

      // validate (adapter validation, normalization, sanity vs previous run)
      let normalized: NormalizedSnapshot | null = null;
      let validation: ValidationResult | null = null;
      try {
        const v = await runStage(report, 'validate', now, (d) => {
          const structural = adapter.validateRaw(collected.raw);
          d['errors'] = structural.errors.length;
          d['warnings'] = structural.warnings.length;
          Object.assign(d, structural.metrics);
          report.warnings.push(...structural.warnings.map((w) => `validate: ${w.code} ${w.message}`));
          if (!isImportable(structural)) throw new Quarantine('validate', structural);
          const snapshot = adapter.normalize(collected.raw, collected.rawSha256);
          const previousSummary = latestSnapshotSummary(working, config.storeId);
          const sanity = sanityCheck(snapshot, previousSummary, config.sanity);
          Object.assign(d, sanity.metrics);
          d['sanityErrors'] = sanity.errors.length;
          d['comparedWith'] = previousSummary?.observedAt ?? null;
          report.warnings.push(...sanity.warnings.map((w) => `sanity: ${w.code} ${w.message}`));
          const merged = mergeValidation(structural, sanity);
          if (!isImportable(merged)) throw new Quarantine('validate', merged);
          return { snapshot, merged };
        });
        normalized = v.snapshot;
        validation = v.merged;
      } catch (e) {
        const q = e instanceof StageFailedError ? e.cause : e;
        if (!(q instanceof Quarantine)) throw e;
        const record = report.stages.find((s) => s.name === 'validate');
        if (record !== undefined) record.status = 'ok';
        const reason = { stage: q.stageName, errors: q.result.errors, warnings: q.result.warnings, metrics: q.result.metrics };
        recordRejectedRun(working, config.storeId, safeObservedAt(collected.retrievedAt), collected.rawSha256, reason, now().toISOString());
        report.warnings.push(...q.result.errors.map((x) => `quarantined: ${x.code} ${x.message}`));
        log(`snapshot quarantined: ${q.result.errors.map((x) => `${x.code} (${x.message})`).join('; ')}`);
        outcome = 'quarantined';
      }

      // import + compact
      if (normalized !== null && validation !== null) {
        const snapshot = normalized;
        const merged = validation;
        const stats = await runStage(report, 'import', now, (d) => {
          const s = importSnapshot(working, snapshot, { capabilities: adapter.capabilities, validation: merged, now });
          Object.assign(d, s);
          return s;
        });
        outcome = stats.status === 'already_imported' ? 'unchanged' : 'published';
        await runStage(report, 'compact', now, (d) => {
          const c = compactInventory(working, { retentionDays: config.inventory.retentionDays, now });
          Object.assign(d, c);
        });
      }
    }

    // Nothing to publish when the history is still empty (bootstrap + quarantine).
    if (listRuns(working, config.storeId).length === 0) {
      log('history is empty; nothing to generate');
      report.publishable = false;
    } else {
      const generated = await runStage(report, 'generate', now, async (d) => {
        const history = readStoreHistory(working, config.storeId);
        const dataset = generateStoreDataset(history, {
          generatedAt: now().toISOString(),
          sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
          sourceSchemaVersion: latestSourceSchema(working, config.storeId),
          inventoryPointLimit: config.inventory.pointLimit,
          observationCadence: config.observation.cadence,
        });
        const w = await writeStoreDataset(siteDir, dataset);
        Object.assign(d, { productCount: w.productCount, bytesTotal: w.bytesTotal, bytesMax: w.bytesMax, runs: history.runs.length });
        d['datasetVersion'] = dataset.manifest.datasetVersion;
        return dataset.manifest.datasetVersion;
      });
      report.datasetVersion = generated;

      await runStage(report, 'finalize', now, async (d) => {
        const s = await finalizeDatabase(working, path.join(siteDir, SITE_STATE_DIR), now);
        d['sha256'] = s.sha256;
        d['bytes'] = s.bytes;
        d['runs'] = s.stores[config.storeId]?.runCount ?? 0;
      });

      await runStage(report, 'verify', now, async (d) => {
        const v = await verifyPublication(siteDir, config);
        if (v.datasetVersion !== generated) throw new Error(`written datasetVersion ${v.datasetVersion} != generated ${generated}`);
        d['datasetVersion'] = v.datasetVersion;
        d['productFiles'] = v.productCount;
        d['stateSha256'] = v.stateSha256;
      });
      report.publishable = true;
    }
  } catch (e) {
    outcome = 'failed';
    report.publishable = false;
    log(`pipeline failed: ${(e as Error).message}`);
  } finally {
    try {
      (db as Db | null)?.close();
    } catch {
      // already closed
    }
    report.outcome = outcome;
    report.finishedAt = now().toISOString();
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  return { report, exitCode: EXIT_CODES[outcome], reportPath };
}

function latestSourceSchema(db: Db, storeId: string): string | null {
  const row = db
    .prepare('SELECT source_schema_version AS v FROM crawl_runs WHERE store_id = ? ORDER BY observed_at DESC LIMIT 1')
    .get(storeId) as { v: string } | undefined;
  return row?.v ?? null;
}
