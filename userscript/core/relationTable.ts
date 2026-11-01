import type { ProductRelation, RelationProduct } from './relations.ts';

/**
 * Compact transport form of the reviewed relation table, decoded once per script.
 * Every string is interned in one table (most frequent first) and each endpoint is
 * stored once; rows refer to both by index. Decoding yields the same ProductRelation
 * objects the panel reads, so this format stays private to the generator and this module.
 */
type Text = number;
type PackedProduct = [storeId: Text, pageKey: Text, name: Text, modelNumber: Text, url: Text, observedAt: Text,
  expectedNames: Text[], expectedModels: Text[], offer?: [id: Text, sku: Text, name: Text] | null];
type PackedRelation = [id: Text, kind: Text, reviewStatus: Text, a: number, b: number, evidence: Text,
  differences: Text[], missingEvidence: Text[], reviewedAt: Text,
  provenance: [method: Text, model: Text | null, originalClassification: Text | null, originalReason: Text | null],
  similarity?: [family: Text, distance: number] | null, evidenceUrls?: Text[] | null, pricePolicy?: ProductRelation['pricePolicy']];
export interface PackedRelationTable { version: 1; strings: string[]; products: PackedProduct[]; relations: PackedRelation[] }

const KINDS = ['same_product', 'similar_product', 'unresolved'] as const;
const STATUSES = ['candidate', 'verified', 'needs_review'] as const;
const METHODS = ['catalog', 'retailer-pages'] as const;

/** Trailing absent fields are dropped; most rows have no family, source links or price policy. */
function trimmed<T extends unknown[]>(row: T): T {
  while (row.length && row[row.length - 1] == null) row.pop();
  return row;
}

export function packRelations(relations: readonly ProductRelation[]): PackedRelationTable {
  const endpointKey = (p: RelationProduct): string => JSON.stringify([p.storeId, p.pageKey, p.offer?.id ?? null]);
  const endpoints = new Map<string, RelationProduct>();
  for (const r of relations) for (const p of r.products) {
    const key = endpointKey(p);
    const previous = endpoints.get(key);
    // A listing can have additional already-reviewed spellings in a legacy price policy.
    endpoints.set(key, previous ? { ...p, expectedNames: [...new Set([...previous.expectedNames, ...p.expectedNames])], expectedModels: [...new Set([...previous.expectedModels, ...p.expectedModels])] } : p);
  }
  const products = [...endpoints].sort(([a], [b]) => a < b ? -1 : 1);
  const productIndex = new Map(products.map(([key], i) => [key, i]));
  const encode = (t: (s: string) => Text): Pick<PackedRelationTable, 'products' | 'relations'> => ({
    products: products.map(([, p]) => trimmed<PackedProduct>([t(p.storeId), t(p.pageKey), t(p.name), t(p.modelNumber), t(p.url), t(p.observedAt),
      p.expectedNames.map(t), p.expectedModels.map(t), p.offer ? [t(p.offer.id), t(p.offer.sku), t(p.offer.name)] : null])),
    relations: relations.map(r => {
      const nullable = (s: string | null): Text | null => s === null ? null : t(s);
      return trimmed<PackedRelation>([t(r.id), t(r.kind), t(r.reviewStatus), productIndex.get(endpointKey(r.products[0]))!, productIndex.get(endpointKey(r.products[1]))!,
        t(r.evidence), r.differences.map(t), r.missingEvidence.map(t), t(r.reviewedAt),
        [t(r.provenance.method), nullable(r.provenance.model), nullable(r.provenance.originalClassification), nullable(r.provenance.originalReason)],
        r.similarity ? [t(r.similarity.family), r.similarity.distance] : null, r.evidenceUrls ? r.evidenceUrls.map(t) : null, r.pricePolicy]);
    }),
  });
  // First pass counts, second pass writes indices; the stable sort keeps first-seen order among equal counts.
  const counts = new Map<string, number>();
  encode(s => { counts.set(s, (counts.get(s) ?? 0) + 1); return 0; });
  const strings = [...counts].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const index = new Map(strings.map((s, i) => [s, i]));
  return { version: 1, strings, ...encode(s => index.get(s)!) };
}

/** Fails at load on a malformed table instead of handing the panel undefined fields. */
export function unpackRelations(table: PackedRelationTable): ProductRelation[] {
  if (table.version !== 1) throw new Error(`relation table: unsupported version ${String(table.version)}`);
  const t = (i: Text): string => {
    const s = table.strings[i];
    if (typeof s !== 'string') throw new Error(`relation table: no string ${i}`);
    return s;
  };
  const nullable = (i: Text | null): string | null => i === null ? null : t(i);
  const member = <T extends string>(i: Text, allowed: readonly T[]): T => {
    const s = t(i);
    if (!(allowed as readonly string[]).includes(s)) throw new Error(`relation table: unexpected value ${s}`);
    return s as T;
  };
  const products = table.products.map(([storeId, pageKey, name, modelNumber, url, observedAt, names, models, offer]): RelationProduct => ({
    storeId: t(storeId), pageKey: t(pageKey), name: t(name), modelNumber: t(modelNumber), url: t(url), observedAt: t(observedAt),
    expectedNames: names.map(i => t(i)), expectedModels: models.map(i => t(i)),
    ...(offer ? { offer: { id: t(offer[0]), sku: t(offer[1]), name: t(offer[2]) } } : {}),
  }));
  const product = (i: number): RelationProduct => {
    const p = products[i];
    if (!p) throw new Error(`relation table: no product ${i}`);
    return p;
  };
  return table.relations.map(([id, kind, reviewStatus, a, b, evidence, differences, missingEvidence, reviewedAt, provenance, similarity, evidenceUrls, pricePolicy]): ProductRelation => ({
    id: t(id), kind: member(kind, KINDS), reviewStatus: member(reviewStatus, STATUSES), products: [product(a), product(b)],
    evidence: t(evidence), differences: differences.map(i => t(i)), missingEvidence: missingEvidence.map(i => t(i)), reviewedAt: t(reviewedAt),
    ...(similarity ? { similarity: { family: t(similarity[0]), distance: similarity[1] } } : {}),
    ...(evidenceUrls ? { evidenceUrls: evidenceUrls.map(i => t(i)) } : {}),
    provenance: { method: member(provenance[0], METHODS), model: nullable(provenance[1]), originalClassification: nullable(provenance[2]), originalReason: nullable(provenance[3]) },
    pricePolicy: pricePolicy ?? null,
  }));
}
