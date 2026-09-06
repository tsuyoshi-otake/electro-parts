import type { StoreCapabilities } from '../core/capabilities.ts';
import type { ProductMetadata } from '../core/domain.ts';
import { canonicalPresence, type ChangePoint } from '../core/history.ts';
import type { PriceBasis, PricePoint } from '../core/price.ts';
import type { Db } from './connection.ts';
import {
  availabilitySpec,
  inventorySpec,
  isSuspiciousMetadataChange,
  metadataSpec,
  presenceSpec,
  priceSpec,
  type AvailabilityPoint,
} from './seriesSpecs.ts';

/**
 * Bulk read of one store's history in publisher-friendly shape. Everything is
 * loaded with a handful of ordered scans and grouped in memory; per-entity
 * queries would be too slow for ~10k products.
 */
export interface StoreRunRecord {
  runId: number;
  observedAt: number;
  observedAtIso: string;
  coverageId: string;
  rawSha256: string;
  normalizedHash: string;
  itemCount: number;
  importedAt: string;
}

export interface BasisHistory {
  priceBasisId: number;
  basis: PriceBasis;
  presence: ChangePoint<boolean>[];
  prices: ChangePoint<PricePoint>[];
}

export interface OfferHistory {
  offerId: number;
  externalOfferId: string;
  offerKind: string;
  sku: string | null;
  variantName: string | null;
  presence: ChangePoint<boolean>[];
  availability: ChangePoint<AvailabilityPoint>[];
  inventory: ChangePoint<number | null>[];
  bases: BasisHistory[];
}

export interface ProductHistory {
  productId: number;
  externalProductId: string;
  pageKey: string;
  firstSeenAt: number;
  lastSeenAt: number;
  aliases: { kind: string; value: string }[];
  presence: ChangePoint<boolean>[];
  metadata: ChangePoint<ProductMetadata & { suspicious: boolean }>[];
  offers: OfferHistory[];
}

export interface StoreHistory {
  storeId: string;
  capabilities: StoreCapabilities;
  runs: StoreRunRecord[];
  products: ProductHistory[];
}

export function listRuns(db: Db, storeId: string): StoreRunRecord[] {
  return (
    db
      .prepare(
        `SELECT run_id, observed_at, observed_at_iso, coverage_id, raw_sha256, normalized_hash, item_count, imported_at
         FROM crawl_runs WHERE store_id = ? ORDER BY observed_at`,
      )
      .all(storeId) as Record<string, unknown>[]
  ).map((r) => ({
    runId: r['run_id'] as number,
    observedAt: r['observed_at'] as number,
    observedAtIso: r['observed_at_iso'] as string,
    coverageId: r['coverage_id'] as string,
    rawSha256: r['raw_sha256'] as string,
    normalizedHash: r['normalized_hash'] as string,
    itemCount: r['item_count'] as number,
    importedAt: r['imported_at'] as string,
  }));
}

export function readStoreCapabilities(db: Db, storeId: string): StoreCapabilities | undefined {
  const row = db.prepare('SELECT capabilities_json FROM stores WHERE store_id = ?').get(storeId) as
    | { capabilities_json: string }
    | undefined;
  return row === undefined ? undefined : (JSON.parse(row.capabilities_json) as StoreCapabilities);
}

function groupSeries<S>(
  rows: Record<string, unknown>[],
  keyColumn: string,
  fromRow: (r: Record<string, unknown>) => S,
): Map<number, ChangePoint<S>[]> {
  const out = new Map<number, ChangePoint<S>[]>();
  for (const r of rows) {
    const key = r[keyColumn] as number;
    let list = out.get(key);
    if (list === undefined) {
      list = [];
      out.set(key, list);
    }
    list.push({ t: r['observed_at'] as number, state: fromRow(r) });
  }
  return out;
}

export function readStoreHistory(db: Db, storeId: string): StoreHistory {
  const capabilities = readStoreCapabilities(db, storeId);
  if (capabilities === undefined) throw new Error(`store ${storeId} is not present in the database`);
  const runs = listRuns(db, storeId);

  const productRows = db
    .prepare(
      'SELECT product_id, external_product_id, page_key, first_seen_at, last_seen_at FROM products WHERE store_id = ? ORDER BY external_product_id',
    )
    .all(storeId) as Record<string, unknown>[];
  const aliasRows = db
    .prepare('SELECT product_id, kind, value FROM product_aliases WHERE store_id = ? ORDER BY product_id, kind, value')
    .all(storeId) as Record<string, unknown>[];
  const offerRows = db
    .prepare(
      `SELECT o.offer_id, o.product_id, o.external_offer_id, o.offer_kind, o.sku, o.variant_name
       FROM offers o JOIN products p ON p.product_id = o.product_id WHERE p.store_id = ? ORDER BY o.product_id, o.external_offer_id`,
    )
    .all(storeId) as Record<string, unknown>[];
  const basisRows = db
    .prepare(
      `SELECT b.price_basis_id, b.offer_id, b.quote_kind, b.tax_treatment, b.currency, b.unit_label
       FROM price_bases b JOIN offers o ON o.offer_id = b.offer_id JOIN products p ON p.product_id = o.product_id
       WHERE p.store_id = ? ORDER BY b.offer_id, b.basis_key`,
    )
    .all(storeId) as Record<string, unknown>[];

  const presenceByKind = (kind: string, join: string) =>
    groupSeries(
      db
        .prepare(
          `SELECT e.entity_id, e.observed_at, e.present FROM presence_events e ${join} WHERE e.entity_kind = '${kind}' AND p.store_id = ? ORDER BY e.entity_id, e.observed_at`,
        )
        .all(storeId) as Record<string, unknown>[],
      'entity_id',
      presenceSpec.fromRow,
    );
  const productPresence = presenceByKind('product', 'JOIN products p ON p.product_id = e.entity_id');
  const offerPresence = presenceByKind('offer', 'JOIN offers o ON o.offer_id = e.entity_id JOIN products p ON p.product_id = o.product_id');
  const basisPresence = presenceByKind(
    'price_basis',
    'JOIN price_bases b ON b.price_basis_id = e.entity_id JOIN offers o ON o.offer_id = b.offer_id JOIN products p ON p.product_id = o.product_id',
  );
  const priceSeries = groupSeries(
    db
      .prepare(
        `SELECT e.price_basis_id, e.observed_at, e.state, e.min_amount_minor, e.max_amount_minor FROM price_events e
         JOIN price_bases b ON b.price_basis_id = e.price_basis_id JOIN offers o ON o.offer_id = b.offer_id JOIN products p ON p.product_id = o.product_id
         WHERE p.store_id = ? ORDER BY e.price_basis_id, e.observed_at`,
      )
      .all(storeId) as Record<string, unknown>[],
    'price_basis_id',
    priceSpec.fromRow,
  );
  const availabilitySeries = groupSeries(
    db
      .prepare(
        `SELECT e.offer_id, e.observed_at, e.state, e.purchasable, e.quantity_semantics, e.raw_status FROM availability_events e
         JOIN offers o ON o.offer_id = e.offer_id JOIN products p ON p.product_id = o.product_id
         WHERE p.store_id = ? ORDER BY e.offer_id, e.observed_at`,
      )
      .all(storeId) as Record<string, unknown>[],
    'offer_id',
    availabilitySpec.fromRow,
  );
  const inventorySeries = groupSeries(
    db
      .prepare(
        `SELECT e.offer_id, e.observed_at, e.quantity FROM inventory_samples e
         JOIN offers o ON o.offer_id = e.offer_id JOIN products p ON p.product_id = o.product_id
         WHERE p.store_id = ? ORDER BY e.offer_id, e.observed_at`,
      )
      .all(storeId) as Record<string, unknown>[],
    'offer_id',
    inventorySpec.fromRow,
  );
  const metadataSeries = groupSeries(
    db
      .prepare(
        `SELECT e.product_id, e.observed_at, e.name, e.model_number, e.category, e.canonical_url FROM metadata_events e
         JOIN products p ON p.product_id = e.product_id WHERE p.store_id = ? ORDER BY e.product_id, e.observed_at`,
      )
      .all(storeId) as Record<string, unknown>[],
    'product_id',
    metadataSpec.fromRow,
  );

  const aliasesByProduct = new Map<number, { kind: string; value: string }[]>();
  for (const r of aliasRows) {
    const id = r['product_id'] as number;
    let list = aliasesByProduct.get(id);
    if (list === undefined) {
      list = [];
      aliasesByProduct.set(id, list);
    }
    list.push({ kind: r['kind'] as string, value: r['value'] as string });
  }
  const basesByOffer = new Map<number, BasisHistory[]>();
  for (const r of basisRows) {
    const offerId = r['offer_id'] as number;
    const id = r['price_basis_id'] as number;
    let list = basesByOffer.get(offerId);
    if (list === undefined) {
      list = [];
      basesByOffer.set(offerId, list);
    }
    list.push({
      priceBasisId: id,
      basis: {
        quoteKind: r['quote_kind'] as PriceBasis['quoteKind'],
        taxTreatment: r['tax_treatment'] as PriceBasis['taxTreatment'],
        currency: r['currency'] as string,
        unitLabel: (r['unit_label'] as string | null) ?? null,
      },
      presence: canonicalPresence(basisPresence.get(id) ?? []),
      prices: priceSeries.get(id) ?? [],
    });
  }
  const offersByProduct = new Map<number, OfferHistory[]>();
  for (const r of offerRows) {
    const productId = r['product_id'] as number;
    const id = r['offer_id'] as number;
    let list = offersByProduct.get(productId);
    if (list === undefined) {
      list = [];
      offersByProduct.set(productId, list);
    }
    list.push({
      offerId: id,
      externalOfferId: r['external_offer_id'] as string,
      offerKind: r['offer_kind'] as string,
      sku: (r['sku'] as string | null) ?? null,
      variantName: (r['variant_name'] as string | null) ?? null,
      presence: canonicalPresence(offerPresence.get(id) ?? []),
      availability: availabilitySeries.get(id) ?? [],
      inventory: inventorySeries.get(id) ?? [],
      bases: basesByOffer.get(id) ?? [],
    });
  }

  const products: ProductHistory[] = productRows.map((r) => {
    const id = r['product_id'] as number;
    return {
      productId: id,
      externalProductId: r['external_product_id'] as string,
      pageKey: r['page_key'] as string,
      firstSeenAt: r['first_seen_at'] as number,
      lastSeenAt: r['last_seen_at'] as number,
      aliases: aliasesByProduct.get(id) ?? [],
      presence: canonicalPresence(productPresence.get(id) ?? []),
      metadata: withSuspicion(metadataSeries.get(id) ?? []),
      offers: offersByProduct.get(id) ?? [],
    };
  });

  return { storeId, capabilities, runs, products };
}

/** Flags change points where name and model number changed together (possible identity reuse). */
function withSuspicion(series: readonly ChangePoint<ProductMetadata>[]): ChangePoint<ProductMetadata & { suspicious: boolean }>[] {
  return series.map((cp, i) => ({
    t: cp.t,
    state: { ...cp.state, suspicious: isSuspiciousMetadataChange(series[i - 1]?.state, cp.state) },
  }));
}
