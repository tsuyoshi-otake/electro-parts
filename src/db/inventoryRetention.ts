import { transaction, type Db } from './connection.ts';

/**
 * Inventory samples are the fastest-growing series (quantities move daily).
 * Samples older than the retention window are folded into daily rollups
 * (min / max / last / count per offer per UTC day) and deleted. The rollup
 * is lossy by design; the price and availability histories are never
 * compacted.
 */
export interface InventoryRetentionOptions {
  /** Raw samples newer than this many days are kept as-is. */
  retentionDays: number;
  now?: () => Date;
}

export const DEFAULT_INVENTORY_RETENTION_DAYS = 400;

export interface CompactionResult {
  cutoffIso: string;
  samplesCompacted: number;
  rollupsWritten: number;
}

export function compactInventory(db: Db, options: InventoryRetentionOptions): CompactionResult {
  const nowMs = (options.now ?? (() => new Date()))().getTime();
  const cutoff = nowMs - options.retentionDays * 86_400_000;
  return transaction(db, () => {
    // The last raw sample before the cutoff is kept: it carries the quantity
    // in effect at the start of the retained window (change-point semantics).
    const rows = db
      .prepare(
        `SELECT s.offer_id, s.observed_at, s.quantity FROM inventory_samples s
         WHERE s.observed_at < ?
           AND s.observed_at < (SELECT MAX(observed_at) FROM inventory_samples x WHERE x.offer_id = s.offer_id AND x.observed_at < ?)
         ORDER BY s.offer_id, s.observed_at`,
      )
      .all(cutoff, cutoff) as { offer_id: number; observed_at: number; quantity: number | null }[];
    const upsert = db.prepare(
      `INSERT INTO inventory_rollups(offer_id, day, min_quantity, max_quantity, last_quantity, sample_count) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(offer_id, day) DO UPDATE SET
         min_quantity = CASE WHEN excluded.min_quantity IS NULL THEN min_quantity WHEN min_quantity IS NULL THEN excluded.min_quantity ELSE MIN(min_quantity, excluded.min_quantity) END,
         max_quantity = CASE WHEN excluded.max_quantity IS NULL THEN max_quantity WHEN max_quantity IS NULL THEN excluded.max_quantity ELSE MAX(max_quantity, excluded.max_quantity) END,
         last_quantity = excluded.last_quantity,
         sample_count = sample_count + 1`,
    );
    const del = db.prepare('DELETE FROM inventory_samples WHERE offer_id = ? AND observed_at = ?');
    const days = new Set<string>();
    for (const r of rows) {
      const day = new Date(r.observed_at).toISOString().slice(0, 10);
      days.add(`${r.offer_id}:${day}`);
      upsert.run(r.offer_id, day, r.quantity, r.quantity, r.quantity);
      del.run(r.offer_id, r.observed_at);
    }
    return { cutoffIso: new Date(cutoff).toISOString(), samplesCompacted: rows.length, rollupsWritten: days.size };
  });
}
