import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { PAGE_THEME_CONTROL_ID, createPageTheme, pageThemeCss } from '../../userscript/ui/pageTheme.ts';
import { HOST_ELEMENT_ID, OWNER_ATTRIBUTE, mountHistoryPanel, THEME_STORAGE_KEY } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import type { StorePageAdapter } from '../../userscript/core/types.ts';
import { fakeHost, json, sampleManifest, sampleProduct, testAdapter, type FakeHost } from './helpers.ts';

const BASE = 'https://data.example.test';
/** The test store themes its home page and product pages; `/cart` is out of scope. */
const themed: StorePageAdapter = { ...testAdapter, matchPatterns: ['https://example.test/', 'https://example.test/p/*'], pageThemeCss: pageThemeCss('main') };
const themeStyles = () => document.querySelectorAll('style[data-eph-page-theme]');
const control = () => document.getElementById(PAGE_THEME_CONTROL_ID);

function darkHost(): FakeHost {
  const host = fakeHost();
  host.store.set(THEME_STORAGE_KEY, 'dark');
  return host;
}

function mount(host: FakeHost, pathname: string, options: Partial<Parameters<typeof mountHistoryPanel>[0]> = {}) {
  return mountHistoryPanel({ adapters: [themed], host, client: new DataClient(host, { baseUrl: BASE }), doc: document,
    location: { hostname: 'example.test', pathname }, dataBaseUrl: BASE, lazyChart: false, mountTimeoutMs: 50, ...options });
}

/** Clicks the fixed reset control and checks that the page and the saved setting are back to light. */
async function resetToLight(host: FakeHost): Promise<void> {
  expect(document.documentElement.getAttribute('data-eph-page-theme')).toBe('dark');
  control()!.shadowRoot!.querySelector('button')!.click();
  expect(document.documentElement.hasAttribute('data-eph-page-theme')).toBe(false);
  expect(themeStyles()).toHaveLength(0);
  expect(control()).toBeNull();
  await vi.waitFor(() => expect(host.store.get(THEME_STORAGE_KEY)).toBe('light'));
}

afterEach(() => {
  // A fresh document for every test: no owner, no theme, no page content.
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
  document.documentElement.removeAttribute('data-eph-page-theme');
  for (const style of themeStyles()) style.remove();
  document.body.replaceChildren();
});

describe('page theme lifecycle', () => {
  it('adds one owned style, restores light completely and ignores changes after destroy', () => {
    const theme = createPageTheme(document, pageThemeCss('main'));
    theme.set('dark'); theme.set('dark');
    expect(themeStyles()).toHaveLength(1);
    theme.set('light');
    expect(document.documentElement.hasAttribute('data-eph-page-theme')).toBe(false);
    expect(themeStyles()).toHaveLength(0);
    theme.set('dark'); theme.destroy(); theme.set('dark');
    expect(document.documentElement.hasAttribute('data-eph-page-theme')).toBe(false);
    expect(themeStyles()).toHaveLength(0);
  });

  it('offers the reset control only while dark is applied, once, and removes it with light', () => {
    const theme = createPageTheme(document, pageThemeCss('main'));
    const onLight = vi.fn();
    theme.offerLightReset(onLight);
    expect(control()).toBeNull();
    theme.set('dark'); theme.offerLightReset(onLight); theme.offerLightReset(onLight);
    expect(document.querySelectorAll(`#${PAGE_THEME_CONTROL_ID}`)).toHaveLength(1);
    theme.set('light');
    expect(control()).toBeNull();
    expect(onLight).not.toHaveBeenCalled();
    theme.set('dark'); theme.offerLightReset(onLight);
    control()!.shadowRoot!.querySelector('button')!.click();
    expect(onLight).toHaveBeenCalledTimes(1);
    expect(control()).toBeNull();
  });
});

describe('controller page theme', () => {
  it('restores a saved theme on a non-product page without history requests and provides a light reset', async () => {
    const host = darkHost();
    const handle = await mount(host, '/');
    expect(handle.mounted).toBe(false);
    expect(host.requests).toHaveLength(0);
    await resetToLight(host);
    handle.destroy();
    expect(document.documentElement.hasAttribute(OWNER_ATTRIBUTE)).toBe(false);
  });

  it('provides the light reset on a product URL whose page key cannot be read', async () => {
    const host = darkHost();
    const buy = document.createElement('div'); buy.id = 'buy'; document.body.appendChild(buy);
    const handle = await mount(host, '/p/not-a-key');
    expect(handle.mounted).toBe(false);
    expect(handle.pageKey).toBeNull();
    expect(host.requests).toHaveLength(0);
    await resetToLight(host);
  });

  it('provides the light reset on a product page whose mount point never appears', async () => {
    const host = darkHost();
    const handle = await mount(host, '/p/P1');
    expect(handle.mounted).toBe(false);
    expect(handle.pageKey).toBe('P1');
    expect(host.logs).toContain('warn: mount point not found');
    await resetToLight(host);
  });

  it('leaves pages outside the adapter patterns alone, even with a saved dark theme', async () => {
    const host = darkHost();
    const handle = await mount(host, '/cart');
    expect(handle.storeId).toBeNull();
    expect(document.documentElement.hasAttribute('data-eph-page-theme')).toBe(false);
    expect(document.documentElement.hasAttribute(OWNER_ATTRIBUTE)).toBe(false);
    expect(themeStyles()).toHaveLength(0);
    expect(control()).toBeNull();
  });

  it('lets only the first of two installed instances own the page, so light restores completely', async () => {
    const buy = document.createElement('div'); buy.id = 'buy'; document.body.appendChild(buy);
    const first = darkHost();
    first.routes.set(`${BASE}/${manifestPath('teststore')}`, json(sampleManifest()));
    first.routes.set(`${BASE}/${productPath('teststore', 'P1')}`, json(sampleProduct()));
    const second = darkHost();
    // Started together, as the extension and the userscript are at document_start.
    const [a, b] = await Promise.all([mount(first, '/p/P1'), mount(second, '/p/P1')]);
    expect(a.mounted).toBe(true);
    expect(b.mounted).toBe(false);
    expect(second.requests).toHaveLength(0);
    expect(second.logs).toContain('debug: another instance owns this page');
    expect(themeStyles()).toHaveLength(1);
    expect(control()).toBeNull();
    expect(document.querySelectorAll(`#${HOST_ELEMENT_ID}`)).toHaveLength(1);

    b.destroy(); // the yielding instance owns nothing
    expect(document.documentElement.getAttribute('data-eph-page-theme')).toBe('dark');
    const lightButton = [...document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!.querySelectorAll('button')].find((el) => el.textContent === 'ライト')!;
    lightButton.click();
    expect(document.documentElement.hasAttribute('data-eph-page-theme')).toBe(false);
    expect(themeStyles()).toHaveLength(0);

    a.destroy();
    expect(document.documentElement.hasAttribute(OWNER_ATTRIBUTE)).toBe(false);
    const third = darkHost();
    const c = await mount(third, '/');
    expect(document.documentElement.getAttribute('data-eph-page-theme')).toBe('dark');
    expect(control()).not.toBeNull();
    c.destroy();
  });
});
