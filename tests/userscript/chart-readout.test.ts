import { describe, expect, it } from 'vitest';
import type { PresencePointV1, PricePointV1 } from '../../src/publisher/contract.ts';
import { buildComparisonChart, buildInventoryChart, buildStepChart, type InventorySeries } from '../../userscript/ui/chart.ts';
import { formatDate } from '../../userscript/core/format.ts';

const D = 86_400_000;
const t = (day: number) => 1_800_000_000_000 + day * D;

/** The chart drawn at twice its viewBox size, 10 px from the left of the page. */
const SCALE = 2;
const OFFSET = 10;

function onPage(svg: SVGSVGElement): SVGSVGElement {
  const [, , w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number) as [number, number, number, number];
  svg.getBoundingClientRect = () => ({ left: OFFSET, top: 0, x: OFFSET, y: 0, width: w * SCALE, height: h * SCALE, right: OFFSET + w * SCALE, bottom: h * SCALE, toJSON: () => ({}) });
  document.body.appendChild(svg);
  return svg;
}

function pointer(svg: SVGSVGElement, type: string, px: number, pointerType = 'mouse'): void {
  const event = new MouseEvent(type, { clientX: OFFSET + px * SCALE, bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  svg.querySelector('.eph-readout-hit')!.dispatchEvent(event);
}

const lines = (svg: SVGSVGElement) => [...svg.querySelectorAll('.eph-readout-text')].map((n) => n.textContent);
/** Markers on the plot, not the swatches inside the label. */
const markers = (svg: SVGSVGElement) => [...svg.querySelectorAll<SVGCircleElement>('.eph-readout > g > .eph-readout-marker')];
const guideX = (svg: SVGSVGElement) => Number(svg.querySelector('.eph-readout-guide')!.getAttribute('x1'));
const labelX = (svg: SVGSVGElement) => Number(/translate\(([\d.]+)/.exec(svg.querySelector('.eph-readout-label')!.getAttribute('transform')!)![1]);

/** The x of time `at`, from two drawn dots: the readout must agree with the drawing, not with a copy of the scale. */
function scaleFrom(a: SVGCircleElement, ta: number, b: SVGCircleElement, tb: number) {
  const xa = Number(a.getAttribute('cx'));
  const xb = Number(b.getAttribute('cx'));
  return (at: number) => xa + (at - ta) * (xb - xa) / (tb - ta);
}

describe('pointer readout on the single-store price chart (#76)', () => {
  const points: PricePointV1[] = [[t(0), 'exact', 100, 100], [t(6), 'range', 90, 110]];
  const presence: PresencePointV1[] = [[t(0), 1], [t(2), 0], [t(3), 1]];
  const chart = () => {
    const svg = onPage(buildStepChart(document, points, presence, { width: 640, height: 200, start: t(0), end: t(8), currency: 'JPY' }));
    const [d0, d6] = [...svg.querySelectorAll<SVGCircleElement>('circle.eph-dot')] as [SVGCircleElement, SVGCircleElement];
    return { svg, d0, d6, x: scaleFrom(d0, t(0), d6, t(6)) };
  };

  it('adds nothing visible until the pointer is over the plot', () => {
    const { svg } = chart();
    expect(svg.querySelector('.eph-readout')!.childNodes).toHaveLength(0);
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
    // The summary is the accessible name; no root <title> to pop over the readout.
    expect([...svg.children].some((c) => c.tagName === 'title')).toBe(false);
    expect(svg.getAttribute('aria-label')).toContain('変更点 2 件');
  });

  it('reads the price in effect where the line is, with a marker on it', () => {
    const { svg, d0, d6, x } = chart();
    pointer(svg, 'pointermove', x(t(1)));
    expect(lines(svg)).toEqual([formatDate(t(1)), '￥100']);
    expect(markers(svg).map((m) => m.getAttribute('cy'))).toEqual([d0.getAttribute('cy')]);
    expect(guideX(svg)).toBeCloseTo(x(t(1)), 1);
    pointer(svg, 'pointermove', x(t(7)));
    // A range reads as both ends; the marker sits on the line, which is the minimum.
    expect(lines(svg)).toEqual([formatDate(t(7)), '￥90〜￥110']);
    expect(markers(svg).map((m) => m.getAttribute('cy'))).toEqual([d6.getAttribute('cy')]);
  });

  it('says so where the line is broken and draws no marker there', () => {
    const { svg, x } = chart();
    pointer(svg, 'pointermove', x(t(2.5)));
    expect(lines(svg)).toEqual([formatDate(t(2.5)), '価格の記録なし']);
    expect(markers(svg)).toHaveLength(0);
  });

  it('stops at the last observation: the tail after it is drawing only', () => {
    const { svg, x } = chart();
    pointer(svg, 'pointermove', 639);
    expect(lines(svg)).toEqual([formatDate(t(8)), '￥90〜￥110']);
    expect(guideX(svg)).toBeCloseTo(x(t(8)), 1);
  });

  it('reads a dot when the pointer is just off it', () => {
    const { svg, d6 } = chart();
    pointer(svg, 'pointermove', Number(d6.getAttribute('cx')) - 3);
    expect(lines(svg)[1]).toBe('￥90〜￥110');
  });

  it('puts the label right of the guide, or left of it near the right edge', () => {
    const { svg, x } = chart();
    pointer(svg, 'pointermove', x(t(1)));
    expect(labelX(svg)).toBeGreaterThan(guideX(svg));
    pointer(svg, 'pointermove', x(t(7.5)));
    expect(labelX(svg)).toBeLessThan(guideX(svg));
  });

  it('clears on leave for a mouse but keeps a tapped readout', () => {
    const { svg, x } = chart();
    pointer(svg, 'pointermove', x(t(1)));
    pointer(svg, 'pointerleave', x(t(1)));
    expect(svg.querySelector('.eph-readout')!.childNodes).toHaveLength(0);
    pointer(svg, 'pointerdown', x(t(1)), 'touch');
    pointer(svg, 'pointerleave', x(t(1)), 'touch');
    expect(lines(svg)).toEqual([formatDate(t(1)), '￥100']);
  });

  it('draws no readout on an empty chart', () => {
    const svg = buildStepChart(document, [[t(0), 'unavailable', null, null]], [[t(0), 1]], { width: 640, height: 200, start: t(0), end: t(8), currency: 'JPY' });
    expect(svg.querySelector('.eph-readout-hit')).toBeNull();
  });
});

describe('pointer readout on the store comparison chart (#76)', () => {
  const chart = () => {
    const svg = onPage(buildComparisonChart(document, [
      { id: 'a', label: 'A', start: t(0), end: t(8), points: [[t(0), 'exact', 100, 100], [t(8), 'exact', 110, 110]], presence: [[t(0), 1]] },
      { id: 'b', label: 'B', start: t(0), end: t(4), points: [[t(0), 'exact', 120, 120]], presence: [[t(0), 1]] },
      { id: 'c', label: 'C', start: t(5), end: t(5), points: [[t(5), 'exact', 130, 130]], presence: [[t(5), 1]] },
    ], { width: 640, height: 200, currency: 'JPY' }));
    const a = [...svg.querySelectorAll<SVGCircleElement>('g[data-series="a"] circle')] as [SVGCircleElement, SVGCircleElement];
    return { svg, x: scaleFrom(a[0], t(0), a[1], t(8)) };
  };

  it('names each store, in its color, and says when a store was not observed', () => {
    const { svg, x } = chart();
    pointer(svg, 'pointermove', x(t(2)));
    expect(lines(svg)).toEqual([formatDate(t(2)), 'A ￥100', 'B ￥120', 'C 観測期間外']);
    expect(markers(svg).map((m) => m.parentElement!.getAttribute('data-series-index'))).toEqual(['0', '1']);
    expect([...svg.querySelectorAll('.eph-readout-label [data-series-index]')].map((g) => g.getAttribute('data-series-index'))).toEqual(['0', '1', '2']);
    pointer(svg, 'pointermove', x(t(6)));
    expect(lines(svg)).toEqual([formatDate(t(6)), 'A ￥100', 'B 観測期間外', 'C 観測期間外']);
  });

  it('reads a one-observation store at its dot', () => {
    const { svg, x } = chart();
    pointer(svg, 'pointermove', x(t(5)));
    expect(lines(svg)).toContain('C ￥130');
  });

  it('leaves out stores hidden by the store switches', () => {
    const { svg, x } = chart();
    svg.querySelector<SVGGElement>('g[data-series="b"]')!.style.display = 'none';
    pointer(svg, 'pointermove', x(t(2)));
    expect(lines(svg)).toEqual([formatDate(t(2)), 'A ￥100', 'C 観測期間外']);
    for (const id of ['a', 'c']) svg.querySelector<SVGGElement>(`g[data-series="${id}"]`)!.style.display = 'none';
    pointer(svg, 'pointermove', x(t(2)));
    expect(svg.querySelector('.eph-readout')!.childNodes).toHaveLength(0);
  });
});

describe('pointer readout on the stock count chart (#76)', () => {
  const series = (points: [number, number | null][], extra: Partial<InventorySeries> = {}): InventorySeries =>
    ({ id: 'current', label: 'Store A', index: 0, points, start: t(0), end: t(9), ...extra });

  it('reads the count in effect, the cap as a lower bound, and the gaps', () => {
    const svg = onPage(buildInventoryChart(document, [series([[t(0), 20], [t(3), null], [t(5), 100]], { cappedAt: 100 })], { width: 640, height: 120 }));
    const [d0, d5] = [...svg.querySelectorAll<SVGCircleElement>('circle.eph-dot')] as [SVGCircleElement, SVGCircleElement];
    const x = scaleFrom(d0, t(0), d5, t(5));
    pointer(svg, 'pointermove', x(t(1)));
    expect(lines(svg)).toEqual([formatDate(t(1)), '在庫数 20']);
    expect(markers(svg).map((m) => m.getAttribute('cy'))).toEqual([d0.getAttribute('cy')]);
    pointer(svg, 'pointermove', x(t(4)));
    expect(lines(svg)).toEqual([formatDate(t(4)), '在庫数の記録なし']);
    pointer(svg, 'pointermove', x(t(7)));
    expect(lines(svg)).toEqual([formatDate(t(7)), '在庫数 100+']);
  });

  it('keeps the label inside the short chart', () => {
    const svg = onPage(buildInventoryChart(document, [
      series([[t(0), 5]]),
      series([[t(0), 8]], { id: 'b', label: 'Store B', index: 1 }),
      series([[t(0), 9]], { id: 'c', label: 'Store C', index: 2 }),
      series([[t(0), 7]], { id: 'd', label: 'Store D', index: 3 }),
    ], { width: 640, height: 110 }));
    pointer(svg, 'pointermove', 300);
    expect(lines(svg)).toHaveLength(5);
    const bg = svg.querySelector('.eph-readout-bg')!;
    const top = Number(/translate\([\d.]+ ([\d.]+)\)/.exec(svg.querySelector('.eph-readout-label')!.getAttribute('transform')!)![1]);
    expect(top + Number(bg.getAttribute('height'))).toBeLessThanOrEqual(110);
  });
});
