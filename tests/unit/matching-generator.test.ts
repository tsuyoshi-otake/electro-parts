import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { discoveryTiers, endpoint, generate, parseCatalog, serializeCatalog, serializeRelations, serializeStoreLabels } from '../../scripts/matching/generate.ts';
import { catalogStores, discover, discoverCatalog, fingerprint, hash, listingKey, normalizeCode, pageReference, type Alias, type Catalog, type Dismissal, type Family, type Listing, type Review } from '../../scripts/matching/model.ts';
import { appendStore, appendSupplement, applySupplements, derivedCodes, extraKeys, identityCodes, referenceKeys, snapshotListings, variantCodes, type SnapshotListings } from '../../scripts/matching/catalogs.ts';
import { normalizeKsyItem } from '../../src/adapters/ksy/snapshotAdapter.ts';
import { normalizeSengokuItem } from '../../src/adapters/sengoku/snapshotAdapter.ts';
import type { ProductRelation } from '../../userscript/core/relations.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { collectKsyFixture } from '../helpers/ksy.ts';
import { collectSengokuFixture } from '../helpers/sengoku.ts';
import { collectPimoroniFixture, loadPimoroniNormalized } from '../helpers/pimoroni.ts';
import { PIMORONI_STORE } from '../../src/adapters/pimoroni/identity.ts';
import { shopifyHandleFromKey, shopifyProductUrl } from '../../src/adapters/shopify/identity.ts';
import type { ShopifySnapshot } from '../../src/adapters/shopify/rawSchema.ts';

const read = (file: string): string => readFileSync(`data/matching/${file}`, 'utf8');
const catalog = parseCatalog(read('catalog.jsonl'));
const legacy = JSON.parse(read('legacy.json')) as ProductRelation[];
const reviews = JSON.parse(read('reviews.json')) as Review[];
const families = JSON.parse(read('families.json')) as Family[];
const aliases = JSON.parse(read('aliases.json')) as Alias[];
const dismissals = JSON.parse(read('dismissals.json')) as Dismissal[];
const result = generate(catalog, legacy, reviews, families, aliases, dismissals);
const byId = new Map(result.relations.map(r => [r.id, r]));

describe('reproducible reviewed matching pipeline', () => {
  it('rejects another existing variant even when it belongs to the same page', () => {
    const candidate = result.candidates.find(c => c.products[0].storeId === 'switch-science' && c.products[0].pageKey === '5208' && c.products[1].storeId === 'm5stack')!;
    const review = structuredClone(reviews.find(r => r.id === candidate.id)!);
    review.offerIds![1] = candidate.products[1].variants!.find(v => v.offerId !== review.offerIds![1])!.offerId;
    expect(() => generate(catalog, [], [review], [])).toThrow(/variant must match candidate code/);
  });
  it('searches every store pair and preserves distinct variants on a shared official product page', () => {
    expect(result.report.byStorePair).toEqual({
      'akizuki/switch-science': { candidates: 488, verified: 430, unresolved: 35, pending: 0 },
      'akizuki/m5stack': { candidates: 24, verified: 22, unresolved: 2, pending: 0 },
      'akizuki/ksy': { candidates: 131, verified: 127, unresolved: 4, pending: 0 },
      'akizuki/sengoku': { candidates: 1018, verified: 890, unresolved: 76, pending: 0 },
      'switch-science/m5stack': { candidates: 547, verified: 541, unresolved: 4, pending: 0 },
      'switch-science/ksy': { candidates: 218, verified: 212, unresolved: 6, pending: 0 },
      'switch-science/sengoku': { candidates: 1249, verified: 1191, unresolved: 11, pending: 0 },
      'm5stack/ksy': { candidates: 9, verified: 9, unresolved: 0, pending: 0 },
      'm5stack/sengoku': { candidates: 397, verified: 394, unresolved: 1, pending: 0 },
      'ksy/sengoku': { candidates: 161, verified: 157, unresolved: 4, pending: 0 },
      // Pimoroni, the sixth store (#94): the pairs its saved catalogue adds, every one reviewed.
      'akizuki/pimoroni': { candidates: 184, verified: 178, unresolved: 5, pending: 0 },
      'switch-science/pimoroni': { candidates: 1010, verified: 998, unresolved: 11, pending: 0 },
      'm5stack/pimoroni': { candidates: 77, verified: 77, unresolved: 0, pending: 0 },
      'ksy/pimoroni': { candidates: 170, verified: 168, unresolved: 2, pending: 0 },
      'sengoku/pimoroni': { candidates: 327, verified: 322, unresolved: 3, pending: 0 },
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
    expect(() => generate(changed, legacy, reviews, families, aliases)).toThrow(/stale/);
    expect(discoverCatalog({...catalog, listings: [...catalog.listings].reverse()}, ...discoveryTiers(catalog, aliases)).map(c => c.id)).toEqual(result.candidates.map(c => c.id));
  });
  it('searches every pinned listing and accounts for every candidate without automatic promotion', () => {
    // 44,518 rows of the five earlier stores plus the Pimoroni catalogue (#94): 2,854 rows and 1,718 pairs, one per Pimoroni candidate of the store pairs above.
    expect(catalog.listings).toHaveLength(47372);
    expect(result.candidates).toHaveLength(6010);
    expect(result.report.pending).toEqual([]);
    expect(reviews.filter(r => r.decision === 'rejected')).toHaveLength(130);
    expect(reviews.filter(r => r.decision === 'unresolved')).toHaveLength(164);
    expect(result.report).toMatchObject({ sameVerified: 5716, similarVerified: 1581, pricePolicies: 2 });
    expect(Object.values(result.report.byBrand).reduce((n, b) => n + b.candidates, 0)).toBe(6010);
    expect(result.report.byBrand['Seeed']!.accepted).toBeGreaterThan(30);
    expect(result.report.byBrand['Raspberry Pi Trading']!.accepted).toBeGreaterThan(40);
    expect(result.report.byBrand['Arduino']!.accepted).toBeGreaterThan(25);
    expect(generate(catalog, [], [], [], aliases).relations).toEqual([]);
    expect(generate(catalog, [], [], [], aliases).report.pending).toHaveLength(6010);
  });

  it('generates the store labels as their own module, so the table is not needed to name a store', () => {
    expect(serializeStoreLabels()).toBe(readFileSync('userscript/adapters/storeLabels.ts', 'utf8'));
    expect(serializeStoreLabels()).not.toContain('PRODUCT_RELATIONS');
    expect(serializeRelations(result.relations)).not.toContain('STORE_LABELS');
  });

  it('produces byte-identical artifacts and a lossless, price-free evidence projection', () => {
    expect(serializeRelations(result.relations)).toBe(readFileSync('userscript/adapters/productRelations.ts', 'utf8'));
    expect(serializeCatalog(catalog)).toBe(read('catalog.jsonl'));
    expect(serializeRelations(generate(catalog, legacy, reviews, families, aliases).relations)).toBe(serializeRelations(result.relations));
    // The packed runtime table is lossless: the same rows and endpoints, with an endpoint's
    // reviewed spellings merged across the relations that use it.
    expect(PRODUCT_RELATIONS).toHaveLength(result.relations.length);
    for (const [i, relation] of result.relations.entries()) {
      const decoded = PRODUCT_RELATIONS[i]!;
      expect({ ...decoded, products: null }).toStrictEqual({ ...relation, products: null });
      for (const [j, p] of relation.products.entries()) {
        expect(decoded.products[j]).toMatchObject({ ...p, expectedNames: expect.arrayContaining([...p.expectedNames]), expectedModels: expect.arrayContaining([...p.expectedModels]) });
      }
    }
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
    // 2026-10-04: same code but a stated version/capacity/build the other listing does not pin stays unresolved.
    for (const id of ['a112450-s4971', 'a112855-s5442', 'a113361-s3851', 'a113689-s3997', 'a116956-s5843', 'a110757-s8123', JSON.stringify(['akizuki', '117206', 'm5stack', 'h-m5paper-esp32-development-kit-960x540-4-7-eink-display-235-ppi'])]) {
      expect(byId.get(id)).toMatchObject({ kind: 'unresolved', reviewStatus: 'needs_review', pricePolicy: null });
    }
    expect(byId.has('a116346-s2424')).toBe(false);
  });

  it('stops on changed source evidence, duplicate reviews, orphaned reviews and invalid family members', () => {
    const changed = structuredClone(catalog);
    changed.listings.find(p => p.storeId === 'akizuki' && p.pageKey === '108286')!.name += ' Rev2';
    expect(() => generate(changed, legacy, reviews, families, aliases)).toThrow(/stale/);
    expect(() => generate(catalog, legacy, [...reviews, reviews[0]!], families, aliases)).toThrow(/duplicate review/);
    expect(() => generate(catalog, legacy, [{...reviews[0]!, id: 'absent'}], [], aliases)).toThrow(/orphaned/);
    const bad = structuredClone(families); bad[0]!.members[0]!.fingerprint = 'old';
    expect(() => generate(catalog, legacy, reviews, bad, aliases)).toThrow(/family member stale/);
    expect(() => generate(catalog, legacy, reviews, [...families, families[0]!], aliases)).toThrow(/invalid family/);
    // A review found only through an alias is orphaned without it.
    expect(() => generate(catalog, legacy, reviews, families)).toThrow(/orphaned/);
  });

  it('cannot turn a deferred/rejected identity into a verified family relation', () => {
    // The Pi 5 1GB source with contradictory MPN is deliberately not enrolled.
    expect(families.flatMap(f => f.members).some(m => m.key === 'switch-science/10908')).toBe(false);
    const family = structuredClone(families.find(f => f.id === 'pi5')!);
    const p = catalog.listings.find(p => p.storeId === 'switch-science' && p.pageKey === '10908')!;
    family.members.push({ key: 'switch-science/10908', fingerprint: fingerprint(p), variant: 'contradictory', features: { 世代: 'Pi 5', RAM: '1GB' } });
    expect(generate(catalog, [], reviews, [family], aliases).relations.find(r => r.id === 'a129606-s10908')!.kind).toBe('unresolved');
  });

  it('builds concrete cross-store differences from reviewed family members, not names of accessories', () => {
    expect(byId.get('a116132-s8171')).toMatchObject({ kind: 'similar_product', reviewStatus: 'verified', differences: ['無線: なし ↔ Wi-Fi/Bluetooth'], pricePolicy: null });
    expect(byId.get('a116132-s10258')!.differences).toHaveLength(3);
    expect(byId.get('a131437-s9940')!.differences).toEqual(['画面: 5インチ ↔ 7インチ']);
    expect(byId.get('a118154-s9771')!.differences).toEqual(['カメラ: OV2640 ↔ OV3660']);
    expect(result.relations.some(r => r.kind === 'similar_product' && r.products.some(p => p.pageKey === '6991'))).toBe(false); // header kit, not a Pico board.
    const order = catalogStores(catalog);
    for (const r of result.relations.filter(r => r.similarity)) {
      expect(r.similarity!.distance).toBe(r.differences.length);
      expect(r.missingEvidence.join(' ')).toContain('互換性');
      // Every store pair, oriented like the code candidates.
      expect(order.indexOf(r.products[0].storeId)).toBeLessThan(order.indexOf(r.products[1].storeId));
    }
    const id = (...key: string[]): string => JSON.stringify(key);
    // 2026-11-01: families reach KSY and せんごく, so a header or Plus variant sold by one shop links to the plain board at another.
    expect(byId.get(id('ksy', '219', 'sengoku', 'EEHD-57LT'))).toMatchObject({ kind: 'similar_product', differences: ['ヘッダー: 未実装 ↔ 実装済'] });
    expect(byId.get(id('switch-science', '10978', 'sengoku', 'EEHD-6Y7S'))!.differences).toEqual(['ヘッダー: 未実装 ↔ 実装済']);
    expect(byId.get('a117044-s11438')).toMatchObject({ kind: 'similar_product', differences: ['構成: 標準 ↔ Plus'] }); // XIAO RP2040 Plus, sold only by スイッチサイエンス.
    expect(result.report.familyCounts).toMatchObject({ zero: 120, 'xiao-nrf52840': 54, 'xiao-rp2040': 5 });
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
  it('derives extra keys only from the scoped shop wrappers and keeps every version suffix', () => {
    const row = (storeId: string, modelNumber: string, vendor = ''): Listing => ({...sample, storeId, modelNumber, vendor, manufacturer: '', codes: [normalizeCode(modelNumber)]});
    expect(derivedCodes(row('sengoku', '【19192】 1.28inch LCD Module', 'Waveshare'))).toContain('19192');
    // Elsewhere the bracket holds せんごく's own serial number.
    expect(derivedCodes(row('sengoku', '【19192】 1.28inch LCD Module', 'ノンブランド'))).not.toContain('19192');
    expect(derivedCodes(row('sengoku', '【019】RPi5-8GB-SC1112', 'Raspberry Pi'))).toContain('SC1112');
    expect(derivedCodes(row('sengoku', '【011】SC0510', 'Raspberry Pi'))).toEqual(['SC0510']);
    expect(derivedCodes(row('sengoku', '【9918】M5STACK-A145-V033', 'M5STACK'))).toEqual(['A145-V033']);
    expect(derivedCodes(row('switch-science', 'SEEED-113990234'))).toEqual(['113990234']);
    // Akizuki's older Seeed rows; a `+` set is left to its reviewed alias, and other shops do not write these forms.
    expect(derivedCodes(row('akizuki', '104030003(LED05291P)'))).toEqual(['104030003']);
    expect(derivedCodes(row('akizuki', 'SKU-102010027'))).toEqual(['102010027']);
    expect(derivedCodes(row('akizuki', '114020161/114020163'))).toEqual(['114020161', '114020163']);
    expect(derivedCodes(row('akizuki', '113991274+114992364'))).toEqual([]);
    expect(derivedCodes(row('switch-science', '104030003(LED05291P)'))).toEqual([]);
    expect(derivedCodes(row('akizuki', 'SC0194(9)'))).toEqual(['SC0194']);
    expect(derivedCodes(row('switch-science', 'SC0130(J)'))).toEqual(['SC0130']);
    expect(derivedCodes(row('akizuki', 'C008-B-V11'))).toEqual([]);
    expect(derivedCodes(row('akizuki', '【19192】 1.28inch LCD Module'))).toEqual([]); // only せんごく writes brackets this way.
    expect(derivedCodes(row('ksy', 'RASPIZWHSC0065', 'ラズベリーパイ財団'))).toEqual([]); // KSY codes go through reviewed aliases only.
  });
  describe('Pimoroni maker forms (#94)', () => {
    const pimRow = (vendor: string, skus: string[], storeId = 'pimoroni'): Listing => ({...sample, storeId, pageKey: `p-${skus[0]}`, vendor, manufacturer: '', modelNumber: skus.length === 1 ? skus[0]! : '',
      codes: skus.map(normalizeCode), expectedModels: [skus.length === 1 ? skus[0]! : ''], variants: skus.map((sku, i) => ({ offerId: String(i + 1), sku, name: `v${i}` })) });
    const shop = (code: string): Listing => ({...sample, storeId: 'switch-science', pageKey: `s-${code}`, vendor: '', manufacturer: '', codes: [code], modelNumber: code, expectedModels: [code]});
    const meet = (left: Listing, right: Listing) => discover([left], [right], extraKeys([]));

    it.each([['Adafruit', 'ADA6044', 'ADA-6044'], ['Pololu', 'POL-799', 'POLOLU-799'], ['Kitronik', 'KIT-5038', 'KITRONIK-5038']])('%s: %s pairs with %s as a derived candidate that its fingerprint covers', (vendor, sku, written) => {
      const pim = pimRow(vendor, [sku]); const other = shop(written);
      expect(discover([other], [pim])).toHaveLength(0);
      expect(derivedCodes(pim)).toEqual([written]);
      const [c] = meet(other, pim);
      expect(c).toMatchObject({ derived: true, codes: [written] });
      // The key is part of the fingerprint, like every other derived candidate; the stored row is unchanged.
      expect(c!.fingerprint).toBe(hash(hash(fingerprint(other) + fingerprint(pim)) + JSON.stringify([written])));
      expect(pim.codes).toEqual([sku]); expect(pim.expectedModels).toEqual([sku]);
    });
    it('gates on the vendor label and on Pimoroni', () => {
      expect(derivedCodes(pimRow('Sparkfun', ['ADA1234']))).toEqual([]);
      expect(derivedCodes(pimRow('Generic', ['POL-1234']))).toEqual([]);
      expect(derivedCodes(pimRow('Adafruit', ['KIT-5038']))).toEqual([]);
      expect(derivedCodes(pimRow('Adafruit', ['ADA1234'], 'sengoku'))).toEqual([]);
      expect(derivedCodes(pimRow('Adafruit', ['ADA1234'], 'switch-science'))).toEqual([]);
    });
    it('gates on the SKU pattern', () => {
      for (const [vendor, sku] of [['Adafruit', 'ADA1234A'], ['Adafruit', 'ADA-1234'], ['Pololu', 'POL1234'], ['Pololu', 'POL-12A4'], ['Kitronik', 'KIT5038'], ['Kitronik', 'KIT-ABC']] as const) {
        expect(derivedCodes(pimRow(vendor, [sku])), sku).toEqual([]);
      }
    });
    it('keeps the rest of a Kitronik SKU, so a suffix is never dropped', () => {
      const v2 = pimRow('Kitronik', ['KIT-5038-V2']);
      expect(derivedCodes(v2)).toEqual(['KITRONIK-5038-V2']);
      expect(meet(shop('KITRONIK-5038'), v2)).toHaveLength(0);
      expect(meet(shop('KITRONIK-5038-V2'), v2)).toHaveLength(1);
      expect(derivedCodes(pimRow('Kitronik', ['KIT-5601B']))).toEqual(['KITRONIK-5601B']);
    });
    it('never turns a bare number into a key', () => {
      expect(meet(shop('ADA-1032'), pimRow('Pololu', ['POL-1032']))).toHaveLength(0);
      expect(meet(shop('1032'), pimRow('Adafruit', ['ADA1032']))).toHaveLength(0);
      expect(derivedCodes(pimRow('Adafruit', ['ADA1032']))).not.toContain('1032');
    });
    it('gives every variant of a multi-variant product its key', () => {
      const many = pimRow('Pololu', ['POL-1352', 'POL-1354', 'POL-1356']);
      expect(derivedCodes(many)).toEqual(['POLOLU-1352', 'POLOLU-1354', 'POLOLU-1356']);
      expect(meet(shop('POLOLU-1354'), many)[0]).toMatchObject({ codes: ['POLOLU-1354'], derived: true });
    });
    it('finds the Switch Science and せんごく rows of the saved catalogue only through the key', () => {
      const ss = result.candidates.find(c => c.products[0].storeId === 'switch-science' && c.products[0].pageKey === '5809' && c.products[1].storeId === 'pimoroni')!;
      expect(ss).toMatchObject({ derived: true, codes: ['ADA-4311'] });
      const sg = result.candidates.find(c => c.products[0].storeId === 'sengoku' && c.products[0].pageKey === 'EEHD-5PZR' && c.products[1].storeId === 'pimoroni')!;
      expect(sg).toMatchObject({ derived: true, codes: ['KITRONIK-5659'] });
    });
  });

  describe('a review of a candidate found through a Pimoroni derived key (#94)', () => {
    // Found through the derived key of a variant SKU: the pairs an alias made from a page reference (the rejected name proposals of #94) carry no variant code.
    // The #113 aliases add derived candidates of their own; this block exercises the derived-key tier, so keep only pairs a run without aliases also finds with the same fingerprint.
    const withoutAliases = new Map(generate(catalog, [], [], []).candidates.map(c => [c.id, c.fingerprint]));
    const derivedOnly = (vendor: string, minVariants = 1) => result.candidates.find(c => c.derived && withoutAliases.get(c.id) === c.fingerprint && c.products[1].storeId === 'pimoroni' && c.products[1].vendor === vendor
      && c.products[1].variants!.length >= minVariants && !c.products[1].codes.some(code => c.codes.includes(code))
      && c.products[1].variants!.some(v => variantCodes(c.products[1], v).some(code => c.codes.includes(code))))!;
    const reviewOf = (c: ReturnType<typeof derivedOnly>, offerId: string): Review => ({ id: c.id, fingerprint: c.fingerprint, decision: 'same_product', reviewedAt: '2026-11-10',
      evidence: '名称・メーカー品番・販売構成を両店の保存行で突合した検証用の判定。', differences: [], missingEvidence: ['販売数量'],
      offerIds: [c.products[0].variants ? c.products[0].variants[0]!.offerId : null, offerId] });
    const matching = (c: ReturnType<typeof derivedOnly>) => c.products[1].variants!.find(v => variantCodes(c.products[1], v).some(code => c.codes.includes(code)))!;

    it.each(['Adafruit', 'Pololu', 'Kitronik'])('%s: the variant whose SKU gives the matched key is accepted', vendor => {
      const c = derivedOnly(vendor);
      expect(c, vendor).toBeDefined();
      expect(generate(catalog, [], [reviewOf(c, matching(c).offerId)], []).relations.find(r => r.id === c.id)).toMatchObject({ kind: 'same_product' });
    });
    it('still refuses a variant of the same product whose SKU gives no matched key, and a variant that is not on the product', () => {
      for (const vendor of ['Adafruit', 'Pololu', 'Kitronik']) {
        const c = derivedOnly(vendor, vendor === 'Kitronik' ? 1 : 2);
        const other = c.products[1].variants!.find(v => !variantCodes(c.products[1], v).some(code => c.codes.includes(code)));
        if (other) expect(() => generate(catalog, [], [reviewOf(c, other.offerId)], [])).toThrow(/variant must match candidate code/);
        expect(() => generate(catalog, [], [reviewOf(c, 'no-such-offer')], [])).toThrow(/variant must match candidate code/);
      }
    });
    it('reads a variant SKU by the same rule as the candidate search', () => {
      const pim: Listing = { ...sample, storeId: 'pimoroni', vendor: 'Adafruit', manufacturer: '', codes: ['ADA1234', 'ADA1234A'], variants: [{ offerId: '1', sku: 'ADA1234', name: 'a' }, { offerId: '2', sku: 'ADA1234A', name: 'b' }] };
      expect(variantCodes(pim, pim.variants![0]!)).toEqual(['ADA-1234', 'ADA1234']);
      expect(variantCodes(pim, pim.variants![1]!)).toEqual(['ADA1234A']);
      expect(variantCodes({ ...pim, vendor: 'Generic' }, pim.variants![0]!)).toEqual(['ADA1234']);
    });
  });
  it('frees a part number from ordering annotations, alternatives, maker prefixes and resale numbers (#48)', () => {
    const row = (storeId: string, modelNumber: string, vendor = ''): Listing => ({...sample, storeId, modelNumber, vendor, manufacturer: '', codes: [normalizeCode(modelNumber)]});
    expect(derivedCodes(row('akizuki', 'TC74HC138AP(F)'))).toEqual(['TC74HC138AP']);
    expect(derivedCodes(row('akizuki', 'TC74HC02AP (F)'))).toEqual(['TC74HC02AP']);
    expect(derivedCodes(row('akizuki', 'S2B-PH-K-S(LF)(SN)'))).toEqual(['S2B-PH-K-S']);
    expect(derivedCodes(row('sengoku', 'LMC660CN/NOPB'))).toEqual(['LMC660CN']);
    expect(derivedCodes(row('ksy', 'SC0914（旧 SC0908）'))).toEqual(['SC0914']);
    expect(derivedCodes(row('akizuki', 'No.13 (3pcs)'))).toEqual([]); // not a part number
    expect(derivedCodes(row('sengoku', 'PIM185/PIM208'))).toEqual(['PIM185', 'PIM208']);
    expect(derivedCodes(row('akizuki', 'PIC16F84A-20I/SS'))).toEqual([]); // a package code is part of the product
    expect(derivedCodes(row('switch-science', 'SFE-BOB-11083'))).toEqual(['BOB-11083']);
    expect(derivedCodes(row('switch-science', 'ATMEL-ATMEGA328P-AU'))).toEqual(['ATMEGA328P-AU']);
    expect(derivedCodes(row('switch-science', 'M5STACK-U090'))).toEqual(['U090']);
    expect(derivedCodes(row('switch-science', 'POLOLU-3424'))).toEqual([]); // a bare number collides across makers
    expect(derivedCodes(row('akizuki', 'RPE-2003'))).toEqual([]); // not a shop's maker prefix
    expect(derivedCodes(row('sengoku', 'SSCI-012164/1216'))).toEqual(['SSCI-012164']);
    expect(derivedCodes(row('sengoku', 'ALIENTEK-3IN1USC-FT-I/10241', 'ALIENTEK'))).toEqual(['ALIENTEK-3IN1USC-FT-I', '3IN1USC-FT-I']);
    expect(derivedCodes(row('sengoku', 'AMCS-473/630', 'アムトランス'))).toEqual([]); // 630 V, not a page
    expect(derivedCodes(row('switch-science', 'SSCI-012164/1216'))).toEqual([]); // only せんごく names resold pages
    // A せんごく row cites a Switch Science page, and only せんごく labels known to mean it with 【N】 count.
    const cited = (p: Listing): string[] => referenceKeys(p).filter(key => key !== pageReference(p));
    expect(referenceKeys({...row('switch-science', 'SSCI-012164'), pageKey: '1216'})).toEqual(['SWITCH-SCIENCE/1216']);
    expect(cited(row('sengoku', 'SSCI-012164/1216'))).toEqual(['SWITCH-SCIENCE/1216']);
    expect(cited(row('sengoku', '【3650】M5STACK-PROTO-MODULE', 'M5STACK'))).toEqual(['SWITCH-SCIENCE/3650']);
    expect(cited({...row('sengoku', 'SSCI-096621', 'スイッチサイエンス'), name: '【9662】ESPr® Developer C6　SSCI-096621'})).toEqual(['SWITCH-SCIENCE/9662']);
    expect(cited(row('sengoku', '【10444】 1.3inch OLED (A)', 'Waveshare'))).toEqual([]); // a Waveshare part number
    expect(cited(row('sengoku', '【1079】', ''))).toEqual([]);
    expect(cited(row('akizuki', 'SSCI-012164/1216'))).toEqual([]);
  });
  it("names every listing's own page, which only a reviewed alias can cite (0.6.5)", () => {
    const row = (storeId: string, pageKey: string): Listing => ({...sample, storeId, pageKey, codes: []});
    expect(referenceKeys(row('akizuki', '104326'))).toEqual(['AKIZUKI/104326']);
    expect(referenceKeys(row('m5stack', 'h-light-sensor-unit'))).toEqual(['M5STACK/H-LIGHT-SENSOR-UNIT']);
    expect(referenceKeys({...row('sengoku', 'EEHD-0SS7'), modelNumber: 'SSCI-012164/1216'})).toEqual(['SENGOKU/EEHD-0SS7', 'SWITCH-SCIENCE/1216']);
    // Own pages are unique, so they pair nothing by themselves: the committed candidates still come out unchanged.
    expect(discoverCatalog(catalog, ...discoveryTiers(catalog, aliases)).map(c => c.id)).toEqual(result.candidates.map(c => c.id));
    const sengoku = catalog.listings.find(p => listingKey(p) === 'sengoku/EEHD-6WWU')!;
    const akizuki = catalog.listings.find(p => listingKey(p) === 'akizuki/114531')!;
    const cite = (codes: string[]): Alias[] => [...aliases.filter(a => a.key !== listingKey(sengoku)),
      { key: listingKey(sengoku), fingerprint: fingerprint(sengoku), codes, evidence: '試験用の別名。名前だけが同じ型番を示す組を探索する。', reviewedAt: '2026-11-02' }];
    const id = JSON.stringify(['akizuki', '114531', 'sengoku', 'EEHD-6WWU']);
    expect(generate(catalog, [], [], [], cite([pageReference(akizuki)])).candidates.filter(c => c.products.some(p => listingKey(p) === listingKey(sengoku))))
      .toMatchObject([{ id, codes: ['AKIZUKI/114531'], derived: true }]);
    expect(() => generate(catalog, [], [], [], cite([pageReference(sengoku)]))).toThrow(/alias stale\/invalid: sengoku\/EEHD-6WWU/);
  });
  it('searches later key tiers only for pairs the earlier keys miss', () => {
    const tier = (keys: Record<string, string>) => (p: Listing): string[] => keys[p.storeId] ? [keys[p.storeId]!] : [];
    const a = {...sample, codes: ['A-100']};
    const b = {...sample, storeId: 'right', codes: ['B-100']};
    const forms = tier({ left: 'K-100', right: 'K-100' });
    const refs = tier({ left: 'REF/1', right: 'REF/1' });
    // Found by the first tier: the reference does not join its keys, so its fingerprint and review stay.
    expect(discover([a], [b], forms, refs)).toEqual(discover([a], [b], forms));
    expect(discover([a], [b], forms, refs)[0]!.codes).toEqual(['K-100']);
    // Found only by the reference: a derived pair bound to that key.
    expect(discover([a], [b], tier({}), refs)).toMatchObject([{ codes: ['REF/1'], derived: true, fingerprint: hash(hash(fingerprint(a) + fingerprint(b)) + JSON.stringify(['REF/1'])) }]);
  });
  it('does not read Switch Science naming itself as maker as a maker contradiction', () => {
    const shop = {...sample, storeId: 'switch-science', manufacturer: 'スイッチサイエンス', codes: ['K033']};
    const official = {...sample, storeId: 'm5stack', manufacturer: 'M5Stack', codes: ['K033']};
    expect(discover([shop], [official])).toHaveLength(1);
    expect(discover([{...shop, manufacturer: 'Other'}], [official])).toHaveLength(0);
    expect(discover([{...shop, storeId: 'akizuki'}], [official])).toHaveLength(0); // only Switch Science labels itself so
  });
  it('adds derived pairs as such without changing what the stored codes already find', () => {
    const extra = (p: Listing): string[] => derivedCodes(p);
    const a = {...sample, codes: ['SC0194(9)']};
    const b = {...sample, storeId: 'right', codes: ['SC0194']};
    expect(discover([a], [b])).toEqual([]);
    expect(discover([a], [b], extra)).toMatchObject([{ codes: ['SC0194'], derived: true }]);
    const stored = {...b, codes: ['SC0194(9)']};
    expect(discover([a], [stored], extra)).toEqual(discover([a], [stored]));
    expect(discover([a], [stored], extra)[0]).not.toHaveProperty('derived');
    expect(result.relations.find(r => r.id === JSON.stringify(['ksy', '406', 'sengoku', 'EEHD-57LT']))!.provenance.originalReason).toBe('indexed derived code: SC0065');
  });
  it('accepts an alias only for the current listing, with new codes and evidence, and only when it adds a pair', () => {
    const alias = aliases.find(a => a.key === 'akizuki/118180')!;
    const listing = catalog.listings.find(p => listingKey(p) === alias.key)!;
    const swap = (changed: Alias): Alias[] => aliases.map(a => a.key === alias.key ? changed : a);
    expect(() => generate(catalog, legacy, reviews, families, swap({...alias, fingerprint: 'old'}))).toThrow(/alias stale\/invalid: akizuki\/118180/);
    expect(() => generate(catalog, legacy, reviews, families, swap({...alias, codes: [listing.codes[0]!]}))).toThrow(/alias stale\/invalid/);
    expect(() => generate(catalog, legacy, reviews, families, swap({...alias, codes: ['SC']}))).toThrow(/alias stale\/invalid/);
    expect(() => generate(catalog, legacy, reviews, families, swap({...alias, evidence: '短い'}))).toThrow(/alias stale\/invalid/);
    expect(() => generate(catalog, legacy, reviews, families, [...aliases, alias])).toThrow(/alias stale\/invalid/);
    expect(() => generate(catalog, legacy, reviews, families, swap({...alias, codes: ['ZZZQ-9999']}))).toThrow(/alias adds no candidate: akizuki\/118180/);
    // Akizuki prints only the name; the alias is what pairs it with the code-bearing Zero W listings.
    expect(result.relations.find(r => r.id === 'a118180-s3200')).toMatchObject({ kind: 'same_product', reviewStatus: 'verified' });
    // Each alias code must add a pair of its own: another row's alias pairing the listing does not keep a dead code.
    const zeroW = aliases.find(a => a.key === 'sengoku/EEHD-66P8')!;
    const ss3200 = catalog.listings.find(p => listingKey(p) === 'switch-science/3200')!;
    const byOther: Alias = { key: listingKey(ss3200), fingerprint: fingerprint(ss3200), codes: ['【009】RPI-ZERO-W'],
      evidence: '試験用の別名。せんごくの保存型番で同じ組を見つける。', reviewedAt: '2026-11-01' };
    const swapZeroW = (codes: string[]): Alias[] => [...aliases.map(a => a === zeroW ? {...zeroW, codes} : a), byOther];
    expect(generate(catalog, [], [], [], swapZeroW(['SC0020'])).candidates.find(c => c.id === JSON.stringify(['switch-science', '3200', 'sengoku', 'EEHD-66P8']))).toMatchObject({ derived: true });
    expect(() => generate(catalog, [], [], [], swapZeroW(['ZZZQ-9999']))).toThrow(/alias adds no candidate: sengoku\/EEHD-66P8 ZZZQ-9999/);
    expect(() => generate(catalog, [], [], [], swapZeroW(['SC0020', 'ZZZQ-9999']))).toThrow(/alias adds no candidate: sengoku\/EEHD-66P8 ZZZQ-9999/);
    // A key the listing's own fields already give is not alias evidence.
    const pi4 = aliases.find(a => a.key === 'sengoku/EEHD-655N')!;
    expect(() => generate(catalog, [], [], [], aliases.map(a => a === pi4 ? {...pi4, codes: ['RPI4B-8GB']} : a))).toThrow(/alias stale\/invalid: sengoku\/EEHD-655N/);
  });
  it('binds a review of a derived pair to the keys that found it', () => {
    // Stored-code pairs keep the listing-only fingerprint their reviews were made against.
    expect(result.candidates.filter(c => !c.derived).every(c => c.fingerprint === hash(fingerprint(c.products[0]) + fingerprint(c.products[1])))).toBe(true);
    // The same two rows paired through a different shared alias code is new evidence and needs a new review.
    const review = reviews.find(r => r.id === 'a118180-s3200')!;
    const ss = catalog.listings.find(p => listingKey(p) === 'switch-science/3200')!;
    const moved = [...aliases.map(a => a.key === 'akizuki/118180' ? {...a, codes: ['ZZQ-1234']} : a),
      { key: 'switch-science/3200', fingerprint: fingerprint(ss), codes: ['ZZQ-1234'], evidence: '試験用の別名。同じ組を別の共有コードで見つける。', reviewedAt: '2026-11-01' }];
    expect(generate(catalog, [], [], [], moved).candidates.find(c => c.id === review.id)).toMatchObject({ codes: ['ZZQ-1234'], derived: true });
    expect(() => generate(catalog, [], [review], [], moved)).toThrow(/stale or orphaned: a118180-s3200/);
    expect(generate(catalog, [], [review], [], aliases).relations).toHaveLength(1);
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
    expect(() => generate({...catalog, sources: [...catalog.sources, catalog.sources[0]!]}, [], [], [])).toThrow(/duplicate source/);
    const unknown = structuredClone(catalog); unknown.listings[0]!.storeId = 'unknown';
    expect(() => generate(unknown, [], [], [])).toThrow(/unknown source/);
  });
});

describe('catalogue supplements', () => {
  const m5 = catalog.listings.filter(p => p.storeId === 'm5stack');
  const target = result.candidates.find(c => c.products[1].storeId === 'm5stack' && byId.has(c.id))!.products[1];
  const later = '2026-11-01T00:00:00.000Z';
  const fresh: Listing = {...structuredClone(m5[0]!), pageKey: 'synthetic-new', name: 'Synthetic unit', codes: ['ZZZQ-0001'], expectedModels: ['ZZZQ-0001'], url: 'https://shop.m5stack.com/products/synthetic-new'};
  const snapshot = (rows: Listing[]): SnapshotListings => ({ text: JSON.stringify(rows), observedAt: later, listings: rows.map(p => ({...structuredClone(p), observedAt: later})) });
  const renamed = m5.map(p => listingKey(p) === listingKey(target) ? {...p, name: `${p.name} (renamed)`} : p);

  it('records the pinned sources, the 2026-10-03 and 2026-10-31 supplements and the two re-reviewed rows', () => {
    expect(catalogStores(catalog)).toEqual(['akizuki', 'switch-science', 'm5stack', 'ksy', 'sengoku', 'pimoroni']);
    // KSY's 2026-10-31 list added nothing, so it has no supplement.
    expect(catalog.sources.filter(s => s.supplement).map(s => [s.storeId, s.observedAt.slice(0, 10), s.count, s.supplement!.snapshotCount]))
      .toEqual([['akizuki', '2026-10-03', 4130, 12800], ['switch-science', '2026-10-03', 101, 10442], ['m5stack', '2026-10-03', 9, 672],
        ['akizuki', '2026-10-31', 25, 12815], ['switch-science', '2026-10-31', 60, 10502], ['m5stack', '2026-10-31', 10, 682], ['sengoku', '2026-10-31', 19, 19724]]);
    const retired = catalog.sources.flatMap(s => (s.retired ?? []).map(key => [s.storeId, s.observedAt.slice(0, 10), key]));
    expect(retired).toEqual([['switch-science', '2026-08-02', 'switch-science/6785'], ['m5stack', '2026-09-12', 'm5stack/h-m5stickc-plus-esp32-pico-mini-iot-development-kit']]);
    for (const [, , key] of retired) expect(catalog.listings.find(p => listingKey(p) === key)!.observedAt.slice(0, 10)).toBe('2026-10-03');
    // The projection collapses storefront whitespace, so a re-spaced title is not an identity change.
    for (const p of catalog.listings.filter(p => p.storeId === 'switch-science')) expect(p.name).not.toMatch(/\s{2,}/);
  });

  it('adds only absent rows and keeps a changed pinned row with its reviewed evidence', () => {
    const { catalog: next, report } = appendSupplement(catalog, 'm5stack', 'm5stack-synthetic.json', snapshot([...renamed, fresh]), new Set());
    expect(report).toMatchObject({ added: 1, replaced: [], keptPinned: m5.length, keptPinnedWithChanges: 1, absentFromSnapshot: [], snapshotCount: m5.length + 1 });
    expect(next.sources.at(-1)).toMatchObject({ storeId: 'm5stack', observedAt: later, count: 1, supplement: { snapshotCount: m5.length + 1 } });
    expect(next.listings.slice(0, catalog.listings.length)).toEqual(catalog.listings);
    expect(next.listings.at(-1)).toMatchObject({ pageKey: 'synthetic-new', observedAt: later });
    expect(serializeRelations(generate(next, legacy, reviews, families, aliases).relations)).toBe(serializeRelations(result.relations));
    const shrunk = appendSupplement(catalog, 'm5stack', 'm5stack-synthetic.json', snapshot([fresh]), new Set()).report;
    expect(shrunk.absentFromSnapshot).toHaveLength(m5.length);
  });

  it('replaces a pinned row only when named, retires it on its source and makes citing reviews stale', () => {
    const key = listingKey(target);
    const { catalog: next, report } = appendSupplement(catalog, 'm5stack', 'm5stack-synthetic.json', snapshot(renamed), new Set([key]));
    expect(report.replaced).toEqual([{ key, changed: { name: [target.name, `${target.name} (renamed)`] } }]);
    expect(next.listings.findIndex(p => listingKey(p) === key)).toBe(catalog.listings.findIndex(p => listingKey(p) === key));
    expect(next.sources.find(s => s.storeId === 'm5stack' && s.observedAt === target.observedAt)!.retired).toContain(key);
    expect(() => generate(next, legacy, reviews, families, aliases)).toThrow(/stale/);
    expect(() => appendSupplement(catalog, 'm5stack', 'x.json', snapshot(m5), new Set([key]))).toThrow(/without an identity change/);
    expect(() => appendSupplement(catalog, 'm5stack', 'x.json', snapshot(renamed.filter(p => listingKey(p) !== key).concat(fresh)), new Set([key]))).toThrow(/both catalogues/);
    expect(() => appendSupplement(catalog, 'm5stack', 'x.json', snapshot(m5), new Set())).toThrow(/adds nothing/);
    expect(() => appendSupplement(catalog, 'm5stack', 'x.json', snapshot([fresh, fresh]), new Set())).toThrow(/duplicate listing in m5stack snapshot/);
    expect(() => applySupplements(catalog, [{ storeId: 'm5stack', file: 'x.json', snapshot: snapshot([fresh]) }], new Set(['akizuki/absent']))).toThrow(/no supplement replaced: akizuki\/absent/);
  });

  it('rejects supplements out of order, undercounted snapshots and invalid retired rows', () => {
    const supplement = catalog.sources.findIndex(s => s.storeId === 'm5stack' && s.supplement);
    const first = {...catalog, sources: [catalog.sources[supplement]!, ...catalog.sources.filter((_, i) => i !== supplement)]};
    expect(() => generate(first, [], [], [])).toThrow(/invalid supplement order m5stack/);
    const older = structuredClone(catalog); older.sources[supplement]!.observedAt = '2026-09-01T00:00:00.000Z';
    expect(() => generate(older, [], [], [])).toThrow(/invalid supplement order m5stack/);
    const under = structuredClone(catalog); under.sources[supplement]!.supplement!.snapshotCount = under.sources[supplement]!.count - 1;
    expect(() => generate(under, [], [], [])).toThrow(/invalid supplement order m5stack/);
    const absent = structuredClone(catalog); absent.sources.find(s => s.storeId === 'm5stack' && !s.supplement)!.retired!.push('m5stack/absent');
    expect(() => generate(absent, [], [], [])).toThrow(/invalid retired rows m5stack/);
    const notLater = structuredClone(catalog); notLater.sources[supplement]!.retired = [listingKey(m5.find(p => !p.observedAt.startsWith('2026-10-03'))!)];
    expect(() => generate(notLater, [], [], [])).toThrow(/invalid retired rows m5stack/);
  });
});

describe('KSY source', () => {
  /** The 2026-10-29 public list (the saved response bodies) through the real collector, as the catalogue's KSY source was made. */
  async function ksySnapshotFile(edit?: (raw: Record<string, unknown>) => void): Promise<{ file: string; cleanup: () => void }> {
    const { raw } = await collectKsyFixture();
    edit?.(raw as unknown as Record<string, unknown>);
    const dir = mkdtempSync(path.join(tmpdir(), 'ksy-catalog-'));
    const file = path.join(dir, `ksy-${raw.retrievedAt.replace(/[:.]/g, '-')}.json.gz`);
    writeFileSync(file, gzipSync(JSON.stringify(raw)));
    return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  // The catalogue as it stood when KSY was appended, before the stores and supplements added after it.
  const ksyAt = Date.parse(catalog.sources.find(s => s.storeId === 'ksy')!.observedAt);
  const before = (storeId: string, observedAt: string): boolean => storeId !== 'sengoku' && Date.parse(observedAt) <= ksyAt;
  const upToKsy: Catalog = { ...catalog, sources: catalog.sources.filter(s => before(s.storeId, s.observedAt)), listings: catalog.listings.filter(p => before(p.storeId, p.observedAt)) };
  const withoutKsy: Catalog = { ...upToKsy, sources: upToKsy.sources.filter(s => s.storeId !== 'ksy'), listings: upToKsy.listings.filter(p => p.storeId !== 'ksy') };

  it('is the reproducible projection of the saved public list, appended as the store\'s first source', async () => {
    const { file, cleanup } = await ksySnapshotFile();
    try {
      const snapshot = await snapshotListings('ksy', file);
      expect(snapshot.listings).toHaveLength(776);
      expect(catalog.sources.find(s => s.storeId === 'ksy')).toEqual({ storeId: 'ksy', file: path.basename(file), sha256: hash(snapshot.text), observedAt: snapshot.observedAt, count: 776 });
      expect(appendStore(withoutKsy, 'ksy', file, snapshot)).toEqual(upToKsy);
      expect(() => appendStore(catalog, 'ksy', file, snapshot)).toThrow(/ksy source already exists/);
    } finally { cleanup(); }
  });

  it('keeps the shop\'s maker label as vendor, models as text and the names the published history carries', async () => {
    const { raw } = await collectKsyFixture();
    const ksy = catalog.listings.filter(p => p.storeId === 'ksy');
    for (const item of raw.items) {
      const p = ksy.find(l => l.pageKey === String(item.id))!;
      const { metadata } = normalizeKsyItem(item);
      expect(p).toMatchObject({ name: metadata.name, modelNumber: metadata.modelNumber ?? '', url: metadata.canonicalUrl, manufacturer: '', vendor: item.make.trim(), expectedModels: [metadata.modelNumber ?? ''] });
    }
    const digitOnly = raw.items.find(i => typeof i.model === 'number')!;
    expect(ksy.find(p => p.pageKey === String(digitOnly.id))!.codes).toEqual([String(digitOnly.model)]);
    // A differently written maker label does not rule a pair out; the review decides.
    const official = ksy.find(p => p.vendor === 'ラズベリーパイ財団' && p.codes.includes('SC0364'))!;
    const ss = catalog.listings.find(p => p.storeId === 'switch-science' && p.manufacturer === 'Raspberry Pi Trading' && p.codes.includes('SC0364'))!;
    expect(discover([ss], [official])).toHaveLength(1);
  });

  it('joins the reviewed KSY pairs as identities only and keeps the Pi 5 SC1110 contradiction unresolved', () => {
    // The pairs reviewed when KSY was added, the two the 0.6.5 names found, the UnitV2 family's 0.6.6 relations and the 0.6.7 relations (M5Stack Basic versions, I2C hub 1to6); its pairs with せんごく are checked with that store.
    const ksy = result.relations.filter(r => r.products.some(p => p.storeId === 'ksy') && !r.products.some(p => p.storeId === 'sengoku'));
    expect(ksy).toHaveLength(778);
    for (const r of ksy) expect(r.pricePolicy).toBeNull();
    const id = (...key: string[]): string => JSON.stringify(key);
    // Same precedent as a129606-s10908: the code says 2GB on one side, the other side's name says 1GB.
    expect(byId.get(id('switch-science', '10908', 'ksy', '1095'))).toMatchObject({ kind: 'unresolved', reviewStatus: 'needs_review', provenance: { model: 'Claude Opus 5.5', originalClassification: 'unresolved' } });
    expect(byId.get(id('switch-science', '10908', 'ksy', '1095'))!.evidence).toContain('初回判定（Claude Sonnet 5.5）はRAM容量の相違を理由にrejected');
    expect(byId.get(id('switch-science', '10908', 'ksy', '1272'))).toMatchObject({ kind: 'same_product', reviewStatus: 'verified' });
    expect(byId.get(id('akizuki', '129606', 'ksy', '1095'))).toMatchObject({ kind: 'same_product', reviewStatus: 'verified' });
    expect(byId.get(id('switch-science', '10244', 'ksy', '1184'))!.differences.join()).toContain('500個'); // a reel, not unit pricing.
  });

  it('refuses an incomplete or unknown snapshot', async () => {
    const short = await ksySnapshotFile(raw => { (raw['items'] as unknown[]).pop(); });
    const unknown = await ksySnapshotFile();
    try {
      await expect(snapshotListings('ksy', short.file)).rejects.toThrow(/incomplete ksy snapshot/);
      await expect(snapshotListings('elsewhere', unknown.file)).rejects.toThrow(/unknown store elsewhere/);
    } finally { short.cleanup(); unknown.cleanup(); }
  });
});

describe('せんごく source', () => {
  const sengoku = catalog.listings.filter(p => p.storeId === 'sengoku');

  it('projects the shop\'s rows through its own normalization and maps only four maker labels to the prefix rules', async () => {
    const { raw } = await collectSengokuFixture();
    const rows: [string | null, string][] = [['M5STACK', 'M5STACK-U130'], [null, 'M5STACK-U130'], ['タカチ電機工業', 'RPI-4B-1'], ['Raspberry Pi', 'RPI-SC1677']];
    rows.forEach(([maker, model], i) => Object.assign(raw.items[i]!, { maker, model }));
    const dir = mkdtempSync(path.join(tmpdir(), 'sengoku-catalog-'));
    try {
      const file = path.join(dir, 'sengoku.json.gz');
      writeFileSync(file, gzipSync(JSON.stringify(raw)));
      const { listings, observedAt } = await snapshotListings('sengoku', file);
      expect(listings).toHaveLength(raw.items.length);
      for (const [i, item] of raw.items.entries()) {
        const { pageKey, metadata } = normalizeSengokuItem(item);
        expect(listings[i]).toMatchObject({ storeId: 'sengoku', pageKey, name: metadata.name, modelNumber: metadata.modelNumber ?? '', url: metadata.canonicalUrl,
          manufacturer: '', vendor: item.maker?.trim() ?? '', expectedModels: [metadata.modelNumber ?? ''], observedAt });
      }
      // The shop prefix goes only where its maker label names that manufacturer; the original model stays in expectedModels.
      expect(listings.slice(0, 4).map(p => p.codes)).toEqual([['U130'], ['M5STACK-U130'], ['RPI-4B-1'], ['SC1677']]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('pins the 2026-10-30 snapshot of the 電子工作部品 listings as the store\'s first source', () => {
    expect(catalog.sources.filter(s => s.storeId === 'sengoku' && !s.supplement)).toEqual([{ storeId: 'sengoku', file: 'sengoku-2026-10-30T04-22-21-879Z.json.gz',
      sha256: '850717e5c63f18e62c98b232a2ffc7fb17ad5815c3f8daa044c4cee3f722989a', observedAt: '2026-10-30T04:22:21.879Z', count: 19706 }]);
    expect(sengoku.filter(p => p.observedAt === '2026-10-30T04:22:21.879Z')).toHaveLength(19706);
    expect(sengoku).toHaveLength(19706 + 19);
    for (const p of sengoku) {
      expect(p.url).toBe(`https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=${p.pageKey}`);
      expect(p).toMatchObject({ manufacturer: '', expectedModels: [p.modelNumber] });
    }
    // A prefixed model without a maker label keeps its prefix: the shop did not name the manufacturer.
    expect(sengoku.find(p => p.pageKey === 'EEHD-6D3K')).toMatchObject({ vendor: '', codes: ['DFROBOT-SEN0604'] });
  });

  it('joins every reviewed せんごく pair as an identity only, with the integrating review\'s changes on record', () => {
    // Pimoroni comes after せんごく in the store order, so its pairs have せんごく on the left; they are checked after the loop (#94).
    const joined = result.relations.filter(r => r.products.some(p => p.storeId === 'sengoku') && !r.products.some(p => p.storeId === 'pimoroni'));
    // 3,506 before #94 plus the two M5StickC family pairs of EEHD-6YND (K016-P-SE) with the original M5StickC (m5stack h-stick-c, switch-science 6350), plus the six akizuki pairs the #113 aliases add.
    expect(joined).toHaveLength(3514);
    const withPimoroni = result.relations.filter(r => r.products.some(p => p.storeId === 'sengoku') && r.products.some(p => p.storeId === 'pimoroni'));
    // 325 reviewed pairs (327 candidates, the two name proposals of EEHD-566P rejected) and 9 family pairs with Pimoroni rows.
    expect(withPimoroni).toHaveLength(334);
    for (const r of withPimoroni) { expect(r.products.map(p => p.storeId)).toEqual(['sengoku', 'pimoroni']); expect(r.pricePolicy).toBeNull(); }
    for (const r of joined) {
      expect(r.pricePolicy).toBeNull();
      // The panel swaps `項目: left ↔ right` per product, so せんごく must be the right-hand side.
      expect(r.products[1].storeId).toBe('sengoku');
      // Family relations state the feature values; reviews quote each store.
      for (const d of r.differences) expect(d).toMatch(r.similarity ? /^[^:]+: .+ ↔ .+$/ : /^[^:]+: .+ ↔ せんごく「.+」$/);
    }
    expect(joined.filter(r => r.similarity)).toHaveLength(790); // 788 plus the two M5StickC pairs above
    const id = (...key: string[]): string => JSON.stringify(key);
    // The official page body names StampS3A (recorded by the SS 10300 review); the first review stopped at the title.
    const cardputer = byId.get(id('m5stack', 'h-m5stack-cardputer-with-m5stamps3-v1-1', 'sengoku', 'EEHD-6RTA'))!;
    expect(cardputer).toMatchObject({ kind: 'same_product', reviewStatus: 'verified', provenance: { model: 'Claude Opus 5.5' } });
    expect(cardputer.evidence).toContain('初回判定（Claude Sonnet 5.5）はunresolved');
    // A rating stated differently for one maker part number is a contradiction to resolve, not an identity.
    expect(byId.get(id('akizuki', '100162', 'sengoku', 'EEHD-4F8Y'))).toMatchObject({ kind: 'unresolved', reviewStatus: 'needs_review' });
    // A145 (StampS3) and A145-V033 (StampS3A) are versions the maker numbered apart.
    expect(byId.has(id('switch-science', '10490', 'sengoku', 'EEHD-6N5D'))).toBe(false);
    expect(byId.get(id('switch-science', '10490', 'sengoku', 'EEHD-6UVG'))!.kind).toBe('same_product');
    // A four-digit number shared by a connector and an Adafruit board; the board is listed again as ADA-2305.
    expect(byId.has(id('switch-science', '2178', 'sengoku', '4D3H-PCLW'))).toBe(false);
    expect(byId.get(id('switch-science', '2178', 'sengoku', 'EEHD-54SJ'))!.kind).toBe('same_product');
  });

  it('joins the pairs the #48 keys find, each through its own review (0.6.4)', () => {
    const id = (...key: string[]): string => JSON.stringify(key);
    const verified = { kind: 'same_product', reviewStatus: 'verified' };
    // An ordering suffix, a resale number, a maker prefix and a vendor-gated 【N】.
    expect(byId.get(id('akizuki', '110013', 'sengoku', '6Z2W-2DG8'))).toMatchObject(verified); // TC74HC138AP(F)
    expect(byId.get(id('switch-science', '1216', 'sengoku', 'EEHD-0SS7'))).toMatchObject(verified); // SSCI-012164/1216
    expect(byId.get(id('switch-science', '6621', 'm5stack', 'h-barometric-pressure-unitbmp280'))).toMatchObject(verified); // M5STACK-U090
    expect(byId.get(id('switch-science', '3650', 'sengoku', 'EEHD-58CC'))).toMatchObject(verified); // 【3650】 on an M5STACK row
    // The shared base code also finds other ranks; the review keeps only the GB rank.
    expect(byId.get(id('akizuki', '107554', 'sengoku', 'EEHD-0HY7'))).toMatchObject(verified);
    expect(byId.has(id('akizuki', '107553', 'sengoku', 'EEHD-0HY7'))).toBe(false);
    // The integrating review aligned a KSY pair with the Switch Science pairs of both rows.
    const blinkt = byId.get(id('ksy', '239', 'sengoku', 'EEHD-53P6'))!;
    expect(blinkt).toMatchObject({ ...verified, provenance: { model: 'Claude Opus 5.5' } });
    expect(blinkt.evidence).toContain('初回判定（Claude Sonnet 5.5）はunresolved');
  });

  it('joins the pairs the names propose, each through its own review, and leaves none open (0.6.5)', () => {
    const id = (...key: string[]): string => JSON.stringify(key);
    const verified = { kind: 'same_product', reviewStatus: 'verified' };
    const candidate = (key: string) => result.candidates.find(c => c.id === key);
    expect(result.report.nameProposals).toEqual([]);
    // A maker's own code in a listing without a model field.
    expect(byId.get(id('akizuki', '114531', 'sengoku', 'EEHD-6WWU'))).toMatchObject(verified); // NJM555D
    // Toshiba's own code; (F) is its lead-free order suffix, as in the 0.6.4 TC74HC00AP(F) pairs.
    const tlp = byId.get(id('akizuki', '107551', 'sengoku', '5A8C-CJLH'))!;
    expect(tlp).toMatchObject({ ...verified, provenance: { model: 'Claude Opus 5.5' } });
    expect(tlp.evidence).toContain('初回判定（Claude Sonnet 5.5）は要確認');
    // A designation several makers use stays unresolved while one side names no maker.
    expect(byId.get(id('akizuki', '111946', 'sengoku', '1AD1-0035'))).toMatchObject({ kind: 'unresolved', reviewStatus: 'needs_review' }); // T-50-2
    // Mating halves are not alternatives: the rejected pair keeps its candidate and gets no relation.
    expect(candidate(id('akizuki', '117954', 'sengoku', 'EEHD-5GMG'))).toBeDefined();
    expect(byId.has(id('akizuki', '117954', 'sengoku', 'EEHD-5GMG'))).toBe(false);
    // A legacy unresolved row, re-evaluated by the review of its proposal with the earlier judgement on record.
    expect(byId.has('a106875-s1607')).toBe(false);
    expect(reviews.find(r => r.id === 'a106875-s1607')!.evidence).toContain('既存の対応表（legacy.json）ではunresolved');
    // The alias adds the official variant's code; the pair the resale number already found keeps its own key.
    expect(candidate(id('m5stack', 'h-m5stickc-speaker-hat', 'sengoku', 'EEHD-5HEF'))!.codes).toEqual(['U055']);
    expect(candidate(id('switch-science', '5754', 'sengoku', 'EEHD-5HEF'))!.codes).toEqual(['SWITCH-SCIENCE/5754']);
    // A similar family names the official variant it compares.
    expect(byId.get(id('akizuki', '108218', 'm5stack', 'h-dual-kemter-module-13-2-max31855'))).toMatchObject({
      kind: 'similar_product', reviewStatus: 'verified', products: [{ storeId: 'akizuki' }, { offer: { id: '43810080194817' } }] });
  });

  it('requires a family member with store variants to name one, and no other member to (0.6.5)', () => {
    const kmeter = (): Family => structuredClone(families.find(f => f.id === 'name-max31855')!);
    const unnamed = kmeter();
    delete unnamed.members.find(m => m.key.startsWith('m5stack/'))!.offerId;
    expect(() => generate(catalog, legacy, reviews, [unnamed], aliases)).toThrow(/family member stale\/invalid: name-max31855\/m5stack\//);
    const missing = kmeter();
    missing.members.find(m => m.key.startsWith('m5stack/'))!.offerId = 'missing';
    expect(() => generate(catalog, legacy, reviews, [missing], aliases)).toThrow(/family member stale\/invalid: name-max31855\/m5stack\//);
    const plain = kmeter();
    plain.members.find(m => m.key.startsWith('akizuki/'))!.offerId = '43810080194817';
    expect(() => generate(catalog, legacy, reviews, [plain], aliases)).toThrow(/family member stale\/invalid: name-max31855\/akizuki\/108218/);
  });

});

describe('similar-product leads (0.6.6)', () => {
  it('proposes listings that both have codes only as similar leads, each put in a family or dismissed (0.6.6)', () => {
    const id = (...key: string[]): string => JSON.stringify(key);
    expect(result.report.similarProposals).toEqual([]);
    // 0.6.6 and 0.6.7 together; the identity dismissals were settled by alias and review (#52 for 0.6.6, #53 for 0.6.7).
    expect(result.report.dismissedLeads).toEqual({ different: 69, identity: 0 }); // 65 plus the four Pimoroni stems that are coincidences (ADA4075, ADA4084 twice, TP-01; #94)
    const stemFamilies = families.filter(f => f.id.startsWith('stem-'));
    expect(stemFamilies).toHaveLength(124); // plus stem-k059, stem-m031-c and stem-kitronik-5610 (#94)
    for (const f of stemFamilies) expect(result.report.familyCounts[f.id]).toBeGreaterThan(0);
    expect(stemFamilies.reduce((n, f) => n + result.report.familyCounts[f.id]!, 0)).toBe(650); // 592 plus 58 pairs: the three new families, the 15 Pimoroni members joining existing families, and the two M5StickC members (#94)
    // Without the reviewed families and dismissals, the leads are open again.
    expect(generate(catalog, legacy, reviews, families.filter(f => !f.id.startsWith('stem-')), aliases).report.similarProposals).toHaveLength(665); // 613 plus the 52 Pimoroni leads those families and the four dismissals settle (#94)
    expect(generate(catalog, legacy, reviews, families, aliases).similarProposals).toHaveLength(69); // the 69 dismissed leads
    // Variants of one line become similar products and name the M5Stack offer.
    expect(byId.get(id('switch-science', '7536', 'm5stack', 'h-m5stack-unitv2-usb-version-without-camera'))).toMatchObject({
      kind: 'similar_product', reviewStatus: 'verified', similarity: { family: 'UnitV2 AIカメラ' },
      differences: ['型番: U078-M12 ↔ U078-USB', '版: M12版 ↔ USBカメラ対応版(カメラ非搭載)'], products: [{ storeId: 'switch-science' }, { storeId: 'm5stack', offer: {} }] });
    // The integrating review split ATOMS3R into camera kits and controllers: a camera kit is no substitute for the screen kit.
    expect(byId.has(id('switch-science', '9916', 'm5stack', 'h-atoms3r-dev-kit'))).toBe(false);
    expect(dismissals.find(d => d.products.join(' ') === 'switch-science/9916 m5stack/h-atoms3r-dev-kit')).toMatchObject({ decision: 'different', reviewerModel: 'Claude Opus 5.5' });
    expect(byId.get(id('switch-science', '9916', 'm5stack', 'h-atoms3r-camera-kit-m12-version-ov3660'))).toMatchObject({ kind: 'similar_product', similarity: { family: 'ATOMS3R カメラキット' } });
  });

  it('binds a dismissal to a current lead and both listings (0.6.6)', () => {
    const lead = dismissals[0]!;
    const swap = (changed: Dismissal): Dismissal[] => [changed, ...dismissals.slice(1)];
    expect(() => generate(catalog, legacy, reviews, families, aliases, [...dismissals, lead])).toThrow(/dismissal stale\/orphaned/);
    expect(() => generate(catalog, legacy, reviews, families, aliases, swap({ ...lead, fingerprint: 'old' }))).toThrow(/dismissal stale\/orphaned/);
    expect(() => generate(catalog, legacy, reviews, families, aliases, swap({ ...lead, products: [lead.products[1], lead.products[0]] }))).toThrow(/dismissal stale\/orphaned/);
    expect(() => generate(catalog, legacy, reviews, families, aliases, swap({ ...lead, evidence: '短い' }))).toThrow(/dismissal evidence required/);
    expect(() => generate(catalog, legacy, reviews, families, aliases, swap({ ...lead, decision: 'similar' as Dismissal['decision'] }))).toThrow(/dismissal evidence required/);
    // A candidate is decided by its review, and a family pair by the family: neither is a lead.
    const candidate = result.candidates[0]!;
    expect(() => generate(catalog, legacy, reviews, families, aliases, [...dismissals, { ...lead, products: [listingKey(candidate.products[0]), listingKey(candidate.products[1])], fingerprint: candidate.fingerprint }]))
      .toThrow(/dismissal stale\/orphaned/);
    const camera = families.find(f => f.label === 'ATOMS3R カメラキット')!;
    const [a, b] = ['switch-science/9916', 'm5stack/h-atoms3r-camera-kit-m12-version-ov3660'].map(key => catalog.listings.find(p => listingKey(p) === key)!);
    expect(camera.members.map(m => m.key)).toEqual(expect.arrayContaining([listingKey(a!), listingKey(b!)]));
    expect(() => generate(catalog, legacy, reviews, families, aliases, [...dismissals, { ...lead, products: [listingKey(a!), listingKey(b!)], fingerprint: hash(fingerprint(a!) + fingerprint(b!)) }]))
      .toThrow(/dismissal stale\/orphaned/);
  });
});

describe('base-code leads and the settled identities (0.6.7)', () => {
  it('decides every base-code lead: a version the maker sells apart joins a family, an unexplained suffix waits for the identity review', () => {
    const id = (...key: string[]): string => JSON.stringify(key);
    // The dismissed leads, by tier: every identity was settled by alias and review (#52, #53), so only `different` is left.
    const dismissed = generate(catalog, legacy, reviews, families, aliases).similarProposals;
    const tally = (leads: typeof dismissed): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const lead of leads) {
        const decision = dismissals.find(d => d.products.join(' ') === lead.products.join(' '))!.decision;
        counts[decision] = (counts[decision] ?? 0) + 1;
      }
      return counts;
    };
    expect(tally(dismissed.filter(p => p.tokens.length === 0))).toEqual({ different: 36 }); // 32 plus the four Pimoroni stem coincidences, which share no name word (#94)
    expect(tally(dismissed.filter(p => p.tokens.length > 0))).toEqual({ different: 33 });
    // Without the stem families, 425 base-code leads are open (391 plus the 34 Pimoroni ones, #94): names need not share a word.
    const open = generate(catalog, legacy, reviews, families.filter(f => !f.id.startsWith('stem-')), aliases).similarProposals;
    expect(open.filter(p => p.tokens.length === 0)).toHaveLength(425);
    // A004 and A004-V3 (v3.0) are SKUs the maker sells apart, so the first decision (identity) became a family.
    expect(byId.get(id('switch-science', '6612', 'm5stack', 'h-m5stack-faces-gamepad-panel-v3-0'))).toMatchObject({
      kind: 'similar_product', reviewStatus: 'verified', similarity: { family: 'M5Stack Faces用ゲームパッドパネル' }, differences: ['型番: A004 ↔ A004-V3'] });
    expect(byId.get(id('akizuki', '117214', 'm5stack', 'h-fire-iot-development-kit'))).toMatchObject({ kind: 'similar_product', similarity: { family: 'M5Stack FIRE IoT開発キット' } });
    // One line split over two groups is one family with one way of writing each feature.
    expect(byId.get(id('switch-science', '5208', 'sengoku', 'EEHD-6UML'))).toMatchObject({ similarity: { family: 'M5Stack用NeoPixel互換 LEDテープ' }, differences: ['型番: A035 ↔ A035-B', '長さ: 10cm ↔ 20cm'] });
    // Features are facts from the fields: the first A090 is told apart by what its name states, not by an absence.
    expect(byId.get(id('switch-science', '9511', 'm5stack', 'h-atomic-motion-base-v1-1'))).toMatchObject({
      similarity: { family: 'ATOMIC Motion ベース' }, differences: ['型番: A090 ↔ A090-V11', '構成: STM32F030 ↔ v1.1・電力モニター INA226AIDGSR'] });
    // MP-121M-1 says nothing the fields explain: never a similar product (#53 made it an unresolved review).
    expect(byId.get(id('akizuki', '100091', 'sengoku', 'EEHD-0HNH'))).toMatchObject({ kind: 'unresolved' });
  });

  it('settles the 0.6.6 identity dismissals by alias and review, never by a family (#52)', () => {
    const id = (...key: string[]): string => JSON.stringify(key);
    expect(dismissals.some(d => d.products.join(' ') === 'akizuki/131361 switch-science/10792')).toBe(false);
    expect(byId.get('a131361-s10792')).toMatchObject({ kind: 'same_product', reviewStatus: 'verified', provenance: { model: 'Claude Opus 5.5' } });
    expect(byId.get('a131361-s10792')!.evidence).toContain('初回判定（Claude Sonnet 5.5、0.6.6）は同一の可能性');
    // The COMM Edition is a configuration the maker numbered apart (K049-C): a similar product of the M5Paper.
    expect(byId.get(id('switch-science', '6749', 'm5stack', 'h-m5paper-esp32-development-kit-comm-edition'))).toMatchObject({
      kind: 'similar_product', similarity: { family: 'M5Paper' }, differences: ['型番: K049 ↔ K049-C', '版: M5Paper ↔ M5Paper COMM Edition'] });
  });
});

describe('the settled 0.6.7 identities (0.6.8)', () => {
  it('settles every 0.6.7 identity dismissal by alias and review, or by a family the fields support (#53)', () => {
    const id = (...key: string[]): string => JSON.stringify(key);
    expect(dismissals.filter(d => d.decision === 'identity')).toEqual([]);
    const settled = reviews.filter(r => r.evidence.includes('#53'));
    expect(settled).toHaveLength(43);
    for (const r of settled) {
      expect(r).toMatchObject({ decision: 'unresolved', reviewerModel: 'Claude Opus 5.5' });
      expect(r.evidence).toContain('初回判定（Claude Sonnet 5.5、0.6.7）は同一の可能性');
      expect(r.missingEvidence.length).toBeGreaterThan(0);
    }
    // An unstated rank or colour is missing evidence, not a difference: the pair is shown as unresolved.
    expect(byId.get(id('akizuki', '117089', 'sengoku', 'EEHD-4ZNJ'))).toMatchObject({ kind: 'unresolved', missingEvidence: ['秋月電子品のhFEランク'] });
    expect(byId.get('a107037-s4145')).toMatchObject({ kind: 'unresolved', missingEvidence: ['秋月電子品の色'] });
    // A store that sells both codes apart, or the names, tell the two products apart: a family.
    expect(byId.get(id('akizuki', '117410', 'sengoku', 'EEHD-0RA8'))).toMatchObject({
      kind: 'similar_product', similarity: { family: 'バナナプラグ P-416系' }, differences: ['型番: P-416-5(E)R ↔ P-416(E)R'] });
    expect(byId.get(id('switch-science', '5207', 'm5stack', 'h-esp32-fisheve-camera-modulewith-psram-ov2640'))).toMatchObject({
      kind: 'similar_product', differences: ['型番: U017 ↔ U017-PCBA', '英語名: PSRAM Camera Module with ESP32 WROVER (OV2640) ↔ ESP32 Fisheye Camera Module with PSRAM (OV2640)'] });
    // The akizuki terminal comes from the せんごく row it is the same product as, not from its own name.
    expect(byId.get(id('akizuki', '114312', 'sengoku', 'EEHD-4HNL'))).toMatchObject({ kind: 'same_product' });
    expect(byId.get(id('akizuki', '114312', 'sengoku', 'EEHD-4HNU'))).toMatchObject({
      kind: 'similar_product', differences: ['型番: D2F-01 ↔ D2F-01-D', '端子: 基板用端子ストレート形 ↔ はんだづけ小型端子'] });
  });
});

describe('Pimoroni source', () => {
  const pimoroni = catalog.listings.filter(p => p.storeId === 'pimoroni');
  const withoutPimoroni: Catalog = { ...catalog, sources: catalog.sources.filter(s => s.storeId !== 'pimoroni'), listings: catalog.listings.filter(p => p.storeId !== 'pimoroni') };
  /** The repository's saved capture through the real collector, written as the complete snapshot file the importer reads. */
  async function pimoroniSnapshotFile(edit?: (raw: ShopifySnapshot) => void): Promise<{ file: string; raw: ShopifySnapshot; cleanup: () => void }> {
    const { raw } = await collectPimoroniFixture();
    edit?.(raw);
    const dir = mkdtempSync(path.join(tmpdir(), 'pimoroni-catalog-'));
    const file = path.join(dir, `pimoroni-${raw.retrievedAt.replace(/[:.]/g, '-')}.json.gz`);
    writeFileSync(file, gzipSync(JSON.stringify(raw)));
    return { file, raw, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const skuCodes = (variants: { sku: string | null }[]): string[] => [...new Set(variants.map(v => normalizeCode(v.sku ?? '')).filter(Boolean))].sort();

  it('projects every product through the store\'s own normalization, keeping the vendor label and no manufacturer', async () => {
    const { file, raw, cleanup } = await pimoroniSnapshotFile();
    try {
      const { listings, observedAt } = await snapshotListings('pimoroni', file);
      const normalized = new Map((await loadPimoroniNormalized()).products.map(n => [n.pageKey, n]));
      expect(listings).toHaveLength(raw.items.length);
      expect(normalized.size).toBe(raw.items.length);
      for (const [i, item] of raw.items.entries()) {
        const n = normalized.get(listings[i]!.pageKey)!;
        // The runtime compares expectedNames / expectedModels with the published `current`: same fields, same fallback.
        expect(listings[i]).toMatchObject({ storeId: 'pimoroni', name: n.metadata.name, modelNumber: n.metadata.modelNumber ?? '', url: n.metadata.canonicalUrl,
          manufacturer: '', manufacturerProductName: '', manufacturerProductCode: '', vendor: item.vendor ?? '', expectedModels: [n.metadata.modelNumber ?? ''], observedAt,
          variants: item.variants.map(v => ({ offerId: String(v.id), sku: v.sku ?? '', name: v.title })), codes: skuCodes(item.variants) });
      }
      const one = raw.items.findIndex(p => p.variants.length === 1);
      const many = raw.items.findIndex(p => p.variants.length > 1);
      // One variant: its SKU is the model. Several: the model is empty (as the published history has none) and every variant SKU is a code.
      expect(listings[one]!.modelNumber).toBe(raw.items[one]!.variants[0]!.sku);
      expect(listings[many]).toMatchObject({ modelNumber: '', expectedModels: [''] });
      expect(listings[many]!.codes).toEqual(skuCodes(raw.items[many]!.variants));
      expect(listings[many]!.codes.length).toBeGreaterThan(1);
    } finally { cleanup(); }
  });

  it('maps no vendor label to a manufacturer: no Pimoroni SKU carries a shop prefix, so a prefixed one is kept as written', async () => {
    const rows: [string, string][] = [['M5Stack', 'M5STACK-U130'], ['Raspberry Pi', 'RPI-SC1677'], ['DFRobot', 'DFROBOT-SEN0604']];
    const { file, cleanup } = await pimoroniSnapshotFile(raw => rows.forEach(([vendor, sku], i) => { Object.assign(raw.items[i]!, { vendor }); raw.items[i]!.variants = [{ ...raw.items[i]!.variants[0]!, sku }]; }));
    try {
      const { listings } = await snapshotListings('pimoroni', file);
      expect(listings.slice(0, 3).map(p => [p.vendor, p.manufacturer, p.codes])).toEqual(rows.map(([vendor, sku]) => [vendor, '', [sku]]));
    } finally { cleanup(); }
  });

  it('does not let a differently written maker label rule a pair out', () => {
    const official = pimoroni.find(p => p.vendor === 'Raspberry Pi' && p.codes.includes('SC0940'))!;
    const ss = catalog.listings.find(p => p.storeId === 'switch-science' && p.manufacturer === 'Raspberry Pi Trading' && p.codes.includes('SC0940'))!;
    expect(discover([ss], [official])).toHaveLength(1);
  });

  it('refuses an incomplete snapshot, and a second source for a store that has one', async () => {
    const short = await pimoroniSnapshotFile(raw => { raw.items.pop(); });
    try {
      await expect(snapshotListings('pimoroni', short.file)).rejects.toThrow(/incomplete pimoroni snapshot/);
      expect(() => appendStore(catalog, 'pimoroni', short.file, { text: '{}', observedAt: '2026-11-10T00:00:00.000Z', listings: [] })).toThrow(/pimoroni source already exists/);
    } finally { short.cleanup(); }
  });

  it('pins the complete 2026-11-09 snapshot as the store\'s first source, appended after every other row', () => {
    expect(catalog.sources.filter(s => s.storeId === 'pimoroni')).toEqual([{ storeId: 'pimoroni', file: 'pimoroni-2026-11-09T02-03-01-206Z.json.gz',
      sha256: 'b1cab290e508b09da24e505e726860827ef35e35ce6649306664826dd5a9923d', observedAt: '2026-11-09T02:03:01.206Z', count: 2854 }]);
    expect(catalogStores(catalog).at(-1)).toBe('pimoroni');
    expect(catalog.listings.slice(-pimoroni.length)).toEqual(pimoroni);
    expect(pimoroni).toHaveLength(2854);
    expect(pimoroni.reduce((n, p) => n + p.variants!.length, 0)).toBe(3789);
    for (const p of pimoroni) {
      expect(p.url).toBe(shopifyProductUrl(PIMORONI_STORE, shopifyHandleFromKey(PIMORONI_STORE, p.pageKey)!));
      expect(p).toMatchObject({ manufacturer: '', observedAt: '2026-11-09T02:03:01.206Z', expectedModels: [p.modelNumber] });
      expect(p.vendor).toBeTruthy();
      expect(p.modelNumber).toBe(p.variants!.length === 1 ? p.variants![0]!.sku : '');
      expect(p.codes).toEqual(skuCodes(p.variants!));
    }
    // The page key is the reversible handle key the published history uses.
    expect(pimoroni.find(p => p.pageKey === 'h-presto')!.url).toBe('https://shop.pimoroni.com/products/presto');
  });

  // The snapshot is the 2026-11-09 daily run's artifact and is not in the repository. Set PIMORONI_SNAPSHOT to that file to prove the rows byte for byte.
  it.skipIf(!process.env['PIMORONI_SNAPSHOT'])('reproduces the catalogue\'s Pimoroni rows and source record from the saved snapshot file', async () => {
    const file = process.env['PIMORONI_SNAPSHOT']!;
    const rebuilt = appendStore(withoutPimoroni, 'pimoroni', file, await snapshotListings('pimoroni', file));
    expect(rebuilt).toEqual(catalog);
    expect(serializeCatalog(rebuilt)).toBe(read('catalog.jsonl'));
  });
});

describe('the matching CLI', () => {
  it('runs one operation at a time, so a read-only queue request never writes mapping inputs', () => {
    const before = readFileSync('data/matching/catalog.jsonl', 'utf8');
    for (const flags of [['--names', '--similar'], ['--supplement', 'switch-science=missing.json', '--names'], ['--discover', '--check'], ['--replace', 'akizuki/100091']]) {
      const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/matching/generate.ts', ...flags], { encoding: 'utf8', timeout: 60_000 });
      expect(run.status, flags.join(' ')).not.toBe(0);
      expect(run.stderr).toMatch(/choose one operation|--replace requires --supplement/);
    }
    expect(readFileSync('data/matching/catalog.jsonl', 'utf8')).toBe(before);
  });
});
