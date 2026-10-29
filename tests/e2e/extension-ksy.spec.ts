import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

const ORIGIN = 'https://raspberry-pi.ksyic.com';

/**
 * What the shop's own script does when a product is opened from the list: it
 * fills the dialog and shows it, without changing the address. The saved page
 * has its scripts removed, so the spec plays that part in the page's world.
 */
async function openProduct(page: Page, id: string): Promise<void> {
  await page.evaluate(([productId, origin]) => {
    document.getElementById('detail')!.style.display = 'block';
    document.getElementById('dt_id')!.textContent = productId!;
    document.getElementById('dt_Permalink')!.setAttribute('href', `${origin}/main/index/pdp.id/${productId}/pdp.open/${productId}`);
  }, [id, ORIGIN]);
}

test('KSY extension follows the product dialog without navigation and keeps the store header colours in dark', async () => {
  const scratch = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', 'tmp', 'electro-ksy-tests');
  await mkdir(scratch, { recursive: true });
  const profile = await mkdtemp(path.join(scratch, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: ['--enable-gpu', `--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`],
  });
  try {
    const requests: string[] = [];
    const html = gunzipSync(await readFile('tests/fixtures/ksy/product-page.html.gz')).toString();
    await context.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'tsuyoshi-otake.github.io') {
        requests.push(u.pathname);
        // Pages answers 404 for a product it has not published; the saved site holds only the fixture histories.
        const body = await readFile(path.join(E2E_SITE_DIR, u.pathname.replace(/^\/electro-parts\//, ''))).catch(() => null);
        await route.fulfill(body === null ? { status: 404, body: 'Not Found' } : { contentType: 'application/json', body });
      } else if (u.origin === ORIGIN && (u.pathname === '/main/index' || u.pathname.startsWith('/main/index/pdp.id/'))) {
        await route.fulfill({ contentType: 'text/html', body: html });
      } else await route.fulfill({ status: 204, body: '' });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
    await page.goto(`${ORIGIN}/main/index/pdp.id/1094/pdp.open/1094`);
    const panel = page.locator('#electronics-price-history-root');
    // Until the shop shows a product there is nothing to attach the history to.
    await page.waitForTimeout(500);
    await expect(panel).toHaveCount(0);

    await openProduct(page, '1094');
    await expect(panel).toHaveAttribute('data-page-key', '1094');
    await expect(page.locator('#detail #electronics-price-history-root + #dt_Description')).toBeAttached();
    await expect(panel).toContainText('￥913');
    await expect(panel).toContainText('表示在庫数 363');
    await expect(panel).toContainText('税込');
    await expect(panel).not.toContainText('取得できませんでした');
    await expect(panel.locator('section')).toHaveAttribute('data-theme', 'light');
    // 0.5.1: the reviewed same product at the other stores. The saved site has the Akizuki Pico 2, not the Switch Science one.
    const related = (id: string[]) => panel.locator(`.store-price[data-relation-id='${JSON.stringify(id)}']`);
    await expect(related(['akizuki', '129604', 'ksy', '1094'])).toContainText('秋月電子');
    await expect(related(['switch-science', '9809', 'ksy', '1094'])).toContainText('他店の履歴はまだ記録されていません');
    await expect(panel).not.toContainText('読み込み中');

    await openProduct(page, '483');
    await expect(panel).toHaveAttribute('data-page-key', '483');
    await expect(panel).toContainText('￥6,930');
    await expect(panel).toContainText('準備中');
    await expect(panel).not.toContainText('￥913');
    await expect(panel).toHaveCount(1);

    await panel.getByRole('button', { name: 'ダーク', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-eph-page-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    await expect(page.locator('#detail > .window-body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    // The logos are drawn for the white header, and the dialog title keeps its white text.
    await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('#detail > .title')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: 'test-results/e2e/ksy-dialog.png' });
    // Closing the dialog closes the panel; the light reset stands in for its theme switch until the next product.
    const reset = page.locator('#electronics-page-theme-control');
    await expect(reset).toHaveCount(0);
    await page.evaluate(() => { document.getElementById('detail')!.style.display = 'none'; });
    await expect(panel).toHaveCount(0);
    await expect(reset).toHaveCount(1);
    await openProduct(page, '483');
    await expect(panel).toContainText('￥6,930');
    await expect(reset).toHaveCount(0);
    expect(requests.filter((p) => p.includes('/stores/ksy/'))).toEqual(['/electro-parts/data/v1/stores/ksy/manifest.json',
      '/electro-parts/data/v1/stores/ksy/products/1094.json', '/electro-parts/data/v1/stores/ksy/products/483.json']);
    expect(requests.filter((p) => !p.includes('/stores/ksy/')).sort()).toEqual(['/electro-parts/data/v1/stores/akizuki/manifest.json',
      '/electro-parts/data/v1/stores/akizuki/products/129604.json', '/electro-parts/data/v1/stores/switch-science/manifest.json',
      '/electro-parts/data/v1/stores/switch-science/products/9809.json']);

    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    await openProduct(page, '1094');
    await expect(panel.locator('section')).toHaveAttribute('data-theme', 'dark');
    await expect(panel).toContainText('￥913');
    await panel.getByRole('button', { name: 'ライト', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-eph-page-theme', 'dark');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
