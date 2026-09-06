import { describe, expect, it } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { LruCache, productCacheKey } from '../../userscript/core/cache.ts';
import { DataClient, type LoadState } from '../../userscript/core/dataClient.ts';
import { fakeHost, json, sampleManifest, sampleProduct } from './helpers.ts';

const BASE = 'https://data.example.test/site';
const M = `${BASE}/${manifestPath('teststore')}`;
const P = `${BASE}/${productPath('teststore', 'P1')}`;

async function run(client: DataClient, pageKey = 'P1'): Promise<LoadState[]> {
  const states: LoadState[] = [];
  await client.load('teststore', pageKey, (s) => states.push(s));
  return states;
}

const at = (states: LoadState[], i: number): LoadState => states[i] as LoadState;
const errorOf = (states: LoadState[]): string => {
  const s = at(states, 1);
  return s.kind === 'error' ? s.message : `not error: ${s.kind}`;
};
const kinds = (states: LoadState[]) => states.map((s) => (s.kind === 'ready' ? `ready:${s.freshness}` : s.kind === 'missing' ? `missing:${s.freshness}` : s.kind));

describe('DataClient (stale-while-revalidate)', () => {
  it('first visit: loading → manifest → product fetched with the dataset version, then cached', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest()));
    host.routes.set(P, json(sampleProduct()));
    const client = new DataClient(host, { baseUrl: `${BASE}/` });
    const states = await run(client);
    expect(kinds(states)).toEqual(['loading', 'ready:fresh']);
    expect(host.requests).toEqual([`${M}?b=${Math.floor(host.clock / (30 * 60_000))}`, `${P}?v=v1`]);
    expect(host.store.has(productCacheKey('teststore', 'P1'))).toBe(true);

    // Second visit within the TTLs: cache only, no network at all.
    host.requests.length = 0;
    host.clock += 60_000;
    const again = await run(client);
    expect(kinds(again)).toEqual(['ready:fresh', 'ready:fresh']);
    expect(host.requests).toEqual([]);
  });

  it('after the manifest TTL an unchanged datasetVersion refreshes without a product fetch; a new one refetches', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest()));
    host.routes.set(P, json(sampleProduct()));
    const client = new DataClient(host, { baseUrl: BASE });
    await run(client);
    host.requests.length = 0;
    host.clock += 7 * 3_600_000; // product stale, manifest expired
    const states = await run(client);
    expect(kinds(states)).toEqual(['ready:stale', 'ready:fresh']);
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]).toContain('manifest.json');

    host.requests.length = 0;
    host.clock += 3_600_000; // manifest expired again
    host.routes.set(M, json(sampleManifest({ datasetVersion: 'v2' })));
    host.routes.set(P, json(sampleProduct({ datasetVersion: 'v2', product: { ...sampleProduct().product, listed: false } })));
    const next = await run(client);
    expect(kinds(next)).toEqual(['ready:fresh', 'ready:fresh']);
    expect(host.requests[1]).toBe(`${P}?v=v2`);
    const last = at(next, 1);
    expect(last.kind === 'ready' ? last.product.product.listed : 'not ready').toBe(false);
  });

  it('keeps showing the cached product (marked stale) when the network fails, and reports an error without a cache', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest()));
    host.routes.set(P, json(sampleProduct()));
    const client = new DataClient(host, { baseUrl: BASE });
    await run(client);
    host.clock += 3_600_000;
    host.routes.set(M, new Error('offline'));
    const states = await run(client);
    expect(kinds(states)).toEqual(['ready:fresh', 'ready:stale']);
    const last = at(states, 1);
    expect(last.kind === 'ready' ? last.note : 'not ready').toContain('manifest unavailable');

    const cold = new DataClient(fakeHost(), { baseUrl: BASE });
    const coldHost = fakeHost();
    coldHost.routes.set(M, new Error('offline'));
    const coldStates = await run(new DataClient(coldHost, { baseUrl: BASE }));
    expect(kinds(coldStates)).toEqual(['loading', 'error']);
    expect(cold).toBeDefined();
  });

  it('404 becomes a negative entry that is honoured until the dataset version changes', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest()));
    const client = new DataClient(host, { baseUrl: BASE });
    expect(kinds(await run(client, 'NOPE'))).toEqual(['loading', 'missing:fresh']);
    host.requests.length = 0;
    expect(kinds(await run(client, 'NOPE'))).toEqual(['missing:fresh', 'missing:fresh']);
    expect(host.requests).toEqual([]);
    host.clock += 3_600_000;
    host.routes.set(M, json(sampleManifest({ datasetVersion: 'v2' })));
    host.routes.set(`${BASE}/${productPath('teststore', 'NOPE')}`, json(sampleProduct({ datasetVersion: 'v2', pageKey: 'NOPE', externalProductId: 'NOPE' })));
    expect(kinds(await run(client, 'NOPE'))).toEqual(['missing:fresh', 'ready:fresh']);
  });

  it('rejects structurally invalid or foreign payloads and never caches them', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest()));
    host.routes.set(P, json({ ...sampleProduct(), offers: [] }));
    const client = new DataClient(host, { baseUrl: BASE });
    let states = await run(client);
    expect(kinds(states)).toEqual(['loading', 'error']);
    expect(errorOf(states)).toContain('invalid product file');
    expect(host.store.has(productCacheKey('teststore', 'P1'))).toBe(false);

    host.routes.set(P, json(sampleProduct({ pageKey: 'OTHER' })));
    states = await run(client);
    expect(errorOf(states)).toContain('identity mismatch');

    host.clock += 3_600_000; // manifest cache expired
    host.routes.set(M, json(sampleManifest({ storeId: 'elsewhere' })));
    states = await run(client);
    expect(errorOf(states)).toContain('manifest store mismatch');

    host.routes.set(M, { status: 200, text: '{not json' });
    states = await run(client);
    expect(at(states, 1).kind).toBe('error');
  });

  it('LRU cache keeps at most maxEntries products and keys by contract major, store and page key', async () => {
    const host = fakeHost();
    const cache = new LruCache(host.storage, 2);
    await cache.putProduct('s', 'a', { datasetVersion: 'v', storedAt: 1, body: null });
    await cache.putProduct('s', 'b', { datasetVersion: 'v', storedAt: 1, body: null });
    await cache.getProduct('s', 'a'); // a is now most recent
    await cache.putProduct('s', 'c', { datasetVersion: 'v', storedAt: 1, body: null });
    expect(await cache.getProduct('s', 'b')).toBeNull();
    expect(await cache.getProduct('s', 'a')).not.toBeNull();
    expect(await cache.index()).toEqual([productCacheKey('s', 'c'), productCacheKey('s', 'a')]);
    expect(productCacheKey('akizuki', '109951')).toBe('eph:c1:product:akizuki:109951');
    expect(productCacheKey('s', 'x/y')).toBe('eph:c1:product:s:x%2Fy');
    host.store.set(productCacheKey('s', 'a'), 'garbage');
    expect(await cache.getProduct('s', 'a')).toBeNull();
  });
});
