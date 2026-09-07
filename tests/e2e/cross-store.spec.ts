import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { E2E_SITE_DIR } from './global-setup.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { sampleManifest, sampleProduct } from '../userscript/helpers.ts';

const relation = PRODUCT_RELATIONS.find((r) => r.id === 'a117209-s6262')!;
const panel = (page: Page) => page.locator('#electronics-price-history-root');

/** Real production bundle/adapters/catalogue; synthetic observations, all network intercepted. */
async function setup(page: Page, source: 0 | 1, failure = false) {
  const requests: string[] = [];
  const products = relation.products.map((ref, i) => {
    const p = sampleProduct({ storeId: ref.storeId, pageKey: ref.pageKey, externalProductId: ref.pageKey });
    p.product.current = { ...p.product.current, name: ref.name, modelNumber: ref.expectedModels.at(-1)!, canonicalUrl: ref.url };
    p.product.metadata = [{ ...p.product.current, t: p.product.firstSeenAt, suspicious: false }];
    p.offers[0]!.externalOfferId = relation.pricePolicy!.offerIds[i]!;
    p.offers[0]!.segments[0]!.basis.unitLabel = relation.pricePolicy!.units[i]![0]!;
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
    if (url === relation.products[source].url) {
      const body = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comparison fixture</title><style>body{margin:20px auto;padding:0 12px;max-width:1080px;font-family:system-ui}</style><h1>ATOM Lite — test fixture</h1><button>カートに入れる</button><div class="product--outer"></div><div class="pane-goods-center"></div></html>';
      await route.fulfill({ status: 200, contentType: 'text/html', body }); return;
    }
    requests.push(url);
    const product = products.find((p) => url.includes(`/stores/${p.storeId}/`));
    if (!product || (failure && product.storeId !== relation.products[source].storeId)) {
      await route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*' }, body: 'fixture failure' }); return;
    }
    const body = url.includes('/manifest.json') ? sampleManifest({ storeId: product.storeId }) : product;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    const mem = new Map();
    Object.assign(window, {
      GM_getValue: (key: string, fallback: unknown) => mem.get(key) ?? fallback,
      GM_setValue: (key: string, value: unknown) => mem.set(key, value),
      GM_deleteValue: (key: string) => mem.delete(key),
      GM_xmlhttpRequest: (d: { url: string; onload(r: unknown): void; onerror(r: unknown): void }) => {
        fetch(d.url).then(async r => d.onload({ status: r.status, responseText: await r.text() })).catch(() => d.onerror({ status: 0 }));
      },
    });
  });
  await page.goto(relation.products[source].url);
  await page.addScriptTag({ content: await readFile(path.join(E2E_SITE_DIR, 'electronics-price-history.user.js'), 'utf8') });
  return requests;
}

test('production bundle compares both directions and toggles a series with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const requests = await setup(page, 0);
  await expect(panel(page)).toContainText('記録価格差（他店 − 閲覧中） −￥200');
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
  expect(requests).toHaveLength(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page).locator('.eph-comparison-chart')).toHaveAttribute('viewBox', /^0 0 3\d{2} 220$/);
  await expect(checkbox).not.toBeChecked();
  await expect(panel(page).locator('g[data-series]').nth(1)).toBeHidden();
  await checkbox.check();
  await expect(panel(page).locator('g[data-series]').nth(1)).toBeVisible();
  expect(requests).toHaveLength(4);
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

test('other-store 429 keeps the own history and product link without arithmetic or retries', async ({ page }) => {
  const requests = await setup(page, 0, true);
  await expect(panel(page)).toContainText('他店データを取得できませんでした');
  await expect(panel(page)).toContainText('￥1,200');
  await expect(panel(page)).not.toContainText('記録価格差');
  await expect(panel(page).locator('.store-price a')).toHaveAttribute('href', relation.products[1].url);
  await panel(page).getByRole('button', { name: 'ダーク', exact: true }).click();
  expect(requests).toHaveLength(3);
});
