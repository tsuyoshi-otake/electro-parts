import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assertSeriesInvariants,
  canonicalPresence,
  expandPresentRuns,
  insertObservation,
  insertPresence,
  reduceInOrder,
  type ChangePoint,
} from '../../src/core/history.ts';
import { comparePrices, exactPrice, rangePrice, UNAVAILABLE_PRICE, type PricePoint } from '../../src/core/price.ts';

/**
 * Seeds are fixed so CI failures are reproducible; fast-check prints the seed
 * and the shrunk counterexample on failure. Override with FC_SEED=<n>.
 */
const seed = Number(process.env['FC_SEED'] ?? 20260906);
const runsCount = Number(process.env['FC_RUNS'] ?? 300);
const params = { seed, numRuns: runsCount, verbose: true } as const;

const eq = (a: string, b: string) => a === b;

/** A full timeline: for each run (index = time), either absent or a state. */
const timelineArb = fc.array(fc.option(fc.constantFrom('A', 'B', 'C'), { nil: null }), {
  minLength: 1,
  maxLength: 14,
});

function permutationArb(n: number) {
  return fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n });
}

/**
 * Simulates the two-level import used by the DB: presence series over all
 * runs, and a state series over the runs in which the entity was present.
 */
function importTimeline(timeline: (string | null)[], order: number[]) {
  let presence: ChangePoint<boolean>[] = [];
  let series: ChangePoint<string>[] = [];
  const importedRuns: number[] = [];
  for (const t of order) {
    const allRuns = importedRuns.slice().sort((a, b) => a - b);
    const state = timeline[t] ?? null;
    presence = insertPresence(presence, { t, state: state !== null }, allRuns).series;
    if (state !== null) {
      const presentRuns = expandPresentRuns(presence, allRuns);
      series = insertObservation(series, { t, state }, presentRuns, eq).series;
    }
    importedRuns.push(t);
    assertSeriesInvariants(presence, (a, b) => a === b);
    assertSeriesInvariants(series, eq);
  }
  return { presence, series };
}

function oracle(timeline: (string | null)[]) {
  const obs: ChangePoint<string>[] = [];
  const pres: ChangePoint<boolean>[] = [];
  let known = false;
  timeline.forEach((state, t) => {
    if (state !== null) {
      obs.push({ t, state });
      known = true;
    }
    if (known) pres.push({ t, state: state !== null });
  });
  return { presence: reduceInOrder(pres, (a, b) => a === b), series: reduceInOrder(obs, eq) };
}

describe('history core properties', () => {
  it('import order does not change the resulting history (presence + state)', () => {
    fc.assert(
      fc.property(
        timelineArb.chain((tl) => fc.tuple(fc.constant(tl), permutationArb(tl.length))),
        ([timeline, order]) => {
          const expected = oracle(timeline);
          const actual = importTimeline(timeline, order);
          expect(actual.series).toEqual(expected.series);
          expect(canonicalPresence(actual.presence)).toEqual(expected.presence);
        },
      ),
      params,
    );
  });

  it('importing the same timeline N times is a no-op', () => {
    fc.assert(
      fc.property(timelineArb, fc.integer({ min: 1, max: 3 }), (timeline, repeats) => {
        const order = [...Array(timeline.length).keys()];
        const first = importTimeline(timeline, order);
        let presence = first.presence;
        let series = first.series;
        for (let k = 0; k < repeats; k += 1) {
          for (const t of order) {
            const runs = order.filter((r) => r !== t);
            const state = timeline[t] ?? null;
            const p = insertPresence(presence, { t, state: state !== null }, runs);
            expect(p.changed).toBe(false);
            presence = p.series;
            if (state !== null) {
              const r = insertObservation(series, { t, state }, expandPresentRuns(presence, runs), eq);
              expect(r.changed).toBe(false);
              series = r.series;
            }
          }
        }
        expect(series).toEqual(first.series);
        expect(presence).toEqual(first.presence);
      }),
      params,
    );
  });

  it('series are strictly ascending with no adjacent duplicates, and latest equals the last observation', () => {
    fc.assert(
      fc.property(
        timelineArb.chain((tl) => fc.tuple(fc.constant(tl), permutationArb(tl.length))),
        ([timeline, order]) => {
          const { series } = importTimeline(timeline, order);
          assertSeriesInvariants(series, eq);
          const lastObservedIndex = timeline.map((s, i) => (s === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
          if (lastObservedIndex >= 0) {
            expect(series[series.length - 1]?.state).toBe(timeline[lastObservedIndex]);
          } else {
            expect(series).toEqual([]);
          }
        },
      ),
      params,
    );
  });
});

const pricePointArb: fc.Arbitrary<PricePoint> = fc.oneof(
  fc.integer({ min: 0, max: 1_000_000 }).map(exactPrice),
  fc
    .tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000 }))
    .map(([a, b]) => rangePrice(Math.min(a, b), Math.max(a, b))),
  fc.constant(UNAVAILABLE_PRICE),
);

describe('price properties', () => {
  it('min <= max for every constructible price point', () => {
    fc.assert(
      fc.property(pricePointArb, (p) => {
        if (p.state === 'unavailable') {
          expect(p.minAmountMinor).toBeNull();
          expect(p.maxAmountMinor).toBeNull();
        } else {
          expect(p.minAmountMinor as number).toBeLessThanOrEqual(p.maxAmountMinor as number);
        }
      }),
      params,
    );
  });

  it('percentage is only defined between two exact prices with a non-zero previous price', () => {
    fc.assert(
      fc.property(pricePointArb, pricePointArb, (prev, cur) => {
        const c = comparePrices(prev, cur);
        if (prev.state !== 'exact' || cur.state !== 'exact') {
          expect(c.differenceMinor).toBeNull();
          expect(c.percent).toBeNull();
          expect(c.direction).toBe('unknown');
        } else {
          expect(c.differenceMinor).toBe((cur.minAmountMinor as number) - (prev.minAmountMinor as number));
          if (prev.minAmountMinor === 0) expect(c.percent).toBeNull();
          else expect(Number.isFinite(c.percent as number)).toBe(true);
        }
      }),
      params,
    );
  });
});
