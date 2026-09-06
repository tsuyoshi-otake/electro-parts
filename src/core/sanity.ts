import type { NormalizedSnapshot } from './domain.ts';
import { basisKey, basisOf, pricePointKey, pricePointOf } from './price.ts';
import type { ValidationResult } from './validation.ts';

/**
 * Store-neutral sanity checks that compare a validated snapshot against the
 * previous accepted snapshot of the same store. They exist because a crawl can
 * report `complete: true` and still be wrong (parser drift, partial catalog).
 * Any breach quarantines the snapshot; thresholds are configurable.
 */
export interface SanityThresholds {
  /** Quarantine when item count drops by more than this ratio (0.2 = 20 %). */
  maxItemCountDropRatio: number;
  /** Quarantine when more than this ratio of previously seen products vanished. */
  maxMissingProductRatio: number;
  /** Quarantine when more than this ratio of common products changed primary price. */
  maxPriceChangeRatio: number;
  /** Quarantine when more than this ratio of products have an unavailable primary price. */
  maxUnavailablePriceRatio: number;
}

export const DEFAULT_SANITY_THRESHOLDS: SanityThresholds = {
  maxItemCountDropRatio: 0.2,
  maxMissingProductRatio: 0.2,
  maxPriceChangeRatio: 0.3,
  maxUnavailablePriceRatio: 0.5,
};

/** What the sanity check needs to know about the previous accepted snapshot. */
export interface PreviousSnapshotSummary {
  observedAt: string;
  coverageId: string;
  itemCount: number;
  /** externalProductId -> primary price key (basis + point) of the primary offer/basis */
  primaryPriceByProduct: Map<string, string>;
}

export function summarizeForSanity(snapshot: NormalizedSnapshot): PreviousSnapshotSummary {
  const map = new Map<string, string>();
  for (const p of snapshot.products) {
    // Deterministic choice that the database reader reproduces: the offer
    // with the smallest external id, then the quote with the smallest basis key.
    const offer = [...p.offers].sort((a, b) => (a.externalOfferId < b.externalOfferId ? -1 : a.externalOfferId > b.externalOfferId ? 1 : 0))[0];
    const keyed = (offer?.priceQuotes ?? []).map((q) => ({ q, k: basisKey(basisOf(q)) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    const quote = keyed[0];
    if (quote) map.set(p.externalProductId, `${quote.k}|${pricePointKey(pricePointOf(quote.q))}`);
  }
  return {
    observedAt: snapshot.observedAt,
    coverageId: snapshot.coverageId,
    itemCount: snapshot.products.length,
    primaryPriceByProduct: map,
  };
}

export function sanityCheck(
  current: NormalizedSnapshot,
  previous: PreviousSnapshotSummary | null,
  thresholds: SanityThresholds = DEFAULT_SANITY_THRESHOLDS,
): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [], metrics: {} };
  const currentCount = current.products.length;
  result.metrics['itemCount'] = currentCount;

  let unavailable = 0;
  for (const p of current.products) {
    const q = p.offers[0]?.priceQuotes[0];
    if (!q || q.state === 'unavailable') unavailable += 1;
  }
  result.metrics['unavailablePriceCount'] = unavailable;
  if (currentCount > 0 && unavailable / currentCount > thresholds.maxUnavailablePriceRatio) {
    result.errors.push({
      code: 'sanity.unavailable_price_ratio',
      message: `${unavailable}/${currentCount} products have no usable price`,
    });
  }

  if (previous === null) return result;

  if (previous.coverageId !== current.coverageId) {
    result.warnings.push({
      code: 'sanity.coverage_changed',
      message: `coverage changed from ${previous.coverageId} to ${current.coverageId}; missing-product statistics are not comparable`,
    });
    return result;
  }

  if (previous.itemCount > 0) {
    const drop = (previous.itemCount - currentCount) / previous.itemCount;
    result.metrics['itemCountDropRatio'] = round4(drop);
    if (drop > thresholds.maxItemCountDropRatio) {
      result.errors.push({
        code: 'sanity.item_count_drop',
        message: `item count dropped from ${previous.itemCount} to ${currentCount} (${pct(drop)})`,
      });
    }
  }

  const currentIds = new Set(current.products.map((p) => p.externalProductId));
  let missing = 0;
  let common = 0;
  let changed = 0;
  const currentSummary = summarizeForSanity(current);
  for (const [id, prevKey] of previous.primaryPriceByProduct) {
    if (!currentIds.has(id)) {
      missing += 1;
      continue;
    }
    common += 1;
    if (currentSummary.primaryPriceByProduct.get(id) !== prevKey) changed += 1;
  }
  let added = 0;
  for (const id of currentIds) if (!previous.primaryPriceByProduct.has(id)) added += 1;
  result.metrics['missingProducts'] = missing;
  result.metrics['newProducts'] = added;
  result.metrics['commonProducts'] = common;
  result.metrics['primaryPriceChanges'] = changed;

  if (previous.itemCount > 0) {
    const missingRatio = missing / previous.itemCount;
    result.metrics['missingProductRatio'] = round4(missingRatio);
    if (missingRatio > thresholds.maxMissingProductRatio) {
      result.errors.push({
        code: 'sanity.missing_product_ratio',
        message: `${missing}/${previous.itemCount} previously seen products are missing (${pct(missingRatio)})`,
      });
    }
  }
  if (common > 0) {
    const changeRatio = changed / common;
    result.metrics['priceChangeRatio'] = round4(changeRatio);
    if (changeRatio > thresholds.maxPriceChangeRatio) {
      result.errors.push({
        code: 'sanity.price_change_ratio',
        message: `${changed}/${common} common products changed price (${pct(changeRatio)})`,
      });
    }
  }
  return result;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
