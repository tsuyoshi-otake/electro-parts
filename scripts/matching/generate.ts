import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ProductRelation, RelationProduct } from '../../userscript/core/relations.ts';
import { assertCatalog, discover, fingerprint, listingKey, pairId, type Catalog, type Family, type Listing, type Review } from './model.ts';
import { importCatalogs } from './catalogs.ts';

export function endpoint(p: Listing): RelationProduct {
  return { storeId: p.storeId, pageKey: p.pageKey, name: p.name, modelNumber: p.modelNumber, url: p.url,
    observedAt: p.observedAt, expectedNames: [p.name], expectedModels: p.expectedModels };
}
const order = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function generate(catalog: Catalog, legacy: readonly ProductRelation[], reviews: readonly Review[], families: readonly Family[]) {
  assertCatalog(catalog);
  const listings = new Map(catalog.listings.map(p => [listingKey(p), p]));
  const [left, right] = catalog.sources;
  if (!left || !right) throw new Error('two sources required');
  const candidates = discover(catalog.listings.filter(p => p.storeId === left.storeId), catalog.listings.filter(p => p.storeId === right.storeId));
  const candidateIndex = new Map(candidates.map(p => [p.id, p]));
  const reviewIndex = new Map<string, Review>();
  const relations = new Map<string, ProductRelation>();
  for (const relation of legacy) {
    if (relations.has(relation.id)) throw new Error(`duplicate legacy relation ${relation.id}`);
    for (const p of relation.products) {
      const source = listings.get(listingKey(p));
      if (!source || source.name !== p.name || source.modelNumber !== p.modelNumber || source.observedAt !== p.observedAt) throw new Error(`legacy source drift ${relation.id}`);
    }
    relations.set(relation.id, structuredClone(relation));
  }
  for (const review of reviews) {
    if (reviewIndex.has(review.id)) throw new Error(`duplicate review ${review.id}`);
    reviewIndex.set(review.id, review);
    const candidate = candidateIndex.get(review.id);
    if (!candidate || candidate.fingerprint !== review.fingerprint) throw new Error(`review is stale or orphaned: ${review.id}`);
    if (!['same_product', 'unresolved', 'rejected'].includes(review.decision) || review.evidence.length < 20 || !Number.isFinite(Date.parse(review.reviewedAt))) throw new Error(`review evidence required: ${review.id}`);
    if (review.decision === 'unresolved' && !review.missingEvidence.length) throw new Error(`unresolved review needs missing evidence: ${review.id}`);
    if (review.decision === 'rejected') { relations.delete(review.id); continue; }
    const old = relations.get(review.id);
    if (old?.pricePolicy && review.decision !== 'same_product') throw new Error(`price policy conflicts with review ${review.id}`);
    relations.set(review.id, {
      id: review.id, kind: review.decision, reviewStatus: review.decision === 'same_product' ? 'verified' : 'needs_review',
      products: old?.products ?? [endpoint(candidate.products[0]), endpoint(candidate.products[1])],
      evidence: review.evidence, differences: review.differences, missingEvidence: review.missingEvidence,
      reviewedAt: review.reviewedAt, provenance: old?.provenance ?? { method: 'catalog', model: null, originalClassification: 'same_product_candidate', originalReason: `indexed exact code: ${candidate.codes.join(', ')}` },
      pricePolicy: old?.pricePolicy ?? null,
    });
  }
  const familyIds = new Set<string>();
  const familyCounts: Record<string, number> = {};
  for (const family of families) {
    if (familyIds.has(family.id) || !family.purpose || family.members.length > 64 || !Number.isFinite(Date.parse(family.reviewedAt))) throw new Error(`invalid family ${family.id}`);
    for (const source of family.sources) {
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`unsafe family source ${family.id}`);
    }
    familyIds.add(family.id);
    const members = new Set<string>();
    const resolved = family.members.map(member => {
      const p = listings.get(member.key);
      if (members.has(member.key) || !p || fingerprint(p) !== member.fingerprint || !member.variant || !Object.keys(member.features).length
        || Object.values(member.features).some(v => typeof v !== 'string' || !v.trim())) throw new Error(`family member stale/invalid: ${family.id}/${member.key}`);
      members.add(member.key); return { ...member, listing: p };
    });
    familyCounts[family.id] = 0;
    // Bounded reviewed family blocks, not a catalogue-wide similarity cross join.
    for (const a of resolved.filter(m => m.listing.storeId === left.storeId)) for (const b of resolved.filter(m => m.listing.storeId === right.storeId)) {
      if (a.variant === b.variant) continue;
      const id = pairId(a.listing, b.listing);
      if (relations.has(id) || reviewIndex.get(id)?.decision === 'rejected') continue;
      const keys = [...new Set([...Object.keys(a.features), ...Object.keys(b.features)])].sort();
      if (keys.some(key => !a.features[key] || !b.features[key])) throw new Error(`incomplete feature schema ${family.id}`);
      const differences = keys.filter(key => a.features[key] !== b.features[key]).map(key => `${key}: ${a.features[key]} ↔ ${b.features[key]}`);
      if (!differences.length) throw new Error(`different variants need concrete differences: ${id}`);
      const common = keys.filter(key => a.features[key] === b.features[key]).map(key => `${key}: ${a.features[key]}`).join(' / ');
      relations.set(id, { id, kind: 'similar_product', reviewStatus: 'verified', products: [endpoint(a.listing), endpoint(b.listing)],
        evidence: `${family.label}。共通用途: ${family.purpose}。${common ? `共通仕様: ${common}。` : ''}登録した製品本体だけを照合し、周辺部品は含めない。`,
        differences, missingEvidence: ['互換性・置き換え時の配線/ソフトウェア・販売数量/付属品'], reviewedAt: family.reviewedAt,
        provenance: { method: 'catalog', model: null, originalClassification: 'reviewed_family', originalReason: family.id }, pricePolicy: null,
        similarity: { family: family.label, distance: differences.length }, evidenceUrls: family.sources,
      });
      familyCounts[family.id] = (familyCounts[family.id] ?? 0) + 1;
    }
  }
  const result = [...relations.values()].sort(order);
  const byBrand: Record<string, { candidates: number; accepted: number; unresolved: number; rejected: number; pending: number; sourceListings: number; unmatchedListings: number }> = {};
  for (const p of catalog.listings.filter(p => p.storeId === right.storeId)) {
    const brand = p.manufacturer || '(unknown)';
    byBrand[brand] ??= { candidates: 0, accepted: 0, unresolved: 0, rejected: 0, pending: 0, sourceListings: 0, unmatchedListings: 0 };
    byBrand[brand]!.sourceListings++;
  }
  const candidateListings = new Set(candidates.map(c => listingKey(c.products[1])));
  const allCandidateListings = new Set(candidates.flatMap(c => c.products.map(listingKey)));
  for (const p of catalog.listings.filter(p => p.storeId === right.storeId && !candidateListings.has(listingKey(p)))) byBrand[p.manufacturer || '(unknown)']!.unmatchedListings++;
  for (const c of candidates) {
    const row = byBrand[c.products[1].manufacturer || '(unknown)']!; row.candidates++;
    const decision = reviewIndex.get(c.id)?.decision;
    if (!decision) row.pending++; else if (decision === 'same_product') row.accepted++; else row[decision]++;
  }
  const report = { sources: catalog.sources, candidateCount: candidates.length, reviewedCount: reviews.length,
    pending: candidates.filter(c => !reviewIndex.has(c.id)).map(c => c.id),
    legacyCount: legacy.length, relations: result.length,
    sameVerified: result.filter(r => r.kind === 'same_product' && r.reviewStatus === 'verified').length,
    similarVerified: result.filter(r => r.kind === 'similar_product' && r.reviewStatus === 'verified').length,
    unresolved: result.filter(r => r.kind === 'unresolved').length,
    pricePolicies: result.filter(r => r.pricePolicy).length,
    familyCounts, byBrand: Object.fromEntries(Object.entries(byBrand).sort(([a], [b]) => a < b ? -1 : 1)),
    unmatchedByStore: Object.fromEntries(catalog.sources.map(source => [source.storeId,
      catalog.listings.filter(p => p.storeId === source.storeId && !allCandidateListings.has(listingKey(p))).length])),
    limitations: ['Only the two pinned saved catalogues are searched; other stores and missing catalogue entries are not covered.', 'Codes must contain a digit and have at least four characters. Numeric storefront SKUs are excluded; numeric manufacturer codes still require review for collisions.', 'Unmatched does not mean unrelated. Aliases and descriptions not present in these sources need further review.', 'Review is saved-catalogue identity review, not a live stock, compatibility or sales-condition assertion.'],
  };
  return { relations: result, candidates, report };
}

export function serializeRelations(relations: readonly ProductRelation[]): string {
  const products = new Map<string, RelationProduct>();
  for (const r of relations) for (const p of r.products) {
    const key = listingKey(p);
    const previous = products.get(key);
    // A listing can have additional already-reviewed spellings in a legacy price policy.
    products.set(key, previous ? { ...p, expectedNames: [...new Set([...previous.expectedNames, ...p.expectedNames])], expectedModels: [...new Set([...previous.expectedModels, ...p.expectedModels])] } : p);
  }
  const rows = relations.map(r => {
    const { products: endpoints, ...rest } = r;
    return `  { ...${JSON.stringify(rest)}, products: [p[${JSON.stringify(listingKey(endpoints[0]))}]!, p[${JSON.stringify(listingKey(endpoints[1]))}]!] },`;
  });
  return `// Generated by npm run matching:build. Edit data/matching reviews/families, not this file.\nimport type { ProductRelation, RelationProduct } from '../core/relations.ts';\n\nexport const STORE_LABELS: Readonly<Record<string, string>> = { 'akizuki': '秋月電子', 'switch-science': 'スイッチサイエンス' };\nconst p: Record<string, RelationProduct> = {\n${[...products].sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('\n')}\n};\nexport const PRODUCT_RELATIONS: readonly ProductRelation[] = [\n${rows.join('\n')}\n];\n`;
}

export const serializeCatalog = (catalog: Catalog): string => JSON.stringify({ schemaVersion: catalog.schemaVersion, sources: catalog.sources }) + '\n' + catalog.listings.map(p => JSON.stringify(p)).join('\n') + '\n';
export function parseCatalog(text: string): Catalog {
  const [header, ...rows] = text.trimEnd().split('\n');
  return { ...JSON.parse(header!), listings: rows.map(row => JSON.parse(row)) } as Catalog;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, discover: { type: 'boolean' }, 'import-left': { type: 'string' }, 'import-right': { type: 'string' } } });
  const dir = 'data/matching';
  if (values['import-left'] || values['import-right']) {
    if (!values['import-left'] || !values['import-right'] || values.check || values.discover) throw new Error('import requires both files and cannot use --check/--discover');
    const catalog = await importCatalogs([values['import-left'], values['import-right']]);
    await mkdir(dir, { recursive: true }); await writeFile(`${dir}/catalog.jsonl`, serializeCatalog(catalog));
    console.log(`Imported ${catalog.listings.length} source listings. Existing reviews must be revalidated before build.`); return;
  }
  const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, 'utf8')) as T;
  const catalog = parseCatalog(await readFile(`${dir}/catalog.jsonl`, 'utf8'));
  if (values.discover) {
    if (values.check) throw new Error('--discover and --check are separate operations');
    assertCatalog(catalog);
    const candidates = discover(catalog.listings.filter(p => p.storeId === catalog.sources[0]!.storeId), catalog.listings.filter(p => p.storeId === catalog.sources[1]!.storeId));
    await writeFile(`${dir}/candidates.jsonl`, serializeCandidates(candidates));
    console.log(`Discovered ${candidates.length} candidates from ${catalog.listings.length} listings. No reviews or runtime mappings were changed.`); return;
  }
  const result = generate(catalog, await read<ProductRelation[]>('legacy.json'), await read<Review[]>('reviews.json'), await read<Family[]>('families.json'));
  const artifacts = [
    ['userscript/adapters/productRelations.ts', serializeRelations(result.relations)],
    [`${dir}/coverage.json`, JSON.stringify(result.report, null, 2) + '\n'],
    [`${dir}/candidates.jsonl`, serializeCandidates(result.candidates)],
  ];
  for (const [file, content] of artifacts) {
    if (!file || content === undefined) throw new Error('invalid output');
    if (values.check) { if (await readFile(file, 'utf8') !== content) throw new Error(`generated output differs: ${file}; run npm run matching:build`); }
    else await writeFile(file, content);
  }
  console.log(JSON.stringify({ candidates: result.candidates.length, pending: result.report.pending.length, relations: result.relations.length, same: result.report.sameVerified, similar: result.report.similarVerified, pricePolicies: result.report.pricePolicies }));
}
function serializeCandidates(candidates: ReturnType<typeof discover>): string {
  return candidates.map(c => JSON.stringify({ id: c.id, codes: c.codes, fingerprint: c.fingerprint, products: c.products.map(listingKey) })).join('\n') + '\n';
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
