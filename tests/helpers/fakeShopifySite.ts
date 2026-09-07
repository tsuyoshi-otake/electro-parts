/**
 * In-memory stand-in for a Shopify storefront (Switch Science): the
 * `/collections/<c>/products.json` pages, the XML sitemap index and its
 * product children, per-URL transient failures and a request log.
 *
 * The sitemap is generated from the same product list the API pages are
 * generated from, so a crawl against this shop exercises the real coverage
 * check; tests bend the two apart on purpose (`sitemapOnly`, `apiOnly`) to
 * produce the gaps the crawler must notice.
 */
import { PoliteFetcher, type HttpTransport } from '../../src/collectors/politeFetcher.ts';

export const FAKE_BASE = 'https://shop.test';
export const FAKE_SITEMAP_INDEX = `${FAKE_BASE}/sitemap.xml`;

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export interface FakeVariant {
  id: number;
  sku: string | null;
  title: string;
  price: string;
  compare_at_price: string | null;
  available: boolean;
  position: number;
}

export interface FakeProduct {
  handle: string;
  id: number;
  title: string;
  vendor: string;
  product_type: string | null;
  published_at: string;
  updated_at: string;
  variants: FakeVariant[];
}

export interface FakeShop {
  /** Products the collection API returns, in page order. */
  products: FakeProduct[];
  /** Handles the sitemap lists but the collection never returns. */
  sitemapOnly: string[];
  /** Handles kept out of the sitemap although the collection returns them. */
  apiOnly: Set<string>;
  /** How many product sub-sitemaps the index splits the handles into. */
  sitemapChildren: number;
  /** Extra, non-product children of the sitemap index. */
  extraIndexEntries: string[];
  /** Serves this body verbatim for a URL (schema-drift tests). */
  bodyOverrides: Map<string, string>;
  /** URL -> remaining failures before it is served. */
  failures: Map<string, number>;
  log: string[];
  sitemapMissing: boolean;
}

export function fakeShop(overrides: Partial<FakeShop> = {}): FakeShop {
  return {
    products: [],
    sitemapOnly: [],
    apiOnly: new Set(),
    sitemapChildren: 1,
    extraIndexEntries: [`${FAKE_BASE}/sitemap_pages_1.xml?from=1&to=99`],
    bodyOverrides: new Map(),
    failures: new Map(),
    log: [],
    sitemapMissing: false,
    ...overrides,
  };
}

/** A product shaped like the real API's, with one variant priced `n * 100` yen. */
export function shopifyProduct(n: number, overrides: Partial<FakeProduct> = {}): FakeProduct {
  const handle = overrides.handle ?? String(1000 + n);
  const variant: FakeVariant = {
    id: 42_000_000_000_000 + n,
    sku: handle,
    title: 'Default Title',
    price: String(n * 100),
    compare_at_price: null,
    available: true,
    position: 1,
  };
  return {
    handle,
    id: 7_000_000_000_000 + n,
    title: `テスト部品 ${n}`,
    vendor: 'Test Vendor',
    product_type: null,
    published_at: '2024-01-25T15:29:11+09:00',
    updated_at: '2026-09-01T09:04:41+09:00',
    variants: [variant],
    ...overrides,
  };
}

export function addProducts(s: FakeShop, count: number, start = 1): FakeProduct[] {
  const made = Array.from({ length: count }, (_, i) => shopifyProduct(start + i));
  s.products.push(...made);
  return made;
}

function productsJson(s: FakeShop, page: number, limit: number): string {
  const slice = s.products.slice((page - 1) * limit, page * limit);
  return JSON.stringify({ products: slice });
}

function sitemapHandles(s: FakeShop): string[] {
  return [...s.products.filter((p) => !s.apiOnly.has(p.handle)).map((p) => p.handle), ...s.sitemapOnly];
}

/** `sitemap_products_N.xml?from=A&to=B`, XML-entity-encoded as the real index writes it. */
function childUrl(n: number, encoded: boolean): string {
  const sep = encoded ? '&amp;' : '&';
  return `${FAKE_BASE}/sitemap_products_${n}.xml?from=${n}00${sep}to=${n}99`;
}

function sitemapIndexXml(s: FakeShop): string {
  const children = Array.from({ length: s.sitemapChildren }, (_, i) => childUrl(i + 1, true));
  const entries = [...children, ...s.extraIndexEntries.map((u) => u.replace(/&(?!amp;)/g, '&amp;'))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`).join('\n')}
</sitemapindex>`;
}

function sitemapChildXml(s: FakeShop, n: number): string {
  const handles = sitemapHandles(s);
  const per = Math.ceil(handles.length / s.sitemapChildren) || 1;
  const mine = handles.slice((n - 1) * per, n * per);
  // The real first child also lists the homepage; a non-product URL must not
  // become a phantom handle.
  const locs = [...(n === 1 ? [`${FAKE_BASE}/`] : []), ...mine.map((h) => `${FAKE_BASE}/products/${encodeURIComponent(h)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `  <url><loc>${loc}</loc><lastmod>2026-09-01T00:00:00+09:00</lastmod></url>`).join('\n')}
</urlset>`;
}

export function transportFor(s: FakeShop): HttpTransport {
  return async (url) => {
    s.log.push(url);
    const remaining = s.failures.get(url) ?? 0;
    if (remaining > 0) {
      s.failures.set(url, remaining - 1);
      return { status: 503, header: () => null, bytes: async () => utf8('busy') };
    }
    const override = s.bodyOverrides.get(url);
    if (override !== undefined) return { status: 200, header: () => null, bytes: async () => utf8(override) };
    if (url === FAKE_SITEMAP_INDEX) {
      if (s.sitemapMissing) return { status: 404, header: () => null, bytes: async () => utf8('missing') };
      return { status: 200, header: () => null, bytes: async () => utf8(sitemapIndexXml(s)) };
    }
    const child = /\/sitemap_products_(\d+)\.xml/.exec(url);
    if (child !== null) return { status: 200, header: () => null, bytes: async () => utf8(sitemapChildXml(s, Number(child[1]))) };
    const api = /\/collections\/([^/]+)\/products\.json\?limit=(\d+)&page=(\d+)$/.exec(url);
    if (api !== null) return { status: 200, header: () => null, bytes: async () => utf8(productsJson(s, Number(api[3]), Number(api[2]))) };
    return { status: 404, header: () => null, bytes: async () => utf8('missing') };
  };
}

export function fetcherFor(s: FakeShop, overrides: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}): PoliteFetcher {
  return new PoliteFetcher({
    userAgent: 'test',
    transport: transportFor(s),
    minIntervalMs: 0,
    jitterMs: 0,
    backoffBaseMs: 0,
    sleep: async () => undefined,
    ...overrides,
  });
}
