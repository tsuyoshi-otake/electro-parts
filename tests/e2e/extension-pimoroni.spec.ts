import { chromium, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

/** WCAG contrast of an `rgb(...)` color against the dark page base `#3e3e3e`. */
function contrastWithPageBase(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const base = 0.0482;
  return (Math.max(lum, base) + 0.05) / (Math.min(lum, base) + 0.05);
}

test('Pimoroni extension shows the GBP history with a cross-rate yen reference on the Japan market page, selects variants and darkens the page with its own variables', async () => {
  const scratch = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', 'tmp', 'electro-pimoroni-tests');
  await mkdir(scratch, { recursive: true }); const profile = await mkdtemp(path.join(scratch, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--enable-gpu', `--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`] });
  try {
    const requests: string[] = []; const rateRequests: string[] = [];
    // The USD answer the worker already reads; GBP is its JPY rate over its GBP rate (150 / 0.75 = 200 yen).
    const last = Math.floor(Date.now() / 1000) - 3600;
    const rate = JSON.stringify({ result: 'success', base_code: 'USD', time_last_update_unix: last, time_next_update_unix: last + 86400, rates: { USD: 1, JPY: 150, GBP: 0.75 } });
    const html =gunzipSync(await readFile('tests/fixtures/pimoroni/product.html.gz')).toString();
    const css = gunzipSync(await readFile('tests/fixtures/pimoroni/pimoroni.css.gz')).toString();
    await context.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'tsuyoshi-otake.github.io') {
        requests.push(u.href);
        await route.fulfill({ contentType: 'application/json', body: await readFile(path.join(E2E_SITE_DIR, u.pathname.replace(/^\/electro-parts\//, ''))) });
      } else if (u.hostname === 'open.er-api.com') {
        rateRequests.push(u.href);
        await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: rate });
      } else if (u.hostname === 'shop.pimoroni.com' && u.pathname.endsWith('/pimoroni.css')) {
        await route.fulfill({ contentType: 'text/css', body: css });
      } else if (u.hostname === 'shop.pimoroni.com' && u.pathname === '/en-jp/products/presto') {
        await route.fulfill({ contentType: 'text/html', body: html });
      } else await route.fulfill({ status: 204, body: '' });
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('https://shop.pimoroni.com/en-jp/products/presto');
    const panel = page.locator('#electronics-price-history-root');
    // In the product grid, before the description: the left column under the gallery.
    await expect(page.locator('.product-page > #electronics-price-history-root + .about')).toBeAttached();
    await expect(panel).toContainText('£57.50'); await expect(panel).toContainText('GBP'); await expect(panel).toContainText('税区分不明');
    await expect(panel).not.toContainText('取得できませんでした');
    // GBP gets a yen reference through the cross rate, and says which rates it came from.
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥11,500');
    await expect(panel.locator('.stats-col > .fx-recorded')).toContainText('記録価格 £57.50');
    await expect(panel).toContainText('1 GBP = 200.00円（USD/JPY と USD/GBP から算出、');
    await expect(panel).toContainText('Rates By Exchange Rate API');
    const columns = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const host = box('#electronics-price-history-root'), media = box('.product-page > .media'), purchase = box('.product-page > .purchase');
      return { underMedia: host.top >= media.bottom - 1 && Math.abs(host.left - media.left) < 2, leftOfPurchase: host.right <= purchase.left + 1 };
    });
    expect(columns).toEqual({ underMedia: true, leftOfPurchase: true });
    await panel.getByLabel('バリエーション').selectOption('54894104052091');
    await expect(panel).toContainText('£82.50');
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥16,500');
    await panel.scrollIntoViewIfNeeded(); await expect(panel.locator('svg.eph-chart')).toBeVisible();
    const light = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, header: getComputedStyle(document.querySelector('#header')!).backgroundColor }));
    // The shop filters some images itself (brightness, drop shadows); the dark theme adds none.
    const imageFilters = () => page.locator('img').evaluateAll((images) => images.map((img) => getComputedStyle(img).filter));
    const lightFilters = await imageFilters();
    await page.screenshot({ path: 'test-results/e2e/pimoroni-light.png' });

    await panel.getByRole('button', { name: 'ダーク', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-eph-page-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    // The store's boxes take the dark surface; its header keeps the store's colors.
    await expect(page.locator('.product-page .description.box')).toHaveCSS('background-color', 'rgb(52, 52, 52)');
    expect(await page.locator('#header').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(light.header);
    const stock = await page.locator('#status').evaluate((el) => getComputedStyle(el).color);
    expect(contrastWithPageBase(stock), stock).toBeGreaterThanOrEqual(4.5);
    const title = await page.locator('.product-page > header h1').evaluate((el) => getComputedStyle(el).color);
    expect(contrastWithPageBase(title), title).toBeGreaterThanOrEqual(7);
    expect(await imageFilters()).toEqual(lightFilters);
    await page.screenshot({ path: 'test-results/e2e/pimoroni-dark.png' });
    await page.reload(); await expect(panel.locator('section')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    await expect(panel).toContainText('£57.50');
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥11,500');

    // One column at 1024 px and below: the same panel moves right under the add-to-cart row,
    // ahead of the cross-sell, inside the page width; it moves back when the page is two columns again.
    const placement = () => page.evaluate(() => {
      const host = document.querySelector('#electronics-price-history-root')!;
      const box = host.getBoundingClientRect();
      const button = document.querySelector('#add_to_cart .add-to-cart')!.getBoundingClientRect();
      return {
        afterAddToCart: host.previousElementSibling?.id === 'add_to_cart',
        beforeCrossSell: Boolean(host.compareDocumentPosition(document.getElementById('options')!) & Node.DOCUMENT_POSITION_FOLLOWING),
        nearButton: box.top >= button.bottom && box.top - button.bottom < 200,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const before = await panel.evaluateHandle((el) => el.shadowRoot);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect.poll(placement).toEqual({ afterAddToCart: true, beforeCrossSell: true, nearButton: true, overflow: 0 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(placement).toEqual({ afterAddToCart: true, beforeCrossSell: true, nearButton: true, overflow: 0 });
    await panel.getByLabel('バリエーション').selectOption('54894104052091');
    await expect(panel).toContainText('£82.50');
    await panel.screenshot({ path: 'test-results/e2e/pimoroni-narrow.png' });
    await page.setViewportSize({ width: 1040, height: 900 });
    await expect(page.locator('.product-page > #electronics-price-history-root + .about')).toBeAttached();
    // Moved, not rebuilt: the chosen variant and the shadow tree stay.
    await expect(panel).toContainText('£82.50');
    expect(await panel.evaluate((el, root) => el.shadowRoot === root, before)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole('button', { name: 'ライト', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-eph-page-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', light.body);
    // One USD request for the whole visit: the reload and the variant switch reuse the stored answer.
    expect(rateRequests).toEqual(['https://open.er-api.com/v6/latest/USD']);
    // The store manifest and the product, then the same two again after the reload at most.
    expect(requests.length).toBeLessThanOrEqual(4);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
