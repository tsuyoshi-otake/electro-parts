import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyReports } from '../../scripts/crawl-alerts.ts';
import { AKIZUKI_COVER_SOURCE_FILE } from '../../src/collectors/akizuki/collector.ts';
import { openDatabase } from '../../src/db/connection.ts';
import { STATE_DB_FILE_NAME } from '../../src/db/finalize.ts';
import { CARRY_DIR_NAME, collectToFile, parseCollectRecord, writeCollectRecord, type CollectRecord } from '../../src/pipeline/collect.ts';
import { parsePipelineConfig, type PipelineConfig } from '../../src/pipeline/config.ts';
import { runPipeline, SITE_STATE_DIR, type RunResult } from '../../src/pipeline/run.ts';
import { syntheticItem } from '../helpers/akizukiHtml.ts';
import { addListing, FAKE_BASE, fakeSite, resetSite, transportFor, type FakeSite } from '../helpers/fakeAkizukiSite.ts';

/**
 * One job crawls and writes a snapshot plus its collect record; a later job
 * imports them. The import must report the crawl exactly as a run that did
 * both would have, and must refuse a record that does not describe the file
 * it is given (a mixed-up artifact would otherwise publish one crawl's
 * verdict over another's data).
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const at = (iso: string) => () => new Date(iso);
const DAY1 = '2026-11-01T03:00:00.000Z';
const DAY2 = '2026-11-02T03:00:00.000Z';

const configOf = (extra: Record<string, unknown> = {}): PipelineConfig =>
  parsePipelineConfig({
    storeId: 'akizuki',
    collector: { userAgent: 'electro-parts test agent', baseUrl: FAKE_BASE, listingKinds: ['r'], minIntervalMs: 500, jitterMs: 0, ...extra },
    inventory: { retentionDays: 400, pointLimit: 10 },
    observation: { cadence: 'daily' },
    previousStateUrl: null,
  });

const catalog = (n: number) => Array.from({ length: n }, (_, i) => syntheticItem(i + 1));
const stage = (r: RunResult, name: string) => r.report.stages.find((s) => s.name === name)!;
const statuses = (r: RunResult) => r.report.stages.map((s) => `${s.name}:${s.status}`);

describe('collect in one job, import in another', () => {
  const roots: string[] = [];
  const site: FakeSite = fakeSite();
  const config = configOf();
  /** Counts what the import job asks of the network: it must ask for nothing. */
  const idle: FakeSite = fakeSite();

  const newRoot = async (): Promise<string> => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ep-collect-job-'));
    roots.push(root);
    return root;
  };

  beforeAll(() => {
    addListing(site, { kind: 'r', slug: 'rkit' }, 'Kit', catalog(30), 10);
    addListing(site, { kind: 'r', slug: 'rsensor' }, 'Sensor', Array.from({ length: 12 }, (_, i) => syntheticItem(i + 1, { salesCode: String(200000 + i + 1) })), 10);
  });
  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  const live = (root: string, clock: () => Date, extra: Partial<Parameters<typeof runPipeline>[0]> = {}) =>
    runPipeline({
      config,
      bootstrap: true,
      cwd: root,
      previous: { dir: path.join(root, 'none') },
      deps: { log: () => undefined, now: clock, transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
      ...extra,
    });

  /** The `crawl` command's work: collect, write the snapshot, write the record. */
  const crawl = async (root: string, clock: () => Date) => {
    const collected = await collectToFile({
      config,
      cwd: root,
      deps: { log: () => undefined, now: clock, transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
    });
    const recordFile = path.join(root, config.paths.reports, `collect-${config.storeId}.json`);
    await writeCollectRecord(recordFile, collected.record);
    return { ...collected, recordFile };
  };

  /** The import job: no transport that reaches a shop, only the files. */
  const importJob = (root: string, snapshotPath: string, collectRecordPath: string | undefined, clock: () => Date, extra: Partial<Parameters<typeof runPipeline>[0]> = {}) =>
    runPipeline({
      config,
      bootstrap: true,
      cwd: root,
      previous: { dir: path.join(root, 'none') },
      snapshotPath,
      ...(collectRecordPath === undefined ? {} : { collectRecordPath }),
      deps: { log: () => undefined, now: clock, transport: transportFor(idle), sleep: async () => undefined, random: () => 0 },
      ...extra,
    });

  const rewriteRecord = async (file: string, change: Partial<CollectRecord>): Promise<string> => {
    const edited = path.join(path.dirname(file), 'edited-record.json');
    await writeFile(edited, JSON.stringify({ ...(JSON.parse(await readFile(file, 'utf8')) as object), ...change }));
    return edited;
  };

  it('imports a crawl from another job into the report a single-job run would have written', async () => {
    const liveRoot = await newRoot();
    const jobRoot = await newRoot();
    const direct = await live(liveRoot, at(DAY1));
    const collected = await crawl(jobRoot, at(DAY1));
    const imported = await importJob(jobRoot, path.relative(jobRoot, collected.file), collected.recordFile, at(DAY1));

    expect(direct.report.outcome).toBe('published');
    expect(imported.report.outcome).toBe(direct.report.outcome);
    expect(imported.exitCode).toBe(direct.exitCode);
    expect(imported.report.datasetVersion).toBe(direct.report.datasetVersion);
    expect(imported.report.publishable).toBe(true);
    expect(imported.report.warnings).toEqual(direct.report.warnings);
    expect(statuses(imported)).toEqual(statuses(direct));

    const { source: jobSource, ...jobDetails } = stage(imported, 'collect').details;
    const { source: liveSource, ...liveDetails } = stage(direct, 'collect').details;
    expect(jobSource).toBe('collect-job');
    expect(liveSource).toBeUndefined();
    expect(jobDetails).toEqual(liveDetails);
    expect(jobDetails).toMatchObject({ complete: true, errors: 0, rawSha256: collected.record.rawSha256, bytes: collected.record.bytes });
    // The state file's hash differs between two otherwise identical runs (it is a database
    // file), so it is the one detail not compared.
    const withoutStateHash = (details: Record<string, unknown>) => {
      const { sha256, stateSha256, ...rest } = details;
      return rest;
    };
    for (const name of ['validate', 'import', 'compact', 'generate', 'finalize', 'verify']) {
      expect(withoutStateHash(stage(imported, name).details), name).toEqual(withoutStateHash(stage(direct, name).details));
    }
    expect(imported.report.snapshotPath).toBe(path.relative(jobRoot, collected.file));
    expect(idle.log).toEqual([]);
  });

  it('writes the snapshot where the pipeline would, and the record next to what it describes', async () => {
    const root = await newRoot();
    const collected = await crawl(root, at(DAY1));
    expect(path.dirname(collected.file)).toBe(path.join(root, 'snapshots'));
    expect(path.basename(collected.file)).toBe('akizuki-2026-11-01T03-00-00-000Z.json.gz');
    expect(collected.record).toMatchObject({
      recordVersion: 1,
      storeId: 'akizuki',
      snapshotFile: path.basename(collected.file),
      retrievedAt: DAY1,
      complete: true,
      errors: [],
      startedAt: DAY1,
      durationMs: 0,
    });
    expect(collected.record.metrics).toMatchObject({ items: 42 });
    const parsed = parseCollectRecord(JSON.parse(await readFile(collected.recordFile, 'utf8')));
    expect(parsed).toEqual(collected.record);
    const dryRun = await live(await newRoot(), at(DAY1));
    expect(collected.record.rawSha256).toBe(stage(dryRun, 'collect').details['rawSha256']);

    const elsewhere = await newRoot();
    const moved = await collectToFile({
      config,
      cwd: root,
      snapshotsDir: path.join(elsewhere, 'out'),
      deps: { log: () => undefined, now: at(DAY1), transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
    });
    expect(path.dirname(moved.file)).toBe(path.join(elsewhere, 'out'));
    await stat(moved.file);
  });

  it('times the collection with the clock it was given, from the first reading to the last', async () => {
    const root = await newRoot();
    const readings: number[] = [];
    let t = Date.parse(DAY1);
    const ticking = () => {
      t += 1000;
      readings.push(t);
      return new Date(t);
    };
    const { record } = await collectToFile({
      config,
      cwd: root,
      deps: { log: () => undefined, now: ticking, transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
    });
    expect(record.startedAt).toBe(new Date(readings[0]!).toISOString());
    expect(record.durationMs).toBe(readings[readings.length - 1]! - readings[0]!);
    expect(record.durationMs).toBeGreaterThan(0);
  });

  it('reads the system clock when no clock is given, and the record times the crawl with it', async () => {
    const root = await newRoot();
    const before = Date.now();
    const { record } = await collectToFile({
      config,
      cwd: root,
      deps: { log: () => undefined, transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
    });
    const after = Date.now();
    const started = Date.parse(record.startedAt);
    expect(started).toBeGreaterThanOrEqual(before);
    expect(started).toBeLessThanOrEqual(after);
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.durationMs).toBeLessThanOrEqual(after - before);
  });

  it('logs the snapshot it wrote with its path, size and completeness', async () => {
    const root = await newRoot();
    const lines: string[] = [];
    const { file, record } = await collectToFile({
      config,
      cwd: root,
      deps: { log: (line: string) => lines.push(line), now: at(DAY1), transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
    });
    expect(lines).toContain(`snapshot written: ${file} (${record.bytes} bytes, complete=true)`);
  });

  it('gives the collect stage the crawl time from the record, not the time spent reading the file', async () => {
    const root = await newRoot();
    const collected = await crawl(root, at(DAY1));
    const edited = await rewriteRecord(collected.recordFile, { startedAt: '2026-11-01T01:00:00.000Z', durationMs: 5_400_000 });
    let t = Date.parse(DAY2);
    const ticking = () => new Date((t += 1000));
    const r = await importJob(root, collected.file, edited, ticking);
    expect(r.report.outcome).toBe('published');
    expect(stage(r, 'collect')).toMatchObject({ status: 'ok', startedAt: '2026-11-01T01:00:00.000Z', durationMs: 5_400_000 });
    // Only the collect stage borrows the record's time.
    expect(stage(r, 'validate').startedAt).not.toBe('2026-11-01T01:00:00.000Z');
    expect(stage(r, 'validate').durationMs).toBe(1000);
  });

  it('keeps the time of reading the file when no record is given, and says the source is a file', async () => {
    const root = await newRoot();
    const collected = await crawl(root, at(DAY1));
    let t = Date.parse(DAY2);
    const r = await importJob(root, collected.file, undefined, () => new Date((t += 1000)));
    expect(r.report.outcome).toBe('published');
    expect(stage(r, 'collect').details).toEqual({ source: 'file', bytes: collected.record.bytes, rawSha256: collected.record.rawSha256 });
    expect(stage(r, 'collect').startedAt).not.toBe(collected.record.startedAt);
    expect(stage(r, 'collect').durationMs).toBe(1000);
  });

  it('fails the collect stage for a record of another store', async () => {
    const root = await newRoot();
    const collected = await crawl(root, at(DAY1));
    const edited = await rewriteRecord(collected.recordFile, { storeId: 'beta' });
    const r = await importJob(root, collected.file, edited, at(DAY2));
    expect(r.report.outcome).toBe('failed');
    expect(r.exitCode).toBe(1);
    expect(r.report.publishable).toBe(false);
    expect(stage(r, 'collect')).toMatchObject({ status: 'failed' });
    expect(stage(r, 'collect').error).toContain('collect record is for store beta, not akizuki');
    expect(statuses(r).slice(2).every((s) => s.endsWith(':skipped'))).toBe(true);
  });

  it('fails the collect stage for a record whose hash is not the file it is given', async () => {
    const root = await newRoot();
    const collected = await crawl(root, at(DAY1));
    const edited = await rewriteRecord(collected.recordFile, { rawSha256: 'b'.repeat(64) });
    const r = await importJob(root, collected.file, edited, at(DAY2));
    expect(r.report.outcome).toBe('failed');
    expect(stage(r, 'collect').status).toBe('failed');
    expect(stage(r, 'collect').error).toContain('collect record does not describe this snapshot');
    expect(stage(r, 'collect').error).toContain(collected.record.rawSha256);
    expect(statuses(r).slice(2).every((s) => s.endsWith(':skipped'))).toBe(true);
  });

  it('fails the collect stage for a record that is malformed or missing, naming the problem', async () => {
    const root = await newRoot();
    const collected = await crawl(root, at(DAY1));
    const bad = await rewriteRecord(collected.recordFile, { durationMs: -5 });
    const malformed = await importJob(root, collected.file, bad, at(DAY2));
    expect(malformed.report.outcome).toBe('failed');
    expect(stage(malformed, 'collect').error).toContain('collect record: durationMs');
    const missing = await importJob(root, collected.file, path.join(root, 'nowhere.json'), at(DAY2));
    expect(missing.report.outcome).toBe('failed');
    expect(stage(missing, 'collect').status).toBe('failed');
  });

  it('rejects a collect record without a snapshot before it touches anything', async () => {
    const root = await newRoot();
    const collected = await crawl(root, at(DAY1));
    const r = await runPipeline({
      config,
      bootstrap: true,
      cwd: root,
      previous: { dir: path.join(root, 'none') },
      collectRecordPath: collected.recordFile,
      deps: { log: () => undefined, now: at(DAY2), transport: transportFor(idle), sleep: async () => undefined, random: () => 0 },
    });
    expect(r.report.outcome).toBe('failed');
    expect(r.report.publishable).toBe(false);
    expect(r.report.stages.every((s) => s.status === 'skipped')).toBe(true);
    expect(idle.log).toEqual([]);
    const republish = await runPipeline({
      config,
      bootstrap: false,
      republish: true,
      cwd: root,
      previous: { dir: path.join(root, 'none') },
      collectRecordPath: collected.recordFile,
      deps: { log: () => undefined, now: at(DAY2) },
    });
    expect(republish.report.outcome).toBe('failed');
    expect(republish.report.stages.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('quarantines an incomplete collection and still carries its errors into the report the alerts read', async () => {
    const root = await newRoot();
    site.failures.set(`${FAKE_BASE}/catalog/r/rkit_p2/`, 99);
    let collected: Awaited<ReturnType<typeof crawl>>;
    try {
      collected = await crawl(root, at(DAY1));
    } finally {
      site.failures.clear();
    }
    expect(collected.record.complete).toBe(false);
    expect(collected.record.errors.length).toBeGreaterThan(0);
    await stat(collected.file);
    expect(JSON.parse(await readFile(collected.recordFile, 'utf8'))).toMatchObject({ complete: false, errors: collected.record.errors });

    const r = await importJob(root, collected.file, collected.recordFile, at(DAY2));
    expect(r.report.outcome).toBe('quarantined');
    expect(r.exitCode).toBe(3);
    expect(stage(r, 'collect')).toMatchObject({ status: 'ok' });
    expect(stage(r, 'collect').details).toMatchObject({ complete: false, errors: collected.record.errors.length, source: 'collect-job' });
    for (const error of collected.record.errors) expect(r.report.warnings).toContain(`collect error: ${error}`);
    expect(r.report.warnings.some((w) => w.startsWith('quarantined: '))).toBe(true);

    const [verdict] = classifyReports({ reports: [{ file: 'pipeline-akizuki.json', report: JSON.parse(JSON.stringify(r.report)) }], failedStores: [] });
    expect(verdict).toMatchObject({ storeId: 'akizuki', kind: 'alert', outcome: 'quarantined' });
    const reasons = (verdict as { reasons: string[] }).reasons;
    expect(reasons.some((reason) => reason.startsWith('collect error: ') && reason.includes(collected.record.errors[0]!.slice(0, 40)))).toBe(true);
  });

  it('records a quarantined import with the observation time the record carries', async () => {
    const root = await newRoot();
    const first = await crawl(root, at(DAY1));
    const imported = await importJob(root, first.file, first.recordFile, at(DAY1));
    expect(imported.report.outcome).toBe('published');

    resetSite(site);
    addListing(site, { kind: 'r', slug: 'rkit' }, 'Kit', catalog(5), 10);
    try {
      const second = await crawl(root, at(DAY2));
      const stateDir = path.join(root, 'site', SITE_STATE_DIR);
      const r = await importJob(root, second.file, second.recordFile, at(DAY2), { bootstrap: false, previous: { dir: stateDir } });
      expect(r.report.outcome).toBe('quarantined');
      const db = openDatabase(path.join(stateDir, STATE_DB_FILE_NAME), { readOnly: true });
      try {
        const rows = db.prepare('SELECT observed_at, raw_sha256 FROM rejected_runs').all() as { observed_at: number | null; raw_sha256: string }[];
        expect(rows).toEqual([{ observed_at: Date.parse(DAY2), raw_sha256: second.record.rawSha256 }]);
      } finally {
        db.close();
      }
    } finally {
      resetSite(site);
      addListing(site, { kind: 'r', slug: 'rkit' }, 'Kit', catalog(30), 10);
      addListing(site, { kind: 'r', slug: 'rsensor' }, 'Sensor', Array.from({ length: 12 }, (_, i) => syntheticItem(i + 1, { salesCode: String(200000 + i + 1) })), 10);
    }
  });
});

describe('the crawl keeps what a collector carries between runs', () => {
  it('writes the cover source under the work directory the workflow caches', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ep-collect-carry-'));
    try {
      const coverSite = fakeSite();
      addListing(coverSite, { kind: 'r', slug: 'tag' }, 'Tag', catalog(12), 10);
      const cover = configOf({ cover: { fullCrawlEveryDays: 7, maxRepairListings: 5, escalateAfterMissing: 2 } });
      const { record } = await collectToFile({
        config: cover,
        cwd: root,
        deps: { log: () => undefined, now: at(DAY1), transport: transportFor(coverSite), sleep: async () => undefined, random: () => 0 },
      });
      expect(record.complete).toBe(true);
      expect(await readdir(path.join(root, cover.paths.work, CARRY_DIR_NAME))).toEqual([AKIZUKI_COVER_SOURCE_FILE]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('the command line', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ep-collect-cli-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A config whose every path is inside the temp directory, so nothing lands in the checkout. */
  const configFile = async (cadence: string): Promise<string> => {
    const file = path.join(dir, `${cadence}.json`);
    await writeFile(
      file,
      JSON.stringify({
        storeId: 'akizuki',
        collector: { userAgent: 'electro-parts test agent', baseUrl: FAKE_BASE, listingKinds: ['r'] },
        observation: { cadence },
        paths: { snapshots: path.join(dir, 'snapshots'), work: path.join(dir, 'work'), site: path.join(dir, 'site'), reports: path.join(dir, 'reports') },
        previousStateUrl: null,
      }),
    );
    return file;
  };
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args], { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 });

  it('refuses --collect-record without --snapshot and exits 1 with the report written', async () => {
    const result = cli(['pipeline', '--config', await configFile('daily'), '--bootstrap', '--collect-record', path.join(dir, 'record.json')]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('a collect record describes a snapshot');
    const report = JSON.parse(await readFile(path.join(dir, 'reports', 'pipeline-akizuki.json'), 'utf8')) as { outcome: string; stages: { status: string }[] };
    expect(report.outcome).toBe('failed');
    expect(report.stages.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('does not crawl a store whose observation has stopped, and writes neither snapshot nor record', async () => {
    const result = cli(['crawl', '--config', await configFile('stopped')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is no longer observed');
    expect(await readdir(dir)).not.toContain('snapshots');
  });

  it('documents the new flags in its usage text', () => {
    const result = cli(['nonsense']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--collect-record FILE');
    expect(result.stderr).toContain('--record FILE');
  });
});
