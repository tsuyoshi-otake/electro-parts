import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { endpoint, generate, parseCatalog, serializeCatalog, serializeRelations } from '../../scripts/matching/generate.ts';
import { discover, discoverCatalog, fingerprint, type Catalog, type Family, type Listing, type Review } from '../../scripts/matching/model.ts';
import { identityCodes } from '../../scripts/matching/catalogs.ts';
import type { ProductRelation } from '../../userscript/core/relations.ts';

const read = (file: string): string => readFileSync(`data/matching/${file}`, 'utf8');
const catalog = parseCatalog(read('catalog.jsonl'));
const legacy = JSON.parse(read('legacy.json')) as ProductRelation[];
const reviews = JSON.parse(read('reviews.json')) as Review[];
const families = JSON.parse(read('families.json')) as Family[];
const result = generate(catalog, legacy, reviews, families);
const byId = new Map(result.relations.map(r => [r.id, r]));

describe('reproducible reviewed matching pipeline', () => {
  it('rejects another existing variant even when it belongs to the same page', () => {
    const candidate = result.candidates.find(c => c.products[0].storeId === 'switch-science' && c.products[0].pageKey === '5208' && c.products[1].storeId === 'm5stack')!;
    const review = structuredClone(reviews.find(r => r.id === candidate.id)!);
    review.offerIds![1] = candidate.products[1].variants!.find(v => v.offerId !== review.offerIds![1])!.offerId;
    expect(() => generate(catalog, [], [review], [])).toThrow(/variant must match candidate code/);
  });
  it('searches all three pairs and preserves distinct variants on a shared official product page', () => {
    expect(result.report.byStorePair).toEqual({
      'akizuki/switch-science': { candidates: 309, verified: 293, unresolved: 6, pending: 0 },
      'akizuki/m5stack': { candidates: 18, verified: 18, unresolved: 0, pending: 0 },
      'switch-science/m5stack': { candidates: 503, verified: 499, unresolved: 2, pending: 0 },
    });
    const strips = result.relations.filter(r => r.products[0].storeId === 'switch-science' && ['5208','5209'].includes(r.products[0].pageKey) && r.products[1].storeId === 'm5stack');
    expect(strips).toHaveLength(2);
    expect(strips[0]!.products[1].pageKey).toBe(strips[1]!.products[1].pageKey);
    expect(new Set(strips.map(r => r.products[1].offer!.id)).size).toBe(2);
    for (const r of strips) {
      expect(new URL(r.products[1].url).searchParams.get('variant')).toBe(r.products[1].offer!.id);
      expect(r.pricePolicy).toBeNull();
    }
    const official = catalog.listings.find(p => p.pageKey === strips[0]!.products[1].pageKey)!;
    expect(() => endpoint(official)).toThrow(/variant required/);
    expect(() => endpoint(official, 'missing')).toThrow(/variant required/);
    const changed = structuredClone(catalog);
    changed.listings.find(p => p.pageKey === official.pageKey)!.variants![0]!.sku += '-V2';
    expect(() => generate(changed, legacy, reviews, families)).toThrow(/stale/);
    expect(discoverCatalog({...catalog, listings: [...catalog.listings].reverse()}).map(c => c.id)).toEqual(result.candidates.map(c => c.id));
  });
  it('searches every pinned listing and accounts for every candidate without automatic promotion', () => {
    expect(catalog.listings).toHaveLength(19684);
    expect(result.candidates).toHaveLength(830);
    expect(result.report.pending).toEqual([]);
    expect(reviews.filter(r => r.decision === 'rejected')).toHaveLength(12);
    expect(reviews.filter(r => r.decision === 'unresolved')).toHaveLength(8);
    expect(result.report).toMatchObject({ sameVerified: 810, similarVerified: 108, pricePolicies: 2 });
    expect(Object.values(result.report.byBrand).reduce((n, b) => n + b.candidates, 0)).toBe(830);
    expect(result.report.byBrand['Seeed']!.accepted).toBeGreaterThan(30);
    expect(result.report.byBrand['Raspberry Pi Trading']!.accepted).toBeGreaterThan(40);
    expect(result.report.byBrand['Arduino']!.accepted).toBeGreaterThan(25);
    expect(generate(catalog, [], [], []).relations).toEqual([]);
    expect(generate(catalog, [], [], []).report.pending).toHaveLength(830);
  });

  it('produces byte-identical artifacts and a lossless, price-free evidence projection', () => {
    expect(serializeRelations(result.relations)).toBe(readFileSync('userscript/adapters/productRelations.ts', 'utf8'));
    expect(serializeCatalog(catalog)).toBe(read('catalog.jsonl'));
    expect(serializeRelations(generate(catalog, legacy, reviews, families).relations)).toBe(serializeRelations(result.relations));
    expect(JSON.stringify(result.report, null, 2) + '\n').toBe(read('coverage.json'));
    for (const p of catalog.listings) {
      expect(p).not.toHaveProperty('prices'); expect(p).not.toHaveProperty('stock');
    }
  });

  it.each(['a108286-s1120', 'a107386-s1096', 'a107384-s968', 'a130170-s9940', 'a131437-s10672', 'a132045-s11300', 'a117978-s9001', 'a117454-s8348', 'a116350-s2752', 'a130055-s2661', 'a118085-s8170', 'a117947-s8171'])(
    'includes reviewed identity %s while withholding unreviewed selling arithmetic', id => {
      expect(byId.get(id)).toMatchObject({ kind: 'same_product', reviewStatus: 'verified', pricePolicy: null });
    });

  it('excludes every reviewed numeric-code collision and retains contradictory configurations as unresolved', () => {
    for (const r of reviews.filter(r => r.decision === 'rejected')) expect(byId.has(r.id)).toBe(false);
    expect(byId.get('a129606-s10908')).toMatchObject({ kind: 'unresolved', reviewStatus: 'needs_review', pricePolicy: null });
    expect(byId.get('a129606-s10908')!.evidence).toContain('容量と型番が矛盾');
    expect(byId.get('a116286-s3605')!.kind).toBe('unresolved');
    expect(byId.get('a117928-s5529')!.kind).toBe('unresolved');
    expect(byId.get('a130369-s10244')).toMatchObject({ kind: 'same_product', pricePolicy: null }); // 500-piece reel is NOT unit pricing.
  });

  it('stops on changed source evidence, duplicate reviews, orphaned reviews and invalid family members', () => {
    const changed = structuredClone(catalog);
    changed.listings.find(p => p.storeId === 'akizuki' && p.pageKey === '108286')!.name += ' Rev2';
    expect(() => generate(changed, legacy, reviews, families)).toThrow(/stale/);
    expect(() => generate(catalog, legacy, [...reviews, reviews[0]!], families)).toThrow(/duplicate review/);
    expect(() => generate(catalog, legacy, [{...reviews[0]!, id: 'absent'}], [])).toThrow(/orphaned/);
    const bad = structuredClone(families); bad[0]!.members[0]!.fingerprint = 'old';
    expect(() => generate(catalog, legacy, reviews, bad)).toThrow(/family member stale/);
    expect(() => generate(catalog, legacy, reviews, [...families, families[0]!])).toThrow(/invalid family/);
  });

  it('cannot turn a deferred/rejected identity into a verified family relation', () => {
    // The Pi 5 1GB source with contradictory MPN is deliberately not enrolled.
    expect(families.flatMap(f => f.members).some(m => m.key === 'switch-science/10908')).toBe(false);
    const family = structuredClone(families.find(f => f.id === 'pi5')!);
    const p = catalog.listings.find(p => p.storeId === 'switch-science' && p.pageKey === '10908')!;
    family.members.push({ key: 'switch-science/10908', fingerprint: fingerprint(p), variant: 'contradictory', features: { 世代: 'Pi 5', RAM: '1GB' } });
    expect(generate(catalog, [], reviews, [family]).relations.find(r => r.id === 'a129606-s10908')!.kind).toBe('unresolved');
  });

  it('builds concrete cross-store differences from reviewed family members, not names of accessories', () => {
    expect(byId.get('a116132-s8171')).toMatchObject({ kind: 'similar_product', reviewStatus: 'verified', differences: ['無線: なし ↔ Wi-Fi/Bluetooth'], pricePolicy: null });
    expect(byId.get('a116132-s10258')!.differences).toHaveLength(3);
    expect(byId.get('a131437-s9940')!.differences).toEqual(['画面: 5インチ ↔ 7インチ']);
    expect(byId.get('a118154-s9771')!.differences).toEqual(['カメラ: OV2640 ↔ OV3660']);
    expect(result.relations.some(r => r.kind === 'similar_product' && r.products.some(p => p.pageKey === '6991'))).toBe(false); // header kit, not a Pico board.
    for (const r of result.relations.filter(r => r.similarity)) {
      expect(r.similarity!.distance).toBe(r.differences.length);
      expect(r.missingEvidence.join(' ')).toContain('互換性');
    }
  });

  it('preserves original model provenance and the independently reviewed price policies', () => {
    for (const r of legacy) {
      const current = byId.get(r.id);
      if (current) expect(current.provenance).toEqual(r.provenance);
      if (r.pricePolicy) expect(current!.pricePolicy).toEqual(r.pricePolicy);
    }
  });
});

describe('indexed candidate discovery', () => {
  const sample: Listing = { storeId: 'left', pageKey: 'one', name: 'Widget', modelNumber: 'MPN-1-V2', manufacturer: 'Maker', manufacturerProductCode: 'MPN-1-V2', manufacturerProductName: 'Widget', productCode: '', sku: 'SKU-1', codes: ['MPN-1-V2'], expectedModels: ['MPN-1-V2'], observedAt: '2026-09-07', url: 'https://left.test/one' };
  it('indexes repeated codes once, preserves revisions and does not equate known different manufacturers', () => {
    const a = {...sample, codes: ['MPN-1-V2', 'MPN-1-V2']};
    const b = {...sample, storeId: 'right'};
    expect(discover([a], [b])).toHaveLength(1);
    expect(discover([a], [{...b, codes: ['MPN-1-V3']}])).toHaveLength(0);
    expect(discover([a], [{...b, manufacturer: 'Other'}])).toHaveLength(0);
    expect(discover([a], [{...b, manufacturer: ''}])).toHaveLength(1); // candidate, not confirmation.
  });
  it('normalizes only scoped aliases and keeps selling SKU separate', () => {
    expect(identityCodes('akizuki', 'M5Stack', ['M5STACK-C008-B-V11'])).toEqual(['C008-B-V11']);
    expect(identityCodes('switch-science', 'Other', ['M5STACK-C008-B-V11'])).toEqual(['M5STACK-C008-B-V11']);
    expect(identityCodes('switch-science', 'Raspberry Pi Trading', ['RPI-SC0918'])).toEqual(['SC0918']);
    expect(identityCodes('switch-science', 'Other', ['RPI-SC0918'])).toEqual(['RPI-SC0918']);
    const p = catalog.listings.find(p => p.storeId === 'switch-science' && p.pageKey === '1096')!;
    expect(p.sku).toBe('1096'); expect(p.codes).toContain('A000062'); expect(p.codes).not.toContain('1096');
    expect(p.expectedModels).toContain('1096');
  });
  it('handles large disjoint catalogues without a cartesian scan', () => {
    const rows = Array.from({length: 20_000}, (_, i) => ({...sample, pageKey: String(i), codes: [`MPN-${i}`]}));
    const other = rows.map(p => ({...p, storeId: 'right', codes: [`OTHER-${p.pageKey}`]}));
    const started = performance.now();
    expect(discover(rows, other)).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(2000);
  });
  it('rejects duplicated or incomplete source projections', () => {
    const bad = structuredClone(catalog); bad.listings.push(bad.listings[0]!);
    expect(() => generate(bad, [], [], [])).toThrow(/duplicate listing/);
    const short: Catalog = {...catalog, listings: catalog.listings.slice(1)};
    expect(() => generate(short, [], [], [])).toThrow(/incomplete source/);
    expect(() => generate({...catalog, sources: [catalog.sources[0]!, catalog.sources[0]!]}, [], [], [])).toThrow(/duplicate source/);
    const unknown = structuredClone(catalog); unknown.listings[0]!.storeId = 'unknown';
    expect(() => generate(unknown, [], [], [])).toThrow(/unknown source/);
  });
});
