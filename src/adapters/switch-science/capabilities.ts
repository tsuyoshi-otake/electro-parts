import type { StoreCapabilities } from '../../core/capabilities.ts';

export const SWITCH_SCIENCE_STORE_ID = 'switch-science';

/**
 * What Switch Science's data can express.
 *
 * Measured on the 10,343-product 2026-08-02 catalogue: every product has
 * exactly one variant, no price varies, and no `compare_at_price` is set. The
 * flags below still claim variants, ranges and compare-at prices, because the
 * store *can* express them — it is a Shopify storefront and the API returns
 * `variants[]` unconditionally. A capability describes the shape of the source,
 * not today's sample of it; claiming otherwise would mean the day a product
 * gains a second variant is the day the adapter starts lying about it.
 *
 * Inventory quantity is the opposite case: the bulk catalogue API exposes only
 * a boolean `available`, so the quantity is genuinely absent, not merely zero.
 */
export const SWITCH_SCIENCE_CAPABILITIES: StoreCapabilities = {
  supportsExactPrice: true,
  supportsPriceRange: true,
  supportsVariants: true,
  supportsCompareAtPrice: true,
  supportsTaxIncluded: true,
  supportsTaxExcluded: false,
  supportsAvailability: true,
  supportsInventoryQuantity: false,
  inventoryQuantitySemantics: 'not_exposed',
  primaryQuote: { quoteKind: 'selling', taxTreatment: 'tax_included' },
};
