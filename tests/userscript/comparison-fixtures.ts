import type { ProductRelation, RelatedEntry } from '../../userscript/core/relations.ts';
import { sampleProduct } from './helpers.ts';

export function comparisonFixture() {
  const current = sampleProduct();
  const other = sampleProduct({ storeId: 'otherstore', pageKey: 'P2', externalProductId: 'P2' });
  other.product.current.canonicalUrl = 'https://other.example.test/p/P2';
  const otherSegment = other.offers[0]!.segments[0]!;
  otherSegment.stats.current = { state: 'exact', minAmountMinor: 1500, maxAmountMinor: 1500 };
  otherSegment.points[1] = [otherSegment.points[1]![0], 'exact', 1500, 1500];
  const ref = (p: typeof current) => ({ storeId: p.storeId, pageKey: p.pageKey, name: p.product.current.name, modelNumber: p.product.current.modelNumber!,
    url: p.product.current.canonicalUrl, observedAt: '2026-09-06T09:54:15.029Z', expectedNames: [p.product.current.name], expectedModels: [p.product.current.modelNumber!] });
  const relation: ProductRelation = {
    id: 'example-pair', kind: 'same_product', reviewStatus: 'verified', products: [ref(current), ref(other)], evidence: 'Both manufacturer codes and packaged contents verified.',
    differences: [], missingEvidence: [], reviewedAt: '2026-09-07', provenance: { method: 'retailer-pages', model: null, originalClassification: null, originalReason: null },
    pricePolicy: { label: '1個・税込', units: [['1個'], ['1個']], offerIds: ['__default__', '__default__'], evidence: 'Both stores sell one unit.', verifiedAt: '2026-09-07' },
  };
  const entry: RelatedEntry = { relation, sourceIndex: 0, target: relation.products[1], state: { kind: 'ready', product: other, manifest: null, freshness: 'fresh', storedAt: 1, note: null } };
  return { current, other, segment: current.offers[0]!.segments[0]!, otherSegment, relation, entry };
}
