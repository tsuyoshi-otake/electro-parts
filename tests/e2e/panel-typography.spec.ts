import { chromium, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

// Store CSS that styles every div reaches the panel's host element and outranks `:host`.
// M5Stack did this with Montserrat 14px; the panel must keep its own text settings anyway.
const STORE_LIKE_CSS = `body, div, section { font-family: "Courier New", monospace; font-size: 17px; line-height: 3;
  letter-spacing: 2px; word-spacing: 6px; text-transform: uppercase; font-weight: 700; font-style: italic;
  text-align: center; text-indent: 30px; white-space: nowrap; text-shadow: 1px 1px red; }`;

test('the panel keeps its own typography under store CSS that styles its host', async () => {
  const scratch = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', 'tmp', 'electro-typography-tests');
  await mkdir(scratch, { recursive: true }); const profile = await mkdtemp(path.join(scratch, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
    args: ['--enable-gpu', `--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`] });
  try {
    const last = Math.floor(Date.now() / 1000) - 3600;
    const rate = JSON.stringify({ result: 'success', base_code: 'USD', time_last_update_unix: last, time_next_update_unix: last + 86400, rates: { USD: 1, JPY: 157.820352 } });
    const html = gunzipSync(await readFile('tests/fixtures/m5stack/product.html.gz')).toString();
    await context.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'tsuyoshi-otake.github.io') {
        await route.fulfill({ contentType: 'application/json', body: await readFile(path.join(E2E_SITE_DIR, u.pathname.replace(/^\/electro-parts\//, ''))) });
      } else if (u.hostname === 'open.er-api.com') {
        await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: rate });
      } else if (u.hostname === 'shop.m5stack.com' && u.pathname.includes('/products/')) {
        await route.fulfill({ contentType: 'text/html', body: html });
      } else await route.fulfill({ status: 204, body: '' });
    });
    const page = await context.newPage();
    await page.goto('https://shop.m5stack.com/products/m5stamp-lora-module-sx1262');
    await page.addStyleTag({ content: STORE_LIKE_CSS });
    const panel = page.locator('#electronics-price-history-root');
    await expect(panel.locator('.current-price > .hero-value')).toHaveText('約 ￥868');
    // The host itself does take the store's font: that is the leak the panel must not inherit.
    await expect(panel).toHaveCSS('font-family', '"Courier New", monospace');
    const section = panel.locator('section.eph');
    await expect(section).toHaveCSS('font-family', /^system-ui, /);
    await expect(section).toHaveCSS('font-size', '13px');
    await expect(section).toHaveCSS('line-height', '20.8px');
    await expect(section).toHaveCSS('letter-spacing', 'normal');
    await expect(section).toHaveCSS('word-spacing', '0px');
    await expect(section).toHaveCSS('text-transform', 'none');
    await expect(section).toHaveCSS('font-weight', '400');
    await expect(section).toHaveCSS('font-style', 'normal');
    await expect(section).toHaveCSS('text-align', 'start');
    await expect(section).toHaveCSS('text-indent', '0px');
    await expect(section).toHaveCSS('white-space', 'normal');
    await expect(section).toHaveCSS('text-shadow', 'none');
    // Descendants follow the panel, not the page: the header stays on one row at desktop width.
    await expect(panel.locator('.brand')).toHaveCSS('font-family', /^system-ui, /);
    const head = await panel.locator('.head').boundingBox();
    const settings = await panel.getByRole('button', { name: '設定', exact: true }).boundingBox();
    const brand = await panel.locator('.brand').boundingBox();
    expect(Math.abs(settings!.y + settings!.height / 2 - (brand!.y + brand!.height / 2))).toBeLessThan(4);
    expect(head!.height).toBeLessThan(60);
    // The settings dialog inherits from the panel, so it is covered too.
    await panel.getByRole('button', { name: '設定', exact: true }).click();
    const dialog = panel.getByRole('dialog', { name: '表示設定' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveCSS('font-family', /^system-ui, /);
    await expect(dialog.locator('h2')).toHaveCSS('text-transform', 'none');
    await page.keyboard.press('Escape');
    await panel.screenshot({ path: 'test-results/e2e/panel-typography.png' });
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
