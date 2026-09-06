/**
 * Store-neutral normalized domain model.
 *
 * Every store adapter converts its raw snapshot into these types. Nothing in
 * this module knows about a specific retailer: identifiers are opaque strings,
 * prices are integer minor units with explicit state / tax / unit semantics,
 * and inventory keeps its quantity semantics instead of collapsing to a number.
 */

/** Opaque store identifier, e.g. `akizuki`. Lower-case, `[a-z0-9-]`. */
export type StoreId = string;

export const STORE_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export type OfferKind = 'default' | 'variant' | 'aggregate';

export type QuoteKind = 'selling' | 'compare_at';

export type TaxTreatment = 'tax_included' | 'tax_excluded' | 'unknown';

export type PriceState = 'exact' | 'range' | 'unavailable';

export type AvailabilityState =
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'restocking'
  | 'preparing'
  | 'checking'
  | 'discontinued'
  | 'unknown'
  | 'not_displayed';

export const AVAILABILITY_STATES: readonly AvailabilityState[] = [
  'in_stock',
  'low_stock',
  'out_of_stock',
  'restocking',
  'preparing',
  'checking',
  'discontinued',
  'unknown',
  'not_displayed',
];

export type QuantitySemantics = 'site_reported' | 'reference' | 'not_exposed' | 'unknown';

export const QUANTITY_SEMANTICS: readonly QuantitySemantics[] = [
  'site_reported',
  'reference',
  'not_exposed',
  'unknown',
];

export interface PriceQuote {
  quoteKind: QuoteKind;
  taxTreatment: TaxTreatment;
  /** ISO 4217 code. JPY has 1 minor unit = 1 yen. */
  currency: string;
  state: PriceState;
  /** Integer minor units. `null` only when `state === 'unavailable'`. */
  minAmountMinor: number | null;
  /** Integer minor units. Equal to min for `exact`. */
  maxAmountMinor: number | null;
  /** Pricing basis as displayed by the source (e.g. `1個`, `1袋100本入`). Never guessed. */
  unitLabel: string | null;
}

export interface Availability {
  state: AvailabilityState;
  /** Authoritative buy/no-buy flag when the source exposes one. */
  purchasable: boolean | null;
  /** Site-reported quantity. `null` never means "sold out". */
  quantity: number | null;
  quantitySemantics: QuantitySemantics;
  /** Source status text before mapping, kept for display / audit. */
  rawStatus: string | null;
}

export interface NormalizedOffer {
  /** Stable within the product. Single-offer stores use `DEFAULT_OFFER_ID`. */
  externalOfferId: string;
  offerKind: OfferKind;
  sku: string | null;
  variantName: string | null;
  priceQuotes: PriceQuote[];
  availability: Availability;
}

export const DEFAULT_OFFER_ID = '__default__';

export interface ProductAlias {
  /** Adapter-defined kind, e.g. `salesCode`, `handle`, `sku`. */
  kind: string;
  value: string;
}

export interface ProductMetadata {
  name: string;
  modelNumber: string | null;
  category: string | null;
  canonicalUrl: string;
}

export interface NormalizedProduct {
  /** Canonical identity within the store. Adapter-specific mapping. */
  externalProductId: string;
  /** Lookup key derived from the product page URL. May differ from the identity. */
  pageKey: string;
  aliases: ProductAlias[];
  metadata: ProductMetadata;
  offers: NormalizedOffer[];
}

export interface NormalizedSnapshot {
  storeId: StoreId;
  /** UTC ISO-8601 with milliseconds, e.g. `2026-09-06T09:54:15.029Z`. */
  observedAt: string;
  sourceSchemaVersion: string;
  complete: boolean;
  /** Describes what the crawl covered, so partial coverage never counts as "missing". */
  coverageId: string;
  rawSha256: string;
  normalizedHash: string;
  products: NormalizedProduct[];
}

/** Canonical identity of a listing: (store, external product id). */
export interface ProductRef {
  storeId: StoreId;
  externalProductId: string;
}

export function productRefKey(ref: ProductRef): string {
  return `${ref.storeId}:${ref.externalProductId}`;
}
