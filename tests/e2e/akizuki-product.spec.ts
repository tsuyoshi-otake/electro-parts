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
  window.GM_listValues = () => [...mem.keys()];
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
  await expect(section).toContainText('在庫数 781');
  await expect(section).toContainText('観測期間 2026-08-02〜2026-09-06(2 回)');
  // The chart is drawn lazily once visible.
  await panel(page).scrollIntoViewIfNeeded();
  await expect(page.locator('#electronics-price-history-root svg[role="img"]')).toBeVisible();
  await expect(page.locator('#electronics-price-history-root svg[role="img"] circle')).toHaveCount(2);
  // Akizuki shows a stock count; the recorded counts (20, then 781) are drawn under the price chart.
  await expect(page.locator('#electronics-price-history-root .stock-chart circle')).toHaveCount(2);
  await expect(page.locator('#electronics-price-history-root .stock-chart circle').last()).toHaveAttribute('aria-label', /在庫数 781$/);
  await panel(page).screenshot({ path: path.resolve(process.cwd(), 'test-results', 'e2e', 'panel-109951.png') });
  await page.locator('.block-goods-detail').screenshot({ path: path.resolve(process.cwd(), 'test-results', 'e2e', 'detail-109951.png') });
  // #76: the line's value under the pointer, on both charts, inside the chart.
  const priceChart = page.locator('#electronics-price-history-root svg[role="img"]');
  const [first, second] = await Promise.all([0, 1].map((i) => priceChart.locator('circle.eph-dot').nth(i).boundingBox()));
  await page.mouse.move((first!.x + second!.x) / 2 + first!.width / 2, first!.y + first!.height / 2);
  await expect(priceChart.locator('.eph-readout-text')).toHaveText([/^2026-08-\d\d$/, '￥1,150']);
  await expect(priceChart.locator('.eph-readout > g > .eph-readout-marker')).toHaveCount(1);
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2);
  await expect(priceChart.locator('.eph-readout-text')).toHaveText(['2026-09-06', '￥1,200']);
  const chartBox = (await priceChart.boundingBox())!;
  const labelBox = (await priceChart.locator('.eph-readout-label').boundingBox())!;
  expect(labelBox.x).toBeGreaterThanOrEqual(chartBox.x);
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width);
  await panel(page).screenshot({ path: path.resolve(process.cwd(), 'test-results', 'e2e', 'panel-109951-readout.png') });
  const stockDot = (await page.locator('#electronics-price-history-root .stock-chart circle.eph-dot').last().boundingBox())!;
  await page.mouse.move(stockDot.x + stockDot.width / 2, stockDot.y + stockDot.height / 2);
  await expect(page.locator('#electronics-price-history-root .stock-chart .eph-readout-text')).toHaveText(['2026-09-06', '在庫数 781']);
  // Leaving clears it, and the price chart's readout went when the pointer left that chart.
  await expect(priceChart.locator('.eph-readout-text')).toHaveCount(0);
  await page.mouse.move(1, 1);
  await expect(page.locator('#electronics-price-history-root .eph-readout-text')).toHaveCount(0);
  // Page content untouched, panel first in the centre pane at full content width.
  await expect(page.locator('h1.block-goods-name--text')).toHaveText('[109951]FT232RQ USBシリアル変換モジュールキット');
  expect(await page.locator('.pane-goods-center > #electronics-price-history-root:first-child').count()).toBe(1);
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

test('period buttons redraw both charts for the chosen window and the estimated sales follow it (#85)', async ({ page }) => {
  await setup(page, { dataOnline: true });
  await page.goto(PRODUCT_URL);
  await injectUserscript(page);
  await panel(page).scrollIntoViewIfNeeded();
  const root = '#electronics-price-history-root';
  const priceChart = page.locator(`${root} svg[role="img"]`);
  await expect(priceChart).toBeVisible();
  const period = (label: string) => page.locator(`${root} .period-controls button`, { hasText: label });
  await expect(page.locator(`${root} .period-controls button`)).toHaveText(['1ヶ月', '3ヶ月', '半年', '1年', '2年', '3年', '全期間']);
  await expect(page.locator(`${root} .period-controls button[aria-pressed="true"]`)).toHaveText('全期間');
  // The whole record (2026-08-02 to 2026-09-06): both points, and the rise 20 → 781 is added stock, never a sale.
  const summary = page.locator(`${root} .sales-summary`);
  await expect(summary).toContainText('推定販売数（2026-08-02〜2026-09-06');
  await expect(summary).toContainText('0個');
  await expect(summary).toContainText('増加 1 回（+761個）');
  await expect(priceChart.locator('circle')).toHaveCount(2);
  await expect(page.locator(`${root} .stock-chart circle`)).toHaveCount(2);
  // 1ヶ月 = the 30 days before the last observation, so it starts on 2026-08-07: only the second point is inside.
  await period('1ヶ月').click();
  await expect(period('1ヶ月')).toHaveAttribute('aria-pressed', 'true');
  await expect(period('全期間')).toHaveAttribute('aria-pressed', 'false');
  await expect(priceChart.locator('circle')).toHaveCount(1);
  await expect(page.locator(`${root} .stock-chart circle`)).toHaveCount(1);
  await expect(priceChart).toHaveAttribute('aria-label', /^2026-08-07〜2026-09-06 の価格推移/);
  await expect(summary).toContainText('推定販売数（2026-08-07〜2026-09-06');
  // The redrawn chart reads the price in effect at the start of the window (1150, set before it) and the last point.
  const plot = (await priceChart.locator('.eph-readout-hit').boundingBox())!;
  await page.mouse.move(plot.x + plot.width * 0.1, plot.y + plot.height / 2);
  await expect(priceChart.locator('.eph-readout-text')).toHaveText([/^2026-08-\d\d$/, '￥1,150']);
  const dot = (await priceChart.locator('circle.eph-dot').boundingBox())!;
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await expect(priceChart.locator('.eph-readout-text')).toHaveText(['2026-09-06', '￥1,200']);
  await page.mouse.move(1, 1);
  // The line starts inside the plot: nothing is drawn over the axis labels.
  // In viewBox units, so the stroke's own overflow (a miter join reaches about 5px) is not counted.
  const [lineLeft, plotLeft] = await priceChart.evaluate((svg) => [(svg.querySelector('path.eph-line') as SVGGraphicsElement).getBBox().x, Number(svg.querySelector('.eph-readout-hit')!.getAttribute('x'))] as const);
  expect(lineLeft).toBeGreaterThanOrEqual(plotLeft);
  await panel(page).screenshot({ path: path.resolve(process.cwd(), 'test-results', 'e2e', 'panel-109951-period-1m.png') });
  // A period longer than the record shows the record; going back to the whole record restores everything.
  await period('3年').click();
  await expect(priceChart.locator('circle')).toHaveCount(2);
  await expect(priceChart).toHaveAttribute('aria-label', /^2026-08-02〜2026-09-06 の価格推移/);
  await period('全期間').click();
  await expect(priceChart.locator('circle')).toHaveCount(2);
  await expect(page.locator(`${root} .stock-chart circle`)).toHaveCount(2);
  // The buttons are touch-sized buttons of the panel's own kind: keyboard operable, named, no network traffic.
  await period('1年').focus();
  await page.keyboard.press('Enter');
  await expect(period('1年')).toHaveAttribute('aria-pressed', 'true');
  const requests = await page.evaluate(() => (window as unknown as { __gmRequests: string[] }).__gmRequests);
  expect(requests).toHaveLength(2);
});
