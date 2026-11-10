import { relationProductKey, type ProductRelation } from './relations.ts';
import { packRelations, unpackRelations, type PackedRelationTable } from './relationTable.ts';

/**
 * Splits the reviewed relation table so a host can read the one piece a page needs.
 * Whole connected components of the relation graph (products are nodes, relations are edges)
 * go to one shard, so every relation of a product is in that product's shard and each
 * relation is stored once. A small index says which shard a product is in.
 */

export const RELATION_SHARD_COUNT = 64;
export const RELATION_INDEX_FILE = 'relations/index.json';

/** Store id → page key → shard number. Only products that have a relation appear. */
export interface RelationIndex {
  version: 1;
  shards: number;
  products: Record<string, Record<string, number>>;
}

/** Path inside the extension package. Built from a shard number only, never from page text. */
export function relationShardFile(shard: number): string {
  return `relations/shard-${String(shard).padStart(2, '0')}.json`;
}

/**
 * The index and one packed table per shard, RELATION_SHARD_COUNT of them (an empty one is a valid empty table).
 * Components are placed heaviest first (weight is the number of relations). Components of equal weight are placed in
 * the order their first product first appears in the table. Each goes into the shard with the least weight so far
 * (ties to the lowest number). Inside a shard the relations keep table order. Packing starts from the already
 * unpacked relations because their endpoints carry the spellings merged over the whole table; packing a subset of
 * raw rows would merge fewer. Deterministic for a given table.
 */
export function shardRelations(relations: readonly ProductRelation[]): { index: RelationIndex; shards: PackedRelationTable[] } {
  const keyOf = (p: { storeId: string; pageKey: string }): string => relationProductKey(p.storeId, p.pageKey);
  const parent = new Map<string, string>();
  const find = (start: string): string => {
    let key = start;
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)!)!);
      key = parent.get(key)!;
    }
    return key;
  };
  for (const relation of relations) for (const p of relation.products) parent.set(keyOf(p), keyOf(p));
  for (const relation of relations) parent.set(find(keyOf(relation.products[0])), find(keyOf(relation.products[1])));

  // A component's entry is created when its first-appearing product is visited, so the map is in first-appearance order.
  const components = new Map<string, { weight: number }>();
  for (const key of parent.keys()) {
    const root = find(key);
    if (!components.has(root)) components.set(root, { weight: 0 });
  }
  for (const relation of relations) components.get(find(keyOf(relation.products[0])))!.weight++;

  const load = new Array<number>(RELATION_SHARD_COUNT).fill(0);
  const shardOfRoot = new Map<string, number>();
  // Array.prototype.sort is stable, so components of equal weight keep their first-appearance order.
  const placed = [...components].sort(([, a], [, b]) => b.weight - a.weight);
  for (const [root, component] of placed) {
    let shard = 0;
    for (let i = 1; i < RELATION_SHARD_COUNT; i++) if (load[i]! < load[shard]!) shard = i;
    load[shard]! += component.weight;
    shardOfRoot.set(root, shard);
  }

  const buckets = Array.from({ length: RELATION_SHARD_COUNT }, () => [] as ProductRelation[]);
  for (const relation of relations) buckets[shardOfRoot.get(find(keyOf(relation.products[0])))!]!.push(relation);

  // Null-prototype maps: a store id such as `__proto__` is data, and the JSON is stable.
  const products: Record<string, Record<string, number>> = Object.create(null) as Record<string, Record<string, number>>;
  for (const key of parent.keys()) {
    const [storeId, pageKey] = JSON.parse(key) as [string, string];
    const store = (products[storeId] ??= Object.create(null) as Record<string, number>);
    store[pageKey] = shardOfRoot.get(find(key))!;
  }
  return { index: { version: 1, shards: RELATION_SHARD_COUNT, products }, shards: buckets.map((bucket) => packRelations(bucket)) };
}

/** The shard of a product, or null when it has no relation. Throws on a malformed index. Reads own properties only. */
export function relationShardIn(index: unknown, storeId: string, pageKey: string): number | null {
  if (typeof index !== 'object' || index === null) throw new Error('relation index: not an object');
  const v = index as Record<string, unknown>;
  if (v['version'] !== 1) throw new Error(`relation index: unsupported version ${String(v['version'])}`);
  if (v['shards'] !== RELATION_SHARD_COUNT) throw new Error(`relation index: unexpected shard count ${String(v['shards'])}`);
  const products = v['products'];
  if (typeof products !== 'object' || products === null) throw new Error('relation index: no products');
  if (!Object.hasOwn(products, storeId)) return null;
  const store = (products as Record<string, unknown>)[storeId];
  if (typeof store !== 'object' || store === null) throw new Error('relation index: malformed store entry');
  if (!Object.hasOwn(store, pageKey)) return null;
  const shard = (store as Record<string, unknown>)[pageKey] as number;
  if (!Number.isInteger(shard) || shard < 0 || shard >= RELATION_SHARD_COUNT) throw new Error('relation index: shard out of range');
  return shard;
}

/** The relations of one product from its shard's table, in table order. Throws on a malformed table (unpackRelations does). */
export function relationsInShard(table: PackedRelationTable, storeId: string, pageKey: string): ProductRelation[] {
  const key = relationProductKey(storeId, pageKey);
  return unpackRelations(table).filter((relation) => relation.products.some((p) => relationProductKey(p.storeId, p.pageKey) === key));
}
