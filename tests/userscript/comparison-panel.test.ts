import { describe, expect, it } from 'vitest';
import { renderPanel, type PanelContext } from '../../userscript/ui/panel.ts';
import { buildComparisonChart } from '../../userscript/ui/chart.ts';
import { comparisonFixture } from './comparison-fixtures.ts';
import { renderRelatedGroups } from '../../userscript/ui/related.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { relatedEntries } from '../../userscript/core/relations.ts';

function setup() {
  document.body.replaceChildren(); const host = document.createElement('div'); document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const f = comparisonFixture();
  const ctx: PanelContext = { doc: document, dataBaseUrl: 'https://data.example.test', lazyChart: false, theme: 'light', onThemeChange: () => undefined,
    related: [f.entry], storeLabel: (id) => id === 'teststore' ? 'Store A' : 'Store B' };
  const draw = () => renderPanel(ctx, shadow, { kind: 'ready', product: f.current, manifest: null, freshness: 'fresh', storedAt: 1, note: null }, null, () => undefined);
  return { ...f, shadow, ctx, draw, text: () => shadow.querySelector('section')!.textContent! };
}

describe('cross-store comparison panel', () => {
  it('renders the present offer instead of an earlier retired offer', () => {
    const f = setup();
    const active = f.current.offers[0]!;
    const retired = structuredClone(active);
    retired.externalOfferId = '000-retired';
    retired.presence = [[f.current.product.firstSeenAt, 1], [f.current.product.lastSeenAt, 0]];
    retired.segments[0]!.stats.current = { state: 'exact', minAmountMinor: 100, maxAmountMinor: 100 };
    retired.segments[0]!.points = [[f.current.product.firstSeenAt, 'exact', 100, 100]];
    f.current.offers = [retired, active];
    f.draw();
    expect(f.text()).toContain('￥1,200');
    expect(f.text()).not.toContain('￥100');
  });

  it('shows reviewed family differences in the current-to-other direction on both stores', () => {
    const relation = PRODUCT_RELATIONS.find(r => r.id === 'a116132-s8171')!;
    const parent = document.createElement('div');
    renderRelatedGroups(document, parent, relatedEntries([relation], 'akizuki', '116132'), id => id);
    expect(parent.querySelector('.related-name')?.textContent).toBe('無線: なし → Wi-Fi/Bluetooth');
    const sourceLink = parent.querySelector<HTMLAnchorElement>('.related-evidence a')!;
    expect(sourceLink.href).toBe('https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html');
    expect(sourceLink.rel).toBe('noopener noreferrer');
    parent.replaceChildren();
    renderRelatedGroups(document, parent, relatedEntries([relation], 'switch-science', '8171'), id => id);
    expect(parent.querySelector('.related-name')?.textContent).toBe('無線: Wi-Fi/Bluetooth → なし');
  });
  it('shows independent store timestamps, labelled statistics, safe links, two series and a signed recorded-price difference', () => {
    const f = setup(); f.draw();
    expect(f.text()).toContain('店舗別の記録価格'); expect(f.text()).toContain('Store A（閲覧中）'); expect(f.text()).toContain('Store Aの価格履歴・統計');
    expect(f.text()).toContain('記録価格差（他店 − 閲覧中） +￥300'); expect(f.text()).toContain('現在の最安価格を示すものではありません');
    expect(f.shadow.querySelectorAll('g[data-series]')).toHaveLength(2);
    const link = f.shadow.querySelector<HTMLAnchorElement>('.store-price a')!;
    expect(link.href).toBe(f.entry.target.url); expect(link.rel).toContain('noopener');
  });

  it('preserves disclosure state, legend selection and focus when another data result arrives', () => {
    const f = setup(); f.draw();
    const details = f.shadow.querySelector<HTMLDetailsElement>('.related-evidence')!; details.open = true;
    const inputs = f.shadow.querySelectorAll<HTMLInputElement>('.series-controls input'); inputs[1]!.click(); inputs[1]!.focus();
    f.draw();
    expect(f.shadow.querySelector<HTMLDetailsElement>('.related-evidence')!.open).toBe(true);
    expect(f.shadow.querySelectorAll<HTMLInputElement>('.series-controls input')[1]!.checked).toBe(false);
    expect(f.shadow.activeElement?.getAttribute('data-focus-key')).toBe('series-example-pair');
    expect(f.shadow.querySelectorAll<SVGGElement>('g[data-series]')[1]!.style.display).toBe('none');
    f.shadow.querySelector<HTMLInputElement>('.series-controls input')!.click();
    expect(f.shadow.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
  });

  it('keeps detailed own-store statistics available in a disclosure without stretching the initial comparison', () => {
    const f = setup(); f.draw();
    const details = f.shadow.querySelector<HTMLDetailsElement>('details[data-state-key="own-statistics"]')!;
    expect(details.open).toBe(false); expect(details.querySelector('dl')?.textContent).toContain('直近30日');
    details.open = true; details.querySelector('summary')!.focus(); f.draw();
    expect(f.shadow.querySelector<HTMLDetailsElement>('details[data-state-key="own-statistics"]')!.open).toBe(true);
    expect(f.shadow.activeElement?.getAttribute('data-focus-key')).toBe('own-statistics');
  });

  it('connects the final price change vertically without extrapolating beyond the final observation', () => {
    const t = Date.parse('2026-09-01'), day = 86_400_000;
    const svg = buildComparisonChart(document, [{id: 'a', label: 'A', start: t, end: t + day,
      points: [[t, 'exact', 100, 100], [t + day, 'exact', 200, 200]], presence: [[t, 1]]}], {width: 640, height: 200, currency: 'JPY'});
    const line = svg.querySelector('path')!.getAttribute('d')!;
    const endY = Number(svg.querySelectorAll('circle')[1]!.getAttribute('cy')).toFixed(1);
    expect(line).toMatch(/^M[\d.]+ [\d.]+H[\d.]+V[\d.]+$/);
    expect(line.endsWith(`V${endY}`)).toBe(true);
  });

  it.each(['candidate', 'similar', 'unresolved', 'unit', 'error', 'missing', 'loading'])('keeps own history while showing %s separately without an overlay or difference', (kind) => {
    const f = setup();
    if (kind === 'candidate') f.relation.reviewStatus = 'candidate';
    if (kind === 'similar') { f.relation.kind = 'similar_product'; f.relation.differences = ['端子形状が異なります']; }
    if (kind === 'unresolved') f.relation.kind = 'unresolved';
    if (kind === 'unit') f.relation.pricePolicy = null;
    if (kind === 'error') f.entry.state = { kind: 'error', message: 'offline' };
    if (kind === 'missing') f.entry.state = { kind: 'missing', manifest: null, freshness: 'fresh' };
    if (kind === 'loading') f.entry.state = { kind: 'loading' };
    f.draw();
    expect(f.text()).toContain('￥1,200'); expect(f.shadow.querySelector('svg')).not.toBeNull();
    expect(f.shadow.querySelector('.eph-comparison-chart')).toBeNull(); expect(f.text()).not.toContain('記録価格差');
    if (kind === 'candidate') expect(f.text()).toContain('同一商品候補');
    if (kind === 'similar') { expect(f.text()).toContain('類似商品'); expect(f.text()).toContain('端子形状が異なります'); }
  });

  it('uses text content for hostile product names and does not create unsafe product links', () => {
    const f = setup(); f.entry.target.name = '<img src=x onerror=alert(1)>'; f.entry.target.url = 'javascript:alert(1)'; f.draw();
    expect(f.text()).toContain('<img src=x'); expect(f.shadow.querySelector('img')).toBeNull(); expect(f.shadow.querySelector('.store-price a')).toBeNull();
  });

  it('ends each comparison series at its own observation and draws a one-observation series as a point only', () => {
    const t = Date.parse('2026-09-01'); const day = 86_400_000;
    const svg = buildComparisonChart(document, [
      { id: 'a', label: 'A', start: t, end: t + day, points: [[t, 'exact', 100, 100]], presence: [[t, 1]] },
      { id: 'b', label: 'B', start: t + 2 * day, end: t + 2 * day, points: [[t + 2 * day, 'exact', 200, 200]], presence: [[t + 2 * day, 1]] },
    ], { width: 640, height: 200, currency: 'JPY' });
    const a = svg.querySelector('g[data-series="a"]')!, b = svg.querySelector('g[data-series="b"]')!;
    expect(a.querySelector('path')?.getAttribute('d')).toMatch(/^M67\.4 [\d.]+H342\.0$/);
    expect(b.querySelector('path')).toBeNull(); expect(b.querySelectorAll('circle')).toHaveLength(1);
    expect(b.querySelector('circle')!.getAttribute('aria-label')).toContain('2026-09-03');
    expect(b.querySelector('circle')!.getAttribute('tabindex')).toBe('0');
  });
});
