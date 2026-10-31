import { describe, expect, it } from 'vitest';
import { DEFAULT_OFFER_ID } from '../../src/core/domain.ts';
import { isSengokuCode, sengokuProductUrl } from '../../src/adapters/sengoku/identity.ts';
import type { SengokuItem, SengokuSnapshot } from '../../src/adapters/sengoku/rawSchema.ts';
import {
  SENGOKU_CAPABILITIES, normalizeAvailability, normalizeSengokuItem, sengokuSnapshotAdapter, sengokuUnitLabel, validateSengokuRaw,
} from '../../src/adapters/sengoku/snapshotAdapter.ts';
import { sengokuCollectorConfig, sengokuListingUrl } from '../../src/collectors/sengoku/collector.ts';
import { SengokuPageError, parseSengokuCategoryTree, parseSengokuListingPage, withoutDescriptions } from '../../src/collectors/sengoku/pages.ts';
import { getStoreCollector } from '../../src/stores/collectorRegistry.ts';
import { getStoreAdapter } from '../../src/stores/registry.ts';
import { SENGOKU_RETRIEVED_AT, collectSengokuFixture, sengokuFixture, sengokuRows, syntheticSengokuShop } from '../helpers/sengoku.ts';

const LISTING = (cid: number, st = 0) => sengokuListingUrl(cid, st);

describe('Sengoku identity', () => {
  it('accepts management codes and builds the detail URL from them only', () => {
    for (const code of ['EEHD-6N43', '7AN4-EEE6', 'EEHD-4WJH']) expect(isSengokuCode(code), code).toBe(true);
    for (const code of ['', 'eehd-6n43', 'EEHD_6N43', 'EEHD-6N43&x=1', '-EEHD', 'EEHD-', 'A-B-C-D-E']) expect(isSengokuCode(code), code).toBe(false);
    expect(sengokuProductUrl('EEHD-6N43')).toBe('https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-6N43');
    expect(() => sengokuProductUrl('x')).toThrow();
  });
});

describe('Sengoku category page', () => {
  it('reads the three levels under 電子工作部品 from the saved page', () => {
    const tree = parseSengokuCategoryTree(sengokuFixture('category-3000.html'), 3000);
    expect(tree).toHaveLength(31);
    expect(tree.reduce((n, t) => n + t.children.length, 0)).toBe(235);
    expect(tree.reduce((n, t) => n + t.children.reduce((k, c) => k + c.children.length, 0), 0)).toBe(396);
    const passive = tree.find((t) => t.cid === 3137)!;
    expect(passive.name).toBe('コイル・コンデンサ・抵抗');
    expect(passive.children.map((c) => [c.cid, c.name])).toEqual([[3138, 'コイル(インダクタ)'], [3140, 'コンデンサ'], [3309, '抵抗']]);
    expect(tree.find((t) => t.cid === 5871)).toMatchObject({ name: '真空管', children: [] });
  });

  it('refuses a main area that no longer matches the side menu', () => {
    const html = sengokuFixture('category-3000.html');
    const dropped = html.replace('<div class="category_sub" data-parent-cid="3000"><a href="/mod/sgk_cart/search.php?cid=5871">真空管</a></div>', '');
    expect(() => parseSengokuCategoryTree(dropped, 3000)).toThrow(/side menu lists 30 categories and the main area 31/);
    expect(() => parseSengokuCategoryTree(html, 5993)).toThrow(SengokuPageError);
    expect(() => parseSengokuCategoryTree(html.replace('<div id="main">', '<div id="content">'), 3000)).toThrow(/no main area/);
    const orphan = html.replace('<div id="main">', '<div id="main">\n<p>・<a href="/mod/sgk_cart/search.php?cid=1">x</a></p>');
    expect(() => parseSengokuCategoryTree(orphan, 3000)).toThrow(/before any ■ category/);
  });
});

describe('Sengoku listing page', () => {
  it('reads the counter and the facts of each saved row', () => {
    const page = parseSengokuListingPage(sengokuFixture('listing-3013.html'));
    expect([page.start, page.end, page.total, page.rows.length]).toEqual([1, 40, 2139, 40]);
    expect(page.rows[0]).toEqual({
      code: 'EEHD-5XW7', name: 'かんたんLEDシリーズ 高輝度LED(赤色・5mm)　AP-L01', maker: 'ELEKIT', model: 'AP-L01',
      priceLines: [{ minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 330 }], outOfStockClass: false, stockMark: null,
    });
    expect(page.rows.filter((r) => r.priceLines[0]!.label === '2本入1袋').map((r) => r.priceLines[0]!.quantityUnit)).toContain('組');
  });

  it('reads quantity breaks, set prices and the out-of-stock mark', () => {
    const rows = new Map(parseSengokuListingPage(sengokuFixture('listing-3137.html')).rows.map((r) => [r.code, r]));
    expect(rows.get('EEHD-6N43')).toMatchObject({ maker: null, model: 'FYD0H105ZF', outOfStockClass: true, stockMark: '欠品中',
      priceLines: [{ minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 650 }] });
    expect(rows.get('EEHD-4WJH')?.priceLines).toEqual([
      { minQuantity: 10, quantityUnit: '個', label: '単価', amountYen: 42 }, { minQuantity: 100, quantityUnit: '個', label: '単価', amountYen: 38 }]);
    expect(rows.get('7AN4-EEE6')?.priceLines).toEqual([
      { minQuantity: 1, quantityUnit: '本', label: '1本単価', amountYen: 450 }, { minQuantity: 100, quantityUnit: '本', label: '1本単価', amountYen: 405 },
      { minQuantity: 1000, quantityUnit: '本', label: '1本単価', amountYen: 360 }]);
    expect(rows.get('EEHD-6JAH')?.priceLines).toEqual([{ minQuantity: 1, quantityUnit: '箱', label: '1箱単価', amountYen: 980 }]);
    const labels = new Set([...rows.values()].map((r) => r.priceLines[0]!.label));
    expect(labels).toEqual(new Set(['単価', '1本単価', '1箱単価', '5個1組']));
    expect([...rows.values()].filter((r) => r.outOfStockClass).map((r) => r.code).sort()).toEqual([...rows.values()].filter((r) => r.stockMark === '欠品中').map((r) => r.code).sort());
  });

  it('keeps price lines in the order shown, with or without a quantity', () => {
    const html = sengokuFixture('listing-3137.html');
    const cell = (lines: string) => parseSengokuListingPage(html.replace('【数量1個〜】単価&nbsp;¥650<br>', lines)).rows.find((r) => r.code === 'EEHD-6N43')!.priceLines;
    // Seen on 2026-10-30: quantity breaks, a pack and a reel in one cell; a set or a sale price alone.
    expect(cell('【数量1個〜】単価&nbsp;¥389<br>\n\t\t\t\t【数量1組〜】10個1組&nbsp;¥3465<br>\n\t\t\t\t1リール&nbsp;¥75605<br>')).toEqual([
      { minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 389 }, { minQuantity: 1, quantityUnit: '組', label: '10個1組', amountYen: 3465 },
      { minQuantity: null, quantityUnit: null, label: '1リール', amountYen: 75605 }]);
    expect(cell('【数量1組〜】10個入1組&nbsp;¥550<br>【数量1組〜】50個入1組&nbsp;¥2200<br>')).toEqual([
      { minQuantity: 1, quantityUnit: '組', label: '10個入1組', amountYen: 550 }, { minQuantity: 1, quantityUnit: '組', label: '50個入1組', amountYen: 2200 }]);
    expect(cell('5枚綴り&nbsp;¥700<br>')).toEqual([{ minQuantity: null, quantityUnit: null, label: '5枚綴り', amountYen: 700 }]);
    expect(cell('在庫限り特価&nbsp;¥4100<br>')).toEqual([{ minQuantity: null, quantityUnit: null, label: '在庫限り特価', amountYen: 4100 }]);
    // A quote request has no price, whether the shop prints none or ¥0.
    expect(cell('【数量1個〜】単価&nbsp;¥58<br>【数量1個〜】&nbsp;価格お見積り<br>')).toEqual([
      { minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 58 }, { minQuantity: 1, quantityUnit: '個', label: '価格お見積り', amountYen: null }]);
    expect(cell('【数量10個〜】 価格お見積り&nbsp;¥0<br>')).toEqual([{ minQuantity: 10, quantityUnit: '個', label: '価格お見積り', amountYen: null }]);
    expect(() => cell('【数量1個〜】単価&nbsp;¥0<br>')).toThrow(/unreadable price text/);
    expect(() => cell('【数量1個〜】 価格お見積り&nbsp;¥500<br>')).toThrow(/unreadable price text/);
    // An empty price block shows no price (seen once, EEHD-5MAE); whitespace alone is not text.
    expect(cell('\n\t\t\t\t')).toEqual([]);
    // A quantity it cannot read is left over, not taken for a label; a price needs a label.
    expect(() => cell('【数量X個〜】単価&nbsp;¥650<br>')).toThrow(/unreadable price text "【数量X個〜】単価 ¥650"/);
    expect(() => cell('【数量1個〜】単価&nbsp;¥650<br>【数量10個】単価&nbsp;¥600<br>')).toThrow(/unreadable price text/);
    expect(() => cell('&nbsp;¥650<br>')).toThrow(/unreadable price text/);
  });

  it('keeps the counter as printed past the search cap', () => {
    const page = parseSengokuListingPage(sengokuFixture('listing-3000-st3960.html'));
    expect([page.start, page.end, page.total, page.rows.length]).toEqual([3961, 3960, 4000, 40]);
    expect(page.rows.filter((r) => r.model === null).length).toBeGreaterThan(0);
  });

  it('cuts descriptions out before reading, whatever they contain', () => {
    const html = sengokuFixture('listing-3013.html').replace('<div class="item_list1_price">',
      '<div class="item_list1_description">注意: <b>Vf<2V</b></td></tr><tr class="item_list_row"><td>【数量1個〜】単価&nbsp;¥1<br></div>\n<div class="item_list1_price">');
    expect(withoutDescriptions(html)).not.toContain('Vf');
    const page = parseSengokuListingPage(html);
    expect(page.rows).toHaveLength(40);
    expect(page.rows[0]!.priceLines).toEqual([{ minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 330 }]);
    expect(() => withoutDescriptions('<div class="item_list1_description">x')).toThrow(/not followed by a price block/);
  });

  it('refuses pages it cannot read completely', () => {
    const html = sengokuFixture('listing-3137.html');
    expect(() => parseSengokuListingPage(html.replace('¥650', 'お問い合わせ'))).toThrow(/unreadable price text/);
    expect(() => parseSengokuListingPage(html.replace('¥650<br>', '¥650<br>送料別'))).toThrow(/unreadable price text/);
    expect(() => parseSengokuListingPage(html.replace('通販価格(税込)', '通販価格'))).toThrow(/税込/);
    expect(() => parseSengokuListingPage(html.replace(/全4000件/, '全4000'))).toThrow(/counter/);
    expect(() => parseSengokuListingPage(html.replace('<td class="item_list1_detail">\n\t\t\t\t<div class=""><a href="./detail.php?code=EEHD-6JAH">',
      '<td class="item_list1_detail">\n\t\t\t\t<div class=""><a href="./detail.php?code=EEHD-4WJH">'))).toThrow(/detail cell does not link the same product/);
    expect(() => parseSengokuListingPage(html.replace('detail.php?code=EEHD-6JAH">1/4W', 'detail.php?code=eehd-6jah">1/4W'))).toThrow(/unexpected product code/);
  });
});

describe('Sengoku collector', () => {
  it('reads every listing below the cap, splits the capped one and keeps each product once', async () => {
    const r = await collectSengokuFixture();
    expect(r.errors).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.requests).toEqual([
      'https://www.sengoku.co.jp/mod/sgk_cart/category.php?cid=3000',
      LISTING(3013), LISTING(3013, 40), LISTING(3137), LISTING(3138), LISTING(3140), LISTING(3309), LISTING(3503),
    ]);
    expect(r.raw.listings.map((l) => [l.cid, l.listedTotal, l.pageCount])).toEqual([[3013, 45, 2], [3138, 10, 1], [3140, 30, 1], [3309, 12, 1], [3503, 25, 1]]);
    expect(r.raw.splitListings).toEqual([3137]);
    expect(r.raw.items).toHaveLength(120);
    expect(r.raw.items.filter((i) => i.listings.length > 1).map((i) => [i.code, i.listings])).toEqual([['EEHD-6JAH', [3138, 3309]], ['EEHD-4WJH', [3138, 3309]]]);
    expect(r.metrics).toMatchObject({ items: 120, listings: 5, splitListings: 1, listPages: 7, httpAttempts: 8 });
    expect(r.raw.retrievedAt).toBe(SENGOKU_RETRIEVED_AT);
    expect(JSON.stringify(r.raw)).not.toMatch(/description|\/item\/images|\.jpg/);
    expect(validateSengokuRaw(r.raw).errors).toEqual([]);
  });

  it('accepts the counter the shop prints on an exactly full last page, and only there', async () => {
    // Seen on 2026-10-30: search.php?cid=3503&st=240 reads 「241件～240件(全280件)」 over 40 rows.
    const tree = syntheticSengokuShop();
    tree[0] = { ...tree[0]!, rows: [...sengokuRows('listing-3013.html'), ...sengokuRows('listing-3000-st3960.html')] };
    const quirk = await collectSengokuFixture({ tree });
    expect(quirk.errors).toEqual([]);
    expect(quirk.raw.listings[0]).toEqual({ cid: 3013, name: 'マイコン・半導体・LED', listedTotal: 80, pageCount: 2 });
    const corrected = await collectSengokuFixture({ tree, edit: (url, body) => (url === LISTING(3013, 40) ? body.replace('41件～40件', '41件～80件') : body) });
    expect(corrected.errors).toEqual([]);
    const short = await collectSengokuFixture({ tree, edit: (url, body) => (url === LISTING(3013, 40) ? body.replace(/<tr class="item_list_row">[\s\S]*?<\/tr>/, '') : body) });
    expect(short.errors.join('\n')).toMatch(/39 rows where the counter promised 40/);
    const first = await collectSengokuFixture({ edit: (url, body) => (url === LISTING(3013) ? body.replace('1件～40件', '1件～0件') : body) });
    expect(first.errors.join('\n')).toMatch(/counter says 1–0 where 1–40/);
  });

  it('ends incomplete when a capped listing has nothing below it', async () => {
    const tree = syntheticSengokuShop();
    tree[1] = { ...tree[1]!, children: [] };
    const r = await collectSengokuFixture({ tree });
    expect(r.complete).toBe(false);
    expect(r.errors[0]).toMatch(/Listing 3137 \(コイル・コンデンサ・抵抗\) reports 4000 products, the search cap, and has no subcategories/);
    expect(r.raw.items).toEqual([]);
    expect(validateSengokuRaw(r.raw).errors).not.toEqual([]);
  });

  it.each([
    ['a page that skips rows', (url: string, body: string) => (url === LISTING(3013, 40) ? body.replace('41件～45件', '42件～45件') : body), /counter says 42–45 where 41–45/],
    ['a total that changes between pages', (url: string, body: string) => (url === LISTING(3013, 40) ? body.replace('(全45件)', '(全46件)') : body), /listed total changed from 45 to 46/],
    ['fewer rows than the counter names', (url: string, body: string) => (url === LISTING(3503) ? body.replace(/<tr class="item_list_row">[\s\S]*?<\/tr>/, '') : body), /24 rows where the counter promised 25/],
    ['a row it cannot read, naming the page', (url: string, body: string) => (url === LISTING(3140) ? body.replace('¥650', 'お問い合わせ') : body), /^Listing 3140 at 0: row 16 \(EEHD-6N43\): unreadable price text/],
    ['a row repeated within a listing', (url: string, body: string) => (url === LISTING(3013, 40) ? body.replace(/detail\.php\?code=[A-Z0-9-]+"/g, 'detail.php?code=EEHD-5XW7"') : body), /repeated product EEHD-5XW7/],
  ])('ends incomplete on %s', async (_, edit, message) => {
    const r = await collectSengokuFixture({ edit });
    expect(r.complete).toBe(false);
    expect(r.errors.join('\n')).toMatch(message);
  });

  it('ends incomplete when the shop refuses a page, without insisting', async () => {
    const r = await collectSengokuFixture({ status: (url) => (url === LISTING(3140) ? 403 : 200) });
    expect(r.complete).toBe(false);
    expect(r.errors[0]).toMatch(/403/);
    expect(r.requests.filter((u) => u === LISTING(3140))).toHaveLength(1);
  });

  it('keeps the first observation of a product two listings show differently', async () => {
    const r = await collectSengokuFixture({ edit: (url, body) => (url === LISTING(3309) ? body.replace('¥980', '¥990') : body) });
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual(['product EEHD-6JAH: listing 3309 shows it differently from listing 3138; the first is kept']);
    expect(r.raw.items.find((i) => i.code === 'EEHD-6JAH')?.priceLines[0]?.amountYen).toBe(980);
    expect(r.metrics['differingDuplicates']).toBe(1);
  });

  it('is registered and requires an identifying User-Agent', () => {
    expect(getStoreCollector('sengoku').storeId).toBe('sengoku');
    expect(() => sengokuCollectorConfig({})).toThrow(/userAgent/);
    expect(sengokuCollectorConfig({ userAgent: 'electro-parts-test/1.0' })).toMatchObject({ minIntervalMs: 2000, jitterMs: 1000, maxRequests: 2000 });
    expect(() => sengokuCollectorConfig({ userAgent: 'electro-parts-test/1.0', minIntervalMs: 500 })).toThrow(/minIntervalMs/);
  });
});

function item(overrides: Partial<SengokuItem> = {}): SengokuItem {
  return {
    code: 'EEHD-6N43', name: '電気二重層コンデンサ 5.5V 1F　FYD0H105ZF', maker: null, model: 'FYD0H105ZF',
    priceLines: [{ minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 650 }], outOfStockClass: false, stockMark: null, listings: [3140],
    ...overrides,
  };
}

describe('Sengoku normalization', () => {
  it('builds the price basis from what the line shows', () => {
    const tier = (minQuantity: number | null, quantityUnit: string | null, label: string) => sengokuUnitLabel({ minQuantity, quantityUnit, label, amountYen: 1 });
    expect(tier(1, '個', '単価')).toBe('1個');
    expect(tier(10, '個', '単価')).toBe('1個（10個から）');
    expect(tier(0, '個', '単価')).toBe('1個');
    expect(tier(1, '本', '1本単価')).toBe('1本');
    expect(tier(1, '箱', '1箱単価')).toBe('1箱');
    expect(tier(1, '組', '5個1組')).toBe('5個1組');
    expect(tier(1, '組', '2本入1袋')).toBe('2本入1袋');
    expect(tier(2, '組', '5個1組')).toBe('5個1組（2組から）');
    expect(tier(null, null, '5枚綴り')).toBe('5枚綴り');
    expect(tier(null, null, '特価')).toBe('特価');
  });

  it('prices the first line, as a range when another line repeats its basis', () => {
    const quote = (priceLines: SengokuItem['priceLines']) => normalizeSengokuItem(item({ priceLines })).offers[0]!.priceQuotes[0]!;
    expect(quote([{ minQuantity: 1, quantityUnit: '組', label: '10個入1組', amountYen: 550 }, { minQuantity: 1, quantityUnit: '組', label: '50個入1組', amountYen: 2200 },
      { minQuantity: null, quantityUnit: null, label: '1リール', amountYen: 75605 }])).toMatchObject({ state: 'exact', minAmountMinor: 550, maxAmountMinor: 550, unitLabel: '10個入1組' });
    // Seen on 2026-10-30 (EEHD-538N): two prices for the same 【数量1個〜】単価.
    expect(quote([{ minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 284 }, { minQuantity: 1, quantityUnit: '個', label: '単価', amountYen: 255 }]))
      .toMatchObject({ state: 'range', minAmountMinor: 255, maxAmountMinor: 284, unitLabel: '1個' });
    // The published manifest declares what the product data can hold, so it declares ranges.
    expect(SENGOKU_CAPABILITIES.supportsPriceRange).toBe(true);
    expect(quote([{ minQuantity: null, quantityUnit: null, label: '特価', amountYen: 500 }])).toMatchObject({ state: 'exact', minAmountMinor: 500, unitLabel: '特価' });
    expect(quote([])).toMatchObject({ state: 'unavailable', minAmountMinor: null, maxAmountMinor: null, unitLabel: null });
    expect(quote([{ minQuantity: 1, quantityUnit: '個', label: '価格お見積り', amountYen: null }]))
      .toMatchObject({ state: 'unavailable', minAmountMinor: null, maxAmountMinor: null, unitLabel: null });
  });

  it('maps the stock mark only when both signs agree', () => {
    const state = (outOfStockClass: boolean, stockMark: string | null) => normalizeAvailability(item({ outOfStockClass, stockMark }));
    expect(state(false, null)).toEqual({ state: 'in_stock', purchasable: null, quantity: null, quantitySemantics: 'not_exposed', rawStatus: null });
    expect(state(true, '欠品中')).toEqual({ state: 'out_of_stock', purchasable: null, quantity: null, quantitySemantics: 'not_exposed', rawStatus: '欠品中' });
    expect(state(true, null).state).toBe('unknown');
    expect(state(false, '欠品中').state).toBe('unknown');
    expect(state(true, '販売終了')).toMatchObject({ state: 'unknown', rawStatus: '販売終了' });
  });

  it('normalizes one product from its first price line, with the detail page as its URL', () => {
    const p = normalizeSengokuItem(item({ outOfStockClass: true, stockMark: '欠品中', priceLines: [
      { minQuantity: 10, quantityUnit: '個', label: '単価', amountYen: 42 }, { minQuantity: 100, quantityUnit: '個', label: '単価', amountYen: 38 }] }));
    expect(p).toEqual({
      externalProductId: 'EEHD-6N43', pageKey: 'EEHD-6N43', aliases: [{ kind: 'managementCode', value: 'EEHD-6N43' }],
      metadata: { name: '電気二重層コンデンサ 5.5V 1F　FYD0H105ZF', modelNumber: 'FYD0H105ZF', category: null, canonicalUrl: 'https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-6N43' },
      offers: [{
        externalOfferId: DEFAULT_OFFER_ID, offerKind: 'default', sku: null, variantName: null,
        priceQuotes: [{ quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', state: 'exact', minAmountMinor: 42, maxAmountMinor: 42, unitLabel: '1個（10個から）' }],
        availability: { state: 'out_of_stock', purchasable: null, quantity: null, quantitySemantics: 'not_exposed', rawStatus: '欠品中' },
      }],
    });
    expect(normalizeSengokuItem(item({ model: null })).metadata.modelNumber).toBeNull();
  });

  it('normalizes the collected shop, sorted by code', async () => {
    const r = await collectSengokuFixture();
    const n = sengokuSnapshotAdapter.normalize(r.raw, 'a'.repeat(64));
    expect(n).toMatchObject({ storeId: 'sengoku', observedAt: SENGOKU_RETRIEVED_AT, complete: true, coverageId: 'category:3000' });
    expect(n.products).toHaveLength(120);
    expect(n.products.map((p) => p.pageKey)).toEqual(n.products.map((p) => p.pageKey).sort());
    expect(n.products.find((p) => p.pageKey === 'EEHD-6N43')?.offers[0]?.availability.state).toBe('out_of_stock');
    expect(getStoreAdapter('sengoku')).toBe(sengokuSnapshotAdapter);
    expect(SENGOKU_CAPABILITIES).toMatchObject({ supportsInventoryQuantity: false, inventoryQuantitySemantics: 'not_exposed', primaryQuote: { taxTreatment: 'tax_included' } });
    expect(sengokuSnapshotAdapter.productUrlForPageKey('EEHD-6N43')).toBe('https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=EEHD-6N43');
    expect(sengokuSnapshotAdapter.productUrlForPageKey('../x')).toBeNull();
  });

  it('rejects a snapshot that does not add up to its own listings', async () => {
    const r = await collectSengokuFixture();
    const broken = (edit: (s: SengokuSnapshot) => void) => {
      const s = structuredClone(r.raw);
      edit(s);
      return validateSengokuRaw(s).errors.map((e) => e.message).join('\n');
    };
    expect(validateSengokuRaw(r.raw).metrics).toMatchObject({ itemCount: 120, listingCount: 5, outOfStockCount: 2 });
    expect(broken((s) => s.items.pop())).toMatch(/products for a listed total of/);
    expect(broken((s) => s.items.push(structuredClone(s.items[0]!)))).toMatch(/appears twice/);
    expect(broken((s) => { s.items[0]!.listings = [9999]; })).toMatch(/listing 9999 was not read/);
    expect(broken((s) => { s.listings[0]!.listedTotal = 4000; })).toMatch(/not below the search cap/);
    expect(broken((s) => { s.complete = false; })).toMatch(/not a complete collection/);
    expect(broken((s) => { (s.items[0] as unknown as Record<string, unknown>)['priceLines'] = null; })).toMatch(/priceLines missing/);
    expect(broken((s) => { s.items[0]!.priceLines[0]!.quantityUnit = null; })).toMatch(/quantity without its unit/);
    expect(broken((s) => { s.items[0]!.priceLines[0]!.amountYen = 0; })).toMatch(/amountYen is not a positive integer/);
    expect(broken((s) => { s.items[0]!.priceLines[0]!.amountYen = null; })).toMatch(/amountYen is not a positive integer/);
    expect(broken((s) => { s.items[0]!.priceLines[0]!.label = '価格お見積り'; })).toMatch(/価格お見積り line has an amount/);
    expect(broken((s) => { s.splitListings = [3013]; })).toMatch(/splitListings/);
    expect(() => sengokuSnapshotAdapter.normalize({ ...r.raw, complete: false }, 'a'.repeat(64))).toThrow();
  });
});
