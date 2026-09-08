import {
  manifestPath,
  productPath,
  validateManifestV1,
  validateProductFileV1,
  type ManifestV1,
  type ProductFileV1,
} from '../../src/publisher/contract.ts';
import { cacheNamespace, LruCache, normalizeBaseUrl } from './cache.ts';
import type { HostEnv } from './types.ts';

/**
 * Stale-while-revalidate client for the static data contract.
 *
 * 1. A cached product file (if any) is emitted immediately, labelled stale
 *    when it is older than `productFreshMs`.
 * 2. The manifest is fetched (cached for `manifestTtlMs`). Its
 *    `datasetVersion` decides whether the cached product is still current:
 *    equal versions mean the product is re-labelled fresh without a fetch.
 * 3. Otherwise the product is fetched with `?v=<datasetVersion>` so CDN
 *    caches can never serve a file from an older publication, validated
 *    structurally and cached.
 *
 * Any failure keeps whatever was already shown (fail-open): a stale cached
 * product stays visible with a note, and without a cache the caller gets an
 * `error` state it can render unobtrusively.
 */

export interface DataClientOptions {
  baseUrl: string;
  manifestTtlMs?: number;
  productFreshMs?: number;
  /** Cached entries older than this are ignored altogether. */
  productMaxAgeMs?: number;
  maxEntries?: number;
  timeoutMs?: number;
}

export type Freshness = 'fresh' | 'stale';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; product: ProductFileV1; manifest: ManifestV1 | null; freshness: Freshness; storedAt: number; note: string | null }
  | { kind: 'missing'; manifest: ManifestV1 | null; freshness: Freshness }
  | { kind: 'error'; message: string };

export class DataClient {
  private readonly cache: LruCache;
  private readonly manifestTtlMs: number;
  private readonly productFreshMs: number;
  private readonly productMaxAgeMs: number;
  private readonly timeoutMs: number;
  readonly baseUrl: string;
  private readonly inFlight = new Map<string, { listeners: Set<(state: LoadState) => void>; latest: LoadState | null; done: Promise<void> }>();
  private readonly manifestsInFlight = new Map<string, Promise<ManifestV1>>();

  constructor(
    private readonly host: HostEnv,
    options: DataClientOptions,
  ) {
    const namespace = cacheNamespace(options.baseUrl);
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.manifestTtlMs = options.manifestTtlMs ?? 30 * 60_000;
    this.productFreshMs = options.productFreshMs ?? 6 * 3_600_000;
    this.productMaxAgeMs = options.productMaxAgeMs ?? 30 * 86_400_000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.cache = new LruCache(host.storage, options.maxEntries ?? 200, namespace);
  }

  async load(storeId: string, pageKey: string, emit: (state: LoadState) => void): Promise<void> {
    const key = JSON.stringify([storeId, pageKey]);
    const notify = (state: LoadState) => {
      try { emit(state); } catch { this.host.log('error', 'data subscriber failed'); }
    };
    const running = this.inFlight.get(key);
    if (running) {
      running.listeners.add(notify);
      if (running.latest) notify(running.latest);
      await running.done;
      return;
    }
    const job = { listeners: new Set([notify]), latest: null as LoadState | null, done: Promise.resolve() };
    const broadcast = (state: LoadState) => { job.latest = state; for (const listener of job.listeners) listener(state); };
    job.done = Promise.resolve().then(() => this.loadOnce(storeId, pageKey, broadcast)).catch((error: unknown) => {
      this.host.log('warn', `data load failed: ${String(error)}`);
      broadcast({ kind: 'error', message: 'データを取得できませんでした' });
    }).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, job);
    await job.done;
  }

  private async loadOnce(storeId: string, pageKey: string, emit: (state: LoadState) => void): Promise<void> {
    const now = this.host.now();
    const cached = await this.cache.getProduct(storeId, pageKey).catch(() => null);
    const validCache = cached !== null && (cached.body === null || (validateProductFileV1(cached.body).length === 0
      && (cached.body as ProductFileV1).storeId === storeId && (cached.body as ProductFileV1).pageKey === pageKey));
    const usable = validCache && cached !== null && now - cached.storedAt <= this.productMaxAgeMs ? cached : null;
    const cachedProduct = usable !== null && usable.body !== null && validateProductFileV1(usable.body).length === 0 ? (usable.body as ProductFileV1) : null;
    const cachedFreshness: Freshness = usable !== null && now - usable.storedAt <= this.productFreshMs ? 'fresh' : 'stale';

    if (cachedProduct !== null) emit({ kind: 'ready', product: cachedProduct, manifest: null, freshness: cachedFreshness, storedAt: usable!.storedAt, note: null });
    else if (usable !== null && usable.body === null) emit({ kind: 'missing', manifest: null, freshness: cachedFreshness });
    else emit({ kind: 'loading' });

    let manifest: ManifestV1;
    try {
      manifest = await this.loadManifest(storeId, now);
    } catch (e) {
      const message = `manifest unavailable: ${(e as Error).message}`;
      this.host.log('warn', message);
      if (cachedProduct !== null) emit({ kind: 'ready', product: cachedProduct, manifest: null, freshness: 'stale', storedAt: usable!.storedAt, note: message });
      else if (usable !== null && usable.body === null) emit({ kind: 'missing', manifest: null, freshness: 'stale' });
      else emit({ kind: 'error', message });
      return;
    }

    if (usable !== null && usable.datasetVersion === manifest.datasetVersion) {
      // Same publication: nothing new to fetch. Refresh the timestamp so the entry stays "fresh".
      if (cachedFreshness === 'stale') await this.cache.putProduct(storeId, pageKey, { ...usable, storedAt: now }).catch(() => undefined);
      if (cachedProduct !== null) emit({ kind: 'ready', product: cachedProduct, manifest, freshness: 'fresh', storedAt: now, note: null });
      else emit({ kind: 'missing', manifest, freshness: 'fresh' });
      return;
    }

    try {
      const url = `${this.baseUrl}/${productPath(storeId, pageKey)}?v=${encodeURIComponent(manifest.datasetVersion)}`;
      const res = await this.host.fetchText(url, this.timeoutMs);
      if (res.status === 404) {
        await this.cache.putProduct(storeId, pageKey, { datasetVersion: manifest.datasetVersion, storedAt: now, body: null }).catch(() => undefined);
        emit({ kind: 'missing', manifest, freshness: 'fresh' });
        return;
      }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body: unknown = JSON.parse(res.text);
      const issues = validateProductFileV1(body);
      if (issues.length > 0) throw new Error(`invalid product file: ${issues[0]}`);
      const product = body as ProductFileV1;
      if (product.storeId !== storeId || product.pageKey !== pageKey) throw new Error('product file identity mismatch');
      const note = product.datasetVersion === manifest.datasetVersion ? null : 'dataset version differs from manifest (publication in progress?)';
      await this.cache.putProduct(storeId, pageKey, { datasetVersion: product.datasetVersion, storedAt: now, body }).catch(() => undefined);
      emit({ kind: 'ready', product, manifest, freshness: 'fresh', storedAt: now, note });
    } catch (e) {
      const message = `product unavailable: ${(e as Error).message}`;
      this.host.log('warn', message);
      if (cachedProduct !== null) emit({ kind: 'ready', product: cachedProduct, manifest, freshness: 'stale', storedAt: usable!.storedAt, note: message });
      else emit({ kind: 'error', message });
    }
  }

  private loadManifest(storeId: string, now: number): Promise<ManifestV1> {
    const existing = this.manifestsInFlight.get(storeId);
    if (existing) return existing;
    // A failed manifest is terminal for this page client. Queued related
    // products must not turn one 429/outage into one request per candidate.
    // A new page/client may try again; no background retry is scheduled.
    const promise = this.fetchManifest(storeId, now).then((manifest) => {
      this.manifestsInFlight.delete(storeId);
      return manifest;
    });
    this.manifestsInFlight.set(storeId, promise);
    return promise;
  }

  private async fetchManifest(storeId: string, now: number): Promise<ManifestV1> {
    const cached = await this.cache.getManifest(storeId).catch(() => null);
    if (cached !== null && now - cached.storedAt <= this.manifestTtlMs && validateManifestV1(cached.body).length === 0
      && (cached.body as ManifestV1).storeId === storeId) return cached.body as ManifestV1;
    // The bucket parameter defeats intermediate caches once per TTL without disabling them entirely.
    const bucket = Math.floor(now / this.manifestTtlMs);
    const res = await this.host.fetchText(`${this.baseUrl}/${manifestPath(storeId)}?b=${bucket}`, this.timeoutMs);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body: unknown = JSON.parse(res.text);
    const issues = validateManifestV1(body);
    if (issues.length > 0) throw new Error(`invalid manifest: ${issues[0]}`);
    if ((body as ManifestV1).storeId !== storeId) throw new Error('manifest store mismatch');
    await this.cache.putManifest(storeId, { storedAt: now, body }).catch(() => undefined);
    return body as ManifestV1;
  }
}
