import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { sha256Hex } from './hash.ts';

/**
 * Raw snapshot files are JSON, optionally gzip-compressed (`.json.gz`).
 * `rawSha256` is always computed over the *decompressed* JSON bytes so the
 * hash is stable regardless of the compression settings used on disk.
 */
export interface RawSnapshotFile {
  path: string;
  bytes: number;
  rawSha256: string;
  json: unknown;
}

export async function readRawSnapshotFile(path: string): Promise<RawSnapshotFile> {
  const buf = await readFile(path);
  const plain = path.endsWith('.gz') ? gunzipSync(buf) : buf;
  const text = plain.toString('utf8');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`snapshot ${path} is not valid JSON: ${(e as Error).message}`);
  }
  return { path, bytes: plain.byteLength, rawSha256: sha256Hex(plain), json };
}

export async function writeRawSnapshotFile(path: string, json: unknown): Promise<{ rawSha256: string; bytes: number }> {
  const plain = Buffer.from(JSON.stringify(json, null, 2), 'utf8');
  const out = path.endsWith('.gz') ? gzipSync(plain, { level: 9 }) : plain;
  await writeFile(path, out);
  return { rawSha256: sha256Hex(plain), bytes: plain.byteLength };
}
