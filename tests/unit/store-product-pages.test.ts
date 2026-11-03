import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readM5StackProductPage } from '../../src/collectors/m5stack/productPage.ts';
import { readSwitchScienceProductPage } from '../../src/collectors/switch-science/productPage.ts';

const gz = (path: string) => gunzipSync(readFileSync(path)).toString();
const m5 = (handle: string, offerIds: string[] = []) => ({ key: handle, url: `https://shop.m5stack.com/products/${handle}`, offerIds });
const ss = (handle: string, offerIds = ['1']) => ({ key: handle, url: `https://www.switch-science.com/products/${handle}`, offerIds });

describe('M5Stack product page counts (#74)', () => {
  it('reads every variant from the stock script, including a sold-out one the variant list leaves out', () => {
    // Real page lines, 2026-11-04: the page shows 「10+ In Stock」; the second variant has no <option>.
    const html = gz('tests/fixtures/m5stack/product-tab5-stock-lines.html.gz');
    expect(html).toContain('10+ In Stock');
    expect(readM5StackProductPage(html, m5('m5stack-tab5-iot-development-kit-esp32-p4'))).toEqual({ '46276989255937': 379, '46276989288705': 0 });
  });
  it('agrees with the variant options when both are present', () => {
    const html = gz('tests/fixtures/m5stack/product-lora-stock-lines.html.gz');
    expect(readM5StackProductPage(html, m5('m5stamp-lora-module-sx1262'))).toEqual({ '50308212261121': 139, '50308212293889': 187, '50308212326657': 63 });
  });
  it('falls back to the variant options when the stock script is gone', () => {
    // The 2026-09-12 fixture had its scripts removed.
    expect(readM5StackProductPage(gz('tests/fixtures/m5stack/product.html.gz'), m5('m5stamp-lora-module-sx1262')))
      .toEqual({ '50308212261121': 95, '50308212293889': 100, '50308212326657': 86 });
  });
  it('refuses a page for another product, a disagreement, or a page without counts', () => {
    const html = gz('tests/fixtures/m5stack/product-lora-stock-lines.html.gz');
    expect(() => readM5StackProductPage(html, m5('atom-lite-esp32-development-kit'))).toThrow('page is for m5stamp-lora-module-sx1262');
    expect(() => readM5StackProductPage(html.replace('data-inventory="187"', 'data-inventory="186"'), m5('m5stamp-lora-module-sx1262')))
      .toThrow('variant 50308212293889: script 187 but option 186');
    expect(() => readM5StackProductPage('<html></html>', m5('x'))).toThrow('no stock counts');
    expect(() => readM5StackProductPage(html.replace("variants[2]['inventory_quantity']", "variants[7]['inventory_quantity']"), m5('m5stamp-lora-module-sx1262')))
      .toThrow('beyond 3 variants');
  });
  it('records a negative count as read with no count, rather than showing it or keeping an older one', () => {
    const html = gz('tests/fixtures/m5stack/product-lora-stock-lines.html.gz')
      .replace("variants[1]['inventory_quantity'] = 187", "variants[1]['inventory_quantity'] = -4")
      .replace('data-inventory="187"', 'data-inventory="-4"');
    expect(readM5StackProductPage(html, m5('m5stamp-lora-module-sx1262'))).toEqual({ '50308212261121': 139, '50308212293889': null, '50308212326657': 63 });
  });
});

describe('Switch Science product page counts (#74)', () => {
  it('reads 「在庫数: 9」 and records 「100+」 as the cap', () => {
    expect(readSwitchScienceProductPage(gz('tests/fixtures/switch-science/html/9381.html.gz'), ss('9381', ['42987508662470']))).toEqual({ '42987508662470': 9 });
    expect(readSwitchScienceProductPage(gz('tests/fixtures/switch-science/html/6262.html.gz'), ss('6262'))).toEqual({ '1': 100 });
  });
  it('refuses another product, a second count, an unexpected cap, or several variants', () => {
    const page = gz('tests/fixtures/switch-science/html/9381.html.gz');
    expect(() => readSwitchScienceProductPage(page, ss('6262'))).toThrow('page is for https://www.switch-science.com/products/9381');
    expect(() => readSwitchScienceProductPage(page.replace('<p>在庫数: 9</p>', '<p>在庫数: 9</p><p>在庫数: 3</p>'), ss('9381'))).toThrow('2 stock counts');
    expect(() => readSwitchScienceProductPage(page.replace('<p>在庫数: 9</p>', '<p>在庫数: 50+</p>'), ss('9381'))).toThrow('unexpected cap 50+');
    expect(() => readSwitchScienceProductPage(page.replace('<p>在庫数: 9</p>', ''), ss('9381'))).toThrow('0 stock counts');
    expect(() => readSwitchScienceProductPage(page, ss('9381', ['1', '2']))).toThrow('2 variants share one count');
  });
});
