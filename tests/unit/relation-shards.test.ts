import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { relationProductKey, type ProductRelation, type RelationProduct } from '../../userscript/core/relations.ts';
import { packRelations, unpackRelations, type PackedRelationTable } from '../../userscript/core/relationTable.ts';
import { RELATION_INDEX_FILE, RELATION_SHARD_COUNT, relationShardFile, relationShardIn, relationsInShard, shardRelations, type RelationIndex } from '../../userscript/core/relationShards.ts';

/**
 * The build writes the index and the shards and the service worker reads them back, so what a page is
 * told must be what the whole table would tell it, for every product, in the same order.
 */

const keysOf = (relations: readonly ProductRelation[]): Set<string> =>
  new Set(relations.flatMap((r) => r.products.map((p) => relationProductKey(p.storeId, p.pageKey))));
const split = (key: string): [string, string] => JSON.parse(key) as [string, string];
const wholeTableFor = (storeId: string, pageKey: string): ProductRelation[] =>
  PRODUCT_RELATIONS.filter((r) => r.products.some((p) => p.storeId === storeId && p.pageKey === pageKey));

describe('relation shards over the real table', () => {
  const { index, shards } = shardRelations(PRODUCT_RELATIONS);
  // Rounded through JSON as the package is: the files on disk are what the worker reads.
  const onDiskIndex = JSON.parse(JSON.stringify(index)) as RelationIndex;
  const onDisk = shards.map((table) => JSON.parse(JSON.stringify(table)) as PackedRelationTable);

  it('stores every relation exactly once', () => {
    const ids = onDisk.flatMap((table) => unpackRelations(table).map((r) => r.id));
    expect(ids).toHaveLength(PRODUCT_RELATIONS.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(PRODUCT_RELATIONS.map((r) => r.id)));
  });

  it('gives every product the relations the whole table gives it, in table order, from the shard the index names', () => {
    const keys = keysOf(PRODUCT_RELATIONS);
    expect(keys.size).toBeGreaterThan(1000);
    for (const key of keys) {
      const [storeId, pageKey] = split(key);
      const shard = relationShardIn(onDiskIndex, storeId, pageKey);
      expect(shard, key).not.toBeNull();
      expect(relationsInShard(onDisk[shard!]!, storeId, pageKey), key).toEqual(wholeTableFor(storeId, pageKey));
    }
  });

  it('indexes exactly the products that have a relation, and gives any other product null', () => {
    const count = Object.values(onDiskIndex.products).reduce((n, pages) => n + Object.keys(pages).length, 0);
    expect(count).toBe(keysOf(PRODUCT_RELATIONS).size);
    for (const [storeId, pageKey] of [['akizuki', 'no-such-page'], ['nobody', '1'], ['', '']] as const) expect(relationShardIn(onDiskIndex, storeId, pageKey)).toBeNull();
  });

  it('puts both endpoints of every relation in the same shard', () => {
    for (const relation of PRODUCT_RELATIONS) {
      const [a, b] = relation.products.map((p) => relationShardIn(onDiskIndex, p.storeId, p.pageKey));
      expect(a, relation.id).not.toBeNull();
      expect(a, relation.id).toBe(b);
    }
  });

  it('makes exactly RELATION_SHARD_COUNT tables and an index that says so', () => {
    expect(RELATION_SHARD_COUNT).toBe(64);
    expect(shards).toHaveLength(RELATION_SHARD_COUNT);
    expect(index).toMatchObject({ version: 1, shards: 64 });
    expect(shardRelations([])).toEqual({ index: { version: 1, shards: 64, products: {} }, shards: Array.from({ length: 64 }, () => packRelations([])) });
  });

  it('is deterministic: the same table gives byte-identical output', () => {
    expect(JSON.stringify(shardRelations(PRODUCT_RELATIONS))).toBe(JSON.stringify({ index, shards }));
  });
});

/** A relation between two endpoints of the made-up stores `s` and `t`; only the keys matter to the packing. */
function endpoint(storeId: string, pageKey: string): RelationProduct {
  return { storeId, pageKey, name: pageKey, modelNumber: pageKey, url: `https://example.test/${storeId}/${pageKey}`, observedAt: '2026-01-01', expectedNames: [pageKey], expectedModels: [pageKey] };
}
function relation(id: string, a: [string, string], b: [string, string]): ProductRelation {
  return {
    id, kind: 'same_product', reviewStatus: 'verified', products: [endpoint(...a), endpoint(...b)], evidence: id, differences: [], missingEvidence: [], reviewedAt: '2026-01-01',
    provenance: { method: 'catalog', model: null, originalClassification: null, originalReason: null }, pricePolicy: null,
  };
}
const shardOf = (index: RelationIndex, storeId: string, pageKey: string): number | null => relationShardIn(index, storeId, pageKey);
const idsIn = (table: PackedRelationTable): string[] => unpackRelations(table).map((r) => r.id);

describe('packing rule on a made-up table', () => {
  it('breaks a weight tie by first appearance in the table, not by product key: the heaviest goes first, then the earlier of two equal ones', () => {
    // The two weight-1 components tie. Key order would place a (smaller key) first; table order places z first.
    const table = [
      relation('first-tie', ['s', 'z'], ['t', 'z']),
      relation('second-tie', ['s', 'a'], ['t', 'a']),
      relation('heavy', ['s', 'm1'], ['t', 'm1']), relation('heavy-2', ['t', 'm1'], ['s', 'm2']),
    ];
    const { index } = shardRelations(table);
    expect(shardOf(index, 's', 'm1')).toBe(0); // weight 2, though it appears last
    expect(shardOf(index, 's', 'z')).toBe(1); // weight 1, appears first
    expect(shardOf(index, 's', 'a')).toBe(2); // weight 1, appears second, smaller key
  });

  it('places components heaviest first, equal weights in first-appearance order, each in the lowest-numbered empty shard', () => {
    // Input order is the reverse of the placement order, so only the rule can produce the result.
    const table = [
      relation('light', ['s', 'a'], ['t', 'a']),
      relation('heavy-z1', ['s', 'z1'], ['t', 'z1']), relation('heavy-z2', ['t', 'z1'], ['s', 'z2']),
      relation('mid-m1', ['s', 'm1'], ['t', 'm1']), relation('mid-m2', ['t', 'm1'], ['s', 'm2']),
      relation('mid-b1', ['s', 'b1'], ['t', 'b1']), relation('mid-b2', ['t', 'b1'], ['s', 'b2']),
      relation('top-1', ['s', 'y1'], ['t', 'y1']), relation('top-2', ['t', 'y1'], ['s', 'y2']), relation('top-3', ['s', 'y2'], ['t', 'y2']),
    ];
    const { index } = shardRelations(table);
    // weight 3 first; then the three of weight 2 in first-appearance order (z1, m1, b1); then weight 1.
    expect(['y1', 'z1', 'm1', 'b1', 'a'].map((key) => shardOf(index, 's', key))).toEqual([0, 1, 2, 3, 4]);
    expect(shardOf(index, 't', 'z1')).toBe(1);
  });

  it('puts a component in the least-loaded shard, the lowest number on a tie, and keeps table order inside a shard', () => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const pair = (n: number): ProductRelation => relation(`single-${pad(n)}`, ['s', `k${pad(n)}`], ['t', `k${pad(n)}`]);
    const heavy = [relation('heavy-1', ['s', 'h1'], ['t', 'h1']), relation('heavy-2', ['t', 'h1'], ['s', 'h2'])];
    const singles = Array.from({ length: 64 }, (_, n) => pair(n));
    // Reversed: later singles come first in the table, so k63 is the first weight-1 component to appear and k00 the last.
    const table = [...singles].reverse().concat(heavy);
    const { index, shards } = shardRelations(table);
    expect(shardOf(index, 's', 'h1')).toBe(0); // weight 2: first
    for (let n = 1; n < 64; n++) expect(shardOf(index, 's', `k${pad(n)}`), `k${pad(n)}`).toBe(64 - n);
    // Shard 0 holds weight 2 and shards 1..63 weight 1, so the last single (k00) goes to shard 1, the lowest of those, not back to 0.
    expect(shardOf(index, 's', 'k00')).toBe(1);
    expect(shardOf(index, 's', 'k63')).toBe(1);
    expect(idsIn(shards[0]!)).toEqual(['heavy-1', 'heavy-2']);
    expect(idsIn(shards[1]!)).toEqual(['single-63', 'single-00']); // table order, not placement order
    expect(shards.reduce((n, s) => n + s.relations.length, 0)).toBe(table.length);
  });

  it('is deterministic whatever the call', () => {
    const table = [relation('a', ['s', '1'], ['t', '1']), relation('b', ['s', '2'], ['t', '2']), relation('c', ['t', '1'], ['s', '3'])];
    expect(JSON.stringify(shardRelations(table))).toBe(JSON.stringify(shardRelations(table)));
  });

  it('keeps one relation whose endpoints are the same product once, in one shard', () => {
    const twin = relation('twin', ['s', '1'], ['s', '1']);
    const { shards } = shardRelations([twin]);
    expect(shards.map(idsIn).flat()).toEqual(['twin']);
  });
});

describe('relationShardIn', () => {
  const valid = { version: 1, shards: 64, products: { akizuki: { '116132': 5 }, ksy: { x: 0 } } };

  it('finds an entry and returns null for a product without one', () => {
    expect(relationShardIn(valid, 'akizuki', '116132')).toBe(5);
    expect(relationShardIn(valid, 'ksy', 'x')).toBe(0);
    expect(relationShardIn(valid, 'ksy', 'y')).toBeNull();
    expect(relationShardIn(valid, 'other', 'x')).toBeNull();
  });

  it('throws on a malformed index, with the message for each cause', () => {
    expect(() => relationShardIn('index', 'a', 'b')).toThrow(/relation index: not an object$/);
    expect(() => relationShardIn(null, 'a', 'b')).toThrow(/relation index: not an object$/);
    expect(() => relationShardIn({ ...valid, version: 2 }, 'akizuki', '1')).toThrow(/relation index: unsupported version 2$/);
    expect(() => relationShardIn({ ...valid, shards: 32 }, 'akizuki', '1')).toThrow(/relation index: unexpected shard count 32$/);
    expect(() => relationShardIn({ ...valid, products: null }, 'akizuki', '1')).toThrow(/relation index: no products$/);
    expect(() => relationShardIn({ ...valid, products: 'x' }, 'akizuki', '1')).toThrow(/relation index: no products$/);
    expect(() => relationShardIn({ version: 1, shards: 64 }, 'akizuki', '1')).toThrow(/relation index: no products$/);
  });

  it('throws on an entry that is not an integer in 0..63, or a store entry that is not an object', () => {
    for (const bad of [64, -1, 1.5, '3', null, Number.NaN, [3]]) {
      expect(() => relationShardIn({ ...valid, products: { a: { b: bad } } }, 'a', 'b'), String(bad)).toThrow(/relation index: shard out of range$/);
    }
    expect(() => relationShardIn({ ...valid, products: { a: 3 } }, 'a', 'b')).toThrow(/relation index: malformed store entry$/);
    expect(() => relationShardIn({ ...valid, products: { a: null } }, 'a', 'b')).toThrow(/relation index: malformed store entry$/);
  });

  it('finds nothing for names an object inherits, as store id and as page key', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(relationShardIn(valid, name, '116132'), name).toBeNull();
      expect(relationShardIn(valid, 'akizuki', name), name).toBeNull();
      expect(relationShardIn(valid, name, name), name).toBeNull();
    }
  });

  it('indexes products named like inherited members as data, without touching the prototype', () => {
    const { index } = shardRelations([relation('odd', ['__proto__', 'constructor'], ['toString', '__proto__'])]);
    const read = JSON.parse(JSON.stringify(index)) as unknown;
    expect(relationShardIn(read, '__proto__', 'constructor')).toBe(0);
    expect(relationShardIn(read, 'toString', '__proto__')).toBe(0);
    expect(relationShardIn(read, 'toString', 'constructor')).toBeNull();
    expect(({} as Record<string, unknown>)['constructor']).toBe(Object);
  });
});

describe('packaged file names', () => {
  it('names the index and the shards by two-digit number under relations/', () => {
    expect(RELATION_INDEX_FILE).toBe('relations/index.json');
    expect(relationShardFile(0)).toBe('relations/shard-00.json');
    expect(relationShardFile(7)).toBe('relations/shard-07.json');
    expect(relationShardFile(63)).toBe('relations/shard-63.json');
  });
});

describe('relationsInShard', () => {
  it('throws on a malformed table instead of answering from it', () => {
    const table = packRelations(PRODUCT_RELATIONS.slice(0, 3));
    expect(() => relationsInShard({ ...table, version: 2 as unknown as 1 }, 'akizuki', '1')).toThrow('unsupported version');
    expect(() => relationsInShard({ ...table, strings: [] }, 'akizuki', '1')).toThrow('no string');
    expect(() => relationsInShard({ version: 1 } as PackedRelationTable, 'akizuki', '1')).toThrow();
  });
});

describe('shardRelations on arbitrary tables', () => {
  const seed = Number(process.env['FC_SEED'] ?? 20261101);
  const numRuns = Number(process.env['FC_RUNS'] ?? 200);
  const byId = (a: ProductRelation, b: ProductRelation): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  /** A small product pool, so components, shared endpoints and same-page relations actually occur. */
  const tableArb = fc.record({
    stores: fc.integer({ min: 2, max: 4 }).map((n) => ['akizuki', 'ksy', 'm5stack', 'sengoku'].slice(0, n)),
    pageCount: fc.integer({ min: 1, max: 12 }),
  }).chain(({ stores, pageCount }) => {
    const pages = Array.from({ length: pageCount }, (_, i) => `p${String(i).padStart(2, '0')}`);
    const endpoint = fc.tuple(fc.constantFrom(...stores), fc.constantFrom(...pages)) as fc.Arbitrary<[string, string]>;
    // A null second endpoint means the same page as the first: both endpoints are one product.
    return fc.array(fc.tuple(endpoint, fc.option(endpoint, { nil: null })), { maxLength: 40 }).map((pairs) => ({
      stores,
      pages,
      table: pairs.map(([a, b], i) => relation(`r${String(i).padStart(2, '0')}`, a, b ?? a)),
    }));
  });

  it('stores each relation once, in the shard the index names, with both endpoints together, for every generated table', () => {
    fc.assert(fc.property(tableArb, ({ stores, pages, table }) => {
      const { index, shards } = shardRelations(table);
      // Rounded through JSON as the package is.
      const onDiskIndex = JSON.parse(JSON.stringify(index)) as RelationIndex;
      const onDisk = shards.map((t) => JSON.parse(JSON.stringify(t)) as PackedRelationTable);

      // 1. Shape.
      expect(shards).toHaveLength(RELATION_SHARD_COUNT);
      expect(index.shards).toBe(RELATION_SHARD_COUNT);

      // 2. Every relation stored exactly once (ids are unique in the generated table).
      expect(onDisk.flatMap((t) => unpackRelations(t)).sort(byId)).toEqual([...table].sort(byId));

      for (const storeId of stores) for (const pageKey of pages) {
        const expected = table.filter((r) => r.products.some((p) => p.storeId === storeId && p.pageKey === pageKey));
        const shard = relationShardIn(onDiskIndex, storeId, pageKey);
        if (expected.length === 0) {
          // 5. A product with no relation in the table is null.
          expect(shard).toBeNull();
          continue;
        }
        // 3. Indexed to 0..63, and its shard answers the whole table's relations for it, in table order.
        expect(Number.isInteger(shard) && shard! >= 0 && shard! < RELATION_SHARD_COUNT).toBe(true);
        expect(relationsInShard(onDisk[shard!]!, storeId, pageKey)).toEqual(expected);
      }

      // 4. Both endpoints of every relation are indexed to the same shard.
      for (const r of table) {
        const [a, b] = r.products;
        expect(relationShardIn(onDiskIndex, a.storeId, a.pageKey)).toBe(relationShardIn(onDiskIndex, b.storeId, b.pageKey));
      }

      // 6. Same input, byte-identical output.
      expect(JSON.stringify(shardRelations(table))).toBe(JSON.stringify({ index, shards }));
    }), { seed, numRuns });
  });
});
