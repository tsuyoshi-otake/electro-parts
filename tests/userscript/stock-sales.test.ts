import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AvailabilityPointV1, InventoryPointV1 } from '../../src/publisher/contract.ts';
import { estimateSales, startsLate } from '../../userscript/core/stockSales.ts';

const D = 86_400_000;
const t = (day: number) => 1_800_000_000_000 + day * D;
const counts = (...xs: [number, number | null][]): InventoryPointV1[] => xs.map(([day, q]) => [t(day), q]);
const stock = (day: number, state: AvailabilityPointV1[1]): AvailabilityPointV1 => [t(day), state, state === 'in_stock', 'site_reported', null];

/** Akizuki 107385 as published on 2026-11-09: 8 recorded counts over 64 days (day 0 = 2026-09-06). */
const AKIZUKI_107385 = counts([0, 150], [45, 149], [47, 145], [48, 142], [53, 127], [55, 138], [59, 134], [61, 130]);
const FOUND = [stock(0, 'in_stock')];

describe('estimated sales from recorded stock counts', () => {
  it('sums the decreases between consecutive counts, and reports the increase apart (Akizuki 107385, hand count)', () => {
    // Decreases 1 + 4 + 3 + 15 + 4 + 4 = 31 in six steps; one increase of 11.
    expect(estimateSales(AKIZUKI_107385, FOUND, t(0), t(64))).toEqual({ soldUnits: 31, decreases: 6, addedUnits: 11, increases: 1, atLeast: false, since: t(0) });
  });

  it('counts a decrease in the window where it was first seen, even from a count recorded before the window', () => {
    // From day 50 on: 142 → 127 first seen on day 53 (15), then 138 → 134 (4) and 134 → 130 (4). The 127 → 138 rise is added stock.
    expect(estimateSales(AKIZUKI_107385, FOUND, t(50), t(64))).toMatchObject({ soldUnits: 23, decreases: 3, addedUnits: 11, increases: 1 });
    // A pair belongs to the window by its later count: day 53 is in a window that starts on day 53, not in one that starts on day 54.
    expect(estimateSales(AKIZUKI_107385, FOUND, t(53), t(64))?.soldUnits).toBe(23);
    expect(estimateSales(AKIZUKI_107385, FOUND, t(54), t(64))?.soldUnits).toBe(8);
  });

  it('stops at the end of the window', () => {
    expect(estimateSales(AKIZUKI_107385, FOUND, t(0), t(53))).toMatchObject({ soldUnits: 23, decreases: 4, addedUnits: 0, increases: 0 });
    expect(estimateSales(AKIZUKI_107385, FOUND, t(0), t(52))?.soldUnits).toBe(8);
  });

  it('reads an unchanged count as zero sold, not as unknown', () => {
    expect(estimateSales(counts([0, 150]), FOUND, t(0), t(30))).toEqual({ soldUnits: 0, decreases: 0, addedUnits: 0, increases: 0, atLeast: false, since: t(0) });
    // The count held through a window that holds no point of its own.
    expect(estimateSales(AKIZUKI_107385, FOUND, t(62), t(64))).toMatchObject({ soldUnits: 0, decreases: 0 });
  });

  it('never counts an increase as a sale', () => {
    expect(estimateSales(counts([0, 20], [35, 781]), FOUND, t(0), t(35))).toMatchObject({ soldUnits: 0, addedUnits: 761, increases: 1 });
  });

  it('counts a sell-out: a missing count while the offer is out of stock is zero', () => {
    const points = counts([0, 5], [3, null], [6, 20]);
    const availability = [stock(0, 'in_stock'), stock(2, 'out_of_stock'), stock(5, 'in_stock')];
    // 5 → 0 is the sell-out; 0 → 20 is the restock, added stock and not a sale.
    expect(estimateSales(points, availability, t(0), t(8))).toMatchObject({ soldUnits: 5, decreases: 1, addedUnits: 20, increases: 1 });
    expect(estimateSales(counts([0, 5], [3, null], [6, 20], [7, 12]), availability, t(0), t(8))).toMatchObject({ soldUnits: 5 + 8, decreases: 2, addedUnits: 20 });
  });

  it('skips a pair across a missing count when nothing says the offer is out of stock', () => {
    const points = counts([0, 5], [3, null], [6, 2]);
    expect(estimateSales(points, [stock(0, 'in_stock')], t(0), t(8))).toMatchObject({ soldUnits: 0, decreases: 0, increases: 0 });
    // Availability counts only from the observation that shows it: out of stock after the missing count does not apply to it.
    expect(estimateSales(points, [stock(0, 'in_stock'), stock(4, 'out_of_stock')], t(0), t(8))).toMatchObject({ soldUnits: 0, decreases: 0 });
  });

  it('says "at least" when a decrease started from a count the store shows capped', () => {
    expect(estimateSales(counts([0, 100], [2, 80]), FOUND, t(0), t(4), 100)).toMatchObject({ soldUnits: 20, atLeast: true });
    expect(estimateSales(counts([0, 90], [2, 80]), FOUND, t(0), t(4), 100)).toMatchObject({ soldUnits: 10, atLeast: false });
    // A cap that is not reached by the count a decrease starts from changes nothing: 100 → 100 is no decrease.
    expect(estimateSales(counts([0, 100], [2, 100]), FOUND, t(0), t(4), 100)).toMatchObject({ soldUnits: 0, atLeast: false });
    // No cap declared: the same counts are exact.
    expect(estimateSales(counts([0, 100], [2, 80]), FOUND, t(0), t(4))).toMatchObject({ soldUnits: 20, atLeast: false });
  });

  it('has nothing to estimate from without any count at or before the end', () => {
    expect(estimateSales([], FOUND, t(0), t(9))).toBeNull();
    expect(estimateSales(counts([0, null], [3, null]), FOUND, t(0), t(9))).toBeNull();
    expect(estimateSales(counts([5, 10]), FOUND, t(0), t(4))).toBeNull();
  });

  it('starts where the first count does when that is later than the window, and says when that matters', () => {
    const late = estimateSales(counts([10, 40], [14, 30]), FOUND, t(0), t(20))!;
    expect(late).toMatchObject({ since: t(10), soldUnits: 10 });
    expect(startsLate(late, t(0))).toBe(true);
    // Under a day later is the same observation round, not a gap worth a note.
    expect(startsLate({ ...late, since: t(0) + D - 1 }, t(0))).toBe(false);
    expect(startsLate({ ...late, since: t(0) + D }, t(0))).toBe(true);
    expect(estimateSales(AKIZUKI_107385, FOUND, t(30), t(64))?.since).toBe(t(30));
  });
});

describe('estimated sales properties', () => {
  const opts = { seed: 20261109, numRuns: Number(process.env['FC_RUNS'] ?? 200) } as const;
  const series = fc.array(fc.integer({ min: 0, max: 300 }), { minLength: 1, maxLength: 40 });
  const asPoints = (values: readonly number[]): InventoryPointV1[] => values.map((q, i) => [t(i), q]);

  it('sold minus added is the net fall of the count over a window that holds every pair', () => {
    fc.assert(fc.property(series, (values) => {
      const e = estimateSales(asPoints(values), FOUND, t(0), t(values.length))!;
      expect(e.soldUnits - e.addedUnits).toBe(values[0]! - values[values.length - 1]!);
      expect(e.soldUnits).toBeGreaterThanOrEqual(0);
      expect(e.addedUnits).toBeGreaterThanOrEqual(0);
      expect(e.decreases + e.increases).toBeLessThanOrEqual(values.length - 1);
    }), opts);
  });

  it('a longer window never estimates fewer sales than a shorter one that ends at the same time', () => {
    fc.assert(fc.property(series, fc.nat(60), fc.nat(60), (values, a, b) => {
      const [early, late] = a <= b ? [a, b] : [b, a];
      const long = estimateSales(asPoints(values), FOUND, t(early), t(60))!;
      const short = estimateSales(asPoints(values), FOUND, t(late), t(60))!;
      expect(long.soldUnits).toBeGreaterThanOrEqual(short.soldUnits);
      expect(long.addedUnits).toBeGreaterThanOrEqual(short.addedUnits);
    }), opts);
  });

  it('two windows that meet add up to the window they make', () => {
    fc.assert(fc.property(series, fc.integer({ min: 1, max: 40 }), (values, cut) => {
      const points = asPoints(values);
      const whole = estimateSales(points, FOUND, t(0), t(60))!;
      const left = estimateSales(points, FOUND, t(0), t(cut) - 1)!;
      const right = estimateSales(points, FOUND, t(cut), t(60))!;
      expect(left.soldUnits + right.soldUnits).toBe(whole.soldUnits);
      expect(left.addedUnits + right.addedUnits).toBe(whole.addedUnits);
    }), opts);
  });
});
