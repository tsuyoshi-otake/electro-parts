import { CHART_PERIODS, chartPeriodTitle, type ChartPeriodId } from '../core/chartPeriod.ts';
import { formatDate } from '../core/format.ts';
import { startsLate, type SalesEstimate } from '../core/stockSales.ts';

/**
 * The period buttons and the estimated sales count for the chosen period
 * (ADR-0031). Both read the one window the panel computes; neither knows how
 * the charts are drawn. Text goes through `textContent` only.
 */

/** The buttons borrow the theme buttons' look (panel.ts); only their layout is here. */
export const PERIOD_CSS = `
.eph .period-controls { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; }
.eph .sales-summary { margin-top: 8px; }
.eph .sales-summary .rows { margin-top: 4px; }
`;

function node(doc: Document, tag: string, content: string, className?: string): HTMLElement {
  const el = doc.createElement(tag);
  el.textContent = content;
  if (className !== undefined) el.className = className;
  return el;
}

/** One toggle per period. Pressing a button marks it and reports the choice; redrawing is the caller's. */
export function buildPeriodControls(doc: Document, selected: ChartPeriodId, onSelect: (id: ChartPeriodId) => void): HTMLElement {
  const group = doc.createElement('div');
  group.className = 'period-controls';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', '表示期間');
  const buttons: HTMLButtonElement[] = [];
  for (const period of CHART_PERIODS) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = period.label;
    button.title = chartPeriodTitle(period);
    button.dataset['period'] = period.id;
    button.dataset['focusKey'] = `period-${period.id}`;
    button.setAttribute('aria-pressed', String(period.id === selected));
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      onSelect(period.id);
    });
    buttons.push(button);
    group.appendChild(button);
  }
  return group;
}

export interface SalesRow {
  /** The chart series id, so the store switches hide a store's row with its lines. */
  id: string;
  label: string;
  /** `null` = the store has no recorded count to estimate from. */
  estimate: SalesEstimate | null;
}

const units = (n: number): string => `${n.toLocaleString('ja-JP')}個`;

function soldText(estimate: SalesEstimate): string {
  if (estimate.soldUnits === 0) return units(0);
  return estimate.atLeast ? `${units(estimate.soldUnits)}以上` : `約${units(estimate.soldUnits)}`;
}

function detailText(estimate: SalesEstimate, from: number): string {
  const parts = [estimate.decreases === 0 ? '在庫数の減少は記録されていません' : `在庫数の減少 ${estimate.decreases} 回`];
  if (estimate.increases > 0) parts.push(`増加 ${estimate.increases} 回（+${units(estimate.addedUnits)}）`);
  if (startsLate(estimate, from)) parts.push(`記録は ${formatDate(estimate.since)} から`);
  return parts.join(' · ');
}

/**
 * The estimate per store with a recorded count, under the stock chart. Absent
 * when no store has one. The note says what the figure is, once, not per store.
 */
export function buildSalesSummary(doc: Document, rows: readonly SalesRow[], range: { from: number; to: number }): HTMLElement | null {
  const shown = rows.flatMap((row) => (row.estimate === null ? [] : [{ row, estimate: row.estimate }]));
  if (shown.length === 0) return null;
  const box = doc.createElement('div');
  box.className = 'sales-summary';
  box.appendChild(node(doc, 'div', `推定販売数（${formatDate(range.from)}〜${formatDate(range.to)}の在庫数の減少分の合計）`, 'related-meta'));
  const list = doc.createElement('dl');
  list.className = 'rows';
  for (const { row, estimate } of shown) {
    const item = doc.createElement('div');
    item.dataset['series'] = row.id;
    item.appendChild(node(doc, 'dt', row.label));
    const value = node(doc, 'dd', soldText(estimate));
    value.appendChild(node(doc, 'span', detailText(estimate, range.from), 'sub'));
    item.appendChild(value);
    list.appendChild(item);
  }
  box.appendChild(list);
  box.appendChild(node(doc, 'div', '店舗のページが示す在庫数の変化から推した目安です。観測の間に入荷と販売が重なった分は含まれず、返品や在庫数の修正も区別できません。', 'related-meta'));
  return box;
}
