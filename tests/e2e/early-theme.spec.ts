import { chromium, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { E2E_EXTENSION_DIR } from './global-setup.ts';

test('saved theme applies while parsing is blocked, before DOMContentLoaded on all stores', async () => {
  const scratch = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', 'tmp', 'electro-early-theme');
  await mkdir(scratch, { recursive: true });
  const profile = await mkdtemp(path.join(scratch, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--enable-gpu', `--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`] });
  let release = () => {};
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'eph:theme': 'dark' }));
    for (const origin of ['https://shop.m5stack.com', 'https://www.switch-science.com', 'https://akizukidenshi.com']) {
      const page = await context.newPage();
      const blocked = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/*', async route => {
        if (route.request().url().endsWith('/hold.js')) {
          await blocked;
          await route.fulfill({ contentType: 'text/javascript', body: '' });
        } else await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>body{background:white}</style></head><body><p>Store content</p><script src="/hold.js"></script></body></html>' });
      });
      await page.goto(origin + '/', { waitUntil: 'commit' });
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(62, 62, 62)');
      expect(await page.evaluate(() => document.readyState)).toBe('loading');
      await expect(page.locator('#electronics-page-theme-control')).toHaveCount(0);
      release();
      await page.waitForLoadState('domcontentloaded');
      await page.getByRole('button', { name: 'ライトに戻す' }).click();
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await worker.evaluate(() => chrome.storage.local.set({ 'eph:theme': 'dark' }));
      await page.close();
    }
  } finally {
    release();
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
