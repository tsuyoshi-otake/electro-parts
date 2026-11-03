import { describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { HOST_ELEMENT_ID, OWNER_ATTRIBUTE, THEME_STORAGE_KEY, mountHistoryPanel } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import { PREFERENCES_STORAGE_KEY } from '../../userscript/core/preferences.ts';
import { PAGE_THEME_CONTROL_ID } from '../../userscript/ui/pageTheme.ts';
import { PANEL_TITLE } from '../../userscript/ui/panel.ts';
import { indexRelations } from '../../userscript/core/relations.ts';
import type { StorePageAdapter } from '../../userscript/core/types.ts';
import { comparisonFixture } from './comparison-fixtures.ts';
import { fakeHost, json, sampleManifest, sampleProduct, testAdapter, type FakeHost } from './helpers.ts';

const BASE = 'https://data.example.test';
const LOC = { hostname: 'example.test', pathname: '/p/P1' };

/** A freshly loaded document: no owner from an earlier test, no theme, the given content. */
function page(withMount = true): void {
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
  document.documentElement.removeAttribute('data-eph-page-theme');
  for (const style of document.querySelectorAll('style[data-eph-page-theme]')) style.remove();
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
  it('shows the optional two-day interval without requiring a new published caveat key', async () => {
    page(); const host = hostWithData();
    const manifest = sampleManifest();
    manifest.observation.samplingIntervalDays = 2;
    manifest.caveats = ['observation_window'];
    host.routes.set(`${BASE}/${manifestPath('teststore')}`, json(manifest));
    const handle = await mount(host);
    expect(shadowText()).toContain('おおむね2日に1回');
    expect(shadowText()).not.toContain('取得できません');
    handle.destroy();
  });
  it('limits total related history work but retains every link and a terminal reference-only state', async () => {
    page(); const host = hostWithData(); const { relation, other } = comparisonFixture();
    const relations = Array.from({length: 12}, (_, i) => ({ ...relation, id: `pair-${String(i).padStart(2, '0')}`, kind: 'similar_product' as const,
      pricePolicy: null, differences: [`構成: 0 ↔ ${i + 1}`],
      products: [relation.products[0], {...relation.products[1], pageKey: `Q${i}`, url: `https://other.test/Q${i}`}] as typeof relation.products }));
    host.routes.set(`${BASE}/${manifestPath('otherstore')}`, json(sampleManifest({storeId: 'otherstore'})));
    for (let i = 0; i < 12; i++) host.routes.set(`${BASE}/${productPath('otherstore', `Q${i}`)}`, json({...other, pageKey: `Q${i}`, externalProductId: `Q${i}`}));
    const handle = await mount(host, {relationIndex: indexRelations(relations)});
    expect(host.requests.filter(url => url.includes('/otherstore/products/'))).toHaveLength(8);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(root.querySelectorAll('.related-card')).toHaveLength(12);
    expect(shadowText()).toContain('履歴の自動取得は上位候補のみ');
    expect(shadowText()).not.toContain('読み込み中');
    const before = [...host.requests]; root.querySelectorAll('button')[1]!.click();
    await Promise.resolve(); expect(host.requests).toEqual(before); handle.destroy();
  });
  it('bounds related loads to two, deduplicates endpoints, and does not reload on display changes', async () => {
    page();
    const host = hostWithData();
    const { relation, other } = comparisonFixture();
    const relations = ['P2', 'P3', 'P4', 'P2'].map((key, i) => ({ ...relation, id: `pair-${i}`,
      products: [relation.products[0], { ...relation.products[1], pageKey: key }] as typeof relation.products }));
    host.routes.set(`${BASE}/${manifestPath('otherstore')}`, json(sampleManifest({ storeId: 'otherstore' })));
    for (const key of ['P2', 'P3', 'P4']) host.routes.set(`${BASE}/${productPath('otherstore', key)}`, key === 'P3'
      ? { status: 429, text: 'rate limited' } : json({ ...other, pageKey: key, externalProductId: key }));
    const fetch = host.fetchText;
    let active = 0;
    let peak = 0;
    host.fetchText = async (url, timeout) => {
      if (!url.includes('/otherstore/products/')) return fetch(url, timeout);
      active++; peak = Math.max(peak, active);
      try { await new Promise((resolve) => setTimeout(resolve, 20)); return await fetch(url, timeout); }
      finally { active--; }
    };
    const handle = await mount(host, { relationIndex: indexRelations(relations) });
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(host.requests.filter((url) => url.includes('/otherstore/manifest'))).toHaveLength(1);
    expect(host.requests.filter((url) => url.includes('/otherstore/products/'))).toHaveLength(3);
    expect(shadowText()).not.toContain('読込中');
    const before = host.requests.length;
    document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelectorAll('button')[1]!.click();
    await Promise.resolve();
    expect(host.requests).toHaveLength(before);
    handle.destroy();
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
  });

  it('does not request invisible related histories when the current product fails', async () => {
    page();
    const host = fakeHost();
    const { relation } = comparisonFixture();
    await mount(host, { relationIndex: indexRelations([relation]) });
    expect(shadowText()).toContain('取得できませんでした');
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]).toContain('/teststore/');
  });

  it('disconnects the pending lazy chart observer when the mounted panel is destroyed', async () => {
    page();
    const previous = Object.getOwnPropertyDescriptor(window, 'IntersectionObserver');
    const disconnect = vi.fn();
    Object.defineProperty(window, 'IntersectionObserver', {configurable: true, value: class {
      observe() {} disconnect = disconnect;
    }});
    try {
      const handle = await mount(hostWithData(), {lazyChart: true});
      const before = disconnect.mock.calls.length;
      handle.destroy(); expect(disconnect.mock.calls.length).toBe(before + 1);
    } finally {
      if (previous) Object.defineProperty(window, 'IntersectionObserver', previous);
      else Reflect.deleteProperty(window, 'IntersectionObserver');
    }
  });
  it('switches both ways, preserves keyboard focus, and shares the saved preference between stores', async () => {
    page();
    const host = hostWithData();
    const handle = await mount(host);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    const buttons = root.querySelectorAll<HTMLButtonElement>('.theme-controls button');
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

  it('opens the settings dialog, keeps it open across the re-render a change causes, and saves each change', async () => {
    page();
    const host = hostWithData();
    const handle = await mount(host);
    const root = () => document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    const button = root().querySelector<HTMLButtonElement>('.settings-button')!;
    expect(button.textContent).toBe('設定');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(root().querySelector<HTMLDialogElement>('dialog.settings')!.hasAttribute('open')).toBe(false);
    button.click();
    const dialog = () => root().querySelector<HTMLDialogElement>('dialog.settings')!;
    expect(dialog().hasAttribute('open')).toBe(true);
    // Off by default, with the default card selected.
    const fee = () => dialog().querySelector<HTMLInputElement>('[data-focus-key="pref-fee-enabled"]')!;
    expect(fee().checked).toBe(false);
    expect(dialog().querySelector<HTMLSelectElement>('select')!.value).toBe('smbc-visa-mastercard');
    fee().focus();
    fee().checked = true;
    fee().dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(JSON.parse(host.store.get(PREFERENCES_STORAGE_KEY) ?? '{}')).toMatchObject({ cardFee: { enabled: true, cardId: 'smbc-visa-mastercard' } }));
    // Rebuilt open, with the changed control still focused.
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(fee().checked).toBe(true);
    expect(root().activeElement).toBe(fee());
    const card = dialog().querySelector<HTMLSelectElement>('select')!;
    card.value = 'amex';
    card.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(JSON.parse(host.store.get(PREFERENCES_STORAGE_KEY)!).cardFee.cardId).toBe('amex'));
    const stock = dialog().querySelector<HTMLInputElement>('[data-focus-key="pref-show-stock"]')!;
    expect(root().querySelector('.stock-chart')).not.toBeNull();
    stock.checked = false;
    stock.dispatchEvent(new Event('change'));
    expect(root().querySelector('.stock-chart')).toBeNull();
    await vi.waitFor(() => expect(JSON.parse(host.store.get(PREFERENCES_STORAGE_KEY)!).showStock).toBe(false));
    // Escape closes it and focus returns to the button that opened it.
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(root().activeElement).toBe(root().querySelector('.settings-button'));
    expect(host.requests).toHaveLength(2); // settings changes must not reload history
    handle.destroy();

    // The next page reads the saved settings.
    page();
    await mount(host);
    root().querySelector<HTMLButtonElement>('.settings-button')!.click();
    expect(dialog().querySelector<HTMLSelectElement>('select')!.value).toBe('amex');
    expect(dialog().querySelector<HTMLInputElement>('[data-focus-key="pref-show-stock"]')!.checked).toBe(false);
    expect(root().querySelector('.stock-chart')).toBeNull();
    dialog().querySelector<HTMLButtonElement>('[data-focus-key="pref-close"]')!.click();
    expect(dialog().hasAttribute('open')).toBe(false);
  });

  it('accepts an entered fee only within 0 to 10 percent', async () => {
    page();
    const host = hostWithData();
    await mount(host);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('.settings-button')!.click();
    const dialog = () => root.querySelector<HTMLDialogElement>('dialog.settings')!;
    const card = dialog().querySelector<HTMLSelectElement>('select')!;
    card.value = 'custom';
    card.dispatchEvent(new Event('change'));
    const percent = () => dialog().querySelector<HTMLInputElement>('[data-focus-key="pref-fee-percent"]')!;
    percent().value = '12';
    percent().dispatchEvent(new Event('change'));
    expect(dialog().querySelector('.error')?.textContent).toBe('0〜10 の数値を入力してください');
    expect(percent().getAttribute('aria-invalid')).toBe('true');
    await vi.waitFor(() => expect(JSON.parse(host.store.get(PREFERENCES_STORAGE_KEY)!).cardFee).toMatchObject({ cardId: 'custom', customPercent: null }));
    percent().value = '2.5';
    percent().dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(JSON.parse(host.store.get(PREFERENCES_STORAGE_KEY)!).cardFee).toMatchObject({ cardId: 'custom', customPercent: 2.5 }));
    expect(percent().value).toBe('2.5');
  });

  it('keeps the panel usable with default settings if settings storage fails', async () => {
    page();
    const host = hostWithData();
    const get = host.storage.get;
    const set = host.storage.set;
    host.storage.get = async (key) => { if (key === PREFERENCES_STORAGE_KEY) throw new Error('blocked'); return get(key); };
    host.storage.set = async (key, value) => { if (key === PREFERENCES_STORAGE_KEY) throw new Error('blocked'); return set(key, value); };
    await mount(host);
    const root = document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
    expect(shadowText()).toContain('￥1,200');
    expect(host.logs).toContain('warn: settings unavailable; using defaults');
    root.querySelector<HTMLButtonElement>('.settings-button')!.click();
    const stock = root.querySelector<HTMLInputElement>('[data-focus-key="pref-show-stock"]')!;
    expect(stock.checked).toBe(true);
    stock.checked = false;
    stock.dispatchEvent(new Event('change'));
    // The change applies to this page even though it could not be saved.
    expect(root.querySelector('.stock-chart')).toBeNull();
    await vi.waitFor(() => expect(host.logs).toContain('warn: settings could not be saved'));
  });

  it('defaults to light even on a dark system and honors a saved dark preference', async () => {
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
      expect(document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelector('section')?.dataset['theme']).toBe('light');
      handle.destroy();
      host.store.set(THEME_STORAGE_KEY, 'dark');
      handle = await mount(host);
      expect(document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelector('section')?.dataset['theme']).toBe('dark');
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
    (await mount(host)).destroy(); // the previous page view
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
    const missing = await mount(host);
    expect(shadowText()).toContain('まだ観測データに含まれていません');
    missing.destroy();

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
    const nonProduct = await mount(host, { location: { hostname: 'example.test', pathname: '/p/' } });
    expect(nonProduct.mounted).toBe(false);
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
    nonProduct.destroy(); // the next page view
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

/** A page that swaps the product it shows without navigating, driven by the test. */
function inPlacePage() {
  let shown: string | null = null;
  let listener: ((pageKey: string | null) => void) | null = null;
  const adapter: StorePageAdapter = {
    ...testAdapter,
    pageThemeCss: 'html[data-eph-page-theme="dark"] body { color: white; }',
    extractPageKey: () => shown,
    watchPageKey: (_doc, onChange) => {
      listener = onChange;
      return () => { listener = null; };
    },
  };
  return {
    adapter,
    show(pageKey: string | null) {
      shown = pageKey;
      listener?.(pageKey);
    },
    watching: () => listener !== null,
  };
}

const panelHosts = () => [...document.querySelectorAll<HTMLElement>(`#${HOST_ELEMENT_ID}`)];
const shownKey = () => panelHosts().map((el) => el.dataset['pageKey']);

function hostWithTwoProducts(): FakeHost {
  const host = hostWithData();
  host.routes.set(`${BASE}/${productPath('teststore', 'P2')}`, json(sampleProduct({ pageKey: 'P2', externalProductId: 'P2' })));
  return host;
}

describe('history panel controller on pages that change the product in place', () => {
  it('follows the product shown with one panel at a time, and none while no product is shown', async () => {
    page();
    const host = hostWithTwoProducts();
    const p = inPlacePage();
    const handle = await mount(host, { adapters: [p.adapter] });
    expect(handle).toMatchObject({ mounted: false, storeId: 'teststore', pageKey: null });
    expect(host.logs).toContain('debug: no product shown yet');
    expect(panelHosts()).toEqual([]);

    p.show('P1');
    await vi.waitFor(() => expect(shadowText()).toContain('￥1,200'));
    expect(shownKey()).toEqual(['P1']);
    expect(handle).toMatchObject({ mounted: true, pageKey: 'P1' });

    p.show('P2');
    await vi.waitFor(() => expect(shownKey()).toEqual(['P2']));
    await vi.waitFor(() => expect(shadowText()).toContain('￥1,200'));
    expect(handle).toMatchObject({ mounted: true, pageKey: 'P2' });

    p.show(null);
    expect(panelHosts()).toEqual([]);
    expect(handle).toMatchObject({ mounted: false, pageKey: null });

    p.show('P1');
    await vi.waitFor(() => expect(shownKey()).toEqual(['P1']));
    await vi.waitFor(() => expect(shadowText()).toContain('￥1,200'));
    handle.destroy();
    expect(panelHosts()).toEqual([]);
    expect(p.watching()).toBe(false);
    expect(document.documentElement.hasAttribute(OWNER_ATTRIBUTE)).toBe(false);
  });

  it('keeps the panel for a product reported again, and replaces one the page removed', async () => {
    page();
    const host = hostWithTwoProducts();
    const p = inPlacePage();
    p.show('P1');
    await mount(host, { adapters: [p.adapter] });
    const first = panelHosts()[0]!;
    p.show('P1');
    expect(panelHosts()).toEqual([first]);

    first.remove(); // the page rebuilt its dialog
    p.show('P1');
    await vi.waitFor(() => expect(shadowText()).toContain('￥1,200'));
    expect(shownKey()).toEqual(['P1']);
    expect(panelHosts()[0]).not.toBe(first);
  });

  it('never mounts a product the page moved away from while its panel waited for a place', async () => {
    page(false);
    const host = hostWithTwoProducts();
    const p = inPlacePage();
    const handle = await mount(host, { adapters: [p.adapter], mountTimeoutMs: 500 });
    p.show('P1');
    p.show('P2');
    const buy = document.createElement('div');
    buy.id = 'buy';
    document.body.appendChild(buy);
    await vi.waitFor(() => expect(shownKey()).toEqual(['P2']));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shownKey()).toEqual(['P2']);
    expect(host.requests.some((u) => u.endsWith(productPath('teststore', 'P1')))).toBe(false);
    expect(handle.pageKey).toBe('P2');
  });

  it('carries the display chosen in one panel over to the next product', async () => {
    page();
    const host = hostWithTwoProducts();
    const p = inPlacePage();
    p.show('P1');
    await mount(host, { adapters: [p.adapter] });
    document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelectorAll('button')[1]!.click();
    expect(document.documentElement.getAttribute('data-eph-page-theme')).toBe('dark');

    p.show('P2');
    await vi.waitFor(() => expect(shownKey()).toEqual(['P2']));
    await vi.waitFor(() => expect(document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelector('section')?.dataset['theme']).toBe('dark'));
    expect(document.documentElement.getAttribute('data-eph-page-theme')).toBe('dark');
  });

  it('offers the light reset only while no panel with its own theme switch is shown', async () => {
    page();
    const host = hostWithTwoProducts();
    host.store.set(THEME_STORAGE_KEY, 'dark');
    const p = inPlacePage();
    await mount(host, { adapters: [p.adapter] });
    const reset = () => document.querySelectorAll(`#${PAGE_THEME_CONTROL_ID}`).length;
    expect(reset()).toBe(1);
    p.show('P1');
    await vi.waitFor(() => expect(shownKey()).toEqual(['P1']));
    expect(reset()).toBe(0);
    p.show(null);
    expect(reset()).toBe(1);
    p.show('P2');
    await vi.waitFor(() => expect(shownKey()).toEqual(['P2']));
    expect(reset()).toBe(0);
    // A product whose panel finds no place leaves the way back to light.
    document.getElementById('buy')!.remove();
    p.show('P1');
    await vi.waitFor(() => expect(host.logs).toContain('warn: mount point not found'));
    await vi.waitFor(() => expect(reset()).toBe(1));
  });

  it('logs instead of throwing when a product shown later fails to load', async () => {
    page();
    const host = hostWithData();
    const p = inPlacePage();
    await mount(host, { adapters: [p.adapter] });
    host.routes.set(`${BASE}/${manifestPath('teststore')}`, new Error('offline'));
    p.show('P1');
    await vi.waitFor(() => expect(shadowText()).toContain('取得できませんでした'));
    expect(document.querySelector('h1')?.textContent).toBe('Test Part');
  });
});

/**
 * A `matchMedia` for one query whose result the test flips. jsdom has none;
 * the list's listeners are a real EventTarget's.
 */
function switchableMedia(matches: boolean) {
  const list = Object.assign(new EventTarget(), { matches, media: '' });
  const listeners = new Set<EventListenerOrEventListenerObject | null>();
  const add = list.addEventListener.bind(list);
  const remove = list.removeEventListener.bind(list);
  list.addEventListener = (type, listener, options) => { listeners.add(listener); add(type, listener, options); };
  list.removeEventListener = (type, listener, options) => { listeners.delete(listener); remove(type, listener, options); };
  const asked: string[] = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      asked.push(query);
      return Object.assign(list, { media: query });
    },
  });
  return {
    asked,
    listening: () => listeners.size,
    flip(value: boolean) {
      list.matches = value;
      list.dispatchEvent(new Event('change'));
    },
    uninstall() {
      delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}

/** Narrow: after `#narrow`. Wide: after `#buy`, claiming the grid's columns. Counts its calls. */
function layoutAdapter(): StorePageAdapter & { calls: number } {
  const adapter = {
    ...testAdapter,
    calls: 0,
    layoutQuery: '(max-width: 600px)',
    findMountPoint(d: Document) {
      adapter.calls++;
      return d.defaultView?.matchMedia?.('(max-width: 600px)').matches === true
        ? { anchor: d.getElementById('narrow')!, position: 'after' as const }
        : { anchor: d.getElementById('buy')!, position: 'after' as const, hostStyle: { 'grid-column': '1 / -1' } };
    },
  };
  return adapter;
}

function layoutPage(): void {
  page();
  const narrow = document.createElement('div');
  narrow.id = 'narrow';
  document.body.insertBefore(narrow, document.querySelector('h1'));
}

describe('history panel controller across the page layout switch', () => {
  it('moves the same panel to the adapter\'s other place each time the layout query flips, with that place\'s declarations only', async () => {
    layoutPage();
    const media = switchableMedia(false);
    try {
      const host = hostWithData();
      const handle = await mount(host, { adapters: [layoutAdapter()] });
      const el = document.getElementById(HOST_ELEMENT_ID)!;
      const shadow = el.shadowRoot;
      const requests = host.requests.length;
      expect(media.asked).toContain('(max-width: 600px)');
      expect(el.previousElementSibling?.id).toBe('buy');
      expect(el.style.getPropertyValue('grid-column')).toBe('1 / -1');

      media.flip(true);
      expect(el.previousElementSibling?.id).toBe('narrow');
      expect(el.getAttribute('style') ?? '').toBe('');
      media.flip(false);
      expect(el.previousElementSibling?.id).toBe('buy');
      expect(el.style.getPropertyValue('grid-column')).toBe('1 / -1');
      // Moved, not rebuilt: the same host and shadow tree, no new requests.
      expect(document.getElementById(HOST_ELEMENT_ID)).toBe(el);
      expect(el.shadowRoot).toBe(shadow);
      expect(shadowText()).toContain('￥1,200');
      expect(host.requests).toHaveLength(requests);
      handle.destroy();
    } finally { media.uninstall(); }
  });

  it('leaves the page untouched when the place has not changed, and asks nothing of adapters without a layout query', async () => {
    layoutPage();
    const media = switchableMedia(false);
    try {
      const adapter = { ...layoutAdapter(), findMountPoint: (d: Document) => ({ anchor: d.getElementById('buy')!, position: 'after' as const }) };
      const handle = await mount(hostWithData(), { adapters: [adapter] });
      const observer = new MutationObserver(() => undefined);
      observer.observe(document.body, { childList: true, subtree: true });
      media.flip(true);
      expect(observer.takeRecords()).toEqual([]);
      observer.disconnect();
      handle.destroy();

      layoutPage();
      media.asked.length = 0;
      const plain = await mount(hostWithData());
      expect(plain.mounted).toBe(true);
      expect(media.asked).toEqual([]);
      expect(media.listening()).toBe(0);
      plain.destroy();
    } finally { media.uninstall(); }
  });

  it('moves a host in the document with moveBefore where the browser has it, and re-inserts it when that is refused', async () => {
    layoutPage();
    const media = switchableMedia(false);
    const proto = Element.prototype as { moveBefore?: (node: Node, child: Node | null) => void };
    expect(proto.moveBefore).toBeUndefined();
    const moved: Node[] = [];
    let refuse = false;
    proto.moveBefore = function (this: Element, node: Node, child: Node | null) {
      if (refuse) throw new DOMException('refused', 'HierarchyRequestError');
      moved.push(node);
      this.insertBefore(node, child);
    };
    try {
      const handle = await mount(hostWithData(), { adapters: [layoutAdapter()] });
      const el = document.getElementById(HOST_ELEMENT_ID)!;
      // The first insertion is not a move.
      expect(moved).toEqual([]);
      media.flip(true);
      expect(moved).toEqual([el]);
      expect(el.previousElementSibling?.id).toBe('narrow');
      refuse = true;
      media.flip(false);
      expect(el.previousElementSibling?.id).toBe('buy');
      expect(moved).toEqual([el]);
      handle.destroy();
    } finally {
      delete proto.moveBefore;
      media.uninstall();
    }
  });

  it('stops following once the panel is closed, never puts back a host the page removed, and logs an adapter that throws', async () => {
    layoutPage();
    const media = switchableMedia(false);
    try {
      const host = hostWithData();
      const adapter = layoutAdapter();
      const handle = await mount(host, { adapters: [adapter] });
      const el = document.getElementById(HOST_ELEMENT_ID)!;
      expect(media.listening()).toBe(1);

      const original = adapter.findMountPoint;
      adapter.findMountPoint = () => { throw new Error('boom'); };
      expect(() => media.flip(true)).not.toThrow();
      expect(host.logs).toContain('error: panel could not follow the layout: boom');
      expect(el.previousElementSibling?.id).toBe('buy');
      adapter.findMountPoint = original;

      el.remove(); // the page rebuilt that part of itself
      const calls = adapter.calls;
      media.flip(false);
      expect(el.isConnected).toBe(false);
      expect(adapter.calls).toBe(calls);

      handle.destroy();
      expect(media.listening()).toBe(0);
    } finally { media.uninstall(); }
  });
});
