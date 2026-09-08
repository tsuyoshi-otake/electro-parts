import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { E2E_SITE_DIR } from './global-setup.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { sampleManifest, sampleProduct } from '../userscript/helpers.ts';

const relation = PRODUCT_RELATIONS.find((r) => r.id === 'a117209-s6262')!;
const panel = (page: Page) => page.locator('#electronics-price-history-root');

/** Real production bundle/adapters/catalogue; synthetic observations, all network intercepted. */
async function setup(page: Page, source: 0 | 1, failure = false, selected = relation) {
  const requests: string[] = [];
  const currentRef = selected.products[source];
  const refs = new Map(PRODUCT_RELATIONS.filter(r => r.products.some(p => p.storeId === currentRef.storeId && p.pageKey === currentRef.pageKey))
    .flatMap(r => r.products).map(p => [`${p.storeId}/${p.pageKey}`, p]));
  const products = [...refs.values()].map((ref) => {
    const i = selected.products.findIndex(p => p.storeId === ref.storeId && p.pageKey === ref.pageKey);
    const p = sampleProduct({ storeId: ref.storeId, pageKey: ref.pageKey, externalProductId: ref.pageKey });
    p.product.current = { ...p.product.current, name: ref.name, modelNumber: ref.expectedModels.at(-1)!, canonicalUrl: ref.url };
    p.product.metadata = [{ ...p.product.current, t: p.product.firstSeenAt, suspicious: false }];
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
    return p;
  });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
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
  await expect(panel(page).locator('g[data-series]')).toHaveCount(2);
  await expect(panel(page).locator('g[data-series]').nth(1).locator('circle')).toHaveCount(1);
  await panel(page).screenshot({ path: 'test-results/e2e/comparison-desktop-light.png' });
  await panel(page).getByRole('button', { name: 'ダーク', exact: true }).click();
  await panel(page).screenshot({ path: 'test-results/e2e/comparison-desktop-dark.png' });
  const checkbox = panel(page).getByRole('checkbox', { name: 'スイッチサイエンス', exact: true });
  await checkbox.focus(); await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await expect(panel(page).locator('g[data-series]').nth(1)).toBeHidden();
  await expect(checkbox).toBeFocused();
  expect(requests).toHaveLength(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page).locator('.eph-comparison-chart')).toHaveAttribute('viewBox', /^0 0 3\d{2} 220$/);
  await expect(checkbox).not.toBeChecked();
  await expect(panel(page).locator('g[data-series]').nth(1)).toBeHidden();
  await checkbox.check();
  await expect(panel(page).locator('g[data-series]').nth(1)).toBeVisible();
  expect(requests).toHaveLength(6);
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

test('generated Pico family shows concrete differences and retains the native product page at narrow width', async ({ page }) => {
  await page.setViewportSize({width: 390, height: 844});
  const selected = PRODUCT_RELATIONS.find(r => r.id === 'a116132-s6900')!;
  const requests = await setup(page, 0, false, selected);
  await expect(panel(page).locator('.store-price')).toContainText('Raspberry Pi Pico');
  await expect(panel(page)).not.toContainText('読み込み中');
  await expect(panel(page).locator('.related-card')).toHaveCount(7);
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
  await panel(page).screenshot({path: 'test-results/e2e/pico-family-narrow-container.png'});
});

test('other-store 429 keeps the own history and product link without arithmetic or retries', async ({ page }) => {
  const requests = await setup(page, 0, true);
  await expect(panel(page)).toContainText('他店データを取得できませんでした');
  await expect(panel(page)).toContainText('￥1,200');
  await expect(panel(page)).not.toContainText('記録価格差');
  await expect(panel(page).locator('.store-price a')).toHaveAttribute('href', relation.products[1].url);
  await panel(page).getByRole('button', { name: 'ダーク', exact: true }).click();
  expect(requests).toHaveLength(3);
});
