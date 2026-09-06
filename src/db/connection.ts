import { DatabaseSync } from 'node:sqlite';

/**
 * Thin wrapper over the built-in `node:sqlite` driver. No native dependency
 * to build or audit. The working database always uses the rollback journal
 * (no WAL) so that a single file is the complete state.
 */
export type Db = DatabaseSync;

export interface OpenOptions {
  readOnly?: boolean;
}

export function openDatabase(path: string, options: OpenOptions = {}): Db {
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  if (!options.readOnly) {
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA temp_store = MEMORY');
  }
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function openInMemory(): Db {
  return openDatabase(':memory:');
}

/** Runs `fn` inside a transaction; rolls back on any exception. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure; original error is more informative
    }
    throw e;
  }
}

export function pragmaValue(db: Db, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  if (row === undefined) return undefined;
  const key = Object.keys(row)[0];
  return key === undefined ? undefined : row[key];
}
