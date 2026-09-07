import { describe, expect, it } from 'vitest';
import { CatalogFormatError, catalogPageUrl, parseCatalogPage, SWITCH_SCIENCE_BASE_URL } from '../../src/collectors/switch-science/catalog.ts';
import { shopifyProduct } from '../helpers/fakeShopifySite.ts';

const page = (products: unknown[]): unknown => ({ products });

describe('catalogPageUrl', () => {
  it('asks for one collection page at the size the caller configured', () => {
    expect(catalogPageUrl(SWITCH_SCIENCE_BASE_URL, 'all', 3, 250)).toBe(
      'https://www.switch-science.com/collections/all/products.json?limit=250&page=3',
    );
  });
});

describe('parseCatalogPage', () => {
  it('archives description and category evidence without treating it or the selling SKU as a manufacturer code', () => {
    const product = { ...shopifyProduct(1), body_html: '<p>Maker part ABX00062; 10 piece pack</p>', tags: ['Arduino', 'board', 42] };
    const item = parseCatalogPage(page([product]), 1).items[0]!;
    expect(item.descriptionHtml).toBe(product.body_html);
    expect(item.tags).toEqual(['Arduino', 'board']);
    expect(item).not.toHaveProperty('manufacturerProductCode');
    expect(parseCatalogPage(page([{...product, tags: ' Arduino, board, '}]), 1).items[0]!.tags).toEqual(['Arduino', 'board']);
    expect(parseCatalogPage(page([shopifyProduct(2)]), 1).items[0]).toMatchObject({descriptionHtml: null, tags: []});
  });
  it('reads the fields the domain needs and derives the product URL from the handle', () => {
    const parsed = parseCatalogPage(page([shopifyProduct(1, { handle: '9381', product_type: 'Cable' })]), 1);
    expect(parsed.rawCount).toBe(1);
    expect(parsed.unsupportedHandles).toEqual([]);
    expect(parsed.unparsablePrices).toBe(0);
    expect(parsed.items[0]).toMatchObject({
      handle: '9381',
      productId: 7_000_000_000_001,
      title: 'テスト部品 1',
      vendor: 'Test Vendor',
      productType: 'Cable',
      url: 'https://www.switch-science.com/products/9381',
      sourcePage: 1,
      positionOnPage: 1,
    });
    expect(parsed.items[0]?.variants[0]).toMatchObject({
      variantId: 42_000_000_000_001,
      sku: '9381',
      title: 'Default Title',
      priceYen: 100,
      priceRaw: '100',
      compareAtPriceYen: null,
      available: true,
      position: 1,
    });
  });

  it('keeps the raw price beside the parsed one, so an unparsable price is still evidence', () => {
    const odd = shopifyProduct(1, { variants: [{ ...shopifyProduct(1).variants[0]!, price: 'お問い合わせ' }] });
    const parsed = parseCatalogPage(page([odd]), 1);
    expect(parsed.unparsablePrices).toBe(1);
    expect(parsed.items[0]?.variants[0]).toMatchObject({ priceYen: null, priceRaw: 'お問い合わせ' });
  });

  it('reads compare-at when the store sends one and treats a missing one as no discount', () => {
    const base = shopifyProduct(1).variants[0]!;
    const discounted = shopifyProduct(1, { variants: [{ ...base, compare_at_price: '220' }] });
    expect(parseCatalogPage(page([discounted]), 1).items[0]?.variants[0]).toMatchObject({ compareAtPriceYen: 220, compareAtPriceRaw: '220' });
    const plain = shopifyProduct(1, { variants: [{ ...base, compare_at_price: null }] });
    expect(parseCatalogPage(page([plain]), 1).items[0]?.variants[0]).toMatchObject({ compareAtPriceYen: null, compareAtPriceRaw: null });
  });

  it('reads an absent availability flag as not purchasable, never as in stock', () => {
    const { available: _dropped, ...withoutFlag } = shopifyProduct(1).variants[0]!;
    const product = { ...shopifyProduct(1), variants: [withoutFlag] };
    expect(parseCatalogPage(page([product]), 1).items[0]?.variants[0]?.available).toBe(false);
  });

  it('falls back to the array order when a variant has no position', () => {
    const v = shopifyProduct(1).variants[0]!;
    const { position: _p, ...noPosition } = v;
    const product = { ...shopifyProduct(1), variants: [{ ...noPosition, id: 1 }, { ...noPosition, id: 2 }] };
    expect(parseCatalogPage(page([product]), 1).items[0]?.variants.map((x) => x.position)).toEqual([1, 2]);
  });

  it('drops a product whose handle could not be a page key, and says so', () => {
    const parsed = parseCatalogPage(page([shopifyProduct(1, { handle: 'Uppercase' }), shopifyProduct(2)]), 4);
    expect(parsed.rawCount).toBe(2);
    expect(parsed.items.map((i) => i.handle)).toEqual(['1002']);
    expect(parsed.unsupportedHandles).toEqual(['Uppercase']);
  });

  it('stops the run when the envelope is not what the API documents', () => {
    expect(() => parseCatalogPage(null, 1)).toThrow(CatalogFormatError);
    expect(() => parseCatalogPage({}, 1)).toThrow(/"products" is missing/);
    expect(() => parseCatalogPage({ products: {} }, 1)).toThrow(/not an array/);
    expect(() => parseCatalogPage(page(['nope']), 1)).toThrow(/products\[0\] is not an object/);
    expect(() => parseCatalogPage(page([{ ...shopifyProduct(1), handle: 5 }]), 1)).toThrow(/handle is not a string/);
    expect(() => parseCatalogPage(page([{ ...shopifyProduct(1), id: 'x' }]), 1)).toThrow(/id is not an integer/);
    expect(() => parseCatalogPage(page([{ ...shopifyProduct(1), title: null }]), 1)).toThrow(/title is not a string/);
    expect(() => parseCatalogPage(page([{ ...shopifyProduct(1), variants: [] }]), 1)).toThrow(/variants is missing or empty/);
    expect(() => parseCatalogPage(page([{ ...shopifyProduct(1), variants: [{ id: 1 }] }]), 1)).toThrow(/price is undefined/);
    expect(() => parseCatalogPage(page([{ ...shopifyProduct(1), variants: [{ price: '1' }] }]), 1)).toThrow(/id is not an integer/);
  });

  it('accepts an empty page: it is how the walk finds the end, not a format error', () => {
    expect(parseCatalogPage(page([]), 99)).toMatchObject({ items: [], rawCount: 0, unsupportedHandles: [], unparsablePrices: 0 });
  });
});
