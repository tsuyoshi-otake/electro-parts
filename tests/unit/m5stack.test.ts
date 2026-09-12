import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { collectM5StackFixture, loadM5StackNormalized } from '../helpers/m5stack.ts';
import { m5stackHandleFromKey, m5stackPageKey } from '../../src/adapters/m5stack/identity.ts';
import { usdCents } from '../../src/adapters/m5stack/rawSchema.ts';
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
      expect(m5stackPageAdapter.findMountPoint(dom.window.document)?.anchor.classList.contains('product-wrapper')).toBe(true);
      expect(m5stackPageAdapter.findMountPoint(dom.window.document)?.position).toBe('after');
      dom.window.document.querySelector('link[rel=canonical]')!.setAttribute('href',url+'-different');
      expect(m5stackPageAdapter.extractPageKey(dom.window.document,dom.window.location)).toBeNull();
    } finally {dom.window.close();}
  });
});
