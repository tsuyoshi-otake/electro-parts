import { stateAt } from '../core/history.ts';
import { basisKey, pricePointKey } from '../core/price.ts';
import type { PreviousSnapshotSummary } from '../core/sanity.ts';
import type { Db } from './connection.ts';
import { listRuns, readStoreHistory } from './read.ts';

/**
 * Reconstructs, from the history tables, what `summarizeForSanity` would have
 * produced for the most recently *observed* run of a store: the products
 * present at that time and their primary price key. Used to compare a new
 * snapshot against the previous accepted one without keeping raw snapshots.
 *
 * The primary price is the first present basis of the first offer, in the
 * same order the reader returns them (offer id, then basis key).
 */
export function latestSnapshotSummary(db: Db, storeId: string): PreviousSnapshotSummary | null {
  const runs = listRuns(db, storeId);
  const latest = runs[runs.length - 1];
  if (latest === undefined) return null;
  const history = readStoreHistory(db, storeId);
  const t = latest.observedAt;
  const map = new Map<string, string>();
  let itemCount = 0;
  for (const p of history.products) {
    if (stateAt(p.presence, t) !== true) continue;
    itemCount += 1;
    const offer = p.offers.find((o) => stateAt(o.presence, t) === true);
    if (offer === undefined) continue;
    const basis = offer.bases.find((b) => stateAt(b.presence, t) === true);
    if (basis === undefined) continue;
    const price = stateAt(basis.prices, t);
    if (price === undefined) continue;
    map.set(p.externalProductId, `${basisKey(basis.basis)}|${pricePointKey(price)}`);
  }
  return { observedAt: latest.observedAtIso, coverageId: latest.coverageId, itemCount, primaryPriceByProduct: map };
}
