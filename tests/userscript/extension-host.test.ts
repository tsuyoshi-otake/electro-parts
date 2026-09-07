import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeHost, readDataBaseUrl, start } from '../../extension/host.ts';
import { FETCH_TEXT, isFetchTextRequest } from '../../extension/messages.ts';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { HOST_ELEMENT_ID } from '../../userscript/core/controller.ts';
import { PANEL_TITLE } from '../../userscript/ui/panel.ts';
import { DEFAULT_DATA_BASE_URL } from '../../userscript/version.ts';
import { json, loadHtml, readFixtureHtml, sampleManifest, sampleProduct } from './helpers.ts';

/**
 * The extension's host binding: `chrome.storage.local` for storage, a message
 * to the service worker for the network. The panel itself is the userscript's,
 * unchanged, so the last test here is the one that matters -- the same panel
 * mounts on a real saved product page through this binding.
 */

const FIXTURE = 'g109951';
const PAGE_KEY = '109951'; // the store's numeric goods id, not the URL segment
const PRODUCT_LOCATION = { hostname: 'akizukidenshi.com', pathname: `/catalog/g/${FIXTURE}/` } as Location;

interface ChromeStub {
  runtime: { id: string; sendMessage: (message: unknown) => Promise<unknown>; onMessage: { addListener: () => void } };
  storage: { local: { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void>; remove: (key: string) => Promise<void> } };
}

let store: Map<string, unknown>;
let routes: Map<string, { status: number; text: string }>;
let requests: string[];

function stubChrome(overrides: Partial<ChromeStub['storage']['local']> = {}, answer?: (url: string) => unknown): void {
  const stub: ChromeStub = {
    runtime: {
      id: 'test-extension-id',
      sendMessage: async (message: unknown) => {
        if (!isFetchTextRequest(message)) throw new Error('unexpected message');
        requests.push(message.url);
        if (answer !== undefined) return answer(message.url);
        const route = routes.get(message.url.replace(/\?.*$/, ''));
        return route === undefined ? { ok: false, error: 'refused: url is not the data origin' } : { ok: true, ...route };
      },
      onMessage: { addListener: () => undefined },
    },
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (key: string) => {
          store.delete(key);
        },
        ...overrides,
      },
    },
  };
  vi.stubGlobal('chrome', stub);
}

beforeEach(() => {
  store = new Map();
  routes = new Map();
  requests = [];
  document.body.replaceChildren();
  stubChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.getElementById(HOST_ELEMENT_ID)?.remove();
});

describe('extension storage binding', () => {
  it('round-trips through chrome.storage.local and treats a non-string as absent', async () => {
    const host = chromeHost();
    expect(await host.storage.get('k')).toBeNull();
    await host.storage.set('k', 'v');
    expect(await host.storage.get('k')).toBe('v');
    store.set('k', { not: 'a string' });
    expect(await host.storage.get('k')).toBeNull();
    store.set('k', 'v');
    await host.storage.remove('k');
    expect(await host.storage.get('k')).toBeNull();
  });
});

describe('extension network binding', () => {
  it('returns what the worker fetched', async () => {
    routes.set(`${DEFAULT_DATA_BASE_URL}/x.json`, { status: 200, text: '{"a":1}' });
    await expect(chromeHost().fetchText(`${DEFAULT_DATA_BASE_URL}/x.json`, 1_000)).resolves.toEqual({ status: 200, text: '{"a":1}' });
  });

  it('turns a refusal and a silent worker into a rejection the client can retry', async () => {
    await expect(chromeHost().fetchText('https://evil.example/x', 1_000)).rejects.toThrow('refused: url is not the data origin');
    stubChrome({}, () => undefined);
    await expect(chromeHost().fetchText(`${DEFAULT_DATA_BASE_URL}/x.json`, 1_000)).rejects.toThrow('did not answer');
  });

  it('sends exactly the one message the worker accepts', async () => {
    const seen: unknown[] = [];
    stubChrome({}, (url) => {
      seen.push(url);
      return { ok: true, status: 200, text: '{}' };
    });
    await chromeHost().fetchText(`${DEFAULT_DATA_BASE_URL}/x.json`, 1_000);
    expect(isFetchTextRequest({ type: FETCH_TEXT, url: `${DEFAULT_DATA_BASE_URL}/x.json`, timeoutMs: 1_000 })).toBe(true);
    expect(seen).toEqual([`${DEFAULT_DATA_BASE_URL}/x.json`]);
  });
});

describe('data base url', () => {
  it('defaults, honours a data-origin override and ignores anything else', async () => {
    expect(await readDataBaseUrl()).toBe(DEFAULT_DATA_BASE_URL);
    store.set('dataBaseUrl', `${DEFAULT_DATA_BASE_URL}/staging`);
    expect(await readDataBaseUrl()).toBe(`${DEFAULT_DATA_BASE_URL}/staging`);
    store.set('dataBaseUrl', 'https://evil.example');
    expect(await readDataBaseUrl()).toBe(DEFAULT_DATA_BASE_URL);
  });

  it('starts on the default when storage itself fails', async () => {
    stubChrome({
      get: async () => {
        throw new Error('storage unavailable');
      },
    });
    expect(await readDataBaseUrl()).toBe(DEFAULT_DATA_BASE_URL);
  });
});

describe('start', () => {
  it('mounts the same panel on a saved product page', async () => {
    loadHtml(document, await readFixtureHtml(FIXTURE));
    routes.set(`${DEFAULT_DATA_BASE_URL}/${manifestPath('akizuki')}`, json(sampleManifest({ storeId: 'akizuki' })));
    routes.set(`${DEFAULT_DATA_BASE_URL}/${productPath('akizuki', PAGE_KEY)}`, json(sampleProduct({ storeId: 'akizuki', pageKey: PAGE_KEY, externalProductId: PAGE_KEY })));

    await start(document, PRODUCT_LOCATION);

    const mounted = document.getElementById(HOST_ELEMENT_ID);
    expect(mounted).not.toBeNull();
    const text = mounted?.shadowRoot?.textContent ?? '';
    expect(text).toContain(PANEL_TITLE);
    expect(text).toContain('￥1,200'); // the sample dataset's current price: the data really arrived
    expect(text).not.toContain('取得できませんでした');
    // Manifest plus product, and nothing else: the extension inherits the
    // userscript's two-request bound per page.
    expect(requests).toHaveLength(2);
    expect(requests.every((u) => u.startsWith(DEFAULT_DATA_BASE_URL))).toBe(true);
  });

  it('does nothing on a page no adapter claims', async () => {
    document.body.appendChild(document.createElement('h1'));
    await start(document, { hostname: 'example.test', pathname: '/' } as Location);
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
    expect(requests).toEqual([]);
  });
});
