import { describe, expect, it } from 'vitest';
import { DEFAULT_OFFER_ID } from '../../src/core/domain.ts';
import { isMarutsuCode, isMarutsuPageId, marutsuProductUrl } from '../../src/adapters/marutsu/identity.ts';
import type { MarutsuItem, MarutsuSnapshot } from '../../src/adapters/marutsu/rawSchema.ts';
import {
  MARUTSU_CAPABILITIES, marutsuSnapshotAdapter, marutsuUnitLabel, normalizeAvailability, normalizeMarutsuItem, validateMarutsuRaw,
} from '../../src/adapters/marutsu/snapshotAdapter.ts';
import { MARUTSU_REREAD_SETTLE_MS, marutsuCollectorConfig, marutsuListingUrl } from '../../src/collectors/marutsu/collector.ts';
import { MarutsuPageError, parseMarutsuListingPage, parseMarutsuSubcategories } from '../../src/collectors/marutsu/pages.ts';
import { getStoreCollector } from '../../src/stores/collectorRegistry.ts';
import { getStoreAdapter } from '../../src/stores/registry.ts';
import {
  MARUTSU_RETRIEVED_AT, collectMarutsuFixture, marutsuCategoryIndexHtml, marutsuFixture, syntheticMarutsuShop,
} from '../helpers/marutsu.ts';

const LISTING = (path: string, page = 1) => marutsuListingUrl(path, page);
const INDEX = 'https://www.marutsu.co.jp/GoodsAllCategoryList.jsp';

describe('Marutsu identity', () => {
  it('accepts page ids and builds the product URL from them only', () => {
    for (const id of ['40938', '51465', '2335443', '3587642']) expect(isMarutsuPageId(id), id).toBe(true);
    for (const id of ['', 'M0004-0938', '40938/', '/40938', '40938?x=1', '４０９３８']) expect(isMarutsuPageId(id), id).toBe(false);
    expect(marutsuProductUrl('40938')).toBe('https://www.marutsu.co.jp/pc/i/40938/');
    expect(() => marutsuProductUrl('M0004-0938')).toThrow();
    for (const code of ['M0004-0938', 'M0380-2371']) expect(isMarutsuCode(code), code).toBe(true);
    for (const code of ['', 'm0004-0938', 'M00040938', 'M0004-09380']) expect(isMarutsuCode(code), code).toBe(false);
  });
});

describe('Marutsu listing page', () => {
  it('reads the counter and the facts of each saved stocked row', () => {
    const page = parseMarutsuListingPage(marutsuFixture('listing-stocked.html'));
    expect([page.total, page.page, page.perPage, page.rows.length]).toEqual([10, 1, 50, 3]);
    expect(page.rows[0]).toEqual({
      pageId: '2335443', name: 'Type-C-Type-Cケーブル(100W 1m)', maker: 'LAZOS', model: 'L-TC100-W1', marutsuCode: null,
      priceTiers: [{ minQuantity: 1, quantityUnit: '個', amountExcludingTaxYen: 429, amountIncludingTaxYen: 471 }],
      stockQuantity: 23, stockNote: null, shipText: '2026/1/29', qualityRank: 'A', minOrderQuantity: null,
    });
    expect(page.rows.map((r) => r.pageId)).toEqual(['2335443', '3667324', '3667323']);
  });

  it('reads a saved row with no stock quantity and a lead time instead', () => {
    const page = parseMarutsuListingPage(marutsuFixture('listing-no-stock.html'));
    expect([page.total, page.rows.length]).toEqual([2, 2]);
    expect(page.rows[0]).toEqual({
      pageId: '51465', name: 'ドリルスクリュードライバービット23本セット', maker: 'BLACK & DECKER', model: '589549-15095', marutsuCode: null,
      priceTiers: [{ minQuantity: 1, quantityUnit: 'セット', amountExcludingTaxYen: 1219, amountIncludingTaxYen: 1340 }],
      stockQuantity: null, stockNote: null, shipText: '7営業日程度', qualityRank: 'M1', minOrderQuantity: null,
    });
  });

it('reads the マルツコード and the minimum order quantity when a row prints them', () => {
const html = marutsuFixture('listing-stocked.html').replace('<dt>型番：</dt>',
'</dl><dl><dt>マルツコード：</dt><dd>M0013-7432</dd></dl><dl><dt>最小発注数量：</dt><dd>1個</dd></dl><dl><dt>型番：</dt>');
const row = parseMarutsuListingPage(html).rows[0]!;
expect(row.marutsuCode).toBe('M0013-7432');
expect(row.minOrderQuantity).toBe(1);
expect(() => parseMarutsuListingPage(html.replace('M0013-7432', 'X0013-7432'))).toThrow(/マルツコード entry that does not read as a code/);
});

it('refuses pages and rows it cannot read completely', () => {
const html = marutsuFixture('listing-stocked.html');
expect(() => parseMarutsuListingPage(html.replace('resultsDataNumber = "10"', 'resultsDataNumber = ""'))).toThrow(/no resultsDataNumber counter/);
expect(() => parseMarutsuListingPage(html.replace('税込￥471.00', '税込￥471.50'))).toThrow(/not a whole number of yen/);
expect(() => parseMarutsuListingPage(html.replace('id="salesGoodsCode_0" name="salesGoodsCode_0" value="2335443"', 'id="salesGoodsCode_0" name="salesGoodsCode_0" value="2335444"'))).toThrow(/hidden sales code does not name the same product/);
expect(() => parseMarutsuListingPage(html.replace('L-TC100-W1 </label>', 'L-TC100-W2 </label>'))).toThrow(/name link says and the spec block says 型番 L-TC100-W2/);
expect(() => parseMarutsuListingPage(html.replace('￥</small>429.00', '￥</small>お問い合わせ'))).toThrow(MarutsuPageError);
});

it('never reads the product description into a fact', () => {
const html = marutsuFixture('listing-stocked.html');
expect(html).toContain('goodsExpSum_0_innerId');
const page = parseMarutsuListingPage(html);
expect(JSON.stringify(page.rows)).not.toContain('商品説明');
expect(JSON.stringify(page.rows)).not.toContain('.jpg');
});
});

describe('Marutsu category index', () => {
const index = marutsuCategoryIndexHtml([
{ top: '16', path: '160004', name: 'セラミックコンデンサー'},
{ top: '16', path: '160015', name: '電解コンデンサー'},
{ top: '21', path: '210008', name: 'ACインレット・アウトレット'},
]);

it('reads the subcategories of the top category asked for', () => {
expect(parseMarutsuSubcategories(index, '16')).toEqual([
{ path: '160004', name: 'セラミックコンデンサー'},
{ path: '160015', name: '電解コンデンサー'},
]);
expect(parseMarutsuSubcategories(index, '21')).toEqual([{ path: '210008', name: 'ACインレット・アウトレット'}]);
expect(() => parseMarutsuSubcategories(index, '19')).toThrow(/no subcategories of 19/);
});

it('refuses a subcategory the index names two ways', () => {
const twice = index + '\n<a href="LargeCategoryList.jsp?goodsClassCode1=16#goodsClassName2Surround160004">コンデンサ</a>';
expect(() => parseMarutsuSubcategories(twice, '16')).toThrow(/appears as both/);
const same = index + '\n<a href="LargeCategoryList.jsp?goodsClassCode1=16#goodsClassName2Surround160004">セラミックコンデンサー</a>';
expect(parseMarutsuSubcategories(same, '16')).toHaveLength(2);
});
});

describe('Marutsu collector', () => {
  it('reads every listing below the cap, splits the capped one and keeps each product once', async () => {
    const r = await collectMarutsuFixture();
    expect(r.errors).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.requests).toEqual([
      LISTING('05'), LISTING('11'), LISTING('15'), LISTING('16'), INDEX, LISTING('160004'), LISTING('160015'),
      LISTING('17'), LISTING('17', 2), LISTING('19'), LISTING('21'),
    ]);
    expect(r.raw.listings.map((l) => [l.categoryPath, l.listedTotal, l.pageCount])).toEqual([
      ['05', 3, 1], ['11', 2, 1], ['160004', 2, 1], ['160015', 2, 1], ['17', 55, 2], ['19', 1, 1], ['21', 1, 1],
    ]);
    expect(r.raw.splitListings).toEqual(['16']);
    expect(r.raw.items).toHaveLength(62);
    expect(r.raw.items.filter((i) => i.listings.length > 1).map((i) => [i.pageId, i.listings])).toEqual([
      ['2335443', ['05', '160004']], ['3667324', ['05', '160004']], ['3667323', ['05', '160015']], ['51465', ['11', '160015']],
    ]);
    expect(r.metrics).toMatchObject({ items: 62, listings: 7, splitListings: 1, emptyListings: 1, listPages: 10, httpAttempts: 11 });
    expect(r.raw.retrievedAt).toBe(MARUTSU_RETRIEVED_AT);
    expect(JSON.stringify(r.raw)).not.toMatch(/商品説明|\.jpg/);
    expect(validateMarutsuRaw(r.raw).errors).toEqual([]);
  });

  it('ends incomplete when a capped subcategory has nothing below it', async () => {
    const shop = syntheticMarutsuShop();
    const listings = shop.listings.map((l) => (l.path === '160004' ? { ...l, capped: true } : l));
    const r = await collectMarutsuFixture({ shop: { ...shop, listings } });
    expect(r.complete).toBe(false);
    expect(r.errors[0]).toMatch(/Listing 160004 \(セラミックコンデンサー\) reports 4000 products, the search cap, and is not read any deeper/);
    expect(r.raw.items).toEqual([]);
    expect(validateMarutsuRaw(r.raw).errors).not.toEqual([]);
  });

  it.each([
    ['a total that changes between pages', (url: string, body: string) => (url === LISTING('17', 2) ? body.replace('resultsDataNumber = "55"', 'resultsDataNumber = "56"') : body), /listed total changed from 55 to 56/],
    ['fewer rows than the counter names', (url: string, body: string) => (url === LISTING('05') ? body.replace(/<li id="resultsRow_2"[\s\S]*$/, '') : body), /2 rows where the counter promised 3/],
    ['a row repeated within a listing', (url: string, body: string) => (url === LISTING('11') ? body.replaceAll('51463', '51465') : body), /repeated product 51465/],
    ['a page that says it is another page', (url: string, body: string) => (url === LISTING('17', 2) ? body.replace('resultsShowPageNumber = "2"', 'resultsShowPageNumber = "1"') : body), /the page says it is page 1/],
  ])('ends incomplete on %s', async (_, edit, message) => {
    const r = await collectMarutsuFixture({ edit, config: { maxListingPasses: 1 } });
    expect(r.complete).toBe(false);
    expect(r.errors.join('\n')).toMatch(message);
  });

  describe('a listing whose total changes while it is being read', () => {
    it('reads that listing again from its first page and ends with the snapshot an undisturbed crawl gives', async () => {
      const clean = await collectMarutsuFixture();
      let reads = 0;
      const sleeps: number[] = [];
      const r = await collectMarutsuFixture({
        sleeps,
        edit: (url, body) => (url === LISTING('17', 2) && (reads += 1) === 1 ? body.replace('resultsDataNumber = "55"', 'resultsDataNumber = "56"') : body),
      });
      expect(r.errors).toEqual([]);
      expect(r.complete).toBe(true);
      expect(r.raw).toEqual(clean.raw);
      expect(r.requests.filter((u) => u.includes('category=17'))).toEqual([LISTING('17'), LISTING('17', 2), LISTING('17'), LISTING('17', 2)]);
      expect(r.warnings).toEqual(['listing 17 (電線・配線部材): the listed total changed from 55 to 56 during the crawl; read again from its first page (pass 2 of 2)']);
      expect(r.metrics).toMatchObject({ rereads: 1, listPages: 12, items: 62 });
      expect(sleeps.filter((ms) => ms >= MARUTSU_REREAD_SETTLE_MS)).toEqual([MARUTSU_REREAD_SETTLE_MS]);
      expect(r.metrics['rereadWaitedMs']).toBe(MARUTSU_REREAD_SETTLE_MS);
    });
  });

  it('ends incomplete when the shop refuses a page, without insisting', async () => {
    const r = await collectMarutsuFixture({ status: (url) => (url === LISTING('19') ? 403 : 200) });
    expect(r.complete).toBe(false);
    expect(r.errors[0]).toMatch(/403/);
    expect(r.requests.filter((u) => u === LISTING('19'))).toHaveLength(1);
  });

  it('keeps the first observation of a product two listings show differently', async () => {
    const r = await collectMarutsuFixture({ edit: (url, body) => (url === LISTING('160015') ? body.replace('税込￥1,340.00', '税込￥1,350.00') : body) });
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual(['product 51465: listing 160015 shows it differently from listing 11; the first is kept']);
    expect(r.raw.items.find((i) => i.pageId === '51465')?.priceTiers[0]?.amountIncludingTaxYen).toBe(1340);
    expect(r.metrics['differingDuplicates']).toBe(1);
  });

  it('is registered and requires an identifying User-Agent', () => {
    expect(getStoreCollector('marutsu').storeId).toBe('marutsu');
    expect(() => marutsuCollectorConfig({})).toThrow(/userAgent/);
    expect(marutsuCollectorConfig({ userAgent: 'electro-parts-test/1.0' })).toMatchObject({ minIntervalMs: 2000, jitterMs: 1000, maxRequests: 2000 });
    expect(() => marutsuCollectorConfig({ userAgent: 'electro-parts-test/1.0', minIntervalMs: 500 })).toThrow(/minIntervalMs/);
  });
});

function item(overrides: Partial<MarutsuItem> = {}): MarutsuItem {
  return {
    pageId: '40938', name: 'めがねプラグ', maker: 'マル信無線電機', model: 'MI-767D', marutsuCode: 'M0004-0938',
    priceTiers: [{ minQuantity: 1, quantityUnit: '個', amountExcludingTaxYen: 104, amountIncludingTaxYen: 114 }],
    stockQuantity: 397, stockNote: null, shipText: '2026/11/17', qualityRank: 'A', minOrderQuantity: 1, listings: ['210008'],
    ...overrides,
  };
}

describe('Marutsu normalization', () => {
  it('builds the price basis from what the tier shows', () => {
    const tier = (minQuantity: number, quantityUnit: string) => marutsuUnitLabel({ minQuantity, quantityUnit, amountExcludingTaxYen: 1, amountIncludingTaxYen: 1 });
    expect(tier(1, '個')).toBe('1個');
    expect(tier(100, '個')).toBe('1個（100個から）');
    expect(tier(1, 'セット')).toBe('1セット');
    expect(tier(0, '個')).toBe('1個');
  });

  it('prices the first tier, tax included', () => {
    const quote = (priceTiers: MarutsuItem['priceTiers']) => normalizeMarutsuItem(item({ priceTiers })).offers[0]!.priceQuotes[0]!;
    expect(quote([{ minQuantity: 1, quantityUnit: '個', amountExcludingTaxYen: 104, amountIncludingTaxYen: 114 },
      { minQuantity: 100, quantityUnit: '個', amountExcludingTaxYen: 94, amountIncludingTaxYen: 103 }]))
      .toMatchObject({ state: 'exact', minAmountMinor: 114, maxAmountMinor: 114, unitLabel: '1個', taxTreatment: 'tax_included' });
    expect(quote([])).toMatchObject({ state: 'unavailable', minAmountMinor: null, maxAmountMinor: null, unitLabel: null });
    expect(MARUTSU_CAPABILITIES).toMatchObject({
      supportsTaxIncluded: true, supportsTaxExcluded: true, supportsInventoryQuantity: true,
      inventoryQuantitySemantics: 'site_reported', primaryQuote: { taxTreatment: 'tax_included' },
    });
  });

  it('maps availability from the stock quantity, the link texts and the shipping text', () => {
    const availability = (overrides: Partial<MarutsuItem>) => normalizeAvailability(item(overrides));
    expect(availability({})).toEqual({ state: 'in_stock', purchasable: true, quantity: 397, quantitySemantics: 'site_reported', rawStatus: '2026/11/17' });
    expect(availability({ stockQuantity: 0 }).state).toBe('in_stock');
    expect(availability({ stockQuantity: null, stockNote: '最新在庫数を確認', shipText: '最新納期を確認' }))
      .toEqual({ state: 'checking', purchasable: null, quantity: null, quantitySemantics: 'not_exposed', rawStatus: '最新在庫数を確認' });
    expect(availability({ stockQuantity: null, shipText: '2026/11/20' }).state).toBe('restocking');
    expect(availability({ stockQuantity: null, shipText: '7営業日程度' }).state).toBe('restocking');
    expect(availability({ stockQuantity: null, shipText: '最新納期を確認' }).state).toBe('restocking');
    expect(availability({ stockQuantity: null, shipText: 'お問合せ下さい' })).toMatchObject({ state: 'unknown', rawStatus: 'お問合せ下さい' });
    expect(availability({ stockQuantity: null, shipText: null }).state).toBe('unknown');
  });

  it('normalizes one product with its マルツコード as an alias and the product page as its URL', () => {
    const p = normalizeMarutsuItem(item());
    expect(p).toEqual({
      externalProductId: '40938', pageKey: '40938', aliases: [{ kind: 'marutsuCode', value: 'M0004-0938' }],
      metadata: { name: 'めがねプラグ', modelNumber: 'MI-767D', category: null, canonicalUrl: 'https://www.marutsu.co.jp/pc/i/40938/' },
      offers: [{
        externalOfferId: DEFAULT_OFFER_ID, offerKind: 'default', sku: null, variantName: null,
        priceQuotes: [{ quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', state: 'exact', minAmountMinor: 114, maxAmountMinor: 114, unitLabel: '1個' }],
        availability: { state: 'in_stock', purchasable: true, quantity: 397, quantitySemantics: 'site_reported', rawStatus: '2026/11/17' },
      }],
    });
    expect(normalizeMarutsuItem(item({ marutsuCode: null })).aliases).toEqual([]);
    expect(normalizeMarutsuItem(item({ model: null })).metadata.modelNumber).toBeNull();
  });

  it('normalizes the collected shop, sorted by page id', async () => {
    const r = await collectMarutsuFixture();
    const n = marutsuSnapshotAdapter.normalize(r.raw, 'a'.repeat(64));
    expect(n).toMatchObject({ storeId: 'marutsu', observedAt: MARUTSU_RETRIEVED_AT, complete: true, coverageId: 'stocked:05,11,15,16,17,19,21' });
    expect(n.products).toHaveLength(62);
    expect(n.products.map((p) => p.pageKey)).toEqual(n.products.map((p) => p.pageKey).sort());
    expect(n.products.find((p) => p.pageKey === '2335443')?.offers[0]?.availability).toMatchObject({ state: 'in_stock', quantity: 23 });
    expect(n.products.find((p) => p.pageKey === '51465')?.offers[0]?.availability.state).toBe('restocking');
    expect(getStoreAdapter('marutsu')).toBe(marutsuSnapshotAdapter);
    expect(marutsuSnapshotAdapter.productUrlForPageKey('40938')).toBe('https://www.marutsu.co.jp/pc/i/40938/');
    expect(marutsuSnapshotAdapter.productUrlForPageKey('M0004-0938')).toBeNull();
  });

  it('rejects a snapshot that does not add up to its own listings', async () => {
    const r = await collectMarutsuFixture();
    const broken = (edit: (s: MarutsuSnapshot) => void) => {
      const s = structuredClone(r.raw);
      edit(s);
      return validateMarutsuRaw(s).errors.map((e) => e.message).join('\n');
    };
    expect(validateMarutsuRaw(r.raw).metrics).toMatchObject({ itemCount: 62, listingCount: 7, noStockCount: 2, noCodeCount: 62 });
    expect(broken((s) => s.items.pop())).toMatch(/products for a listed total of/);
    expect(broken((s) => s.items.push(structuredClone(s.items[0]!)))).toMatch(/appears twice/);
    expect(broken((s) => { s.items[0]!.listings = ['999999']; })).toMatch(/listing 999999 was not read/);
    expect(broken((s) => { s.listings[0]!.listedTotal = 4000; })).toMatch(/not below the search cap/);
    expect(broken((s) => { s.complete = false; })).toMatch(/not a complete collection/);
    expect(broken((s) => { s.items[0]!.marutsuCode = 'X0013-7432'; })).toMatch(/invalid マルツコード/);
    expect(broken((s) => { s.items[0]!.stockQuantity = -1; })).toMatch(/stockQuantity is not a whole number/);
    expect(broken((s) => { s.splitListings = ['05']; })).toMatch(/splitListings/);
    expect(broken((s) => { s.categories = ['16']; })).toMatch(/unexpected categories/);
    expect(() => marutsuSnapshotAdapter.normalize({ ...r.raw, complete: false }, 'a'.repeat(64))).toThrow();
  });
});
