import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AKIZUKI_COVER_SOURCE_FILE, akizukiCollector } from '../../src/collectors/akizuki/collector.ts';
import { parseCoverSource } from '../../src/collectors/akizuki/cover.ts';
import type { AkizukiRawSnapshot } from '../../src/adapters/akizuki/rawSchema.ts';
import { syntheticItem } from '../helpers/akizukiHtml.ts';
import { addListing, FAKE_BASE as BASE, fakeSite, transportFor, type FakeSite } from '../helpers/fakeAkizukiSite.ts';

const io = vi.hoisted(() => ({ renames: [] as Array<[string, string]>, failRename: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      io.renames.push([from, to]);
      if (io.failRename) throw new Error('rename refused');
      return actual.rename(from, to);
    },
  };
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => syntheticItem(from + i));
const CONFIG = {
  userAgent: 'electro-parts-test/0.1 (+https://example.test; research)',
  baseUrl: BASE,
  listingKinds: ['c', 'r'],
  minIntervalMs: 500,
  jitterMs: 0,
  maxUncoveredProducts: 0,
  cover: { fullCrawlEveryDays: 7, maxRepairListings: 5, escalateAfterMissing: 2 },
};
const DAY = 86_400_000;
const START = Date.parse('2026-11-01T00:00:00.000Z');

function shop(): FakeSite {
  const s = fakeSite();
  addListing(s, { kind: 'c', slug: 'big' }, 'Big', range(1, 20), 10);
  addListing(s, { kind: 'c', slug: 'rest' }, 'Rest', range(15, 30), 10);
  addListing(s, { kind: 'r', slug: 'tag' }, 'Tag', range(18, 24), 10);
  return s;
}

let carryDir: string;
beforeEach(async () => {
  io.renames.length = 0;
  io.failRename = false;
  carryDir = await mkdtemp(path.join(os.tmpdir(), 'akizuki-carry-'));
});
afterEach(async () => {
  await rm(carryDir, { recursive: true, force: true });
});

async function collect(s: FakeSite, dayOffset: number, config: Record<string, unknown> = CONFIG, carry: string | null = carryDir) {
  const logs: string[] = [];
  let t = START + dayOffset * DAY;
  const outcome = await akizukiCollector.collect(config, {
    log: (m) => logs.push(m),
    transport: transportFor(s),
    sleep: async () => undefined,
    now: () => new Date((t += 1000)),
    ...(carry === null ? {} : { carryDir: carry }),
  });
  return { outcome, logs, snapshot: outcome.raw as AkizukiRawSnapshot };
}

describe('Akizuki collector keeps the cover source between runs', () => {
  it('writes it after a full run and plans the next run from it', async () => {
    const s = shop();
    const first = await collect(s, 0);
    expect(first.snapshot.crawl?.mode).toBe('full');
    expect(first.outcome.metrics).toMatchObject({ coverRun: 0, plannedListings: 3, repairListings: 0, missingAfterRepair: 0, escalated: 0 });
    expect(await readdir(carryDir)).toEqual([AKIZUKI_COVER_SOURCE_FILE]);
    const written = await readFile(path.join(carryDir, AKIZUKI_COVER_SOURCE_FILE));
    const parsed = parseCoverSource(written);
    expect('source' in parsed && parsed.source.builtAt).toBe(first.snapshot.retrievedAt);
    expect(first.logs.some((l) => l.includes('cover source written: 3 listings, 30 products'))).toBe(true);

    s.log.length = 0;
    const second = await collect(s, 1);
    expect(second.snapshot.crawl).toMatchObject({ mode: 'cover', plannedListings: 2 });
    expect(second.outcome.metrics).toMatchObject({ coverRun: 1, plannedListings: 2 });
    expect(s.log.filter((u) => u.includes('/catalog/'))).toHaveLength(4);
    // A cover run does not renew the source: its age still counts from the last full run.
    expect(await readFile(path.join(carryDir, AKIZUKI_COVER_SOURCE_FILE))).toEqual(written);
  });

  it.each([
    ['damaged', async (file: string) => writeFile(file, 'not gzip at all'), 'cover source ignored'],
    ['missing', async (file: string) => rm(file), 'no cover source'],
  ])('reads everything when the file is %s, and writes a good one', async (_name, spoil, log) => {
    const s = shop();
    await collect(s, 0);
    const file = path.join(carryDir, AKIZUKI_COVER_SOURCE_FILE);
    await spoil(file);
    const again = await collect(s, 1);
    expect(again.snapshot.crawl?.mode).toBe('full');
    expect(again.snapshot.complete).toBe(true);
    expect(again.logs.some((l) => l.includes(log))).toBe(true);
    expect('source' in parseCoverSource(await readFile(file))).toBe(true);
  });

  it('writes the source to a temporary file beside it and renames it over the old one', async () => {
    await collect(shop(), 0);
    const target = path.join(carryDir, AKIZUKI_COVER_SOURCE_FILE);
    expect(io.renames).toHaveLength(1);
    const [from, to] = io.renames[0]!;
    expect(to).toBe(target);
    expect(from).not.toBe(target);
    expect(path.dirname(from)).toBe(carryDir);
  });

  it('a write that fails half-way leaves the old source as it was and no temporary file behind', async () => {
    const s = shop();
    await collect(s, 0);
    const file = path.join(carryDir, AKIZUKI_COVER_SOURCE_FILE);
    const before = await readFile(file);
    io.failRename = true;
    // Eight days later the source is old enough for a full run, which tries to replace it.
    const later = await collect(s, 8);
    expect(later.snapshot.crawl?.mode).toBe('full');
    expect(later.outcome.complete).toBe(true);
    expect(later.logs.some((m) => m.includes('cover source not written: rename refused'))).toBe(true);
    expect(Buffer.compare(Buffer.from(await readFile(file)), Buffer.from(before))).toBe(0);
    expect(await readdir(carryDir)).toEqual([AKIZUKI_COVER_SOURCE_FILE]);
  });

  it('keeps nothing when there is no carry directory or the cover is not configured', async () => {
    const s = shop();
    const noDir = await collect(s, 0, CONFIG, null);
    expect(noDir.snapshot.crawl?.mode).toBe('full');
    expect(await readdir(carryDir)).toEqual([]);
    const { cover: _cover, ...withoutCover } = CONFIG;
    const off = await collect(s, 0, withoutCover);
    expect(off.snapshot.crawl).toBeUndefined();
    expect(off.outcome.metrics).not.toHaveProperty('coverRun');
    expect(await readdir(carryDir)).toEqual([]);
  });

  it('does not write a source after an incomplete run', async () => {
    const s = shop();
    s.failures.set(`${BASE}/catalog/r/tag/`, 99);
    const bad = await collect(s, 0);
    expect(bad.outcome.complete).toBe(false);
    expect(await readdir(carryDir)).toEqual([]);
  });

  it('validates the cover section of the config', () => {
    const ok = (cover: unknown) => akizukiCollector.validateConfig({ ...CONFIG, cover });
    expect(() => ok({})).not.toThrow();
    expect(() => ok({ fullCrawlEveryDays: 0 })).toThrow('collector.cover.fullCrawlEveryDays');
    expect(() => ok({ fullCrawlEveryDays: 31 })).toThrow('collector.cover.fullCrawlEveryDays');
    expect(() => ok({ maxRepairListings: -1 })).toThrow('collector.cover.maxRepairListings');
    expect(() => ok({ escalateAfterMissing: 1.5 })).toThrow('collector.cover.escalateAfterMissing');
    expect(() => ok([])).toThrow('collector.cover must be an object');
  });
});
