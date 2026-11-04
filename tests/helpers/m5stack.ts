import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { m5stackCollector } from '../../src/collectors/m5stack/collector.ts';
import type { ShopifyItem, ShopifySnapshot } from '../../src/adapters/shopify/rawSchema.ts';
import { m5stackSnapshotAdapter } from '../../src/adapters/m5stack/snapshotAdapter.ts';

export function m5stackFixture(): {pages: ShopifyItem[][]; index: string; sitemap: string} {
  return JSON.parse(gunzipSync(readFileSync('tests/fixtures/m5stack/catalog.json.gz')).toString());
}
/** How the fake store answers besides the fixture: a refusal such as a 429 with Retry-After. */
export interface M5StackFixtureServer {
  /** A non-200 answer for this request, or undefined to serve the fixture. */
  refuse?: (url: string) => {status: number; retryAfter?: string} | undefined;
}
export async function collectM5StackFixture(edit?: (url: string, body: string) => string, config = {}, server: M5StackFixtureServer = {}) {
  const fixture = m5stackFixture();
  const requests: string[] = [];
  // A refusing server needs a clock that moves with each wait, or a Retry-After deadline never passes.
  let clock = Date.parse('2026-09-12T00:00:00.000Z');
  const advancing = server.refuse !== undefined;
  const outcome = await m5stackCollector.collect({userAgent:'electro-parts-test/1.0',...config}, {
    log:()=>{}, now:()=>new Date(clock), sleep:async(ms)=>{if(advancing) clock+=ms;}, random:()=>0,
    transport:async(url)=>{
      requests.push(url);
      const refused=server.refuse?.(url);
      if(refused!==undefined) {
        return {status:refused.status,header:(n)=>(n.toLowerCase()==='retry-after'?refused.retryAfter??null:null),bytes:async()=>Buffer.from('')};
      }
      const u=new URL(url);
      let body=u.pathname==='/'?'Shopify.currency = {"active":"USD","rate":"1.0"};':
        u.pathname==='/sitemap.xml'?fixture.index:u.pathname.startsWith('/sitemap_products_')?fixture.sitemap:
        JSON.stringify({products:fixture.pages[Number(u.searchParams.get('page'))-1]??[]});
      body=edit?.(url,body)??body;
      return {status:200,header:()=>null,bytes:async()=>Buffer.from(body)};
    },
  });
  return {...outcome,raw:outcome.raw as ShopifySnapshot,requests};
}
export async function loadM5StackNormalized() {
  const result=await collectM5StackFixture();
  return m5stackSnapshotAdapter.normalize(result.raw,'a'.repeat(64));
}
