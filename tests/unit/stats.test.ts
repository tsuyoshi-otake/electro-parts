import { describe, expect, it } from 'vitest';
import { exactPrice, UNAVAILABLE_PRICE } from '../../src/core/price.ts';
import { computeSegmentStats, windowStats } from '../../src/core/stats.ts';

const P = (t: number, amount: number | null) => ({ t, state: amount === null ? UNAVAILABLE_PRICE : exactPrice(amount) });
const B = (t: number, state: boolean) => ({ t, state });

describe('windowStats', () => {
  it('returns null when nothing priced was listed inside the window', () => {
    expect(windowStats([], [], 0, 10)).toBeNull();
    expect(windowStats([P(5, 100)], [B(5, true)], 0, 4)).toBeNull();
    expect(windowStats([P(5, null)], [B(5, true)], 0, 10)).toBeNull();
    expect(windowStats([P(1, 100)], [B(1, true)], 10, 5)).toBeNull();
  });

  it('folds the price in effect at the window start and every change inside it', () => {
    const prices = [P(1, 100), P(5, 80), P(9, 120)];
    const presence = [B(1, true)];
    expect(windowStats(prices, presence, 6, 12)).toEqual({ minMinor: 80, maxMinor: 120 });
    expect(windowStats(prices, presence, 0, 4)).toEqual({ minMinor: 100, maxMinor: 100 });
    // A boundary exactly on a change point sees that point.
    expect(windowStats(prices, presence, 9, 9)).toEqual({ minMinor: 120, maxMinor: 120 });
    expect(windowStats(prices, presence, 5, 5)).toEqual({ minMinor: 80, maxMinor: 80 });
  });

  it('suspends a price while the segment is not listed', () => {
    const prices = [P(1, 100), P(8, 300)];
    const presence = [B(1, true), B(3, false), B(8, true)];
    // Only the delisted span (3..7) falls into the window: nothing was listed.
    expect(windowStats(prices, presence, 3, 7)).toBeNull();
    // Window covers the relisting: the old price never counts during the gap.
    expect(windowStats(prices, presence, 4, 9)).toEqual({ minMinor: 300, maxMinor: 300 });
    expect(windowStats(prices, presence, 0, 9)).toEqual({ minMinor: 100, maxMinor: 300 });
  });

  it('ignores unavailable points but keeps neighbours', () => {
    const prices = [P(1, 100), P(4, null), P(7, 50)];
    const presence = [B(1, true)];
    expect(windowStats(prices, presence, 4, 6)).toBeNull();
    expect(windowStats(prices, presence, 2, 8)).toEqual({ minMinor: 50, maxMinor: 100 });
  });
});

describe('computeSegmentStats', () => {
  it('reports previous distinct price and change', () => {
    const s = computeSegmentStats([P(1, 1150), P(2, 1200)])!;
    expect(s.previousDistinct).toEqual(exactPrice(1150));
    expect(s.change).toEqual({ differenceMinor: 50, percent: 4.35, direction: 'up' });
    expect(s.observedMinMinor).toBe(1150);
    expect(s.observedMaxMinor).toBe(1200);
    expect(s.changePointCount).toBe(2);
  });

  it('is null for an empty segment and unknown for a single point', () => {
    expect(computeSegmentStats([])).toBeNull();
    expect(computeSegmentStats([P(1, 5)])!.change.direction).toBe('unknown');
  });
});
