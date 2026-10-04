import { chromium, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

test('M5Stack extension selects USD variants, shows a daily yen reference and preserves the theme without fetching again',async()=>{
  const scratch=path.join(process.env['USERPROFILE']??process.env['HOME']??'.','tmp','electro-m5stack-tests');
  await mkdir(scratch,{recursive:true});const profile=await mkdtemp(path.join(scratch,'profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,
    args:['--enable-gpu',`--disable-extensions-except=${E2E_EXTENSION_DIR}`,`--load-extension=${E2E_EXTENSION_DIR}`]});
  try {
    const requests:string[]=[];const rateRequests:string[]=[];
    // ExchangeRate-API's open endpoint answers with CORS for any origin; the worker reads it without a host permission.
    const last=Math.floor(Date.now()/1000)-3600;
    const rate=JSON.stringify({result:'success',base_code:'USD',time_last_update_unix:last,time_next_update_unix:last+86400,rates:{USD:1,JPY:157.820352}});
    const html=gunzipSync(await readFile('tests/fixtures/m5stack/product.html.gz')).toString();
    await context.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='tsuyoshi-otake.github.io') {
        requests.push(u.href);
        await route.fulfill({contentType:'application/json',body:await readFile(path.join(E2E_SITE_DIR,u.pathname.replace(/^\/electro-parts\//,'')))});
      } else if(u.hostname==='open.er-api.com') {
        rateRequests.push(u.href);
        await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:rate});
      } else if(u.hostname==='shop.m5stack.com'&&u.pathname.includes('/products/')) {
        await route.fulfill({contentType:'text/html',body:html});
      } else await route.fulfill({status:204,body:''});
    });
    const page=await context.newPage();
    await page.goto('https://shop.m5stack.com/products/m5stamp-lora-module-sx1262');
    const panel=page.locator('#electronics-price-history-root');
    await expect(page.locator('.product-wrapper + #electronics-price-history-root')).toBeAttached();
    await expect(panel).toContainText('$5.50');await expect(panel).toContainText('USD');
    await expect(panel.locator('.fx-value')).toHaveText('約 ￥868（円換算の参考値）');
    await expect(panel.locator('.fx a')).toHaveAttribute('href','https://www.exchangerate-api.com');
    await expect(panel.locator('section')).toHaveAttribute('data-theme','light');
    const originalBody = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
    await panel.getByLabel('バリエーション').selectOption('50308212326657');
    await expect(panel).toContainText('$7.95');await expect(panel).toContainText('税区分不明');
    await expect(panel.locator('.fx-value')).toHaveText('約 ￥1,255（円換算の参考値）');
    await panel.scrollIntoViewIfNeeded();await expect(panel.locator('svg.eph-chart')).toBeVisible();
    await panel.getByRole('button',{name:'ダーク',exact:true}).click();
    await expect(panel.locator('section')).toHaveAttribute('data-theme','dark');
    await expect(page.locator('html')).toHaveAttribute('data-eph-page-theme','dark');
    await expect(page.locator('body')).toHaveCSS('background-color','rgb(62, 62, 62)');
    expect(await page.locator('img').evaluateAll(images => images.every(img => getComputedStyle(img).filter === 'none'))).toBe(true);
    expect(requests).toHaveLength(2);
    await panel.screenshot({path:'test-results/e2e/m5stack-variant.png'});
    await page.reload();await expect(panel.locator('section')).toHaveAttribute('data-theme','dark');
    await expect(page.locator('body')).toHaveCSS('background-color','rgb(62, 62, 62)');
    await expect(panel).not.toContainText('取得できませんでした');
    // The stored rate serves the reload: one rate request per day, not per page.
    await expect(panel.locator('.fx-value')).toContainText('約 ￥');
    expect(rateRequests).toEqual(['https://open.er-api.com/v6/latest/USD']);
    await page.setViewportSize({width:390,height:844});
    await panel.getByLabel('バリエーション').selectOption('50308212326657');
    await expect(panel).toContainText('$7.95');
    const bounds=await panel.getByLabel('バリエーション').boundingBox();
    const panelBounds=await panel.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(panelBounds!.width);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(panelBounds!.x+panelBounds!.width);
    await panel.screenshot({path:'test-results/e2e/m5stack-narrow.png'});
    await panel.getByRole('button',{name:'ライト',exact:true}).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-eph-page-theme','dark');
    await expect(page.locator('body')).toHaveCSS('background-color',originalBody);
  } finally {await context.close();await rm(profile,{recursive:true,force:true});}
});
