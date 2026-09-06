/**
 * Raw snapshot format produced by the Akizuki collector (`schemaVersion: 2`).
 * These types describe the on-disk JSON; they are only used inside the
 * Akizuki adapter and collector.
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
  purchasable: boolean;
}

export interface AkizukiRawItem {
  salesCode: string;
  modelNumber: string | null;
  name: string;
  category: string | null;
  url: string;
  prices: AkizukiRawPrice[];
  stock: AkizukiRawStock;
  sourceGenres?: { name: string; url: string }[];
  sourcePage?: number;
  positionOnPage?: number;
  duplicateOccurrences?: number;
}

export interface AkizukiRawGenre {
  name: string;
  url: string;
  listedTotal: number;
  totalPages: number;
  successfulPages: number;
  failedPages: number;
  extractedOccurrences: number;
  matchesListedTotal: boolean;
}

export interface AkizukiRawSnapshot {
  schemaVersion: number;
  source: string;
  retrievedAt: string;
  complete: boolean;
  genreCount: number;
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
  validation: { genreMismatches: number; errors: string[]; warnings: string[] };
  genres: AkizukiRawGenre[];
  items: AkizukiRawItem[];
}

export const AKIZUKI_RAW_SCHEMA_VERSION = 2;
export const AKIZUKI_SALES_CODE_PATTERN = /^\d{1,12}$/;
export const AKIZUKI_PRODUCT_URL_PREFIX = 'https://akizukidenshi.com/catalog/g/g';

export function akizukiProductUrl(salesCode: string): string {
  return `${AKIZUKI_PRODUCT_URL_PREFIX}${salesCode}/`;
}
