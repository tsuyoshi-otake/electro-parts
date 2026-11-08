/**
 * Observation days. The scheduled crawl wakes daily at 05:00 JST and observes
 * every store that is still observed on each wake-up. Days are counted from this
 * anchor (2026-09-10 20:00Z = 05:00 JST on 2026-09-11). A day starts at 05:00
 * JST, before the run starts, so a run that GitHub delays by hours still falls
 * on the day it was scheduled for.
 */
export const OBSERVATION_DAY_ANCHOR_MS = Date.parse('2026-09-10T20:00:00Z');
const DAY_MS = 86_400_000;

/**
 * Whole observation-calendar days elapsed since the anchor: the number of this
 * observation. It advances by one on every observation day, so consecutive
 * observations get consecutive numbers; a manual run on the same day gets the
 * same number as the scheduled one.
 */
export function observationDayCount(nowMs: number): number {
  if (!Number.isFinite(nowMs)) throw new Error('Invalid observation time');
  return Math.floor((nowMs - OBSERVATION_DAY_ANCHOR_MS) / DAY_MS);
}
