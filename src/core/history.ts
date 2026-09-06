/**
 * Change-point history core.
 *
 * A series stores only the observations at which the state changed. Because
 * every imported snapshot is a *complete* crawl, the set of runs in which an
 * entity was observed is known exactly (see `expandPresentRuns`). That lets an
 * out-of-order import be inserted losslessly: an observation that lands inside
 * an existing span splits the span at the next run that was observed, instead
 * of being dropped or approximated.
 *
 * The algorithm only needs a three-point window (existing / previous / next
 * change point around the observation), so the SQLite layer can apply it
 * with indexed lookups instead of loading whole series (`planInsert`). The
 * array form (`insertObservation`) is built on the same plan and is used by
 * tests, property tests and the in-memory oracle comparison.
 *
 * Invariants (checked by property tests):
 *   - series is sorted by `t` strictly ascending
 *   - no two adjacent change points have equal state
 *   - the result is independent of import order and idempotent
 */

export interface ChangePoint<S> {
  /** UTC epoch milliseconds of the observation that introduced this state. */
  t: number;
  state: S;
}

export type Equal<S> = (a: S, b: S) => boolean;

export class SeriesConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeriesConflictError';
  }
}

export interface InsertResult<S> {
  series: ChangePoint<S>[];
  changed: boolean;
}

/** The three change points that can be affected by inserting at `t`. */
export interface SeriesWindow<S> {
  /** Change point exactly at `t`, if any. */
  existing: ChangePoint<S> | undefined;
  /** Last change point before `t`. */
  prev: ChangePoint<S> | undefined;
  /** First change point after `t`. */
  next: ChangePoint<S> | undefined;
}

export interface InsertPlan<S> {
  changed: boolean;
  /** Change points to add (none of them exist yet). */
  inserts: ChangePoint<S>[];
  /** Times of change points to remove (always `next.t` when non-empty). */
  deletes: number[];
}

/** State in effect at time `t`, or `undefined` before the first change point. */
export function stateAt<S>(series: readonly ChangePoint<S>[], t: number): S | undefined {
  let result: S | undefined;
  for (const cp of series) {
    if (cp.t > t) break;
    result = cp.state;
  }
  return result;
}

/** Index of the first change point with `t >= target` (binary search). */
function lowerBound<S>(series: readonly ChangePoint<S>[], target: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((series[mid] as ChangePoint<S>).t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First run strictly inside `(after, before)` or `undefined`. `runs` sorted ascending. */
export function firstRunBetween(runs: readonly number[], after: number, before: number): number | undefined {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((runs[mid] as number) <= after) lo = mid + 1;
    else hi = mid;
  }
  const candidate = runs[lo];
  return candidate !== undefined && candidate < before ? candidate : undefined;
}

export function windowOf<S>(series: readonly ChangePoint<S>[], t: number): SeriesWindow<S> {
  const idx = lowerBound(series, t);
  const at = series[idx];
  if (at !== undefined && at.t === t) {
    return { existing: at, prev: idx > 0 ? series[idx - 1] : undefined, next: series[idx + 1] };
  }
  return { existing: undefined, prev: idx > 0 ? series[idx - 1] : undefined, next: at };
}

/**
 * Decides how one observation changes a series.
 *
 * @param window  change points around `obs.t`
 * @param obs     the observation to insert
 * @param runs    ascending times of every run in which this entity was
 *                observed, EXCLUDING `obs.t`. Every time in the series must be
 *                in `runs`.
 * @param equal   state equality
 * @param initial optional state in effect before the first change point
 *                (a virtual `prev` at -infinity). Presence series use
 *                `absent`: an entity is absent from every run before its
 *                first sighting, so a leading `absent` observation is a
 *                no-op and a `present` observation inserted before the first
 *                sighting splits the implicit absent span exactly.
 */
export function planInsert<S>(
  window: SeriesWindow<S>,
  obs: ChangePoint<S>,
  runs: readonly number[],
  equal: Equal<S>,
  initial?: { state: S },
): InsertPlan<S> {
  const none: InsertPlan<S> = { changed: false, inserts: [], deletes: [] };
  const { existing, next } = window;
  const prev = window.prev ?? initial;
  if (existing !== undefined) {
    if (equal(existing.state, obs.state)) return none;
    throw new SeriesConflictError(`conflicting state for existing change point at ${obs.t}`);
  }
  const point = { t: obs.t, state: obs.state };
  if (prev !== undefined) {
    // Observation lies inside prev's span with the same state: nothing new.
    if (equal(prev.state, obs.state)) return none;
    const returnRun = firstRunBetween(runs, obs.t, next?.t ?? Number.POSITIVE_INFINITY);
    if (returnRun !== undefined) {
      // prev's state was confirmed again at `returnRun`, so the span splits.
      // `next` (if any) differs from prev's state because the series is
      // canonical, so the return point never duplicates it.
      return { changed: true, inserts: [point, { t: returnRun, state: prev.state }], deletes: [] };
    }
  }
  if (next !== undefined && equal(next.state, obs.state)) {
    // obs starts the state earlier than previously known; merge with next.
    return { changed: true, inserts: [point], deletes: [next.t] };
  }
  return { changed: true, inserts: [point], deletes: [] };
}

export function applyPlan<S>(series: readonly ChangePoint<S>[], plan: InsertPlan<S>): ChangePoint<S>[] {
  if (!plan.changed) return series.slice();
  const removed = new Set(plan.deletes);
  const out = series.filter((cp) => !removed.has(cp.t)).concat(plan.inserts);
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Inserts one observation into an in-memory change-point series. */
export function insertObservation<S>(
  series: readonly ChangePoint<S>[],
  obs: ChangePoint<S>,
  runs: readonly number[],
  equal: Equal<S>,
  initial?: { state: S },
): InsertResult<S> {
  const plan = planInsert(windowOf(series, obs.t), obs, runs, equal, initial);
  return { series: applyPlan(series, plan), changed: plan.changed };
}

export const equalBoolean: Equal<boolean> = (a, b) => a === b;

/** Presence series start from an implicit `absent` state. */
export const PRESENCE_INITIAL = { state: false } as const;

/**
 * Presence series (present / absent) over *every* run of the entity's
 * universe (store runs for products, product-present runs for offers, ...),
 * because a complete crawl observes each known entity as either present or
 * absent. Before its first sighting an entity is implicitly absent, which
 * makes leading `absent` observations no-ops and keeps the series canonical
 * regardless of import order (see `planInsert`'s `initial`).
 */
export function insertPresence(
  series: readonly ChangePoint<boolean>[],
  obs: ChangePoint<boolean>,
  runs: readonly number[],
): InsertResult<boolean> {
  return insertObservation(series, obs, runs, equalBoolean, PRESENCE_INITIAL);
}

/**
 * Presence series without leading `absent` change points. Insertion never
 * produces them; this is a defensive normalization for readers.
 */
export function canonicalPresence(series: readonly ChangePoint<boolean>[]): ChangePoint<boolean>[] {
  let i = 0;
  while (i < series.length && !(series[i] as ChangePoint<boolean>).state) i += 1;
  return series.slice(i);
}

/**
 * Runs (ascending) in which the entity was present according to `presence`.
 * `runs` must be ascending. Runs before the first change point are excluded.
 */
export function expandPresentRuns(
  presence: readonly ChangePoint<boolean>[],
  runs: readonly number[],
): number[] {
  const out: number[] = [];
  let i = 0;
  let current = false;
  for (const r of runs) {
    while (i < presence.length && (presence[i] as ChangePoint<boolean>).t <= r) {
      current = (presence[i] as ChangePoint<boolean>).state;
      i += 1;
    }
    if (current) out.push(r);
  }
  return out;
}

/** Naive oracle: reduce observations (sorted by t) to change points. */
export function reduceInOrder<S>(observations: readonly ChangePoint<S>[], equal: Equal<S>): ChangePoint<S>[] {
  const sorted = observations.slice().sort((a, b) => a.t - b.t);
  const out: ChangePoint<S>[] = [];
  for (const obs of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && last.t === obs.t) {
      if (!equal(last.state, obs.state)) throw new SeriesConflictError(`duplicate time ${obs.t}`);
      continue;
    }
    if (last === undefined || !equal(last.state, obs.state)) out.push({ t: obs.t, state: obs.state });
  }
  return out;
}

export function assertSeriesInvariants<S>(series: readonly ChangePoint<S>[], equal: Equal<S>): void {
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1] as ChangePoint<S>;
    const b = series[i] as ChangePoint<S>;
    if (!(a.t < b.t)) throw new Error(`series not strictly ascending at index ${i}`);
    if (equal(a.state, b.state)) throw new Error(`adjacent duplicate state at index ${i}`);
  }
}

/** Last change point (state in effect at the latest observation). */
export function latest<S>(series: readonly ChangePoint<S>[]): ChangePoint<S> | undefined {
  return series[series.length - 1];
}
