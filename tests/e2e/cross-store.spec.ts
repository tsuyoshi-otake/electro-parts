import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { E2E_SITE_DIR } from './global-setup.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { sampleManifest, sampleProduct } from '../userscript/helpers.ts';

const relation = PRODUCT_RELATIONS.find((r) => r.id === 'a117209-s6262')!;
const panel = (page: Page) => page.locator('#electronics-price-history-root');

/** Real production bundle/adapters/catalogue; synthetic observations, all network intercepted. */
async function setup(page: Page, source: 0 | 1, failure = false, selected = relation, adjust?: (p: ReturnType<typeof sampleProduct>) => void) {
  const requests: string[] = [];
  const currentRef = selected.products[source];
  const refs = new Map(PRODUCT_RELATIONS.filter(r => r.products.some(p => p.storeId === currentRef.storeId && p.pageKey === currentRef.pageKey))
    .flatMap(r => r.products).map(p => [`${p.storeId}/${p.pageKey}`, p]));
  const products = [...refs.values()].map((ref) => {
    const i = selected.products.findIndex(p => p.storeId === ref.storeId && p.pageKey === ref.pageKey);
    const p = sampleProduct({ storeId: ref.storeId, pageKey: ref.pageKey, externalProductId: ref.pageKey });
    p.product.current = { ...p.product.current, name: ref.name, modelNumber: ref.expectedModels.at(-1)!, canonicalUrl: ref.url };
    p.product.metadata = [{ ...p.product.current, t: p.product.firstSeenAt, suspicious: false }];
    if (ref.offer) {
      p.offers[0]!.externalOfferId = ref.offer.id; p.offers[0]!.sku = ref.offer.sku;
      const s = p.offers[0]!.segments[0]!;
      s.basis.currency = 'USD'; s.basis.taxTreatment = 'unknown';
      s.stats.current = { state: 'exact', minAmountMinor: 750, maxAmountMinor: 750 };
    }
    if (i !== -1 && selected.pricePolicy) {
      p.offers[0]!.externalOfferId = selected.pricePolicy.offerIds[i]!;
      p.offers[0]!.segments[0]!.basis.unitLabel = selected.pricePolicy.units[i]![0]!;
    }
    if (i === 1) {
      const s = p.offers[0]!.segments[0]!;
      s.stats.current = { state: 'exact', minAmountMinor: 1000, maxAmountMinor: 1000 };
      s.points = [[p.product.lastSeenAt, 'exact', 1000, 1000]];
      p.observation.firstObservedAt = p.product.lastSeenAt;
      p.observation.runCount = 1;
      s.stats.segmentStartAt = p.product.lastSeenAt;
    }
    adjust?.(p);
    return p;
  });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    // The daily rate for the USD row is its own request, outside the history load counts.
    if (new URL(url).hostname === 'open.er-api.com') {
      const last = Math.floor(Date.now() / 1000) - 3600;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ result: 'success', base_code: 'USD', time_last_update_unix: last, time_next_update_unix: last + 86400, rates: { USD: 1, JPY: 150, GBP: 0.75 } }) });
      return;
    }
    if (url === currentRef.url) {
      const body = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comparison fixture</title><style>body{margin:20px auto;padding:0 12px;max-width:1080px;font-family:system-ui}</style><h1>ATOM Lite — test fixture</h1><button>カートに入れる</button><div class="product--outer"></div><div class="pane-goods-center"></div></html>';
      await route.fulfill({ status: 200, contentType: 'text/html', body }); return;
    }
    requests.push(url);
    const manifest = url.includes('/manifest.json');
    const product = products.find((p) => manifest ? url.includes(`/stores/${p.storeId}/`) : new URL(url).pathname.endsWith(`/stores/${p.storeId}/products/${p.pageKey}.json`));
    if (!product || (failure && product.storeId !== currentRef.storeId)) {
      await route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*' }, body: 'fixture failure' }); return;
    }
    const body = manifest ? sampleManifest({ storeId: product.storeId }) : product;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    const mem = new Map();
    Object.assign(window, {
      GM_getValue: (key: string, fallback: unknown) => mem.get(key) ?? fallback,
      GM_setValue: (key: string, value: unknown) => mem.set(key, value),
      GM_deleteValue: (key: string) => mem.delete(key),
      GM_listValues: () => [...mem.keys()],
      GM_xmlhttpRequest: (d: { url: string; onload(r: unknown): void; onerror(r: unknown): void }) => {
        fetch(d.url).then(async r => d.onload({ status: r.status, responseText: await r.text() })).catch(() => d.onerror({ status: 0 }));
      },
    });
  });
  await page.goto(currentRef.url);
  await page.addScriptTag({ content: await readFile(path.join(E2E_SITE_DIR, 'electronics-price-history.user.js'), 'utf8') });
  return requests;
}

test('production bundle compares both directions and toggles a series with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const requests = await setup(page, 0);
  await expect(panel(page)).toContainText('記録価格差（他店 − 閲覧中） −￥200');
  await expect(panel(page)).not.toContainText('読み込み中');
  await panel(page).scrollIntoViewIfNeeded();
  await expect(panel(page).locator('.eph-comparison-chart g[data-series]')).toHaveCount(2);
  await expect(panel(page).locator('.eph-comparison-chart g[data-series]').nth(1).locator('circle')).toHaveCount(1);
  await panel(page).screenshot({ path: 'test-results/e2e/comparison-desktop-light.png' });
  await panel(page).getByRole('button', { name: 'ダーク', exact: true }).click();
  await panel(page).screenshot({ path: 'test-results/e2e/comparison-desktop-dark.png' });
  // #76: over the other store's one observation, the readout names both stores in their colors.
  const comparison = panel(page).locator('.eph-comparison-chart');
  const otherDot = (await comparison.locator('g[data-series]').nth(1).locator('circle').boundingBox())!;
  await page.mouse.move(otherDot.x + otherDot.width / 2, otherDot.y + otherDot.height / 2);
  await expect(comparison.locator('.eph-readout-text')).toHaveCount(3);
  await expect(comparison.locator('.eph-readout-text').nth(2)).toHaveText('スイッチサイエンス ￥1,000');
  await expect(comparison.locator('.eph-readout-label [data-series-index]')).toHaveCount(2);
  await panel(page).screenshot({ path: 'test-results/e2e/comparison-desktop-dark-readout.png' });
  const checkbox = panel(page).getByRole('checkbox', { name: 'スイッチサイエンス', exact: true });
  await checkbox.focus(); await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await expect(panel(page).locator('.eph-comparison-chart g[data-series]').nth(1)).toBeHidden();
  await expect(checkbox).toBeFocused();
  // A store switched off leaves the readout at the next move.
  await page.mouse.move(otherDot.x + otherDot.width / 2 - 1, otherDot.y + otherDot.height / 2);
  await expect(comparison.locator('.eph-readout-text')).toHaveCount(2);
  await expect(comparison.locator('.eph-readout')).not.toContainText('スイッチサイエンス');
  await page.mouse.move(1, 1);
  await expect(comparison.locator('.eph-readout-text')).toHaveCount(0);
  // The same ATOM Lite at せんごく (0.6.1) is a third identity card, a reference price without arithmetic.
  await expect(panel(page).locator('.store-price')).toHaveCount(3);
  await expect(panel(page).locator(`.store-price[data-relation-id='${JSON.stringify(['akizuki', '117209', 'sengoku', 'EEHD-5LAU'])}']`)).toContainText('せんごく');
  // #55: in stock and cheaper first; the USD official row goes after the yen stores; 最安 only on the approved pair.
  expect(await panel(page).locator('.store-price').evaluateAll(rows => rows.map(r => (r as HTMLElement).dataset['relationId']))).toEqual([
    'a117209-s6262', JSON.stringify(['akizuki', '117209', 'sengoku', 'EEHD-5LAU']), expect.stringContaining('m5stack'),
  ]);
  await expect(panel(page).locator('.store-price[data-relation-id="a117209-s6262"] .badge.cheapest')).toHaveText('最安（比較条件を確認した店舗の記録価格）');
  await expect(panel(page).locator('.badge.cheapest')).toHaveCount(1);
  await expect(panel(page).locator('.store-price').nth(2)).toContainText('送料・関税別');
  const cardBounds = await panel(page).locator('.store-price').evaluateAll(cards => cards.map(card => {
    const r = card.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width };
  }));
  expect(Math.abs(cardBounds[0]!.y - cardBounds[1]!.y)).toBeLessThan(2);
  expect(cardBounds[1]!.x).toBeGreaterThan(cardBounds[0]!.x + cardBounds[0]!.width);
  await expect(panel(page)).toContainText('$7.50');
  // The USD row reads in yen beside its recorded price; the rate note names the source.
  await expect(panel(page).locator('.store-price').nth(2).locator('.hero-value')).toHaveText('約 ￥1,125');
  await expect(panel(page).locator('.store-price').nth(2).locator('.fx-recorded')).toHaveText('記録価格 $7.50');
  await expect(panel(page).locator('.fx-note')).toContainText('1 USD = 150.00円');
  await expect(panel(page).locator('.fx-note a')).toHaveText('Rates By Exchange Rate API');
  // #71: the chart spans the panel and the store prices follow below it at every width; below the chart the
  // viewed store's card shares a row with the other stores whenever two cards fit.
  const layout = () => panel(page).evaluate(el => {
    const root = el.shadowRoot!;
    const body = root.querySelector('.body')!.getBoundingClientRect();
    const chart = root.querySelector('.chart-box')!.getBoundingClientRect();
    const prices = root.querySelector('.stats-col')!.getBoundingClientRect();
    const lead = root.querySelector('.store-prices > .current-price')!.getBoundingClientRect();
    const first = root.querySelector('.store-prices > .store-price')!.getBoundingClientRect();
    const order = chart.right <= prices.left + 1 ? 'left' : chart.bottom <= prices.top + 1 ? 'above' : 'after';
    const fullWidth = Math.abs(chart.width - body.width) <= 1;
    const leadBeside = Math.abs(lead.top - first.top) < 2 && first.left >= lead.right;
    return `${order}${fullWidth ? ' full' : ''}${leadBeside ? ' beside' : ''}`;
  });
  expect(await layout()).toBe('above full beside');
  // Four store manifests, the page's own history and MAX_RELATED_HISTORY_LOADS (8) related histories: since 0.6.7 the
  // ATOM family also holds the official and せんごく ATOM Matrix pages, so 9 related products meet the cap.
  expect(requests).toHaveLength(13);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => panel(page).locator('.store-prices').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
  await expect(panel(page).locator('.eph-comparison-chart')).toHaveAttribute('viewBox', /^0 0 3\d{2} 220$/);
  expect(await layout()).toBe('above full');
  // The store columns the panel sits in on the live sites (Switch Science 776px, せんごく 730px) stack the same way.
  await page.setViewportSize({ width: 1440, height: 1100 });
  const setPanelWidth = (width: string) => panel(page).evaluate((el, w) => { (el as HTMLElement).style.width = w; }, width);
  for (const width of ['860px', '776px', '730px']) {
    await setPanelWidth(width);
    await expect.poll(layout, { message: width }).toBe('above full beside');
  }
  await setPanelWidth('');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(checkbox).not.toBeChecked();
  await expect(panel(page).locator('.eph-comparison-chart g[data-series]').nth(1)).toBeHidden();
  await checkbox.check();
  await expect(panel(page).locator('.eph-comparison-chart g[data-series]').nth(1)).toBeVisible();
  expect(requests).toHaveLength(13);
  await panel(page).screenshot({ path: 'test-results/e2e/comparison-mobile.png' });
  const overflow = await panel(page).evaluate((el) => {
    const section = el.shadowRoot!.querySelector('section')!;
    return section.scrollWidth - section.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  await setup(page, 1);
  await expect(panel(page)).toContainText('記録価格差（他店 − 閲覧中） +￥200');
  await expect(page.getByRole('button', { name: 'カートに入れる', exact: true })).toBeVisible();
});

test('four same-product stores: three rows in stock and cheaper first, the out-of-stock store folded (#55)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const selected = PRODUCT_RELATIONS.find(r => r.id === 'a117056-s7677')!;
  const recorded: Record<string, [number, 'in_stock' | 'out_of_stock']> = {
    'ksy/720': [1300, 'in_stock'], 'sengoku/EEHD-6JZF': [900, 'out_of_stock'], 'switch-science/7677': [1100, 'in_stock'], 'switch-science/7678': [1000, 'in_stock'],
  };
  await setup(page, 0, false, selected, (p) => {
    const row = recorded[`${p.storeId}/${p.pageKey}`]; if (!row) return;
    const offer = p.offers[0]!;
    offer.segments[0]!.stats.current = { state: 'exact', minAmountMinor: row[0], maxAmountMinor: row[0] };
    const last = offer.availability[offer.availability.length - 1]!;
    offer.availability[offer.availability.length - 1] = [last[0], row[1], last[2], last[3], last[4]];
  });
  await expect(panel(page)).not.toContainText('読み込み中');
  const visible = panel(page).locator('.store-prices').first().locator('.store-price');
  expect(await visible.evaluateAll(rows => rows.map(r => (r as HTMLElement).dataset['relationId']))).toEqual(['a117056-s7678', 'a117056-s7677', JSON.stringify(['akizuki', '117056', 'ksy', '720'])]);
  await expect(panel(page).locator('.store-order')).toHaveText('他店は在庫ありの店舗を先に、記録価格の安い順に表示しています。');
  const more = panel(page).locator('details.store-prices-more');
  const summary = more.locator('summary[data-focus-key="store-prices-more"]');
  await expect(summary).toHaveText('他の店舗（1件）');
  const folded = more.locator('.store-price');
  await expect(folded).toBeHidden();
  await summary.click();
  await expect(folded).toBeVisible();
  await expect(folded).toContainText('在庫なし');
  await expect(folded).toHaveAttribute('data-relation-id', JSON.stringify(['akizuki', '117056', 'sengoku', 'EEHD-6JZF']));
  await expect(panel(page).locator('.badge.cheapest')).toHaveCount(0);
  await panel(page).scrollIntoViewIfNeeded();
  await panel(page).screenshot({ path: 'test-results/e2e/store-order-fold.png' });
});

test('generated Pico family shows concrete differences and retains the native product page at narrow width', async ({ page }) => {
  await page.setViewportSize({width: 390, height: 844});
  const selected = PRODUCT_RELATIONS.find(r => r.id === 'a116132-s6900')!;
  const requests = await setup(page, 0, false, selected);
  await expect(panel(page).locator('.store-price[data-relation-id="a116132-s6900"]')).toContainText('Raspberry Pi Pico');
  // The same Pico at KSY (0.5.1) is a second identity card; it adds no family difference.
  await expect(panel(page).locator(`.store-price[data-relation-id='${JSON.stringify(['akizuki', '116132', 'ksy', '634'])}']`)).toContainText('KSY');
  await expect(panel(page)).not.toContainText('読み込み中');
  // 0.6.3: the family reaches KSY and Sengoku too. Each of the 7 variants is one card with a row per store; the loads stay capped below.
  await expect(panel(page).locator('summary[data-focus-key="group-similar"]')).toHaveText('類似商品 (21件・7種類)');
  await expect(panel(page).locator('.related-card')).toHaveCount(7);
  await expect(panel(page).locator('.related-offer')).toHaveCount(21);
  await expect(panel(page)).toContainText('無線: なし → Wi-Fi/Bluetooth');
  await expect(panel(page)).toContainText('MCU: RP2040 → RP2350');
  await expect(panel(page)).not.toContainText('記録価格差');
  expect(requests.filter(url => url.includes('/products/')).length).toBeLessThanOrEqual(9);
  const summary = panel(page).locator('summary[data-focus-key="group-similar"]');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(panel(page).locator('.related-card').first()).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('.related-card').first()).toBeVisible();
  await expect(summary).toBeFocused();
  const chart = panel(page).locator('svg.eph-chart');
  await chart.scrollIntoViewIfNeeded();
  const expectReadableAxis = async () => {
    await expect.poll(() => chart.evaluate(svg => {
      const el = svg as SVGSVGElement;
      return el.getBoundingClientRect().width / el.viewBox.baseVal.width;
    })).toBeGreaterThan(0.95);
  };
  await expectReadableAxis();
  const settledRequests = requests.length;
  await panel(page).screenshot({path: 'test-results/e2e/pico-family-mobile.png'});
  const overflow = await panel(page).evaluate(el => {const section=el.shadowRoot!.querySelector('section')!; return section.scrollWidth-section.clientWidth;});
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', {name: 'カートに入れる', exact: true})).toBeVisible();
  // A desktop viewport can still embed the panel in a narrow store column.
  await page.setViewportSize({width: 1440, height: 1100});
  await panel(page).evaluate(el => { (el as HTMLElement).style.width = '390px'; });
  await expect.poll(() => panel(page).evaluate(el => {
    const root = el.shadowRoot!;
    return root.querySelector('.chart-box')!.getBoundingClientRect().width;
  })).toBeGreaterThan(340);
  const embeddedOverflow = await panel(page).evaluate(el => {const section=el.shadowRoot!.querySelector('section')!; return section.scrollWidth-section.clientWidth;});
  expect(embeddedOverflow).toBeLessThanOrEqual(1);
  await expectReadableAxis();
  await expect(chart).toHaveAttribute('viewBox', / 220$/);
  // Resizing redraws locally and theme rerenders retain cleanup ownership.
  await panel(page).evaluate(el => { (el as HTMLElement).style.width = '1080px'; });
  await expect(chart).toHaveAttribute('viewBox', / 280$/);
  await panel(page).evaluate(el => { (el as HTMLElement).style.width = '390px'; });
  await expectReadableAxis();
  await expect(chart).toHaveAttribute('viewBox', / 220$/);
  expect(requests.length).toBe(settledRequests);
  await panel(page).screenshot({path: 'test-results/e2e/pico-family-narrow-container.png'});
});

test('other-store 429 keeps the own history and product link without arithmetic or retries', async ({ page }) => {
  const requests = await setup(page, 0, true);
  await expect(panel(page)).toContainText('他店データを取得できませんでした');
  await expect(panel(page)).toContainText('￥1,200');
  await expect(panel(page)).not.toContainText('記録価格差');
  await expect(panel(page).locator(`[data-focus-key="product-${relation.id}"]`)).toHaveAttribute('href', relation.products[1].url);
  await panel(page).getByRole('button', { name: 'ダーク', exact: true }).click();
  await expect(panel(page)).not.toContainText('読み込み中');
  expect(requests).toHaveLength(5);
});
