import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openInMemory, type Db } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate, SQLITE_SCHEMA_VERSION } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import {
  CONTRACT_MAJOR,
  CONTRACT_VERSION,
  manifestPath,
  productPath,
  validateManifestV1,
  validateProductFileV1,
  type ProductFileV1,
} from '../../src/publisher/contract.ts';
import { datasetVersionOf, generateStoreDataset, type GenerateOptions } from '../../src/publisher/generate.ts';
import { DatasetVerificationError, renameRetryingLocks, resolveInside, verifyStoreDataset, writeStoreDataset } from '../../src/publisher/write.ts';
import { day, dayMs, quote, SYNTHETIC_CAPABILITIES, syntheticSnapshot, type SyntheticProduct } from '../helpers/synthetic.ts';

const caps = SYNTHETIC_CAPABILITIES;
const gen: GenerateOptions = { generatedAt: '2026-09-06T12:00:00.000Z', sqliteSchemaVersion: SQLITE_SCHEMA_VERSION, sourceSchemaVersion: 'test' };

function dbWith(runs: [string, SyntheticProduct[]][]): Db {
  const db = openInMemory();
  migrate(db);
  for (const [at, products] of runs) importSnapshot(db, syntheticSnapshot(at, products), { capabilities: caps });
  return db;
}

function product(files: ProductFileV1[], pageKey: string): ProductFileV1 {
  const f = files.find((p) => p.pageKey === pageKey);
  if (f === undefined) throw new Error(`no file for ${pageKey}`);
  return f;
}

describe('generateStoreDataset', () => {
  it('produces contract-valid files with segments per basis, presence gaps and stats', () => {
    const db = dbWith([
      [day(0), [{ id: 'a', price: 100, quantity: 10 }, { id: 'b', price: 50 }]],
      [day(1), [{ id: 'a', price: 100, quantity: 8 }]],
      [day(2), [{ id: 'a', price: 120, quantity: 8 }, { id: 'b', price: 55 }]],
      [day(3), [{ id: 'a', price: 120, unit: '1袋10個', quantity: 3 }]],
    ]);
    const ds = generateStoreDataset(readStoreHistory(db, 'synthetic'), gen);
    expect(validateManifestV1(ds.manifest)).toEqual([]);
    for (const f of ds.products) expect(validateProductFileV1(f)).toEqual([]);
    expect(ds.manifest.productCount).toBe(2);
    expect(ds.manifest.observation).toEqual({ runCount: 4, firstObservedAt: dayMs(0), latestObservedAt: dayMs(3), latestCoverageId: 'all' });
    expect(ds.manifest.caveats).toEqual(['observation_window', 'sampling_interval', 'absence_not_discontinued', 'site_reported_quantity']);

    // A weekly store says so in its manifest: the sampling caveat is the
    // only place a reader learns how far apart two change points can be.
    const weekly = generateStoreDataset(readStoreHistory(db, 'synthetic'), { ...gen, observationCadence: 'weekly' });
    expect(validateManifestV1(weekly.manifest)).toEqual([]);
    expect(weekly.manifest.caveats).toEqual(['observation_window', 'sampling_interval_weekly', 'absence_not_discontinued', 'site_reported_quantity']);
    expect(weekly.manifest.datasetVersion).not.toBe(ds.manifest.datasetVersion);
    // A daily store carries its interval in an optional field, never in a new caveat key.
    const daily = generateStoreDataset(readStoreHistory(db, 'synthetic'), { ...gen, observationCadence: 'daily' });
    expect(validateManifestV1(daily.manifest)).toEqual([]);
    expect(daily.manifest.observation.samplingIntervalDays).toBe(1);
    expect(daily.manifest.caveats).toEqual(['observation_window', 'absence_not_discontinued', 'site_reported_quantity']);
    for (const days of [0, -1, 1.5, '1']) {
      expect(validateManifestV1({ ...daily.manifest, observation: { ...daily.manifest.observation, samplingIntervalDays: days } }).length).toBeGreaterThan(0);
    }
    expect(daily.manifest.caveats).not.toContain('sampling_interval_weekly');
    expect(daily.manifest.datasetVersion).not.toBe(weekly.manifest.datasetVersion);
    // A stopped store keeps its observation window but claims no interval:
    // neither a caveat nor samplingIntervalDays (#80).
    const stopped = generateStoreDataset(readStoreHistory(db, 'synthetic'), { ...gen, observationCadence: 'stopped' });
    expect(validateManifestV1(stopped.manifest)).toEqual([]);
    expect(stopped.manifest.observation).toEqual(ds.manifest.observation);
    expect(stopped.manifest.caveats).toEqual(['observation_window', 'absence_not_discontinued', 'site_reported_quantity']);
    expect(new Set([ds, weekly, daily, stopped].map((d) => d.manifest.datasetVersion)).size).toBe(4);
    expect(stopped.products).toEqual(ds.products.map((p) => ({ ...p, datasetVersion: stopped.manifest.datasetVersion })));
    expect(ds.products.map((p) => p.pageKey)).toEqual(['a', 'b']);

    const a = product(ds.products, 'a');
    expect(a.product.listed).toBe(true);
    expect(a.product.presence).toEqual([[dayMs(0), 1]]);
    expect(a.offers).toHaveLength(1);
    const offer = a.offers[0]!;
    expect(offer.segments).toHaveLength(2);
    const perUnit = offer.segments.find((s) => s.basis.unitLabel === '1個')!;
    const perBag = offer.segments.find((s) => s.basis.unitLabel === '1袋10個')!;
    expect(perUnit.points).toEqual([
      [dayMs(0), 'exact', 100, 100],
      [dayMs(2), 'exact', 120, 120],
    ]);
    expect(perUnit.presence).toEqual([
      [dayMs(0), 1],
      [dayMs(3), 0],
    ]);
    expect(perUnit.primary).toBe(false);
    expect(perBag.primary).toBe(true);
    expect(perUnit.stats.change).toEqual({ differenceMinor: 20, percent: 20, direction: 'up' });
    expect(perUnit.stats.observedMinMinor).toBe(100);
    // Per-unit basis is delisted at the latest observation, so trailing windows see it only before day 3.
    expect(perUnit.stats.windows.d30).toEqual({ minMinor: 100, maxMinor: 120 });
    expect(perBag.stats.windows.d30).toEqual({ minMinor: 120, maxMinor: 120 });
    expect(perBag.stats.previousDistinct).toBeNull();
    expect(offer.inventory).toEqual({
      semantics: 'site_reported',
      points: [
        [dayMs(0), 10],
        [dayMs(1), 8],
        [dayMs(3), 3],
      ],
      truncated: false,
      totalPoints: 3,
    });

    const b = product(ds.products, 'b');
    expect(b.product.listed).toBe(false);
    expect(b.product.presence).toEqual([
      [dayMs(0), 1],
      [dayMs(1), 0],
      [dayMs(2), 1],
      [dayMs(3), 0],
    ]);
    expect(b.product.lastSeenAt).toBe(dayMs(2));
    expect(b.offers[0]!.segments[0]!.points).toEqual([
      [dayMs(0), 'exact', 50, 50],
      [dayMs(2), 'exact', 55, 55],
    ]);
    expect(b.caveats).toEqual([]);
  });

  it('is deterministic and versions the dataset by runs and output semantics', () => {
    const runs: [string, SyntheticProduct[]][] = [
      [day(0), [{ id: 'a', price: 100 }]],
      [day(1), [{ id: 'a', price: 110 }]],
    ];
    const h1 = readStoreHistory(dbWith(runs), 'synthetic');
    const h2 = readStoreHistory(dbWith([runs[1]!, runs[0]!]), 'synthetic');
    const d1 = generateStoreDataset(h1, gen);
    const d2 = generateStoreDataset(h2, { ...gen, generatedAt: '2030-01-01T00:00:00.000Z' });
    expect(d1.manifest.datasetVersion).toBe(d2.manifest.datasetVersion);
    expect(JSON.stringify(d1.products)).not.toBe(JSON.stringify(d2.products)); // generatedAt differs
    expect(d1.products.map((p) => ({ ...p, generatedAt: '' }))).toEqual(d2.products.map((p) => ({ ...p, generatedAt: '' })));
    expect(JSON.stringify(generateStoreDataset(h1, gen))).toBe(JSON.stringify(d1));
    const h3 = readStoreHistory(dbWith([...runs, [day(2), [{ id: 'a', price: 110 }]]]), 'synthetic');
    expect(datasetVersionOf(h3)).not.toBe(datasetVersionOf(h1));
    expect(datasetVersionOf(h1)).toMatch(/^[0-9a-f]{16}$/);
    expect(generateStoreDataset(h1, { ...gen, inventoryPointLimit: 4 }).manifest.datasetVersion).not.toBe(d1.manifest.datasetVersion);
    expect(generateStoreDataset(h1, { ...gen, sqliteSchemaVersion: gen.sqliteSchemaVersion + 1 }).manifest.datasetVersion).not.toBe(d1.manifest.datasetVersion);
  });

  it('marks the display cap of a store that shows counts as N+ (#74)', () => {
    const historyWith = (capabilities: typeof caps) => {
      const db = openInMemory();
      migrate(db);
      importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a', quantity: 100 }, { id: 'b' }]), { capabilities });
      return readStoreHistory(db, 'synthetic');
    };
    const ds = generateStoreDataset(historyWith({ ...caps, inventoryQuantityCap: 100 }), gen);
    expect(product(ds.products, 'a').offers[0]!.inventory).toEqual({ semantics: 'site_reported', points: [[dayMs(0), 100]], truncated: false, totalPoints: 1, cappedAt: 100 });
    for (const file of ds.products) expect(validateProductFileV1(file)).toEqual([]);
    const bad = structuredClone(product(ds.products, 'a'));
    bad.offers[0]!.inventory.cappedAt = 0;
    expect(validateProductFileV1(bad)).toEqual([expect.stringContaining('$.offers[0].inventory.cappedAt')]);
    // Without a cap the field is absent, so uncapped stores publish exactly what they did before.
    const plain = generateStoreDataset(historyWith(caps), gen);
    expect(product(plain.products, 'a').offers[0]!.inventory).not.toHaveProperty('cappedAt');
  });

  it('truncates long inventory series and flags it', () => {
    const runs: [string, SyntheticProduct[]][] = [];
    for (let i = 0; i < 10; i += 1) runs.push([day(i), [{ id: 'a', quantity: 100 - i }]]);
    const ds = generateStoreDataset(readStoreHistory(dbWith(runs), 'synthetic'), { ...gen, inventoryPointLimit: 4 });
    const inv = product(ds.products, 'a').offers[0]!.inventory;
    expect(inv.totalPoints).toBe(10);
    expect(inv.truncated).toBe(true);
    expect(inv.points.map((p) => p[1])).toEqual([94, 93, 92, 91]);
  });

  it('publishes synthetic Phase 2/3 shapes (variants, ranges, compare-at, tax-excluded, not_displayed)', () => {
    const db = dbWith([
      [
        day(0),
        [
          {
            id: 'multi',
            offers: [
              { offerId: 'red', price: 300, sku: 'R-1', variantName: 'Red' },
              { offerId: 'blue', price: 320, sku: 'B-1', variantName: 'Blue', quotes: [quote(320), quote(400, '1個', { quoteKind: 'compare_at' })] },
            ],
          },
          { id: 'range', price: [242, 1045], unit: null, availability: 'not_displayed', purchasable: null, quantity: null },
          { id: 'ex', quotes: [quote(1000, '1個', { taxTreatment: 'tax_excluded' }), quote(1100, '1個')] },
        ],
      ],
      [day(1), [{ id: 'multi', offers: [{ offerId: 'red', price: 300 }] }, { id: 'range', price: [242, 1045], unit: null }, { id: 'ex' }]],
    ]);
    const ds = generateStoreDataset(readStoreHistory(db, 'synthetic'), gen);
    for (const f of ds.products) expect(validateProductFileV1(f)).toEqual([]);
    const multi = product(ds.products, 'multi');
    expect(multi.offers.map((o) => o.externalOfferId)).toEqual(['blue', 'red']);
    const blue = multi.offers[0]!;
    expect(blue.presence).toEqual([
      [dayMs(0), 1],
      [dayMs(1), 0],
    ]);
    expect(blue.segments.map((s) => [s.basis.quoteKind, s.primary])).toEqual([
      ['compare_at', false],
      ['selling', true],
    ]);
    const range = product(ds.products, 'range');
    expect(range.offers[0]!.segments[0]!.points[0]).toEqual([dayMs(0), 'range', 242, 1045]);
    expect(range.offers[0]!.segments[0]!.stats.change.direction).toBe('unknown');
    expect(range.offers[0]!.availability[0]).toEqual([dayMs(0), 'not_displayed', null, 'unknown', null]);
    const ex = product(ds.products, 'ex');
    expect(ex.offers[0]!.segments.map((s) => [s.basis.taxTreatment, s.primary])).toEqual([
      ['tax_excluded', false],
      ['tax_included', true],
    ]);
  });

  it('refuses two products sharing a page key', () => {
    const db = dbWith([[day(0), [{ id: 'a', pageKey: 'shared' }, { id: 'b', pageKey: 'shared' }]]]);
    expect(() => generateStoreDataset(readStoreHistory(db, 'synthetic'), gen)).toThrow(/page key shared/);
  });
});

describe('contract validators', () => {
  const valid = () => generateStoreDataset(readStoreHistory(dbWith([[day(0), [{ id: 'a' }]]]), 'synthetic'), gen);

  it('accept generated files and reject other majors', () => {
    const ds = valid();
    expect(validateManifestV1(ds.manifest)).toEqual([]);
    expect(validateManifestV1({ ...ds.manifest, contractVersion: `${CONTRACT_MAJOR + 1}.0.0` })).toEqual([`$.contractVersion: expected major ${CONTRACT_MAJOR}`]);
    expect(validateProductFileV1({ ...ds.products[0], contractVersion: '0.9.0' })[0]).toMatch(/contractVersion/);
    expect(CONTRACT_VERSION.startsWith(`${CONTRACT_MAJOR}.`)).toBe(true);
  });

  it('reject structural problems with paths', () => {
    const f = valid().products[0]!;
    const broken = JSON.parse(JSON.stringify(f)) as ProductFileV1;
    broken.offers[0]!.segments[0]!.points = [
      [dayMs(1), 'exact', 1, 1],
      [dayMs(0), 'exact', 1, 1],
    ];
    expect(validateProductFileV1(broken)).toEqual(['$.offers[0].segments[0].points[1]: times must be strictly ascending']);
    const twoPrimary = JSON.parse(JSON.stringify(f)) as ProductFileV1;
    twoPrimary.offers[0]!.segments.push({ ...twoPrimary.offers[0]!.segments[0]!, primary: true });
    expect(validateProductFileV1(twoPrimary)).toEqual(['$.offers[0].segments: more than one primary segment']);
    expect(validateProductFileV1(null)).toEqual(['$: expected object']);
    expect(validateProductFileV1({ ...f, caveats: ['made_up'] })).toEqual(['$.caveats[0]: unexpected value "made_up"']);
    expect(validateManifestV1({ ...valid().manifest, productPathTemplate: 'x' })).toEqual(['$.productPathTemplate: unexpected template']);
  });
});

describe('writeStoreDataset / verifyStoreDataset', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ep-publish-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips and verifies, then detects tampering', async () => {
    const ds = generateStoreDataset(readStoreHistory(dbWith([[day(0), [{ id: 'a' }, { id: 'b' }]]]), 'synthetic'), gen);
    const written = await writeStoreDataset(dir, ds);
    expect(written.productCount).toBe(2);
    const verified = await verifyStoreDataset(dir, 'synthetic');
    expect(verified.datasetVersion).toBe(ds.manifest.datasetVersion);
    expect(verified.productCount).toBe(2);
    expect(verified.bytesTotal).toBe(written.bytesTotal);
    expect(JSON.parse(await readFile(path.join(dir, manifestPath('synthetic')), 'utf8'))).toEqual(ds.manifest);

    // Stale product from a previous publication.
    const file = path.join(dir, productPath('synthetic', 'b'));
    const stale = JSON.parse(await readFile(file, 'utf8')) as ProductFileV1;
    await writeFile(file, JSON.stringify({ ...stale, datasetVersion: 'old' }));
    await expect(verifyStoreDataset(dir, 'synthetic')).rejects.toBeInstanceOf(DatasetVerificationError);
    await writeFile(file, '{not json');
    await expect(verifyStoreDataset(dir, 'synthetic')).rejects.toMatchObject({ issues: ['b.json: not valid JSON'] });
    // Extra file changes the count.
    await writeFile(file, JSON.stringify(stale));
    await writeFile(path.join(dir, productPath('synthetic', 'zzz')), JSON.stringify({ ...stale, pageKey: 'zzz' }));
    await expect(verifyStoreDataset(dir, 'synthetic')).rejects.toMatchObject({
      issues: ['manifest productCount 2 but 3 product files'],
    });
  });

  it('replaces a previous publication of the same store completely', async () => {
    const first = generateStoreDataset(readStoreHistory(dbWith([[day(0), [{ id: 'a' }, { id: 'old' }]]]), 'synthetic'), gen);
    await writeStoreDataset(dir, first);
    const second = generateStoreDataset(readStoreHistory(dbWith([[day(0), [{ id: 'a' }]]]), 'synthetic'), gen);
    await writeStoreDataset(dir, second);
    const verified = await verifyStoreDataset(dir, 'synthetic');
    expect(verified.productCount).toBe(1);
  });

  it('retries a rename Windows refuses while a scanner holds new files, a bounded number of times', async () => {
    const locked = Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    const waits: number[] = [];
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) throw locked;
    };
    const deps = { sleep: async (ms: number) => { waits.push(ms); }, random: () => 1 };
    await renameRetryingLocks('a', 'b', { ...deps, rename: flaky, platform: 'win32' });
    expect(calls).toBe(3);
    expect(waits).toEqual([50, 100]);

    // Bounded: the eighth refusal is the caller's.
    calls = 0;
    waits.length = 0;
    await expect(renameRetryingLocks('a', 'b', { ...deps, rename: async () => { calls++; throw locked; }, platform: 'win32' })).rejects.toBe(locked);
    expect(calls).toBe(8);
    expect(waits).toEqual([50, 100, 200, 400, 800, 1600, 3200]);

    // Other platforms and other errors fail on the first attempt.
    for (const [platform, error] of [['linux', locked], ['win32', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })]] as const) {
      calls = 0;
      await expect(renameRetryingLocks('a', 'b', { ...deps, rename: async () => { calls++; throw error; }, platform })).rejects.toBe(error);
      expect(calls).toBe(1);
    }
  });

  it('never writes outside the site root', () => {
    expect(() => resolveInside(dir, '../escape.json')).toThrow(/escapes/);
    expect(() => resolveInside(dir, 'products/../../x.json')).toThrow(/escapes/);
    expect(() => resolveInside(dir, '')).toThrow(/escapes/);
    expect(resolveInside(dir, 'data/v1/stores/s/manifest.json')).toBe(path.join(dir, 'data', 'v1', 'stores', 's', 'manifest.json'));
  });
});
