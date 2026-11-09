import type { AvailabilityPointV1, CaveatKey, InventoryV1, ManifestV1, OfferV1, ProductFileV1, SegmentV1 } from '../../src/publisher/contract.ts';
import { chartWindowStart, DEFAULT_CHART_PERIOD, type ChartPeriodId } from '../core/chartPeriod.ts';
import { estimateSales } from '../core/stockSales.ts';
import type { LoadState } from '../core/dataClient.ts';
import type { JpyRate } from '../core/exchangeRate.ts';
import { availabilityLabel, basisLabel, caveatText, formatDate, formatDateTime, formatPercent, formatPriceValue, formatSignedMoney, formatStockCount } from '../core/format.ts';
import { appliedCardFee, DEFAULT_PREFERENCES, type Preferences } from '../core/preferences.ts';
import { buildStepChart, buildComparisonChart, buildInventoryChart, type ComparisonSeries, type InventorySeries } from './chart.ts';
import { comparisonEligibility, currentOffer, primaryQuote, type RelatedEntry } from '../core/relations.ts';
import { buildPeriodControls, buildSalesSummary, PERIOD_CSS, type SalesRow } from './periodView.ts';
import { RELATED_CSS, renderRelatedGroups, renderStorePrices } from './related.ts';
import { buildSettingsDialog, openSettingsDialog, SETTINGS_CSS } from './settings.ts';
import { YEN_CSS, yenConverter, type YenConverter } from './yen.ts';

/**
 * The history panel. Rendered into a Shadow DOM root so neither the page's
 * CSS nor ours leaks. Every piece of text is assigned through `textContent`.
 *
 * Layout: the panel is mounted as a full-width block, so the chart is the
 * primary element (left) and the figures read as a compact summary beside it
 * (right). Narrow viewports or embedding columns stack the two, chart first,
 * so the order never depends on the store's layout. No animation
 * anywhere (ADR-0011).
 */

export const PANEL_TITLE = 'Electronics Price History';

/**
 * Maximum chart dimensions. The viewBox follows the box's width up to this cap, so axis
 * text keeps its 12px; the cap is above the widest store panel measured (1,091px).
 */
const CHART_SIZE = { width: 1200, height: 280 };

export interface PanelContext {
  doc: Document;
  /** Source of the data, shown in the footer. */
  dataBaseUrl: string;
  /** Whether the chart is drawn immediately or when the panel becomes visible. */
  lazyChart: boolean;
  theme: 'light' | 'dark';
  onThemeChange(theme: 'light' | 'dark'): void;
  storeLabel?: (storeId: string) => string;
  related?: RelatedEntry[];
  hiddenSeries?: Set<string>;
  cleanup?: () => void;
  selectedOfferId?: string;
  onSelectOffer?: (id: string) => void;
  /** Yen per unit by currency; current prices in these currencies read in yen. */
  yenRates?: Readonly<Record<string, JpyRate>>;
  /** The viewer's settings; the defaults until the stored ones are read. */
  preferences?: Preferences;
  /** Saves the settings and re-renders. Without it the panel shows no settings button. */
  onPreferencesChange?(preferences: Preferences): void;
  /** The settings dialog survives re-renders through this flag. */
  settingsOpen?: boolean;
  /** The period the charts show; kept here so a re-render does not reset it. Absent = the whole record. */
  chartPeriod?: ChartPeriodId;
}

/** Counts the store showed and the collector recorded; a boolean-only store has none. */
function shownQuantities(inventory: InventoryV1): boolean {
  return inventory.semantics !== 'not_exposed' && inventory.points.some((p) => p[1] !== null);
}

/**
 * The stock chart heading; it explains 「N+」 only when a count reached a store's cap
 * and its step lies inside the window, so the note never names a mark that is not drawn.
 */
function stockHeading(stock: readonly InventorySeries[]): string {
  const drawnAtCap = (s: InventorySeries) => s.points.some(([t, n], i) => n !== null && n >= s.cappedAt! && t <= s.end && (s.points[i + 1]?.[0] ?? s.end) >= s.start);
  const caps = [...new Set(stock.flatMap((s) => s.cappedAt !== undefined && drawnAtCap(s) ? [s.cappedAt] : []))];
  const capNote = caps.map((c) => `「${c}+」は${c}以上`).join('、');
  return `在庫数の推移（店舗のページが示す数。${capNote === '' ? '' : `${capNote}。`}実在庫を保証しません）`;
}

/**
 * Page CSS that matches the host element outranks `:host`, and the panel would
 * inherit the store's font from it. `.eph` therefore starts from `all: initial`
 * and sets its own text properties; no page selector reaches inside the shadow root.
 *
 * The chart always spans the panel and everything else follows below it, at every
 * width (#71). Below the chart the space is shared by width, never by store: the
 * store price cards wrap into as many columns as fit (related.ts), and a product
 * without other stores puts its statistics beside its current price once the
 * panel's inner width reaches 560px. Without container queries (Chrome 102–104)
 * that statistics block simply stays under the price.
 */
export const PANEL_CSS = `
:host { all: initial; display: block; }
.eph {
  all: initial; display: block;
  font: 13px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
  text-size-adjust: 100%; -webkit-text-size-adjust: 100%;
  container-type: inline-size;
  color-scheme: light;
  --bg: #fff; --fg: #16202b; --muted: #5f6b7a; --line: #e3e8ef; --line-soft: #eef2f6;
  --accent: #1f6feb; --up: #b42318; --down: #027a48; --chip: #eef2f7; --chip-fg: #46525f;
  box-sizing: border-box; width: 100%; margin: 16px 0; padding: 14px 16px 10px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg);
}
.eph[data-theme="dark"] {
    color-scheme: dark;
    --bg: #3e3e3e; --fg: #e6edf3; --muted: #a7b3bf; --line: #626262; --line-soft: #525252;
    --accent: #7db2ff; --up: #ff8f87; --down: #5ed6a4; --chip: #232c36; --chip-fg: #b6c2ce;
}
.eph * { box-sizing: border-box; }

.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.brand { font-size: 13px; font-weight: 700; letter-spacing: .01em; }
.badge { font-size: 12px; padding: 1px 7px; border-radius: 10px; background: var(--chip); color: var(--chip-fg); font-weight: 500; }
.badge.stale { background: #fff4e5; color: #8a5a00; }
.badge.error { background: #fde8e8; color: #9b1c1c; }
.eph[data-theme="dark"] .badge.stale { background: #3b2f14; color: #f0c274; }
.eph[data-theme="dark"] .badge.error { background: #3d1f1f; color: #f5a3a3; }
.theme-controls { display: flex; gap: 4px; }
.theme-controls button, .period-controls button, .settings-button { font: inherit; font-size: 12px; min-height: 32px; padding: 4px 10px; border: 1px solid var(--muted); border-radius: 4px; background: var(--bg); color: var(--fg); cursor: pointer; }
@media (hover: hover) { .theme-controls button:hover, .period-controls button:hover, .settings-button:hover { background: var(--chip); } }
.theme-controls button[aria-pressed="true"], .period-controls button[aria-pressed="true"] { background: var(--chip); border-color: var(--accent); color: var(--accent); font-weight: 700; }
.theme-controls button:active, .period-controls button:active, .settings-button:active { background: var(--line); }
.theme-controls button:focus-visible, .period-controls button:focus-visible, .settings-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (pointer: coarse) { .theme-controls button, .period-controls button, .settings-button { min-height: 44px; } }
.spacer { flex: 1 1 auto; }
.basis { font-size: 12px; color: var(--muted); }
.eph select { font: inherit; font-size: 12px; max-width: 100%; min-width: 0; padding: 2px 4px; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; }

.body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-top: 12px; }
@container (min-width: 560px) {
  .body:not(.has-comparison) > .stats-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); column-gap: 32px; align-items: start; }
  .body:not(.has-comparison) > .stats-col > .rows { grid-column: 2; grid-row: 1 / span 2; margin-top: 0; }
}
.chart-box { min-width: 0; min-height: 90px; }
.eph svg { display: block; width: 100%; height: auto; }
.eph .eph-grid { stroke: var(--line-soft); stroke-width: 1; }
.eph .eph-axis, .eph .eph-chart-empty { font-size: 12px; fill: var(--muted); }
.eph .eph-line { stroke: var(--accent); stroke-width: 2.5; }
.eph .eph-band { fill: var(--accent); fill-opacity: 0.14; }
.eph .eph-gap { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.eph .eph-dot { fill: var(--accent); }
.eph .stock-chart { margin-top: 10px; padding-top: 6px; border-top: 1px dashed var(--line-soft); }
.eph .eph-inventory-chart .eph-line { stroke-width: 2; }
.eph .eph-readout-hit { cursor: crosshair; }
.eph .eph-readout-guide { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 2; }
.eph .eph-readout-marker { fill: var(--accent); stroke: var(--bg); stroke-width: 1.5; }
.eph .eph-readout-bg { fill: var(--bg); fill-opacity: 0.96; stroke: var(--line); }
.eph .eph-readout-text { font-size: 12px; fill: var(--fg); font-variant-numeric: tabular-nums; }
.eph .eph-readout-time { font-weight: 700; }

.hero-label { font-size: 12px; color: var(--muted); }
.hero-value { font-size: 27px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.hero-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
.delta { font-size: 13px; font-weight: 700; margin-left: 8px; white-space: nowrap; }
.delta.up { color: var(--up); } .delta.down { color: var(--down); }

.rows { margin: 12px 0 0; }
.rows > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 5px 0; border-top: 1px solid var(--line-soft); }
.rows dt { font-size: 12px; color: var(--muted); white-space: nowrap; }
.rows dd { margin: 0; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.rows dd .sub { display: block; font-weight: 400; color: var(--muted); font-size: 12px; }

.foot-blocks { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 8px; }
.eph details { margin: 4px 0; }
.eph summary { cursor: pointer; color: var(--accent); font-size: 12px; }
.eph table { border-collapse: collapse; font-size: 12px; margin-top: 6px; }
.eph th, .eph td { border-bottom: 1px solid var(--line-soft); padding: 3px 16px 3px 0; text-align: left; font-variant-numeric: tabular-nums; }
.eph th { color: var(--muted); font-weight: 500; }
.eph ul.caveats { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 12px; }
.eph footer { font-size: 12px; color: var(--muted); margin-top: 8px; }
.eph a { color: var(--accent); }
.eph p { margin: 6px 0; }
.eph .muted { color: var(--muted); }
` + RELATED_CSS + YEN_CSS + SETTINGS_CSS + PERIOD_CSS;

function text(doc: Document, tag: string, content: string, className?: string): HTMLElement {
  const node = doc.createElement(tag);
  node.textContent = content;
  if (className !== undefined) node.className = className;
  return node;
}

function row(doc: Document, list: HTMLElement, label: string, value: string, sub?: string): void {
  const wrap = doc.createElement('div');
  wrap.appendChild(text(doc, 'dt', label));
  const dd = text(doc, 'dd', value);
  if (sub !== undefined) dd.appendChild(text(doc, 'span', sub, 'sub'));
  wrap.appendChild(dd);
  list.appendChild(wrap);
}

function pickSegment(offer: OfferV1, index: number | null): { segment: SegmentV1; index: number } | null {
  if (offer.segments.length === 0) return null;
  const i = index ?? Math.max(0, offer.segments.findIndex((s) => s.primary));
  const segment = offer.segments[i] ?? offer.segments[0];
  return segment === undefined ? null : { segment, index: offer.segments.indexOf(segment) };
}

/** A chart series with the stock counts and availability of the offer it draws; the estimate reads both. */
type StoreSeries = ComparisonSeries & { inventory: InventoryV1 | null; availability: readonly AvailabilityPointV1[] };

const quoted = (offer: OfferV1 | undefined) => ({ inventory: offer?.inventory ?? null, availability: offer?.availability ?? [] });

/** Chart column: drawn immediately, or when the panel first becomes visible. */
function renderChart(ctx: PanelContext, parent: HTMLElement, product: ProductFileV1, offer: OfferV1, segment: SegmentV1, ownFresh: boolean): void {
  const doc = ctx.doc;
  const box = doc.createElement('div');
  box.className = 'chart-box';
  parent.appendChild(box);
  const start = product.observation.firstObservedAt ?? segment.stats.segmentStartAt;
  const end = product.observation.latestObservedAt ?? segment.stats.currentSinceAt;
  const storeLabel = ctx.storeLabel ?? ((id: string) => id);
  const others = (ctx.related ?? []).flatMap((entry) => {
    const eligibility = comparisonEligibility(product, segment, entry);
    if (!ownFresh || !eligibility.comparable || entry.state.kind !== 'ready') return [];
    return [{ id: entry.relation.id, label: storeLabel(entry.target.storeId), points: eligibility.other.points, presence: eligibility.other.presence,
      start: Math.max(entry.state.product.observation.firstObservedAt ?? eligibility.other.stats.segmentStartAt, eligibility.other.stats.segmentStartAt),
      end: entry.state.product.product.lastSeenAt, ...quoted(primaryQuote(entry.state.product, entry.target)?.offer) }];
  });
  const series: StoreSeries[] = [{ id: 'current', label: `${storeLabel(product.storeId)}（閲覧中）`, points: segment.points, presence: segment.presence,
    start: Math.max(start, segment.stats.segmentStartAt), end: product.product.lastSeenAt, ...quoted(offer) }, ...others];
  const showStock = (ctx.preferences ?? DEFAULT_PREFERENCES).showStock;
  // One window for every chart and estimate: it ends at the latest observation shown
  // and never starts before the first one (ADR-0031).
  const windowEnd = Math.max(end, ...series.map((s) => s.end));
  const earliest = Math.min(start, ...series.map((s) => s.start));
  const viewOf = (period: ChartPeriodId) => {
    const from = chartWindowStart(period, windowEnd, earliest);
    const windowed = series.map((s) => ({ ...s, start: Math.max(s.start, from) }));
    // Stock counts share the price chart's series, colors and store switches.
    const stock: InventorySeries[] = showStock
      ? windowed.flatMap((s, index) => s.inventory !== null && shownQuantities(s.inventory)
        ? [{ id: s.id, label: s.label, index, points: s.inventory.points, start: s.start, end: s.end, ...(s.inventory.cappedAt === undefined ? {} : { cappedAt: s.inventory.cappedAt }) }]
        : [])
      : [];
    const sales: SalesRow[] = showStock
      ? windowed.map((s) => ({ id: s.id, label: s.label, estimate: s.inventory !== null && shownQuantities(s.inventory) ? estimateSales(s.inventory.points, s.availability, from, s.end, s.inventory.cappedAt) : null }))
      : [];
    return { from, series: windowed, stepStart: Math.max(start, from), stock, sales };
  };
  const draw = () => {
    if (box.childNodes.length > 0) return;
    const chartWidth = () => Math.max(280, Math.min(CHART_SIZE.width, box.clientWidth || CHART_SIZE.width));
    let width = chartWidth();
    const hidden = ctx.hiddenSeries ??= new Set();
    let view = viewOf(ctx.chartPeriod ?? DEFAULT_CHART_PERIOD);
    const makeSvg = () => others.length
      ? buildComparisonChart(doc, view.series, { width, height: width < 450 ? 220 : CHART_SIZE.height, currency: segment.basis.currency })
      : buildStepChart(doc, segment.points, segment.presence, {
        width, height: width < 450 ? 220 : CHART_SIZE.height,
        start: view.stepStart,
        end,
        currency: segment.basis.currency,
        label: basisLabel(segment.basis),
      });
    const makeStock = () => buildInventoryChart(doc, view.stock, { width, height: width < 450 ? 110 : 120 });
    // Everything drawn per store follows the store switches (the lines and the sales rows);
    // a hidden store stays hidden after a resize or a change of period.
    const applyHidden = () => {
      for (const part of box.querySelectorAll<HTMLElement | SVGElement>('[data-series]')) part.style.display = hidden.has(part.dataset['series']!) ? 'none' : '';
    };
    let svg = makeSvg();
    let stockSvg: SVGSVGElement | null = null;
    const stockBox = view.stock.length ? text(doc, 'div', '', 'stock-chart') : null;
    // The stock section: heading, chart and the estimate, rebuilt for the chosen period.
    const fillStock = () => {
      if (stockBox === null) return;
      stockSvg = makeStock();
      const summary = buildSalesSummary(doc, view.sales, { from: view.from, to: windowEnd });
      stockBox.replaceChildren(text(doc, 'div', stockHeading(view.stock), 'related-meta'), stockSvg, ...(summary === null ? [] : [summary]));
    };
    fillStock();
    const periods = buildPeriodControls(doc, ctx.chartPeriod ?? DEFAULT_CHART_PERIOD, (id) => {
      ctx.chartPeriod = id;
      view = viewOf(id);
      const next = makeSvg(); svg.replaceWith(next); svg = next;
      fillStock();
      applyHidden();
    });
    if (others.length) {
      const controls = doc.createElement('div'); controls.className = 'series-controls'; controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'グラフに表示する店舗');
      const message = text(doc, 'div', '表示する店舗を選択してください', 'related-meta'); message.setAttribute('role', 'status');
      const updateMessage = () => { message.hidden = series.some((s) => !hidden.has(s.id)); };
      series.forEach((s, i) => {
        const label = doc.createElement('label'); label.dataset['seriesIndex'] = String(i);
        const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = !hidden.has(s.id); input.dataset['focusKey'] = `series-${s.id}`;
        input.addEventListener('change', () => { if (input.checked) hidden.delete(s.id); else hidden.add(s.id); applyHidden(); updateMessage(); });
        const swatch = text(doc, 'span', '', 'series-swatch'); swatch.setAttribute('aria-hidden', 'true');
        label.append(input, swatch, doc.createTextNode(s.label)); controls.appendChild(label);
      });
      box.append(periods, controls, svg, message, text(doc, 'div', '各店舗の最終観測までを表示。観測が1回だけの店舗は点のみです。最終観測より後の価格は未確認です。グラフに重ねると、その日の各店舗の記録価格を表示します（キーボードでは点にフォーカス）。', 'related-meta'));
      updateMessage();
    } else box.append(periods, svg);
    if (stockBox !== null) box.appendChild(stockBox);
    applyHidden();
    // Resize only the SVGs, not the controls or data. This keeps axis text
    // readable on narrow screens and avoids refetching or losing checkboxes.
    if (doc.defaultView && typeof doc.defaultView.ResizeObserver === 'function') {
      const resize = new doc.defaultView.ResizeObserver(() => {
        const nextWidth = chartWidth(); if (nextWidth === width) return; width = nextWidth;
        const next = makeSvg(); svg.replaceWith(next); svg = next;
        if (stockSvg !== null) { const nextStock = makeStock(); stockSvg.replaceWith(nextStock); stockSvg = nextStock; }
        applyHidden();
      });
      resize.observe(box);
      const previousCleanup = ctx.cleanup;
      ctx.cleanup = () => { previousCleanup?.(); resize.disconnect(); };
    }
  };
  const view = doc.defaultView;
  if (ctx.lazyChart && view !== null && typeof view.IntersectionObserver === 'function') {
    const io = new view.IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        draw();
        io.disconnect();
      }
    });
    io.observe(box);
    ctx.cleanup = () => io.disconnect();
  } else {
    draw();
  }
}

/**
 * Summary column: the current price as the headline, then the comparison
 * figures. A current price in a currency with a rate reads in yen, with the
 * recorded price and its change beside it; `fxSlot` is where the rate note goes.
 */
function renderStats(ctx: PanelContext, parent: HTMLElement, product: ProductFileV1, offer: OfferV1, segment: SegmentV1, ownFresh: boolean, yen: YenConverter, fxSlot: HTMLElement): void {
  const doc = ctx.doc;
  const currency = segment.basis.currency;
  const s = segment.stats;
  const money = (minor: number): string => formatPriceValue({ state: 'exact', minAmountMinor: minor, maxAmountMinor: minor }, currency);

  const col = doc.createElement('div');
  col.className = 'stats-col';
  const related = ctx.related ?? [];
  const storeLabel = ctx.storeLabel ?? ((id: string) => id);
  // The viewed store's price block: the first store card when other stores are shown.
  const current = doc.createElement('div');
  current.className = 'current-price';
  current.appendChild(text(doc, 'div', related.length ? `${storeLabel(product.storeId)}（閲覧中）` : '現在の記録価格', 'hero-label'));
  const recorded = formatPriceValue(s.current, currency);
  const inYen = yen.convert(s.current, currency);
  const hero = text(doc, 'div', inYen?.amount ?? recorded, 'hero-value');
  const dir = s.change.direction;
  const delta = s.change.differenceMinor === null ? null
    : text(doc, 'span', `${formatSignedMoney(s.change.differenceMinor, currency)}${s.change.percent === null ? '' : ` (${formatPercent(s.change.percent)})`}`, `delta${dir === 'up' || dir === 'down' ? ` ${dir}` : ''}`);
  current.appendChild(hero);
  if (inYen === null) {
    if (delta !== null) hero.appendChild(delta);
  } else {
    // The change is between recorded prices, so it stays in the recorded currency.
    const line = text(doc, 'div', `記録価格 ${recorded}`, 'fx-recorded');
    if (delta !== null) line.appendChild(delta);
    if (inYen.includes !== null) line.appendChild(doc.createTextNode(` · ${inYen.includes}`));
    current.appendChild(line);
  }
  current.appendChild(text(doc, 'div', `${formatDate(s.currentSinceAt)} から${s.previousDistinct === null ? '(初回観測)' : ''}`, 'hero-meta'));
  const lastAvail = offer.availability[offer.availability.length - 1];
  if (related.length) {
    current.appendChild(text(doc, 'div', `最終観測 ${formatDateTime(product.product.lastSeenAt)}`, 'hero-meta'));
    if (lastAvail) current.appendChild(text(doc, 'div', `観測時の在庫: ${availabilityLabel(lastAvail[1])}`, 'hero-meta'));
    col.appendChild(text(doc, 'div', '店舗別の記録価格', 'comparison-heading'));
    renderStorePrices(doc, col, current, product, segment, related, storeLabel, ownFresh, yen);
  } else col.appendChild(current);
  col.appendChild(fxSlot);

  const rows = doc.createElement('dl');
  rows.className = 'rows';
  if (s.change.differenceMinor === null && s.previousDistinct !== null) row(doc, rows, '前回価格からの変化', '比較不可');
  if (s.previousDistinct !== null) row(doc, rows, '前回の記録価格', formatPriceValue(s.previousDistinct, currency));
  if (s.observedMinMinor !== null && s.observedMaxMinor !== null) {
    row(doc, rows, '観測期間内の最低〜最高', `${money(s.observedMinMinor)}〜${money(s.observedMaxMinor)}`, `${formatDate(s.segmentStartAt)} 以降`);
  }
  for (const [key, label] of [
    ['d30', '直近30日'],
    ['d90', '直近90日'],
    ['d365', '直近365日'],
  ] as const) {
    const w = s.windows[key];
    row(doc, rows, `${label}の最低〜最高`, w === null ? '記録なし' : `${money(w.minMinor)}〜${money(w.maxMinor)}`);
  }
  if (lastAvail !== undefined) {
    const qty = offer.inventory.points[offer.inventory.points.length - 1];
    const qtyText = qty !== undefined && qty[1] !== null && shownQuantities(offer.inventory) ? `在庫数 ${formatStockCount(qty[1], offer.inventory.cappedAt)}` : undefined;
    const label = `${availabilityLabel(lastAvail[1])}${lastAvail[4] !== null && lastAvail[4] !== availabilityLabel(lastAvail[1]) ? `(${lastAvail[4]})` : ''}`;
    row(doc, rows, '最新の在庫表示', label, qtyText !== undefined ? `${qtyText} · ${formatDate(lastAvail[0])}` : formatDate(lastAvail[0]));
  }
  row(doc, rows, '価格変更の記録', `${s.changePointCount} 件`, product.product.listed ? '現在掲載中' : '最新の観測では未掲載');
  if (related.length) {
    const details = doc.createElement('details'); details.dataset['stateKey'] = 'own-statistics';
    const summary = text(doc, 'summary', `${storeLabel(product.storeId)}の価格履歴・統計`);
    summary.dataset['focusKey'] = 'own-statistics'; details.append(summary, rows); col.appendChild(details);
  } else col.appendChild(rows);
  parent.appendChild(col);
}

/** The change-point table, kept collapsed but always in the accessibility tree. */
function renderChangeTable(doc: Document, parent: HTMLElement, segment: SegmentV1): void {
  const details = doc.createElement('details');
  details.dataset['stateKey'] = 'price-changes';
  details.appendChild(text(doc, 'summary', `価格変更の一覧(${segment.points.length} 件)`));
  const table = doc.createElement('table');
  const head = doc.createElement('tr');
  head.appendChild(text(doc, 'th', '観測日時'));
  head.appendChild(text(doc, 'th', '価格'));
  table.appendChild(head);
  for (const p of [...segment.points].reverse()) {
    const tr = doc.createElement('tr');
    tr.appendChild(text(doc, 'td', formatDateTime(p[0])));
    tr.appendChild(text(doc, 'td', formatPriceValue({ state: p[1], minAmountMinor: p[2], maxAmountMinor: p[3] }, segment.basis.currency)));
    table.appendChild(tr);
  }
  details.appendChild(table);
  parent.appendChild(details);
}

function manifestCaveats(manifest: ManifestV1 | null): CaveatKey[] {
  const keys = [...(manifest?.caveats ?? [])];
  // The interval travels as an optional field, never as a caveat key: older
  // clients reject keys they do not know. Two days stays for datasets cached
  // from before the daily schedule.
  if (manifest?.observation.samplingIntervalDays === 1) keys.push('sampling_interval_daily');
  else if (manifest?.observation.samplingIntervalDays === 2) keys.push('sampling_interval_every_two_days');
  return keys;
}

function renderCaveats(doc: Document, root: HTMLElement, keys: Iterable<CaveatKey>): void {
  const list = doc.createElement('ul');
  list.className = 'caveats';
  const seen = new Set<CaveatKey>();
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    list.appendChild(text(doc, 'li', caveatText(k)));
  }
  if (list.childNodes.length === 0) return;
  const details = doc.createElement('details');
  details.dataset['stateKey'] = 'caveats';
  details.appendChild(text(doc, 'summary', `このデータの注意点(${seen.size} 件)`));
  details.appendChild(list);
  root.appendChild(details);
}

function renderFooter(ctx: PanelContext, root: HTMLElement, manifest: ManifestV1 | null, product: ProductFileV1 | null, state: LoadState): void {
  const doc = ctx.doc;
  const footer = doc.createElement('footer');
  const obs = product?.observation ?? manifest?.observation ?? null;
  const parts: string[] = [];
  if (obs !== null && obs.firstObservedAt !== null && obs.latestObservedAt !== null) parts.push(`観測期間 ${formatDate(obs.firstObservedAt)}〜${formatDate(obs.latestObservedAt)}(${obs.runCount} 回)`);
  const version = product?.datasetVersion ?? manifest?.datasetVersion ?? null;
  if (version !== null) parts.push(`データ版 ${version}`);
  if (state.kind === 'ready') parts.push(`取得 ${formatDateTime(state.storedAt)}`);
  footer.appendChild(text(doc, 'span', parts.join(' · ')));
  footer.appendChild(doc.createTextNode(' · '));
  const link = doc.createElement('a');
  link.href = ctx.dataBaseUrl;
  link.rel = 'noopener';
  link.target = '_blank';
  link.textContent = 'データについて';
  footer.appendChild(link);
  if (state.kind === 'ready' && state.note !== null) {
    footer.appendChild(doc.createElement('br'));
    footer.appendChild(text(doc, 'span', state.note, 'muted'));
  }
  root.appendChild(footer);
}

/** Replaces the shadow root's content with the rendering of `state`. */
function renderPanelContent(ctx: PanelContext, shadow: ShadowRoot, state: LoadState, selectedSegment: number | null, onSelectSegment: (index: number) => void): void {
  const doc = ctx.doc;
  while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
  const style = doc.createElement('style');
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);
  const root = doc.createElement('section');
  root.className = 'eph';
  root.dataset['theme'] = ctx.theme;
  root.setAttribute('aria-label', PANEL_TITLE);
  const head = doc.createElement('div');
  head.className = 'head';
  head.appendChild(text(doc, 'span', PANEL_TITLE, 'brand'));
  const themes = doc.createElement('div');
  themes.className = 'theme-controls';
  themes.setAttribute('role', 'group');
  themes.setAttribute('aria-label', '表示モード');
  const themeButtons: HTMLButtonElement[] = [];
  for (const [value, label] of [['light', 'ライト'], ['dark', 'ダーク']] as const) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset['focusKey'] = `theme-${value}`;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(ctx.theme === value));
    button.addEventListener('click', () => {
      root.dataset['theme'] = value;
      for (const candidate of themeButtons) candidate.setAttribute('aria-pressed', String(candidate === button));
      ctx.onThemeChange(value);
    });
    themeButtons.push(button);
    themes.appendChild(button);
  }
  head.appendChild(themes);
  root.appendChild(head);
  if (ctx.onPreferencesChange !== undefined) {
    const onChange = ctx.onPreferencesChange.bind(ctx);
    const button = text(doc, 'button', '設定', 'settings-button') as HTMLButtonElement;
    button.type = 'button';
    button.dataset['focusKey'] = 'settings';
    button.setAttribute('aria-haspopup', 'dialog');
    const dialog = buildSettingsDialog(doc, ctx.preferences ?? DEFAULT_PREFERENCES, {
      change: onChange,
      closed: () => {
        ctx.settingsOpen = false;
        button.focus({ preventScroll: true });
      },
    });
    button.addEventListener('click', () => {
      ctx.settingsOpen = true;
      openSettingsDialog(dialog);
    });
    head.appendChild(button);
    root.appendChild(dialog);
  }
  shadow.appendChild(root);

  const badge = (label: string, cls?: string) => {
    head.appendChild(text(doc, 'span', label, `badge${cls === undefined ? '' : ` ${cls}`}`));
  };

  switch (state.kind) {
    case 'loading':
      badge('読み込み中');
      root.appendChild(text(doc, 'p', '価格履歴を読み込んでいます…', 'muted'));
      return;
    case 'error':
      badge('取得できません', 'error');
      root.appendChild(text(doc, 'p', '価格履歴データを取得できませんでした。ページの表示には影響しません。', 'muted'));
      root.appendChild(text(doc, 'p', state.message, 'muted'));
      renderFooter(ctx, root, null, null, state);
      return;
    case 'missing':
      badge(state.freshness === 'stale' ? '記録なし(キャッシュ)' : '記録なし', state.freshness === 'stale' ? 'stale' : undefined);
      root.appendChild(text(doc, 'p', 'この商品はまだ観測データに含まれていません。次回の観測以降に表示されます。', 'muted'));
      if (state.manifest !== null) renderCaveats(doc, root, manifestCaveats(state.manifest));
      renderFooter(ctx, root, state.manifest, null, state);
      return;
    case 'ready':
      break;
  }

  const product = state.product;
  badge(state.freshness === 'stale' ? 'キャッシュ表示' : '最新', state.freshness === 'stale' ? 'stale' : undefined);
  if (!product.product.listed) badge('最新の観測では未掲載', 'stale');
  head.appendChild(text(doc, 'span', '', 'spacer'));

  const offer = product.offers.find((item) => item.externalOfferId === ctx.selectedOfferId) ?? currentOffer(product);
  if (product.offers.length > 1 && ctx.onSelectOffer) {
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'バリエーション');
    select.dataset['focusKey'] = 'offer';
    for (const item of product.offers) {
      const option = doc.createElement('option');
      option.value = item.externalOfferId;
      option.textContent = [item.variantName, item.sku].filter(Boolean).join(' / ') || item.externalOfferId;
      option.selected = item === offer;
      select.appendChild(option);
    }
    select.addEventListener('change', () => ctx.onSelectOffer?.(select.value));
    head.appendChild(select);
  }
  const picked = offer === null ? null : pickSegment(offer, selectedSegment);
  const tail = doc.createElement('div');
  const yen = yenConverter(ctx.yenRates ?? {}, appliedCardFee(ctx.preferences ?? DEFAULT_PREFERENCES));
  const fxSlot = doc.createElement('div');
  if (offer === null || picked === null) {
    root.appendChild(text(doc, 'p', '価格の記録がありません。', 'muted'));
    root.appendChild(tail);
  } else {
    if (offer.segments.length > 1) {
      const select = doc.createElement('select');
      select.setAttribute('aria-label', '価格の種類');
      select.dataset['focusKey'] = 'segment';
      offer.segments.forEach((seg, i) => {
        const opt = doc.createElement('option');
        opt.value = String(i);
        opt.textContent = basisLabel(seg.basis);
        if (i === picked.index) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => onSelectSegment(Number(select.value)));
      head.appendChild(select);
    } else {
      head.appendChild(text(doc, 'span', basisLabel(picked.segment.basis), 'basis'));
    }
    const body = doc.createElement('div');
    body.className = `body${ctx.related?.length ? ' has-comparison' : ''}`;
    const ownFresh = state.freshness === 'fresh' && state.note === null;
    renderChart(ctx, body, product, offer, picked.segment, ownFresh);
    renderStats(ctx, body, product, offer, picked.segment, ownFresh, yen, fxSlot);
    root.appendChild(body);
    tail.className = 'foot-blocks';
    root.appendChild(tail);
    renderChangeTable(doc, tail, picked.segment);
  }

  renderRelatedGroups(doc, tail, ctx.related ?? [], ctx.storeLabel ?? ((id: string) => id), yen);
  // One rate note for every yen value above, written once they are all known.
  if (fxSlot.parentNode === null) tail.appendChild(fxSlot);
  yen.renderNote(doc, fxSlot);

  const caveats: CaveatKey[] = [...manifestCaveats(state.manifest), ...product.caveats];
  if (product.product.metadata.some((m) => m.suspicious)) caveats.push('suspicious_identity');
  renderCaveats(doc, tail, caveats);
  renderFooter(ctx, tail, state.manifest, product, state);
}

/** Async updates keep disclosures, legend selection and keyboard focus intact. */
export function renderPanel(ctx: PanelContext, shadow: ShadowRoot, state: LoadState, selectedSegment: number | null, onSelectSegment: (index: number) => void): void {
  const disclosures = new Map([...shadow.querySelectorAll<HTMLDetailsElement>('details[data-state-key]')].map((d) => [d.dataset['stateKey'], d.open]));
  const focused = shadow.activeElement?.getAttribute('data-focus-key');
  ctx.cleanup?.(); delete ctx.cleanup;
  const allRelated = ctx.related;
  if (state.kind === 'ready') {
    const offer = state.product.offers.find(o => o.externalOfferId === ctx.selectedOfferId) ?? currentOffer(state.product);
    ctx.related = (allRelated ?? []).filter(entry => {
      const selected = entry.relation.products[entry.sourceIndex].offer;
      return !selected || (selected.id === offer?.externalOfferId && selected.sku === offer.sku);
    });
  }
  try { renderPanelContent(ctx, shadow, state, selectedSegment, onSelectSegment); }
  finally { if (allRelated === undefined) delete ctx.related; else ctx.related = allRelated; }
  for (const d of shadow.querySelectorAll<HTMLDetailsElement>('details[data-state-key]')) {
    const open = disclosures.get(d.dataset['stateKey']); if (open !== undefined) d.open = open;
  }
  // The rebuilt settings dialog opens again before focus returns to the control inside it.
  const settings = shadow.querySelector<HTMLDialogElement>('dialog.settings');
  if (settings !== null && ctx.settingsOpen) openSettingsDialog(settings);
  if (focused) [...shadow.querySelectorAll<HTMLElement>('[data-focus-key]')].find((e) => e.dataset['focusKey'] === focused)?.focus({ preventScroll: true });
}

/**
 * Taking the host out of the document and inserting it again (a move where the
 * browser has no `moveBefore`) loses focus and drops an open modal dialog out of
 * the top layer, while the dialog keeps its open attribute. Call before such a
 * move; the returned function, run after it, opens the settings dialog as a
 * modal again and gives focus back. Neither step fires the dialog's `close`, so
 * the panel still counts it as open.
 */
export function keepPanelStateAcrossReinsert(shadow: ShadowRoot): () => void {
  const focused = shadow.activeElement as HTMLElement | null;
  const settings = shadow.querySelector<HTMLDialogElement>('dialog.settings');
  const modal = settings !== null && settings.open && settings.dataset['fallback'] === undefined;
  return () => {
    if (settings !== null && modal && settings.isConnected) {
      settings.removeAttribute('open'); // showModal refuses a dialog that is already open
      openSettingsDialog(settings);
    }
    if (focused?.isConnected === true) focused.focus({ preventScroll: true });
  };
}
