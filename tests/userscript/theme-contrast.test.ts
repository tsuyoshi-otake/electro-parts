import { describe, expect, it } from 'vitest';
import { PAGE_ADAPTERS } from '../../userscript/adapters/registry.ts';
import { PANEL_CSS } from '../../userscript/ui/panel.ts';
import { RELATED_CSS } from '../../userscript/ui/related.ts';

/** WCAG 2.x contrast ratio of two `#rrggbb` colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = (hex.slice(1).match(/../g) ?? []).map((part) => {
      const v = parseInt(part, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The custom properties declared in the first rule whose selector is exactly `selector`. */
function tokens(css: string, selector: string): Record<string, string> {
  const rule = css.split('}').find((chunk) => chunk.split('{')[0]?.trim() === selector);
  expect(rule, selector).toBeDefined();
  const full = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((d) => d + d).join('')}` : hex).toLowerCase();
  return Object.fromEntries([...(rule as string).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g)].map((m) => [m[1], full(m[2]!)]));
}

const PAGE_BASE = '#3e3e3e';
const TEXT = ['--fg', '--muted', '--accent', '--up', '--down'];

describe('panel palette contrast (WCAG AA, 4.5:1 for text)', () => {
  const light = tokens(PANEL_CSS, '.eph');
  const dark = { ...light, ...tokens(PANEL_CSS, '.eph[data-theme="dark"]') };

  it.each([['light', light], ['dark', dark]])('%s text tokens against the panel background', (_name, palette) => {
    for (const name of TEXT) expect(contrast(palette[name]!, palette['--bg']!), name).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the page base as the dark background and keeps every dark pair legible', () => {
    expect(dark['--bg']).toBe(PAGE_BASE);
    expect(contrast(dark['--chip-fg']!, dark['--chip']!)).toBeGreaterThanOrEqual(4.5);
    // The pressed theme button: accent text on the chip background.
    expect(contrast(dark['--accent']!, dark['--chip']!)).toBeGreaterThanOrEqual(4.5);
    for (const index of ['1', '2', '3']) {
      const series = tokens(RELATED_CSS, `.eph[data-theme="dark"] [data-series-index="${index}"]`)['--accent']!;
      expect(contrast(series, dark['--bg']!), `series ${index}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws dark dividers lighter than the background so they stay visible', () => {
    const lum = (hex: string) => parseInt(hex.slice(1), 16);
    for (const name of ['--line', '--line-soft']) expect(lum(dark[name]!), name).toBeGreaterThan(lum(dark['--bg']!));
    expect(contrast(dark['--line']!, dark['--bg']!)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('page theme text colors against the page base', () => {
  it.each(PAGE_ADAPTERS.map((a) => [a.storeId, a.pageThemeCss ?? ''] as const))('%s', (_storeId, css) => {
    expect(css).not.toBe('');
    const declarations = css.split('}').flatMap((rule) => {
      const [selector = '', body = ''] = rule.split('{');
      // Disabled controls are exempt from WCAG contrast.
      if (selector.includes(':disabled')) return [];
      return [...body.matchAll(/(?<![-\w])color:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [selector.trim(), m[1]!] as const);
    });
    expect(declarations.length).toBeGreaterThan(0);
    for (const [selector, color] of declarations) expect(contrast(color, PAGE_BASE), `${selector} ${color}`).toBeGreaterThanOrEqual(4.5);
  });
});
