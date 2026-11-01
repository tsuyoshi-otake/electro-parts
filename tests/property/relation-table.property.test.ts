/**
 * Properties of the packed relation table that the generator embeds in the bundle.
 *
 * The panel reads ProductRelation objects; the packed form is only transport. So the
 * contract is that the generated source text, once evaluated and decoded, yields the
 * relations it was made from: any text survives the string table and the template
 * literal, shared endpoints stay one object, and a malformed table fails at load.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serializeRelations } from '../../scripts/matching/generate.ts';
import type { ProductRelation, RelationProduct } from '../../userscript/core/relations.ts';
import { packRelations, unpackRelations, type PackedRelationTable } from '../../userscript/core/relationTable.ts';

const seed = Number(process.env['FC_SEED'] ?? 20261101);
const numRuns = Number(process.env['FC_RUNS'] ?? 200);
const opts = { seed, numRuns } as const;

/** Text that is hard for the embedding: escapes, template syntax, line separators, any code point. */
const textArb = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 12 }),
  fc.array(fc.constantFrom('\\', '`', '${', '$', '{', "'", '"', ' ', ' ', '\n', '\\u0041', '秋'), { maxLength: 6 }).map(parts => parts.join('')),
);
const nullableTextArb = fc.option(textArb, { nil: null });

const productArb: fc.Arbitrary<RelationProduct> = fc.record({
  storeId: textArb, pageKey: textArb, name: textArb, modelNumber: textArb, url: textArb, observedAt: textArb,
  expectedNames: fc.uniqueArray(textArb, { maxLength: 3 }), expectedModels: fc.uniqueArray(textArb, { maxLength: 3 }),
  offer: fc.record({ id: textArb, sku: textArb, name: textArb }, { noNullPrototype: true }),
}, { noNullPrototype: true, requiredKeys: ['storeId', 'pageKey', 'name', 'modelNumber', 'url', 'observedAt', 'expectedNames', 'expectedModels'] });

/** Endpoints are unique by store, page and variant, as in generated relations; rows pick two of them. */
const relationsArb: fc.Arbitrary<ProductRelation[]> = fc.uniqueArray(productArb, { minLength: 1, maxLength: 6, selector: p => JSON.stringify([p.storeId, p.pageKey, p.offer?.id ?? null]) })
  .chain(products => fc.array(fc.record({
    id: textArb,
    kind: fc.constantFrom('same_product', 'similar_product', 'unresolved'),
    reviewStatus: fc.constantFrom('candidate', 'verified', 'needs_review'),
    products: fc.tuple(fc.constantFrom(...products), fc.constantFrom(...products)),
    evidence: textArb, differences: fc.array(textArb, { maxLength: 3 }), missingEvidence: fc.array(textArb, { maxLength: 3 }), reviewedAt: textArb,
    similarity: fc.record({ family: textArb, distance: fc.integer({ min: 0, max: 9 }) }, { noNullPrototype: true }),
    evidenceUrls: fc.array(textArb, { maxLength: 2 }),
    provenance: fc.record({ method: fc.constantFrom('catalog', 'retailer-pages'), model: nullableTextArb, originalClassification: nullableTextArb, originalReason: nullableTextArb }, { noNullPrototype: true }),
    pricePolicy: fc.option(fc.record({
      label: textArb, units: fc.tuple(fc.array(nullableTextArb, { maxLength: 2 }), fc.array(nullableTextArb, { maxLength: 2 })),
      offerIds: fc.tuple(textArb, textArb), evidence: textArb, verifiedAt: textArb,
    }, { noNullPrototype: true }), { nil: null }),
  }, { noNullPrototype: true, requiredKeys: ['id', 'kind', 'reviewStatus', 'products', 'evidence', 'differences', 'missingEvidence', 'reviewedAt', 'provenance', 'pricePolicy'] }), { maxLength: 8 }));

/** Evaluates the generated module's template literal the way the bundle does. */
function decodeGenerated(source: string): ProductRelation[] {
  const start = source.indexOf('JSON.parse(`') + 'JSON.parse(`'.length;
  const end = source.lastIndexOf('`) as PackedRelationTable');
  const text = new Function(`return \`${source.slice(start, end)}\`;`)() as string;
  return unpackRelations(JSON.parse(text) as PackedRelationTable);
}

describe('packed relation table', () => {
  it('decodes generated source text back to the relations it was made from', () => {
    fc.assert(fc.property(relationsArb, relations => {
      expect(decodeGenerated(serializeRelations(relations))).toStrictEqual(relations);
    }), opts);
  });

  it('keeps one object per endpoint and stores each string once', () => {
    fc.assert(fc.property(relationsArb, relations => {
      const table = packRelations(relations);
      expect(new Set(table.strings).size).toBe(table.strings.length);
      const decoded = unpackRelations(table);
      expect(new Set(decoded.flatMap(r => r.products)).size).toBe(new Set(relations.flatMap(r => r.products)).size);
    }), opts);
  });

  it('merges reviewed spellings of one endpoint used by several relations', () => {
    const base: Omit<ProductRelation, 'id' | 'products'> = { kind: 'same_product', reviewStatus: 'verified', evidence: 'e', differences: [], missingEvidence: [], reviewedAt: '2026-11-01',
      provenance: { method: 'catalog', model: null, originalClassification: null, originalReason: null }, pricePolicy: null };
    const endpoint = (names: string[]): RelationProduct => ({ storeId: 'a', pageKey: '1', name: 'N', modelNumber: 'M', url: 'https://example.test/1', observedAt: 't', expectedNames: names, expectedModels: ['M'] });
    const other = (pageKey: string): RelationProduct => ({ ...endpoint(['O']), storeId: 'b', pageKey });
    const [first, second] = unpackRelations(packRelations([{ ...base, id: 'x', products: [endpoint(['N']), other('2')] }, { ...base, id: 'y', products: [endpoint(['N', 'Old N']), other('3')] }]));
    expect(first!.products[0]).toBe(second!.products[0]);
    expect(first!.products[0].expectedNames).toEqual(['N', 'Old N']);
  });

  it('fails at load on an unknown version, a missing string or product, or an unexpected kind', () => {
    const table = packRelations([{ id: 'x', kind: 'unresolved', reviewStatus: 'needs_review', evidence: 'e', differences: [], missingEvidence: [], reviewedAt: 'd',
      products: [{ storeId: 'a', pageKey: '1', name: 'n', modelNumber: 'm', url: 'u', observedAt: 'o', expectedNames: [], expectedModels: [] }, { storeId: 'b', pageKey: '2', name: 'n', modelNumber: 'm', url: 'u', observedAt: 'o', expectedNames: [], expectedModels: [] }],
      provenance: { method: 'catalog', model: null, originalClassification: null, originalReason: null }, pricePolicy: null }]);
    expect(unpackRelations(table)).toHaveLength(1);
    expect(() => unpackRelations({ ...table, version: 2 as 1 })).toThrow('unsupported version');
    expect(() => unpackRelations({ ...table, strings: table.strings.slice(0, 1) })).toThrow('no string');
    expect(() => unpackRelations({ ...table, products: table.products.slice(0, 1) })).toThrow('no product');
    expect(() => unpackRelations({ ...table, strings: table.strings.map(s => s === 'unresolved' ? 'other' : s) })).toThrow('unexpected value other');
  });
});
