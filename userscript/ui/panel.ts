import type { CaveatKey, ManifestV1, OfferV1, ProductFileV1, SegmentV1 } from '../../src/publisher/contract.ts';
import type { LoadState } from '../core/dataClient.ts';
import { availabilityLabel, basisLabel, caveatText, formatDate, formatDateTime, formatPercent, formatPriceValue, formatSignedMoney } from '../core/format.ts';
import { buildStepChart } from './chart.ts';

/**
 * The history panel. Rendered into a Shadow DOM root so neither the page's
 * CSS nor ours leaks. Every piece of text is assigned through `textContent`.
 */

export const PANEL_TITLE = 'Electronics Price History';

export interface PanelContext {
  doc: Document;
  /** Source of the data, shown in the footer. */
  dataBaseUrl: string;
  /** Whether the chart is drawn immediately or when the panel becomes visible. */
  lazyChart: boolean;
}

export const PANEL_CSS = `
:host { all: initial; display: block; font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1f2933; }
.eph { border: 1px solid #d0d7de; border-radius: 6px; padding: 12px 14px; margin: 12px 0; background: #fff; max-width: 100%; box-sizing: border-box; }
.eph h2 { font-size: 15px; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
.eph .badge { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #eef2f6; color: #4a5560; font-weight: normal; }
.eph .badge.stale { background: #fff4e5; color: #8a5a00; }
.eph .badge.error { background: #fde8e8; color: #9b1c1c; }
.eph .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 14px; margin: 8px 0; }
.eph dt { font-size: 11px; color: #5c6b7a; }
.eph dd { margin: 0; font-weight: 600; }
.eph dd .sub { font-weight: normal; color: #5c6b7a; font-size: 11px; }
.eph .up { color: #b42318; } .eph .down { color: #027a48; }
.eph select { font: inherit; margin: 6px 0; }
.eph .chart-box { margin: 8px 0; min-height: 40px; max-width: 720px; }
.eph svg { display: block; width: 100%; height: auto; }
.eph .eph-grid { stroke: #e5e9ee; stroke-width: 1; }
.eph .eph-axis, .eph .eph-chart-empty { font-size: 10px; fill: #5c6b7a; }
.eph .eph-line { stroke: #1f6feb; stroke-width: 2; }
.eph .eph-band { fill: #1f6feb; fill-opacity: 0.12; }
.eph .eph-gap { stroke: #9aa5b1; stroke-width: 1; stroke-dasharray: 3 3; }
.eph .eph-dot { fill: #1f6feb; }
.eph details { margin: 6px 0; }
.eph summary { cursor: pointer; color: #365fa8; }
.eph table { border-collapse: collapse; font-size: 12px; margin-top: 4px; }
.eph th, .eph td { border-bottom: 1px solid #e5e9ee; padding: 2px 8px 2px 0; text-align: left; }
.eph ul.caveats { margin: 4px 0 0; padding-left: 18px; color: #5c6b7a; font-size: 11px; }
.eph footer { font-size: 11px; color: #5c6b7a; margin-top: 8px; border-top: 1px solid #e5e9ee; padding-top: 6px; }
.eph a { color: #365fa8; }
.eph .muted { color: #5c6b7a; }
`;

function text(doc: Document, tag: string, content: string, className?: string): HTMLElement {
  const node = doc.createElement(tag);
  node.textContent = content;
  if (className !== undefined) node.className = className;
  return node;
}

function stat(doc: Document, grid: HTMLElement, label: string, value: string, sub?: string, className?: string): void {
  const wrap = doc.createElement('div');
  wrap.appendChild(text(doc, 'dt', label));
  const dd = text(doc, 'dd', value, className);
  if (sub !== undefined) {
    dd.appendChild(doc.createTextNode(' '));
    dd.appendChild(text(doc, 'span', sub, 'sub'));
  }
  wrap.appendChild(dd);
  grid.appendChild(wrap);
}

function pickSegment(offer: OfferV1, index: number | null): { segment: SegmentV1; index: number } | null {
  if (offer.segments.length === 0) return null;
  const i = index ?? Math.max(0, offer.segments.findIndex((s) => s.primary));
  const segment = offer.segments[i] ?? offer.segments[0];
  return segment === undefined ? null : { segment, index: offer.segments.indexOf(segment) };
}

function renderSegment(ctx: PanelContext, root: HTMLElement, product: ProductFileV1, offer: OfferV1, segment: SegmentV1): void {
  const doc = ctx.doc;
  const currency = segment.basis.currency;
  const s = segment.stats;
  const grid = doc.createElement('dl');
  grid.className = 'grid';
  const dir = s.change.direction;
  const changeText = s.change.differenceMinor === null ? (s.previousDistinct === null ? '初回観測' : '比較不可') : formatSignedMoney(s.change.differenceMinor, currency);
  const changeSub = s.change.percent === null ? undefined : formatPercent(s.change.percent);
  stat(doc, grid, '現在の記録価格', formatPriceValue(s.current, currency), `${formatDate(s.currentSinceAt)} から`);
  stat(doc, grid, '前回価格からの変化', changeText, changeSub, dir === 'up' || dir === 'down' ? dir : undefined);
  if (s.previousDistinct !== null) stat(doc, grid, '前回の記録価格', formatPriceValue(s.previousDistinct, currency));
  if (s.observedMinMinor !== null && s.observedMaxMinor !== null) {
    stat(doc, grid, '観測期間内の最低〜最高', `${formatPriceValue({ state: 'exact', minAmountMinor: s.observedMinMinor, maxAmountMinor: s.observedMinMinor }, currency)}〜${formatPriceValue({ state: 'exact', minAmountMinor: s.observedMaxMinor, maxAmountMinor: s.observedMaxMinor }, currency)}`, `${formatDate(s.segmentStartAt)} 以降`);
  }
  for (const [key, label] of [
    ['d30', '直近30日'],
    ['d90', '直近90日'],
    ['d365', '直近365日'],
  ] as const) {
    const w = s.windows[key];
    stat(doc, grid, `${label}の最低〜最高`, w === null ? '記録なし' : `${formatPriceValue({ state: 'exact', minAmountMinor: w.minMinor, maxAmountMinor: w.minMinor }, currency)}〜${formatPriceValue({ state: 'exact', minAmountMinor: w.maxMinor, maxAmountMinor: w.maxMinor }, currency)}`);
  }
  const lastAvail = offer.availability[offer.availability.length - 1];
  if (lastAvail !== undefined) {
    const qty = offer.inventory.points[offer.inventory.points.length - 1];
    const qtyText = qty !== undefined && qty[1] !== null && offer.inventory.semantics !== 'not_exposed' ? `表示在庫数 ${qty[1]}` : undefined;
    stat(doc, grid, '最新の在庫表示', `${availabilityLabel(lastAvail[1])}${lastAvail[4] !== null && lastAvail[4] !== availabilityLabel(lastAvail[1]) ? `(${lastAvail[4]})` : ''}`, qtyText !== undefined ? `${qtyText} · ${formatDate(lastAvail[0])}` : formatDate(lastAvail[0]));
  }
  stat(doc, grid, '価格変更の記録', `${s.changePointCount} 件`, product.product.listed ? '現在掲載中' : '最新の観測では未掲載');
  root.appendChild(grid);

  // Chart (lazy when supported).
  const box = doc.createElement('div');
  box.className = 'chart-box';
  root.appendChild(box);
  const start = product.observation.firstObservedAt ?? s.segmentStartAt;
  const end = product.observation.latestObservedAt ?? s.currentSinceAt;
  const draw = () => {
    if (box.childNodes.length > 0) return;
    box.appendChild(buildStepChart(doc, segment.points, segment.presence, { width: 640, height: 200, start, end, currency, label: basisLabel(segment.basis) }));
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
  } else {
    draw();
  }

  // Accessible table of change points.
  const details = doc.createElement('details');
  details.appendChild(text(doc, 'summary', `価格変更の一覧(${segment.points.length} 件)`));
  const table = doc.createElement('table');
  const head = doc.createElement('tr');
  head.appendChild(text(doc, 'th', '観測日時'));
  head.appendChild(text(doc, 'th', '価格'));
  table.appendChild(head);
  for (const p of [...segment.points].reverse()) {
    const tr = doc.createElement('tr');
    tr.appendChild(text(doc, 'td', formatDateTime(p[0])));
    tr.appendChild(text(doc, 'td', formatPriceValue({ state: p[1], minAmountMinor: p[2], maxAmountMinor: p[3] }, currency)));
    table.appendChild(tr);
  }
  details.appendChild(table);
  root.appendChild(details);
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
  if (list.childNodes.length > 0) root.appendChild(list);
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
export function renderPanel(ctx: PanelContext, shadow: ShadowRoot, state: LoadState, selectedSegment: number | null, onSelectSegment: (index: number) => void): void {
  const doc = ctx.doc;
  while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
  const style = doc.createElement('style');
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);
  const root = doc.createElement('section');
  root.className = 'eph';
  root.setAttribute('aria-label', PANEL_TITLE);
  const h2 = text(doc, 'h2', PANEL_TITLE);
  root.appendChild(h2);
  shadow.appendChild(root);

  const badge = (label: string, cls?: string) => {
    h2.appendChild(text(doc, 'span', label, `badge${cls ? ` ${cls}` : ''}`));
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
  const offer = product.offers[0];
  if (offer === undefined) {
    root.appendChild(text(doc, 'p', '価格の記録がありません。', 'muted'));
  } else {
    const picked = pickSegment(offer, selectedSegment);
    if (offer.segments.length > 1) {
      const select = doc.createElement('select');
      select.setAttribute('aria-label', '価格の種類');
      offer.segments.forEach((seg, i) => {
        const opt = doc.createElement('option');
        opt.value = String(i);
        opt.textContent = basisLabel(seg.basis);
        if (picked !== null && i === picked.index) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => onSelectSegment(Number(select.value)));
      root.appendChild(select);
    } else if (picked !== null) {
      root.appendChild(text(doc, 'p', basisLabel(picked.segment.basis), 'muted'));
    }
    if (picked !== null) renderSegment(ctx, root, product, offer, picked.segment);
    else root.appendChild(text(doc, 'p', '価格の記録がありません。', 'muted'));
  }
  const caveats: CaveatKey[] = [...(state.manifest?.caveats ?? []), ...product.caveats];
  if (product.product.metadata.some((m) => m.suspicious)) caveats.push('suspicious_identity');
  renderCaveats(doc, root, caveats);
  renderFooter(ctx, root, state.manifest, product, state);
}
