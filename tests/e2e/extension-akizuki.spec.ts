import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

/**
 * The unpacked Chrome extension, loaded into a real browser, on the same saved
 * Akizuki page the userscript spec uses. It proves the part jsdom cannot: the
 * manifest loads, the content script runs at document_idle, and the panel is
 * drawn from data the *service worker* fetched.
 *
 * No request leaves the browser: the store page and the data origin are both
 * served by route interception, and the worker's own fetch is intercepted too.
 */

const PRODUCT_URL = 'https://akizukidenshi.com/catalog/g/g109951/';
const DATA_ORIGIN = 'https://tsuyoshi-otake.github.io';
const FIXTURE = path.resolve(process.cwd(), 'tests', 'fixtures', 'akizuki', 'html', 'g109951.html.gz');

async function intercept(context: BrowserContext): Promise<string[]> {
  const dataRequests: string[] = [];
  const html = gunzipSync(await readFile(FIXTURE)).toString('utf8');
  await context.route('https://akizukidenshi.com/**', async (route) => {
    if (route.request().url() === PRODUCT_URL) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else await route.fulfill({ status: 204, body: '' }); // images, css, fonts: nothing else is needed
  });
  await context.route(`${DATA_ORIGIN}/**`, async (route) => {
    const url = route.request().url();
    dataRequests.push(url);
    const rel = new URL(url).pathname.replace(/^\/electro-parts\//, '');
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(path.join(E2E_SITE_DIR, rel)) });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  return dataRequests;
}

/**
 * Extensions need a persistent profile and the full Chromium build ("new"
 * headless); the bundled headless shell cannot load them. The profile is a
 * throwaway directory, removed in the caller's `finally`.
 */
async function launch(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`],
  });
}

test('the loaded extension draws the panel from data its service worker fetched', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'eph-ext-'));
  let context: BrowserContext | undefined;
  try {
    context = await launch(userDataDir);
    const dataRequests = await intercept(context);
    const page = await context.newPage();
    await page.goto(PRODUCT_URL);

    const panel = page.locator('#electronics-price-history-root');
    const section = page.locator('#electronics-price-history-root section');
    await expect(panel).toHaveAttribute('data-page-key', '109951');
    await expect(section).toContainText('Electronics Price History');
    await expect(section).toContainText('￥1,200');
    await expect(section).toContainText('+￥50');
    await expect(section).toContainText('在庫あり');
    await expect(section).toContainText('観測期間 2026-08-02〜2026-09-06(2 回)');

    await panel.scrollIntoViewIfNeeded();
    await expect(page.locator('#electronics-price-history-root svg[role="img"]')).toBeVisible();
    await panel.screenshot({ path: path.resolve(process.cwd(), 'test-results', 'e2e', 'extension-panel-109951.png') });

    // The page itself is untouched, and the panel sits where the adapter puts it.
    await expect(page.locator('h1.block-goods-name--text')).toHaveText('[109951]FT232RQ USBシリアル変換モジュールキット');
    expect(await page.locator('.pane-goods-center > #electronics-price-history-root:first-child').count()).toBe(1);

    // Manifest plus product, both from the data origin and nowhere else.
    expect(dataRequests).toHaveLength(2);
    expect(dataRequests[0]).toContain('/data/v1/stores/akizuki/manifest.json');
    expect(dataRequests[1]).toMatch(/\/data\/v1\/stores\/akizuki\/products\/109951\.json\?v=[0-9a-f]{16}$/);
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
