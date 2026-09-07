import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CONTRACT_VERSION, PRODUCT_PATH_TEMPLATE, type ManifestV1, type ProductFileV1 } from '../../src/publisher/contract.ts';
import type { HostEnv, HostResponse, StorePageAdapter } from '../../userscript/core/types.ts';

/** In-memory host with a scripted URL → response table and a request log. */
export interface FakeHost extends HostEnv {
  routes: Map<string, HostResponse | Error | (() => HostResponse | Error)>;
  requests: string[];
  logs: string[];
  store: Map<string, string>;
  clock: number;
}

export function fakeHost(clock = 1_800_000_000_000): FakeHost {
  const host: FakeHost = {
    routes: new Map(),
    requests: [],
    logs: [],
    store: new Map(),
    clock,
    async fetchText(url) {
      host.requests.push(url);
      const bare = url.replace(/\?.*$/, '');
      const route = host.routes.get(bare) ?? host.routes.get(url);
      if (route === undefined) return { status: 404, text: 'not found' };
      const value = typeof route === 'function' ? route() : route;
      if (value instanceof Error) throw value;
      return value;
    },
    storage: {
      get: async (k) => host.store.get(k) ?? null,
      set: async (k, v) => {
        host.store.set(k, v);
      },
      remove: async (k) => {
        host.store.delete(k);
      },
    },
    now: () => host.clock,
    log: (level, message) => {
      host.logs.push(`${level}: ${message}`);
    },
  };
  return host;
}

export const T0 = 1_785_652_693_852; // 2026-08-02T06:38:13.852Z
export const T1 = 1_788_688_455_029; // 2026-09-06T09:54:15.029Z

export function sampleManifest(overrides: Partial<ManifestV1> = {}): ManifestV1 {
  return {
    contractVersion: CONTRACT_VERSION,
    storeId: 'teststore',
    datasetVersion: 'v1',
    generatedAt: '2026-09-06T12:00:00.000Z',
    capabilities: {
      supportsExactPrice: true,
      supportsPriceRange: false,
      supportsVariants: false,
      supportsCompareAtPrice: false,
      supportsTaxIncluded: true,
      supportsTaxExcluded: false,
      supportsAvailability: true,
      supportsInventoryQuantity: true,
      inventoryQuantitySemantics: 'site_reported',
      primaryQuote: { quoteKind: 'selling', taxTreatment: 'tax_included' },
    },
    observation: { runCount: 2, firstObservedAt: T0, latestObservedAt: T1, latestCoverageId: 'all' },
    productCount: 1,
    productPathTemplate: PRODUCT_PATH_TEMPLATE,
    versions: { contract: CONTRACT_VERSION, sqliteSchema: 1, sourceSchema: '2' },
    caveats: ['observation_window', 'sampling_interval', 'absence_not_discontinued', 'site_reported_quantity'],
    ...overrides,
  };
}

export function sampleProduct(overrides: Partial<ProductFileV1> = {}): ProductFileV1 {
  return {
    contractVersion: CONTRACT_VERSION,
    datasetVersion: 'v1',
    storeId: 'teststore',
    pageKey: 'P1',
    externalProductId: 'P1',
    generatedAt: '2026-09-06T12:00:00.000Z',
    observation: { runCount: 2, firstObservedAt: T0, latestObservedAt: T1 },
    product: {
      firstSeenAt: T0,
      lastSeenAt: T1,
      listed: true,
      aliases: [{ kind: 'salesCode', value: 'P1' }],
      presence: [[T0, 1]],
      metadata: [{ t: T0, name: 'Test Part', modelNumber: 'TP-1', category: 'cat', canonicalUrl: 'https://example.test/p/P1', suspicious: false }],
      current: { name: 'Test Part', modelNumber: 'TP-1', category: 'cat', canonicalUrl: 'https://example.test/p/P1' },
    },
    offers: [
      {
        externalOfferId: '__default__',
        offerKind: 'default',
        sku: null,
        variantName: null,
        presence: [[T0, 1]],
        segments: [
          {
            basis: { quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', unitLabel: '1個' },
            primary: true,
            presence: [[T0, 1]],
            points: [
              [T0, 'exact', 1150, 1150],
              [T1, 'exact', 1200, 1200],
            ],
            stats: {
              current: { state: 'exact', minAmountMinor: 1200, maxAmountMinor: 1200 },
              currentSinceAt: T1,
              previousDistinct: { state: 'exact', minAmountMinor: 1150, maxAmountMinor: 1150 },
              change: { differenceMinor: 50, percent: 4.35, direction: 'up' },
              observedMinMinor: 1150,
              observedMaxMinor: 1200,
              segmentStartAt: T0,
              changePointCount: 2,
              windows: { d30: { minMinor: 1150, maxMinor: 1200 }, d90: { minMinor: 1150, maxMinor: 1200 }, d365: { minMinor: 1150, maxMinor: 1200 } },
            },
          },
        ],
        availability: [
          [T0, 'low_stock', true, 'site_reported', '在庫僅少'],
          [T1, 'in_stock', true, 'site_reported', '在庫あり'],
        ],
        inventory: { semantics: 'site_reported', points: [[T0, 20], [T1, 781]], truncated: false, totalPoints: 2 },
      },
    ],
    caveats: [],
    ...overrides,
  };
}

export function json(body: unknown): HostResponse {
  return { status: 200, text: JSON.stringify(body) };
}

/** Adapter for a fictitious store used by the controller tests. */
export const testAdapter: StorePageAdapter = {
  storeId: 'teststore',
  matchPatterns: ['https://example.test/p/*'],
  matches: (l) => l.hostname === 'example.test' && l.pathname.startsWith('/p/'),
  extractPageKey: (_d, l) => /^\/p\/([A-Z0-9]+)$/.exec(l.pathname)?.[1] ?? null,
  findMountPoint: (d) => {
    const a = d.getElementById('buy');
    return a === null ? null : { anchor: a, position: 'after' };
  },
};

export async function readFixtureHtml(name: string, store = 'akizuki'): Promise<string> {
  const file = path.resolve('tests', 'fixtures', store, 'html', `${name}.html.gz`);
  return gunzipSync(await readFile(file)).toString('utf8');
}

/** Replaces the jsdom document content with `html` (test-only; the userscript itself never uses innerHTML). */
export function loadHtml(doc: Document, html: string): void {
  doc.documentElement.innerHTML = html;
}
