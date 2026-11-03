import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_SITE_DIR } from './global-setup.ts';

/**
 * A browser without `moveBefore` (Chrome before 133, other engines running the
 * userscript) re-inserts the panel's host when the page switches layout. That
 * drops an open modal out of the top layer and loses focus. The production
 * userscript runs in the page here, with `moveBefore` removed before it loads,
 * on the saved M5Stack page, which drops to one column at 768 px.
 */
test('the settings dialog stays modal and keeps focus when the panel is re-inserted across the layout switch', async ({ page }) => {
  const html = gunzipSync(await readFile('tests/fixtures/m5stack/product.html.gz')).toString();
  const last = Math.floor(Date.now() / 1000) - 3600;
  const rate = JSON.stringify({ result: 'success', base_code: 'USD', time_last_update_unix: last, time_next_update_unix: last + 86400, rates: { USD: 1, JPY: 157.820352 } });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'tsuyoshi-otake.github.io') {
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await readFile(path.join(E2E_SITE_DIR, u.pathname.replace(/^\/electro-parts\//, ''))) });
    } else if (u.hostname === 'open.er-api.com') {
      await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: rate });
    } else if (u.hostname === 'shop.m5stack.com' && u.pathname.includes('/products/')) {
      await route.fulfill({ contentType: 'text/html', body: html });
    } else await route.fulfill({ status: 204, body: '' });
  });
  await page.addInitScript(() => {
    for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype]) delete (proto as { moveBefore?: unknown }).moveBefore;
    const mem = new Map();
    Object.assign(window, {
      GM_getValue: (key: string, fallback: unknown) => mem.get(key) ?? fallback,
      GM_setValue: (key: string, value: unknown) => mem.set(key, value),
      GM_deleteValue: (key: string) => mem.delete(key),
      GM_listValues: () => [...mem.keys()],
      GM_xmlhttpRequest: (d: { url: string; onload(r: unknown): void; onerror(r: unknown): void }) => {
        fetch(d.url).then(async (r) => d.onload({ status: r.status, responseText: await r.text() })).catch(() => d.onerror({ status: 0 }));
      },
    });
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('https://shop.m5stack.com/products/m5stamp-lora-module-sx1262');
  expect(await page.evaluate(() => typeof (document.body as { moveBefore?: unknown }).moveBefore)).toBe('undefined');
  await page.addScriptTag({ content: await readFile(path.join(E2E_SITE_DIR, 'electronics-price-history.user.js'), 'utf8') });

  const panel = page.locator('#electronics-price-history-root');
  await expect(page.locator('.product-main > #electronics-price-history-root + .product-description')).toBeAttached();
  await expect(panel).toContainText('$5.50');
  await panel.getByRole('button', { name: '設定', exact: true }).click();
  const dialog = panel.getByRole('dialog', { name: '表示設定' });
  await expect(dialog).toBeVisible();
  const fee = dialog.getByRole('checkbox', { name: 'カードの海外事務手数料を円換算に含める' });
  await fee.focus();
  const state = () => page.evaluate(() => {
    const shadow = document.getElementById('electronics-price-history-root')!.shadowRoot!;
    return { modal: shadow.querySelector('dialog.settings')!.matches(':modal'), focus: (shadow.activeElement as HTMLElement | null)?.dataset['focusKey'] ?? null };
  });
  expect(await state()).toEqual({ modal: true, focus: 'pref-fee-enabled' });

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator('.product__content form.shopify-product-form > #electronics-price-history-root:last-child')).toBeAttached();
  await expect(dialog).toBeVisible();
  expect(await state()).toEqual({ modal: true, focus: 'pref-fee-enabled' });
  // The panel still counts the dialog open: the re-render a change causes keeps it open.
  await page.keyboard.press('Space');
  await expect(fee).toBeChecked();
  await expect(dialog).toBeVisible();
  expect(await state()).toEqual({ modal: true, focus: 'pref-fee-enabled' });
  await page.screenshot({ path: 'test-results/e2e/layout-fallback-768.png' });

  await page.setViewportSize({ width: 769, height: 900 });
  await expect(page.locator('.product-main > #electronics-price-history-root + .product-description')).toBeAttached();
  expect(await state()).toEqual({ modal: true, focus: 'pref-fee-enabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole('button', { name: '設定', exact: true })).toBeFocused();
});
