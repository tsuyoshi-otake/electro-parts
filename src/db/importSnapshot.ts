import type { StoreCapabilities } from '../core/capabilities.ts';
import { DEFAULT_OFFER_ID, type NormalizedProduct, type NormalizedSnapshot } from '../core/domain.ts';
import { canonicalJson } from '../core/hash.ts';
import { expandPresentRuns } from '../core/history.ts';
import { isSafeKey } from '../core/identity.ts';
import { basisKey, basisOf, isValidPricePoint, pricePointOf } from '../core/price.ts';
import { parseUtcMs } from '../core/time.ts';
import type { ValidationResult } from '../core/validation.ts';
import { transaction, type Db } from './connection.ts';
import { SeriesAccess } from './series.ts';
import {
  availabilitySpec,
  inventorySpec,
  isSuspiciousMetadataChange,
  metadataSpec,
  presenceSpec,
  priceSpec,
  type PresenceKind,
} from './seriesSpecs.ts';

export class SnapshotConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotConflictError';
  }
}

export interface ImportOptions {
  capabilities: StoreCapabilities;
  validation?: ValidationResult;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

export interface ImportStats {
  status: 'imported' | 'already_imported';
  runId: number;
  observedAt: number;
  productsTotal: number;
  productsNew: number;
  productsAbsent: number;
  changedPricePoints: number;
  changedAvailability: number;
  changedInventory: number;
  changedMetadata: number;
  suspiciousMetadata: number;
  changedPresence: number;
  outOfOrder: boolean;
}

interface ProductRow {
  product_id: number;
  external_product_id: string;
  page_key: string;
}

interface OfferRow {
  offer_id: number;
  product_id: number;
  external_offer_id: string;
}

interface BasisRow {
  price_basis_id: number;
  offer_id: number;
  basis_key: string;
}

/**
 * Imports one normalized snapshot into the store-scoped history.
 *
 * Idempotent: importing the same (store, observedAt, normalizedHash) again is
 * a no-op. Conflicting: a different normalizedHash for an existing
 * (store, observedAt) throws and leaves the database untouched. Order
 * independent: importing runs in any order yields the same tables (verified
 * by property tests against the in-memory oracle).
 */
export function importSnapshot(db: Db, snapshot: NormalizedSnapshot, options: ImportOptions): ImportStats {
  validateSnapshotForImport(snapshot);
  const observedAt = parseUtcMs(snapshot.observedAt);
  const now = (options.now ?? (() => new Date()))().toISOString();

  return transaction(db, () => {
    ensureStore(db, snapshot.storeId, options.capabilities, now);

    const existingRun = db
      .prepare('SELECT run_id, normalized_hash FROM crawl_runs WHERE store_id = ? AND observed_at = ?')
      .get(snapshot.storeId, observedAt) as { run_id: number; normalized_hash: string } | undefined;
    if (existingRun !== undefined) {
      if (existingRun.normalized_hash === snapshot.normalizedHash) {
        return emptyStats('already_imported', existingRun.run_id, observedAt, snapshot.products.length);
      }
      throw new SnapshotConflictError(
        `a different snapshot for ${snapshot.storeId} at ${snapshot.observedAt} is already imported (hash ${existingRun.normalized_hash} vs ${snapshot.normalizedHash})`,
      );
    }

    const allRuns = (
      db.prepare('SELECT observed_at FROM crawl_runs WHERE store_id = ? ORDER BY observed_at').all(snapshot.storeId) as {
        observed_at: number;
      }[]
    ).map((r) => r.observed_at);
    const outOfOrder = allRuns.length > 0 && observedAt < (allRuns[allRuns.length - 1] as number);

    const runId = (
      db
        .prepare(
          `INSERT INTO crawl_runs(store_id, observed_at, observed_at_iso, source_schema_version, coverage_id, raw_sha256, normalized_hash, item_count, validation_json, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING run_id`,
        )
        .get(
          snapshot.storeId,
          observedAt,
          snapshot.observedAt,
          snapshot.sourceSchemaVersion,
          snapshot.coverageId,
          snapshot.rawSha256,
          snapshot.normalizedHash,
          snapshot.products.length,
          canonicalJson(options.validation ?? { errors: [], warnings: [], metrics: {} }),
          now,
        ) as { run_id: number }
    ).run_id;

    const stats = emptyStats('imported', runId, observedAt, snapshot.products.length);
    stats.outOfOrder = outOfOrder;

    const presence = new SeriesAccess(db, presenceSpec);
    const prices = new SeriesAccess(db, priceSpec);
    const availability = new SeriesAccess(db, availabilitySpec);
    const inventory = new SeriesAccess(db, inventorySpec);
    const metadata = new SeriesAccess(db, metadataSpec);

    const products = loadProducts(db, snapshot.storeId);
    const offers = loadOffers(db, snapshot.storeId);
    const bases = loadBases(db, snapshot.storeId);

    const insertProduct = db.prepare(
      'INSERT INTO products(store_id, external_product_id, page_key, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?) RETURNING product_id',
    );
    const touchProduct = db.prepare(
      'UPDATE products SET first_seen_at = MIN(first_seen_at, ?), last_seen_at = MAX(last_seen_at, ?), page_key = ? WHERE product_id = ?',
    );
    const upsertAlias = db.prepare(
      `INSERT INTO product_aliases(product_id, store_id, kind, value, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, kind, value) DO UPDATE SET first_seen_at = MIN(first_seen_at, excluded.first_seen_at), last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
    );
    const insertOffer = db.prepare(
      'INSERT INTO offers(product_id, external_offer_id, offer_kind, sku, variant_name, metadata_observed_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING offer_id',
    );
    const updateOfferMetadata = db.prepare(
      `UPDATE offers SET offer_kind = ?, sku = ?, variant_name = ?, metadata_observed_at = ?
       WHERE offer_id = ? AND (metadata_observed_at IS NULL OR metadata_observed_at <= ?)`,
    );
    const insertBasis = db.prepare(
      'INSERT INTO price_bases(offer_id, basis_key, quote_kind, tax_treatment, currency, unit_label) VALUES (?, ?, ?, ?, ?, ?) RETURNING price_basis_id',
    );

    const presenceKey = (kind: PresenceKind, id: number) => [kind, id] as const;
    const inSnapshot = new Set<string>();

    for (const product of snapshot.products) {
      inSnapshot.add(product.externalProductId);
      let row = products.get(product.externalProductId);
      let productId: number;
      if (row === undefined) {
        productId = (insertProduct.get(snapshot.storeId, product.externalProductId, product.pageKey, observedAt, observedAt) as {
          product_id: number;
        }).product_id;
        row = { product_id: productId, external_product_id: product.externalProductId, page_key: product.pageKey };
        products.set(product.externalProductId, row);
        stats.productsNew += 1;
      } else {
        productId = row.product_id;
        touchProduct.run(observedAt, observedAt, product.pageKey, productId);
      }
      // Product presence over all runs of the store. A brand-new entity was
      // implicitly absent from every already imported run, so the same insert
      // synthesizes the absent span when this run is imported out of order.
      const productPresence = presence.insert(presenceKey('product', productId), { t: observedAt, state: true }, allRuns);
      if (productPresence.plan.changed) stats.changedPresence += 1;
      for (const alias of product.aliases) {
        upsertAlias.run(productId, snapshot.storeId, alias.kind, alias.value, observedAt, observedAt);
      }
      const productRuns = expandPresentRuns(presence.readAll(presenceKey('product', productId)), allRuns);

      // Metadata over runs where the product was present.
      const meta = metadata.insert([productId], { t: observedAt, state: product.metadata }, productRuns);
      if (meta.plan.changed) {
        stats.changedMetadata += 1;
        // Import-time hint only (relative to the previous known point); the
        // authoritative flag is derived when reading the history.
        if (isSuspiciousMetadataChange(meta.window.prev?.state, product.metadata)) stats.suspiciousMetadata += 1;
      }

      // Offers: presence over product-present runs.
      const productOffers = offers.get(productId) ?? new Map<string, OfferRow>();
      offers.set(productId, productOffers);
      const offersInSnapshot = new Set<string>();
      for (const offer of product.offers) {
        offersInSnapshot.add(offer.externalOfferId);
        let offerRow = productOffers.get(offer.externalOfferId);
        let offerId: number;
        if (offerRow === undefined) {
          offerId = (insertOffer.get(productId, offer.externalOfferId, offer.offerKind, offer.sku, offer.variantName, observedAt) as {
            offer_id: number;
          }).offer_id;
          offerRow = { offer_id: offerId, product_id: productId, external_offer_id: offer.externalOfferId };
          productOffers.set(offer.externalOfferId, offerRow);
        } else {
          offerId = offerRow.offer_id;
          updateOfferMetadata.run(offer.offerKind, offer.sku, offer.variantName, observedAt, offerId, observedAt);
        }
        const offerPresence = presence.insert(presenceKey('offer', offerId), { t: observedAt, state: true }, productRuns);
        if (offerPresence.plan.changed) stats.changedPresence += 1;
        const offerRuns = expandPresentRuns(presence.readAll(presenceKey('offer', offerId)), productRuns);

        const av = availability.insert(
          [offerId],
          {
            t: observedAt,
            state: {
              state: offer.availability.state,
              purchasable: offer.availability.purchasable,
              quantitySemantics: offer.availability.quantitySemantics,
              rawStatus: offer.availability.rawStatus,
            },
          },
          offerRuns,
        );
        if (av.plan.changed) stats.changedAvailability += 1;

        const inv = inventory.insert([offerId], { t: observedAt, state: offer.availability.quantity }, offerRuns);
        if (inv.plan.changed) stats.changedInventory += 1;

        // Price bases: presence over offer-present runs.
        const offerBases = bases.get(offerId) ?? new Map<string, BasisRow>();
        bases.set(offerId, offerBases);
        const basesInSnapshot = new Set<string>();
        for (const quote of offer.priceQuotes) {
          const basis = basisOf(quote);
          const key = basisKey(basis);
          if (basesInSnapshot.has(key)) throw new Error(`duplicate price basis ${key} for ${product.externalProductId}`);
          basesInSnapshot.add(key);
          let basisRow = offerBases.get(key);
          let basisId: number;
          if (basisRow === undefined) {
            basisId = (insertBasis.get(offerId, key, basis.quoteKind, basis.taxTreatment, basis.currency, basis.unitLabel) as {
              price_basis_id: number;
            }).price_basis_id;
            basisRow = { price_basis_id: basisId, offer_id: offerId, basis_key: key };
            offerBases.set(key, basisRow);
          } else {
            basisId = basisRow.price_basis_id;
          }
          const basisPresence = presence.insert(presenceKey('price_basis', basisId), { t: observedAt, state: true }, offerRuns);
          if (basisPresence.plan.changed) stats.changedPresence += 1;
          const basisRuns = expandPresentRuns(presence.readAll(presenceKey('price_basis', basisId)), offerRuns);
          const pr = prices.insert([basisId], { t: observedAt, state: pricePointOf(quote) }, basisRuns);
          if (pr.plan.changed) stats.changedPricePoints += 1;
        }
        for (const [key, basisRow] of offerBases) {
          if (basesInSnapshot.has(key)) continue;
          const r = presence.insert(presenceKey('price_basis', basisRow.price_basis_id), { t: observedAt, state: false }, offerRuns);
          if (r.plan.changed) stats.changedPresence += 1;
        }
      }
      for (const [extOfferId, offerRow] of productOffers) {
        if (offersInSnapshot.has(extOfferId)) continue;
        const r = presence.insert(presenceKey('offer', offerRow.offer_id), { t: observedAt, state: false }, productRuns);
        if (r.plan.changed) stats.changedPresence += 1;
      }
    }

    // Known products missing from this complete snapshot: absent in this run.
    for (const [extId, row] of products) {
      if (inSnapshot.has(extId)) continue;
      stats.productsAbsent += 1;
      const r = presence.insert(presenceKey('product', row.product_id), { t: observedAt, state: false }, allRuns);
      if (r.plan.changed) stats.changedPresence += 1;
    }
    return stats;
  });
}

function emptyStats(status: ImportStats['status'], runId: number, observedAt: number, total: number): ImportStats {
  return {
    status,
    runId,
    observedAt,
    productsTotal: total,
    productsNew: 0,
    productsAbsent: 0,
    changedPricePoints: 0,
    changedAvailability: 0,
    changedInventory: 0,
    changedMetadata: 0,
    suspiciousMetadata: 0,
    changedPresence: 0,
    outOfOrder: false,
  };
}

export function ensureStore(db: Db, storeId: string, capabilities: StoreCapabilities, now: string): void {
  db.prepare(
    `INSERT INTO stores(store_id, capabilities_json, created_at) VALUES (?, ?, ?)
     ON CONFLICT(store_id) DO UPDATE SET capabilities_json = excluded.capabilities_json`,
  ).run(storeId, canonicalJson(capabilities), now);
}

/** Structural checks that the adapter contract guarantees; cheap to re-check here. */
export function validateSnapshotForImport(snapshot: NormalizedSnapshot): void {
  if (!snapshot.complete) throw new Error('refusing to import an incomplete snapshot');
  if (snapshot.products.length === 0) throw new Error('refusing to import an empty snapshot');
  const seen = new Set<string>();
  for (const p of snapshot.products) {
    if (!isSafeKey(p.externalProductId)) throw new Error(`unsafe external product id ${JSON.stringify(p.externalProductId)}`);
    if (!isSafeKey(p.pageKey)) throw new Error(`unsafe page key ${JSON.stringify(p.pageKey)}`);
    if (seen.has(p.externalProductId)) throw new Error(`duplicate product ${p.externalProductId}`);
    seen.add(p.externalProductId);
    if (p.offers.length === 0) throw new Error(`product ${p.externalProductId} has no offers`);
    const offerIds = new Set<string>();
    for (const o of p.offers) {
      if (offerIds.has(o.externalOfferId)) throw new Error(`duplicate offer ${o.externalOfferId} in ${p.externalProductId}`);
      offerIds.add(o.externalOfferId);
      if (o.externalOfferId !== DEFAULT_OFFER_ID && !isSafeKey(o.externalOfferId)) {
        throw new Error(`unsafe offer id ${JSON.stringify(o.externalOfferId)}`);
      }
      for (const q of o.priceQuotes) {
        if (!isValidPricePoint(pricePointOf(q))) {
          throw new Error(`invalid price point for ${p.externalProductId}: ${JSON.stringify(q)}`);
        }
      }
    }
  }
}

function loadProducts(db: Db, storeId: string): Map<string, ProductRow> {
  const rows = db
    .prepare('SELECT product_id, external_product_id, page_key FROM products WHERE store_id = ?')
    .all(storeId) as unknown as ProductRow[];
  return new Map(rows.map((r) => [r.external_product_id, r]));
}

function loadOffers(db: Db, storeId: string): Map<number, Map<string, OfferRow>> {
  const rows = db
    .prepare(
      'SELECT o.offer_id, o.product_id, o.external_offer_id FROM offers o JOIN products p ON p.product_id = o.product_id WHERE p.store_id = ?',
    )
    .all(storeId) as unknown as OfferRow[];
  const out = new Map<number, Map<string, OfferRow>>();
  for (const r of rows) {
    let m = out.get(r.product_id);
    if (m === undefined) {
      m = new Map();
      out.set(r.product_id, m);
    }
    m.set(r.external_offer_id, r);
  }
  return out;
}

function loadBases(db: Db, storeId: string): Map<number, Map<string, BasisRow>> {
  const rows = db
    .prepare(
      `SELECT b.price_basis_id, b.offer_id, b.basis_key FROM price_bases b
       JOIN offers o ON o.offer_id = b.offer_id JOIN products p ON p.product_id = o.product_id WHERE p.store_id = ?`,
    )
    .all(storeId) as unknown as BasisRow[];
  const out = new Map<number, Map<string, BasisRow>>();
  for (const r of rows) {
    let m = out.get(r.offer_id);
    if (m === undefined) {
      m = new Map();
      out.set(r.offer_id, m);
    }
    m.set(r.basis_key, r);
  }
  return out;
}

export function recordRejectedRun(
  db: Db,
  storeId: string,
  observedAt: number | null,
  rawSha256: string | null,
  reason: unknown,
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    'INSERT INTO rejected_runs(store_id, observed_at, raw_sha256, reason_json, rejected_at) VALUES (?, ?, ?, ?, ?)',
  ).run(storeId, observedAt, rawSha256, canonicalJson(reason), now);
}

export type { NormalizedProduct };
