import type { QuantitySemantics, QuoteKind, TaxTreatment } from './domain.ts';

/**
 * Declarative description of what a store's data can express. The UI and the
 * publisher consult capabilities instead of branching on the store id.
 */
export interface StoreCapabilities {
  supportsExactPrice: boolean;
  supportsPriceRange: boolean;
  supportsVariants: boolean;
  supportsCompareAtPrice: boolean;
  supportsTaxIncluded: boolean;
  supportsTaxExcluded: boolean;
  supportsAvailability: boolean;
  supportsInventoryQuantity: boolean;
  inventoryQuantitySemantics: QuantitySemantics;
  /** Which quote the UI treats as "the price". */
  primaryQuote: { quoteKind: QuoteKind; taxTreatment: TaxTreatment };
}

export function validateCapabilities(value: unknown): value is StoreCapabilities {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const bools = [
    'supportsExactPrice',
    'supportsPriceRange',
    'supportsVariants',
    'supportsCompareAtPrice',
    'supportsTaxIncluded',
    'supportsTaxExcluded',
    'supportsAvailability',
    'supportsInventoryQuantity',
  ];
  if (!bools.every((k) => typeof v[k] === 'boolean')) return false;
  if (typeof v['inventoryQuantitySemantics'] !== 'string') return false;
  const pq = v['primaryQuote'];
  if (typeof pq !== 'object' || pq === null) return false;
  const p = pq as Record<string, unknown>;
  return typeof p['quoteKind'] === 'string' && typeof p['taxTreatment'] === 'string';
}
