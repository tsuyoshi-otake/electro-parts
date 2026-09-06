import type { StoreCapabilities } from '../../core/capabilities.ts';

export const AKIZUKI_STORE_ID = 'akizuki';

export const AKIZUKI_CAPABILITIES: StoreCapabilities = {
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
};
