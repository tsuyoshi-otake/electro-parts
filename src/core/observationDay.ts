/**
 * Observation days. The scheduled crawl wakes daily at 05:00 JST and observes
 * on every second day counted from this anchor (2026-09-11 05:00 JST). A day
 * starts at 05:00 JST, before the run starts, so a run that GitHub delays by
 * hours still falls on the day it was scheduled for.
 */
export const OBSERVATION_DAY_ANCHOR_MS = Date.parse('2026-09-10T20:00:00Z');
const DAY_MS = 86_400_000;

/** Whole observation-calendar days elapsed since the anchor. */
export function observationDayCount(nowMs: number): number {
  if (!Number.isFinite(nowMs)) throw new Error('Invalid observation time');
  return Math.floor((nowMs - OBSERVATION_DAY_ANCHOR_MS) / DAY_MS);
}

/**
 * Advances by one on each scheduled observation day (every second day), so
 * consecutive observations get consecutive numbers. A manual run on the day in
 * between gets the number of the observation day before it.
 */
export function observationRound(nowMs: number): number {
  return Math.floor(observationDayCount(nowMs) / 2);
}
