import { describe, expect, it } from 'vitest';
import type { PresencePointV1, PricePointV1 } from '../../src/publisher/contract.ts';
import { buildStepChart, pricedIntervals } from '../../userscript/ui/chart.ts';
import { formatMoney, formatPercent, formatPriceValue, formatSignedMoney } from '../../userscript/core/format.ts';

const D = 86_400_000;
const t = (day: number) => 1_800_000_000_000 + day * D;

describe('step chart intervals', () => {
  it('extends each price to the next change point and to the window end', () => {
    const points: PricePointV1[] = [
      [t(0), 'exact', 100, 100],
      [t(5), 'exact', 120, 120],
    ];
    const presence: PresencePointV1[] = [[t(0), 1]];
    expect(pricedIntervals(points, presence, t(9))).toEqual([
      { from: t(0), to: t(5), min: 100, max: 100 },
      { from: t(5), to: t(9), min: 120, max: 120 },
    ]);
  });

  it('breaks the line while the product is unlisted and skips unavailable prices', () => {
    const points: PricePointV1[] = [
      [t(0), 'exact', 100, 100],
      [t(4), 'unavailable', null, null],
      [t(6), 'range', 90, 110],
    ];
    const presence: PresencePointV1[] = [
      [t(0), 1],
      [t(2), 0],
      [t(3), 1],
    ];
    expect(pricedIntervals(points, presence, t(8))).toEqual([
      { from: t(0), to: t(2), min: 100, max: 100 },
      { from: t(3), to: t(4), min: 100, max: 100 },
      { from: t(6), to: t(8), min: 90, max: 110 },
    ]);
  });

  it('renders an accessible SVG with a band for range prices and a gap marker', () => {
    const points: PricePointV1[] = [
      [t(0), 'exact', 100, 100],
      [t(6), 'range', 90, 110],
    ];
    const presence: PresencePointV1[] = [
      [t(0), 1],
      [t(2), 0],
      [t(3), 1],
    ];
    const svg = buildStepChart(document, points, presence, { width: 640, height: 200, start: t(0), end: t(8), currency: 'JPY' });
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain('最低 ￥90');
    expect(svg.getAttribute('aria-label')).toContain('最高 ￥110');
    expect(svg.querySelector('path.eph-band')).not.toBeNull();
    expect(svg.querySelector('line.eph-gap')).not.toBeNull();
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
    const line = svg.querySelector('path.eph-line')!.getAttribute('d')!;
    expect(line.split('M')).toHaveLength(3); // two separate runs → two moveTo commands
    expect(svg.querySelector('title')?.textContent).toContain('変更点 2 件');
  });

  it('prints one date per x label, and drops the ones that would collide', () => {
    const axis = (start: number, end: number) =>
      [...buildStepChart(document, [[start, 'exact', 100, 100]], [[start, 1]], { width: 640, height: 200, start, end, currency: 'JPY' })
        .querySelectorAll('text.eph-axis')]
        .map((n) => n.textContent)
        .filter((v) => v !== null && /^\d{4}-/.test(v));
    // A wide window has room for first / middle / last.
    expect(axis(t(0), t(90))).toHaveLength(3);
    // Two days: the midpoint reads as the same date as the start, so it goes.
    expect(axis(t(0), t(1))).toEqual(['2027-01-15', '2027-01-16']);
    // A single observation has one date to state, not three.
    expect(axis(t(0), t(0))).toEqual(['2027-01-15']);
  });

  it('renders an explicit empty state when nothing priced was listed', () => {
    const svg = buildStepChart(document, [[t(0), 'unavailable', null, null]], [[t(0), 1]], { width: 640, height: 200, start: t(0), end: t(8), currency: 'JPY' });
    expect(svg.textContent).toContain('価格の記録なし');
    expect(svg.querySelector('path')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats money in minor units per currency, with signs and percentages', () => {
    expect(formatMoney(1200, 'JPY')).toBe('￥1,200');
    expect(formatMoney(1234, 'USD')).toBe('$12.34');
    expect(formatSignedMoney(-50, 'JPY')).toBe('−￥50');
    expect(formatSignedMoney(0, 'JPY')).toBe('±￥0');
    expect(formatPercent(4.35)).toBe('+4.4%');
    expect(formatPercent(-10)).toBe('−10.0%');
    expect(formatPriceValue({ state: 'range', minAmountMinor: 90, maxAmountMinor: 110 }, 'JPY')).toBe('￥90〜￥110');
    expect(formatPriceValue({ state: 'unavailable', minAmountMinor: null, maxAmountMinor: null }, 'JPY')).toBe('価格表示なし');
  });
});
