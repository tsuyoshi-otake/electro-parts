import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AvailabilityState } from '../../src/core/domain.ts';
import { cheapestComparable, orderStorePrices, storePriceRank, type RelatedEntry } from '../../userscript/core/relations.ts';
import { renderStorePrices, VISIBLE_STORE_PRICES } from '../../userscript/ui/related.ts';
import { comparisonFixture } from './comparison-fixtures.ts';

type Fixture = ReturnType<typeof comparisonFixture>;
interface Row { price: number; stock?: AvailabilityState; listed?: boolean; currency?: string; seenAt?: number; comparable?: boolean; loading?: boolean }

/** One verified same-product row for another store, built from the comparable fixture pair. */
function entryFor(f: Fixture, id: string, row: Row): RelatedEntry {
  const product = structuredClone(f.other);
  product.storeId = `store-${id}`; product.pageKey = id;
  const offer = product.offers[0]!;
  const segment = offer.segments[0]!;
  segment.stats.current = { state: 'exact', minAmountMinor: row.price, maxAmountMinor: row.price };
  segment.basis = { ...segment.basis, currency: row.currency ?? 'JPY' };
  const last = offer.availability[offer.availability.length - 1]!;
  offer.availability = [...offer.availability.slice(0, -1), [last[0], row.stock ?? 'in_stock', last[2], last[3], last[4]]];
  product.product.listed = row.listed ?? true;
  if (row.seenAt !== undefined) product.product.lastSeenAt = row.seenAt;
  const target = { ...f.relation.products[1], storeId: product.storeId, pageKey: id };
  const relation = { ...f.relation, id, products: [f.relation.products[0], target] as const, pricePolicy: row.comparable ? f.relation.pricePolicy : null };
  return { relation, sourceIndex: 0, target, state: row.loading ? { kind: 'loading' } : { kind: 'ready', product, manifest: null, freshness: 'fresh', storedAt: 1, note: null } };
}

const ids = (entries: readonly RelatedEntry[]) => entries.map((e) => e.relation.id);

describe('same-product store order (#55)', () => {
  it('puts yen stores first, in stock before restocking, out of stock and unlisted, cheaper first, and unloaded rows last', () => {
    const f = comparisonFixture();
    const entries = [
      entryFor(f, 'loading', { price: 1, loading: true }),
      entryFor(f, 'usd', { price: 500, currency: 'USD' }),
      entryFor(f, 'unlisted', { price: 800, listed: false }),
      entryFor(f, 'out', { price: 900, stock: 'out_of_stock' }),
      entryFor(f, 'restocking', { price: 1000, stock: 'restocking' }),
      entryFor(f, 'in1500', { price: 1500 }),
      entryFor(f, 'low1300', { price: 1300, stock: 'low_stock' }),
    ];
    expect(ids(orderStorePrices(entries))).toEqual(['low1300', 'in1500', 'restocking', 'out', 'unlisted', 'usd', 'loading']);
  });

  it('breaks a price tie by the newer observation, then keeps the input order', () => {
    const f = comparisonFixture();
    const seen = f.other.product.lastSeenAt;
    const entries = [
      entryFor(f, 'older', { price: 1000, seenAt: seen - 86_400_000 }),
      entryFor(f, 'first', { price: 1000, seenAt: seen }),
      entryFor(f, 'second', { price: 1000, seenAt: seen }),
    ];
    expect(ids(orderStorePrices(entries))).toEqual(['first', 'second', 'older']);
  });

  it('is a stable permutation that never ranks an unloaded row above a loaded one or a foreign quote above a yen quote', () => {
    const stocks: AvailabilityState[] = ['in_stock', 'low_stock', 'out_of_stock', 'restocking', 'preparing', 'checking', 'discontinued', 'unknown', 'not_displayed'];
    const row = fc.record({
      price: fc.integer({ min: 0, max: 100_000 }), stock: fc.constantFrom(...stocks), listed: fc.boolean(),
      currency: fc.constantFrom('JPY', 'USD', 'GBP'), loading: fc.boolean(),
    });
    fc.assert(fc.property(fc.array(row, { maxLength: 9 }), (rows) => {
      const f = comparisonFixture();
      const entries = rows.map((r, i) => entryFor(f, `r${i}`, r));
      const ordered = orderStorePrices(entries);
      expect([...ids(ordered)].sort()).toEqual([...ids(entries)].sort());
      const group = (e: RelatedEntry) => { const rank = storePriceRank(e); return !rank ? 3 : rank.currency === 'JPY' ? 0 : 1; };
      const groups = ordered.map(group);
      expect(groups).toEqual([...groups].sort((a, b) => a - b));
      for (let i = 1; i < ordered.length; i++) {
        const a = storePriceRank(ordered[i - 1]!); const b = storePriceRank(ordered[i]!);
        if (a && b && group(ordered[i - 1]!) === group(ordered[i]!)) expect(a.stockTier).toBeLessThanOrEqual(b.stockTier);
      }
      expect(orderStorePrices(ordered)).toEqual(ordered);
    }));
  });

  it('marks 最安 only on a comparable in-stock row that is not dearer than the viewed store', () => {
    const f = comparisonFixture();
    const own = f.segment.stats.current.minAmountMinor!;
    const cheaper = entryFor(f, 'cheaper', { price: own - 100, comparable: true });
    const cheapestReference = entryFor(f, 'reference', { price: own - 500 });
    const outOfStock = entryFor(f, 'out', { price: own - 300, comparable: true, stock: 'out_of_stock' });
    expect([...cheapestComparable(f.current, f.segment, [cheapestReference, outOfStock, cheaper])]).toEqual(['cheaper']);
    expect([...cheapestComparable(f.current, f.segment, [entryFor(f, 'dearer', { price: own + 100, comparable: true })])]).toEqual([]);
    expect([...cheapestComparable(f.current, f.segment, [cheapestReference])]).toEqual([]);
    const tieA = entryFor(f, 'tieA', { price: own, comparable: true });
    const tieB = entryFor(f, 'tieB', { price: own, comparable: true });
    expect([...cheapestComparable(f.current, f.segment, [tieA, tieB])]).toEqual(['tieA', 'tieB']);
  });
});

describe('same-product store rows in the panel (#55)', () => {
  const render = (entries: RelatedEntry[], f: Fixture, ownFresh = true) => {
    const parent = document.createElement('div');
    const lead = document.createElement('div');
    lead.className = 'current-price';
    renderStorePrices(document, parent, lead, f.current, f.segment, entries, (id: string) => id, ownFresh);
    return parent;
  };

  it(`shows the first ${VISIBLE_STORE_PRICES} rows and folds the rest under 他の店舗`, () => {
    const f = comparisonFixture();
    const parent = render([
      entryFor(f, 'e', { price: 1500 }), entryFor(f, 'd', { price: 1400 }), entryFor(f, 'usd', { price: 900, currency: 'USD' }),
      entryFor(f, 'c', { price: 1300, stock: 'out_of_stock' }), entryFor(f, 'b', { price: 1200 }),
    ], f);
    const visible = [...parent.querySelectorAll(':scope > .store-prices > .store-price')].map((r) => (r as HTMLElement).dataset['relationId']);
    expect(visible).toEqual(['b', 'd', 'e']);
    // The viewed store's card leads the same grid, so it wraps beside the other stores (#71).
    expect(parent.querySelector(':scope > .store-prices')!.firstElementChild!.className).toBe('current-price');
    const more = parent.querySelector<HTMLDetailsElement>(':scope > details.store-prices-more')!;
    expect(more.dataset['stateKey']).toBe('store-prices-more');
    expect(more.open).toBe(false);
    expect(more.querySelector('summary')!.textContent).toBe('他の店舗（2件）');
    expect([...more.querySelectorAll('.store-price')].map((r) => (r as HTMLElement).dataset['relationId'])).toEqual(['c', 'usd']);
    expect(more.querySelector('[data-relation-id="usd"]')!.textContent).toContain('送料・関税別');
    expect(parent.querySelector('.store-order')!.textContent).toBe('他店は在庫ありの店舗を先に、記録価格の安い順に表示しています。');
    expect(parent.textContent).not.toContain('最安');
  });

  it('shows one row without the order note or the fold, and the 最安 badge only with a fresh own record', () => {
    const f = comparisonFixture();
    const own = f.segment.stats.current.minAmountMinor!;
    const cheaper = [entryFor(f, 'cheaper', { price: own - 100, comparable: true })];
    const parent = render(cheaper, f);
    expect(parent.querySelector('.store-order')).toBeNull();
    expect(parent.querySelector('details.store-prices-more')).toBeNull();
    expect(parent.querySelector('[data-relation-id="cheaper"] .badge.cheapest')!.textContent).toBe('最安（比較条件を確認した店舗の記録価格）');
    expect(render(cheaper, f, false).querySelector('.badge.cheapest')).toBeNull();
  });

  it('keeps only the viewed store card when no verified same-product row exists', () => {
    const f = comparisonFixture();
    const candidate = entryFor(f, 'candidate', { price: 1000 });
    candidate.relation = { ...candidate.relation, reviewStatus: 'candidate' };
    const parent = render([candidate], f);
    expect([...parent.children].map((c) => c.className)).toEqual(['current-price']);
  });
});
