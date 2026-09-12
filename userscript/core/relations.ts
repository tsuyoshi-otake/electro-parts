import type { OfferV1, ProductFileV1, SegmentV1 } from '../../src/publisher/contract.ts';
import type { LoadState } from './dataClient.ts';

/** Curated evidence, not a live similarity search. Store knowledge is injected. */
export interface RelationProduct {
  storeId: string;
  pageKey: string;
  name: string;
  modelNumber: string;
  url: string;
  observedAt: string;
  /** Exact known metadata spellings. Never strip revision/configuration suffixes. */
  expectedNames: readonly string[];
  expectedModels: readonly string[];
  /** Reviewed selling variant; an absent or changed variant never falls back. */
  offer?: { id: string; sku: string; name: string };
}

export interface ProductRelation {
  id: string;
  kind: 'same_product' | 'similar_product' | 'unresolved';
  reviewStatus: 'candidate' | 'verified' | 'needs_review';
  products: readonly [RelationProduct, RelationProduct];
  evidence: string;
  differences: readonly string[];
  missingEvidence: readonly string[];
  reviewedAt: string;
  /** Reviewed family distance, for stable closest-first display only; not identity confidence. */
  similarity?: { family: string; distance: number };
  evidenceUrls?: readonly string[];
  provenance: { method: 'catalog' | 'retailer-pages'; model: string | null; originalClassification: string | null; originalReason: string | null };
  /** Null means reference prices only, even when the underlying product is the same. */
  pricePolicy: null | {
    label: string;
    /** Labels allowed in each endpoint's published primary selling quote. Null requires explicit package evidence. */
    units: readonly [readonly (string | null)[], readonly (string | null)[]];
    offerIds: readonly [string, string];
    evidence: string;
    verifiedAt: string;
  };
}

export interface RelatedEntry {
  relation: ProductRelation;
  sourceIndex: 0 | 1;
  target: RelationProduct;
  state: LoadState | { kind: 'reference_only' };
}

/** Per page, beyond the current product; all remaining relation links still render. */
export const MAX_RELATED_HISTORY_LOADS = 8;

export const relationProductKey = (storeId: string, pageKey: string): string => JSON.stringify([storeId, pageKey]);

/** O(R) once per script, then O(1 + matches) per page, not a catalogue cross join. */
export function indexRelations(relations: readonly ProductRelation[]): ReadonlyMap<string, readonly ProductRelation[]> {
  const index = new Map<string, ProductRelation[]>();
  for (const relation of relations) {
    for (const product of relation.products) {
      const key = relationProductKey(product.storeId, product.pageKey);
      const group = index.get(key) ?? [];
      group.push(relation);
      index.set(key, group);
    }
  }
  return index;
}

export function relatedEntries(relations: readonly ProductRelation[], storeId: string, pageKey: string): RelatedEntry[] {
  const key = relationProductKey(storeId, pageKey);
  const rank = (r: ProductRelation): number => r.kind === 'same_product' ? r.reviewStatus === 'verified' ? 0 : 1 : r.kind === 'similar_product' ? 2 : 3;
  const ordered = [...relations].sort((a, b) => rank(a) - rank(b)
    || (a.similarity?.distance ?? a.differences.length) - (b.similarity?.distance ?? b.differences.length)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const loading = new Set<string>();
  return ordered.flatMap((relation): RelatedEntry[] => {
    const i = relation.products.findIndex((p) => relationProductKey(p.storeId, p.pageKey) === key);
    if (i !== 0 && i !== 1) return [];
    const target = relation.products[i === 0 ? 1 : 0];
    const targetKey = relationProductKey(target.storeId, target.pageKey);
    if (loading.size < MAX_RELATED_HISTORY_LOADS) loading.add(targetKey);
    return [{ relation, sourceIndex: i, target, state: { kind: loading.has(targetKey) ? 'loading' : 'reference_only' } }];
  });
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** A reviewed URL is not a timeless identity: metadata drift suspends automatic comparison. */
export function matchesRelationProduct(ref: RelationProduct, product: ProductFileV1): boolean {
  const current = product.product.current;
  return product.storeId === ref.storeId && product.pageKey === ref.pageKey
    && ref.expectedNames.some((name) => normalized(name) === normalized(current.name))
    && ref.expectedModels.some((model) => normalized(model) === normalized(current.modelNumber ?? ''))
    && !product.product.metadata.some((point) => point.suspicious)
    && (!ref.offer || product.offers.some(o => o.externalOfferId === ref.offer!.id && o.sku === ref.offer!.sku));
}

export function primaryQuote(product: ProductFileV1, ref?: RelationProduct): { offer: OfferV1; segment: SegmentV1 } | null {
  const offer = ref?.offer ? product.offers.find(o => o.externalOfferId === ref.offer!.id && o.sku === ref.offer!.sku) : currentOffer(product);
  const segment = offer?.segments.find((s) => s.primary) ?? offer?.segments[0];
  return offer && segment ? { offer, segment } : null;
}

function presentAtEnd(points: readonly [number, 0 | 1][]): boolean {
  return points[points.length - 1]?.[1] === 1;
}

/** Current offer first; for an unlisted product, the most recently listed offer. */
export function currentOffer(product: ProductFileV1): OfferV1 | null {
  const present = product.offers.filter((offer) => presentAtEnd(offer.presence));
  if (present.length > 0) return present[0] ?? null;
  return [...product.offers].sort((a, b) => {
    const lastPresent = (offer: OfferV1) => [...offer.presence].reverse().find((point) => point[1] === 1)?.[0] ?? Number.NEGATIVE_INFINITY;
    return lastPresent(b) - lastPresent(a) || a.externalOfferId.localeCompare(b.externalOfferId);
  })[0] ?? null;
}

export type ComparisonEligibility = { comparable: false; reason: string } | { comparable: true; other: SegmentV1; label: string; differenceMinor: number | null };

/** Fail closed for arithmetic/overlays; links and labelled reference prices still work. */
export function comparisonEligibility(current: ProductFileV1, segment: SegmentV1, entry: RelatedEntry): ComparisonEligibility {
  const reject = (reason: string): ComparisonEligibility => ({ comparable: false, reason });
  const { relation, sourceIndex, state } = entry;
  if (relation.kind !== 'same_product') return reject(relation.kind === 'similar_product' ? '類似商品・互換性は未確認' : '商品同一性を要確認');
  if (relation.reviewStatus !== 'verified') return reject('同一商品候補・照合未確定');
  if (state.kind !== 'ready') return reject(state.kind === 'loading' ? '他店の記録を読み込み中' : '他店の価格記録を取得できません');
  if (!matchesRelationProduct(relation.products[sourceIndex], current) || !matchesRelationProduct(entry.target, state.product)) return reject('登録時から商品情報が変わったため再確認が必要');
  if (relation.pricePolicy === null) return reject('販売単位・付属品等の比較条件が未確認');
  const otherProduct = state.product;
  const own = primaryQuote(current);
  const other = primaryQuote(otherProduct);
  const currentOffers = current.offers.filter((offer) => presentAtEnd(offer.presence));
  const otherCurrentOffers = otherProduct.offers.filter((offer) => presentAtEnd(offer.presence));
  if (currentOffers.length !== 1 || otherCurrentOffers.length !== 1 || !own || !other || own.segment !== segment) return reject('バリエーション・価格の種類が異なるため参考表示');
  if (!current.product.listed || !otherProduct.product.listed || !presentAtEnd(own.offer.presence) || !presentAtEnd(other.offer.presence)
    || !presentAtEnd(segment.presence) || !presentAtEnd(other.segment.presence)) return reject('最新の観測では掲載されていない価格です');
  const basis = segment.basis;
  const targetBasis = other.segment.basis;
  const policy = relation.pricePolicy;
  if (own.offer.externalOfferId !== policy.offerIds[sourceIndex] || other.offer.externalOfferId !== policy.offerIds[sourceIndex === 0 ? 1 : 0]) return reject('販売バリエーションが確認時から変わっています');
  if (basis.currency !== targetBasis.currency || basis.taxTreatment !== 'tax_included' || targetBasis.taxTreatment !== 'tax_included'
    || basis.quoteKind !== 'selling' || targetBasis.quoteKind !== 'selling'
    || !policy.units[sourceIndex].includes(basis.unitLabel) || !policy.units[sourceIndex === 0 ? 1 : 0].includes(targetBasis.unitLabel)) return reject('通貨・税・販売単位が確認済み条件と一致しません');
  // Periodic reviews are required even if the listing silently kept its name.
  const verifiedAt = Date.parse(policy.verifiedAt);
  const newestObservation = Math.max(current.observation.latestObservedAt ?? Infinity, otherProduct.observation.latestObservedAt ?? Infinity);
  if (!Number.isFinite(verifiedAt) || newestObservation > verifiedAt + 90 * 86_400_000) return reject('販売条件の確認期限を過ぎたため参考表示');
  if (state.freshness === 'stale' || state.note !== null) return reject('他店データの更新確認ができないため参考表示');
  const a = segment.stats.current;
  const b = other.segment.stats.current;
  return {
    comparable: true, other: other.segment, label: policy.label,
    differenceMinor: a.state === 'exact' && b.state === 'exact' && a.minAmountMinor !== null && b.minAmountMinor !== null ? b.minAmountMinor - a.minAmountMinor : null,
  };
}
