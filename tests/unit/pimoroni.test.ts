import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { collectPimoroniFixture, loadPimoroniNormalized } from '../helpers/pimoroni.ts';
import { PIMORONI_STORE } from '../../src/adapters/pimoroni/identity.ts';
import { pimoroniSnapshotAdapter } from '../../src/adapters/pimoroni/snapshotAdapter.ts';
import { shopifyPageKey } from '../../src/adapters/shopify/identity.ts';
import { noRedirectTransport } from '../../src/collectors/politeFetcher.ts';
import { pimoroniPageAdapter } from '../../userscript/adapters/pimoroni.ts';

const presto = shopifyPageKey(PIMORONI_STORE, 'presto');
const loc = (url: string) => { const u = new URL(url); return { hostname: u.hostname, pathname: u.pathname, search: u.search }; };
const savedPage = () => gunzipSync(readFileSync('tests/fixtures/pimoroni/product.html.gz')).toString();

describe('Pimoroni full public catalogue in GBP',()=>{
  it('proves GBP from meta.json, reads only the root sitemaps and covers every product in 17 requests',async()=>{
    const r=await collectPimoroniFixture();
    expect(r.errors).toEqual([]);expect(r.complete).toBe(true);
    expect(r.requests[0]).toBe('https://shop.pimoroni.com/meta.json');
    // The index also lists /en-eu/, /en-us/, /en-jp/ ... copies of the same sitemaps; none is read.
    expect(r.requests.filter(u=>/\/en-[a-z]{2}\//.test(new URL(u).pathname))).toEqual([]);
    expect(r.requests).toHaveLength(17);
    expect(r.raw.currency).toBe('GBP');expect(r.raw.currencyEvidence).toBe('meta.json:currency:GBP');
    expect(r.raw.items).toHaveLength(2854);
    expect(r.raw.items.reduce((n,p)=>n+p.variants.length,0)).toBe(3789);
    const normalized=await loadPimoroniNormalized();
    expect(normalized.storeId).toBe('pimoroni');expect(normalized.products).toHaveLength(2854);
    const product=normalized.products.find(p=>p.pageKey===presto)!;
    expect(product.metadata.canonicalUrl).toBe('https://shop.pimoroni.com/products/presto');
    expect(product.offers.map(o=>[o.externalOfferId,o.sku,o.priceQuotes[0]?.minAmountMinor])).toEqual([
      ['54894104019323','PIM725',5750],['54894104052091','PIM765',8250]]);
    expect(product.offers[0]?.priceQuotes[0]).toMatchObject({currency:'GBP',taxTreatment:'unknown',quoteKind:'selling'});
    expect(product.offers[0]?.availability).toMatchObject({quantity:null,quantitySemantics:'not_exposed'});
    expect(pimoroniSnapshotAdapter.productUrlForPageKey(presto)).toBe('https://shop.pimoroni.com/products/presto');
  });
  it.each(['meta currency','meta not JSON','redirect','missing product','duplicate','bad price','page cap'])('fails closed: %s',async(reason)=>{
    const r=await collectPimoroniFixture((url,body)=>{
      const u=new URL(url);
      if(u.pathname==='/meta.json'){
        if(reason==='meta currency')return body.replace('"GBP"','"USD"');
        if(reason==='meta not JSON')return '<html></html>';
        return body;
      }
      if(u.pathname!=='/products.json')return body;
      // A market redirect by location would serve another currency at the same handles.
      if(reason==='redirect'&&u.searchParams.get('page')==='2')return 302;
      const p=JSON.parse(body);
      if(reason==='missing product'&&u.searchParams.get('page')==='1')p.products.shift();
      if(reason==='duplicate'&&u.searchParams.get('page')==='1')p.products[1]=p.products[0];
      if(reason==='bad price')p.products[0].variants[0].price='5.555';
      return JSON.stringify(p);
    },reason==='page cap'?{maxPages:11}:{});
    expect(r.complete).toBe(false);expect(r.errors.length).toBeGreaterThan(0);
    if(reason==='redirect')expect(r.errors[0]).toContain('HTTP 302');
    if(reason==='meta currency')expect(r.errors[0]).toBe('Store base currency is not GBP');
    expect(pimoroniSnapshotAdapter.validateRaw(r.raw).errors.length).toBeGreaterThan(0);
  });
  it('the default transport for a meta-evidence store reports a redirect instead of following it',async()=>{
    const server=createServer((req,res)=>{
      if(req.url==='/products.json'){res.writeHead(302,{location:'/en-us/products.json'});res.end();}
      else {res.writeHead(200,{'content-type':'application/json'});res.end('{"products":[]}');}
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const {port}=server.address() as AddressInfo;
      const controller=new AbortController();
      const res=await noRedirectTransport(`http://127.0.0.1:${port}/products.json`,{headers:{},signal:controller.signal});
      expect(res.status).toBe(302);
    } finally {await new Promise(resolve=>server.close(resolve));}
  });
});

describe('Pimoroni product page',()=>{
  it('reads the Japan market copy and the root page, and mounts before the description in the left column',()=>{
    for(const url of ['https://shop.pimoroni.com/en-jp/products/presto','https://shop.pimoroni.com/products/presto']){
      const dom=new JSDOM(savedPage(),{url,virtualConsole:new VirtualConsole()});
      try {
        const doc=dom.window.document;
        // The saved page is the Japan copy; a root page names the root URL as canonical.
        if(!url.includes('/en-jp/'))doc.querySelector('link[rel=canonical]')!.setAttribute('href',url);
        expect(pimoroniPageAdapter.matches(loc(url))).toBe(true);
        expect(pimoroniPageAdapter.extractPageKey(doc,loc(url))).toBe(presto);
        const mount=pimoroniPageAdapter.findMountPoint(doc);
        expect(mount?.anchor.classList.contains('about')).toBe(true);
        expect(mount?.anchor.parentElement?.classList.contains('product-page')).toBe(true);
        expect(mount?.position).toBe('before');
        expect(mount?.hostStyle).toEqual({'grid-column':'1'});
      } finally {dom.window.close();}
    }
  });
  it('rejects a canonical for another product or origin, and other markets',()=>{
    const url='https://shop.pimoroni.com/en-jp/products/presto';
    const dom=new JSDOM(savedPage(),{url,virtualConsole:new VirtualConsole()});
    try {
      const doc=dom.window.document;const canonical=doc.querySelector('link[rel=canonical]')!;
      canonical.setAttribute('href','https://shop.pimoroni.com/en-jp/products/presto-different');
      expect(pimoroniPageAdapter.extractPageKey(doc,loc(url))).toBeNull();
      canonical.setAttribute('href','https://example.com/en-jp/products/presto');
      expect(pimoroniPageAdapter.extractPageKey(doc,loc(url))).toBeNull();
      // Without the description, after the purchase box; without the grid, nothing.
      doc.querySelector('.product-page > .about')!.remove();
      expect(pimoroniPageAdapter.findMountPoint(doc)?.anchor.classList.contains('purchase')).toBe(true);
      expect(pimoroniPageAdapter.findMountPoint(doc)?.position).toBe('after');
    } finally {dom.window.close();}
    for(const other of ['https://shop.pimoroni.com/en-eu/products/presto','https://shop.pimoroni.com/en-us/products/presto',
      'https://shop.pimoroni.com/cart','https://shop.pimoroni.com/en-jp/cart','https://example.com/products/presto'])
      expect(pimoroniPageAdapter.matches(loc(other)),other).toBe(false);
    expect(pimoroniPageAdapter.matches(loc('https://shop.pimoroni.com/en-jp/collections/displays/products/presto'))).toBe(true);
    expect(pimoroniPageAdapter.initialOfferId!({search:'?variant=54894104052091'})).toBe('54894104052091');
    expect(pimoroniPageAdapter.initialOfferId!({search:'?variant=x'})).toBeUndefined();
  });
});
