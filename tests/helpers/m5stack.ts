import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { m5stackCollector } from '../../src/collectors/m5stack/collector.ts';
import type { M5StackItem, M5StackSnapshot } from '../../src/adapters/m5stack/rawSchema.ts';
import { m5stackSnapshotAdapter } from '../../src/adapters/m5stack/snapshotAdapter.ts';

export function m5stackFixture(): {pages: M5StackItem[][]; index: string; sitemap: string} {
  return JSON.parse(gunzipSync(readFileSync('tests/fixtures/m5stack/catalog.json.gz')).toString());
}
export async function collectM5StackFixture(edit?: (url: string, body: string) => string, config = {}) {
  const fixture = m5stackFixture();
  const requests: string[] = [];
  const outcome = await m5stackCollector.collect({userAgent:'electro-parts-test/1.0',...config}, {
    log:()=>{}, now:()=>new Date('2026-09-12T00:00:00.000Z'), sleep:async()=>{}, random:()=>0,
    transport:async(url)=>{
      requests.push(url);
      const u=new URL(url);
      let body=u.pathname==='/'?'Shopify.currency = {"active":"USD","rate":"1.0"};':
        u.pathname==='/sitemap.xml'?fixture.index:u.pathname.startsWith('/sitemap_products_')?fixture.sitemap:
        JSON.stringify({products:fixture.pages[Number(u.searchParams.get('page'))-1]??[]});
      body=edit?.(url,body)??body;
      return {status:200,header:()=>null,bytes:async()=>Buffer.from(body)};
    },
  });
  return {...outcome,raw:outcome.raw as M5StackSnapshot,requests};
}
export async function loadM5StackNormalized() {
  const result=await collectM5StackFixture();
  return m5stackSnapshotAdapter.normalize(result.raw,'a'.repeat(64));
}
