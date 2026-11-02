import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pimoroniCollector } from '../../src/collectors/pimoroni/collector.ts';
import type { ShopifyItem, ShopifySnapshot } from '../../src/adapters/shopify/rawSchema.ts';
import { pimoroniSnapshotAdapter } from '../../src/adapters/pimoroni/snapshotAdapter.ts';
import type { TransportResponse } from '../../src/collectors/politeFetcher.ts';

export interface PimoroniFixture { meta: Record<string, unknown>; index: string; sitemaps: string[]; pages: ShopifyItem[][] }
export function pimoroniFixture(): PimoroniFixture {
  return JSON.parse(gunzipSync(readFileSync('tests/fixtures/pimoroni/catalog.json.gz')).toString());
}
/** `edit` may replace a body, or answer a status of its own (a redirect, say) by returning a number. */
export async function collectPimoroniFixture(edit?: (url: string, body: string) => string | number, config = {}) {
  const fixture = pimoroniFixture();
  const requests: string[] = [];
  const outcome = await pimoroniCollector.collect({userAgent:'electro-parts-test/1.0',...config}, {
    log:()=>{}, now:()=>new Date('2026-11-03T00:00:00.000Z'), sleep:async()=>{}, random:()=>0,
    transport:async(url): Promise<TransportResponse> => {
      requests.push(url);
      const u=new URL(url);
      const sitemap=/^\/sitemap_products_(\d+)\.xml$/.exec(u.pathname);
      let body=u.pathname==='/meta.json'?JSON.stringify(fixture.meta):
        u.pathname==='/sitemap.xml'?fixture.index:sitemap?fixture.sitemaps[Number(sitemap[1])-1]??'':
        u.pathname==='/products.json'?JSON.stringify({products:fixture.pages[Number(u.searchParams.get('page'))-1]??[]}):'';
      const edited=edit?.(url,body)??body;
      if(typeof edited==='number') return {status:edited,header:n=>n==='location'?`https://shop.pimoroni.com/en-us${u.pathname}${u.search}`:null,bytes:async()=>new Uint8Array()};
      body=edited;
      return {status:200,header:()=>null,bytes:async()=>Buffer.from(body)};
    },
  });
  return {...outcome,raw:outcome.raw as ShopifySnapshot,requests};
}
export async function loadPimoroniNormalized() {
  const result=await collectPimoroniFixture();
  return pimoroniSnapshotAdapter.normalize(result.raw,'b'.repeat(64));
}
