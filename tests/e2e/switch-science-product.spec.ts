import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_SITE_DIR } from './global-setup.ts';

const PRODUCT_URL = 'https://www.switch-science.com/products/9381';
const DATA_ORIGIN = 'https://tsuyoshi-otake.github.io';
const DATA_BASE = `${DATA_ORIGIN}/electro-parts`;
const FIXTURE = path.resolve(process.cwd(), 'tests', 'fixtures', 'switch-science', 'html', '9381.html.gz');

/** Same Tampermonkey shims as the Akizuki spec: fetch-backed GM_xmlhttpRequest, in-memory GM storage. */
const GM_SHIMS = `
  const mem = new Map(Object.entries(JSON.parse(sessionStorage.getItem('gm') || '{}')));
  const persist = () => sessionStorage.setItem('gm', JSON.stringify(Object.fromEntries(mem)));
  window.GM_getValue = (k, d) => (mem.has(k) ? mem.get(k) : d);
  window.GM_setValue = (k, v) => { mem.set(k, v); persist(); };
  window.GM_deleteValue = (k) => { mem.delete(k); persist(); };
  window.GM_listValues = () => [...mem.keys()];
  window.__gmRequests = [];
  window.GM_xmlhttpRequest = (d) => {
    window.__gmRequests.push(d.url);
    fetch(d.url, { credentials: 'omit' })
      .then(async (r) => d.onload && d.onload({ status: r.status, responseText: await r.text() }))
      .catch(() => d.onerror && d.onerror({ status: 0 }));
  };
`;

async function setup(page: Page, { dataOnline = true } = {}): Promise<void> {
  const html = gunzipSync(await readFile(FIXTURE)).toString('utf8');
  await page.route('https://www.switch-science.com/**', async (route) => {
    const url = route.request().url();
    if (url === PRODUCT_URL || url === `${PRODUCT_URL}/` || url.endsWith('/collections/all/products/9381')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else if (/\/products\/\d+$/.test(url)) {
      // A product the dataset has not seen: same page, different handle.
      const handle = url.slice(url.lastIndexOf('/') + 1);
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html.replaceAll('9381', handle) });
    } else {
      await route.fulfill({ status: 204, body: '' }); // images, css, fonts: nothing else is needed
    }
  });
  await page.route(`${DATA_ORIGIN}/**`, async (route) => {
    if (!dataOnline) {
      await route.abort('connectionfailed');
      return;
    }
    const rel = new URL(route.request().url()).pathname.replace(/^\/electro-parts\//, '');
    try {
      const body = await readFile(path.join(E2E_SITE_DIR, rel));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
    } catch {
      await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'not found' });
    }
  });
  await page.addInitScript(GM_SHIMS);
}

async function injectUserscript(page: Page): Promise<void> {
  await page.addScriptTag({ content: await readFile(path.join(E2E_SITE_DIR, 'electronics-price-history.user.js'), 'utf8') });
}

const panel = (page: Page) => page.locator('#electronics-price-history-root');
const panelText = (page: Page) => page.locator('#electronics-price-history-root section');
const gmRequests = (page: Page) => page.evaluate(() => (window as unknown as { __gmRequests: string[] }).__gmRequests);

test('shows the ¥165 camera cable on the saved Switch Science page, reading only that store dataset', async ({ page }) => {
  await setup(page);
  await page.goto(PRODUCT_URL);
  await injectUserscript(page);
  await expect(panel(page)).toHaveAttribute('data-page-key', '9381');
  const section = panelText(page);
  await expect(section).toContainText('Electronics Price History');
  await expect(section).toContainText('￥165');
  // One observation so far, which the panel says plainly instead of implying a trend.
  await expect(section).toContainText('(初回観測)');
  await expect(section).toContainText('在庫あり');
  await expect(section).toContainText('観測期間 2026-09-07〜2026-09-07(1 回)');
  await expect(section).toContainText('価格変更の記録');
  // The store exposes no quantity, so the panel must not print one.
  await expect(section).not.toContainText('表示在庫数');

  await panel(page).scrollIntoViewIfNeeded();
  await expect(page.locator('#electronics-price-history-root svg[role="img"]')).toBeVisible();
  await expect(page.locator('#electronics-price-history-root svg circle')).toHaveCount(1);
  await panel(page).screenshot({ path: path.resolve(process.cwd(), 'test-results', 'e2e', 'panel-9381.png') });

  // The page itself is untouched, and the panel sits after the two-column block.
  await expect(page.locator('h1.product-title')).toContainText('0.5 mmピッチ22ピン to 22ピンカメラケーブル');
  expect(await page.locator('.product--outer + #electronics-price-history-root').count()).toBe(1);

  const requests = await gmRequests(page);
  // The manifest carries a cache-buster so a stale CDN copy cannot pin the panel
  // to an old dataset; the product file is addressed by content version instead.
  expect(requests[0].startsWith(DATA_BASE)).toBe(true);
  expect(requests[0]).toMatch(/\/data\/v1\/stores\/switch-science\/manifest\.json\?b=\d+$/);
  expect(requests[1]).toMatch(/\/data\/v1\/stores\/switch-science\/products\/9381\.json\?v=[0-9a-f]{16}$/);
  expect(requests).toHaveLength(2);
  // Two stores are published side by side; this page must not read the other one.
  expect(requests.some((u) => u.includes('/akizuki/'))).toBe(false);

  // Reload: served from the GM cache, no request at all.
  await page.reload();
  await injectUserscript(page);
  await expect(panelText(page)).toContainText('￥165');
  expect(await gmRequests(page)).toHaveLength(0);
});

test('reads the same product through the collection URL Shopify also serves it from', async ({ page }) => {
  await setup(page);
  await page.goto('https://www.switch-science.com/collections/all/products/9381');
  await injectUserscript(page);
  // The canonical link, not the path, decides: both routes are the same product.
  await expect(panel(page)).toHaveAttribute('data-page-key', '9381');
  await expect(panelText(page)).toContainText('￥165');
});

test('fails open when the data origin is unreachable', async ({ page }) => {
  await setup(page, { dataOnline: false });
  await page.goto(PRODUCT_URL);
  await injectUserscript(page);
  await expect(panelText(page)).toContainText('取得できませんでした');
  // The store's own page keeps working; the panel never blocks it.
  await expect(page.locator('h1.product-title')).toBeVisible();
  await expect(page.locator('.price__current').first()).toContainText('165');
});

test('reports products that are not in the dataset yet', async ({ page }) => {
  await setup(page);
  await page.goto('https://www.switch-science.com/products/999999');
  await injectUserscript(page);
  await expect(panel(page)).toHaveAttribute('data-page-key', '999999');
  await expect(panelText(page)).toContainText('まだ観測データに含まれていません');
});
