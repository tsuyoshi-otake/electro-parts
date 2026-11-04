/**
 * Pointer readout shared by the SVG charts (#76). While the pointer is over
 * the plot it draws a vertical guide, a marker where each visible line is at
 * that time, and a label with the time and each line's value there.
 *
 * The chart that attaches it supplies its own scale and what each line's
 * value is; this module knows only the plot box, the pointer and the label
 * layout. The readout is rebuilt on every move and emptied on leave, so a
 * chart at rest carries no extra marks. Built with DOM APIs only.
 */

export interface ReadoutValue {
  text: string;
  /** Where the line is drawn at that time, in viewBox units; absent where nothing is drawn. */
  y?: number;
}

export interface ReadoutLine {
  label: string;
  /** Color slot, the line's `data-series-index`. */
  index: number;
  /** The line's group. A group hidden by the store switches is left out of the readout. */
  group?: SVGGElement;
  /** `tolerance` is the time the pointer may be off a dot and still read that dot. */
  valueAt(t: number, tolerance: number): ReadoutValue;
}

export interface ReadoutSpec {
  /** The viewBox size. */
  width: number;
  height: number;
  /** The plot box in viewBox units; the pointer is read only inside it. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The time range the readout covers; a pointer outside it reads the nearest end. */
  start: number;
  end: number;
  x(t: number): number;
  time(x: number): number;
  timeText(t: number): string;
  lines: readonly ReadoutLine[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const LINE_HEIGHT = 15;
const PAD_X = 6;
const PAD_Y = 4;
/** Room for the color swatch in front of a named row. */
const SWATCH = 12;
/** Space between the guide and the label. */
const GAP = 10;
/** How far, in viewBox units, the pointer may be off a dot and still read it. */
const SNAP = 4;

export function attachReadout(doc: Document, svg: SVGSVGElement, spec: ReadoutSpec): void {
  const layer = el(doc, 'g', { class: 'eph-readout', 'aria-hidden': 'true', 'pointer-events': 'none' });
  const hit = el(doc, 'rect', {
    class: 'eph-readout-hit', x: spec.left, y: spec.top, width: Math.max(0, spec.right - spec.left), height: Math.max(0, spec.bottom - spec.top),
    fill: 'transparent', 'pointer-events': 'all', 'aria-hidden': 'true',
  });
  svg.append(layer, hit);
  const show = (event: MouseEvent) => {
    const box = svg.getBoundingClientRect();
    if (!(box.width > 0)) return;
    render(doc, layer, spec, (event.clientX - box.left) * spec.width / box.width);
  };
  hit.addEventListener('pointermove', show);
  // A tap shows the readout too. Touch pointers leave on lift, so a tapped
  // readout stays until the next tap instead of vanishing at once.
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', (event) => {
    if ((event as PointerEvent).pointerType !== 'touch') layer.replaceChildren();
  });
}

function render(doc: Document, layer: SVGGElement, spec: ReadoutSpec, px: number): void {
  layer.replaceChildren();
  const visible = spec.lines.filter((line) => line.group?.style.display !== 'none');
  if (visible.length === 0) return;
  const t = Math.min(spec.end, Math.max(spec.start, spec.time(px)));
  const gx = spec.x(t);
  const tolerance = Math.abs(spec.time(px + SNAP) - spec.time(px));
  const rows = visible.map((line) => ({ line, value: line.valueAt(t, tolerance) }));
  layer.appendChild(el(doc, 'line', { class: 'eph-readout-guide', x1: gx, x2: gx, y1: spec.top, y2: spec.bottom }));
  for (const { line, value } of rows) {
    if (value.y === undefined) continue;
    const slot = el(doc, 'g', { 'data-series-index': line.index });
    slot.appendChild(el(doc, 'circle', { class: 'eph-readout-marker', cx: gx, cy: value.y, r: 4 }));
    layer.appendChild(slot);
  }

  // One store needs no name in front of its value.
  const named = spec.lines.length > 1;
  const label = el(doc, 'g', { class: 'eph-readout-label' });
  const bg = el(doc, 'rect', { class: 'eph-readout-bg', rx: 4 });
  label.appendChild(bg);
  layer.appendChild(label);
  const texts: SVGTextElement[] = [];
  const addText = (content: string, className: string, x: number) => {
    const node = el(doc, 'text', { class: className, x, y: PAD_Y + LINE_HEIGHT * (texts.length + 1) - 3 });
    node.textContent = content;
    label.appendChild(node);
    texts.push(node);
    return node;
  };
  addText(spec.timeText(t), 'eph-readout-text eph-readout-time', PAD_X);
  for (const { line, value } of rows) {
    const node = addText(named ? `${line.label} ${value.text}` : value.text, 'eph-readout-text', named ? PAD_X + SWATCH : PAD_X);
    if (!named) continue;
    const slot = el(doc, 'g', { 'data-series-index': line.index });
    slot.appendChild(el(doc, 'circle', { class: 'eph-readout-marker', cx: PAD_X + 4, cy: Number(node.getAttribute('y')) - 4, r: 3.5 }));
    label.insertBefore(slot, node);
  }
  const w = Math.max(...texts.map((node) => Number(node.getAttribute('x')) + textWidth(node))) + PAD_X;
  const h = texts.length * LINE_HEIGHT + PAD_Y * 2;
  bg.setAttribute('width', w.toFixed(1));
  bg.setAttribute('height', String(h));
  // Right of the guide, or left of it where the right side has no room.
  let lx = gx + GAP;
  if (lx + w > spec.width - 2) lx = gx - GAP - w;
  lx = Math.max(2, lx);
  const ly = Math.max(2, Math.min(spec.top, spec.height - h - 2));
  label.setAttribute('transform', `translate(${lx.toFixed(1)} ${ly.toFixed(1)})`);
}

/** The laid-out width, or an estimate at the 12px label font where nothing is laid out. */
function textWidth(node: SVGTextElement): number {
  try {
    const measured = node.getComputedTextLength();
    if (measured > 0) return measured;
  } catch {
    // Not laid out (no layout engine): estimate below.
  }
  let width = 0;
  for (const ch of node.textContent ?? '') width += ch.charCodeAt(0) > 0xff ? 12 : 7;
  return width;
}

function el<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
