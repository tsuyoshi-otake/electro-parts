import { describe, expect, it } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { cacheNamespace, LruCache, productCacheKey } from '../../userscript/core/cache.ts';
import { DataClient, type LoadState } from '../../userscript/core/dataClient.ts';
import { fakeHost, json, sampleManifest, sampleProduct } from './helpers.ts';

const BASE = 'https://data.example.test/site';
const M = `${BASE}/${manifestPath('teststore')}`;
const P = `${BASE}/${productPath('teststore', 'P1')}`;
const NS = cacheNamespace(BASE);
const dataKey = (pageKey: string) => productCacheKey('teststore', pageKey, NS);

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
  it('deduplicates in-flight products and manifests, and keeps all concurrent cache entries', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest())); host.routes.set(P, json(sampleProduct()));
    host.routes.set(`${BASE}/${productPath('teststore', 'P2')}`, json(sampleProduct({ pageKey: 'P2', externalProductId: 'P2' })));
    const client = new DataClient(host, { baseUrl: BASE });
    const results = await Promise.all([run(client), run(client), run(client, 'P2')]);
    expect(results.every((states) => states[states.length - 1]!.kind === 'ready')).toBe(true);
    expect(host.requests).toHaveLength(3);
    expect(host.requests.filter((url) => url.includes('manifest.json'))).toHaveLength(1);
    expect(await new LruCache(host.storage, 200, NS).index()).toHaveLength(2);
  });

  it('isolates a failing subscriber and gives other subscribers a terminal state', async () => {
    const host = fakeHost(); host.routes.set(M, json(sampleManifest())); host.routes.set(P, json(sampleProduct()));
    const client = new DataClient(host, { baseUrl: BASE });
    const [, states] = await Promise.all([client.load('teststore', 'P1', () => { throw new Error('render failed'); }), run(client)]);
    expect(states[states.length - 1]!.kind).toBe('ready'); expect(host.requests).toHaveLength(2);
  });

  it('does not retry a rate-limited comparison request', async () => {
    const host = fakeHost(); host.routes.set(M, json(sampleManifest())); host.routes.set(P, { status: 429, text: 'rate limited' });
    const states = await run(new DataClient(host, { baseUrl: BASE }));
    expect(states[states.length - 1]!.kind).toBe('error'); expect(host.requests).toHaveLength(2);
  });

  it('shares a failed manifest across concurrent and queued products without a retry storm', async () => {
    const host = fakeHost(); host.routes.set(M, { status: 429, text: 'rate limited' });
    const client = new DataClient(host, { baseUrl: BASE });
    const first = await Promise.all([run(client, 'P1'), run(client, 'P2')]);
    const queued = await run(client, 'P3');
    expect([...first, queued].every((states) => states.at(-1)?.kind === 'error')).toBe(true);
    expect(host.requests).toHaveLength(1);
  });

  it('does not emit a foreign product from a structurally valid poisoned cache entry', async () => {
    const host = fakeHost(); host.routes.set(M, json(sampleManifest())); host.routes.set(P, json(sampleProduct()));
    host.store.set(dataKey('P1'), JSON.stringify({ datasetVersion: 'v1', storedAt: host.clock, body: sampleProduct({ storeId: 'foreign' }) }));
    const states = await run(new DataClient(host, { baseUrl: BASE }));
    expect(states[0]!.kind).toBe('loading');
    expect(states.filter((s) => s.kind === 'ready').every((s) => s.kind === 'ready' && s.product.storeId === 'teststore')).toBe(true);
    expect(host.requests).toHaveLength(2);
  });
  it('first visit: loading → manifest → product fetched with the dataset version, then cached', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest()));
    host.routes.set(P, json(sampleProduct()));
    const client = new DataClient(host, { baseUrl: `${BASE}/` });
    const states = await run(client);
    expect(kinds(states)).toEqual(['loading', 'ready:fresh']);
    expect(host.requests).toEqual([`${M}?b=${Math.floor(host.clock / (30 * 60_000))}`, `${P}?v=v1`]);
    expect(host.store.has(dataKey('P1'))).toBe(true);

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

  it('namespaces positive and negative caches by the normalized data source URL', async () => {
    const host = fakeHost();
    const other = 'https://data.example.test/other';
    const otherManifest = `${other}/${manifestPath('teststore')}`;
    const otherProduct = `${other}/${productPath('teststore', 'P1')}`;
    host.routes.set(M, json(sampleManifest()));
    host.routes.set(P, json(sampleProduct()));
    await run(new DataClient(host, { baseUrl: `${BASE}/` }));

    host.requests.length = 0;
    host.routes.set(otherManifest, json(sampleManifest({ datasetVersion: 'other-v1' })));
    host.routes.set(otherProduct, json(sampleProduct({ datasetVersion: 'other-v1' })));
    const fromOther = await run(new DataClient(host, { baseUrl: other }));
    expect(host.requests).toHaveLength(2);
    expect(at(fromOther, 1)).toMatchObject({ kind: 'ready', product: { datasetVersion: 'other-v1' } });

    host.requests.length = 0;
    await run(new DataClient(host, { baseUrl: `${BASE}///` }));
    expect(host.requests).toEqual([]);

    const missingHost = fakeHost();
    missingHost.routes.set(M, json(sampleManifest()));
    await run(new DataClient(missingHost, { baseUrl: BASE }), 'NOPE');
    missingHost.requests.length = 0;
    missingHost.routes.set(`${other}/${manifestPath('teststore')}`, new Error('offline'));
    expect(kinds(await run(new DataClient(missingHost, { baseUrl: other }), 'NOPE'))).toEqual(['loading', 'error']);
    expect(missingHost.requests).toHaveLength(1);
  });

  it('rejects structurally invalid or foreign payloads and never caches them', async () => {
    const host = fakeHost();
    host.routes.set(M, json(sampleManifest()));
    host.routes.set(P, json({ ...sampleProduct(), offers: [] }));
    const client = new DataClient(host, { baseUrl: BASE });
    let states = await run(client);
    expect(kinds(states)).toEqual(['loading', 'error']);
    expect(errorOf(states)).toContain('invalid product file');
    expect(host.store.has(dataKey('P1'))).toBe(false);

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

  it('reconciles concurrent cache indexes across independent tabs and recovers after a storage error', async () => {
    const host = fakeHost();
    const tabA = new LruCache(host.storage, 1);
    const tabB = new LruCache(host.storage, 1);
    const entry = { datasetVersion: 'v', storedAt: host.clock, body: null };
    await Promise.all([tabA.putProduct('s', 'A', entry), tabB.putProduct('s', 'B', entry)]);
    await tabB.putProduct('s', 'C', entry);
    const bodies = [...host.store.keys()].filter((key) => key.startsWith('eph:c1:product:'));
    const index = await tabA.index();
    expect(bodies.length).toBeLessThanOrEqual(1);
    expect(bodies.every((key) => index.includes(key))).toBe(true);

    let failOnce = true;
    const flakyStorage = {
      ...host.storage,
      remove: async (key: string) => {
        if (failOnce) { failOnce = false; throw new Error('storage busy'); }
        await host.storage.remove(key);
      },
    };
    const flaky = new LruCache(flakyStorage, 1);
    await expect(flaky.putProduct('s', 'D', entry)).rejects.toThrow('storage busy');
    await flaky.putProduct('s', 'E', entry);
    const recoveredBodies = [...host.store.keys()].filter((key) => key.startsWith('eph:c1:product:'));
    const recoveredIndex = await flaky.index();
    expect(recoveredBodies.length).toBeLessThanOrEqual(1);
    expect(recoveredBodies.every((key) => recoveredIndex.includes(key))).toBe(true);
  });
});
