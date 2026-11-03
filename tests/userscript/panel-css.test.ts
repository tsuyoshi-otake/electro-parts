import { describe, expect, it } from 'vitest';
import { PANEL_CSS } from '../../userscript/ui/panel.ts';

/** Every qualified rule with the at-rule preludes around it, outermost first. */
function rules(css: string): { selector: string; within: string[]; body: string }[] {
  const found: { selector: string; within: string[]; body: string }[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') {
      const prelude = css.slice(start, i).trim();
      if (prelude.startsWith('@')) stack.push(prelude);
      else {
        const end = css.indexOf('}', i);
        found.push({ selector: prelude, within: [...stack], body: css.slice(i + 1, end) });
        i = end;
      }
      start = i + 1;
    } else if (css[i] === '}') {
      stack.pop();
      start = i + 1;
    } else if (css[i] === ';' && css.slice(start, i).trim().startsWith('@')) {
      start = i + 1;
    }
  }
  return found;
}

describe('panel stylesheet', () => {
  it('has rules to check', () => {
    expect(rules(PANEL_CSS).length).toBeGreaterThan(100);
  });

  it('keeps every text size at 12px or more', () => {
    const sizes = [...PANEL_CSS.matchAll(/font(?:-size)?:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(20);
    expect(sizes.filter((size) => size < 12)).toEqual([]);
  });

  it('applies hover styles only where the pointer can hover, so a tap leaves no highlight on touch screens', () => {
    const hovers = rules(PANEL_CSS).filter((rule) => rule.selector.includes(':hover'));
    expect(hovers.length).toBeGreaterThanOrEqual(3);
    for (const rule of hovers) expect(rule.within, rule.selector).toContain('@media (hover: hover)');
  });

  it('sets the panel text properties on .eph itself, where page CSS on the host cannot reach', () => {
    const eph = rules(PANEL_CSS).find((rule) => rule.selector === '.eph' && rule.within.length === 0);
    expect(eph).toBeDefined();
    const declarations = eph!.body.split(';').map((d) => d.trim()).filter(Boolean);
    // `all: initial` first drops what the host inherited; the declarations after it rebuild the panel.
    expect(declarations[0]).toBe('all: initial');
    expect(declarations).toContain('display: block');
    expect(declarations.find((d) => d.startsWith('font:'))).toMatch(/^font: 13px\/1\.6 system-ui, /);
    expect(declarations).toContain('text-size-adjust: 100%');
    expect(declarations).toContain('-webkit-text-size-adjust: 100%');
  });
});
