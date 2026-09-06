/**
 * Round-trip property: any listing rendered in the site's markup is parsed
 * back exactly — names with entities and odd whitespace, thousands separators,
 * stacked status badges, missing model numbers, unpurchasable items.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAkizukiListingPage } from '../../src/collectors/akizuki/listingParser.ts';
import { renderListingPage, type SyntheticListing } from '../helpers/akizukiHtml.ts';

const seed = Number(process.env['FC_SEED'] ?? 20260906);
const numRuns = Number(process.env['FC_RUNS'] ?? 150);

/** Visible text without leading/trailing/double whitespace (the parser normalises whitespace). */
const text = (min: number, max: number) =>
  fc
    .stringMatching(/^[A-Za-z0-9&<>"'()/+.\-ぁ-んァ-ン一-龥ー ]+$/)
    .filter((s) => s.length >= min && s.length <= max && s === s.replace(/\s+/g, ' ').trim());

const statusArb = fc.constantFrom('在庫あり', '在庫僅少', '入荷未定', '販売終了', '納期確認中', '在庫あり 10月上旬入荷予定', '12月下旬入荷予定');

const listingArb: fc.Arbitrary<SyntheticListing> = fc
  .record({
    salesCode: fc.integer({ min: 1, max: 999_999_999_999 }).map(String),
    name: text(1, 60),
    modelNumber: fc.option(text(1, 30), { nil: null }),
    category: fc.option(text(1, 30), { nil: null }),
    priceYen: fc.option(fc.integer({ min: 1, max: 9_999_999 }), { nil: null }),
    unit: fc.constantFrom('1個', '1セット', '1台', '1本', '1枚', '10個入'),
    statuses: fc.uniqueArray(statusArb, { minLength: 1, maxLength: 3 }),
    purchasable: fc.boolean(),
    availableQuantity: fc.option(fc.integer({ min: 0, max: 99_999 }), { nil: null }),
    quantityUnit: fc.constantFrom('個', 'セット', '台', 'パック'),
  })
  .map((l) => (l.purchasable && l.availableQuantity === null ? { ...l, availableQuantity: 1 } : l))
  .map((l) => (!l.purchasable ? { ...l, availableQuantity: null } : l));

const pageArb = fc
  .record({
    slug: fc.stringMatching(/^r[a-z0-9]{1,8}$/),
    genreName: text(1, 30),
    current: fc.integer({ min: 1, max: 5 }),
    extra: fc.integer({ min: 0, max: 4 }),
    items: fc.uniqueArray(listingArb, { minLength: 0, maxLength: 12, selector: (l) => l.salesCode }),
  })
  .map((p) => ({ ...p, last: p.current + p.extra }));

describe('listing parser round trip (property)', () => {
  it('recovers every field of every rendered item', () => {
    fc.assert(
      fc.property(pageArb, (p) => {
        const listedTotal = p.items.length === 0 ? 0 : p.items.length + 3;
        const html = renderListingPage({ genreSlug: p.slug, genreName: p.genreName, listedTotal, currentPage: p.current, lastPage: p.last, items: p.items });
        const page = parseAkizukiListingPage(html);
        expect(page.genreName).toBe(p.genreName);
        expect(page.listedTotal).toBe(listedTotal);
        expect(page.currentPage).toBe(p.current);
        expect(page.lastPage).toBe(p.last);
        expect(page.nextPath).toBe(p.current < p.last ? (p.current + 1 === 1 ? `/catalog/r/${p.slug}/` : `/catalog/r/${p.slug}_p${p.current + 1}/`) : null);
        expect(page.issues.filter((i) => !i.includes('no price block'))).toEqual([]);
        expect(page.items).toHaveLength(p.items.length);
        page.items.forEach((item, i) => {
          const src = p.items[i]!;
          expect(item.salesCode).toBe(src.salesCode);
          expect(item.name).toBe(src.name);
          expect(item.modelNumber).toBe(src.modelNumber);
          expect(item.category).toBe(src.category);
          expect(item.url).toBe(`https://akizukidenshi.com/catalog/g/g${src.salesCode}/`);
          expect(item.positionOnPage).toBe(i + 1);
          if (src.priceYen === null) {
            expect(item.prices).toEqual([]);
          } else {
            expect(item.prices).toEqual([{ amountYen: src.priceYen, display: `￥${src.priceYen.toLocaleString('en-US')}(税込)`, quantityUnit: src.unit, taxIncluded: true }]);
          }
          expect(item.stock.status).toBe(src.statuses.join(' / '));
          expect(item.stock.purchasable).toBe(src.purchasable);
          if (src.purchasable) {
            expect(item.stock.availableQuantity).toBe(src.availableQuantity);
            expect(item.stock.quantityUnit).toBe(src.quantityUnit);
            expect(item.stock.quantityDisplay).toBe(`${src.availableQuantity}${src.quantityUnit}`);
          } else {
            expect(item.stock).toMatchObject({ availableQuantity: null, quantityUnit: null, quantityDisplay: null });
          }
        });
      }),
      { seed, numRuns, verbose: true },
    );
  });
});
