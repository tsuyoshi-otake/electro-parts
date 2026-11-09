import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AKIZUKI_COVER_SOURCE_FILE } from '../../src/collectors/akizuki/collector.ts';
import { openDatabase } from '../../src/db/connection.ts';
import { STATE_DB_FILE_NAME } from '../../src/db/finalize.ts';
import { parsePipelineConfig, type PipelineConfig } from '../../src/pipeline/config.ts';
import { CARRY_DIR_NAME, runPipeline, SITE_STATE_DIR } from '../../src/pipeline/run.ts';
import { syntheticItem } from '../helpers/akizukiHtml.ts';
import { addListing, FAKE_BASE, fakeSite, transportFor } from '../helpers/fakeAkizukiSite.ts';

/**
 * The cover crawl through the whole pipeline (#93): the first run reads every
 * listing and leaves the cover source in the carry directory, the second plans
 * from it, and the history shows nothing happened to the products the second
 * run did not re-read through a listing of their own.
 */
describe('Akizuki cover crawl through the pipeline', () => {
  let root: string;
  let config: PipelineConfig;
  const site = fakeSite();
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => syntheticItem(from + i));

  const run = (bootstrap: boolean, day: number, previousDir: string) => {
    let t = Date.parse('2026-11-01T03:00:00.000Z') + day * 86_400_000;
    return runPipeline({
      config,
      bootstrap,
      cwd: root,
      previous: { dir: previousDir },
      deps: { log: () => undefined, now: () => new Date((t += 1000)), transport: transportFor(site), sleep: async () => undefined, random: () => 0 },
    });
  };

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ep-cover-pipeline-'));
    config = parsePipelineConfig({
      storeId: 'akizuki',
      collector: {
        userAgent: 'electro-parts test agent', baseUrl: FAKE_BASE, listingKinds: ['c', 'r'], minIntervalMs: 500, jitterMs: 0,
        cover: { fullCrawlEveryDays: 7, maxRepairListings: 5, escalateAfterMissing: 2 },
      },
      inventory: { retentionDays: 400, pointLimit: 10 },
      observation: { cadence: 'daily' },
      previousStateUrl: null,
    });
    addListing(site, { kind: 'c', slug: 'big' }, 'Big', range(1, 20), 10);
    addListing(site, { kind: 'c', slug: 'rest' }, 'Rest', range(15, 30), 10);
    addListing(site, { kind: 'r', slug: 'tag' }, 'Tag', range(18, 24), 10);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('leaves the cover source in the carry directory after the first run, then plans the second run from it', async () => {
    const first = await run(true, 0, path.join(root, 'none'));
    expect(first.report.outcome).toBe('published');
    expect(first.report.stages.find((s) => s.name === 'collect')?.details).toMatchObject({ coverRun: 0, plannedListings: 3, listings: 3 });
    expect(await readdir(path.join(root, config.paths.work, CARRY_DIR_NAME))).toEqual([AKIZUKI_COVER_SOURCE_FILE]);

    const second = await run(false, 1, path.join(root, 'site', SITE_STATE_DIR));
    expect(second.report.outcome).toBe('published');
    expect(second.exitCode).toBe(0);
    expect(second.report.stages.find((s) => s.name === 'collect')?.details).toMatchObject({ coverRun: 1, plannedListings: 2, listings: 2, items: 30 });
    expect(second.report.stages.find((s) => s.name === 'validate')?.details).toMatchObject({ sanityErrors: 0 });
    expect(second.report.warnings.filter((w) => w.startsWith('sanity: sanity.coverage_changed'))).toEqual([]);

    // No product was closed and none reopened: the two runs saw the same 30 products.
    const db = openDatabase(path.join(root, 'site', SITE_STATE_DIR, STATE_DB_FILE_NAME));
    try {
      const runs = db.prepare('SELECT run_id, item_count, coverage_id FROM crawl_runs ORDER BY observed_at').all() as { item_count: number; coverage_id: string }[];
      expect(runs.map((r) => [r.item_count, r.coverage_id])).toEqual([[30, 'sitemap:c+r'], [30, 'sitemap:c+r']]);
      const absent = db.prepare("SELECT COUNT(*) AS n FROM presence_events WHERE entity_kind = 'product' AND present = 0").get() as { n: number };
      expect(absent.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
