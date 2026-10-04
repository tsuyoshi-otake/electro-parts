import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAllowedFetchUrl, isDataOrigin, resolveDataBaseUrl } from '../../extension/dataOrigin.ts';
import { FETCH_TEXT, MAX_TIMEOUT_MS } from '../../extension/messages.ts';
import { EXCHANGE_RATE_URL } from '../../userscript/core/exchangeRate.ts';
import { DEFAULT_DATA_BASE_URL } from '../../userscript/version.ts';

/**
 * The service worker is the only part of the extension that can reach the
 * network, and it is reachable from a content script running inside a store's
 * page. These tests pin the door: one message type, one origin plus one exact
 * exchange rate URL, no cookies,
 * a bounded wait -- and no way to use the worker as a proxy to anywhere else.
 */

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
type Listener = (message: unknown, sender: { id?: string }, sendResponse: (response: unknown) => void) => boolean | undefined;

const listeners: Listener[] = [];
const chromeStub = {
  runtime: {
    id: EXTENSION_ID,
    sendMessage: async () => undefined,
    onMessage: {
      addListener: (listener: Listener) => {
        listeners.push(listener);
      },
    },
  },
  storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
};

vi.stubGlobal('chrome', chromeStub);
const { fetchAllowedText } = await import('../../extension/background.ts');

const DATA_URL = `${DEFAULT_DATA_BASE_URL}/data/v1/stores/akizuki/manifest.json`;

function respondWith(body: string, status = 200): typeof globalThis.fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;
}

let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('data origin', () => {
  it('accepts the published data origin over https only', () => {
    expect(isDataOrigin(DATA_URL)).toBe(true);
    expect(isDataOrigin(DEFAULT_DATA_BASE_URL.replace('https:', 'http:'))).toBe(false);
  });

  it('rejects store pages, look-alike hosts and unparsable input', () => {
    expect(isDataOrigin('https://akizukidenshi.com/catalog/g/g112345/')).toBe(false);
    expect(isDataOrigin('https://tsuyoshi-otake.github.io.evil.example/data')).toBe(false);
    expect(isDataOrigin('https://evil.example/?u=tsuyoshi-otake.github.io')).toBe(false);
    expect(isDataOrigin('not a url')).toBe(false);
  });

  it('falls back to the default rather than obeying a foreign override', () => {
    expect(resolveDataBaseUrl(undefined)).toBe(DEFAULT_DATA_BASE_URL);
    expect(resolveDataBaseUrl('https://evil.example')).toBe(DEFAULT_DATA_BASE_URL);
    expect(resolveDataBaseUrl(42)).toBe(DEFAULT_DATA_BASE_URL);
    expect(resolveDataBaseUrl(`${DEFAULT_DATA_BASE_URL}/staging//`)).toBe(`${DEFAULT_DATA_BASE_URL}/staging`);
  });
});

describe('exchange rate url', () => {
  it('allows exactly the one rate url, not its origin', () => {
    expect(EXCHANGE_RATE_URL).toBe('https://open.er-api.com/v6/latest/USD');
    expect(isAllowedFetchUrl(EXCHANGE_RATE_URL)).toBe(true);
    expect(isAllowedFetchUrl(DATA_URL)).toBe(true);
    for (const url of ['https://open.er-api.com/v6/latest/EUR', 'https://open.er-api.com/v6/latest/USD?x=1', 'http://open.er-api.com/v6/latest/USD',
      'https://open.er-api.com/', 'https://open.er-api.com.evil.example/v6/latest/USD', 'https://v6.exchangerate-api.com/v6/KEY/latest/USD']) {
      expect(isAllowedFetchUrl(url), url).toBe(false);
    }
  });

  it('is not accepted as a data base url override', () => {
    expect(isDataOrigin(EXCHANGE_RATE_URL)).toBe(false);
    expect(resolveDataBaseUrl(EXCHANGE_RATE_URL)).toBe(DEFAULT_DATA_BASE_URL);
  });
});

describe('worker fetch', () => {
  it('fetches the data origin without cookies', async () => {
    const fetchMock = respondWith('{"ok":1}');
    globalThis.fetch = fetchMock;
    await expect(fetchAllowedText(DATA_URL, 5_000)).resolves.toEqual({ ok: true, status: 200, text: '{"ok":1}' });
    const init = vi.mocked(fetchMock).mock.calls[0]?.[1];
    expect(init?.credentials).toBe('omit');
    expect(init?.cache).toBe('no-store');
  });

  it('fetches the exchange rate url without cookies', async () => {
    const fetchMock = respondWith('{"result":"success"}');
    globalThis.fetch = fetchMock;
    await expect(fetchAllowedText(EXCHANGE_RATE_URL, 5_000)).resolves.toEqual({ ok: true, status: 200, text: '{"result":"success"}' });
    expect(vi.mocked(fetchMock).mock.calls[0]?.[0]).toBe(EXCHANGE_RATE_URL);
    expect(vi.mocked(fetchMock).mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('reports a non-200 to the caller instead of throwing', async () => {
    globalThis.fetch = respondWith('not found', 404);
    await expect(fetchAllowedText(DATA_URL, 5_000)).resolves.toMatchObject({ ok: true, status: 404 });
  });

  it('refuses any other url without touching the network', async () => {
    const fetchMock = respondWith('secret');
    globalThis.fetch = fetchMock;
    await expect(fetchAllowedText('https://akizukidenshi.com/catalog/g/g112345/', 5_000)).resolves.toEqual({
      ok: false,
      error: 'refused: url is not allowed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up on a request that never answers', async () => {
    globalThis.fetch = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    ) as unknown as typeof globalThis.fetch;
    await expect(fetchAllowedText(DATA_URL, 5)).resolves.toEqual({ ok: false, error: 'timeout after 5 ms' });
  });

  it('caps a caller-supplied timeout', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchAllowedText(DATA_URL, MAX_TIMEOUT_MS * 10)).resolves.toEqual({ ok: false, error: 'network error (down)' });
  });
});

describe('worker message listener', () => {
  const listener = listeners[0];

  it('is registered at the top level, as MV3 requires', () => {
    expect(listeners).toHaveLength(1);
  });

  it('answers a request from this extension asynchronously', async () => {
    globalThis.fetch = respondWith('{}');
    const sendResponse = vi.fn();
    const kept = listener?.({ type: FETCH_TEXT, url: DATA_URL, timeoutMs: 1_000 }, { id: EXTENSION_ID }, sendResponse);
    expect(kept).toBe(true); // keeps the channel open
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, status: 200, text: '{}' }));
  });

  it('ignores another extension and anything that is not the one message', () => {
    const fetchMock = respondWith('{}');
    globalThis.fetch = fetchMock;
    const sendResponse = vi.fn();
    expect(listener?.({ type: FETCH_TEXT, url: DATA_URL, timeoutMs: 1_000 }, { id: 'someone-else' }, sendResponse)).toBeUndefined();
    expect(listener?.({ type: 'other', url: DATA_URL, timeoutMs: 1 }, { id: EXTENSION_ID }, sendResponse)).toBeUndefined();
    expect(listener?.({ type: FETCH_TEXT, url: DATA_URL }, { id: EXTENSION_ID }, sendResponse)).toBeUndefined();
    expect(listener?.('hello', { id: EXTENSION_ID }, sendResponse)).toBeUndefined();
    expect(listener?.(null, {}, sendResponse)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
