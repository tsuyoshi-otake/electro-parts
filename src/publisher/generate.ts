import type { StoreCapabilities } from '../core/capabilities.ts';
import { sha256Hex, canonicalJson } from '../core/hash.ts';
import { stateAt, type ChangePoint } from '../core/history.ts';
import { isSafeKey } from '../core/identity.ts';
import type { PricePoint } from '../core/price.ts';
import { computeSegmentStats, windowStats } from '../core/stats.ts';
import type { BasisHistory, OfferHistory, ProductHistory, StoreHistory } from '../db/read.ts';
import {
  CONTRACT_VERSION,
  PRODUCT_PATH_TEMPLATE,
  type CaveatKey,
  type ManifestV1,
  type ObservationCadence,
  type OfferV1,
  type PresencePointV1,
  type PriceValueV1,
  type ProductFileV1,
  type SegmentStatsV1,
  type SegmentV1,
} from './contract.ts';

export interface GenerateOptions {
  /** ISO timestamp stamped into every file; does not affect `datasetVersion`. */
  generatedAt: string;
  sqliteSchemaVersion: number;
  /** Source snapshot schema version of the latest run, for the manifest. */
  sourceSchemaVersion: string | null;
  /** Most recent inventory points kept per offer. */
  inventoryPointLimit?: number;
  /** How often this store is observed; selects the sampling caveat. Default monthly. */
  observationCadence?: ObservationCadence;
}

export interface StoreDataset {
  manifest: ManifestV1;
  products: ProductFileV1[];
}

export const DEFAULT_INVENTORY_POINT_LIMIT = 730;

const DAY_MS = 86_400_000;

/**
 * Identifies one publication. Derived from the imported runs only, so two
 * generations from the same database agree and any new run changes it.
 */
export function datasetVersionOf(history: Pick<StoreHistory, 'storeId' | 'runs'>): string {
  const runs = history.runs.map((r) => [r.observedAt, r.normalizedHash]);
  return sha256Hex(canonicalJson({ contract: CONTRACT_VERSION, storeId: history.storeId, runs })).slice(0, 16);
}

/** Pure, deterministic transformation of a store history into contract v1 files. */
export function generateStoreDataset(history: StoreHistory, options: GenerateOptions): StoreDataset {
  const limit = options.inventoryPointLimit ?? DEFAULT_INVENTORY_POINT_LIMIT;
  const datasetVersion = datasetVersionOf(history);
  const runs = history.runs;
  const first = runs[0];
  const latest = runs[runs.length - 1];
  const observation = {
    runCount: runs.length,
    firstObservedAt: first?.observedAt ?? null,
    latestObservedAt: latest?.observedAt ?? null,
  };
  const latestObservedAt = latest?.observedAt ?? 0;

  const storeCaveats = storeLevelCaveats(history.capabilities, options.observationCadence ?? 'monthly');
  const seenPageKeys = new Set<string>();
  const products: ProductFileV1[] = [];
  for (const product of history.products) {
    if (!isSafeKey(product.pageKey) || !isSafeKey(product.externalProductId)) {
      throw new Error(`unsafe key for product ${product.externalProductId} (page key ${product.pageKey})`);
    }
    if (seenPageKeys.has(product.pageKey)) {
      throw new Error(`page key ${product.pageKey} maps to more than one product; the contract publishes one file per page key`);
    }
    seenPageKeys.add(product.pageKey);
    products.push(
      generateProductFile(product, {
        storeId: history.storeId,
        capabilities: history.capabilities,
        datasetVersion,
        generatedAt: options.generatedAt,
        observation,
        latestObservedAt,
        inventoryPointLimit: limit,
      }),
    );
  }
  products.sort((a, b) => (a.pageKey < b.pageKey ? -1 : a.pageKey > b.pageKey ? 1 : 0));

  const manifest: ManifestV1 = {
    contractVersion: CONTRACT_VERSION,
    storeId: history.storeId,
    datasetVersion,
    generatedAt: options.generatedAt,
    capabilities: history.capabilities,
    observation: { ...observation, latestCoverageId: latest?.coverageId ?? null },
    productCount: products.length,
    productPathTemplate: PRODUCT_PATH_TEMPLATE,
    versions: { contract: CONTRACT_VERSION, sqliteSchema: options.sqliteSchemaVersion, sourceSchema: options.sourceSchemaVersion },
    caveats: storeCaveats,
  };
  return { manifest, products };
}

interface ProductContext {
  storeId: string;
  capabilities: StoreCapabilities;
  datasetVersion: string;
  generatedAt: string;
  observation: ProductFileV1['observation'];
  latestObservedAt: number;
  inventoryPointLimit: number;
}

function storeLevelCaveats(capabilities: StoreCapabilities, cadence: ObservationCadence): CaveatKey[] {
  const caveats: CaveatKey[] = [
    'observation_window',
    cadence === 'weekly' ? 'sampling_interval_weekly' : 'sampling_interval',
    'absence_not_discontinued',
  ];
  if (capabilities.supportsInventoryQuantity) {
    caveats.push(capabilities.inventoryQuantitySemantics === 'site_reported' ? 'site_reported_quantity' : 'quantity_semantics_unknown');
  }
  return caveats;
}

function presenceV1(series: readonly ChangePoint<boolean>[]): PresencePointV1[] {
  return series.map((p) => [p.t, p.state ? 1 : 0]);
}

function priceValue(p: PricePoint): PriceValueV1 {
  return { state: p.state, minAmountMinor: p.minAmountMinor, maxAmountMinor: p.maxAmountMinor };
}

function segmentStats(basis: BasisHistory, latestObservedAt: number): SegmentStatsV1 {
  const stats = computeSegmentStats(basis.prices);
  if (stats === null) throw new Error(`price basis ${basis.priceBasisId} has no price points`);
  const window = (days: number) => windowStats(basis.prices, basis.presence, latestObservedAt - days * DAY_MS, latestObservedAt);
  return {
    current: priceValue(stats.current),
    currentSinceAt: stats.currentSinceAt,
    previousDistinct: stats.previousDistinct === null ? null : priceValue(stats.previousDistinct),
    change: stats.change,
    observedMinMinor: stats.observedMinMinor,
    observedMaxMinor: stats.observedMaxMinor,
    segmentStartAt: stats.segmentStartAt,
    changePointCount: stats.changePointCount,
    windows: { d30: window(30), d90: window(90), d365: window(365) },
  };
}

/** Index of the segment the UI shows first, or -1. */
export function primarySegmentIndex(bases: readonly BasisHistory[], capabilities: StoreCapabilities, latestObservedAt: number): number {
  let best = -1;
  let bestScore: [number, number] | null = null;
  bases.forEach((b, i) => {
    if (b.basis.quoteKind !== capabilities.primaryQuote.quoteKind || b.basis.taxTreatment !== capabilities.primaryQuote.taxTreatment) return;
    const listedNow = (stateAt(b.presence, latestObservedAt) ?? false) ? 1 : 0;
    const lastListedAt = [...b.presence].reverse().find((p) => p.state)?.t ?? 0;
    const score: [number, number] = [listedNow, lastListedAt];
    if (bestScore === null || score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

function offerV1(offer: OfferHistory, ctx: ProductContext): OfferV1 {
  const primary = primarySegmentIndex(offer.bases, ctx.capabilities, ctx.latestObservedAt);
  const segments: SegmentV1[] = offer.bases.map((b, i) => ({
    basis: b.basis,
    primary: i === primary,
    presence: presenceV1(b.presence),
    points: b.prices.map((p) => [p.t, p.state.state, p.state.minAmountMinor, p.state.maxAmountMinor]),
    stats: segmentStats(b, ctx.latestObservedAt),
  }));
  const inventoryTotal = offer.inventory.length;
  const kept = inventoryTotal > ctx.inventoryPointLimit ? offer.inventory.slice(inventoryTotal - ctx.inventoryPointLimit) : offer.inventory;
  const semantics =
    [...offer.availability].reverse().find((a) => a.state.quantitySemantics !== 'unknown')?.state.quantitySemantics ??
    ctx.capabilities.inventoryQuantitySemantics;
  return {
    externalOfferId: offer.externalOfferId,
    offerKind: offer.offerKind,
    sku: offer.sku,
    variantName: offer.variantName,
    presence: presenceV1(offer.presence),
    segments,
    availability: offer.availability.map((a) => [a.t, a.state.state, a.state.purchasable, a.state.quantitySemantics, a.state.rawStatus]),
    inventory: {
      semantics,
      points: kept.map((p) => [p.t, p.state]),
      truncated: kept.length < inventoryTotal,
      totalPoints: inventoryTotal,
    },
  };
}

function generateProductFile(product: ProductHistory, ctx: ProductContext): ProductFileV1 {
  const lastMeta = product.metadata[product.metadata.length - 1];
  if (lastMeta === undefined) throw new Error(`product ${product.externalProductId} has no metadata`);
  const caveats: CaveatKey[] = [];
  if (product.metadata.some((m) => m.state.suspicious)) caveats.push('suspicious_identity');
  return {
    contractVersion: CONTRACT_VERSION,
    datasetVersion: ctx.datasetVersion,
    storeId: ctx.storeId,
    pageKey: product.pageKey,
    externalProductId: product.externalProductId,
    generatedAt: ctx.generatedAt,
    observation: ctx.observation,
    product: {
      firstSeenAt: product.firstSeenAt,
      lastSeenAt: product.lastSeenAt,
      listed: stateAt(product.presence, ctx.latestObservedAt) ?? false,
      aliases: product.aliases.map((a) => ({ kind: a.kind, value: a.value })),
      presence: presenceV1(product.presence),
      metadata: product.metadata.map((m) => ({
        t: m.t,
        name: m.state.name,
        modelNumber: m.state.modelNumber,
        category: m.state.category,
        canonicalUrl: m.state.canonicalUrl,
        suspicious: m.state.suspicious,
      })),
      current: {
        name: lastMeta.state.name,
        modelNumber: lastMeta.state.modelNumber,
        category: lastMeta.state.category,
        canonicalUrl: lastMeta.state.canonicalUrl,
      },
    },
    offers: product.offers.map((o) => offerV1(o, ctx)),
    caveats,
  };
}
