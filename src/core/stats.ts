import type { ChangePoint } from './history.ts';
import { comparePrices, type PriceChange, type PricePoint } from './price.ts';

/**
 * Statistics over ONE comparable price segment (one basis of one offer).
 * "Observed minimum/maximum" are minima over the observation window, never a
 * claim about the all-time price.
 */
export interface SegmentStats {
  current: PricePoint;
  /** The change point before the current one (the previous *distinct* price). */
  previousDistinct: PricePoint | null;
  change: PriceChange;
  /** Lowest `min` amount among non-unavailable points in the segment. */
  observedMinMinor: number | null;
  /** Highest `max` amount among non-unavailable points in the segment. */
  observedMaxMinor: number | null;
  /** Time of the first change point of the segment. */
  segmentStartAt: number;
  /** Time of the current change point. */
  currentSinceAt: number;
  changePointCount: number;
}

export function computeSegmentStats(points: readonly ChangePoint<PricePoint>[]): SegmentStats | null {
  const last = points[points.length - 1];
  const first = points[0];
  if (last === undefined || first === undefined) return null;
  const prev = points.length >= 2 ? (points[points.length - 2] as ChangePoint<PricePoint>) : undefined;
  let min: number | null = null;
  let max: number | null = null;
  for (const p of points) {
    if (p.state.state === 'unavailable') continue;
    const lo = p.state.minAmountMinor as number;
    const hi = p.state.maxAmountMinor as number;
    if (min === null || lo < min) min = lo;
    if (max === null || hi > max) max = hi;
  }
  return {
    current: last.state,
    previousDistinct: prev?.state ?? null,
    change: prev ? comparePrices(prev.state, last.state) : { differenceMinor: null, percent: null, direction: 'unknown' },
    observedMinMinor: min,
    observedMaxMinor: max,
    segmentStartAt: first.t,
    currentSinceAt: last.t,
    changePointCount: points.length,
  };
}

export interface WindowStats {
  minMinor: number;
  maxMinor: number;
}

/**
 * Lowest / highest price in effect during `[start, end]`, counting a price
 * only while the segment was listed (`presence` true). A price point stays in
 * effect until the next point; a presence gap suspends it. Returns `null`
 * when nothing priced was listed inside the window.
 */
export function windowStats(
  points: readonly ChangePoint<PricePoint>[],
  presence: readonly ChangePoint<boolean>[],
  start: number,
  end: number,
): WindowStats | null {
  if (start > end) return null;
  // Merge both change-point streams into one ascending walk.
  const events: { t: number; kind: 'price' | 'presence'; index: number }[] = [];
  points.forEach((p, index) => events.push({ t: p.t, kind: 'price', index }));
  presence.forEach((p, index) => events.push({ t: p.t, kind: 'presence', index }));
  events.sort((a, b) => a.t - b.t || (a.kind === 'presence' ? -1 : 1));

  let price: PricePoint | undefined;
  let present = false;
  let min: number | null = null;
  let max: number | null = null;
  const fold = (from: number, to: number) => {
    // Interval [from, to) — `to` exclusive, but a window boundary equal to a
    // point time still sees the state in effect at that instant.
    if (to < from || to < start || from > end) return;
    if (!present || price === undefined || price.state === 'unavailable') return;
    const lo = price.minAmountMinor as number;
    const hi = price.maxAmountMinor as number;
    if (min === null || lo < min) min = lo;
    if (max === null || hi > max) max = hi;
  };
  let cursor = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (e.t > end) break;
    fold(cursor, e.t - 1);
    cursor = e.t;
    if (e.kind === 'price') price = (points[e.index] as ChangePoint<PricePoint>).state;
    else present = (presence[e.index] as ChangePoint<boolean>).state;
  }
  fold(cursor, end);
  return min === null || max === null ? null : { minMinor: min, maxMinor: max };
}
