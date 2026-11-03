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
  it('filters related products by the displayed variant and restores them when switching back', () => {
    const f = setup();
    const first = f.current.offers[0]!;
    const other = structuredClone(first); other.externalOfferId = 'different'; other.sku = 'OTHER';
    f.current.offers.push(other);
    f.relation.products[0].offer = { id: first.externalOfferId, sku: first.sku!, name: 'selected' };
    f.draw(); expect(f.shadow.querySelector('.store-price')).not.toBeNull();
    f.ctx.selectedOfferId = other.externalOfferId; f.draw();
    expect(f.shadow.querySelector('.store-price')).toBeNull();
    expect(f.ctx.related).toHaveLength(1);
    f.ctx.selectedOfferId = first.externalOfferId; f.draw();
    expect(f.shadow.querySelector('.store-price')).not.toBeNull();
  });
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

  it('shows one similar card per variant with a row for each store, closest variants first', () => {
    const parent = document.createElement('div');
    const relations = PRODUCT_RELATIONS.filter(r => r.products.some(p => p.storeId === 'akizuki' && p.pageKey === '116132'));
    renderRelatedGroups(document, parent, relatedEntries(relations, 'akizuki', '116132'), id => id);
    const section = parent.querySelector('details[data-state-key="group-similar"]')!;
    expect(section.querySelector('summary')!.textContent).toBe('類似商品 (21件・7種類)');
    const cards = [...section.querySelectorAll('.related-card')];
    expect(cards.map(card => card.querySelector('.related-title')!.textContent)).toEqual([
      'Raspberry Pi Pico 2', 'Raspberry Pi Pico W', 'Raspberry Pi Pico H',
      'Raspberry Pi Pico 2W', 'Raspberry Pi Pico 2 H', 'Raspberry Pi Pico WH', 'Raspberry Pi Pico 2 WH',
    ]);
    for (const card of cards) {
      const rows = [...card.querySelectorAll<HTMLElement>('.related-offer')];
      expect(rows.map(row => row.querySelector('.related-store div')!.textContent).sort()).toEqual(['ksy', 'sengoku', 'switch-science']);
      // Every row's own relation states the differences the card shows once.
      const shown = [...card.querySelectorAll(':scope > .related-name')].map(p => p.textContent).sort();
      for (const row of rows) {
        expect([...row.querySelectorAll('.related-evidence p')].map(p => p.textContent!).filter(t => t.startsWith('相違点: ')).map(t => t.slice(5)).sort()).toEqual(shown);
      }
    }
    expect(cards[3]!.textContent).toContain('MCU: RP2040 → RP2350');
    expect(cards[3]!.textContent).toContain('無線: なし → Wi-Fi/Bluetooth');
    // 16 rows are beyond the history-load cap; each card explains that once instead of every row.
    expect(section.querySelectorAll('.related-offer')).toHaveLength(21);
    expect(section.textContent!.split('履歴の自動取得は上位候補のみ').length - 1).toBe(7);
  });
  it('shows independent store timestamps, labelled statistics, safe links, two series and a signed recorded-price difference', () => {
    const f = setup(); f.draw();
    expect(f.text()).toContain('店舗別の記録価格'); expect(f.text()).toContain('Store A（閲覧中）'); expect(f.text()).toContain('Store Aの価格履歴・統計');
    expect(f.text()).toContain('記録価格差（他店 − 閲覧中） +￥300'); expect(f.text()).toContain('現在の最安価格を示すものではありません');
    expect(f.shadow.querySelectorAll('.eph-comparison-chart g[data-series]')).toHaveLength(2);
    const link = f.shadow.querySelector<HTMLAnchorElement>('.store-price a')!;
    expect(link.href).toBe(f.entry.target.url); expect(link.rel).toContain('noopener');
  });

  it('draws the recorded stock counts of both stores under the price chart, in the same series colors', () => {
    const f = setup(); f.draw();
    const groups = [...f.shadow.querySelectorAll<SVGGElement>('.eph-inventory-chart g[data-series]')];
    expect(groups.map((g) => [g.dataset['series'], g.getAttribute('data-series-index')])).toEqual([['current', '0'], ['example-pair', '1']]);
    expect(f.shadow.querySelector('.stock-chart')?.textContent).toContain('在庫数の推移（店舗のページが示す数。実在庫を保証しません）');
    expect([...groups[0]!.querySelectorAll('circle')].map((c) => c.getAttribute('aria-label')).join(' ')).toContain('在庫数 781');
  });

  it('reads a count at the store display cap as 「100+」 and explains it only when one is drawn (#74)', () => {
    const f = setup();
    const own = f.current.offers[0]!.inventory;
    const at = own.points.map(([t]) => t);
    f.current.offers[0]!.inventory = { ...own, points: [[at[0]!, 37], [at[at.length - 1]!, 100]], cappedAt: 100 };
    f.draw();
    expect(f.text()).toContain('在庫数 100+ · ');
    const labels = [...f.shadow.querySelectorAll('.eph-inventory-chart g[data-series="current"] circle')].map((c) => c.getAttribute('aria-label'));
    expect(labels).toEqual([expect.stringMatching(/在庫数 37$/), expect.stringMatching(/在庫数 100\+$/)]);
    expect(f.shadow.querySelector('.stock-chart > div')?.textContent).toBe('在庫数の推移（店舗のページが示す数。「100+」は100以上。実在庫を保証しません）');
    // Below the cap the count is exact, and the heading says nothing about it.
    f.current.offers[0]!.inventory = { ...own, points: [[at[0]!, 37], [at[at.length - 1]!, 99]], cappedAt: 100 };
    f.draw();
    expect(f.text()).toContain('在庫数 99 · ');
    expect(f.shadow.querySelector('.stock-chart > div')?.textContent).toBe('在庫数の推移（店舗のページが示す数。実在庫を保証しません）');
  });

  it('leaves out the stock chart when the setting is off, and a store that shows no count', () => {
    const f = setup();
    f.ctx.preferences = { cardFee: { enabled: false, cardId: 'smbc-visa-mastercard', customPercent: null }, showStock: false };
    f.draw();
    expect(f.shadow.querySelector('.stock-chart')).toBeNull();
    f.ctx.preferences = { ...f.ctx.preferences, showStock: true };
    f.other.offers[0]!.inventory = { semantics: 'not_exposed', points: [], truncated: false, totalPoints: 0 };
    f.draw();
    expect([...f.shadow.querySelectorAll<SVGGElement>('.eph-inventory-chart g[data-series]')].map((g) => g.dataset['series'])).toEqual(['current']);
  });

  it('preserves disclosure state, legend selection and focus when another data result arrives', () => {
    const f = setup(); f.draw();
    const details = f.shadow.querySelector<HTMLDetailsElement>('.related-evidence')!; details.open = true;
    const inputs = f.shadow.querySelectorAll<HTMLInputElement>('.series-controls input'); inputs[1]!.click(); inputs[1]!.focus();
    f.draw();
    expect(f.shadow.querySelector<HTMLDetailsElement>('.related-evidence')!.open).toBe(true);
    expect(f.shadow.querySelectorAll<HTMLInputElement>('.series-controls input')[1]!.checked).toBe(false);
    expect(f.shadow.activeElement?.getAttribute('data-focus-key')).toBe('series-example-pair');
    expect(f.shadow.querySelectorAll<SVGGElement>('.eph-comparison-chart g[data-series]')[1]!.style.display).toBe('none');
    // The store switch hides that store's stock line too.
    expect(f.shadow.querySelector<SVGGElement>('.eph-inventory-chart g[data-series="example-pair"]')!.style.display).toBe('none');
    expect(f.shadow.querySelector<SVGGElement>('.eph-inventory-chart g[data-series="current"]')!.style.display).toBe('');
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
    expect(a.querySelector('path')?.getAttribute('d')).toMatch(/^M73\.3 [\d.]+H345\.0$/);
    expect(b.querySelector('path')).toBeNull(); expect(b.querySelectorAll('circle')).toHaveLength(1);
    expect(b.querySelector('circle')!.getAttribute('aria-label')).toContain('2026-09-03');
    expect(b.querySelector('circle')!.getAttribute('tabindex')).toBe('0');
  });

  it.each([280, 350, 640])('labels both ends with times for a short history at width %i', (width) => {
    const start = new Date(2026, 8, 6, 20, 0).getTime();
    const end = new Date(2026, 8, 7, 10, 42).getTime();
    const svg = buildComparisonChart(document, [
      { id: 'a', label: 'A', start, end, points: [[start, 'exact', 3500, 3500]], presence: [[start, 1]] },
    ], { width, height: 220, currency: 'JPY' });
    const labels = [...svg.querySelectorAll('text.eph-axis')].map((node) => node.textContent);
    expect(labels).toContain('09-06 20:00');
    expect(labels).toContain('09-07 10:42');
  });
});
