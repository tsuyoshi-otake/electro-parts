import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHART_PERIODS, chartPeriodTitle, chartWindowStart, DAY_MS, DEFAULT_CHART_PERIOD, type ChartPeriodId } from '../../userscript/core/chartPeriod.ts';

const END = 1_800_000_000_000;

describe('chart periods', () => {
  it('offers the seven periods in order, counted in trailing days, and starts on the whole record', () => {
    expect(CHART_PERIODS.map((p) => [p.label, p.days])).toEqual([
      ['1ヶ月', 30], ['3ヶ月', 90], ['半年', 180], ['1年', 365], ['2年', 730], ['3年', 1095], ['全期間', null],
    ]);
    expect(new Set(CHART_PERIODS.map((p) => p.id)).size).toBe(CHART_PERIODS.length);
    expect(DEFAULT_CHART_PERIOD).toBe('all');
  });

  it('says in the tooltip exactly what a button covers', () => {
    expect(CHART_PERIODS.map(chartPeriodTitle)).toEqual(['直近30日', '直近90日', '直近180日', '直近365日', '直近730日', '直近1095日', '観測した全期間']);
  });

  it('starts N days before the end, and never before the first observation', () => {
    const earliest = END - 400 * DAY_MS;
    expect(chartWindowStart('1m', END, earliest)).toBe(END - 30 * DAY_MS);
    expect(chartWindowStart('1y', END, earliest)).toBe(END - 365 * DAY_MS);
    // A record of 400 days is shorter than two years: the window is the record, not an empty stretch before it.
    expect(chartWindowStart('2y', END, earliest)).toBe(earliest);
    expect(chartWindowStart('3y', END, earliest)).toBe(earliest);
    expect(chartWindowStart('all', END, earliest)).toBe(earliest);
  });

  it('keeps every window inside the record and makes a longer period start no later', () => {
    const ids = CHART_PERIODS.map((p) => p.id);
    fc.assert(fc.property(fc.integer({ min: 0, max: 2000 }), (recordDays) => {
      const earliest = END - recordDays * DAY_MS;
      const starts = ids.map((id: ChartPeriodId) => chartWindowStart(id, END, earliest));
      for (const start of starts) {
        expect(start).toBeGreaterThanOrEqual(earliest);
        expect(start).toBeLessThanOrEqual(END);
      }
      for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeLessThanOrEqual(starts[i - 1]!);
    }), { seed: 20261109, numRuns: Number(process.env['FC_RUNS'] ?? 200) });
  });
});
