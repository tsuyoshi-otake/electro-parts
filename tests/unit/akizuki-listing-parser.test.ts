import { describe, expect, it } from 'vitest';
import type { AkizukiRawSnapshot } from '../../src/adapters/akizuki/rawSchema.ts';
import {
  decodeEntities,
  isAkizukiMaintenancePage,
  ListingParseError,
  parseAkizukiListingPage,
  parseQuantityDisplay,
  parseYen,
} from '../../src/collectors/akizuki/listingParser.ts';
import { loadAkizukiRaw, readHtmlFixture } from '../helpers/fixtures.ts';

describe('Akizuki listing parser on recorded pages', () => {
  it('reads the pager and every product block of the first rkit page', async () => {
    const page = parseAkizukiListingPage(await readHtmlFixture('rkit_p1'));
    expect(page.genreName).toBe('組立キット(モジュール)');
    expect(page.listedTotal).toBe(670);
    expect(page.currentPage).toBe(1);
    expect(page.lastPage).toBe(12);
    expect(page.nextPath).toBe('/catalog/r/rkit_p2/');
    expect(page.items).toHaveLength(60);
    expect(page.issues).toEqual([]);
    const kit = page.items[0]!;
    expect(kit).toEqual({
      salesCode: '105148',
      modelNumber: 'AE-DC-POWER-JACK-DIP',
      name: 'ブレッドボード用2.1mm標準DCジャックDIP化キット',
      category: 'DCジャック(dcjack)',
      url: 'https://akizukidenshi.com/catalog/g/g105148/',
      prices: [{ amountYen: 100, display: '￥100(税込)', quantityUnit: '1セット', taxIncluded: true }],
      stock: { status: '在庫あり', availableQuantity: 2362, quantityUnit: 'セット', quantityDisplay: '2362セット', purchasable: true },
      positionOnPage: 1,
    });
    // HTML entity in the name is decoded; "在庫僅少" keeps its quantity.
    const drv = page.items.find((i) => i.salesCode === '109848')!;
    expect(drv.name).toBe('DRV8835使用ステッピング&DCモータードライバーモジュール');
    expect(drv.stock).toEqual({ status: '在庫僅少', availableQuantity: 202, quantityUnit: 'セット', quantityDisplay: '202セット', purchasable: true });
    // "入荷未定" has no purchase form: not purchasable, quantity unknown, not a discontinuation.
    const gray = page.items.find((i) => i.salesCode === '116947')!;
    expect(gray.stock).toEqual({ status: '入荷未定', availableQuantity: null, quantityUnit: null, quantityDisplay: null, purchasable: false });
    expect(gray.prices).toEqual([{ amountYen: 380, display: '￥380(税込)', quantityUnit: '1個', taxIncluded: true }]);
    expect(page.items.filter((i) => i.modelNumber === null)).toHaveLength(3);
  });

  it('joins stacked status badges and recognises discontinued items', async () => {
    const p6 = parseAkizukiListingPage(await readHtmlFixture('rkit_p6'));
    expect(p6.currentPage).toBe(6);
    const confirming = p6.items.find((i) => i.salesCode === '117847')!;
    expect(confirming.stock.status).toBe('在庫あり / 納期確認中');
    expect(confirming.stock.purchasable).toBe(true);
    expect(confirming.stock.availableQuantity).toBe(266);

    const p3 = parseAkizukiListingPage(await readHtmlFixture('rkit_p3'));
    const restocking = p3.items.find((i) => i.salesCode === '116379')!;
    expect(restocking.stock.status).toBe('在庫あり 10月上旬入荷予定');
    expect(restocking.prices[0]!.amountYen).toBe(5200);

    const sbc = parseAkizukiListingPage(await readHtmlFixture('rsbcomp1'));
    expect(sbc.genreName).toBe('シングルボードコンピューター本体');
    expect(sbc.listedTotal).toBe(76);
    expect(sbc.lastPage).toBe(2);
    const ended = sbc.items.find((i) => i.salesCode === '117563')!;
    expect(ended.stock).toEqual({ status: '販売終了', availableQuantity: null, quantityUnit: null, quantityDisplay: null, purchasable: false });
    expect(ended.prices[0]).toEqual({ amountYen: 65400, display: '￥65,400(税込)', quantityUnit: '1台', taxIncluded: true });
    const statuses = new Set(sbc.items.map((i) => i.stock.status));
    expect(statuses.has('11月中旬入荷予定')).toBe(true);
  });

  it('reproduces the previous collector output for the same day (quantities aside)', async () => {
    // The 2026-09-06 snapshot was taken ~40 minutes before these pages were saved.
    const reference = (await loadAkizukiRaw('sep')).json as AkizukiRawSnapshot;
    const byCode = new Map(reference.items.map((i) => [i.salesCode, i]));
    let compared = 0;
    let quantityDrift = 0;
    for (const fixture of ['rkit_p1', 'rkit_p3', 'rkit_p6', 'rsbcomp1'] as const) {
      for (const item of parseAkizukiListingPage(await readHtmlFixture(fixture)).items) {
        const ref = byCode.get(item.salesCode);
        expect(ref, `sales code ${item.salesCode} missing from the reference snapshot`).toBeDefined();
        compared++;
        expect([item.name, item.modelNumber, item.category, item.url, item.prices]).toEqual([ref!.name, ref!.modelNumber, ref!.category, ref!.url, ref!.prices]);
        expect([item.stock.status, item.stock.purchasable, item.stock.quantityUnit]).toEqual([ref!.stock.status, ref!.stock.purchasable, ref!.stock.quantityUnit]);
        if (item.stock.availableQuantity !== ref!.stock.availableQuantity) {
          quantityDrift++;
          // Items only sell between the two observations.
          expect(item.stock.availableQuantity!).toBeLessThan(ref!.stock.availableQuantity!);
        }
      }
    }
    expect(compared).toBe(240);
    expect(quantityDrift).toBe(6);
  });

  it('refuses maintenance pages and pages without the expected structure', async () => {
    const maintenance = '<html><body><div class="block-custom-error-403"><p>現在メンテナンス中です。</p></div></body></html>';
    expect(isAkizukiMaintenancePage(maintenance)).toBe(true);
    expect(() => parseAkizukiListingPage(maintenance)).toThrow(ListingParseError);
    expect(() => parseAkizukiListingPage('<html><body>nothing</body></html>')).toThrow(/genre header/);
    const noCounter = '<h1 class="h1 block-genre-page--header">X</h1>';
    expect(() => parseAkizukiListingPage(noCounter)).toThrow(/listed total/);
    const noItems = `${noCounter}<span class="pager-count"><span>12</span>件あります</span>`;
    expect(() => parseAkizukiListingPage(noItems)).toThrow(/no product blocks/);
    // An empty genre is fine.
    const empty = `${noCounter}<span class="pager-count"><span>0</span>件あります</span>`;
    expect(parseAkizukiListingPage(empty).items).toEqual([]);
  });

  it('reports per-item problems without dropping the page', async () => {
    const html = await readHtmlFixture('rkit_p1');
    const broken = html.replace('<strong>販売コード：</strong>105148', '<strong>販売コード：</strong>abc');
    const page = parseAkizukiListingPage(broken);
    // Sales code text is unusable, but the product link still identifies the item.
    expect(page.items[0]!.salesCode).toBe('105148');
    expect(page.issues).toEqual(['item 1: unusable sales code text "abc", using link 105148']);
    const noLink = broken.replace('href="/catalog/g/g105148/" title', 'href="/catalog/x/" title').replace('href="/catalog/g/g105148/" title', 'href="/catalog/x/" title');
    const page2 = parseAkizukiListingPage(noLink);
    expect(page2.items).toHaveLength(59);
    expect(page2.issues).toEqual(['item 1: no sales code (text="abc", href=/catalog/x/)']);
  });
});

describe('listing parser helpers', () => {
  it('parses yen and quantity displays', () => {
    expect(parseYen('￥1,200(税込)')).toBe(1200);
    expect(parseYen('￥100')).toBe(100);
    expect(parseYen('価格未定')).toBeNull();
    expect(parseQuantityDisplay('2362セット')).toEqual({ quantity: 2362, unit: 'セット' });
    expect(parseQuantityDisplay('1,024個')).toEqual({ quantity: 1024, unit: '個' });
    expect(parseQuantityDisplay('12')).toEqual({ quantity: 12, unit: null });
    expect(parseQuantityDisplay('多数')).toEqual({ quantity: null, unit: null });
  });

  it('decodes the entities that occur in product names', () => {
    expect(decodeEntities('A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39; &#x41;')).toBe('A&B <C> "D" \'E\' A');
    expect(decodeEntities('&unknown; &#0;')).toBe('&unknown; &#0;');
  });
});
