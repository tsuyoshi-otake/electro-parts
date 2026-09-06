import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openInMemory, openDatabase, type Db } from '../../src/db/connection.ts';
import { finalizeDatabase, verifyStateDir } from '../../src/db/finalize.ts';
import { importSnapshot, SnapshotConflictError } from '../../src/db/importSnapshot.ts';
import { compactInventory } from '../../src/db/inventoryRetention.ts';
import { currentSchemaVersion, migrate, SQLITE_SCHEMA_VERSION } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { countRows, dumpStore } from '../helpers/dbDump.ts';
import { day, dayMs, quote, SYNTHETIC_CAPABILITIES, syntheticSnapshot } from '../helpers/synthetic.ts';

const caps = SYNTHETIC_CAPABILITIES;
const fixedNow = () => new Date('2026-09-06T12:00:00.000Z');

function freshDb(): Db {
  const db = openInMemory();
  migrate(db);
  return db;
}

describe('migrations', () => {
  it('applies schema v1 idempotently', () => {
    const db = openInMemory();
    expect(currentSchemaVersion(db)).toBe(0);
    expect(migrate(db)).toEqual({ from: 0, to: SQLITE_SCHEMA_VERSION });
    expect(migrate(db)).toEqual({ from: SQLITE_SCHEMA_VERSION, to: SQLITE_SCHEMA_VERSION });
    expect(currentSchemaVersion(db)).toBe(1);
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(tables).toEqual([
      'availability_events',
      'crawl_runs',
      'inventory_rollups',
      'inventory_samples',
      'metadata_events',
      'offers',
      'presence_events',
      'price_bases',
      'price_events',
      'product_aliases',
      'products',
      'rejected_runs',
      'schema_migrations',
      'stores',
    ]);
  });

  it('refuses a database from the future', () => {
    const db = freshDb();
    db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (99, ?, ?)').run('future', 'x');
    expect(() => migrate(db)).toThrow(/newer/);
  });
});

describe('importSnapshot', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('imports a first snapshot and records every entity once', () => {
    const s = syntheticSnapshot(day(0), [
      { id: 'a', price: 100, quantity: 5 },
      { id: 'b', price: 200, quantity: null, availability: 'out_of_stock', purchasable: false },
    ]);
    const stats = importSnapshot(db, s, { capabilities: caps, now: fixedNow });
    expect(stats.status).toBe('imported');
    expect(stats.productsNew).toBe(2);
    expect(stats.changedPricePoints).toBe(2);
    expect(countRows(db, 'crawl_runs')).toBe(1);
    expect(countRows(db, 'products')).toBe(2);
    expect(countRows(db, 'offers')).toBe(2);
    expect(countRows(db, 'price_bases')).toBe(2);
    expect(countRows(db, 'price_events')).toBe(2);
    expect(countRows(db, 'presence_events')).toBe(6);
    const run = db.prepare('SELECT observed_at, observed_at_iso, raw_sha256 FROM crawl_runs').get() as Record<string, unknown>;
    expect(run['observed_at']).toBe(dayMs(0));
    expect(run['observed_at_iso']).toBe(day(0));
    expect(run['raw_sha256']).toBe(s.rawSha256);
  });

  it('is idempotent for the same snapshot', () => {
    const s = syntheticSnapshot(day(0), [{ id: 'a', price: 100 }]);
    importSnapshot(db, s, { capabilities: caps, now: fixedNow });
    const before = dumpStore(db, 'synthetic');
    const again = importSnapshot(db, s, { capabilities: caps, now: fixedNow });
    expect(again.status).toBe('already_imported');
    expect(dumpStore(db, 'synthetic')).toBe(before);
    expect(countRows(db, 'crawl_runs')).toBe(1);
  });

  it('rejects a different snapshot at the same observation time without side effects', () => {
    importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a', price: 100 }]), { capabilities: caps, now: fixedNow });
    const before = dumpStore(db, 'synthetic');
    expect(() =>
      importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a', price: 101 }]), { capabilities: caps, now: fixedNow }),
    ).toThrow(SnapshotConflictError);
    expect(dumpStore(db, 'synthetic')).toBe(before);
  });

  it('refuses incomplete, empty and unsafe snapshots', () => {
    expect(() =>
      importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a' }], { complete: false }), { capabilities: caps }),
    ).toThrow(/incomplete/);
    expect(() => importSnapshot(db, syntheticSnapshot(day(0), []), { capabilities: caps })).toThrow(/empty/);
    expect(() => importSnapshot(db, syntheticSnapshot(day(0), [{ id: '../x' }]), { capabilities: caps })).toThrow(/unsafe/);
    expect(countRows(db, 'crawl_runs')).toBe(0);
  });

  it('stores only change points for prices and keeps unit changes as separate bases', () => {
    importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a', price: 100 }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(1), [{ id: 'a', price: 100 }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(2), [{ id: 'a', price: 120 }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(3), [{ id: 'a', price: 120, unit: '1袋10個' }]), { capabilities: caps });
    const h = readStoreHistory(db, 'synthetic');
    const offer = h.products[0]!.offers[0]!;
    expect(offer.bases).toHaveLength(2);
    const perUnit = offer.bases.find((b) => b.basis.unitLabel === '1個')!;
    const perBag = offer.bases.find((b) => b.basis.unitLabel === '1袋10個')!;
    expect(perUnit.prices.map((p) => [p.t, p.state.minAmountMinor])).toEqual([
      [dayMs(0), 100],
      [dayMs(2), 120],
    ]);
    expect(perUnit.presence).toEqual([
      { t: dayMs(0), state: true },
      { t: dayMs(3), state: false },
    ]);
    expect(perBag.prices).toEqual([{ t: dayMs(3), state: { state: 'exact', minAmountMinor: 120, maxAmountMinor: 120 } }]);
    expect(perBag.presence).toEqual([{ t: dayMs(3), state: true }]);
  });

  it('marks a missing product as absent, not discontinued, and keeps its last availability', () => {
    importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a' }, { id: 'b' }]), { capabilities: caps });
    const stats = importSnapshot(db, syntheticSnapshot(day(1), [{ id: 'a' }]), { capabilities: caps });
    expect(stats.productsAbsent).toBe(1);
    const h = readStoreHistory(db, 'synthetic');
    const b = h.products.find((p) => p.externalProductId === 'b')!;
    expect(b.presence).toEqual([
      { t: dayMs(0), state: true },
      { t: dayMs(1), state: false },
    ]);
    expect(b.offers[0]!.availability).toEqual([
      {
        t: dayMs(0),
        state: { state: 'in_stock', purchasable: true, quantitySemantics: 'unknown', rawStatus: null },
      },
    ]);
    expect(b.lastSeenAt).toBe(dayMs(0));
    // b comes back
    importSnapshot(db, syntheticSnapshot(day(2), [{ id: 'a' }, { id: 'b' }]), { capabilities: caps });
    const b2 = readStoreHistory(db, 'synthetic').products.find((p) => p.externalProductId === 'b')!;
    expect(b2.presence.map((p) => p.state)).toEqual([true, false, true]);
    expect(b2.lastSeenAt).toBe(dayMs(2));
    expect(b2.firstSeenAt).toBe(dayMs(0));
  });

  it('splits a span exactly when an older run is imported later', () => {
    importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a', price: 100 }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(2), [{ id: 'a', price: 100 }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(3), [{ id: 'a', price: 100 }]), { capabilities: caps });
    const inOrder = dumpStore(db, 'synthetic');
    const stats = importSnapshot(db, syntheticSnapshot(day(1), [{ id: 'a', price: 150 }]), { capabilities: caps });
    expect(stats.outOfOrder).toBe(true);
    const prices = readStoreHistory(db, 'synthetic').products[0]!.offers[0]!.bases[0]!.prices;
    expect(prices.map((p) => [p.t, p.state.minAmountMinor])).toEqual([
      [dayMs(0), 100],
      [dayMs(1), 150],
      [dayMs(2), 100],
    ]);
    expect(dumpStore(db, 'synthetic')).not.toBe(inOrder);

    // Same four runs imported chronologically give the identical database.
    const db2 = freshDb();
    for (const [d, price] of [
      [0, 100],
      [1, 150],
      [2, 100],
      [3, 100],
    ] as const) {
      importSnapshot(db2, syntheticSnapshot(day(d), [{ id: 'a', price }]), { capabilities: caps });
    }
    expect(dumpStore(db2, 'synthetic')).toBe(dumpStore(db, 'synthetic'));
  });

  it('tracks metadata change points and flags suspicious identity reuse', () => {
    importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a', name: 'Widget', modelNumber: 'W-1' }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(1), [{ id: 'a', name: 'Widget (new package)', modelNumber: 'W-1' }]), { capabilities: caps });
    const s = importSnapshot(db, syntheticSnapshot(day(2), [{ id: 'a', name: 'Completely different', modelNumber: 'X-9' }]), {
      capabilities: caps,
    });
    expect(s.changedMetadata).toBe(1);
    expect(s.suspiciousMetadata).toBe(1);
    const meta = readStoreHistory(db, 'synthetic').products[0]!.metadata;
    expect(meta.map((m) => [m.state.name, m.state.suspicious])).toEqual([
      ['Widget', false],
      ['Widget (new package)', false],
      ['Completely different', true],
    ]);
  });

  it('handles variants, ranges, compare-at and tax-excluded quotes (synthetic Phase 2/3 shapes)', () => {
    const snap = syntheticSnapshot(day(0), [
      {
        id: 'multi',
        offers: [
          { offerId: 'red', price: 300, sku: 'R-1', variantName: 'Red' },
          { offerId: 'blue', price: 320, sku: 'B-1', variantName: 'Blue', quotes: [quote(320), quote(400, '1個', { quoteKind: 'compare_at' })] },
        ],
      },
      { id: 'range', price: [242, 1045], unit: null, availability: 'not_displayed', purchasable: null, quantity: null },
      { id: 'ex', quotes: [quote(1000, '1個', { taxTreatment: 'tax_excluded' }), quote(1100, '1個')] },
    ]);
    const stats = importSnapshot(db, snap, { capabilities: caps });
    // red 1 + blue 2 (selling, compare_at) + range 1 + ex 2 (tax_excluded, tax_included)
    expect(stats.changedPricePoints).toBe(6);
    const h = readStoreHistory(db, 'synthetic');
    const multi = h.products.find((p) => p.externalProductId === 'multi')!;
    expect(multi.offers.map((o) => o.externalOfferId).sort()).toEqual(['blue', 'red']);
    expect(multi.offers.find((o) => o.externalOfferId === 'blue')!.bases.map((b) => b.basis.quoteKind).sort()).toEqual([
      'compare_at',
      'selling',
    ]);
    const range = h.products.find((p) => p.externalProductId === 'range')!;
    expect(range.offers[0]!.bases[0]!.prices[0]!.state).toEqual({ state: 'range', minAmountMinor: 242, maxAmountMinor: 1045 });
    expect(range.offers[0]!.availability[0]!.state.state).toBe('not_displayed');
    expect(range.offers[0]!.availability[0]!.state.purchasable).toBeNull();
    const ex = h.products.find((p) => p.externalProductId === 'ex')!;
    expect(ex.offers[0]!.bases.map((b) => b.basis.taxTreatment).sort()).toEqual(['tax_excluded', 'tax_included']);
    // A variant that disappears is marked absent at offer level while the product stays present.
    importSnapshot(db, syntheticSnapshot(day(1), [{ id: 'multi', offers: [{ offerId: 'red', price: 300 }] }, { id: 'range', price: [242, 1045], unit: null }, { id: 'ex' }]), {
      capabilities: caps,
    });
    const multi2 = readStoreHistory(db, 'synthetic').products.find((p) => p.externalProductId === 'multi')!;
    expect(multi2.presence).toEqual([{ t: dayMs(0), state: true }]);
    expect(multi2.offers.find((o) => o.externalOfferId === 'blue')!.presence).toEqual([
      { t: dayMs(0), state: true },
      { t: dayMs(1), state: false },
    ]);
  });

  it('keeps null quantity distinct from zero in inventory samples', () => {
    importSnapshot(db, syntheticSnapshot(day(0), [{ id: 'a', quantity: 3 }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(1), [{ id: 'a', quantity: 0 }]), { capabilities: caps });
    importSnapshot(db, syntheticSnapshot(day(2), [{ id: 'a', quantity: null }]), { capabilities: caps });
    const inv = readStoreHistory(db, 'synthetic').products[0]!.offers[0]!.inventory;
    expect(inv.map((p) => p.state)).toEqual([3, 0, null]);
  });
});

describe('inventory retention', () => {
  it('rolls old samples into daily buckets and keeps the last pre-cutoff sample', () => {
    const db = freshDb();
    for (let d = 0; d < 10; d += 1) {
      importSnapshot(db, syntheticSnapshot(day(d), [{ id: 'a', quantity: 100 - d * 7 }]), { capabilities: caps });
    }
    expect(countRows(db, 'inventory_samples')).toBe(10);
    const r = compactInventory(db, { retentionDays: 5, now: () => new Date(dayMs(10)) });
    // cutoff = day 5; samples on days 0..3 compacted, day 4 kept as the carry-in point
    expect(r.samplesCompacted).toBe(4);
    expect(r.rollupsWritten).toBe(4);
    expect(countRows(db, 'inventory_samples')).toBe(6);
    const rollups = db.prepare('SELECT day, min_quantity, max_quantity, last_quantity, sample_count FROM inventory_rollups ORDER BY day').all();
    expect(rollups).toEqual([
      { day: '2026-01-01', min_quantity: 100, max_quantity: 100, last_quantity: 100, sample_count: 1 },
      { day: '2026-01-02', min_quantity: 93, max_quantity: 93, last_quantity: 93, sample_count: 1 },
      { day: '2026-01-03', min_quantity: 86, max_quantity: 86, last_quantity: 86, sample_count: 1 },
      { day: '2026-01-04', min_quantity: 79, max_quantity: 79, last_quantity: 79, sample_count: 1 },
    ]);
    const remaining = readStoreHistory(db, 'synthetic').products[0]!.offers[0]!.inventory;
    expect(remaining[0]).toEqual({ t: dayMs(4), state: 72 });
    // Prices are never compacted.
    expect(countRows(db, 'price_events')).toBe(1);
  });
});

describe('finalize', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'eph-finalize-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('produces a verified, checksummed, non-WAL copy and detects tampering', async () => {
    const working = openDatabase(path.join(dir, 'working.sqlite'));
    migrate(working);
    importSnapshot(working, syntheticSnapshot(day(0), [{ id: 'a' }]), { capabilities: caps, now: fixedNow });
    const out = path.join(dir, 'state');
    const state = await finalizeDatabase(working, out, fixedNow);
    working.close();
    expect(state.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(state.stores['synthetic']).toEqual({ runCount: 1, latestObservedAt: day(0) });
    expect(state.sqliteSchemaVersion).toBe(SQLITE_SCHEMA_VERSION);
    const verified = await verifyStateDir(out);
    expect(verified.sha256).toBe(state.sha256);
    const meta = JSON.parse(await readFile(path.join(out, 'state.json'), 'utf8')) as { sha256: string };
    expect(meta.sha256).toBe(state.sha256);

    // The copy is a self-contained database.
    const copy = openDatabase(path.join(out, 'history.sqlite'), { readOnly: true });
    expect(countRows(copy, 'products')).toBe(1);
    copy.close();

    // Tamper with the file: verification must fail.
    await writeFile(path.join(out, 'history.sqlite'), Buffer.concat([await readFile(path.join(out, 'history.sqlite')), Buffer.from([0])]));
    await expect(verifyStateDir(out)).rejects.toThrow(/mismatch/);
  });
});
