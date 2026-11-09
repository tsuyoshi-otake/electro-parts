import type { AvailabilityPointV1, InventoryPointV1 } from '../../src/publisher/contract.ts';
import { DAY_MS } from './chartPeriod.ts';

/**
 * An estimate of the units sold in a window, from the stock counts a store's
 * page showed (ADR-0031). It is a reading of the recorded counts, not a sales
 * figure: nobody observes a sale, only the count before and after.
 *
 * The rule: between two consecutive recorded counts, a lower count is taken as
 * sales and a higher count as stock added. A change is attributed to the
 * observation that first showed it, so a decrease first seen inside the window
 * belongs to it even if the count it fell from was recorded earlier.
 *
 * What it cannot know, and the caller must say so:
 * - Sales and restocking inside one observation gap cancel (the estimate is
 *   then too low), and a returned or corrected count counts as a sale when it
 *   lowers the count (too high). It is a guide, not a bound in either direction.
 * - A count the store shows capped (`N+`) is a lower bound, so a decrease from
 *   it is at least what is counted: `atLeast`.
 * - A missing count carries no number. It counts as zero only while the offer
 *   is out of stock, so a sell-out is not lost; otherwise the pair is skipped.
 */

export interface SalesEstimate {
  /** Units: the sum of the decreases between consecutive counts inside the window. */
  soldUnits: number;
  /** How many decreases that sum is made of. */
  decreases: number;
  /** Units: the sum of the increases (restocking, returns, corrections). */
  addedUnits: number;
  increases: number;
  /** A decrease started from a count the store shows capped, so the true figure is at least `soldUnits`. */
  atLeast: boolean;
  /** Where the estimate starts: the window start, or the first recorded count when that is later. */
  since: number;
}

interface Count {
  t: number;
  /** `null` = no count to read at that observation. */
  quantity: number | null;
}

/**
 * Counts with the out-of-stock rule applied. Both inputs are in time order,
 * as the published series are.
 */
function readCounts(points: readonly InventoryPointV1[], availability: readonly AvailabilityPointV1[]): Count[] {
  let a = 0;
  let outOfStock = false;
  return points.map(([t, quantity]) => {
    while (a < availability.length && (availability[a] as AvailabilityPointV1)[0] <= t) {
      outOfStock = (availability[a] as AvailabilityPointV1)[1] === 'out_of_stock';
      a += 1;
    }
    return { t, quantity: quantity === null && outOfStock ? 0 : quantity };
  });
}

/**
 * Estimates the units sold between `from` and `to`. `null` when no count was
 * recorded at or before `to`, so there is nothing to estimate from.
 */
export function estimateSales(
  points: readonly InventoryPointV1[],
  availability: readonly AvailabilityPointV1[],
  from: number,
  to: number,
  cappedAt?: number,
): SalesEstimate | null {
  const counts = readCounts(points, availability);
  const first = counts.find((c) => c.quantity !== null && c.t <= to);
  if (first === undefined) return null;
  const out: SalesEstimate = { soldUnits: 0, decreases: 0, addedUnits: 0, increases: 0, atLeast: false, since: Math.max(from, first.t) };
  for (let i = 1; i < counts.length; i++) {
    const prev = counts[i - 1] as Count;
    const cur = counts[i] as Count;
    if (cur.t < from || cur.t > to || prev.quantity === null || cur.quantity === null) continue;
    const change = prev.quantity - cur.quantity;
    if (change > 0) {
      out.soldUnits += change;
      out.decreases += 1;
      if (cappedAt !== undefined && prev.quantity >= cappedAt) out.atLeast = true;
    } else if (change < 0) {
      out.addedUnits -= change;
      out.increases += 1;
    }
  }
  return out;
}

/** Whether the estimate starts clearly after the window does, so the reader should be told. */
export function startsLate(estimate: SalesEstimate, from: number): boolean {
  return estimate.since - from >= DAY_MS;
}
