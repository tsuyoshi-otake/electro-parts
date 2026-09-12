import { chromium, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { E2E_EXTENSION_DIR, E2E_SITE_DIR } from './global-setup.ts';

test('M5Stack extension selects USD variants and preserves the theme without fetching again',async()=>{
  const scratch=path.join(process.env['USERPROFILE']??process.env['HOME']??'.','tmp','electro-m5stack-tests');
  await mkdir(scratch,{recursive:true});const profile=await mkdtemp(path.join(scratch,'profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,
    args:['--enable-gpu',`--disable-extensions-except=${E2E_EXTENSION_DIR}`,`--load-extension=${E2E_EXTENSION_DIR}`]});
  try {
    const requests:string[]=[];
    const html=gunzipSync(await readFile('tests/fixtures/m5stack/product.html.gz')).toString();
    await context.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='tsuyoshi-otake.github.io') {
        requests.push(u.href);
        await route.fulfill({contentType:'application/json',body:await readFile(path.join(E2E_SITE_DIR,u.pathname.replace(/^\/electro-parts\//,'')))});
      } else if(u.hostname==='shop.m5stack.com'&&u.pathname.includes('/products/')) {
        await route.fulfill({contentType:'text/html',body:html});
      } else await route.fulfill({status:204,body:''});
    });
    const page=await context.newPage();
    await page.goto('https://shop.m5stack.com/products/m5stamp-lora-module-sx1262');
    const panel=page.locator('#electronics-price-history-root');
    await expect(page.locator('.product-wrapper + #electronics-price-history-root')).toBeAttached();
    await expect(panel).toContainText('$5.50');await expect(panel).toContainText('USD');
    await expect(panel.locator('section')).toHaveAttribute('data-theme','light');
    await panel.getByLabel('バリエーション').selectOption('50308212326657');
    await expect(panel).toContainText('$7.95');await expect(panel).toContainText('税区分不明');
    await panel.scrollIntoViewIfNeeded();await expect(panel.locator('svg.eph-chart')).toBeVisible();
    await panel.getByRole('button',{name:'ダーク',exact:true}).click();
    await expect(panel.locator('section')).toHaveAttribute('data-theme','dark');
    expect(requests).toHaveLength(2);
    await panel.screenshot({path:'test-results/e2e/m5stack-variant.png'});
    await page.reload();await expect(panel.locator('section')).toHaveAttribute('data-theme','dark');
    await expect(panel).not.toContainText('取得できませんでした');
    await page.setViewportSize({width:390,height:844});
    await panel.getByLabel('バリエーション').selectOption('50308212326657');
    await expect(panel).toContainText('$7.95');
    const bounds=await panel.getByLabel('バリエーション').boundingBox();
    const panelBounds=await panel.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(panelBounds!.width);
    expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(panelBounds!.x+panelBounds!.width);
    await panel.screenshot({path:'test-results/e2e/m5stack-narrow.png'});
  } finally {await context.close();await rm(profile,{recursive:true,force:true});}
});
