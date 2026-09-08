import type { CaveatKey, ManifestV1, OfferV1, ProductFileV1, SegmentV1 } from '../../src/publisher/contract.ts';
import type { LoadState } from '../core/dataClient.ts';
import { availabilityLabel, basisLabel, caveatText, formatDate, formatDateTime, formatPercent, formatPriceValue, formatSignedMoney } from '../core/format.ts';
import { buildStepChart, buildComparisonChart, type ComparisonSeries } from './chart.ts';
import { comparisonEligibility, currentOffer, type RelatedEntry } from '../core/relations.ts';
import { RELATED_CSS, renderRelatedGroups, renderStorePrices } from './related.ts';

/**
 * The history panel. Rendered into a Shadow DOM root so neither the page's
 * CSS nor ours leaks. Every piece of text is assigned through `textContent`.
 *
 * Layout: the panel is mounted as a full-width block, so the chart is the
 * primary element (left) and the figures read as a compact summary beside it
 * (right). Narrow viewports or embedding columns stack the two. No animation
 * anywhere (ADR-0011).
 */

export const PANEL_TITLE = 'Electronics Price History';

/** Chart viewBox. The SVG scales to its column, so this only fixes the aspect ratio. */
const CHART_SIZE = { width: 760, height: 280 };

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
}

export const PANEL_CSS = `
:host { all: initial; display: block; font: 13px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif; }
.eph {
  container-type: inline-size;
  color-scheme: light;
  --bg: #fff; --fg: #16202b; --muted: #5f6b7a; --line: #e3e8ef; --line-soft: #eef2f6;
  --accent: #1f6feb; --up: #b42318; --down: #027a48; --chip: #eef2f7; --chip-fg: #46525f;
  box-sizing: border-box; width: 100%; margin: 16px 0; padding: 14px 16px 10px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg);
}
.eph[data-theme="dark"] {
    color-scheme: dark;
    --bg: #161b22; --fg: #e6edf3; --muted: #9aa7b4; --line: #2b3440; --line-soft: #232c36;
    --accent: #6ea8ff; --up: #ff8078; --down: #5ed6a4; --chip: #232c36; --chip-fg: #b6c2ce;
}
.eph * { box-sizing: border-box; }

.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.brand { font-size: 13px; font-weight: 700; letter-spacing: .01em; }
.badge { font-size: 11px; padding: 1px 7px; border-radius: 10px; background: var(--chip); color: var(--chip-fg); font-weight: 500; }
.badge.stale { background: #fff4e5; color: #8a5a00; }
.badge.error { background: #fde8e8; color: #9b1c1c; }
.eph[data-theme="dark"] .badge.stale { background: #3b2f14; color: #f0c274; }
.eph[data-theme="dark"] .badge.error { background: #3d1f1f; color: #f5a3a3; }
.theme-controls { display: flex; gap: 4px; }
.theme-controls button { font: inherit; font-size: 12px; min-height: 32px; padding: 4px 10px; border: 1px solid var(--muted); border-radius: 4px; background: var(--bg); color: var(--fg); cursor: pointer; }
.theme-controls button:hover { background: var(--chip); }
.theme-controls button[aria-pressed="true"] { background: var(--chip); border-color: var(--accent); color: var(--accent); font-weight: 700; }
.theme-controls button:active { background: var(--line); }
.theme-controls button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (pointer: coarse) { .theme-controls button { min-height: 44px; } }
.spacer { flex: 1 1 auto; }
.basis { font-size: 12px; color: var(--muted); }
.eph select { font: inherit; font-size: 12px; padding: 2px 4px; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; }

.body { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(250px, 1fr); gap: 4px 26px; align-items: start; padding-top: 12px; }
@media (max-width: 900px) { .body { grid-template-columns: 1fr; } }
@container (max-width: 700px) { .body { grid-template-columns: 1fr; } }
.chart-box { min-width: 0; min-height: 90px; }
.eph svg { display: block; width: 100%; height: auto; }
.eph .eph-grid { stroke: var(--line-soft); stroke-width: 1; }
.eph .eph-axis, .eph .eph-chart-empty { font-size: 11px; fill: var(--muted); }
.eph .eph-line { stroke: var(--accent); stroke-width: 2.5; }
.eph .eph-band { fill: var(--accent); fill-opacity: 0.14; }
.eph .eph-gap { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.eph .eph-dot { fill: var(--accent); }

.hero-label { font-size: 11px; color: var(--muted); }
.hero-value { font-size: 27px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.hero-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
.delta { font-size: 13px; font-weight: 700; margin-left: 8px; white-space: nowrap; }
.delta.up { color: var(--up); } .delta.down { color: var(--down); }

.rows { margin: 12px 0 0; }
.rows > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 5px 0; border-top: 1px solid var(--line-soft); }
.rows dt { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.rows dd { margin: 0; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.rows dd .sub { display: block; font-weight: 400; color: var(--muted); font-size: 11px; }

.foot-blocks { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 8px; }
.eph details { margin: 4px 0; }
.eph summary { cursor: pointer; color: var(--accent); font-size: 12px; }
.eph table { border-collapse: collapse; font-size: 12px; margin-top: 6px; }
.eph th, .eph td { border-bottom: 1px solid var(--line-soft); padding: 3px 16px 3px 0; text-align: left; font-variant-numeric: tabular-nums; }
.eph th { color: var(--muted); font-weight: 500; }
.eph ul.caveats { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 11px; }
.eph footer { font-size: 11px; color: var(--muted); margin-top: 8px; }
.eph a { color: var(--accent); }
.eph p { margin: 6px 0; }
.eph .muted { color: var(--muted); }
` + RELATED_CSS;

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

/** Chart column: drawn immediately, or when the panel first becomes visible. */
function renderChart(ctx: PanelContext, parent: HTMLElement, product: ProductFileV1, segment: SegmentV1, ownFresh: boolean): void {
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
      end: entry.state.product.product.lastSeenAt }];
  });
  const series: ComparisonSeries[] = [{ id: 'current', label: `${storeLabel(product.storeId)}（閲覧中）`, points: segment.points, presence: segment.presence,
    start: Math.max(start, segment.stats.segmentStartAt), end: product.product.lastSeenAt }, ...others];
  const draw = () => {
    if (box.childNodes.length > 0) return;
    if (others.length) {
      const chartWidth = () => Math.max(280, Math.min(CHART_SIZE.width, box.clientWidth || CHART_SIZE.width));
      let width = chartWidth();
      const makeSvg = () => buildComparisonChart(doc, series, { width, height: width < 450 ? 220 : CHART_SIZE.height, currency: segment.basis.currency });
      let svg = makeSvg();
      const controls = doc.createElement('div'); controls.className = 'series-controls'; controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'グラフに表示する店舗');
      const hidden = ctx.hiddenSeries ??= new Set();
      const message = text(doc, 'div', '表示する店舗を選択してください', 'related-meta'); message.setAttribute('role', 'status');
      const updateMessage = () => { message.hidden = series.some((s) => !hidden.has(s.id)); };
      series.forEach((s, i) => {
        const label = doc.createElement('label'); label.dataset['seriesIndex'] = String(i);
        const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = !hidden.has(s.id); input.dataset['focusKey'] = `series-${s.id}`;
        const update = () => {
          const group = [...svg.querySelectorAll<SVGGElement>('g[data-series]')].find((g) => g.dataset['series'] === s.id);
          if (group) group.style.display = input.checked ? '' : 'none'; updateMessage();
        };
        input.addEventListener('change', () => { if (input.checked) hidden.delete(s.id); else hidden.add(s.id); update(); });
        const swatch = text(doc, 'span', '', 'series-swatch'); swatch.setAttribute('aria-hidden', 'true');
        label.append(input, swatch, doc.createTextNode(s.label)); controls.appendChild(label); update();
      });
      box.append(controls, svg, message, text(doc, 'div', '各店舗の最終観測までを表示。点にフォーカスすると日時と価格を確認できます。', 'related-meta'));
      // Resize only the SVG, not the controls or data. This keeps axis text
      // readable on narrow screens and avoids refetching or losing checkboxes.
      if (doc.defaultView && typeof doc.defaultView.ResizeObserver === 'function') {
        const resize = new doc.defaultView.ResizeObserver(() => {
          const nextWidth = chartWidth(); if (nextWidth === width) return; width = nextWidth;
          const next = makeSvg();
          for (const group of next.querySelectorAll<SVGGElement>('g[data-series]')) group.style.display = hidden.has(group.dataset['series']!) ? 'none' : '';
          svg.replaceWith(next); svg = next;
        });
        resize.observe(box);
        const previousCleanup = ctx.cleanup;
        ctx.cleanup = () => { previousCleanup?.(); resize.disconnect(); };
      }
      return;
    }
    box.appendChild(
      buildStepChart(doc, segment.points, segment.presence, {
        ...CHART_SIZE,
        start,
        end,
        currency: segment.basis.currency,
        label: basisLabel(segment.basis),
      }),
    );
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

/** Summary column: the current price as the headline, then the comparison figures. */
function renderStats(ctx: PanelContext, parent: HTMLElement, product: ProductFileV1, offer: OfferV1, segment: SegmentV1, ownFresh: boolean): void {
  const doc = ctx.doc;
  const currency = segment.basis.currency;
  const s = segment.stats;
  const money = (minor: number): string => formatPriceValue({ state: 'exact', minAmountMinor: minor, maxAmountMinor: minor }, currency);

  const col = doc.createElement('div');
  col.className = 'stats-col';
  const related = ctx.related ?? [];
  const storeLabel = ctx.storeLabel ?? ((id: string) => id);
  if (related.length) col.appendChild(text(doc, 'div', '店舗別の記録価格', 'comparison-heading'));
  col.appendChild(text(doc, 'div', related.length ? `${storeLabel(product.storeId)}（閲覧中）` : '現在の記録価格', 'hero-label'));
  const hero = text(doc, 'div', formatPriceValue(s.current, currency), 'hero-value');
  const dir = s.change.direction;
  if (s.change.differenceMinor !== null) {
    const delta = `${formatSignedMoney(s.change.differenceMinor, currency)}${s.change.percent === null ? '' : ` (${formatPercent(s.change.percent)})`}`;
    hero.appendChild(text(doc, 'span', delta, `delta${dir === 'up' || dir === 'down' ? ` ${dir}` : ''}`));
  }
  col.appendChild(hero);
  col.appendChild(text(doc, 'div', `${formatDate(s.currentSinceAt)} から${s.previousDistinct === null ? '(初回観測)' : ''}`, 'hero-meta'));
  const lastAvail = offer.availability[offer.availability.length - 1];
  if (related.length) {
    col.appendChild(text(doc, 'div', `最終観測 ${formatDateTime(product.product.lastSeenAt)}`, 'hero-meta'));
    if (lastAvail) col.appendChild(text(doc, 'div', `観測時の在庫: ${availabilityLabel(lastAvail[1])}`, 'hero-meta'));
    renderStorePrices(doc, col, product, segment, related, storeLabel, ownFresh);
  }

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
    const qtyText = qty !== undefined && qty[1] !== null && offer.inventory.semantics !== 'not_exposed' ? `表示在庫数 ${qty[1]}` : undefined;
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
      if (state.manifest !== null) renderCaveats(doc, root, state.manifest.caveats);
      renderFooter(ctx, root, state.manifest, null, state);
      return;
    case 'ready':
      break;
  }

  const product = state.product;
  badge(state.freshness === 'stale' ? 'キャッシュ表示' : '最新', state.freshness === 'stale' ? 'stale' : undefined);
  if (!product.product.listed) badge('最新の観測では未掲載', 'stale');
  head.appendChild(text(doc, 'span', '', 'spacer'));

  const offer = currentOffer(product);
  const picked = offer === null ? null : pickSegment(offer, selectedSegment);
  const tail = doc.createElement('div');
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
    renderChart(ctx, body, product, picked.segment, ownFresh);
    renderStats(ctx, body, product, offer, picked.segment, ownFresh);
    root.appendChild(body);
    tail.className = 'foot-blocks';
    root.appendChild(tail);
    renderChangeTable(doc, tail, picked.segment);
  }

  renderRelatedGroups(doc, tail, ctx.related ?? [], ctx.storeLabel ?? ((id: string) => id));

  const caveats: CaveatKey[] = [...(state.manifest?.caveats ?? []), ...product.caveats];
  if (product.product.metadata.some((m) => m.suspicious)) caveats.push('suspicious_identity');
  renderCaveats(doc, tail, caveats);
  renderFooter(ctx, tail, state.manifest, product, state);
}

/** Async updates keep disclosures, legend selection and keyboard focus intact. */
export function renderPanel(ctx: PanelContext, shadow: ShadowRoot, state: LoadState, selectedSegment: number | null, onSelectSegment: (index: number) => void): void {
  const disclosures = new Map([...shadow.querySelectorAll<HTMLDetailsElement>('details[data-state-key]')].map((d) => [d.dataset['stateKey'], d.open]));
  const focused = shadow.activeElement?.getAttribute('data-focus-key');
  ctx.cleanup?.(); delete ctx.cleanup;
  renderPanelContent(ctx, shadow, state, selectedSegment, onSelectSegment);
  for (const d of shadow.querySelectorAll<HTMLDetailsElement>('details[data-state-key]')) {
    const open = disclosures.get(d.dataset['stateKey']); if (open !== undefined) d.open = open;
  }
  if (focused) [...shadow.querySelectorAll<HTMLElement>('[data-focus-key]')].find((e) => e.dataset['focusKey'] === focused)?.focus({ preventScroll: true });
}
