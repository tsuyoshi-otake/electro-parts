import type { AvailabilityState, ProductMetadata, QuantitySemantics } from '../core/domain.ts';
import { equalBoolean, PRESENCE_INITIAL } from '../core/history.ts';
import { samePricePoint, type PricePoint } from '../core/price.ts';
import type { SeriesSpec } from './series.ts';

export type PresenceKind = 'product' | 'offer' | 'price_basis';

export const presenceSpec: SeriesSpec<boolean> = {
  table: 'presence_events',
  keyColumns: ['entity_kind', 'entity_id'],
  stateColumns: ['present'],
  toRow: (s) => [s ? 1 : 0],
  fromRow: (r) => r['present'] === 1,
  equal: equalBoolean,
  initial: PRESENCE_INITIAL,
};

export const priceSpec: SeriesSpec<PricePoint> = {
  table: 'price_events',
  keyColumns: ['price_basis_id'],
  stateColumns: ['state', 'min_amount_minor', 'max_amount_minor'],
  toRow: (p) => [p.state, p.minAmountMinor, p.maxAmountMinor],
  fromRow: (r) => ({
    state: r['state'] as PricePoint['state'],
    minAmountMinor: (r['min_amount_minor'] as number | null) ?? null,
    maxAmountMinor: (r['max_amount_minor'] as number | null) ?? null,
  }),
  equal: samePricePoint,
};

export interface AvailabilityPoint {
  state: AvailabilityState;
  purchasable: boolean | null;
  quantitySemantics: QuantitySemantics;
  rawStatus: string | null;
}

export function sameAvailability(a: AvailabilityPoint, b: AvailabilityPoint): boolean {
  return (
    a.state === b.state &&
    a.purchasable === b.purchasable &&
    a.quantitySemantics === b.quantitySemantics &&
    a.rawStatus === b.rawStatus
  );
}

export const availabilitySpec: SeriesSpec<AvailabilityPoint> = {
  table: 'availability_events',
  keyColumns: ['offer_id'],
  stateColumns: ['state', 'purchasable', 'quantity_semantics', 'raw_status'],
  toRow: (a) => [a.state, a.purchasable === null ? null : a.purchasable ? 1 : 0, a.quantitySemantics, a.rawStatus],
  fromRow: (r) => ({
    state: r['state'] as AvailabilityState,
    purchasable: r['purchasable'] === null || r['purchasable'] === undefined ? null : r['purchasable'] === 1,
    quantitySemantics: r['quantity_semantics'] as QuantitySemantics,
    rawStatus: (r['raw_status'] as string | null) ?? null,
  }),
  equal: sameAvailability,
};

export const inventorySpec: SeriesSpec<number | null> = {
  table: 'inventory_samples',
  keyColumns: ['offer_id'],
  stateColumns: ['quantity'],
  toRow: (q) => [q],
  fromRow: (r) => (r['quantity'] as number | null) ?? null,
  equal: (a, b) => a === b,
};

export function sameMetadata(a: ProductMetadata, b: ProductMetadata): boolean {
  return (
    a.name === b.name && a.modelNumber === b.modelNumber && a.category === b.category && a.canonicalUrl === b.canonicalUrl
  );
}

export const metadataSpec: SeriesSpec<ProductMetadata> = {
  table: 'metadata_events',
  keyColumns: ['product_id'],
  stateColumns: ['name', 'model_number', 'category', 'canonical_url'],
  toRow: (m) => [m.name, m.modelNumber, m.category, m.canonicalUrl],
  fromRow: (r) => ({
    name: r['name'] as string,
    modelNumber: (r['model_number'] as string | null) ?? null,
    category: (r['category'] as string | null) ?? null,
    canonicalUrl: r['canonical_url'] as string,
  }),
  equal: sameMetadata,
};

/**
 * Identity-reuse heuristic: a listing whose name AND model number both change
 * at once is more likely a re-used sales code than a renamed product. The flag
 * is informational (shown as a caveat), never used to split identities.
 */
export function isSuspiciousMetadataChange(prev: ProductMetadata | undefined, next: ProductMetadata): boolean {
  if (prev === undefined) return false;
  const nameChanged = prev.name !== next.name;
  const modelChanged = prev.modelNumber !== null && next.modelNumber !== null && prev.modelNumber !== next.modelNumber;
  return nameChanged && modelChanged;
}
