import { describe, expect, it } from 'vitest';
import { RELATED_CSS, renderRelatedGroups, VISIBLE_RELATED_CARDS } from '../../userscript/ui/related.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { relatedEntries, type ProductRelation } from '../../userscript/core/relations.ts';

/**
 * The related groups (類似商品 and the candidate groups) lay their cards out like the store prices
 * (#95): the first VISIBLE_RELATED_CARDS in one wrapping grid, the rest folded in their own details.
 */
const PICO = 'akizuki';
const PICO_PAGE = '116132';
const picoRelations = () => PRODUCT_RELATIONS.filter((r) => r.products.some((p) => p.storeId === PICO && p.pageKey === PICO_PAGE));

/** `count` relations of one kind that each make a card of their own (no family, no difference to merge on). */
function unresolved(count: number): ProductRelation[] {
  const { similarity: _family, ...base } = PRODUCT_RELATIONS.find((r) => r.id === 'a116132-s8171')!;
  return Array.from({ length: count }, (_, i) => ({ ...base, id: `synthetic-${String(i).padStart(2, '0')}`, kind: 'unresolved' as const, reviewStatus: 'needs_review' as const, differences: [] }));
}

function render(relations: readonly ProductRelation[]): HTMLElement {
  const parent = document.createElement('div');
  renderRelatedGroups(document, parent, relatedEntries(relations, PICO, PICO_PAGE), (id) => id);
  return parent;
}

describe('related cards: top three in one grid, the rest folded', () => {
  it('shows the first three variants of the Pico family in a grid and folds the other four', () => {
    const parent = render(picoRelations());
    const section = parent.querySelector('details[data-state-key="group-similar"]')!;
    const titles = (root: Element) => [...root.querySelectorAll('.related-card')].map((c) => c.querySelector('.related-title')!.textContent);
    const grid = section.querySelector(':scope > .related-cards')!;
    expect(titles(grid)).toEqual(['Raspberry Pi Pico 2', 'Raspberry Pi Pico W', 'Raspberry Pi Pico H']);
    const more = section.querySelector<HTMLDetailsElement>(':scope > details[data-state-key="related-more-similar"]')!;
    expect(more.querySelector('summary')!.textContent).toBe('他の類似商品（4種類）');
    expect(more.open).toBe(false);
    expect(titles(more)).toEqual(['Raspberry Pi Pico 2W', 'Raspberry Pi Pico 2 H', 'Raspberry Pi Pico WH', 'Raspberry Pi Pico 2 WH']);
    // Folded cards stay in the document: every row keeps its link and evidence.
    expect(section.querySelectorAll('.related-card')).toHaveLength(7);
    expect(section.querySelectorAll('.related-offer')).toHaveLength(21);
    expect(section.querySelector('p.related-meta')!.textContent).toContain('近い順に上位3種類を表示し、残りは折りたたんでいます。');
  });

  it('does not fold a group of one card', () => {
    const parent = render([PRODUCT_RELATIONS.find((r) => r.id === 'a116132-s8171')!]);
    expect(parent.querySelectorAll('.related-card')).toHaveLength(1);
    expect(parent.querySelector('details[data-state-key="related-more-similar"]')).toBeNull();
    expect(parent.textContent).not.toContain('折りたたんでいます');
  });

  it('folds from the fourth card on, whatever the group', () => {
    const three = render(unresolved(VISIBLE_RELATED_CARDS));
    expect(three.querySelectorAll('.related-card')).toHaveLength(3);
    expect(three.querySelector('details[data-state-key="related-more-unresolved"]')).toBeNull();
    const four = render(unresolved(VISIBLE_RELATED_CARDS + 1));
    const more = four.querySelector('details[data-state-key="related-more-unresolved"]')!;
    expect(more.querySelector('summary')!.textContent).toBe('他の要確認の候補（1件）');
    expect(more.querySelectorAll('.related-card')).toHaveLength(1);
    expect(four.querySelectorAll(':scope > details > .related-cards:not(.related-more .related-cards) > .related-card')).toHaveLength(3);
  });

  it('keeps the order: the cards of the grid come before the folded ones in closest-first order', () => {
    const parent = render(unresolved(6));
    const ids = [...parent.querySelectorAll('.related-offer')].map((row) => (row as HTMLElement).dataset['relationId']);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(6);
    expect(VISIBLE_RELATED_CARDS).toBe(3);
  });

  it('uses the same column rule as the store prices, so the two lists wrap alike', () => {
    expect(RELATED_CSS).toMatch(/\.eph \.store-prices, \.eph \.related-cards \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(200px, 100%\), 1fr\)\);/);
    // A card has no divider of its own between siblings any more: the grid gap spaces them and each card has a top rule.
    expect(RELATED_CSS).not.toContain('.related-card + .related-card');
  });
});
