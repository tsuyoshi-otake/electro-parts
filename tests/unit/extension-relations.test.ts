import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FETCH_TEXT, isRelationsForRequest, MAX_KEY_LENGTH, RELATIONS_FOR } from '../../extension/messages.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { RELATION_INDEX_FILE, relationShardFile, relationShardIn, shardRelations } from '../../userscript/core/relationShards.ts';

/**
 * The worker's second door: it reads its own packaged relation index and then the one shard the
 * index names, and answers with one product's relations. File names come from constants and a
 * validated number, never from message text.
 */

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
type Listener = (message: unknown, sender: { id?: string }, sendResponse: (response: unknown) => void) => boolean | undefined;

const listeners: Listener[] = [];
vi.stubGlobal('chrome', {
  runtime: {
    id: EXTENSION_ID,
    getURL: (path: string) => `${ORIGIN}${path}`,
    sendMessage: async () => undefined,
    onMessage: { addListener: (listener: Listener) => { listeners.push(listener); } },
  },
  storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
});
const { readPackagedRelations } = await import('../../extension/background.ts');

const packaged = shardRelations(PRODUCT_RELATIONS);
const indexText = JSON.stringify(packaged.index);
const shardText = packaged.shards.map((table) => JSON.stringify(table));
const product = PRODUCT_RELATIONS[0]!.products[0];
const indexUrl = `${ORIGIN}${RELATION_INDEX_FILE}`;
const shardUrl = `${ORIGIN}${relationShardFile(relationShardIn(packaged.index, product.storeId, product.pageKey)!)}`;
const expected = PRODUCT_RELATIONS.filter((r) => r.products.some((p) => p.storeId === product.storeId && p.pageKey === product.pageKey));

let asked: string[];
let realFetch: typeof globalThis.fetch;

/** Serves the packaged files the way chrome-extension:// URLs do, logging what was asked. */
function servePackage(overrides: Record<string, () => Response | Promise<Response>> = {}): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const override = overrides[url];
    if (override !== undefined) return override();
    if (url === indexUrl) return new Response(indexText);
    const match = /^chrome-extension:\/\/[a-p]{32}\/relations\/shard-(\d\d)\.json$/.exec(url);
    if (match === null) throw new Error(`not a packaged file: ${url}`);
    return new Response(shardText[Number(match[1])]!);
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  asked = [];
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('relations request', () => {
  const valid = { type: RELATIONS_FOR, storeId: 'akizuki', pageKey: '116132' };

  it('accepts a store id and a page key', () => {
    expect(isRelationsForRequest(valid)).toBe(true);
    expect(isRelationsForRequest({ ...valid, pageKey: 'x'.repeat(MAX_KEY_LENGTH) })).toBe(true);
    expect(MAX_KEY_LENGTH).toBe(200);
  });

  it('rejects another type, a missing, empty, non-string or over-long key, and non-objects', () => {
    expect(isRelationsForRequest({ ...valid, type: FETCH_TEXT })).toBe(false);
    expect(isRelationsForRequest({ type: RELATIONS_FOR, storeId: 'akizuki' })).toBe(false);
    expect(isRelationsForRequest({ type: RELATIONS_FOR, pageKey: '1' })).toBe(false);
    expect(isRelationsForRequest({ ...valid, storeId: '' })).toBe(false);
    expect(isRelationsForRequest({ ...valid, pageKey: '' })).toBe(false);
    expect(isRelationsForRequest({ ...valid, storeId: 1 })).toBe(false);
    expect(isRelationsForRequest({ ...valid, pageKey: ['1'] })).toBe(false);
    expect(isRelationsForRequest({ ...valid, storeId: 'x'.repeat(MAX_KEY_LENGTH + 1) })).toBe(false);
    expect(isRelationsForRequest({ ...valid, pageKey: 'x'.repeat(MAX_KEY_LENGTH + 1) })).toBe(false);
    expect(isRelationsForRequest(null)).toBe(false);
    expect(isRelationsForRequest(undefined)).toBe(false);
    expect(isRelationsForRequest('relations')).toBe(false);
  });
});

describe('worker relations read', () => {
  it("reads the index and then only the shard it names, and answers with the key's relations", async () => {
    servePackage();
    expect(expected.length).toBeGreaterThan(0);
    await expect(readPackagedRelations(product.storeId, product.pageKey)).resolves.toEqual({ ok: true, relations: expected });
    expect(asked).toEqual([indexUrl, shardUrl]);
  });

  it('answers an empty list for a product without an index entry, having read the index only', async () => {
    servePackage();
    await expect(readPackagedRelations('akizuki', 'no-such-page')).resolves.toEqual({ ok: true, relations: [] });
    expect(asked).toEqual([indexUrl]);
  });

  it('never builds a path from message text', async () => {
    servePackage();
    for (const [storeId, pageKey] of [['akizuki', '../../x'], ['../manifest', '1'], ['akizuki', 'shard-00.json?x=/../..'], ['a/b', 'c\\d'], ['__proto__', 'constructor']] as const) {
      asked = [];
      await expect(readPackagedRelations(storeId, pageKey)).resolves.toEqual({ ok: true, relations: [] });
      expect(asked).toEqual([indexUrl]);
    }
  });

  it('answers ok: false when a file cannot be read, is not found, or is not what it should be', async () => {
    const ask = () => readPackagedRelations(product.storeId, product.pageKey);
    const text = (error: string) => expect.stringContaining(error) as string;
    servePackage({ [indexUrl]: () => { throw new Error('Failed to fetch'); } });
    await expect(ask()).resolves.toMatchObject({ ok: false, error: text('Failed to fetch') });
    servePackage({ [indexUrl]: () => new Response('missing', { status: 404 }) });
    await expect(ask()).resolves.toMatchObject({ ok: false, error: text('404') });
    servePackage({ [indexUrl]: () => new Response('{ not json') });
    await expect(ask()).resolves.toMatchObject({ ok: false });
    servePackage({ [indexUrl]: () => new Response('{"version":9,"shards":64,"products":{}}') });
    await expect(ask()).resolves.toMatchObject({ ok: false, error: text('unsupported version') });
    servePackage({ [indexUrl]: () => new Response(JSON.stringify({ version: 1, shards: 64, products: { [product.storeId]: { [product.pageKey]: 99 } } })) });
    await expect(ask()).resolves.toMatchObject({ ok: false, error: text('out of range') });
    expect(asked.filter((url) => url !== indexUrl)).toEqual([]);
    servePackage({ [shardUrl]: () => { throw new Error('Failed to fetch'); } });
    await expect(ask()).resolves.toMatchObject({ ok: false, error: text('Failed to fetch') });
    servePackage({ [shardUrl]: () => new Response('missing', { status: 404 }) });
    await expect(ask()).resolves.toMatchObject({ ok: false, error: text('404') });
    servePackage({ [shardUrl]: () => new Response('{"version":9,"strings":[],"products":[],"relations":[]}') });
    await expect(ask()).resolves.toMatchObject({ ok: false, error: text('unsupported version') });
  });
});

describe('worker relations message', () => {
  const listener = (): Listener => listeners[0]!;
  const message = { type: RELATIONS_FOR, storeId: product.storeId, pageKey: product.pageKey };

  it('answers this extension asynchronously, from packaged files only', async () => {
    servePackage();
    const sendResponse = vi.fn();
    expect(listener()(message, { id: EXTENSION_ID }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, relations: expected }));
    expect(asked).toEqual([indexUrl, shardUrl]);
  });

  it('gives another extension, or a sender without an id, no answer and reads nothing', () => {
    servePackage();
    const sendResponse = vi.fn();
    expect(listener()(message, { id: 'someone-else' }, sendResponse)).toBeUndefined();
    expect(listener()(message, {}, sendResponse)).toBeUndefined();
    expect(asked).toEqual([]);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('ignores a relations request with a bad key', () => {
    servePackage();
    const sendResponse = vi.fn();
    expect(listener()({ ...message, pageKey: '' }, { id: EXTENSION_ID }, sendResponse)).toBeUndefined();
    expect(listener()({ ...message, storeId: 'x'.repeat(MAX_KEY_LENGTH + 1) }, { id: EXTENSION_ID }, sendResponse)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('answers ok: false, not silence, when the read fails', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('gone'); }) as unknown as typeof globalThis.fetch;
    const sendResponse = vi.fn();
    expect(listener()(message, { id: EXTENSION_ID }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'relations unavailable (gone)' }));
  });
});
