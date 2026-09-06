import { describe, expect, it } from 'vitest';
import { AKIZUKI_CAPABILITIES } from '../../src/adapters/akizuki/capabilities.ts';
import { computeSegmentStats } from '../../src/core/stats.ts';
import { openInMemory } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { countRows, dumpStore } from '../helpers/dbDump.ts';
import { loadAkizukiNormalized } from '../helpers/fixtures.ts';

const caps = AKIZUKI_CAPABILITIES;

describe('Akizuki real snapshots through SQLite', () => {
  it('imports both runs with the expected change-point counts, in both orders', async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');

    const db = openInMemory();
    migrate(db);
    const t0 = performance.now();
    const s1 = importSnapshot(db, aug, { capabilities: caps });
    const t1 = performance.now();
    const s2 = importSnapshot(db, sep, { capabilities: caps });
    const t2 = performance.now();
    expect(s1.productsNew).toBe(8701);
    expect(s1.changedPricePoints).toBe(8701);
    expect(s2.productsNew).toBe(108);
    expect(s2.productsAbsent).toBe(132);
    // 168 price changes among common products + 108 new products' first price
    expect(s2.changedPricePoints).toBe(168 + 108);
    // Metadata change points: every new product plus each common product whose
    // (name, model number, category, canonical URL) tuple changed.
    const augById = new Map(aug.products.map((p) => [p.externalProductId, p]));
    let metadataChanged = 0;
    for (const p of sep.products) {
      const prev = augById.get(p.externalProductId);
      if (prev === undefined) continue;
      const m = p.metadata;
      const q = prev.metadata;
      if (m.name !== q.name || m.modelNumber !== q.modelNumber || m.category !== q.category || m.canonicalUrl !== q.canonicalUrl) {
        metadataChanged += 1;
      }
    }
    expect(metadataChanged).toBe(6);
    expect(s2.changedMetadata).toBe(metadataChanged + 108);
    expect(s2.outOfOrder).toBe(false);
    expect(countRows(db, 'products')).toBe(8701 + 108);
    expect(countRows(db, 'price_events')).toBe(8701 + 168 + 108);
    expect(countRows(db, 'crawl_runs')).toBe(2);
    // Performance budget: each real import well under 30 s (typically ~1-2 s).
    expect(t1 - t0).toBeLessThan(30_000);
    expect(t2 - t1).toBeLessThan(30_000);

    // FT232RQ kit: 1150 -> 1200 (+4.35 %)
    const history = readStoreHistory(db, 'akizuki');
    const kit = history.products.find((p) => p.externalProductId === '109951')!;
    const seg = computeSegmentStats(kit.offers[0]!.bases[0]!.prices)!;
    expect(seg.current.minAmountMinor).toBe(1200);
    expect(seg.previousDistinct!.minAmountMinor).toBe(1150);
    expect(seg.change).toEqual({ differenceMinor: 50, percent: 4.35, direction: 'up' });
    expect(seg.observedMinMinor).toBe(1150);
    expect(seg.observedMaxMinor).toBe(1200);

    // Reverse order gives the identical database content.
    const db2 = openInMemory();
    migrate(db2);
    importSnapshot(db2, sep, { capabilities: caps });
    const s3 = importSnapshot(db2, aug, { capabilities: caps });
    expect(s3.outOfOrder).toBe(true);
    expect(dumpStore(db2, 'akizuki')).toBe(dumpStore(db, 'akizuki'));

    // Re-importing is a no-op.
    const before = dumpStore(db, 'akizuki');
    expect(importSnapshot(db, aug, { capabilities: caps }).status).toBe('already_imported');
    expect(importSnapshot(db, sep, { capabilities: caps }).status).toBe('already_imported');
    expect(dumpStore(db, 'akizuki')).toBe(before);
  }, 120_000);
});
