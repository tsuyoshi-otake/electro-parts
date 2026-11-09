/**
 * The period the charts show. One choice sets one window for the price chart,
 * the stock chart and the estimated sales count, so they always describe the
 * same stretch of time (ADR-0031).
 *
 * A period is a number of trailing days ending at the latest observation, the
 * same way the statistics windows (`d30`, `d90`, `d365`) are counted. A month
 * is therefore 30 days, not a calendar month. A period longer than the record
 * simply shows all of it: the window never starts before the first observation.
 */

export const DAY_MS = 86_400_000;

export interface ChartPeriod {
  readonly id: string;
  /** The button text. */
  readonly label: string;
  /** Trailing days, or `null` for the whole record. */
  readonly days: number | null;
}

export const CHART_PERIODS = [
  { id: '1m', label: '1ヶ月', days: 30 },
  { id: '3m', label: '3ヶ月', days: 90 },
  { id: '6m', label: '半年', days: 180 },
  { id: '1y', label: '1年', days: 365 },
  { id: '2y', label: '2年', days: 730 },
  { id: '3y', label: '3年', days: 1095 },
  { id: 'all', label: '全期間', days: null },
] as const satisfies readonly ChartPeriod[];

export type ChartPeriodId = (typeof CHART_PERIODS)[number]['id'];

/** The whole record, so nothing changes until a button is pressed. */
export const DEFAULT_CHART_PERIOD: ChartPeriodId = 'all';

/** What a button says it covers, for its tooltip. */
export function chartPeriodTitle(period: ChartPeriod): string {
  return period.days === null ? '観測した全期間' : `直近${period.days}日`;
}

/**
 * The first instant of the window that ends at `end`: the period's start, but
 * never earlier than `earliest`, the first observation any chart shows.
 */
export function chartWindowStart(id: ChartPeriodId, end: number, earliest: number): number {
  const days = CHART_PERIODS.find((period) => period.id === id)?.days ?? null;
  return days === null ? earliest : Math.max(earliest, end - days * DAY_MS);
}
