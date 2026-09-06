import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readRawSnapshotFile, type RawSnapshotFile } from '../../src/core/snapshotFile.ts';
import { akizukiSnapshotAdapter } from '../../src/adapters/akizuki/snapshotAdapter.ts';
import type { NormalizedSnapshot } from '../../src/core/domain.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(here, '..', 'fixtures');

export const AKIZUKI_FIXTURES = {
  aug: path.join(FIXTURE_DIR, 'akizuki', 'akizuki-all-products-2026-08-02T06-38-13-888Z.json.gz'),
  sep: path.join(FIXTURE_DIR, 'akizuki', 'akizuki-all-products-2026-09-06T09-54-15-068Z.json.gz'),
} as const;

const rawCache = new Map<string, Promise<RawSnapshotFile>>();
const normalizedCache = new Map<string, Promise<NormalizedSnapshot>>();

export function loadAkizukiRaw(which: keyof typeof AKIZUKI_FIXTURES): Promise<RawSnapshotFile> {
  const p = AKIZUKI_FIXTURES[which];
  let cached = rawCache.get(p);
  if (cached === undefined) {
    cached = readRawSnapshotFile(p);
    rawCache.set(p, cached);
  }
  return cached;
}

export function loadAkizukiNormalized(which: keyof typeof AKIZUKI_FIXTURES): Promise<NormalizedSnapshot> {
  const p = AKIZUKI_FIXTURES[which];
  let cached = normalizedCache.get(p);
  if (cached === undefined) {
    cached = loadAkizukiRaw(which).then((raw) => akizukiSnapshotAdapter.normalize(raw.json, raw.rawSha256));
    normalizedCache.set(p, cached);
  }
  return cached;
}

export const AKIZUKI_HTML_FIXTURES = ['rkit_p1', 'rkit_p3', 'rkit_p6', 'rsbcomp1', 'cheatsink', 'g109951'] as const;
export type AkizukiHtmlFixture = (typeof AKIZUKI_HTML_FIXTURES)[number];

const htmlCache = new Map<string, Promise<string>>();

/** Sanitized copies of real Akizuki pages (scripts removed, tokens blanked), gzipped. */
export function readHtmlFixture(name: AkizukiHtmlFixture): Promise<string> {
  let cached = htmlCache.get(name);
  if (cached === undefined) {
    cached = readFile(path.join(FIXTURE_DIR, 'akizuki', 'html', `${name}.html.gz`)).then((buf) => gunzipSync(buf).toString('utf8'));
    htmlCache.set(name, cached);
  }
  return cached;
}
