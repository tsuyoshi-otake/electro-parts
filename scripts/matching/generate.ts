import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ProductRelation, RelationProduct } from '../../userscript/core/relations.ts';
import { packRelations } from '../../userscript/core/relationTable.ts';
import { assertCatalog, catalogStores, discover, discoverCatalog, fingerprint, hash, listingKey, normalizeCode, pairId, usefulCode, type Alias, type Catalog, type Dismissal, type ExtraKeys, type Family, type Listing, type Review } from './model.ts';
import { importCatalogs, appendStore, applySupplements, derivedCodes, extraKeys, identityCodes, referenceKeys, snapshotListings } from './catalogs.ts';
import { proposeByName, proposeSimilar } from './names.ts';

export function endpoint(p: Listing, offerId?: string | null): RelationProduct {
  const variant = offerId ? p.variants?.find(v => v.offerId === offerId) : undefined;
  if ((offerId && !variant) || (p.variants && !variant)) throw new Error(`reviewed variant required: ${listingKey(p)}`);
  return { storeId: p.storeId, pageKey: p.pageKey, name: p.name, modelNumber: p.modelNumber, url: p.url,
    observedAt: p.observedAt, expectedNames: [p.name], expectedModels: p.expectedModels,
    ...(variant ? { url: `${p.url}?variant=${encodeURIComponent(variant.offerId)}`, offer: { id: variant.offerId, sku: variant.sku, name: variant.name } } : {}) };
}
const order = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Codes a listing has without aliases: the stored codes and the forms read from its own fields. */
const ownCodes = (p: Listing): string[] => [...p.codes, ...derivedCodes(p)];
/** Keys a listing has without aliases: its own codes and the page references read from its own fields. */
const ownKeys = (p: Listing): Set<string> => new Set([...ownCodes(p), ...referenceKeys(p)]);

/** Each alias names a current listing by fingerprint, gives usable codes with evidence and is used once per listing. */
function aliasKeys(catalog: Catalog, aliases: readonly Alias[]): ExtraKeys {
  const listings = new Map(catalog.listings.map(p => [listingKey(p), p]));
  const seen = new Set<string>();
  for (const alias of aliases) {
    const p = listings.get(alias.key);
    if (seen.has(alias.key) || !p || fingerprint(p) !== alias.fingerprint || !alias.codes.length || alias.evidence.length < 20
      || !Number.isFinite(Date.parse(alias.reviewedAt)) || alias.codes.some(code => !usefulCode(normalizeCode(code)) || ownKeys(p).has(normalizeCode(code)))) {
      throw new Error(`alias stale/invalid: ${alias.key}`);
    }
    seen.add(alias.key);
  }
  return extraKeys(aliases);
}

/**
 * Discovery order: the forms read from a listing's own fields, then its page references, then reviewed aliases.
 * An alias only adds pairs the listing's own keys miss, so a pair those keys already find keeps their codes and fingerprint.
 */
export const discoveryTiers = (catalog: Catalog, aliases: readonly Alias[]): ExtraKeys[] => [extraKeys([]), referenceKeys, aliasKeys(catalog, aliases)];

export function generate(catalog: Catalog, legacy: readonly ProductRelation[], reviews: readonly Review[], families: readonly Family[], aliases: readonly Alias[] = [], dismissals: readonly Dismissal[] = []) {
  assertCatalog(catalog);
  const listings = new Map(catalog.listings.map(p => [listingKey(p), p]));
  const stores = catalogStores(catalog);
  if (stores.length < 2) throw new Error('two sources required');
  const storeOrder = new Map(stores.map((storeId, i) => [storeId, i]));
  const candidates = discoverCatalog(catalog, ...discoveryTiers(catalog, aliases));
  // Each alias code must find a pair for its listing that the rows' own keys do not; otherwise it is unused input, not evidence.
  const aliasPairs = candidates.filter(c => c.derived && !c.codes.some(code => c.products.every(p => ownKeys(p).has(code))));
  for (const alias of aliases) for (const code of alias.codes.map(normalizeCode)) {
    if (!aliasPairs.some(c => c.codes.includes(code) && c.products.some(p => listingKey(p) === alias.key))) throw new Error(`alias adds no candidate: ${alias.key} ${code}`);
  }
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
    for (const [i, product] of candidate.products.entries()) {
      if (!product.variants) continue;
      const variant = product.variants.find(v => v.offerId === review.offerIds?.[i]);
      if (!variant || !identityCodes(product.storeId, product.manufacturer, [variant.sku]).some(code => candidate.codes.includes(code))) {
        throw new Error(`reviewed variant must match candidate code: ${review.id}`);
      }
    }
    const old = relations.get(review.id);
    if (old?.pricePolicy && review.decision !== 'same_product') throw new Error(`price policy conflicts with review ${review.id}`);
    relations.set(review.id, {
      id: review.id, kind: review.decision, reviewStatus: review.decision === 'same_product' ? 'verified' : 'needs_review',
      products: old?.products ?? [endpoint(candidate.products[0], review.offerIds?.[0]), endpoint(candidate.products[1], review.offerIds?.[1])],
      evidence: review.evidence, differences: review.differences, missingEvidence: review.missingEvidence,
      reviewedAt: review.reviewedAt, provenance: old?.provenance ?? { method: 'catalog', model: review.reviewerModel ?? null, originalClassification: review.decision, originalReason: `indexed ${candidate.derived ? 'derived' : 'exact'} code: ${candidate.codes.join(', ')}` },
      pricePolicy: old?.pricePolicy ?? null,
      ...(!old ? { evidenceUrls: candidate.products.map(p => p.url) } : {}),
    });
  }
  const familyIds = new Set<string>();
  const familyPairs = new Set<string>();
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
        || Object.values(member.features).some(v => typeof v !== 'string' || !v.trim())
        || (p.variants ? !p.variants.some(v => v.offerId === member.offerId) : member.offerId !== undefined)) throw new Error(`family member stale/invalid: ${family.id}/${member.key}`);
      members.add(member.key); return { ...member, listing: p };
    });
    familyCounts[family.id] = 0;
    // Bounded reviewed family blocks (at most 64 members), not a catalogue-wide similarity cross join.
    // Every store pair, oriented by catalogue store order like the code candidates.
    const cross = resolved.flatMap((x, i) => resolved.slice(i + 1).filter(y => y.listing.storeId !== x.listing.storeId)
      .map(y => storeOrder.get(x.listing.storeId)! < storeOrder.get(y.listing.storeId)! ? [x, y] as const : [y, x] as const));
    for (const [a, b] of cross) {
      const id = pairId(a.listing, b.listing);
      familyPairs.add(id);
      if (a.variant === b.variant) continue;
      if (relations.has(id) || reviewIndex.get(id)?.decision === 'rejected') continue;
      const keys = [...new Set([...Object.keys(a.features), ...Object.keys(b.features)])].sort();
      if (keys.some(key => !a.features[key] || !b.features[key])) throw new Error(`incomplete feature schema ${family.id}`);
      const differences = keys.filter(key => a.features[key] !== b.features[key]).map(key => `${key}: ${a.features[key]} ↔ ${b.features[key]}`);
      if (!differences.length) throw new Error(`different variants need concrete differences: ${id}`);
      const common = keys.filter(key => a.features[key] === b.features[key]).map(key => `${key}: ${a.features[key]}`).join(' / ');
      relations.set(id, { id, kind: 'similar_product', reviewStatus: 'verified', products: [endpoint(a.listing, a.offerId), endpoint(b.listing, b.offerId)],
        evidence: `${family.label}。共通用途: ${family.purpose}。${common ? `共通仕様: ${common}。` : ''}登録した製品本体だけを照合し、周辺部品は含めない。`,
        differences, missingEvidence: ['互換性・置き換え時の配線/ソフトウェア・販売数量/付属品'], reviewedAt: family.reviewedAt,
        provenance: { method: 'catalog', model: null, originalClassification: 'reviewed_family', originalReason: family.id }, pricePolicy: null,
        similarity: { family: family.label, distance: differences.length }, evidenceUrls: family.sources,
      });
      familyCounts[family.id] = (familyCounts[family.id] ?? 0) + 1;
    }
  }
  const result = [...relations.values()].sort(order);
  // Name proposals still waiting for review: the pairs the codes, aliases and families do not hold yet.
  const nameProposals = proposeByName(catalog, new Set([...candidates.map(c => c.id), ...familyPairs]), ownCodes);
  // Similar-product leads no candidate, relation or family holds yet. A dismissal names a current lead with its listings' fingerprints.
  const leads = proposeSimilar(catalog, new Set([...candidates.map(c => c.id), ...familyPairs, ...relations.keys()]), ownCodes);
  const leadIds = new Set(leads.map(lead => lead.id));
  const dismissed = new Map<string, Dismissal>();
  for (const dismissal of dismissals) {
    const [a, b] = dismissal.products.map(key => listings.get(key));
    const id = a && b ? pairId(a, b) : '';
    if (!a || !b || dismissed.has(id) || !leadIds.has(id) || storeOrder.get(a.storeId)! > storeOrder.get(b.storeId)! || dismissal.fingerprint !== hash(fingerprint(a) + fingerprint(b))) {
      throw new Error(`dismissal stale/orphaned: ${dismissal.products.join(' ')}`);
    }
    if (!['different', 'identity'].includes(dismissal.decision) || dismissal.evidence.length < 20 || !dismissal.reviewerModel || !Number.isFinite(Date.parse(dismissal.reviewedAt))) {
      throw new Error(`dismissal evidence required: ${dismissal.products.join(' ')}`);
    }
    dismissed.set(id, dismissal);
  }
  const similarProposals = leads.filter(lead => !dismissed.has(lead.id));
  const byBrand: Record<string, { candidates: number; accepted: number; unresolved: number; rejected: number; pending: number; sourceListings: number; unmatchedListings: number }> = {};
  // A store's own maker label (KSY's `make`) stands in where the source names no manufacturer.
  const brandOf = (p: Listing): string => p.manufacturer || p.vendor || '(unknown)';
  for (const p of catalog.listings) {
    const brand = brandOf(p);
    byBrand[brand] ??= { candidates: 0, accepted: 0, unresolved: 0, rejected: 0, pending: 0, sourceListings: 0, unmatchedListings: 0 };
    byBrand[brand]!.sourceListings++;
  }
  const allCandidateListings = new Set(candidates.flatMap(c => c.products.map(listingKey)));
  for (const p of catalog.listings.filter(p => !allCandidateListings.has(listingKey(p)))) byBrand[brandOf(p)]!.unmatchedListings++;
  for (const c of candidates) {
    const row = byBrand[brandOf(c.products[1])]!; row.candidates++;
    const decision = reviewIndex.get(c.id)?.decision;
    if (!decision) row.pending++; else if (decision === 'same_product') row.accepted++; else row[decision]++;
  }
  const report = { sources: catalog.sources, candidateCount: candidates.length, reviewedCount: reviews.length,
    byStorePair: Object.fromEntries(stores.flatMap((a, i) => stores.slice(i + 1).map(b => {
      const pairs = candidates.filter(c => c.products[0].storeId === a && c.products[1].storeId === b);
      return [`${a}/${b}`, { candidates: pairs.length, verified: pairs.filter(c => reviewIndex.get(c.id)?.decision === 'same_product').length,
        unresolved: pairs.filter(c => reviewIndex.get(c.id)?.decision === 'unresolved').length, pending: pairs.filter(c => !reviewIndex.has(c.id)).length }];
    }))),
    pending: candidates.filter(c => !reviewIndex.has(c.id)).map(c => c.id),
    nameProposals: nameProposals.map(p => p.id),
    similarProposals: similarProposals.map(p => p.id),
    dismissedLeads: { different: [...dismissed.values()].filter(d => d.decision === 'different').length, identity: [...dismissed.values()].filter(d => d.decision === 'identity').length },
    legacyCount: legacy.length, relations: result.length,
    sameVerified: result.filter(r => r.kind === 'same_product' && r.reviewStatus === 'verified').length,
    similarVerified: result.filter(r => r.kind === 'similar_product' && r.reviewStatus === 'verified').length,
    unresolved: result.filter(r => r.kind === 'unresolved').length,
    pricePolicies: result.filter(r => r.pricePolicy).length,
    familyCounts, byBrand: Object.fromEntries(Object.entries(byBrand).sort(([a], [b]) => a < b ? -1 : 1)),
    unmatchedByStore: Object.fromEntries(stores.map(storeId => [storeId,
      catalog.listings.filter(p => p.storeId === storeId && !allCandidateListings.has(listingKey(p))).length])),
    limitations: ['All pairs of the pinned saved catalogues and their supplements are searched; listings added after the latest supplement and missing catalogue entries are not covered. Pinned rows keep their reviewed evidence unless a supplement replaced them after review.', 'Codes must contain a digit and have at least four characters. Numeric storefront SKUs are excluded; numeric manufacturer codes still require review for collisions.', 'Unmatched does not mean unrelated. Aliases and descriptions not present in these sources need further review.', 'Names propose identity pairs only where one listing has no code of its own and both names share a model-like token in at most 20 listings. Listings with different codes on both sides are proposed only as similar-product leads, when their codes share a stem and either their names also share such a token (U078-M12 and U078-USB) or one code is that stem and at most 10 listings carry it (U035 and U035-B); other such pairs are not compared.', 'Review is saved-catalogue identity review, not a live stock, compatibility or sales-condition assertion.'],
  };
  return { relations: result, candidates, report, nameProposals, similarProposals };
}

export function serializeRelations(relations: readonly ProductRelation[]): string {
  const table = packRelations(relations);
  const rows = (items: readonly unknown[]): string => items.map(item => JSON.stringify(item)).join(',\n');
  const json = `{"version":${table.version},\n"strings":[\n${rows(table.strings)}\n],\n"products":[\n${rows(table.products)}\n],\n"relations":[\n${rows(table.relations)}\n]}`;
  // JSON in a template literal: one row per line, no per-row TypeScript literal types
  // (thousands of object literals fail with TS2590), and JSON.parse is the fast path.
  const literal = json.replace(/[\\`]|\$\{/g, m => `\\${m}`);
  return `// Generated by npm run matching:build. Edit data/matching reviews/families, not this file.\nimport type { ProductRelation } from '../core/relations.ts';\nimport { unpackRelations, type PackedRelationTable } from '../core/relationTable.ts';\n\nexport const STORE_LABELS: Readonly<Record<string, string>> = { 'akizuki': '秋月電子', 'switch-science': 'スイッチサイエンス', 'm5stack': 'M5Stack公式', 'ksy': 'KSY', 'sengoku': 'せんごく' };\nexport const PRODUCT_RELATIONS: readonly ProductRelation[] = unpackRelations(JSON.parse(\`${literal}\`) as PackedRelationTable);\n`;
}

export const serializeCatalog = (catalog: Catalog): string => JSON.stringify({ schemaVersion: catalog.schemaVersion, sources: catalog.sources }) + '\n' + catalog.listings.map(p => JSON.stringify(p)).join('\n') + '\n';
export function parseCatalog(text: string): Catalog {
  const [header, ...rows] = text.trimEnd().split('\n');
  return { ...JSON.parse(header!), listings: rows.map(row => JSON.parse(row)) } as Catalog;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, discover: { type: 'boolean' }, names: { type: 'boolean' }, similar: { type: 'boolean' }, 'import-left': { type: 'string' }, 'import-right': { type: 'string' }, 'import-store': { type: 'string' },
    supplement: { type: 'string', multiple: true }, replace: { type: 'string', multiple: true } } });
  // One operation per run: a read-only queue request must never fall into a branch that writes mapping inputs.
  const modes = [values['import-left'] || values['import-right'] ? 'import' : '', values['import-store'] ? 'import-store' : '', values.supplement ? 'supplement' : '',
    values.discover ? 'discover' : '', values.check ? 'check' : '', values.names ? 'names' : '', values.similar ? 'similar' : ''].filter(Boolean);
  if (modes.length > 1) throw new Error(`choose one operation, not ${modes.map(m => `--${m}`).join(' + ')}`);
  if (values.replace && !values.supplement) throw new Error('--replace requires --supplement');
  const dir = 'data/matching';
  const readAliases = async (): Promise<Alias[]> => JSON.parse(await readFile(`${dir}/aliases.json`, 'utf8')) as Alias[];
  if (values['import-left'] || values['import-right']) {
    if (!values['import-left'] || !values['import-right']) throw new Error('import requires both files');
    const catalog = await importCatalogs([values['import-left'], values['import-right']]);
    await mkdir(dir, { recursive: true }); await writeFile(`${dir}/catalog.jsonl`, serializeCatalog(catalog));
    console.log(`Imported ${catalog.listings.length} source listings. Existing reviews must be revalidated before build.`); return;
  }
  const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, 'utf8')) as T;
  const catalog = parseCatalog(await readFile(`${dir}/catalog.jsonl`, 'utf8'));
  const storeFile = (option: string, arg: string): [string, string] => {
    const at = arg.indexOf('=');
    if (at < 1) throw new Error(`--${option} expects <storeId>=<file>: ${arg}`);
    return [arg.slice(0, at), arg.slice(at + 1)];
  };
  if (values['import-store']) {
    // --import-store <storeId>=<complete snapshot>: a store's first source.
    const [storeId, file] = storeFile('import-store', values['import-store']);
    const next = appendStore(catalog, storeId, file, await snapshotListings(storeId, file));
    await writeFile(`${dir}/catalog.jsonl`, serializeCatalog(next));
    console.log(`Appended ${next.listings.length - catalog.listings.length} ${storeId} listings. Run --discover, then review every new candidate.`);
    return;
  }
  if (values.supplement) {
    // --supplement <storeId>=<complete snapshot> (repeatable) [--replace <storeId>/<pageKey> ...]
    const steps = [];
    for (const arg of values.supplement) {
      const [storeId, file] = storeFile('supplement', arg);
      steps.push({ storeId, file, snapshot: await snapshotListings(storeId, file) });
    }
    const { catalog: next, reports } = applySupplements(catalog, steps, new Set(values.replace ?? []));
    await writeFile(`${dir}/catalog.jsonl`, serializeCatalog(next));
    console.log(JSON.stringify(reports.map(r => ({ ...r, absentFromSnapshot: { count: r.absentFromSnapshot.length, keys: r.absentFromSnapshot } })), null, 2));
    console.log('Reviews that cite a replaced row are now stale; re-review them before build.');
    return;
  }
  if (values.discover) {
    assertCatalog(catalog);
    const candidates = discoverCatalog(catalog, ...discoveryTiers(catalog, await readAliases()));
    await writeFile(`${dir}/candidates.jsonl`, serializeCandidates(candidates));
    console.log(`Discovered ${candidates.length} candidates from ${catalog.listings.length} listings. No reviews or runtime mappings were changed.`); return;
  }
  const result = generate(catalog, await read<ProductRelation[]>('legacy.json'), await read<Review[]>('reviews.json'), await read<Family[]>('families.json'), await readAliases(), await read<Dismissal[]>('dismissals.json'));
  if (values.names) {
    // The review queue of name proposals, one JSON line each. Nothing is written.
    for (const proposal of result.nameProposals) console.log(JSON.stringify(proposal));
    return;
  }
  if (values.similar) {
    // The review queue of similar-product leads, one JSON line each. Nothing is written.
    for (const proposal of result.similarProposals) console.log(JSON.stringify(proposal));
    return;
  }
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
  return candidates.map(c => JSON.stringify({ id: c.id, codes: c.codes, fingerprint: c.fingerprint, products: c.products.map(listingKey), ...(c.derived ? { derived: true } : {}) })).join('\n') + '\n';
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
