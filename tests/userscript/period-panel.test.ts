import { describe, expect, it } from 'vitest';
import type { ProductFileV1 } from '../../src/publisher/contract.ts';
import { formatDate } from '../../userscript/core/format.ts';
import { renderPanel, type PanelContext } from '../../userscript/ui/panel.ts';
import { comparisonFixture } from './comparison-fixtures.ts';
import { sampleProduct, T0, T1 } from './helpers.ts';

const D = 86_400_000;
const at = (day: number) => T0 + day * D;
const LABELS = ['1ヶ月', '3ヶ月', '半年', '1年', '2年', '3年', '全期間'];

/**
 * 400 days of history. Price changes on days 0, 100 and 380; stock counts on
 * days 0 (100), 50 (90), 120 (70), 200 (150), 340 (140) and 390 (120), so the
 * decreases are 10, 20, 10 and 20 and the one increase is 80.
 */
function longProduct(): ProductFileV1 {
  const p = sampleProduct();
  p.observation = { runCount: 400, firstObservedAt: at(0), latestObservedAt: at(400) };
  p.product.firstSeenAt = at(0);
  p.product.lastSeenAt = at(400);
  const offer = p.offers[0]!;
  const segment = offer.segments[0]!;
  segment.points = [[at(0), 'exact', 1000, 1000], [at(100), 'exact', 1100, 1100], [at(380), 'exact', 1200, 1200]];
  segment.stats.current = { state: 'exact', minAmountMinor: 1200, maxAmountMinor: 1200 };
  segment.stats.currentSinceAt = at(380);
  segment.stats.changePointCount = 3;
  offer.availability = [[at(0), 'in_stock', true, 'site_reported', '在庫あり']];
  offer.inventory = { semantics: 'site_reported', points: [[at(0), 100], [at(50), 90], [at(120), 70], [at(200), 150], [at(340), 140], [at(390), 120]], truncated: false, totalPoints: 6 };
  return p;
}

function setup(product: ProductFileV1 = longProduct(), extra: Partial<PanelContext> = {}) {
  document.body.replaceChildren();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const ctx: PanelContext = { doc: document, dataBaseUrl: 'https://data.example.test', lazyChart: false, theme: 'light', onThemeChange: () => undefined, ...extra };
  const draw = () => renderPanel(ctx, shadow, { kind: 'ready', product, manifest: null, freshness: 'fresh', storedAt: 1, note: null }, null, () => undefined);
  const buttons = () => [...shadow.querySelectorAll<HTMLButtonElement>('.period-controls button')];
  return {
    product, shadow, ctx, draw, buttons,
    press: (label: string) => buttons().find((b) => b.textContent === label)!.click(),
    pressed: () => buttons().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent),
    summary: () => shadow.querySelector('.sales-summary')?.textContent ?? '',
    priceChart: () => shadow.querySelector('svg.eph-chart')!,
    stockDots: () => shadow.querySelectorAll('.eph-inventory-chart circle').length,
    priceDots: () => shadow.querySelectorAll('svg.eph-chart circle').length,
  };
}

describe('period buttons', () => {
  it('offer the seven periods, each saying what it covers, with the whole record pressed', () => {
    const f = setup(); f.draw();
    expect(f.buttons().map((b) => b.textContent)).toEqual(LABELS);
    expect(f.buttons().map((b) => b.title)).toEqual(['直近30日', '直近90日', '直近180日', '直近365日', '直近730日', '直近1095日', '観測した全期間']);
    expect(f.pressed()).toEqual(['全期間']);
    expect(f.shadow.querySelector('.period-controls')?.getAttribute('aria-label')).toBe('表示期間');
    // The row sits at the top of the chart box, above the price chart.
    expect(f.shadow.querySelector('.chart-box')!.firstElementChild!.className).toBe('period-controls');
  });

  it('draw both charts for the whole record before any press', () => {
    const f = setup(); f.draw();
    expect(f.priceChart().getAttribute('aria-label')).toContain(`${formatDate(at(0))}〜${formatDate(at(400))}`);
    expect(f.priceDots()).toBe(3);
    expect(f.stockDots()).toBe(6);
  });

  it.each([
    ['1ヶ月', 370, '約20個', '在庫数の減少 1 回', false],
    ['3ヶ月', 310, '約30個', '在庫数の減少 2 回', false],
    ['半年', 220, '約30個', '在庫数の減少 2 回', false],
    ['1年', 35, '約60個', '在庫数の減少 4 回', true],
    ['2年', 0, '約60個', '在庫数の減少 4 回', true],
    ['3年', 0, '約60個', '在庫数の減少 4 回', true],
    ['全期間', 0, '約60個', '在庫数の減少 4 回', true],
  ] as const)('%s: from day %i the estimate is %s (%s)', (label, fromDay, sold, decreases, hasIncrease) => {
    const f = setup(); f.draw();
    f.press(label);
    expect(f.pressed()).toEqual([label]);
    const text = f.summary();
    expect(text).toContain(`推定販売数（${formatDate(at(fromDay))}〜${formatDate(at(400))}の在庫数の減少分の合計）`);
    expect(text).toContain(sold);
    expect(text).toContain(decreases);
    expect(text.includes('増加 1 回（+80個）')).toBe(hasIncrease);
    // The price chart covers the same window as the heading says.
    expect(f.priceChart().getAttribute('aria-label')).toContain(`${formatDate(at(fromDay))}〜${formatDate(at(400))}`);
  });

  it('redraw the price and stock charts for the window, with only the points inside it', () => {
    const f = setup(); f.draw();
    f.press('1ヶ月');
    expect(f.priceDots()).toBe(1); // day 380
    expect(f.stockDots()).toBe(1); // day 390
    f.press('半年');
    expect(f.priceDots()).toBe(1);
    expect(f.stockDots()).toBe(2); // days 340 and 390
    f.press('全期間');
    expect(f.priceDots()).toBe(3);
    expect(f.stockDots()).toBe(6);
  });

  it('show the record when the period is longer than it, not an empty stretch before it', () => {
    const f = setup(sampleProduct()); f.draw(); // 35 days of record
    f.press('3年');
    expect(f.priceChart().getAttribute('aria-label')).toContain(`${formatDate(T0)}〜${formatDate(T1)}`);
    expect(f.summary()).toContain(`推定販売数（${formatDate(T0)}〜${formatDate(T1)}`);
    expect(f.priceDots()).toBe(2);
  });

  it('keep the choice, and keyboard focus on it, when the panel is rendered again', () => {
    const f = setup(); f.draw();
    f.press('3ヶ月');
    expect(f.ctx.chartPeriod).toBe('3m');
    f.buttons().find((b) => b.textContent === '1年')!.focus();
    f.draw();
    expect(f.pressed()).toEqual(['3ヶ月']);
    expect(f.summary()).toContain('約30個');
    expect((f.shadow.activeElement as HTMLElement | null)?.dataset['focusKey']).toBe('period-1y');
  });

  it('change only the charts and the estimate: the box, the buttons and the focus stay', () => {
    const f = setup(); f.draw();
    const box = f.shadow.querySelector('.chart-box');
    const group = f.shadow.querySelector('.period-controls');
    const button = f.buttons().find((b) => b.textContent === '1ヶ月')!;
    button.focus();
    const before = f.priceChart();
    button.click();
    expect(f.shadow.querySelector('.chart-box')).toBe(box);
    expect(f.shadow.querySelector('.period-controls')).toBe(group);
    expect(f.shadow.activeElement).toBe(button);
    expect(f.priceChart()).not.toBe(before);
    expect(f.shadow.querySelectorAll('svg.eph-chart')).toHaveLength(1);
    expect(f.shadow.querySelectorAll('.eph-inventory-chart')).toHaveLength(1);
    expect(f.shadow.querySelectorAll('.sales-summary')).toHaveLength(1);
  });
});

describe('estimated sales under the stock chart', () => {
  it('names what the figure is once, as a guide, and what it cannot tell', () => {
    const f = setup(); f.draw();
    const text = f.summary();
    expect(text.match(/目安です/g)).toHaveLength(1);
    expect(text).toContain('入荷と販売が重なった分は含まれず');
    expect(text).toContain('返品や在庫数の修正も区別できません');
    // It sits inside the stock section, after the chart, so the heading stays the first line there.
    const stockBox = f.shadow.querySelector('.stock-chart')!;
    expect(stockBox.firstElementChild?.textContent).toContain('在庫数の推移');
    expect(stockBox.lastElementChild?.className).toBe('sales-summary');
  });

  it('shows the whole record first: sold, how many decreases, and the added stock apart', () => {
    const f = setup(); f.draw();
    expect(f.summary()).toContain('約60個');
    expect(f.summary()).toContain('在庫数の減少 4 回 · 増加 1 回（+80個）');
  });

  it('reads "at least" when a decrease starts from a count the store shows capped', () => {
    const p = longProduct();
    p.offers[0]!.inventory = { ...p.offers[0]!.inventory, points: [[at(0), 100], [at(50), 80]], cappedAt: 100 };
    const f = setup(p); f.draw();
    expect(f.summary()).toContain('20個以上');
    expect(f.summary()).not.toContain('約20個');
  });

  it('says a count that never fell was not seen falling', () => {
    const p = longProduct();
    p.offers[0]!.inventory = { ...p.offers[0]!.inventory, points: [[at(0), 150]] };
    const f = setup(p); f.draw();
    expect(f.summary()).toContain('0個');
    expect(f.summary()).toContain('在庫数の減少は記録されていません');
  });

  it('counts a sell-out: no count shown while the offer is out of stock is zero', () => {
    const p = longProduct();
    const offer = p.offers[0]!;
    offer.inventory = { ...offer.inventory, points: [[at(0), 40], [at(300), null]] };
    offer.availability = [[at(0), 'in_stock', true, 'site_reported', '在庫あり'], [at(300), 'out_of_stock', false, 'site_reported', '在庫なし']];
    const f = setup(p); f.draw();
    expect(f.summary()).toContain('約40個');
  });

  it('tells where the counts begin when that is later than the period does', () => {
    const p = longProduct();
    p.offers[0]!.inventory = { ...p.offers[0]!.inventory, points: [[at(300), 50], [at(390), 40]] };
    const f = setup(p); f.draw();
    f.press('1年');
    expect(f.summary()).toContain(`記録は ${formatDate(at(300))} から`);
    f.press('1ヶ月');
    expect(f.summary()).not.toContain('記録は');
  });

  it('says so in the chart when the period holds no count', () => {
    const p = longProduct();
    p.offers[0]!.inventory = { ...p.offers[0]!.inventory, points: [[at(0), 20], [at(100), null]] };
    p.offers[0]!.availability = [[at(0), 'in_stock', true, 'site_reported', '在庫あり']];
    const f = setup(p); f.draw();
    f.press('1ヶ月');
    expect(f.shadow.querySelector('.eph-inventory-chart')?.textContent).toBe('この期間に在庫数の記録なし');
  });

  it('is left out, with the stock chart, when the setting is off; the buttons stay', () => {
    const f = setup(longProduct(), { preferences: { cardFee: { enabled: false, cardId: 'smbc-visa-mastercard', customPercent: null }, showStock: false } }); f.draw();
    expect(f.shadow.querySelector('.stock-chart')).toBeNull();
    expect(f.shadow.querySelector('.sales-summary')).toBeNull();
    expect(f.buttons()).toHaveLength(7);
    f.press('1ヶ月');
    expect(f.shadow.querySelector('.sales-summary')).toBeNull();
    expect(f.priceDots()).toBe(1);
  });

  it('is left out for a store that shows no count', () => {
    const p = longProduct();
    p.offers[0]!.inventory = { semantics: 'not_exposed', points: [], truncated: false, totalPoints: 0 };
    const f = setup(p); f.draw();
    expect(f.shadow.querySelector('.stock-chart')).toBeNull();
    expect(f.shadow.querySelector('.sales-summary')).toBeNull();
    f.press('1年');
    expect(f.shadow.querySelector('.sales-summary')).toBeNull();
    expect(f.priceDots()).toBe(2); // days 100 and 380
  });
});

describe('period and estimate across stores', () => {
  function compared() {
    const c = comparisonFixture();
    const base = setup(c.current, { related: [c.entry], storeLabel: (id: string) => (id === 'teststore' ? 'Store A' : 'Store B') });
    return { ...c, ...base };
  }

  it('gives each store with a count its own row, and one note for all', () => {
    const f = compared(); f.draw();
    const rows = [...f.shadow.querySelectorAll<HTMLElement>('.sales-summary [data-series]')];
    expect(rows.map((r) => r.dataset['series'])).toEqual(['current', 'example-pair']);
    expect(rows.map((r) => r.querySelector('dt')!.textContent)).toEqual(['Store A（閲覧中）', 'Store B']);
    // The fixture's counts only rise (20 → 781): nothing sold is seen, and the 761 added is said apart.
    expect(rows[0]!.textContent).toContain('0個');
    expect(rows[0]!.textContent).toContain('在庫数の減少は記録されていません · 増加 1 回（+761個）');
    expect(f.summary().match(/目安です/g)).toHaveLength(1);
  });

  it('leaves out the row of a store that shows no count', () => {
    const f = compared();
    f.other.offers[0]!.inventory = { semantics: 'not_exposed', points: [], truncated: false, totalPoints: 0 };
    f.draw();
    expect([...f.shadow.querySelectorAll<HTMLElement>('.sales-summary [data-series]')].map((r) => r.dataset['series'])).toEqual(['current']);
  });

  it('hides a store row with its lines, and keeps it hidden through a change of period', () => {
    const f = compared(); f.draw();
    const toggle = f.shadow.querySelector<HTMLInputElement>('input[data-focus-key="series-example-pair"]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    const row = (id: string) => f.shadow.querySelector<HTMLElement>(`.sales-summary [data-series="${id}"]`)!;
    expect(row('example-pair').style.display).toBe('none');
    expect(row('current').style.display).toBe('');
    f.press('3ヶ月');
    expect(row('example-pair').style.display).toBe('none');
    expect(row('current').style.display).toBe('');
    expect(f.shadow.querySelector<SVGGElement>('.eph-inventory-chart g[data-series="example-pair"]')!.style.display).toBe('none');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(row('example-pair').style.display).toBe('');
  });

  it('puts the period buttons above the store switches and redraws the comparison for the window', () => {
    const f = compared(); f.draw();
    const box = f.shadow.querySelector('.chart-box')!;
    expect([...box.children].slice(0, 2).map((n) => n.className)).toEqual(['period-controls', 'series-controls']);
    f.press('1ヶ月');
    expect(f.shadow.querySelectorAll('.eph-comparison-chart g[data-series]')).toHaveLength(2);
    expect(f.shadow.querySelectorAll('.eph-inventory-chart g[data-series]')).toHaveLength(2);
    expect(f.pressed()).toEqual(['1ヶ月']);
  });
});
