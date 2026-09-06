import { canonicalJson } from '../../src/core/hash.ts';
import type { Db } from '../../src/db/connection.ts';
import { readStoreHistory } from '../../src/db/read.ts';

/**
 * Store history with database-assigned ids and import timestamps stripped, so
 * two databases built in different import orders can be compared literally.
 */
export function dumpStore(db: Db, storeId: string): string {
  const h = readStoreHistory(db, storeId);
  return canonicalJson({
    runs: h.runs.map(({ runId: _r, importedAt: _i, ...rest }) => rest),
    products: h.products.map(({ productId: _p, offers, ...rest }) => ({
      ...rest,
      offers: offers.map(({ offerId: _o, bases, ...o }) => ({
        ...o,
        bases: bases.map(({ priceBasisId: _b, ...b }) => b),
      })),
    })),
  });
}

export function countRows(db: Db, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}
