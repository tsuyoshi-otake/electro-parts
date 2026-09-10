import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AKIZUKI_CAPABILITIES } from '../../src/adapters/akizuki/capabilities.ts';
import { AKIZUKI_RAW_SCHEMA_VERSION } from '../../src/adapters/akizuki/rawSchema.ts';
import { parseUtcMs } from '../../src/core/time.ts';
import { openInMemory } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate, SQLITE_SCHEMA_VERSION } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { validateManifestV1, validateProductFileV1, type ProductFileV1 } from '../../src/publisher/contract.ts';
import { generateStoreDataset, type StoreDataset } from '../../src/publisher/generate.ts';
import { verifyStoreDataset, writeStoreDataset } from '../../src/publisher/write.ts';
import { loadAkizukiNormalized } from '../helpers/fixtures.ts';

describe('Akizuki real snapshots published as contract v1', () => {
  let dataset: StoreDataset;
  let augAt: number;
  let sepAt: number;
  let generateMs: number;
  let dir: string;

  beforeAll(async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');
    augAt = parseUtcMs(aug.observedAt);
    sepAt = parseUtcMs(sep.observedAt);
    const db = openInMemory();
    migrate(db);
    importSnapshot(db, aug, { capabilities: AKIZUKI_CAPABILITIES });
    importSnapshot(db, sep, { capabilities: AKIZUKI_CAPABILITIES });
    const t0 = performance.now();
    dataset = generateStoreDataset(readStoreHistory(db, 'akizuki'), {
      generatedAt: '2026-09-06T12:00:00.000Z',
      sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
      sourceSchemaVersion: String(AKIZUKI_RAW_SCHEMA_VERSION),
    });
    generateMs = performance.now() - t0;
    dir = await mkdtemp(path.join(os.tmpdir(), 'ep-akizuki-site-'));
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const file = (pageKey: string): ProductFileV1 => {
    const f = dataset.products.find((p) => p.pageKey === pageKey);
    if (f === undefined) throw new Error(`missing ${pageKey}`);
    return f;
  };

  it('covers every product once with a valid manifest', () => {
    expect(validateManifestV1(dataset.manifest)).toEqual([]);
    expect(dataset.manifest.productCount).toBe(8701 + 108);
    expect(dataset.manifest.observation).toEqual({ runCount: 2, firstObservedAt: augAt, latestObservedAt: sepAt, latestCoverageId: dataset.manifest.observation.latestCoverageId });
    expect(dataset.manifest.observation.latestCoverageId).toMatch(/^rai\+rbatt\+/);
    expect(dataset.manifest.capabilities).toEqual(AKIZUKI_CAPABILITIES);
    expect(dataset.manifest.versions).toEqual({ contract: '1.1.0', sqliteSchema: SQLITE_SCHEMA_VERSION, sourceSchema: String(AKIZUKI_RAW_SCHEMA_VERSION) });
    expect(new Set(dataset.products.map((p) => p.pageKey)).size).toBe(dataset.products.length);
    // Generation of ~8.8k product files stays well inside the pipeline budget.
    expect(generateMs).toBeLessThan(30_000);
  });

  it('publishes the independently verified price changes', () => {
    // FT232RQ USB-serial kit (sales code 109951): 1150 -> 1200 yen tax included.
    const kit = file('109951');
    expect(kit.externalProductId).toBe('109951');
    expect(kit.product.listed).toBe(true);
    expect(kit.product.current.canonicalUrl).toBe('https://akizukidenshi.com/catalog/g/g109951/');
    expect(kit.offers).toHaveLength(1);
    const seg = kit.offers[0]!.segments;
    expect(seg).toHaveLength(1);
    expect(seg[0]!.primary).toBe(true);
    expect(seg[0]!.basis).toEqual({ quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', unitLabel: '1セット' });
    expect(seg[0]!.points).toEqual([
      [augAt, 'exact', 1150, 1150],
      [sepAt, 'exact', 1200, 1200],
    ]);
    expect(seg[0]!.stats.change).toEqual({ differenceMinor: 50, percent: 4.35, direction: 'up' });
    // 1150 was still in effect at the start of the trailing 30-day window (Aug 7), so both prices count.
    expect(seg[0]!.stats.windows.d30).toEqual({ minMinor: 1150, maxMinor: 1200 });
    expect(seg[0]!.stats.windows.d365).toEqual({ minMinor: 1150, maxMinor: 1200 });

    // RE-280RA motor (sales code 106438): 250 -> 280 yen.
    const motor = file('106438').offers[0]!.segments[0]!;
    expect(motor.points.map((p) => p[2])).toEqual([250, 280]);
    expect(motor.stats.change).toEqual({ differenceMinor: 30, percent: 12, direction: 'up' });
  });

  it('marks products missing from the latest run as unlisted, not discontinued', () => {
    const unlisted = dataset.products.filter((p) => !p.product.listed);
    expect(unlisted).toHaveLength(132);
    const sample = unlisted[0]!;
    expect(sample.product.presence).toEqual([
      [augAt, 1],
      [sepAt, 0],
    ]);
    expect(sample.product.lastSeenAt).toBe(augAt);
    const availability = sample.offers[0]!.availability;
    expect(availability[availability.length - 1]![1]).not.toBe('discontinued');
    expect(dataset.manifest.caveats).toContain('absence_not_discontinued');
    const newOnes = dataset.products.filter((p) => p.product.firstSeenAt === sepAt);
    expect(newOnes).toHaveLength(108);
    expect(newOnes[0]!.product.presence).toEqual([[sepAt, 1]]);
  });

  it('writes and verifies the whole store within budget', async () => {
    const t0 = performance.now();
    const written = await writeStoreDataset(dir, dataset);
    const writeMs = performance.now() - t0;
    const t1 = performance.now();
    const verified = await verifyStoreDataset(dir, 'akizuki');
    const verifyMs = performance.now() - t1;
    expect(verified.productCount).toBe(8809);
    expect(verified.datasetVersion).toBe(dataset.manifest.datasetVersion);
    expect(written.bytesMax).toBeLessThan(16_384);
    // Average product file stays small (two runs: ~2 KB); the userscript fetches one per page view.
    expect(written.bytesTotal / verified.productCount).toBeLessThan(4_096);
    for (const f of dataset.products.slice(0, 50)) expect(validateProductFileV1(f)).toEqual([]);
    console.info(
      `[publish] products=${verified.productCount} bytesTotal=${written.bytesTotal} bytesMax=${written.bytesMax} generateMs=${generateMs.toFixed(0)} writeMs=${writeMs.toFixed(0)} verifyMs=${verifyMs.toFixed(0)}`,
    );
    expect(writeMs).toBeLessThan(60_000);
    expect(verifyMs).toBeLessThan(60_000);
  }, 180_000);
});
