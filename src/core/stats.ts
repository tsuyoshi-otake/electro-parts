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
