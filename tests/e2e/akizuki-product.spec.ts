import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_SITE_DIR } from './global-setup.ts';

const PRODUCT_URL = 'https://akizukidenshi.com/catalog/g/g109951/';
const DATA_ORIGIN = 'https://tsuyoshi-otake.github.io';
const DATA_BASE = `${DATA_ORIGIN}/electro-parts`;
const FIXTURE = path.resolve(process.cwd(), 'tests', 'fixtures', 'akizuki', 'html', 'g109951.html.gz');

/**
 * Minimal Tampermonkey shims. GM_xmlhttpRequest is backed by fetch (the
 * data origin is served by route interception with CORS headers) and GM
 * storage by an in-memory map that survives reloads through sessionStorage.
 */
const GM_SHIMS = `
  const mem = new Map(Object.entries(JSON.parse(sessionStorage.getItem('gm') || '{}')));
  const persist = () => sessionStorage.setItem('gm', JSON.stringify(Object.fromEntries(mem)));
  window.GM_getValue = (k, d) => (mem.has(k) ? mem.get(k) : d);
  window.GM_setValue = (k, v) => { mem.set(k, v); persist(); };
  window.GM_deleteValue = (k) => { mem.delete(k); persist(); };
  window.__gmRequests = [];
  window.GM_xmlhttpRequest = (d) => {
    window.__gmRequests.push(d.url);
    fetch(d.url, { credentials: 'omit' })
      .then(async (r) => d.onload && d.onload({ status: r.status, responseText: await r.text() }))
      .catch(() => d.onerror && d.onerror({ status: 0 }));
  };
`;

interface Scenario {
  /** Whether the data origin answers; false simulates an outage. */
  dataOnline: boolean;
}

async function setup(page: Page, scenario: Scenario): Promise<void> {
  const html = gunzipSync(await readFile(FIXTURE)).toString('utf8');
  await page.route('https://akizukidenshi.com/**', async (route) => {
    if (route.request().url() === PRODUCT_URL) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else await route.fulfill({ status: 204, body: '' }); // images, css, fonts: nothing else is needed
  });
  await page.route(`${DATA_ORIGIN}/**`, async (route) => {
    if (!scenario.dataOnline) {
      await route.abort('connectionfailed');
      return;
    }
    const url = new URL(route.request().url());
    const rel = url.pathname.replace(/^\/electro-parts\//, '');
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
  const source = await readFile(path.join(E2E_SITE_DIR, 'electronics-price-history.user.js'), 'utf8');
  await page.addScriptTag({ content: source });
}

const panel = (page: Page) => page.locator('#electronics-price-history-root');
const panelText = (page: Page) => page.locator('#electronics-price-history-root section');

test('shows the FT232RQ kit history (1150 → 1200) on the saved product page without touching the network', async ({ page }) => {
  await setup(page, { dataOnline: true });
  await page.goto(PRODUCT_URL);
  await injectUserscript(page);
  await expect(panel(page)).toHaveAttribute('data-page-key', '109951');
  const section = panelText(page);
  await expect(section).toContainText('Electronics Price History');
  await expect(section).toContainText('最新');
  await expect(section).toContainText('￥1,200');
  await expect(section).toContainText('+￥50');
  await expect(section).toContainText('￥1,150〜￥1,200');
  await expect(section).toContainText('在庫あり');
  await expect(section).toContainText('表示在庫数 781');
  await expect(section).toContainText('観測期間 2026-08-02〜2026-09-06(2 回)');
  // The chart is drawn lazily once visible.
  await panel(page).scrollIntoViewIfNeeded();
  await expect(page.locator('#electronics-price-history-root svg[role="img"]')).toBeVisible();
  await expect(page.locator('#electronics-price-history-root svg circle')).toHaveCount(2);
  await panel(page).screenshot({ path: path.resolve(process.cwd(), 'test-results', 'e2e', 'panel-109951.png') });
  // Page content untouched, panel inside the sales area.
  await expect(page.locator('h1.block-goods-name--text')).toHaveText('[109951]FT232RQ USBシリアル変換モジュールキット');
  expect(await page.locator('#SalesArea #electronics-price-history-root').count()).toBe(1);
  const requests = await page.evaluate(() => (window as unknown as { __gmRequests: string[] }).__gmRequests);
  expect(requests[0]).toContain(`${DATA_BASE}/data/v1/stores/akizuki/manifest.json`);
  expect(requests[1]).toMatch(/\/data\/v1\/stores\/akizuki\/products\/109951\.json\?v=[0-9a-f]{16}$/);
  expect(requests).toHaveLength(2);

  // Reload: served from the GM cache, no request at all.
  await page.reload();
  await injectUserscript(page);
  await expect(panelText(page)).toContainText('￥1,200');
  await expect(panelText(page)).toContainText('最新');
  expect(await page.evaluate(() => (window as unknown as { __gmRequests: string[] }).__gmRequests)).toHaveLength(0);
});

test('fails open when the data origin is unreachable', async ({ page }) => {
  await setup(page, { dataOnline: false });
  await page.goto(PRODUCT_URL);
  await injectUserscript(page);
  await expect(panelText(page)).toContainText('取得できませんでした');
  await expect(page.locator('h1.block-goods-name--text')).toBeVisible();
  await expect(page.locator('.block-goods-price--price').first()).toContainText('￥1,200');
});

test('reports products that are not in the dataset yet', async ({ page }) => {
  await setup(page, { dataOnline: true });
  await page.route('https://akizukidenshi.com/catalog/g/g999999/', async (route) => {
    const html = gunzipSync(await readFile(FIXTURE)).toString('utf8').replaceAll('109951', '999999');
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('https://akizukidenshi.com/catalog/g/g999999/');
  await injectUserscript(page);
  await expect(panel(page)).toHaveAttribute('data-page-key', '999999');
  await expect(panelText(page)).toContainText('まだ観測データに含まれていません');
});
