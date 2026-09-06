import type { StoreCapabilities } from '../../src/core/capabilities.ts';
import {
  DEFAULT_OFFER_ID,
  type AvailabilityState,
  type NormalizedProduct,
  type NormalizedSnapshot,
  type PriceQuote,
} from '../../src/core/domain.ts';
import { sha256OfCanonicalJson } from '../../src/core/hash.ts';
import { normalizeUtcIso } from '../../src/core/time.ts';

/**
 * Builders for synthetic normalized snapshots. They exercise the store-neutral
 * layers with shapes Phase 1 data never produces (ranges, variants, tax
 * excluded quotes, not_displayed availability) so the contract stays honest
 * for Phase 2/3 without implementing those adapters.
 */
export const SYNTHETIC_CAPABILITIES: StoreCapabilities = {
  supportsExactPrice: true,
  supportsPriceRange: true,
  supportsVariants: true,
  supportsCompareAtPrice: true,
  supportsTaxIncluded: true,
  supportsTaxExcluded: true,
  supportsAvailability: true,
  supportsInventoryQuantity: true,
  inventoryQuantitySemantics: 'site_reported',
  primaryQuote: { quoteKind: 'selling', taxTreatment: 'tax_included' },
};

export interface SyntheticOffer {
  offerId?: string;
  quotes?: PriceQuote[];
  price?: number | [number, number] | null;
  unit?: string | null;
  availability?: AvailabilityState;
  purchasable?: boolean | null;
  quantity?: number | null;
  rawStatus?: string | null;
  sku?: string | null;
  variantName?: string | null;
}

export interface SyntheticProduct extends SyntheticOffer {
  id: string;
  pageKey?: string;
  name?: string;
  modelNumber?: string | null;
  category?: string | null;
  offers?: SyntheticOffer[];
}

export function quote(price: number | [number, number] | null, unit: string | null = '1個', extra: Partial<PriceQuote> = {}): PriceQuote {
  const base: PriceQuote = {
    quoteKind: 'selling',
    taxTreatment: 'tax_included',
    currency: 'JPY',
    state: 'exact',
    minAmountMinor: 0,
    maxAmountMinor: 0,
    unitLabel: unit,
    ...extra,
  };
  if (price === null) return { ...base, state: 'unavailable', minAmountMinor: null, maxAmountMinor: null };
  if (Array.isArray(price)) {
    const [lo, hi] = price;
    if (lo === hi) return { ...base, state: 'exact', minAmountMinor: lo, maxAmountMinor: lo };
    return { ...base, state: 'range', minAmountMinor: lo, maxAmountMinor: hi };
  }
  return { ...base, state: 'exact', minAmountMinor: price, maxAmountMinor: price };
}

function offerOf(o: SyntheticOffer, fallbackId: string): NormalizedProduct['offers'][number] {
  const quantity = o.quantity ?? null;
  return {
    externalOfferId: o.offerId ?? fallbackId,
    offerKind: o.offerId === undefined ? 'default' : 'variant',
    sku: o.sku ?? null,
    variantName: o.variantName ?? null,
    priceQuotes: o.quotes ?? [quote(o.price === undefined ? 100 : o.price, o.unit === undefined ? '1個' : o.unit)],
    availability: {
      state: o.availability ?? 'in_stock',
      purchasable: o.purchasable === undefined ? true : o.purchasable,
      quantity,
      quantitySemantics: quantity === null ? 'unknown' : 'site_reported',
      rawStatus: o.rawStatus === undefined ? null : o.rawStatus,
    },
  };
}

export function syntheticProduct(p: SyntheticProduct): NormalizedProduct {
  const offers = p.offers === undefined ? [offerOf(p, DEFAULT_OFFER_ID)] : p.offers.map((o, i) => offerOf(o, `v${i}`));
  return {
    externalProductId: p.id,
    pageKey: p.pageKey ?? p.id,
    aliases: [{ kind: 'id', value: p.id }],
    metadata: {
      name: p.name ?? `Product ${p.id}`,
      modelNumber: p.modelNumber === undefined ? `M-${p.id}` : p.modelNumber,
      category: p.category === undefined ? 'cat' : p.category,
      canonicalUrl: `https://example.test/p/${p.pageKey ?? p.id}`,
    },
    offers,
  };
}

export function syntheticSnapshot(
  observedAt: string,
  products: SyntheticProduct[],
  options: { storeId?: string; coverageId?: string; complete?: boolean } = {},
): NormalizedSnapshot {
  const body = {
    storeId: options.storeId ?? 'synthetic',
    observedAt: normalizeUtcIso(observedAt),
    sourceSchemaVersion: 'test',
    complete: options.complete ?? true,
    coverageId: options.coverageId ?? 'all',
    products: products.map(syntheticProduct).sort((a, b) => (a.externalProductId < b.externalProductId ? -1 : 1)),
  };
  return { ...body, rawSha256: sha256OfCanonicalJson({ raw: body }), normalizedHash: sha256OfCanonicalJson(body) };
}

/** Day offsets to ISO timestamps; keeps tests readable. */
export function day(n: number): string {
  return new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();
}

export function dayMs(n: number): number {
  return Date.UTC(2026, 0, 1) + n * 86_400_000;
}
