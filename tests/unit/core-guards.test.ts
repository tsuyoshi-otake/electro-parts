import { describe, expect, it } from 'vitest';
import {
  assertSeriesInvariants,
  firstRunBetween,
  latest,
  reduceInOrder,
  SeriesConflictError,
  windowOf,
  type ChangePoint,
} from '../../src/core/history.ts';
import { assertSafeKey, assertStoreId, isSafeKey, isValidStoreId, manifestCacheKey, productCacheKey } from '../../src/core/identity.ts';
import {
  basisKey,
  comparePrices,
  exactPrice,
  isValidPricePoint,
  pricePointKey,
  rangePrice,
  sameBasis,
  samePricePoint,
  UNAVAILABLE_PRICE,
  type PriceBasis,
} from '../../src/core/price.ts';
import { sanityCheck, summarizeForSanity } from '../../src/core/sanity.ts';
import { computeSegmentStats, windowStats } from '../../src/core/stats.ts';
import { isValidEpochMs, normalizeUtcIso, parseUtcMs, toUtcIso } from '../../src/core/time.ts';
import { quote, syntheticSnapshot } from '../helpers/synthetic.ts';

/**
 * Boundary tests for the store-neutral guards. Each case pins one edge that
 * mutation testing showed to be unobserved: exact thresholds, null handling,
 * ordering ties and error messages.
 */

describe('identity', () => {
  it('accepts keys of letters, digits and ._- up to 128 chars', () => {
    expect(isSafeKey('109951')).toBe(true);
    expect(isSafeKey('a.b-c_d')).toBe(true);
    expect(isSafeKey('A'.repeat(128))).toBe(true);
    expect(isSafeKey('A'.repeat(129))).toBe(false);
  });
  it('rejects empty, leading punctuation, separators and dot segments', () => {
    for (const bad of ['', '.', '..', '.hidden', '-x', '_x', 'a/b', 'a\\b', 'a b', 'a?b', 'ä', '..x', 'a..']) {
      expect(isSafeKey(bad), bad).toBe(bad === 'a..');
    }
  });
  it('assertSafeKey names the offending value', () => {
    expect(assertSafeKey('42', 'page key')).toBe('42');
    expect(() => assertSafeKey('a/b', 'page key')).toThrow('page key is not a safe key: "a/b"');
  });
  it('store ids are lower-case slugs of 2..32 chars', () => {
    expect(isValidStoreId('akizuki')).toBe(true);
    expect(isValidStoreId('a1-b')).toBe(true);
    expect(isValidStoreId('a')).toBe(false);
    expect(isValidStoreId('Akizuki')).toBe(false);
    expect(isValidStoreId('1abc')).toBe(false);
    expect(isValidStoreId('a'.repeat(33))).toBe(false);
    expect(assertStoreId('ok-store')).toBe('ok-store');
    expect(() => assertStoreId('NO')).toThrow('invalid store id: "NO"');
  });
  it('cache keys separate contract major, store and page key', () => {
    expect(productCacheKey(1, 's', 'p')).toBe('eph:1:s:p');
    expect(productCacheKey(2, 's', 'p')).not.toBe(productCacheKey(1, 's', 'p'));
    expect(productCacheKey(1, 'a', 'p')).not.toBe(productCacheKey(1, 'b', 'p'));
    expect(manifestCacheKey(1, 's')).toBe('eph:1:s:__manifest__');
  });
});

describe('time', () => {
  it('parses only ISO-8601 with an explicit offset', () => {
    expect(parseUtcMs('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1));
    expect(parseUtcMs('2026-01-01T09:00:00+09:00')).toBe(Date.UTC(2026, 0, 1));
    expect(parseUtcMs('2026-01-01T00:00:00.123456789Z')).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 123));
    expect(() => parseUtcMs('2026-01-01T00:00:00')).toThrow('explicit offset: "2026-01-01T00:00:00"');
    expect(() => parseUtcMs('2026-01-01')).toThrow('explicit offset');
    expect(() => parseUtcMs(42 as unknown as string)).toThrow('explicit offset');
    expect(() => parseUtcMs('2026-13-45T00:00:00Z')).toThrow('invalid timestamp: "2026-13-45T00:00:00Z"');
  });
  it('formats and round-trips', () => {
    expect(toUtcIso(Date.UTC(2026, 0, 1))).toBe('2026-01-01T00:00:00.000Z');
    expect(() => toUtcIso(1.5)).toThrow('invalid epoch ms: 1.5');
    expect(() => toUtcIso(Number.NaN)).toThrow('invalid epoch ms');
    expect(normalizeUtcIso('2026-01-01T09:00:00+09:00')).toBe('2026-01-01T00:00:00.000Z');
  });
  it('isValidEpochMs is the half-open range [2000-01-01, 2100-01-01)', () => {
    expect(isValidEpochMs(946684800000)).toBe(true);
    expect(isValidEpochMs(946684800000 - 1)).toBe(false);
    expect(isValidEpochMs(4102444800000 - 1)).toBe(true);
    expect(isValidEpochMs(4102444800000)).toBe(false);
    expect(isValidEpochMs(1.5e12 + 0.5)).toBe(false);
    expect(isValidEpochMs('1500000000000')).toBe(false);
    expect(isValidEpochMs(null)).toBe(false);
  });
});

describe('price', () => {
  const basis: PriceBasis = { quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', unitLabel: '1個' };
  it('bases differ on any attribute and the key encodes all four', () => {
    expect(sameBasis(basis, { ...basis })).toBe(true);
    expect(sameBasis(basis, { ...basis, quoteKind: 'compare_at' })).toBe(false);
    expect(sameBasis(basis, { ...basis, taxTreatment: 'tax_excluded' })).toBe(false);
    expect(sameBasis(basis, { ...basis, currency: 'USD' })).toBe(false);
    expect(sameBasis(basis, { ...basis, unitLabel: null })).toBe(false);
    const NUL = String.fromCharCode(0);
    expect(basisKey(basis)).toBe(['selling', 'tax_included', 'JPY', '1個'].join(NUL));
    // A null unit label is encoded as a U+0001 sentinel, distinct from the empty string.
    expect(basisKey({ ...basis, unitLabel: null })).toBe(['selling', 'tax_included', 'JPY', String.fromCharCode(1)].join(NUL));
    expect(basisKey({ ...basis, unitLabel: '' })).not.toBe(basisKey({ ...basis, unitLabel: null }));
  });
  it('validates points strictly', () => {
    expect(isValidPricePoint(UNAVAILABLE_PRICE)).toBe(true);
    expect(isValidPricePoint({ state: 'unavailable', minAmountMinor: 1, maxAmountMinor: null })).toBe(false);
    expect(isValidPricePoint({ state: 'unavailable', minAmountMinor: null, maxAmountMinor: 1 })).toBe(false);
    expect(isValidPricePoint({ state: 'exact', minAmountMinor: null, maxAmountMinor: 1 })).toBe(false);
    expect(isValidPricePoint({ state: 'exact', minAmountMinor: 1, maxAmountMinor: null })).toBe(false);
    expect(isValidPricePoint({ state: 'exact', minAmountMinor: 1.5, maxAmountMinor: 1.5 })).toBe(false);
    expect(isValidPricePoint({ state: 'exact', minAmountMinor: 1, maxAmountMinor: 1.5 })).toBe(false);
    expect(isValidPricePoint({ state: 'exact', minAmountMinor: -1, maxAmountMinor: -1 })).toBe(false);
    expect(isValidPricePoint({ state: 'range', minAmountMinor: 0, maxAmountMinor: -1 })).toBe(false);
    expect(isValidPricePoint({ state: 'exact', minAmountMinor: 0, maxAmountMinor: 0 })).toBe(true);
    expect(isValidPricePoint({ state: 'exact', minAmountMinor: 1, maxAmountMinor: 2 })).toBe(false);
    expect(isValidPricePoint({ state: 'range', minAmountMinor: 2, maxAmountMinor: 1 })).toBe(false);
    expect(isValidPricePoint({ state: 'range', minAmountMinor: 2, maxAmountMinor: 2 })).toBe(false);
    expect(isValidPricePoint({ state: 'range', minAmountMinor: 1, maxAmountMinor: 2 })).toBe(true);
  });
  it('rangePrice collapses to exact and keys are distinct', () => {
    expect(rangePrice(5, 5)).toEqual(exactPrice(5));
    expect(rangePrice(5, 6)).toEqual({ state: 'range', minAmountMinor: 5, maxAmountMinor: 6 });
    expect(samePricePoint(exactPrice(5), exactPrice(5))).toBe(true);
    expect(samePricePoint(exactPrice(5), rangePrice(5, 6))).toBe(false);
    expect(pricePointKey(exactPrice(5))).toBe('exact:5:5');
    expect(pricePointKey(UNAVAILABLE_PRICE)).toBe('unavailable:null:null');
    expect(pricePointKey(exactPrice(5))).not.toBe(pricePointKey(rangePrice(5, 6)));
  });
  it('comparePrices: direction, percent rounding, zero base and non-exact sides', () => {
    expect(comparePrices(exactPrice(1150), exactPrice(1200))).toEqual({ differenceMinor: 50, percent: 4.35, direction: 'up' });
    expect(comparePrices(exactPrice(1200), exactPrice(1150))).toEqual({ differenceMinor: -50, percent: -4.17, direction: 'down' });
    expect(comparePrices(exactPrice(7), exactPrice(7))).toEqual({ differenceMinor: 0, percent: 0, direction: 'flat' });
    expect(comparePrices(exactPrice(0), exactPrice(7))).toEqual({ differenceMinor: 7, percent: null, direction: 'up' });
    expect(comparePrices(rangePrice(1, 2), exactPrice(7)).direction).toBe('unknown');
    expect(comparePrices(exactPrice(7), UNAVAILABLE_PRICE)).toEqual({ differenceMinor: null, percent: null, direction: 'unknown' });
  });
});

describe('sanity', () => {
  const snap = (products: { id: string; price?: number | null }[], coverageId = 'all') =>
    syntheticSnapshot('2026-02-01T00:00:00Z', products.map((p) => ({ id: p.id, price: p.price === undefined ? 100 : p.price })), { coverageId });
  const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: String(1000 + from + i) }));

  it('flags unavailable prices strictly above the ratio', () => {
    const half = [...ids(2), { id: '9001', price: null }, { id: '9002', price: null }];
    expect(sanityCheck(snap(half), null, { maxUnavailablePriceRatio: 0.5, maxItemCountDropRatio: 1, maxMissingProductRatio: 1, maxPriceChangeRatio: 1 }).errors).toEqual([]);
    const more = [...ids(1), { id: '9001', price: null }, { id: '9002', price: null }];
    const r = sanityCheck(snap(more), null, { maxUnavailablePriceRatio: 0.5, maxItemCountDropRatio: 1, maxMissingProductRatio: 1, maxPriceChangeRatio: 1 });
    expect(r.errors.map((e) => e.code)).toEqual(['sanity.unavailable_price_ratio']);
    expect(r.errors[0]?.message).toBe('2/3 products have no usable price');
    expect(r.metrics['unavailablePriceCount']).toBe(2);
    expect(sanityCheck(snap([]), null).errors).toEqual([]);
  });
  it('a coverage change is a warning and skips the comparisons', () => {
    const prev = summarizeForSanity(snap(ids(10), 'all'));
    const r = sanityCheck(snap(ids(1), 'rkit'), prev);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['sanity.coverage_changed']);
    expect(r.warnings[0]?.message).toContain('from all to rkit');
    expect(r.metrics['itemCountDropRatio']).toBeUndefined();
  });
  it('item count drop and missing products at the boundary', () => {
    const prev = summarizeForSanity(snap(ids(10)));
    expect(sanityCheck(snap(ids(8)), prev).errors).toEqual([]); // exactly 20 %
    const r = sanityCheck(snap(ids(7)), prev);
    expect(r.errors.map((e) => e.code)).toEqual(['sanity.item_count_drop', 'sanity.missing_product_ratio']);
    expect(r.errors[0]?.message).toBe('item count dropped from 10 to 7 (30.0%)');
    expect(r.metrics['itemCountDropRatio']).toBe(0.3);
    expect(r.metrics['missingProducts']).toBe(3);
    expect(r.metrics['commonProducts']).toBe(7);
    // Same count, but different ids: no drop, missing products only.
    const replaced = sanityCheck(snap(ids(10, 5)), prev);
    expect(replaced.errors.map((e) => e.code)).toEqual(['sanity.missing_product_ratio']);
    expect(replaced.metrics['newProducts']).toBe(5);
  });
  it('price change ratio counts the primary price of common products only', () => {
    const prev = summarizeForSanity(snap(ids(10)));
    const changed = ids(10).map((p, i) => ({ id: p.id, price: i < 3 ? 200 : 100 }));
    expect(sanityCheck(snap(changed), prev).errors).toEqual([]); // 30 % is not > 30 %
    const four = ids(10).map((p, i) => ({ id: p.id, price: i < 4 ? 200 : 100 }));
    const r = sanityCheck(snap(four), prev);
    expect(r.errors.map((e) => e.code)).toEqual(['sanity.price_change_ratio']);
    expect(r.errors[0]?.message).toBe('4/10 common products changed price (40.0%)');
    expect(r.metrics['priceChangeRatio']).toBe(0.4);
  });
  it('summary picks the smallest offer id and basis key deterministically', () => {
    const s = syntheticSnapshot('2026-02-01T00:00:00Z', [
      {
        id: '1',
        offers: [
          { offerId: 'b', price: 1 },
          { offerId: 'a', quotes: [quote(5, '1袋'), quote(3, '1個')] },
        ],
      },
    ]);
    const summary = summarizeForSanity(s);
    expect(summary.primaryPriceByProduct.get('1')).toBe(['selling', 'tax_included', 'JPY', '1個'].join(String.fromCharCode(0)) + '|exact:3:3');
    expect(summary.itemCount).toBe(1);
    expect(summary.coverageId).toBe('all');
  });
});

describe('history helpers', () => {
  const eq = (a: number, b: number) => a === b;
  const cp = (t: number, state: number): ChangePoint<number> => ({ t, state });

  it('reduceInOrder sorts, collapses equal neighbours and rejects conflicting duplicates', () => {
    expect(reduceInOrder([cp(3, 1), cp(1, 1), cp(2, 1), cp(4, 2)], eq)).toEqual([cp(1, 1), cp(4, 2)]);
    expect(reduceInOrder([cp(1, 1), cp(1, 1)], eq)).toEqual([cp(1, 1)]);
    expect(() => reduceInOrder([cp(1, 1), cp(1, 2)], eq)).toThrow(SeriesConflictError);
    expect(() => reduceInOrder([cp(1, 1), cp(1, 2)], eq)).toThrow('duplicate time 1');
    const input = [cp(2, 1), cp(1, 2)];
    reduceInOrder(input, eq);
    expect(input).toEqual([cp(2, 1), cp(1, 2)]); // input untouched
  });
  it('assertSeriesInvariants reports the failing index', () => {
    expect(() => assertSeriesInvariants([cp(1, 1), cp(2, 2)], eq)).not.toThrow();
    expect(() => assertSeriesInvariants([cp(1, 1), cp(1, 2)], eq)).toThrow('series not strictly ascending at index 1');
    expect(() => assertSeriesInvariants([cp(1, 1), cp(2, 2), cp(3, 2)], eq)).toThrow('adjacent duplicate state at index 2');
    expect(() => assertSeriesInvariants([], eq)).not.toThrow();
  });
  it('latest returns the last point or undefined', () => {
    expect(latest([])).toBeUndefined();
    expect(latest([cp(1, 1), cp(5, 2)])).toEqual(cp(5, 2));
  });
  it('windowOf distinguishes an existing point from a gap and exposes neighbours', () => {
    const s = [cp(10, 1), cp(20, 2), cp(30, 3)];
    expect(windowOf(s, 20)).toEqual({ existing: cp(20, 2), prev: cp(10, 1), next: cp(30, 3) });
    expect(windowOf(s, 10)).toEqual({ existing: cp(10, 1), prev: undefined, next: cp(20, 2) });
    expect(windowOf(s, 30)).toEqual({ existing: cp(30, 3), prev: cp(20, 2), next: undefined });
    expect(windowOf(s, 15)).toEqual({ existing: undefined, prev: cp(10, 1), next: cp(20, 2) });
    expect(windowOf(s, 5)).toEqual({ existing: undefined, prev: undefined, next: cp(10, 1) });
    expect(windowOf(s, 35)).toEqual({ existing: undefined, prev: cp(30, 3), next: undefined });
  });
  it('firstRunBetween is exclusive on both ends', () => {
    const runs = [10, 20, 30];
    expect(firstRunBetween(runs, 10, 30)).toBe(20);
    expect(firstRunBetween(runs, 10, 20)).toBeUndefined();
    expect(firstRunBetween(runs, 5, 10)).toBeUndefined();
    expect(firstRunBetween(runs, 5, 11)).toBe(10);
    expect(firstRunBetween(runs, 30, 100)).toBeUndefined();
    expect(firstRunBetween([], 0, 100)).toBeUndefined();
  });
});

describe('stats', () => {
  const pt = (t: number, price: number | null): ChangePoint<import('../../src/core/price.ts').PricePoint> => ({ t, state: price === null ? UNAVAILABLE_PRICE : exactPrice(price) });
  it('segment stats over one, two and unavailable points', () => {
    expect(computeSegmentStats([])).toBeNull();
    const one = computeSegmentStats([pt(1, 100)]);
    expect(one).toMatchObject({ previousDistinct: null, change: { direction: 'unknown', differenceMinor: null }, observedMinMinor: 100, observedMaxMinor: 100, segmentStartAt: 1, currentSinceAt: 1, changePointCount: 1 });
    const two = computeSegmentStats([pt(1, 100), pt(5, 80)]);
    expect(two).toMatchObject({ previousDistinct: exactPrice(100), change: { direction: 'down', differenceMinor: -20, percent: -20 }, observedMinMinor: 80, observedMaxMinor: 100, currentSinceAt: 5 });
    const gap = computeSegmentStats([pt(1, null), pt(2, null)]);
    expect(gap).toMatchObject({ observedMinMinor: null, observedMaxMinor: null, change: { direction: 'unknown' } });
    const range = computeSegmentStats([{ t: 1, state: rangePrice(10, 30) }, pt(2, 20)]);
    expect(range).toMatchObject({ observedMinMinor: 10, observedMaxMinor: 30 });
  });
  it('window stats respect presence, unavailable prices and window edges', () => {
    const points = [pt(10, 100), pt(20, 50), pt(30, null), pt(40, 70)];
    const present = [{ t: 10, state: true }];
    expect(windowStats(points, present, 10, 15)).toEqual({ minMinor: 100, maxMinor: 100 });
    expect(windowStats(points, present, 20, 20)).toEqual({ minMinor: 50, maxMinor: 50 });
    expect(windowStats(points, present, 25, 35)).toEqual({ minMinor: 50, maxMinor: 50 });
    expect(windowStats(points, present, 30, 39)).toBeNull();
    expect(windowStats(points, present, 0, 9)).toBeNull();
    expect(windowStats(points, present, 5, 45)).toEqual({ minMinor: 50, maxMinor: 100 });
    expect(windowStats(points, present, 41, 30)).toBeNull();
    expect(windowStats(points, [], 0, 100)).toBeNull();
    // Delisted between 20 and 40: the 50 price never counts.
    const gapped = [{ t: 10, state: true }, { t: 20, state: false }, { t: 40, state: true }];
    expect(windowStats(points, gapped, 0, 100)).toEqual({ minMinor: 70, maxMinor: 100 });
    // Presence and price change at the same instant: presence is applied first.
    const same = [{ t: 20, state: true }];
    expect(windowStats(points, same, 20, 20)).toEqual({ minMinor: 50, maxMinor: 50 });
    expect(windowStats([{ t: 1, state: rangePrice(10, 30) }], [{ t: 1, state: true }], 1, 2)).toEqual({ minMinor: 10, maxMinor: 30 });
  });
});
