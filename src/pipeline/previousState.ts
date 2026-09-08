import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_DB_FILE_NAME, STATE_META_FILE_NAME, verifyStateDir, type FinalizedState } from '../db/finalize.ts';

/**
 * Where the previous run's finalized state comes from. Exactly one of
 * `dir` / `url` is used; with neither, only `--bootstrap` can proceed.
 */
export interface PreviousStateSource {
  dir?: string;
  url?: string;
}

export interface PreviousStateResult {
  mode: 'bootstrap' | 'incremental';
  /** Verified metadata of the previous state (incremental only). */
  meta: FinalizedState | null;
  /** Path of the working database (copied from the previous state, or absent for bootstrap). */
  workingDbPath: string;
}

export class PreviousStateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviousStateUnavailableError';
  }
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, {
  redirect: 'follow',
  cache: 'no-store',
  credentials: 'omit',
  ...(init?.signal === undefined ? {} : { signal: init.signal }),
});

/** Downloads `state.json` and the database it names into `dir`; null when the state does not exist (404). */
export async function downloadState(baseUrl: string, dir: string, fetchImpl: FetchLike = defaultFetch, timeoutMs = 60_000): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new PreviousStateUnavailableError(`previous state download timed out after ${timeoutMs} ms`));
      controller.abort(new Error('previous state download timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([downloadStateWithinDeadline(baseUrl, dir, fetchImpl, controller.signal), timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function downloadStateWithinDeadline(baseUrl: string, dir: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<boolean> {
  const metaRes = await fetchImpl(`${baseUrl}/${STATE_META_FILE_NAME}`, { signal });
  if (metaRes.status === 404) return false;
  if (metaRes.status !== 200) throw new PreviousStateUnavailableError(`GET ${baseUrl}/${STATE_META_FILE_NAME}: HTTP ${metaRes.status}`);
  const metaBytes = Buffer.from(await metaRes.arrayBuffer());
  let meta: { fileName?: unknown };
  try {
    meta = JSON.parse(metaBytes.toString('utf8')) as { fileName?: unknown };
  } catch {
    throw new PreviousStateUnavailableError('published state.json is not valid JSON');
  }
  const fileName = typeof meta.fileName === 'string' ? meta.fileName : STATE_DB_FILE_NAME;
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) throw new PreviousStateUnavailableError(`unsafe state file name ${fileName}`);
  const dbRes = await fetchImpl(`${baseUrl}/${fileName}`, { signal });
  if (dbRes.status !== 200) throw new PreviousStateUnavailableError(`GET ${baseUrl}/${fileName}: HTTP ${dbRes.status}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, STATE_META_FILE_NAME), metaBytes);
  await writeFile(path.join(dir, fileName), Buffer.from(await dbRes.arrayBuffer()));
  return true;
}

/**
 * Establishes the working database for a run.
 *
 * - incremental: the previous state is fetched (or read from a directory),
 *   verified (size, SHA-256, integrity_check, schema not newer than the
 *   code) and copied to `workDir`. Any failure aborts the run so that a
 *   corrupt or unreachable previous state never leads to a history reset.
 * - bootstrap: only allowed when no previous state exists; starts empty.
 */
export async function acquirePreviousState(
  source: PreviousStateSource,
  workDir: string,
  bootstrap: boolean,
  fetchImpl: FetchLike = defaultFetch,
  timeoutMs = 60_000,
): Promise<PreviousStateResult> {
  await mkdir(workDir, { recursive: true });
  const workingDbPath = path.join(workDir, STATE_DB_FILE_NAME);
  await rm(workingDbPath, { force: true });
  let stateDir: string | null = null;
  if (source.dir !== undefined) {
    // A directory without state.json means "nothing published yet" (same as a 404).
    const { access } = await import('node:fs/promises');
    stateDir = await access(path.join(source.dir, STATE_META_FILE_NAME)).then(() => source.dir ?? null, () => null);
  } else if (source.url !== undefined) {
    const downloadDir = path.join(workDir, 'previous');
    await rm(downloadDir, { recursive: true, force: true });
    if (await downloadState(source.url, downloadDir, fetchImpl, timeoutMs)) stateDir = downloadDir;
  }
  if (stateDir === null) {
    if (!bootstrap) {
      throw new PreviousStateUnavailableError(
        source.url === undefined && source.dir === undefined
          ? 'no previous state source configured; pass --bootstrap for the very first run'
          : 'no previous state is published; pass --bootstrap for the very first run',
      );
    }
    return { mode: 'bootstrap', meta: null, workingDbPath };
  }
  let meta: FinalizedState;
  try {
    meta = await verifyStateDir(stateDir);
  } catch (e) {
    throw new PreviousStateUnavailableError(`previous state at ${stateDir} failed verification: ${(e as Error).message}`);
  }
  if (bootstrap) throw new PreviousStateUnavailableError('refusing to bootstrap: a previous state exists and would be discarded');
  await copyFile(path.join(stateDir, meta.fileName), workingDbPath);
  return { mode: 'incremental', meta, workingDbPath };
}
