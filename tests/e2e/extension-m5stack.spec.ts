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
    await expect(page.locator('.product-main > #electronics-price-history-root + .product-description')).toBeAttached();
    await expect(panel).toContainText('$5.50');await expect(panel).toContainText('USD');
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥868');
    await expect(panel.locator('.stats-col > .fx-recorded')).toContainText('記録価格 $5.50');
    await expect(panel.locator('.fx-note a')).toHaveAttribute('href','https://www.exchangerate-api.com');
    await expect(panel.locator('section')).toHaveAttribute('data-theme','light');
    const originalBody = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
    await panel.getByLabel('バリエーション').selectOption('50308212326657');
    await expect(panel).toContainText('$7.95');await expect(panel).toContainText('税区分不明');
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥1,255');
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
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥868');
    // Settings: the card fee is off until chosen; the choice survives a reload and costs no request.
    await panel.getByRole('button',{name:'設定',exact:true}).click();
    const dialog=panel.getByRole('dialog',{name:'表示設定'});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox',{name:'カードの海外事務手数料を円換算に含める'})).not.toBeChecked();
    await dialog.getByRole('checkbox',{name:'カードの海外事務手数料を円換算に含める'}).check();
    await expect(dialog).toBeVisible();
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥900');
    await dialog.getByLabel('カードの種類').selectOption('jcb');
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥882');
    await panel.screenshot({path:'test-results/e2e/m5stack-settings-dark.png'});
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(panel.getByRole('button',{name:'設定',exact:true})).toBeFocused();
    await page.reload();
    await expect(panel.locator('.stats-col > .hero-value')).toHaveText('約 ￥882');
    await expect(panel.locator('.stats-col > .fx-recorded')).toContainText('カード手数料 1.6%込み');
    await expect(panel.locator('.fx-note')).toContainText('JCBカード（JCB発行）');
    expect(rateRequests).toEqual(['https://open.er-api.com/v6/latest/USD']);
    // One column at 768 px and below: the same panel moves to the end of the product form (under add to cart),
    // and an open settings dialog stays open and modal through the move.
    await panel.getByRole('button',{name:'設定',exact:true}).click();
    await expect(dialog).toBeVisible();
    await page.setViewportSize({width:768,height:900});
    await expect(page.locator('.product__content form.shopify-product-form > #electronics-price-history-root:last-child')).toBeAttached();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.setViewportSize({width:769,height:900});
    await expect(page.locator('.product-main > #electronics-price-history-root + .product-description')).toBeAttached();
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator('.product__content form.shopify-product-form > #electronics-price-history-root:last-child')).toBeAttached();
    // The live shop's upsell inserts itself right after the form once its script loads: it lands below the panel.
    expect(await page.evaluate(()=>{
      const widget=document.createElement('div');widget.id='productBoughtTogether';widget.style.height='400px';
      document.querySelector('.product__content form.shopify-product-form')!.after(widget);
      return document.getElementById('electronics-price-history-root')!.getBoundingClientRect().bottom<=widget.getBoundingClientRect().top;
    })).toBe(true);
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
