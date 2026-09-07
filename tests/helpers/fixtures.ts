import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readRawSnapshotFile, type RawSnapshotFile } from '../../src/core/snapshotFile.ts';
import { akizukiSnapshotAdapter } from '../../src/adapters/akizuki/snapshotAdapter.ts';
import { switchScienceSnapshotAdapter } from '../../src/adapters/switch-science/snapshotAdapter.ts';
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

/**
 * A 60-product cut of the real 2026-09-07 Switch Science crawl. Every value is
 * the store's own; only `items` was sampled (7 named products plus every 149th
 * of the rest) and the counts that describe the cut — `extractedTotal`, the
 * catalog totals, `deduplication`, `dataQuality` — were recomputed so the
 * fixture stays internally consistent. See the fixture directory's README.
 */
export const SWITCH_SCIENCE_FIXTURE = path.join(FIXTURE_DIR, 'switch-science', 'switch-science-sample-2026-09-07T00-05-56-401Z.json.gz');

export function loadSwitchScienceRaw(): Promise<RawSnapshotFile> {
  let cached = rawCache.get(SWITCH_SCIENCE_FIXTURE);
  if (cached === undefined) {
    cached = readRawSnapshotFile(SWITCH_SCIENCE_FIXTURE);
    rawCache.set(SWITCH_SCIENCE_FIXTURE, cached);
  }
  return cached;
}

export function loadSwitchScienceNormalized(): Promise<NormalizedSnapshot> {
  let cached = normalizedCache.get(SWITCH_SCIENCE_FIXTURE);
  if (cached === undefined) {
    cached = loadSwitchScienceRaw().then((raw) => switchScienceSnapshotAdapter.normalize(raw.json, raw.rawSha256));
    normalizedCache.set(SWITCH_SCIENCE_FIXTURE, cached);
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
