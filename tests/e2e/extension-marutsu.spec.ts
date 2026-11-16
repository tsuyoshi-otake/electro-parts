import { chromium, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

const ORIGIN = 'https://www.marutsu.co.jp';

test('Marutsu extension shows the history below the product name heading', async () => {
  const scratch = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', 'tmp', 'electro-marutsu-tests');
  await mkdir(scratch, { recursive: true });
  const profile = await mkdtemp(path.join(scratch, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: ['--enable-gpu', `--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`],
  });
  try {
    const requests: string[] = [];
    const html = await readFile('tests/fixtures/marutsu/detail-40938.html', 'utf8');
    await context.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'tsuyoshi-otake.github.io') {
        requests.push(u.pathname);
        const body = await readFile(path.join(E2E_SITE_DIR, u.pathname.replace(/^\/electro-parts\//, '')), 'utf8').catch(() => null);
        await route.fulfill(body === null ? { status: 404, body: 'Not Found' } : { contentType: 'application/json', body });
      } else if (u.hostname === 'www.marutsu.co.jp' && /^\/pc\/i\/\d+\/$/.test(u.pathname)) {
        // The reconstructed detail page answers for any product id, as the shop's page does for the id in its address.
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      } else await route.fulfill({ status: 204, body: '' });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
    await page.goto(`${ORIGIN}/pc/i/2335443/`);
    const panel = page.locator('#electronics-price-history-root');
    await expect(panel).toHaveAttribute('data-page-key', '2335443');
    await expect(page.locator('h1 + #electronics-price-history-root')).toBeAttached();
    await expect(panel).toContainText('￥471');
    await expect(panel).toContainText('税込');
    await expect(panel).toContainText('1個');
    await expect(panel).toContainText('在庫数 23');
    await expect(panel).not.toContainText('取得できませんでした');
    await expect(panel).not.toContainText('読み込み中');
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: 'test-results/e2e/marutsu-detail.png' });

    // A product id the observation does not hold: the panel says so instead of guessing.
    await page.goto(`${ORIGIN}/pc/i/9999999/`);
    await expect(panel).toHaveAttribute('data-page-key', '9999999');
    await expect(panel).not.toContainText('￥471');
    await expect(panel).not.toContainText('読み込み中');
    expect([...new Set(requests)].filter((p) => p.includes('/stores/marutsu/')).sort()).toEqual(['/electro-parts/data/v1/stores/marutsu/manifest.json',
      '/electro-parts/data/v1/stores/marutsu/products/2335443.json', '/electro-parts/data/v1/stores/marutsu/products/9999999.json'].sort());
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
