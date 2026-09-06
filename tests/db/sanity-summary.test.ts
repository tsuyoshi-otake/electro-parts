import { describe, expect, it } from 'vitest';
import { AKIZUKI_CAPABILITIES } from '../../src/adapters/akizuki/capabilities.ts';
import { sanityCheck, summarizeForSanity } from '../../src/core/sanity.ts';
import { openInMemory } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate } from '../../src/db/migrations/index.ts';
import { latestSnapshotSummary } from '../../src/db/sanitySummary.ts';
import { loadAkizukiNormalized } from '../helpers/fixtures.ts';
import { day, quote, syntheticSnapshot, SYNTHETIC_CAPABILITIES } from '../helpers/synthetic.ts';

describe('sanity summary reconstructed from the database', () => {
  it('equals the summary of the snapshot that was imported last (real data)', async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');
    const db = openInMemory();
    migrate(db);
    expect(latestSnapshotSummary(db, 'akizuki')).toBeNull();
    importSnapshot(db, aug, { capabilities: AKIZUKI_CAPABILITIES });
    const fromDb = latestSnapshotSummary(db, 'akizuki')!;
    const direct = summarizeForSanity(aug);
    expect(fromDb.observedAt).toBe(direct.observedAt);
    expect(fromDb.coverageId).toBe(direct.coverageId);
    expect(fromDb.itemCount).toBe(direct.itemCount);
    expect(fromDb.primaryPriceByProduct.size).toBe(direct.primaryPriceByProduct.size);
    let mismatches = 0;
    for (const [id, key] of direct.primaryPriceByProduct) if (fromDb.primaryPriceByProduct.get(id) !== key) mismatches += 1;
    expect(mismatches).toBe(0);
    // Hence the sanity verdict on the next snapshot is identical either way.
    const viaDb = sanityCheck(sep, fromDb);
    const viaSnapshot = sanityCheck(sep, direct);
    expect(viaDb).toEqual(viaSnapshot);
    expect(viaDb.metrics['primaryPriceChanges']).toBe(168);
    db.close();
  });

  it('describes the latest *observed* run, not the latest imported one, and ignores absent products', () => {
    const db = openInMemory();
    migrate(db);
    const d1 = syntheticSnapshot(day(1), [
      { id: 'a', quotes: [quote(100)] },
      { id: 'b', quotes: [quote(200)] },
    ]);
    const d3 = syntheticSnapshot(day(3), [
      { id: 'a', quotes: [quote(110)] },
      { id: 'c', quotes: [quote(300)] },
    ]);
    const d2 = syntheticSnapshot(day(2), [{ id: 'a', quotes: [quote(105)] }]);
    importSnapshot(db, d1, { capabilities: SYNTHETIC_CAPABILITIES });
    importSnapshot(db, d3, { capabilities: SYNTHETIC_CAPABILITIES });
    importSnapshot(db, d2, { capabilities: SYNTHETIC_CAPABILITIES }); // out of order
    const s = latestSnapshotSummary(db, d1.storeId)!;
    expect(s.observedAt).toBe(d3.observedAt);
    expect(s.itemCount).toBe(2);
    expect([...s.primaryPriceByProduct.keys()].sort()).toEqual(['a', 'c']);
    expect(s.primaryPriceByProduct).toEqual(summarizeForSanity(d3).primaryPriceByProduct);
    db.close();
  });
});
