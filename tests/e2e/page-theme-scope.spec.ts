import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_EXTENSION_DIR } from './global-setup.ts';

/**
 * Where the saved dark page theme applies, and what it must not flatten. The
 * loaded extension runs on saved store pages served by route interception; no
 * request leaves the browser (the data origin answers 404, so product pages
 * show the panel's error state, which these tests do not inspect).
 */

const FIXTURES = path.resolve(process.cwd(), 'tests', 'fixtures');
const FLATTENED_TEXT = 'rgb(230, 237, 243)';
const PLAIN = '<!doctype html><html><head><style>body{background:white}</style></head><body><p>Store content</p></body></html>';

async function saved(store: string, name: string): Promise<string> {
  return gunzipSync(await readFile(path.join(FIXTURES, store, 'html', `${name}.html.gz`))).toString('utf8');
}

function contrastWithPageBase(rgb: string): number {
  const channels = (rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const base = 0.2126 * 0.0482 + 0.7152 * 0.0482 + 0.0722 * 0.0482; // #3e3e3e
  return (Math.max(lum, base) + 0.05) / (Math.min(lum, base) + 0.05);
}

async function withDarkExtension(run: (context: BrowserContext, worker: Worker) => Promise<void>): Promise<void> {
  const scratch = path.join(process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.', 'tmp', 'electro-page-theme-scope');
  await mkdir(scratch, { recursive: true });
  const profile = await mkdtemp(path.join(scratch, 'profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--enable-gpu', `--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'eph:theme': 'dark' }));
    await context.route('https://tsuyoshi-otake.github.io/**', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await run(context, worker);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

async function serve(page: Page, pages: Record<string, string>): Promise<void> {
  await page.route(/^https:\/\/(akizukidenshi\.com|www\.switch-science\.com|shop\.m5stack\.com)\//, async (route) => {
    const body = pages[route.request().url()];
    if (body === undefined) await route.fulfill({ status: 204, body: '' }); // images, css, fonts
    else await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
}

const colorOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);

test('the dark page theme stays off cart, checkout and account pages', async () => {
  await withDarkExtension(async (context) => {
    const page = await context.newPage();
    // Chrome matches the path plus the query, so the home page needs both `/` and `/?*`.
    const inScope = ['https://shop.m5stack.com/', 'https://shop.m5stack.com/?ref=x'];
    const outOfScope = ['https://akizukidenshi.com/catalog/cart/cart.aspx', 'https://akizukidenshi.com/catalog/customer/menu.aspx',
      'https://www.switch-science.com/cart', 'https://www.switch-science.com/account/login', 'https://shop.m5stack.com/checkout'];
    await serve(page, Object.fromEntries([...inScope, ...outOfScope].map((url) => [url, PLAIN])));
    // The control: the same plain page inside the scope turns dark.
    for (const url of inScope) {
      await page.goto(url);
      await expect(page.locator('html'), url).toHaveAttribute('data-eph-page-theme', 'dark');
    }
    for (const url of outOfScope) {
      await page.goto(url, { waitUntil: 'load' });
      // The script would claim the page within milliseconds of document_start.
      await page.waitForTimeout(1000);
      await expect(page.locator('body'), url).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      expect(await page.locator('html').evaluate((el) => [el.getAttribute('data-eph-page-theme'), el.getAttribute('data-eph-owner')]), url).toEqual([null, null]);
      await expect(page.locator('#electronics-page-theme-control')).toHaveCount(0);
    }
  });
});

test('the dark page theme keeps semantic colors on saved store pages', async () => {
  await withDarkExtension(async (context) => {
    const page = await context.newPage();
    const list = 'https://akizukidenshi.com/catalog/r/rsbcomp1/';
    const product = 'https://akizukidenshi.com/catalog/g/g117209/';
    const discount = 'https://www.switch-science.com/products/6262';
    await serve(page, { [list]: await saved('akizuki', 'rsbcomp1'), [product]: await saved('akizuki', 'g117209'), [discount]: await saved('switch-science', '6262') });
    const shots = path.resolve(process.cwd(), 'test-results', 'e2e');

    await page.goto(list);
    await expect(page.locator('html')).toHaveAttribute('data-eph-page-theme', 'dark');
    const stock: string[] = [];
    for (const status of ['green', 'orange', 'gray', 'purple', 'blue']) {
      const color = await colorOf(page, `.block-cart-i--stock-info-${status}`);
      expect(color, status).not.toBe(FLATTENED_TEXT);
      expect(contrastWithPageBase(color), `${status} ${color}`).toBeGreaterThanOrEqual(4.5);
      stock.push(color);
    }
    expect(new Set(stock).size).toBe(5);
    await page.locator('.block-cart-i--stock-info-purple').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'page-theme-akizuki-stock.png') });

    await page.goto(product);
    await expect(page.locator('html')).toHaveAttribute('data-eph-page-theme', 'dark');
    const inStock = await colorOf(page, '.block-goods-detail--stock-info-green');
    expect(inStock).not.toBe(FLATTENED_TEXT);
    expect(contrastWithPageBase(inStock)).toBeGreaterThanOrEqual(4.5);

    await page.goto(discount);
    await expect(page.locator('html')).toHaveAttribute('data-eph-page-theme', 'dark');
    for (const selector of ['.discount-table > p', '.discount-table td']) {
      const color = await colorOf(page, selector);
      expect(color, selector).not.toBe(FLATTENED_TEXT);
      expect(contrastWithPageBase(color), `${selector} ${color}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.locator('.discount-table').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, 'page-theme-switch-science-discount.png') });
  });
});
