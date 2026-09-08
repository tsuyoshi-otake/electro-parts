import { CONTRACT_MAJOR } from '../../src/publisher/contract.ts';
import type { HostStorage } from './types.ts';

/**
 * Small LRU cache on top of the host key/value storage. Keys carry the
 * contract major, the store id and the page key so a new contract major or
 * another store can never be served a foreign entry. The recency index is one
 * JSON array under `<prefix>:index`.
 */

const PREFIX = `eph:c${CONTRACT_MAJOR}`;

export interface ProductEntry {
  datasetVersion: string;
  storedAt: number;
  /** `null` = the dataset had no file for this page key (negative entry). */
  body: unknown;
}

export interface ManifestEntry {
  storedAt: number;
  body: unknown;
}

export function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

export function cacheNamespace(baseUrl: string): string {
  return `${PREFIX}:source:${encodeURIComponent(normalizeBaseUrl(baseUrl))}`;
}

export function productCacheKey(storeId: string, pageKey: string, namespace = PREFIX): string {
  return `${namespace}:product:${encodeURIComponent(storeId)}:${encodeURIComponent(pageKey)}`;
}

export function manifestCacheKey(storeId: string, namespace = PREFIX): string {
  return `${namespace}:manifest:${encodeURIComponent(storeId)}`;
}

function parse<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export class LruCache {
  private updates: Promise<void> = Promise.resolve();
  constructor(
    private readonly storage: HostStorage,
    private readonly maxEntries: number,
    private readonly namespace = PREFIX,
  ) {}

  async getProduct(storeId: string, pageKey: string): Promise<ProductEntry | null> {
    const key = productCacheKey(storeId, pageKey, this.namespace);
    const entry = parse<ProductEntry>(await this.storage.get(key));
    if (entry === null || typeof entry.datasetVersion !== 'string' || typeof entry.storedAt !== 'number') return null;
    await this.touch(key);
    return entry;
  }

  async putProduct(storeId: string, pageKey: string, entry: ProductEntry): Promise<void> {
    const key = productCacheKey(storeId, pageKey, this.namespace);
    await this.storage.set(key, JSON.stringify(entry));
    await this.touch(key);
  }

  async getManifest(storeId: string): Promise<ManifestEntry | null> {
    const entry = parse<ManifestEntry>(await this.storage.get(manifestCacheKey(storeId, this.namespace)));
    return entry !== null && typeof entry.storedAt === 'number' ? entry : null;
  }

  async putManifest(storeId: string, entry: ManifestEntry): Promise<void> {
    await this.storage.set(manifestCacheKey(storeId, this.namespace), JSON.stringify(entry));
  }

  async index(): Promise<string[]> {
    const list = parse<unknown>(await this.storage.get(`${this.namespace}:index`));
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
  }

  /** Moves `key` to the most-recent end and evicts the least recent entries beyond `maxEntries`. */
  private touch(key: string): Promise<void> {
    const update = this.updates.then(() => this.touchNow(key));
    this.updates = update.catch(() => undefined);
    return update;
  }

  private async touchNow(key: string): Promise<void> {
    const indexed = await this.index();
    const productPrefix = `${this.namespace}:product:`;
    const actual = await this.storage.keys(productPrefix);
    // A write from another tab may have lost the index race. Treat an
    // unindexed body as oldest so the next access deterministically repairs it.
    const indexedActual = indexed.filter((candidate) => actual.includes(candidate));
    const orphans = actual.filter((candidate) => !indexed.includes(candidate)).sort();
    const list = [...indexedActual, ...orphans];
    // Moving an already indexed key records a read. Concurrent new keys stay
    // in deterministic key order, so independent tabs choose the same victim.
    if (indexedActual.includes(key)) {
      list.splice(list.indexOf(key), 1);
      list.push(key);
    }
    while (list.length > this.maxEntries) {
      const victim = list.shift();
      if (victim !== undefined) await this.storage.remove(victim);
    }
    await this.storage.set(`${this.namespace}:index`, JSON.stringify(list));
  }
}
