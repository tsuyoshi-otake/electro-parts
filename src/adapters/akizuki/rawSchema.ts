/**
 * Raw snapshot format produced by the Akizuki collector (`schemaVersion: 3`).
 * These types describe the on-disk JSON; they are only used inside the
 * Akizuki adapter and collector.
 *
 * Version 3 replaced the hand-written genre list with sitemap-driven listing
 * discovery: `listings` (was `genres`) records which listing pages were walked,
 * and `catalog` records the sitemap's product set the run was checked against.
 * Version 2 snapshots stay readable so the archived observations keep
 * importing; only the field names differ.
 */
export interface AkizukiRawPrice {
  amountYen: number | null;
  display: string;
  quantityUnit: string;
  taxIncluded: boolean;
}

export interface AkizukiRawStock {
  status: string;
  availableQuantity: number | null;
  quantityUnit?: string | null;
  quantityDisplay?: string | null;
  /**
   * Whether the listing offered a cart affordance. `null` when the layout has
   * no cart at all (the spec-table categories), so availability must be read
   * from the stock badge alone.
   */
  purchasable: boolean | null;
}

export interface AkizukiRawItem {
  salesCode: string;
  modelNumber: string | null;
  name: string;
  category: string | null;
  url: string;
  prices: AkizukiRawPrice[];
  stock: AkizukiRawStock;
  sourceListings?: { name: string; url: string }[];
  sourcePage?: number;
  positionOnPage?: number;
  duplicateOccurrences?: number;
}

export interface AkizukiRawListing {
  /** `c` = category tree, `r` = genre tag. */
  kind: string;
  slug: string;
  name: string;
  url: string;
  /** The site's own "N件あります" counter for this listing. */
  listedTotal: number;
  /** True when `listedTotal` exceeds what the site will page through (3,000). */
  truncated: boolean;
  totalPages: number;
  successfulPages: number;
  failedPages: number;
  extractedOccurrences: number;
  matchesListedTotal: boolean;
}

/** What the sitemap said the catalogue holds, and how much of it the run saw. */
export interface AkizukiRawCatalog {
  sitemapUrl: string;
  sitemapLastModified: string | null;
  /** Product pages the sitemap lists. */
  productTotal: number;
  /** Listing pages the sitemap offered, and how many were walked. */
  listingTotal: number;
  listingsCrawled: number;
  /** Sitemap products found in at least one listing. */
  covered: number;
  /** Sitemap products no listing showed — a collection gap, not a delisting. */
  uncovered: number;
  /** First few uncovered sales codes, for diagnosis. */
  uncoveredSample: string[];
  /** Products seen in a listing but absent from the sitemap (sitemap lag). */
  unlisted: number;
}

export interface AkizukiRawSnapshot {
  schemaVersion: number;
  source: string;
  retrievedAt: string;
  complete: boolean;
  catalog: AkizukiRawCatalog;
  listingCount: number;
  occurrenceTotal: number;
  extractedTotal: number;
  deduplication: {
    enabled: boolean;
    primaryKey: string;
    fallbackKey: string;
    uniqueKeyTotal: number;
    duplicatesDetected: number;
    duplicatesRemoved: number;
  };
  dataQuality: { missingSalesCode: number; missingModelNumber: number; missingName: number };
  requests: {
    logicalPages: number;
    httpAttemptsIncludingRetries: number;
    successfulResponses: number;
    intervalMs: number;
  };
  validation: { listingMismatches: number; errors: string[]; warnings: string[] };
  listings: AkizukiRawListing[];
  items: AkizukiRawItem[];
}

export const AKIZUKI_RAW_SCHEMA_VERSION = 3;
/** Versions the adapter still validates and imports; the collector only writes the newest. */
export const AKIZUKI_SUPPORTED_RAW_SCHEMA_VERSIONS: readonly number[] = [2, 3];
export const AKIZUKI_SALES_CODE_PATTERN = /^\d{1,12}$/;
export const AKIZUKI_PRODUCT_URL_PREFIX = 'https://akizukidenshi.com/catalog/g/g';

export function akizukiProductUrl(salesCode: string): string {
  return `${AKIZUKI_PRODUCT_URL_PREFIX}${salesCode}/`;
}
