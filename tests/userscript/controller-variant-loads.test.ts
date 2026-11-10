import { describe, expect, it, vi } from 'vitest';
import type { OfferV1 } from '../../src/publisher/contract.ts';
import { HOST_ELEMENT_ID, OWNER_ATTRIBUTE, mountHistoryPanel } from '../../userscript/core/controller.ts';
import type { DataClient, LoadState } from '../../userscript/core/dataClient.ts';
import { inMemoryRelations, MAX_RELATED_HISTORY_LOADS, MAX_RELATED_HISTORY_LOADS_PER_PAGE, type ProductRelation } from '../../userscript/core/relations.ts';
import type { StorePageAdapter } from '../../userscript/core/types.ts';
import { comparisonFixture } from './comparison-fixtures.ts';
import { fakeHost, sampleProduct, testAdapter } from './helpers.ts';

/** Which related loads the controller starts for the variant on screen (Issue #114). */

const BASE = 'https://data.example.test';
const LOC = { hostname: 'example.test', pathname: '/p/P1' };

function page(): void {
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
  document.documentElement.removeAttribute('data-eph-page-theme');
  for (const style of document.querySelectorAll('style[data-eph-page-theme]')) style.remove();
  document.body.replaceChildren();
  const buy = document.createElement('div');
  buy.id = 'buy';
  document.body.appendChild(buy);
}

/** The own product with `count` variants V1.., all on sale. */
function variantsProduct(count: number) {
  const base = sampleProduct();
  const offers: OfferV1[] = Array.from({ length: count }, (_, i) => ({ ...base.offers[0]!, externalOfferId: `V${i + 1}`, sku: `S${i + 1}`, variantName: `Variant ${i + 1}` }));
  return { ...base, offers };
}

/** One similar-product relation per (variant, target); `targets[v]` lists the target page keys of variant v+1. */
function relationsFor(targets: readonly (readonly string[])[]): ProductRelation[] {
  const { relation } = comparisonFixture();
  return targets.flatMap((keys, v) => keys.map((key, j): ProductRelation => ({
    ...relation, id: `v${v + 1}-${String(j).padStart(2, '0')}-${key}`, kind: 'similar_product', pricePolicy: null, differences: [`d${j}`],
    products: [{ ...relation.products[0], offer: { id: `V${v + 1}`, sku: `S${v + 1}`, name: `Variant ${v + 1}` } },
      { ...relation.products[1], pageKey: key, name: `Row ${key}`, url: `https://other.test/${key}` }] as ProductRelation['products'],
  })));
}

/** A client that answers the own product at once and holds every other load until the test settles it. */
function fakeClient(ownProduct: ReturnType<typeof variantsProduct> | null) {
  const calls: string[] = [];
  const pending = new Map<string, (state: LoadState) => void>();
  let active = 0;
  let peak = 0;
  const client = {
    load: async (storeId: string, pageKey: string, emit: (state: LoadState) => void): Promise<void> => {
      if (storeId === 'teststore') {
        emit(ownProduct === null ? { kind: 'missing', manifest: null, freshness: 'fresh' }
          : { kind: 'ready', product: ownProduct, manifest: null, freshness: 'fresh', storedAt: 1, note: null });
        return;
      }
      calls.push(pageKey);
      active++; peak = Math.max(peak, active);
      await new Promise<void>((resolve) => pending.set(pageKey, (state) => { emit(state); resolve(); }));
      active--;
    },
  } as unknown as DataClient;
  const ready = (key: string): LoadState => ({ kind: 'ready', product: { ...comparisonFixture().other, pageKey: key }, manifest: null, freshness: 'fresh', storedAt: 1, note: null });
  /** Waits until the controller holds this load, then answers it. */
  const answer = async (key: string, state: LoadState = ready(key)) => {
    await vi.waitFor(() => expect(pending.has(key)).toBe(true));
    pending.get(key)!(state);
    pending.delete(key);
    await settled();
  };
  return { client, calls, pending, answer, peak: () => peak };
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function cards(): Map<string, string> {
  const root = document.getElementById(HOST_ELEMENT_ID)?.shadowRoot;
  const out = new Map<string, string>();
  for (const card of root?.querySelectorAll('.related-card') ?? []) {
    const text = card.textContent ?? '';
    const key = /^Row (.+)$/.exec(card.querySelector('.related-title')?.textContent ?? '')?.[1] ?? '?';
    out.set(key, text.includes('上位候補のみ') ? 'reference' : text.includes('読み込み中') ? 'loading' : text.includes('取得できませんでした') ? 'error' : 'loaded');
  }
  return out;
}

function selectVariant(id: string): void {
  const select = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelector<HTMLSelectElement>('select[aria-label="バリエーション"]')!;
  select.value = id;
  select.dispatchEvent(new Event('change'));
}

function start(targets: readonly (readonly string[])[], client: DataClient, adapter: StorePageAdapter = testAdapter, logs: string[] = []) {
  page();
  const host = fakeHost();
  host.log = (level, message) => { logs.push(`${level}: ${message}`); };
  return mountHistoryPanel({
    adapters: [adapter], host, client, doc: document, location: LOC, dataBaseUrl: BASE, lazyChart: false, mountTimeoutMs: 200,
    relations: inMemoryRelations(relationsFor(targets)),
  });
}

const keys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);

describe('related loads follow the variant on screen', () => {
  it('requests only the shown variant\'s first 8 targets, two at a time', async () => {
    const f = fakeClient(variantsProduct(3));
    const mounted = start([keys('a', 10), keys('b', 10), keys('c', 10)], f.client);
    await vi.waitFor(() => expect(f.calls).toHaveLength(2));
    for (const k of keys('a', 8)) await f.answer(k);
    const handle = await mounted;
    expect(f.calls).toEqual(keys('a', 8));
    expect(f.calls.length).toBeLessThanOrEqual(MAX_RELATED_HISTORY_LOADS);
    expect(f.peak()).toBe(2);
    expect([...cards().values()]).toEqual([...Array(8).fill('loaded'), 'reference', 'reference']);
    handle.destroy();
  });

  it('loads the next variant\'s targets once, and nothing again when going back', async () => {
    const f = fakeClient(variantsProduct(3));
    const mounted = start([keys('a', 3), keys('b', 3), keys('c', 3)], f.client);
    for (const k of keys('a', 3)) await f.answer(k);
    const handle = await mounted;
    expect(f.calls).toEqual(keys('a', 3));
    selectVariant('V2');
    await vi.waitFor(() => expect(f.calls).toHaveLength(5));
    expect(cards().get('b00')).toBe('loading');
    for (const k of keys('b', 3)) await f.answer(k);
    expect(f.calls).toEqual([...keys('a', 3), ...keys('b', 3)]);
    expect([...cards().values()]).toEqual(['loaded', 'loaded', 'loaded']);
    selectVariant('V1');
    await settled();
    expect(f.calls).toHaveLength(6);
    expect([...cards().values()]).toEqual(['loaded', 'loaded', 'loaded']);
    handle.destroy();
  });

  it('asks a target shared by two variants once and shows its state on both rows', async () => {
    const f = fakeClient(variantsProduct(2));
    const mounted = start([['shared', 'a01'], ['shared', 'b01']], f.client);
    await f.answer('shared');
    await f.answer('a01');
    const handle = await mounted;
    selectVariant('V2');
    await vi.waitFor(() => expect(f.calls).toHaveLength(3));
    expect(f.calls.filter((k) => k === 'shared')).toHaveLength(1);
    expect(cards().get('shared')).toBe('loaded');
    expect(cards().get('b01')).toBe('loading');
    await f.answer('b01');
    selectVariant('V1');
    expect(cards().get('shared')).toBe('loaded');
    expect(f.calls).toHaveLength(3);
    handle.destroy();
  });

  it('stops after 24 related loads per page view and leaves later rows reference-only', async () => {
    const f = fakeClient(variantsProduct(4));
    const mounted = start([keys('a', 8), keys('b', 8), keys('c', 8), keys('d', 8)], f.client);
    for (const k of keys('a', 8)) await f.answer(k);
    const handle = await mounted;
    selectVariant('V2');
    for (const k of keys('b', 8)) await f.answer(k);
    selectVariant('V3');
    for (const k of keys('c', 8)) await f.answer(k);
    selectVariant('V4');
    await settled();
    expect(f.calls).toHaveLength(MAX_RELATED_HISTORY_LOADS_PER_PAGE);
    expect(f.calls).toEqual([...keys('a', 8), ...keys('b', 8), ...keys('c', 8)]);
    expect([...cards().values()]).toEqual(Array(8).fill('reference'));
    handle.destroy();
  });

  it('starts none of the queued loads once the panel is closed', async () => {
    const f = fakeClient(variantsProduct(1));
    let follow: (pageKey: string | null) => void = () => undefined;
    const adapter: StorePageAdapter = { ...testAdapter, watchPageKey: (_doc, onKey) => { follow = onKey; return () => undefined; } };
    const mounted = start([keys('a', 6)], f.client, adapter);
    await vi.waitFor(() => expect(f.calls).toHaveLength(2));
    follow(null);
    await f.answer('a00');
    await f.answer('a01');
    const handle = await mounted;
    await settled();
    expect(f.calls).toEqual(['a00', 'a01']);
    handle.destroy();
  });

  it('requests no related history while the own product is missing', async () => {
    const f = fakeClient(null);
    const handle = await start([keys('a', 3), keys('b', 3)], f.client);
    await settled();
    expect(f.calls).toEqual([]);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(root.querySelector('section')?.textContent).toContain('まだ観測データに含まれていません');
    handle.destroy();
  });

  it('keeps a failed load from affecting the others and never retries it', async () => {
    const f = fakeClient(variantsProduct(2));
    const mounted = start([keys('a', 3), keys('b', 2)], f.client);
    await f.answer('a00', { kind: 'error', message: 'boom' });
    await f.answer('a01');
    await f.answer('a02');
    const handle = await mounted;
    expect([...cards().values()]).toEqual(['error', 'loaded', 'loaded']);
    selectVariant('V2');
    await f.answer('b00');
    await f.answer('b01');
    selectVariant('V1');
    await settled();
    expect(f.calls).toEqual(['a00', 'a01', 'a02', 'b00', 'b01']);
    handle.destroy();
  });

  it('ends a target whose client throws in the error state, logs it, and loads the rest', async () => {
    const f = fakeClient(variantsProduct(2));
    const logs: string[] = [];
    const mounted = start([keys('a', 1), keys('b', 3)], f.client, testAdapter, logs);
    await f.answer('a00');
    const handle = await mounted;
    const original = f.client.load.bind(f.client);
    f.client.load = async (storeId, pageKey, emit) => {
      if (pageKey === 'b00') throw new Error('client broke');
      return original(storeId, pageKey, emit);
    };
    selectVariant('V2');
    await vi.waitFor(() => expect(logs.some((l) => l.startsWith('warn:') && l.includes('client broke'))).toBe(true));
    // The worker that met the throw goes on: the other two targets are still asked, and the thrown one is not left loading.
    await f.answer('b01');
    await f.answer('b02');
    expect([...cards().values()]).toEqual(['error', 'loaded', 'loaded']);
    expect(f.calls).toEqual(['a00', 'b01', 'b02']);
    handle.destroy();
  });
});
