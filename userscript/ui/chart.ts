import type { PresencePointV1, PricePointV1 } from '../../src/publisher/contract.ts';
import { formatDate, formatMoney } from '../core/format.ts';

/**
 * Dependency-free SVG step chart of one price segment. A price stays in
 * effect until the next change point; a presence gap (`0`) suspends it, which
 * is drawn as a break in the line. Range prices draw the minimum as the line
 * and the min..max band as a translucent area.
 *
 * Everything is built with DOM APIs (no markup strings) so page content can
 * never be interpreted as HTML.
 */

export interface ChartOptions {
  width: number;
  height: number;
  /** Time range of the observation window; the last step extends to `end`. */
  start: number;
  end: number;
  currency: string;
  /** Extra summary appended to the accessible label. */
  label?: string;
}

interface Interval {
  from: number;
  to: number;
  min: number;
  max: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = { left: 56, right: 12, top: 10, bottom: 24 };

/** Splits the price change points into priced, listed intervals. Exported for tests. */
export function pricedIntervals(points: readonly PricePointV1[], presence: readonly PresencePointV1[], end: number): Interval[] {
  const out: Interval[] = [];
  const presentAt = (t: number): boolean => {
    let present = false;
    for (const [pt, p] of presence) {
      if (pt > t) break;
      present = p === 1;
    }
    return present;
  };
  const cuts = new Set<number>([end]);
  for (const [t] of points) cuts.add(t);
  for (const [t] of presence) cuts.add(t);
  const times = [...cuts].sort((a, b) => a - b);
  let price: PricePointV1 | null = null;
  let pi = 0;
  for (let i = 0; i < times.length - 1; i++) {
    const from = times[i] as number;
    const to = times[i + 1] as number;
    while (pi < points.length && (points[pi] as PricePointV1)[0] <= from) {
      price = points[pi] as PricePointV1;
      pi += 1;
    }
    if (price === null || price[1] === 'unavailable' || price[2] === null || price[3] === null) continue;
    if (!presentAt(from)) continue;
    if (to > end) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.to === from && last.min === price[2] && last.max === price[3]) last.to = to;
    else out.push({ from, to, min: price[2], max: price[3] });
  }
  return out;
}

function el<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (hi <= lo) return [lo];
  const rough = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** A `YYYY-MM-DD` at the axis font size, in viewBox units (measured: 56). */
const X_LABEL_WIDTH = 58;
/** Clear space required between two x-axis dates, in the same units. */
const X_LABEL_GAP = 12;

export function buildStepChart(doc: Document, points: readonly PricePointV1[], presence: readonly PresencePointV1[], options: ChartOptions): SVGSVGElement {
  const { width, height, start, end, currency } = options;
  // The price in effect at the last observation is drawn up to a short tail
  // past `end`, otherwise a change at the final observation would be
  // invisible. The tail is a drawing artifact, so it must stay a small
  // fraction of the width: a one-day floor consumed half the plot of a
  // two-observation window and dragged the end label into the start label.
  const tail = Math.max(3_600_000, (end - start) * 0.04);
  const drawEnd = end + tail;
  const intervals = pricedIntervals(points, presence, drawEnd);
  const svg = el(doc, 'svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img', class: 'eph-chart' });
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const span = Math.max(1, drawEnd - start);
  const x = (t: number) => PAD.left + ((t - start) / span) * plotW;

  const title = el(doc, 'title', {});
  if (intervals.length === 0) {
    title.textContent = '観測期間内に価格の記録はありません';
    svg.appendChild(title);
    svg.setAttribute('aria-label', title.textContent);
    const msg = el(doc, 'text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'eph-chart-empty' });
    msg.textContent = '価格の記録なし';
    svg.appendChild(msg);
    return svg;
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const iv of intervals) {
    lo = Math.min(lo, iv.min);
    hi = Math.max(hi, iv.max);
  }
  if (lo === hi) {
    lo = Math.max(0, lo * 0.9);
    hi = hi * 1.1 || 1;
  } else {
    const margin = (hi - lo) * 0.15;
    lo = Math.max(0, lo - margin);
    hi += margin;
  }
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const summary = `${formatDate(start)}〜${formatDate(end)} の価格推移。最低 ${formatMoney(Math.min(...intervals.map((i) => i.min)), currency)}、最高 ${formatMoney(Math.max(...intervals.map((i) => i.max)), currency)}、変更点 ${points.length} 件。${options.label ?? ''}`.trim();
  title.textContent = summary;
  svg.appendChild(title);
  svg.setAttribute('aria-label', summary);

  // Grid + y labels.
  for (const v of niceTicks(lo, hi, 4)) {
    const yy = y(v);
    svg.appendChild(el(doc, 'line', { x1: PAD.left, x2: width - PAD.right, y1: yy, y2: yy, class: 'eph-grid' }));
    const label = el(doc, 'text', { x: PAD.left - 6, y: yy + 4, 'text-anchor': 'end', class: 'eph-axis' });
    label.textContent = formatMoney(v, currency);
    svg.appendChild(label);
  }
  // x labels: first, middle, last -- but only those that stay readable. A
  // window a day or two wide puts all three within a few dozen units of each
  // other and repeats the same date, which rendered as one smear of glyphs.
  // The last change point sits well left of the right edge in that case, so
  // the labels have to be measured where they actually land, not spaced by
  // their anchor positions.
  let lastRight = -Infinity;
  let lastText = '';
  for (const t of [start, start + (end - start) / 2, end]) {
    const text = formatDate(t);
    const anchor = t === start ? 'start' : t === end ? 'end' : 'middle';
    const at = x(t);
    const left = anchor === 'start' ? at : anchor === 'end' ? at - X_LABEL_WIDTH : at - X_LABEL_WIDTH / 2;
    if (text === lastText || left < lastRight + X_LABEL_GAP) continue;
    const label = el(doc, 'text', { x: at, y: height - 6, 'text-anchor': anchor, class: 'eph-axis' });
    label.textContent = text;
    svg.appendChild(label);
    lastRight = left + X_LABEL_WIDTH;
    lastText = text;
  }

  // Range band (min..max) and step line (min).
  let band = '';
  let line = '';
  let prevTo: number | null = null;
  for (const iv of intervals) {
    const x0 = x(iv.from).toFixed(1);
    const x1 = x(iv.to).toFixed(1);
    const yMin = y(iv.min).toFixed(1);
    const yMax = y(iv.max).toFixed(1);
    if (iv.min !== iv.max) band += `M${x0} ${yMax}H${x1}V${yMin}H${x0}Z`;
    line += prevTo === iv.from ? `V${yMin}H${x1}` : `M${x0} ${yMin}H${x1}`;
    prevTo = iv.to;
  }
  if (band !== '') svg.appendChild(el(doc, 'path', { d: band, class: 'eph-band' }));
  svg.appendChild(el(doc, 'path', { d: line, class: 'eph-line', fill: 'none' }));

  // Gaps: dotted marker across unlisted stretches between intervals.
  for (let i = 1; i < intervals.length; i++) {
    const a = intervals[i - 1] as Interval;
    const b = intervals[i] as Interval;
    if (a.to < b.from) {
      svg.appendChild(el(doc, 'line', { x1: x(a.to), x2: x(b.from), y1: y(a.min), y2: y(a.min), class: 'eph-gap' }));
    }
  }
  // Change-point markers.
  for (const p of points) {
    if (p[1] === 'unavailable' || p[2] === null || p[0] < start || p[0] > end) continue;
    const dot = el(doc, 'circle', { cx: x(p[0]), cy: y(p[2]), r: 3, class: 'eph-dot' });
    const t = el(doc, 'title', {});
    t.textContent = `${formatDate(p[0])}: ${p[1] === 'range' && p[3] !== null && p[3] !== p[2] ? `${formatMoney(p[2], currency)}〜${formatMoney(p[3], currency)}` : formatMoney(p[2], currency)}`;
    dot.appendChild(t);
    svg.appendChild(dot);
  }
  return svg;
}
