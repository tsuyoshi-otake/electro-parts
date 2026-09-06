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
function firstRunBetween(runs: readonly number[], after: number, before: number): number | undefined {
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

/**
 * Inserts one observation into a change-point series.
 *
 * @param series   existing change points (sorted, adjacent-distinct)
 * @param obs      the observation to insert
 * @param runs     ascending times of every run in which this entity was
 *                 observed, EXCLUDING `obs.t`. Every time in `series` must be
 *                 in `runs`.
 * @param equal    state equality
 */
export function insertObservation<S>(
  series: readonly ChangePoint<S>[],
  obs: ChangePoint<S>,
  runs: readonly number[],
  equal: Equal<S>,
): InsertResult<S> {
  const idx = lowerBound(series, obs.t);
  const existing = series[idx];
  if (existing !== undefined && existing.t === obs.t) {
    if (equal(existing.state, obs.state)) return { series: series.slice(), changed: false };
    throw new SeriesConflictError(`conflicting state for existing change point at ${obs.t}`);
  }
  const prev = idx > 0 ? series[idx - 1] : undefined;
  const next = existing; // first change point after obs.t, if any

  if (prev !== undefined) {
    if (equal(prev.state, obs.state)) {
      // Observation lies inside prev's span with the same state: nothing new.
      return { series: series.slice(), changed: false };
    }
    const nextT = next?.t ?? Number.POSITIVE_INFINITY;
    const returnRun = firstRunBetween(runs, obs.t, nextT);
    const head = series.slice(0, idx);
    const tail = series.slice(idx);
    if (returnRun !== undefined) {
      // prev's state was confirmed again at `returnRun`, so the span splits.
      return {
        series: [...head, { t: obs.t, state: obs.state }, { t: returnRun, state: prev.state }, ...tail],
        changed: true,
      };
    }
    if (next !== undefined && equal(next.state, obs.state)) {
      // obs starts the state earlier than previously known; merge with next.
      return { series: [...head, { t: obs.t, state: obs.state }, ...tail.slice(1)], changed: true };
    }
    return { series: [...head, { t: obs.t, state: obs.state }, ...tail], changed: true };
  }

  // No earlier change point: obs becomes the head.
  if (next !== undefined && equal(next.state, obs.state)) {
    return { series: [{ t: obs.t, state: obs.state }, ...series.slice(1)], changed: true };
  }
  return { series: [{ t: obs.t, state: obs.state }, ...series], changed: true };
}

const equalBoolean: Equal<boolean> = (a, b) => a === b;

/**
 * Presence series (present / absent) over *every* run of the store, because a
 * complete crawl observes each known entity as either present or absent.
 *
 * Leading `absent` change points are kept in storage: dropping them at insert
 * time loses information when an earlier run is imported later (out-of-order
 * import), which breaks order independence. `canonicalPresence` trims them
 * for publication.
 */
export function insertPresence(
  series: readonly ChangePoint<boolean>[],
  obs: ChangePoint<boolean>,
  runs: readonly number[],
): InsertResult<boolean> {
  return insertObservation(series, obs, runs, equalBoolean);
}

/** Presence series without leading `absent` change points (starts at first sighting). */
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
