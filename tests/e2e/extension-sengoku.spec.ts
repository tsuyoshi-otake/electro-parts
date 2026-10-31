import { chromium, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

const ORIGIN = 'https://www.sengoku.co.jp';
const DETAIL = `${ORIGIN}/mod/sgk_cart/detail.php`;

test('Sengoku extension shows the history below the product block and keeps the store header colours in dark', async () => {
  const scratch = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', 'tmp', 'electro-sengoku-tests');
  await mkdir(scratch, { recursive: true });
  const profile = await mkdtemp(path.join(scratch, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: ['--enable-gpu', `--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`],
  });
  try {
    const requests: string[] = [];
    const html = await readFile('tests/fixtures/sengoku/detail-EEHD-6N43.html', 'utf8');
    await context.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'tsuyoshi-otake.github.io') {
        requests.push(u.pathname);
        // EEHD-5LAU (checked last) borrows the saved EEHD-6N43 history, so its page has a history to show the related cards under.
        const borrowed = u.pathname.endsWith('/stores/sengoku/products/EEHD-5LAU.json');
        const file = borrowed ? u.pathname.replace('EEHD-5LAU', 'EEHD-6N43') : u.pathname;
        const body = await readFile(path.join(E2E_SITE_DIR, file.replace(/^\/electro-parts\//, '')), 'utf8').catch(() => null);
        await route.fulfill(body === null ? { status: 404, body: 'Not Found' } : { contentType: 'application/json', body: borrowed ? body.replaceAll('EEHD-6N43', 'EEHD-5LAU') : body });
      } else if (`${u.origin}${u.pathname}` === DETAIL) {
        // The saved page answers for any code, as the shop's page does for the code it shows.
        const code = u.searchParams.get('code') ?? '';
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html.replaceAll('EEHD-6N43', code) });
      } else await route.fulfill({ status: 204, body: '' });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
    await page.goto(`${DETAIL}?code=EEHD-6N43`);
    const panel = page.locator('#electronics-price-history-root');
    await expect(panel).toHaveAttribute('data-page-key', 'EEHD-6N43');
    await expect(page.locator('#detail_whole + #electronics-price-history-root')).toBeAttached();
    await expect(panel).toContainText('￥650');
    await expect(panel).toContainText('税込');
    await expect(panel).toContainText('1個');
    await expect(panel).toContainText('在庫なし');
    await expect(panel).not.toContainText('取得できませんでした');
    await expect(panel).not.toContainText('読み込み中');
    await expect(panel.locator('section')).toHaveAttribute('data-theme', 'light');
    // The saved page has no stylesheet; these are the shop's own colors of the bar below the logo and the heading (2026-10-30).
    await page.addStyleTag({ content: '.header_bar { background-color: rgb(5, 125, 255); } h1.item_detail_ttl { background-color: rgb(248, 248, 248); }' });

    await panel.getByRole('button', { name: 'ダーク', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-eph-page-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    await expect(page.locator('#detail_whole')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    // The logo is drawn for the white header.
    await expect(page.locator('#header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.header_bar')).toHaveCSS('background-color', 'rgb(5, 125, 255)');
    await expect(page.locator('h1.item_detail_ttl')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: 'test-results/e2e/sengoku-detail.png' });

    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
    await expect(panel).toContainText('￥650');

    // A code the observation does not hold: the panel says so instead of guessing.
    await page.goto(`${DETAIL}?code=ZZZZ-0000`);
    await expect(panel).toHaveAttribute('data-page-key', 'ZZZZ-0000');
    await expect(panel).not.toContainText('￥650');
    await expect(panel).not.toContainText('読み込み中');
    expect([...new Set(requests)].filter((p) => p.includes('/stores/sengoku/')).sort()).toEqual(['/electro-parts/data/v1/stores/sengoku/manifest.json',
      '/electro-parts/data/v1/stores/sengoku/products/EEHD-6N43.json', '/electro-parts/data/v1/stores/sengoku/products/ZZZZ-0000.json'].sort());

    // 0.6.1: the ATOM Lite (M5STACK-C008) carries the reviewed same products of the other stores as cards with their links.
    requests.length = 0;
    await page.goto(`${DETAIL}?code=EEHD-5LAU`);
    await expect(panel).toHaveAttribute('data-page-key', 'EEHD-5LAU');
    const akizuki = panel.locator(`.store-price[data-relation-id='${JSON.stringify(['akizuki', '117209', 'sengoku', 'EEHD-5LAU'])}']`);
    await expect(akizuki).toContainText('秋月電子');
    await expect(panel.locator(`[data-focus-key='product-${JSON.stringify(['akizuki', '117209', 'sengoku', 'EEHD-5LAU'])}']`)).toHaveAttribute('href', 'https://akizukidenshi.com/catalog/g/g117209/');
    await expect(panel).not.toContainText('読み込み中');
    await expect(panel).not.toContainText('記録価格差');
    const related = requests.filter((p) => p.includes('/products/') && !p.includes('/stores/sengoku/'));
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(8);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
