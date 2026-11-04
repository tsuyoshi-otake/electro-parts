import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { collectM5StackFixture, loadM5StackNormalized, m5stackFixture } from '../helpers/m5stack.ts';
import { M5STACK_STORE } from '../../src/adapters/m5stack/identity.ts';
import { shopifyHandleFromKey, shopifyPageKey } from '../../src/adapters/shopify/identity.ts';
import { decimalMinor } from '../../src/adapters/shopify/rawSchema.ts';

const m5stackPageKey = (handle: string) => shopifyPageKey(M5STACK_STORE, handle);
const m5stackHandleFromKey = (key: string) => shopifyHandleFromKey(M5STACK_STORE, key);
const usdCents = (raw: string) => decimalMinor(raw, 'USD');
import { m5stackPageAdapter } from '../../userscript/adapters/m5stack.ts';

describe('M5Stack full public catalogue',()=>{
  it('covers every sitemap product and preserves every variant in six requests',async()=>{
    const r=await collectM5StackFixture();
    expect(r.errors).toEqual([]);expect(r.complete).toBe(true);
    expect(r.requests).toHaveLength(6);expect(r.raw.items).toHaveLength(664);
    expect(r.raw.items.reduce((n,p)=>n+p.variants.length,0)).toBe(706);
    const normalized=await loadM5StackNormalized();expect(normalized.products).toHaveLength(664);
    const product=normalized.products.find(p=>p.pageKey===m5stackPageKey('m5stamp-lora-module-sx1262'))!;
    expect(product.offers).toHaveLength(3);
    expect(product.offers.map(o=>o.priceQuotes[0]?.minAmountMinor)).toEqual([550,750,795]);
    expect(product.offers[0]?.priceQuotes[0]).toMatchObject({currency:'USD',taxTreatment:'unknown'});
    expect(product.offers[0]?.availability).toMatchObject({quantity:null,quantitySemantics:'not_exposed'});
  });
  it.each(['currency','missing product','duplicate','missing availability','bad price','page cap'])('fails closed: %s',async(reason)=>{
    const r=await collectM5StackFixture((url,body)=>{
      if(reason==='currency'&&new URL(url).pathname==='/')return body.replace('USD','EUR');
      if(!url.includes('products.json'))return body;
      const p=JSON.parse(body);
      if(reason==='missing product')p.products.shift();
      if(reason==='duplicate')p.products[1]=p.products[0];
      if(reason==='missing availability')delete p.products[0].variants[0].available;
      if(reason==='bad price')p.products[0].variants[0].price='5.555';
      return JSON.stringify(p);
    },reason==='page cap'?{maxPages:1}:{});
    expect(r.complete).toBe(false);expect(r.errors.length).toBeGreaterThan(0);
  });
  it('roundtrips Unicode and literal underscores without collision',()=>{
    for(const handle of ['2-✖-15-pinheader-bus-socket-smd-for-13-2-module-10-sets','literal_20','a'.repeat(100)])
      expect(m5stackHandleFromKey(m5stackPageKey(handle))).toBe(handle);
    expect(()=>m5stackPageKey('../escape')).toThrow();
    expect(usdCents('7.95')).toBe(795);expect(()=>usdCents('7.955')).toThrow();
  });
  it('mounts in the saved real product layout and rejects canonical mismatch',()=>{
    const url='https://shop.m5stack.com/products/m5stamp-lora-module-sx1262';
    const dom=new JSDOM(gunzipSync(readFileSync('tests/fixtures/m5stack/product.html.gz')).toString(),{url});
    try {
      expect(m5stackPageAdapter.extractPageKey(dom.window.document,dom.window.location)).toBe('h-m5stamp-lora-module-sx1262');
      // Left column, below the gallery and above the description; clear the purchase
      // column, which floats left below 1024 px.
      const mount=m5stackPageAdapter.findMountPoint(dom.window.document);
      expect(mount?.anchor.classList.contains('product-description')).toBe(true);
      expect(mount?.anchor.parentElement?.classList.contains('product-main')).toBe(true);
      expect(mount?.position).toBe('before');
      expect(mount?.hostStyle).toEqual({clear:'both'});
      // Without a description, below the whole product section, outside the wrapper
      // whose height drives the fixed purchase column.
      dom.window.document.querySelector('.product-main > .product-description')!.remove();
      expect(m5stackPageAdapter.findMountPoint(dom.window.document)?.anchor.classList.contains('product-wrapper')).toBe(true);
      expect(m5stackPageAdapter.findMountPoint(dom.window.document)?.position).toBe('after');
      // One column (measured: 768 px and below): the product form's last child, inside the
      // purchase column. The live page's upsell inserts itself right after the form later.
      expect(m5stackPageAdapter.layoutQuery).toBe('(max-width: 768px)');
      let oneColumn=true;
      dom.window.matchMedia=((query:string)=>({matches:oneColumn&&query===m5stackPageAdapter.layoutQuery})) as unknown as typeof dom.window.matchMedia;
      const narrow=m5stackPageAdapter.findMountPoint(dom.window.document);
      expect(narrow?.anchor.matches('.product-info-wrapper .product__content form.shopify-product-form')).toBe(true);
      expect(narrow?.anchor.querySelector('[id^="AddToCart"]')).not.toBeNull();
      expect(narrow?.position).toBe('append');
      expect(narrow?.hostStyle).toBeUndefined();
      oneColumn=false;
      expect(m5stackPageAdapter.findMountPoint(dom.window.document)?.anchor.classList.contains('product-wrapper')).toBe(true);
      dom.window.document.querySelector('link[rel=canonical]')!.setAttribute('href',url+'-different');
      expect(m5stackPageAdapter.extractPageKey(dom.window.document,dom.window.location)).toBeNull();
    } finally {dom.window.close();}
  });
});

describe('M5Stack stock counts from product pages (#74)', () => {
  const PAGES = { shards: 1, maxPages: 900, maxFailures: 30, maxMinutes: 35 };
  it('reads every product page and records each variant count as site-reported', async () => {
    const { m5stackFixture } = await import('../helpers/m5stack.ts');
    const { m5stackSnapshotAdapter } = await import('../../src/adapters/m5stack/snapshotAdapter.ts');
    const variants = new Map(m5stackFixture().pages.flat().map((p) => [p.handle, p.variants.map((v) => v.id)]));
    const lora = gunzipSync(readFileSync('tests/fixtures/m5stack/product-lora-stock-lines.html.gz')).toString();
    // Every other page carries only the theme's variant options (the script-less layout).
    const options = (handle: string) => variants.get(handle)!.map((id, i) => `<option data-inventory="${i + 5}" value="${id}">`).join('');
    const result = await collectM5StackFixture((url, body) => {
      const m = /\/products\/([^/?]+)$/.exec(new URL(url).pathname);
      if (m === null) return body;
      const handle = decodeURIComponent(m[1]!);
      return handle === 'm5stamp-lora-module-sx1262' ? lora : options(handle);
    }, { maxRequests: 1000, productPages: PAGES });
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.metrics).toMatchObject({ productPagesSelected: 664, productPagesRead: 664, productPagesFailed: 0 });
    expect(result.requests.filter((u) => u.includes('/products/'))).toHaveLength(664);
    const normalized = m5stackSnapshotAdapter.normalize(result.raw, 'a'.repeat(64));
    const offers = normalized.products.find((p) => p.pageKey === m5stackPageKey('m5stamp-lora-module-sx1262'))!.offers;
    expect(offers.map((o) => [o.externalOfferId, o.availability.quantity, o.availability.quantitySemantics])).toEqual([
      ['50308212261121', 139, 'site_reported'],
      ['50308212293889', 187, 'site_reported'],
      ['50308212326657', 63, 'site_reported'],
    ]);
    expect(m5stackSnapshotAdapter.capabilities).toMatchObject({ supportsInventoryQuantity: true, inventoryQuantitySemantics: 'site_reported' });
    expect(m5stackSnapshotAdapter.capabilities).not.toHaveProperty('inventoryQuantityCap');
  });
  it('keeps the catalogue run when the product pages fail, and marks the counts unobserved', async () => {
    const { m5stackSnapshotAdapter } = await import('../../src/adapters/m5stack/snapshotAdapter.ts');
    const result = await collectM5StackFixture((url, body) => (url.includes('/products/') ? '<html>maintenance</html>' : body),
      { maxRequests: 1000, productPages: { ...PAGES, maxFailures: 3 } });
    expect(result.complete).toBe(true);
    expect(result.warnings[0]).toContain('Product pages stopped early (0/664 read): more than 3 failed pages');
    expect(result.requests.filter((u) => u.includes('/products/'))).toHaveLength(4);
    const offer = m5stackSnapshotAdapter.normalize(result.raw, 'a'.repeat(64)).products[0]!.offers[0]!;
    expect(offer.availability).toMatchObject({ quantity: null, quantitySemantics: 'site_reported', quantityUnobserved: true });
  });
  it('without product pages configured, the catalogue alone is read and counts stay not exposed', async () => {
    const result = await collectM5StackFixture();
    expect(result.raw).not.toHaveProperty('pageInventory');
    expect(result.requests.some((u) => u.includes('/products/'))).toBe(false);
    expect((await loadM5StackNormalized()).products[0]!.offers[0]!.availability).toMatchObject({ quantity: null, quantitySemantics: 'not_exposed' });
  });
  describe('a Retry-After longer than two minutes on a product page (#78)', () => {
    // On 2026-11-04 the store answered one product page with Retry-After 130 s. Not a 429: the stage
    // went on to fail the next two pages on the fetcher's block, and stopped on consecutive failures.
    const m5stackFixtureProducts = new Map(m5stackFixture().pages.flat().map((p) => [p.handle, p]));
    const shipped = (JSON.parse(readFileSync('config/m5stack.json', 'utf8')) as { collector: Record<string, unknown> }).collector;
    const options = (url: string, body: string) => {
      const m = /\/products\/([^/?]+)$/.exec(new URL(url).pathname);
      if (m === null) return body;
      const product = m5stackFixtureProducts.get(decodeURIComponent(m[1]!))!;
      return product.variants.map((v) => `<option data-inventory="5" value="${v.id}">`).join('');
    };
    const refuseOnce = () => {
      let refused = false;
      return (url: string) => {
        if (refused || !url.includes('/products/') || !url.endsWith('/products/m5stamp-lora-module-sx1262')) return undefined;
        refused = true;
        return { status: 503, retryAfter: '130' };
      };
    };
    it('is waited out with the shipped settings, and every page is still requested', async () => {
      const result = await collectM5StackFixture(options, shipped, { refuse: refuseOnce() });
      expect(result.complete).toBe(true);
      expect(result.warnings.filter((w) => w.includes('stopped early'))).toEqual([]);
      expect(result.metrics).toMatchObject({ productPagesSelected: 664, productPagesFailed: 0, retries: 1 });
      expect(result.metrics['waitedMs']).toBeGreaterThanOrEqual(130_000);
      expect(result.requests.filter((u) => u.endsWith('/products/m5stamp-lora-module-sx1262'))).toHaveLength(2);
    });
    it('stops the stage at the fetcher default of two minutes', async () => {
      const { maxWaitMs: _, ...defaults } = shipped;
      const result = await collectM5StackFixture(options, defaults, { refuse: refuseOnce() });
      expect(result.complete).toBe(true);
      // The 2026-11-04 run log, as it read then.
      expect(result.warnings[0]).toMatch(/^Product pages stopped early \(\d+\/664 read\): 3 consecutive fetch failures: .*blocked by Retry-After for another 130000 ms$/);
      expect(result.warnings[1]).toContain("exceeding this run's 120000 ms wait limit");
    });
  });
  it('bounds the collector wait limit and defaults it to two minutes', async () => {
    const { shopifyCollectorConfig } = await import('../../src/collectors/shopify/collector.ts');
    const userAgent = 'electro-parts-test/1.0';
    expect(shopifyCollectorConfig({ userAgent }).maxWaitMs).toBe(120_000);
    expect(shopifyCollectorConfig({ userAgent, maxWaitMs: 300_000 }).maxWaitMs).toBe(300_000);
    expect(() => shopifyCollectorConfig({ userAgent, maxWaitMs: 999 })).toThrow('Invalid collector.maxWaitMs');
    expect(() => shopifyCollectorConfig({ userAgent, maxWaitMs: 600_001 })).toThrow('Invalid collector.maxWaitMs');
  });
  it('refuses product page settings for a store without a page reader', async () => {
    const { pimoroniCollector } = await import('../../src/collectors/pimoroni/collector.ts');
    expect(() => pimoroniCollector.validateConfig({ userAgent: 'electro-parts-test/1.0', productPages: PAGES })).toThrow('has no product page reader');
  });
});
