import type { Db } from '../connection.ts';
import { transaction } from '../connection.ts';
import { MIGRATION_0001_INITIAL } from './0001_initial.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Ordered list; append only. Never edit an applied migration. */
export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'initial', sql: MIGRATION_0001_INITIAL }];

export const SQLITE_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export function currentSchemaVersion(db: Db): number {
  const exists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`)
    .get();
  if (exists === undefined) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

export function migrate(db: Db): { from: number; to: number } {
  const from = currentSchemaVersion(db);
  if (from > SQLITE_SCHEMA_VERSION) {
    throw new Error(`database schema version ${from} is newer than this code supports (${SQLITE_SCHEMA_VERSION})`);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    });
  }
  return { from, to: SQLITE_SCHEMA_VERSION };
}
