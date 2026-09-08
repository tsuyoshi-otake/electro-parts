import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.ts';
import { STATE_DB_FILE_NAME, verifyStateDir } from '../../src/db/finalize.ts';
import { parsePipelineConfig, type PipelineConfig } from '../../src/pipeline/config.ts';
import { downloadState, PreviousStateUnavailableError, type FetchLike } from '../../src/pipeline/previousState.ts';
import { reportToMarkdown } from '../../src/pipeline/report.ts';
import { runPipeline, SITE_STATE_DIR, type RunResult } from '../../src/pipeline/run.ts';
import { verifyPublication } from '../../src/pipeline/verifyPublication.ts';
import { isProductFileV1, validateManifestV1 } from '../../src/publisher/contract.ts';
import { syntheticItem, type SyntheticListing } from '../helpers/akizukiHtml.ts';
import { addListing, FAKE_BASE, fakeSite, resetSite, transportFor, type FakeSite } from '../helpers/fakeAkizukiSite.ts';

/**
 * End-to-end pipeline against the fake site: bootstrap, an incremental run
 * that reads the previous state from the published `state/` directory, a
 * quarantined run, and the failure modes around the previous state.
 */
describe('pipeline state machine', () => {
  let root: string;
  let pagesDir: string;
  let config: PipelineConfig;
  let bootstrapStateDir: string;
  const site: FakeSite = fakeSite();
  const clock = (() => {
    let t = Date.parse('2026-09-07T03:00:00.000Z');
    return () => new Date((t += 1000));
  })();

  const catalog = (n: number, overrides: (i: number) => Partial<SyntheticListing> = () => ({})): SyntheticListing[] =>
    Array.from({ length: n }, (_, i) => syntheticItem(i + 1, overrides(i + 1)));

  const run = (bootstrap: boolean, extra: Partial<Parameters<typeof runPipeline>[0]> = {}): Promise<RunResult> =>
    runPipeline({
      config,
      bootstrap,
      cwd: root,
      previous: { dir: pagesDir },
      deps: { log: () => undefined, now: clock, transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
      ...extra,
    });

  /** Simulates the deploy: the produced site becomes the published one. */
  const deploy = async (): Promise<void> => {
    await rm(pagesDir, { recursive: true, force: true });
    const { cp } = await import('node:fs/promises');
    await cp(path.join(root, 'site', SITE_STATE_DIR), pagesDir, { recursive: true });
  };

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ep-pipeline-'));
    pagesDir = path.join(root, 'published-state');
    bootstrapStateDir = path.join(root, 'bootstrap-state');
    config = parsePipelineConfig({
      storeId: 'akizuki',
      collector: { userAgent: 'electro-parts test agent', baseUrl: FAKE_BASE, listingKinds: ['r'], minIntervalMs: 500, jitterMs: 0 },
      inventory: { retentionDays: 400, pointLimit: 10 },
      previousStateUrl: null,
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses to run without a previous state unless bootstrapping', async () => {
    const r = await run(false);
    expect(r.report.outcome).toBe('failed');
    expect(r.exitCode).toBe(1);
    expect(r.report.stages[0]).toMatchObject({ name: 'previous_state', status: 'failed' });
    expect(r.report.stages[0]!.error).toMatch(/--bootstrap/);
    expect(r.report.stages.slice(1).every((s) => s.status === 'skipped')).toBe(true);
    expect(r.report.publishable).toBe(false);
  });

  it('bootstraps from an empty history and produces a verified site', async () => {
    addListing(site, { kind: 'r', slug: 'rkit' }, '組立キット', catalog(30), 10);
    addListing(site, { kind: 'r', slug: 'rsensor' }, 'センサー', catalog(12, (i) => ({ salesCode: String(200000 + i) })), 10);
    const r = await run(true);
    expect(r.report.stages.map((s) => `${s.name}:${s.status}`)).toEqual([
      'previous_state:ok',
      'collect:ok',
      'validate:ok',
      'import:ok',
      'compact:ok',
      'generate:ok',
      'finalize:ok',
      'verify:ok',
    ]);
    expect(r.report.outcome).toBe('published');
    expect(r.exitCode).toBe(0);
    expect(r.report.mode).toBe('bootstrap');
    expect(r.report.publishable).toBe(true);
    expect(r.report.datasetVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(r.report.stages[3]!.details).toMatchObject({ status: 'imported', productsTotal: 42, productsNew: 42 });
    // Snapshot persisted for the artifact upload, report persisted for the summary.
    expect(r.report.snapshotPath).toMatch(/^snapshots[\\/]akizuki-2026-09-07T03-.*\.json\.gz$/);
    await stat(path.join(root, r.report.snapshotPath!));
    const onDisk = JSON.parse(await readFile(r.reportPath, 'utf8')) as typeof r.report;
    expect(onDisk.outcome).toBe('published');
    // Site contents: manifest, product files, finalized state.
    const manifest = JSON.parse(await readFile(path.join(root, 'site', 'data', 'v1', 'stores', 'akizuki', 'manifest.json'), 'utf8'));
    expect(validateManifestV1(manifest)).toEqual([]);
    expect(manifest.productCount).toBe(42);
    const product = JSON.parse(await readFile(path.join(root, 'site', 'data', 'v1', 'stores', 'akizuki', 'products', '100001.json'), 'utf8'));
    expect(isProductFileV1(product)).toBe(true);
    const state = await verifyStateDir(path.join(root, 'site', SITE_STATE_DIR));
    expect(state.stores['akizuki']).toEqual({ runCount: 1, latestObservedAt: expect.stringMatching(/^2026-09-07T03/) });
    // The Markdown summary renders every stage.
    const md = reportToMarkdown(r.report);
    expect(md).toContain('| verify | ✅ ok |');
    expect(md).toContain('datasetVersion');
    const { cp } = await import('node:fs/promises');
    await cp(path.join(root, 'site', SITE_STATE_DIR), bootstrapStateDir, { recursive: true });
    await deploy();
  });

  it('refuses to bootstrap over an existing state', async () => {
    const r = await run(true);
    expect(r.report.outcome).toBe('failed');
    expect(r.report.stages[0]!.error).toMatch(/refusing to bootstrap/);
  });

  it('runs incrementally from the published state and records the price change', async () => {
    // One price change, one product gone, one new product, quantities drift.
    resetSite(site);
    const kits = catalog(30, (i) => ({ availableQuantity: 40 + i, ...(i === 3 ? { priceYen: 999 } : {}) })).filter((k) => k.salesCode !== '100030');
    kits.push(syntheticItem(31));
    addListing(site, { kind: 'r', slug: 'rkit' }, '組立キット', kits, 10);
    addListing(site, { kind: 'r', slug: 'rsensor' }, 'センサー', catalog(12, (i) => ({ salesCode: String(200000 + i) })), 10);
    const r = await run(false);
    expect(r.report.outcome).toBe('published');
    expect(r.report.mode).toBe('incremental');
    expect(r.report.stages[0]!.details).toMatchObject({ previousRuns: 1, schema: '2→2' });
    expect(r.report.stages[2]!.details).toMatchObject({ missingProducts: 1, newProducts: 1, primaryPriceChanges: 1, sanityErrors: 0 });
    expect(r.report.stages[3]!.details).toMatchObject({ status: 'imported', productsTotal: 42, productsNew: 1, productsAbsent: 1, changedPricePoints: 2 });
    const product = JSON.parse(await readFile(path.join(root, 'site', 'data', 'v1', 'stores', 'akizuki', 'products', '100003.json'), 'utf8'));
    const points = product.offers[0].segments[0].points as [number, string, number, number][];
    expect(points.map((p) => p[2])).toEqual([130, 999]);
    const state = await verifyStateDir(path.join(root, 'site', SITE_STATE_DIR));
    expect(state.stores['akizuki']!.runCount).toBe(2);
    // A structurally valid dataset and state must still be rejected when they
    // came from different publications.
    const currentStateDir = path.join(root, 'current-state');
    const siteStateDir = path.join(root, 'site', SITE_STATE_DIR);
    const { cp } = await import('node:fs/promises');
    await cp(siteStateDir, currentStateDir, { recursive: true });
    await rm(siteStateDir, { recursive: true, force: true });
    await cp(bootstrapStateDir, siteStateDir, { recursive: true });
    await expect(verifyPublication(path.join(root, 'site'), config)).rejects.toThrow(/does not match bundled state/);
    await rm(siteStateDir, { recursive: true, force: true });
    await cp(currentStateDir, siteStateDir, { recursive: true });
    await deploy();
  });

  it('reports "unchanged" when the same snapshot is imported again', async () => {
    const r = await run(false, { snapshotPath: (await import('node:fs/promises').then((m) => m.readdir(path.join(root, 'snapshots')))).sort().map((f) => path.join('snapshots', f))[1]! });
    expect(r.report.outcome).toBe('unchanged');
    expect(r.exitCode).toBe(0);
    expect(r.report.stages[3]!.details).toMatchObject({ status: 'already_imported' });
    expect(r.report.publishable).toBe(true);
  });

  it('republishes the site from the published history without observing anything', async () => {
    const manifestPath = path.join(root, 'site', 'data', 'v1', 'stores', 'akizuki', 'manifest.json');
    const before = JSON.parse(await readFile(manifestPath, 'utf8')).datasetVersion as string;
    const r = await run(false, { republish: true });
    expect(r.report.stages.map((s) => `${s.name}:${s.status}`)).toEqual([
      'previous_state:ok',
      'collect:skipped',
      'validate:skipped',
      'import:skipped',
      'compact:skipped',
      'generate:ok',
      'finalize:ok',
      'verify:ok',
    ]);
    expect(r.report.outcome).toBe('unchanged');
    expect(r.exitCode).toBe(0);
    expect(r.report.publishable).toBe(true);
    // Same history in, same history out: the run count and the dataset
    // version must not move because the site was rebuilt.
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).datasetVersion).toBe(before);
    expect((await verifyStateDir(path.join(root, 'site', SITE_STATE_DIR))).stores['akizuki']!.runCount).toBe(2);
    await deploy();
  });

  it('refuses a republish that also carries an observation', async () => {
    const r = await run(true, { republish: true });
    expect(r.report.outcome).toBe('failed');
    expect(r.report.publishable).toBe(false);
    expect(r.report.stages.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('quarantines a crawl that lost most of the catalogue and keeps the history intact', async () => {
    resetSite(site);
    addListing(site, { kind: 'r', slug: 'rkit' }, '組立キット', catalog(5), 10);
    addListing(site, { kind: 'r', slug: 'rsensor' }, 'センサー', catalog(3, (i) => ({ salesCode: String(200000 + i) })), 10);
    const r = await run(false);
    expect(r.report.outcome).toBe('quarantined');
    expect(r.exitCode).toBe(3);
    expect(r.report.stages.map((s) => `${s.name}:${s.status}`)).toEqual([
      'previous_state:ok',
      'collect:ok',
      'validate:ok',
      'import:skipped',
      'compact:skipped',
      'generate:ok',
      'finalize:ok',
      'verify:ok',
    ]);
    expect(r.report.warnings.some((w) => w.startsWith('quarantined: sanity.item_count_drop'))).toBe(true);
    // Same history → same datasetVersion; the rejection is recorded in the state.
    expect(r.report.publishable).toBe(true);
    const db = openDatabase(path.join(root, 'site', SITE_STATE_DIR, STATE_DB_FILE_NAME), { readOnly: true });
    try {
      expect((db.prepare('SELECT COUNT(*) AS n FROM crawl_runs').get() as { n: number }).n).toBe(2);
      const rejected = db.prepare('SELECT reason_json FROM rejected_runs').all() as { reason_json: string }[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason_json).toContain('sanity.item_count_drop');
    } finally {
      db.close();
    }
  });

  it('quarantines an incomplete crawl (server failure on one page)', async () => {
    resetSite(site);
    addListing(site, { kind: 'r', slug: 'rkit' }, '組立キット', catalog(30), 10);
    addListing(site, { kind: 'r', slug: 'rsensor' }, 'センサー', catalog(12, (i) => ({ salesCode: String(200000 + i) })), 10);
    site.failures.set(`${FAKE_BASE}/catalog/r/rkit_p2/`, 99);
    const r = await run(false);
    site.failures.clear();
    expect(r.report.outcome).toBe('quarantined');
    expect(r.report.stages[1]!.details).toMatchObject({ complete: false });
    expect(r.report.warnings.some((w) => w.startsWith('quarantined: snapshot.incomplete') || w.includes('incomplete'))).toBe(true);
  });

  it('fails when the published state is corrupt instead of resetting history', async () => {
    const { writeFile } = await import('node:fs/promises');
    const dbPath = path.join(pagesDir, STATE_DB_FILE_NAME);
    const original = await readFile(dbPath);
    await writeFile(dbPath, Buffer.concat([original.subarray(0, original.length - 1), Buffer.from([original[original.length - 1]! ^ 0xff])]));
    const r = await run(false);
    await writeFile(dbPath, original);
    expect(r.report.outcome).toBe('failed');
    expect(r.report.stages[0]!.error).toMatch(/checksum mismatch/);
    expect(r.report.publishable).toBe(false);
  });
});

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe('previous state download', () => {
  it('fetches state.json and the database it names, and treats 404 as "no state"', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ep-state-dl-'));
    try {
      const served = new Map<string, Buffer>([
        ['https://pages.test/state/state.json', Buffer.from(JSON.stringify({ stateFormatVersion: 1, fileName: 'history.sqlite' }))],
        ['https://pages.test/state/history.sqlite', Buffer.from('not really a database')],
      ]);
      const fetchImpl: FetchLike = async (url) => {
        const body = served.get(url);
        return { status: body === undefined ? 404 : 200, arrayBuffer: async () => toArrayBuffer(body ?? Buffer.alloc(0)) };
      };
      expect(await downloadState('https://pages.test/state', dir, fetchImpl)).toBe(true);
      expect((await readFile(path.join(dir, 'history.sqlite'))).toString()).toBe('not really a database');
      expect(await downloadState('https://pages.test/nowhere', dir, fetchImpl)).toBe(false);
      const flaky: FetchLike = async () => ({ status: 503, arrayBuffer: async () => new ArrayBuffer(0) });
      await expect(downloadState('https://pages.test/state', dir, flaky)).rejects.toBeInstanceOf(PreviousStateUnavailableError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('applies one deadline to response bodies and aborts the active request', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ep-state-timeout-'));
    let aborted = false;
    const hanging: FetchLike = async (_url, init) => ({
      status: 200,
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(init.signal?.reason);
        }, { once: true });
      }),
    });
    try {
      await expect(downloadState('https://pages.test/state', dir, hanging, 20)).rejects.toThrow(/timed out after 20 ms/);
      expect(aborted).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('times out while waiting for response headers even if a transport ignores abort', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ep-state-header-timeout-'));
    const hanging: FetchLike = () => new Promise(() => undefined);
    try {
      await expect(downloadState('https://pages.test/state', dir, hanging, 20)).rejects.toThrow(/timed out after 20 ms/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
