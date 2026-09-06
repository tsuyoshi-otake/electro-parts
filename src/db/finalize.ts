import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, pragmaValue, type Db } from './connection.ts';
import { currentSchemaVersion, SQLITE_SCHEMA_VERSION } from './migrations/index.ts';

/**
 * Produces the publishable copy of the working database:
 *   VACUUM INTO a fresh file (compact, no WAL, no free pages) -> integrity
 *   check on the copy -> SHA-256 -> sidecar `state.json`.
 * The working database is never published directly.
 */
export interface FinalizedState {
  /** Bump when the state file layout changes. */
  stateFormatVersion: 1;
  sqliteSchemaVersion: number;
  fileName: string;
  sha256: string;
  bytes: number;
  producedAt: string;
  /** Latest imported run per store, for quick freshness checks. */
  stores: Record<string, { runCount: number; latestObservedAt: string | null }>;
}

export const STATE_DB_FILE_NAME = 'history.sqlite';
export const STATE_META_FILE_NAME = 'state.json';

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

export async function finalizeDatabase(
  working: Db,
  outDir: string,
  now: () => Date = () => new Date(),
): Promise<FinalizedState> {
  await mkdir(outDir, { recursive: true });
  const target = path.join(outDir, STATE_DB_FILE_NAME);
  await rm(target, { force: true });
  // VACUUM INTO requires the path as a literal; escape single quotes.
  working.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const copy = openDatabase(target);
  try {
    const integrity = pragmaValue(copy, 'integrity_check');
    if (integrity !== 'ok') throw new Error(`integrity_check failed on finalized database: ${String(integrity)}`);
    const journal = pragmaValue(copy, 'journal_mode');
    if (journal !== 'delete') throw new Error(`finalized database must not use WAL (journal_mode=${String(journal)})`);
    const schema = currentSchemaVersion(copy);
    if (schema !== SQLITE_SCHEMA_VERSION) throw new Error(`schema version ${schema} != ${SQLITE_SCHEMA_VERSION}`);
    const stores: FinalizedState['stores'] = {};
    const rows = copy
      .prepare('SELECT store_id, COUNT(*) AS n, MAX(observed_at_iso) AS latest FROM crawl_runs GROUP BY store_id')
      .all() as { store_id: string; n: number; latest: string | null }[];
    for (const r of rows) stores[r.store_id] = { runCount: r.n, latestObservedAt: r.latest };
    for (const s of copy.prepare('SELECT store_id FROM stores').all() as { store_id: string }[]) {
      stores[s.store_id] ??= { runCount: 0, latestObservedAt: null };
    }
    copy.close();
    const bytes = (await stat(target)).size;
    const sha256 = await sha256OfFile(target);
    const state: FinalizedState = {
      stateFormatVersion: 1,
      sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
      fileName: STATE_DB_FILE_NAME,
      sha256,
      bytes,
      producedAt: now().toISOString(),
      stores,
    };
    await writeFile(path.join(outDir, STATE_META_FILE_NAME), JSON.stringify(state, null, 2) + '\n');
    return state;
  } catch (e) {
    try {
      copy.close();
    } catch {
      // already closed
    }
    throw e;
  }
}

/** Verifies a previously published state directory before it is trusted. */
export async function verifyStateDir(dir: string): Promise<FinalizedState> {
  const metaPath = path.join(dir, STATE_META_FILE_NAME);
  const { readFile } = await import('node:fs/promises');
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as FinalizedState;
  if (meta.stateFormatVersion !== 1) throw new Error(`unsupported state format ${String(meta.stateFormatVersion)}`);
  if (meta.sqliteSchemaVersion > SQLITE_SCHEMA_VERSION) {
    throw new Error(`published state schema ${meta.sqliteSchemaVersion} is newer than this code (${SQLITE_SCHEMA_VERSION})`);
  }
  const dbPath = path.join(dir, meta.fileName);
  const size = (await stat(dbPath)).size;
  if (size !== meta.bytes) throw new Error(`state size mismatch: ${size} != ${meta.bytes}`);
  const sha = await sha256OfFile(dbPath);
  if (sha !== meta.sha256) throw new Error(`state checksum mismatch: ${sha} != ${meta.sha256}`);
  const db = openDatabase(dbPath, { readOnly: true });
  try {
    const integrity = pragmaValue(db, 'integrity_check');
    if (integrity !== 'ok') throw new Error(`integrity_check failed: ${String(integrity)}`);
  } finally {
    db.close();
  }
  return meta;
}
