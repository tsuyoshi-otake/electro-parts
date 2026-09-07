/**
 * Raw snapshot format produced by the Switch Science collector
 * (`schemaVersion: 1`). These types describe the on-disk JSON and are used
 * only inside this store's adapter and collector.
 *
 * The source is a Shopify storefront, so the collector reads
 * `/collections/all/products.json` rather than parsing HTML (ADR-0014). The
 * raw snapshot keeps the API's own fields close to verbatim — including the
 * price strings — so a parsing decision made today can be re-examined against
 * an archived observation tomorrow.
 */
export interface SwitchScienceRawVariant {
  /** Shopify's numeric variant id. Recorded as an attribute, never identity. */
  variantId: number;
  sku: string | null;
  /** `"Default Title"` for single-variant products; kept as the API gave it. */
  title: string | null;
  /** Whole yen. `null` when `priceRaw` was not an exact yen amount. */
  priceYen: number | null;
  /** The API's own string (`"1100"` here, `"1100.00"` on most Shopify stores). */
  priceRaw: string;
  compareAtPriceYen: number | null;
  compareAtPriceRaw: string | null;
  available: boolean;
  position: number;
}

export interface SwitchScienceRawItem {
  /** The URL segment, and therefore the product identity (ADR-0015). */
  handle: string;
  /** Shopify's numeric product id. An attribute, not identity. */
  productId: number;
  title: string;
  vendor: string | null;
  productType: string | null;
  url: string;
  publishedAt: string | null;
  updatedAt: string | null;
  variants: SwitchScienceRawVariant[];
  sourcePage: number;
  positionOnPage: number;
  duplicateOccurrences?: number;
}

/** What the sitemap said the catalogue holds, and how much of it the run saw. */
export interface SwitchScienceRawCatalog {
  sitemapUrl: string;
  sitemapLastModified: string | null;
  /** Product pages the sitemap lists. */
  productTotal: number;
  /** How many `sitemap_products_*.xml` children were read. */
  sitemapPages: number;
  /** Sitemap handles the API also returned. */
  covered: number;
  /** Sitemap handles the API never returned — a collection gap, not a delisting. */
  uncovered: number;
  /** First few uncovered handles, for diagnosis. */
  uncoveredSample: string[];
  /** Handles the API returned but the sitemap omitted (sitemap lag). */
  unlisted: number;
}

export interface SwitchScienceRawSnapshot {
  schemaVersion: number;
  source: string;
  retrievedAt: string;
  complete: boolean;
  catalog: SwitchScienceRawCatalog;
  /** The collection walked; `all` is every published product. */
  collection: string;
  /** Catalogue pages fetched, including the empty one that ends the walk. */
  pageCount: number;
  extractedTotal: number;
  deduplication: {
    enabled: boolean;
    primaryKey: string;
    uniqueKeyTotal: number;
    duplicatesDetected: number;
    duplicatesRemoved: number;
  };
  dataQuality: {
    /** Products dropped because their handle is not addressable as a page key. */
    unsupportedHandle: number;
    unsupportedHandleSample: string[];
    missingSku: number;
    /** Variants whose price string was not an exact yen amount. */
    unparsablePrice: number;
    multiVariant: number;
    unavailable: number;
  };
  requests: {
    logicalPages: number;
    httpAttemptsIncludingRetries: number;
    successfulResponses: number;
    intervalMs: number;
  };
  validation: { errors: string[]; warnings: string[] };
  items: SwitchScienceRawItem[];
}

export const SWITCH_SCIENCE_RAW_SCHEMA_VERSION = 1;
/** Versions the adapter still validates and imports; the collector writes only the newest. */
export const SWITCH_SCIENCE_SUPPORTED_RAW_SCHEMA_VERSIONS: readonly number[] = [1];

/**
 * Handles this store can address. Shopify lowercases and slugifies handles, so
 * the observed set is digits (`11353`) with the occasional word form
 * (`rpicm-pl`). The pattern is deliberately narrower than Shopify allows: a
 * handle that does not match cannot be a safe page key, and the collector drops
 * it rather than letting it become an unreadable file name. Dropped handles
 * resurface as `catalog.uncovered`, so the loss is reported, not hidden.
 */
export const SWITCH_SCIENCE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SWITCH_SCIENCE_PRODUCT_URL_PREFIX = 'https://www.switch-science.com/products/';

export function switchScienceProductUrl(handle: string): string {
  return `${SWITCH_SCIENCE_PRODUCT_URL_PREFIX}${handle}`;
}

/**
 * Shopify sends money as a decimal string. This store sends `"1100"`, most
 * others send `"1100.00"`, and both mean the same 1,100 yen.
 *
 * Yen has no minor unit, so the minor amount *is* the yen amount. Anything with
 * a non-zero fractional part is therefore not representable and is rejected
 * rather than rounded — a silently rounded price would enter the history as a
 * real change point. Returns `null` for everything it cannot represent exactly;
 * the caller decides whether that is a warning or an error.
 */
export function parseShopifyYen(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!/^\d{1,12}(\.\d+)?$/.test(text)) return null;
  const [whole, fraction] = text.split('.');
  if (fraction !== undefined && /[1-9]/.test(fraction)) return null;
  const amount = Number(whole);
  return Number.isSafeInteger(amount) ? amount : null;
}
