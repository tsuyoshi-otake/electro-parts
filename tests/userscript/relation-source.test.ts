import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { HOST_ELEMENT_ID, OWNER_ATTRIBUTE, RELATIONS_WAIT_MS, mountHistoryPanel } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import { inMemoryRelations, relationProductKey, type ProductRelation, type RelationProduct, type RelationSource } from '../../userscript/core/relations.ts';
import type { StorePageAdapter } from '../../userscript/core/types.ts';
import { comparisonFixture } from './comparison-fixtures.ts';
import { fakeHost, json, sampleManifest, sampleProduct, testAdapter, type FakeHost } from './helpers.ts';

const BASE = 'https://data.example.test';
const LOC = { hostname: 'example.test', pathname: '/p/P1' };

describe('inMemoryRelations', () => {
  it('answers like the table: the relations that have the product as an endpoint, in table order', async () => {
    const source = inMemoryRelations(PRODUCT_RELATIONS);
    const keys = new Set(PRODUCT_RELATIONS.flatMap((r) => r.products.map((p) => relationProductKey(p.storeId, p.pageKey))));
    expect(keys.size).toBeGreaterThan(100);
    for (const key of [...keys].slice(0, 300)) {
      const [storeId, pageKey] = JSON.parse(key) as [string, string];
      const expected = PRODUCT_RELATIONS.filter((r) => r.products.some((p) => p.storeId === storeId && p.pageKey === pageKey));
      expect(await source.relationsFor(storeId, pageKey)).toEqual(expected);
    }
    expect(await source.relationsFor('akizuki', 'no-such-page')).toEqual([]);
  });

  it('answers a relation whose two endpoints are one page once, and keeps table order with the other relations of that page', async () => {
    const endpoint = (offerId: string): RelationProduct => ({
      storeId: 'akizuki', pageKey: 'P1', name: 'P1', modelNumber: 'P1', url: 'https://example.test/P1', observedAt: '2026-01-01',
      expectedNames: ['P1'], expectedModels: ['P1'], offer: { id: offerId, sku: offerId, name: offerId },
    });
    const other: RelationProduct = { storeId: 'ksy', pageKey: 'Q1', name: 'Q1', modelNumber: 'Q1', url: 'https://example.test/Q1', observedAt: '2026-01-01', expectedNames: ['Q1'], expectedModels: ['Q1'] };
    const base = { kind: 'same_product', reviewStatus: 'verified', evidence: '', differences: [], missingEvidence: [], reviewedAt: '2026-01-01', provenance: { method: 'catalog', model: null, originalClassification: null, originalReason: null }, pricePolicy: null } as const;
    const twin: ProductRelation = { ...base, id: 'twin', products: [endpoint('v1'), endpoint('v2')] };
    const ordinary: ProductRelation = { ...base, id: 'ordinary', products: [endpoint('v1'), other] };
    const table = [twin, ordinary];
    const source = inMemoryRelations(table);
    expect(await source.relationsFor('akizuki', 'P1')).toEqual([twin, ordinary]);
    expect(await source.relationsFor('ksy', 'Q1')).toEqual([ordinary]);
  });

  it('does not touch the table before the first question, and indexes it only once', async () => {
    const { relation } = comparisonFixture();
    let reads = 0;
    const counted = new Proxy([relation], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) reads++;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const source = inMemoryRelations(counted);
    expect(reads).toBe(0);
    expect(await source.relationsFor('teststore', 'P1')).toEqual([relation]);
    expect(reads).toBe(1);
    await source.relationsFor('otherstore', 'P2');
    await source.relationsFor('teststore', 'none');
    expect(reads).toBe(1);
  });
});

/** A source whose answer the test decides on, and the calls it received. */
function controlledSource(): { source: RelationSource; calls: string[]; resolve: (relations: ProductRelation[]) => void; reject: (error: Error) => void } {
  const calls: string[] = [];
  let resolve!: (relations: ProductRelation[]) => void;
  let reject!: (error: Error) => void;
  const answer = new Promise<ProductRelation[]>((res, rej) => { resolve = res; reject = rej; });
  return { source: { relationsFor: (storeId, pageKey) => { calls.push(relationProductKey(storeId, pageKey)); return answer; } }, calls, resolve, reject };
}

function page(): void {
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
  document.documentElement.removeAttribute('data-eph-page-theme');
  for (const style of document.querySelectorAll('style[data-eph-page-theme]')) style.remove();
  document.body.replaceChildren();
  const h1 = document.createElement('h1');
  h1.textContent = 'Test Part';
  const buy = document.createElement('div');
  buy.id = 'buy';
  document.body.append(h1, buy);
}

/** The page's own product and the other store's one, both with data. */
function hostWithBothStores(): FakeHost {
  const { other } = comparisonFixture();
  const host = fakeHost();
  host.routes.set(`${BASE}/${manifestPath('teststore')}`, json(sampleManifest()));
  host.routes.set(`${BASE}/${productPath('teststore', 'P1')}`, json(sampleProduct()));
  host.routes.set(`${BASE}/${manifestPath('otherstore')}`, json(sampleManifest({ storeId: 'otherstore' })));
  host.routes.set(`${BASE}/${productPath('otherstore', 'P2')}`, json(other));
  return host;
}

function mount(host: FakeHost, options: Partial<Parameters<typeof mountHistoryPanel>[0]>) {
  return mountHistoryPanel({
    adapters: [testAdapter], host, client: new DataClient(host, { baseUrl: BASE }), doc: document, location: LOC, dataBaseUrl: BASE,
    lazyChart: false, mountTimeoutMs: 200, ...options,
  });
}

const panelRoot = (): ShadowRoot | null | undefined => document.getElementById(HOST_ELEMENT_ID)?.shadowRoot;
const cards = (): number => panelRoot()?.querySelectorAll('.related-card, .store-price').length ?? 0;
const hasProduct = (): boolean => (panelRoot()?.textContent ?? '').includes('￥1,200');
const otherStoreRequests = (host: FakeHost): string[] => host.requests.filter((url) => url.includes('/otherstore/'));

afterEach(() => {
  vi.useRealTimers();
  document.getElementById(HOST_ELEMENT_ID)?.remove();
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
});

describe('related cards from a relation source', () => {
  it('shows the product first and the related cards when the relations arrive later, asking once', async () => {
    page();
    const host = hostWithBothStores();
    const { relation } = comparisonFixture();
    const { source, calls, resolve } = controlledSource();
    let settled = false;
    const mounting = mount(host, { relations: source }).then((handle) => { settled = true; return handle; });
    await vi.waitFor(() => expect(hasProduct()).toBe(true));
    expect(cards()).toBe(0);
    expect(settled).toBe(false);
    expect(otherStoreRequests(host)).toEqual([]);
    resolve([relation]);
    const handle = await mounting;
    expect(cards()).toBe(1);
    expect(otherStoreRequests(host).some((url) => url.includes('/products/'))).toBe(true);
    expect(calls).toEqual([relationProductKey('teststore', 'P1')]);
    handle.destroy();
  });

  it('starts the relations beside the product load, not after it', async () => {
    page();
    const host = hostWithBothStores();
    const { source, calls, resolve } = controlledSource();
    const productRequested = new Promise<void>((resolveRequested) => {
      const fetch = host.fetchText;
      host.fetchText = async (url, timeout) => {
        if (url.includes('/teststore/')) {
          expect(calls).toHaveLength(1);
          resolveRequested();
        }
        return fetch(url, timeout);
      };
    });
    const mounting = mount(host, { relations: source });
    await productRequested;
    resolve([]);
    (await mounting).destroy();
  });

  it('keeps the product panel without cards, and logs a warning, when the relations cannot be read', async () => {
    page();
    const host = hostWithBothStores();
    const { source, reject } = controlledSource();
    const mounting = mount(host, { relations: source });
    await vi.waitFor(() => expect(hasProduct()).toBe(true));
    reject(new Error('worker is gone'));
    const handle = await mounting;
    expect(host.logs).toContain('warn: related products unavailable: worker is gone');
    expect(hasProduct()).toBe(true);
    expect(cards()).toBe(0);
    expect(otherStoreRequests(host)).toEqual([]);
    handle.destroy();
  });

  it('treats a source that throws instead of returning a promise as a failure too', async () => {
    page();
    const host = hostWithBothStores();
    const handle = await mount(host, { relations: { relationsFor: () => { throw new Error('sync failure'); } } });
    expect(host.logs).toContain('warn: related products unavailable: sync failure');
    expect(hasProduct()).toBe(true);
    handle.destroy();
  });

  it('ends the wait at the bound when the relations never settle', async () => {
    page();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const host = hostWithBothStores();
    const { source, calls, resolve } = controlledSource();
    const { relation } = comparisonFixture();
    let settled = false;
    const mounting = mount(host, { relations: source }).then((handle) => { settled = true; return handle; });
    await vi.advanceTimersByTimeAsync(RELATIONS_WAIT_MS - 1);
    expect(hasProduct()).toBe(true);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const handle = await mounting;
    expect(host.logs).toEqual([`warn: related products unavailable: no answer within ${RELATIONS_WAIT_MS} ms`]);
    expect(hasProduct()).toBe(true);
    expect(cards()).toBe(0);
    // An answer after the bound changes nothing.
    resolve([relation]);
    await vi.advanceTimersByTimeAsync(0);
    expect(cards()).toBe(0);
    expect(otherStoreRequests(host)).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    handle.destroy();
  });

  it('renders nothing and requests no related history when the panel closes before the relations arrive', async () => {
    page();
    const host = hostWithBothStores();
    const { source, calls, resolve } = controlledSource();
    const { relation } = comparisonFixture();
    let follow: (pageKey: string | null) => void = () => undefined;
    const watching: StorePageAdapter = { ...testAdapter, watchPageKey: (_doc, onChange) => { follow = onChange; return () => undefined; } };
    const mounting = mount(host, { adapters: [watching], relations: source });
    await vi.waitFor(() => expect(hasProduct()).toBe(true));
    follow(null);
    await mounting;
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
    resolve([relation]);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
    expect(otherStoreRequests(host)).toEqual([]);
    expect(host.logs).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('marks the cards as errors without requests when the product did not load, after the relations settled', async () => {
    page();
    const host = fakeHost();
    const { relation } = comparisonFixture();
    const { source, resolve } = controlledSource();
    const mounting = mount(host, { relations: source });
    await vi.waitFor(() => expect(panelRoot()?.textContent ?? '').toContain('取得できませんでした'));
    resolve([relation]);
    (await mounting).destroy();
    expect(host.requests.every((url) => url.includes('/teststore/'))).toBe(true);
  });

  it('shows the product alone, with nothing logged, when no relation source is given', async () => {
    page();
    const host = hostWithBothStores();
    const handle = await mount(host, {});
    expect(hasProduct()).toBe(true);
    expect(cards()).toBe(0);
    expect(host.logs).toEqual([]);
    expect(otherStoreRequests(host)).toEqual([]);
    handle.destroy();
  });
});
