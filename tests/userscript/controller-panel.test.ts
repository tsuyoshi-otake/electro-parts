import { describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { HOST_ELEMENT_ID, THEME_STORAGE_KEY, mountHistoryPanel } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import { PANEL_TITLE } from '../../userscript/ui/panel.ts';
import { fakeHost, json, sampleManifest, sampleProduct, testAdapter, type FakeHost } from './helpers.ts';

const BASE = 'https://data.example.test';
const LOC = { hostname: 'example.test', pathname: '/p/P1' };

function page(withMount = true): void {
  document.body.replaceChildren();
  const h1 = document.createElement('h1');
  h1.textContent = 'Test Part';
  document.body.appendChild(h1);
  if (withMount) {
    const buy = document.createElement('div');
    buy.id = 'buy';
    buy.textContent = 'Add to cart';
    document.body.appendChild(buy);
  }
}

function hostWithData(): FakeHost {
  const host = fakeHost();
  host.routes.set(`${BASE}/${manifestPath('teststore')}`, json(sampleManifest()));
  host.routes.set(`${BASE}/${productPath('teststore', 'P1')}`, json(sampleProduct()));
  return host;
}

function shadowText(): string {
  const root = document.getElementById(HOST_ELEMENT_ID)?.shadowRoot;
  return root?.querySelector('section')?.textContent ?? '';
}

async function mount(host: FakeHost, options: Partial<Parameters<typeof mountHistoryPanel>[0]> = {}) {
  return mountHistoryPanel({
    adapters: [testAdapter],
    host,
    client: new DataClient(host, { baseUrl: BASE }),
    doc: document,
    location: LOC,
    dataBaseUrl: BASE,
    lazyChart: false,
    mountTimeoutMs: 200,
    ...options,
  });
}

describe('history panel controller', () => {
  it('switches both ways, preserves keyboard focus, and shares the saved preference between stores', async () => {
    page();
    const host = hostWithData();
    const handle = await mount(host);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    const buttons = root.querySelectorAll('button');
    expect([...buttons].map((b) => b.textContent)).toEqual(['ライト', 'ダーク']);
    buttons[1]!.focus();
    buttons[1]!.click();
    expect(root.querySelector('section')?.dataset['theme']).toBe('dark');
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(root.activeElement).toBe(buttons[1]);
    await vi.waitFor(() => expect(host.store.get(THEME_STORAGE_KEY)).toBe('dark'));
    expect(host.requests).toHaveLength(2); // theme changes must not reload history
    handle.destroy();

    // A different adapter uses the same userscript-scoped storage, not page localStorage.
    const other = await mount(host, { adapters: [{ ...testAdapter, storeId: 'secondstore' }] });
    const otherRoot = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(otherRoot.querySelector('section')?.dataset['theme']).toBe('dark');
    otherRoot.querySelectorAll('button')[0]!.click();
    expect(otherRoot.querySelector('section')?.dataset['theme']).toBe('light');
    await vi.waitFor(() => expect(host.store.get(THEME_STORAGE_KEY)).toBe('light'));
    other.destroy();
    await mount(host);
    expect(document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelector('section')?.dataset['theme']).toBe('light');
  });

  it('uses the system theme initially but honors an explicit light preference on a dark system', async () => {
    page();
    const previous = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: true, media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => true,
    });
    try {
      const host = hostWithData();
      let handle = await mount(host);
      expect(document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelector('section')?.dataset['theme']).toBe('dark');
      handle.destroy();
      host.store.set(THEME_STORAGE_KEY, 'light');
      handle = await mount(host);
      expect(document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelector('section')?.dataset['theme']).toBe('light');
      handle.destroy();
    } finally { window.matchMedia = previous; }
  });

  it('keeps the panel usable if preference storage fails', async () => {
    page();
    const host = hostWithData();
    const get = host.storage.get;
    const set = host.storage.set;
    host.storage.get = async (key) => { if (key === THEME_STORAGE_KEY) throw new Error('blocked'); return get(key); };
    host.storage.set = async (key, value) => { if (key === THEME_STORAGE_KEY) throw new Error('blocked'); return set(key, value); };
    await mount(host);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    root.querySelectorAll('button')[1]!.click();
    expect(root.querySelector('section')?.dataset['theme']).toBe('dark');
    expect(shadowText()).toContain('￥1,200');
    await vi.waitFor(() => expect(host.logs).toContain('warn: display preference could not be saved'));
  });

  it('mounts a Shadow DOM panel after the anchor and renders the loaded history', async () => {
    page();
    const host = hostWithData();
    const handle = await mount(host);
    expect(handle).toMatchObject({ mounted: true, storeId: 'teststore', pageKey: 'P1' });
    const el = document.getElementById(HOST_ELEMENT_ID)!;
    expect(el.previousElementSibling?.id).toBe('buy');
    expect(el.shadowRoot).not.toBeNull();
    expect(document.body.textContent).not.toContain(PANEL_TITLE); // lives in the shadow tree only
    const text = shadowText();
    expect(text).toContain(PANEL_TITLE);
    expect(text).toContain('最新');
    expect(text).toContain('￥1,200');
    expect(text).toContain('+￥50');
    expect(text).toContain('+4.4%');
    expect(text).toContain('￥1,150〜￥1,200');
    expect(text).toContain('在庫あり');
    expect(text).toContain('表示在庫数 781');
    expect(text).toContain('販売価格 / 税込 / 1個');
    expect(text).toContain('観測期間 2026-08-02〜2026-09-06(2 回)');
    expect(text).toContain('データ版 v1');
    expect(text).toContain('全期間の最安値ではありません');
    const svg = el.shadowRoot!.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.querySelectorAll('circle')).toHaveLength(2);
    const rows = el.shadowRoot!.querySelectorAll('table tr');
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain('￥1,200');
    expect(el.shadowRoot!.querySelector('a')?.getAttribute('href')).toBe(BASE);
    // Never any HTML injection surface.
    expect(el.shadowRoot!.innerHTML).not.toContain('<script');
    handle.destroy();
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
  });

  it('applies the layout declarations the adapter attaches to the mount point', async () => {
    page();
    const buy = document.getElementById('buy')!;
    const adapter = {
      ...testAdapter,
      findMountPoint: () => ({ anchor: buy, position: 'after' as const, hostStyle: { 'grid-column': '1 / -1' } }),
    };
    await mount(hostWithData(), { adapters: [adapter] });
    // The page's own layout is the adapter's business; the panel only asks to
    // be given the width it was designed for.
    expect(document.getElementById(HOST_ELEMENT_ID)?.style.getPropertyValue('grid-column')).toBe('1 / -1');
  });

  it('shows the stale badge and note when only the cache is available', async () => {
    page();
    const host = hostWithData();
    await mount(host);
    document.getElementById(HOST_ELEMENT_ID)?.remove();
    host.clock += 3_600_000;
    host.routes.set(`${BASE}/${manifestPath('teststore')}`, new Error('offline'));
    await mount(host);
    const text = shadowText();
    expect(text).toContain('キャッシュ表示');
    expect(text).toContain('￥1,200');
    expect(text).toContain('manifest unavailable');
  });

  it('renders the missing and error states unobtrusively (fail-open)', async () => {
    page();
    const host = fakeHost();
    host.routes.set(`${BASE}/${manifestPath('teststore')}`, json(sampleManifest()));
    await mount(host);
    expect(shadowText()).toContain('まだ観測データに含まれていません');
    document.getElementById(HOST_ELEMENT_ID)?.remove();

    const broken = fakeHost();
    broken.routes.set(`${BASE}/${manifestPath('teststore')}`, new Error('offline'));
    await mount(broken);
    expect(shadowText()).toContain('取得できませんでした');
    expect(document.querySelector('h1')?.textContent).toBe('Test Part');
  });

  it('does nothing on unsupported pages, non-product pages, or when already mounted', async () => {
    page();
    const host = hostWithData();
    expect((await mount(host, { location: { hostname: 'other.test', pathname: '/p/P1' } })).mounted).toBe(false);
    expect((await mount(host, { location: { hostname: 'example.test', pathname: '/p/' } })).mounted).toBe(false);
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
    expect((await mount(host)).mounted).toBe(true);
    expect((await mount(host)).mounted).toBe(false);
    expect(document.querySelectorAll(`#${HOST_ELEMENT_ID}`)).toHaveLength(1);
    expect(host.requests.filter((u) => u.includes('products/'))).toHaveLength(1);
  });

  it('waits (bounded) for a late mount point, and gives up quietly when it never appears', async () => {
    page(false);
    const host = hostWithData();
    setTimeout(() => {
      const buy = document.createElement('div');
      buy.id = 'buy';
      document.body.appendChild(buy);
    }, 30);
    expect((await mount(host)).mounted).toBe(true);

    page(false);
    const handle = await mount(host);
    expect(handle.mounted).toBe(false);
    expect(host.logs).toContain('warn: mount point not found');
  });

  it('never throws into the page when the adapter or the host misbehaves', async () => {
    page();
    const host = hostWithData();
    const explosive = { ...testAdapter, extractPageKey: () => { throw new Error('kaboom'); } };
    const handle = await mount(host, { adapters: [explosive] });
    expect(handle.mounted).toBe(false);
    expect(host.logs.some((l) => l.includes('kaboom'))).toBe(true);
    expect(document.querySelector('h1')?.textContent).toBe('Test Part');
  });

  it('offers a segment selector when several price bases exist and switches the chart', async () => {
    page();
    const host = fakeHost();
    const product = sampleProduct();
    const primary = product.offers[0]!.segments[0]!;
    const excluded = { ...primary, primary: false, basis: { ...primary.basis, taxTreatment: 'tax_excluded' as const }, points: [[primary.points[0]![0], 'exact', 1046, 1046]] as typeof primary.points, stats: { ...primary.stats, current: { state: 'exact' as const, minAmountMinor: 1046, maxAmountMinor: 1046 }, changePointCount: 1 } };
    product.offers[0]!.segments.push(excluded);
    host.routes.set(`${BASE}/${manifestPath('teststore')}`, json(sampleManifest()));
    host.routes.set(`${BASE}/${productPath('teststore', 'P1')}`, json(product));
    await mount(host);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    const select = root.querySelector('select')!;
    expect(select.options).toHaveLength(2);
    expect(select.value).toBe('0');
    expect(root.querySelector('section')?.textContent).toContain('￥1,200');
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    expect(root.querySelector('section')?.textContent).toContain('￥1,046');
    expect(root.querySelector('section')?.textContent).toContain('税抜');
  });
});
