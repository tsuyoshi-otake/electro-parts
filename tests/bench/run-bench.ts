/**
 * Synthetic load benchmark for the store-neutral layers.
 *
 *   node --import tsx tests/bench/run-bench.ts [--products N] [--years Y] [--interval-days D] [--out DIR]
 *
 * Simulates a catalogue of N products observed every D days for Y years with
 * realistic churn (price changes, availability flips, inventory drift,
 * listings appearing / disappearing) and reports:
 *
 * - import time per run (p50 / p95 / max) and total,
 * - SQLite size after finalization,
 * - generate + write time and the static payload size (total / max file),
 * - peak RSS.
 *
 * Numbers are printed as Markdown so they can be pasted into the README's
 * performance section. Nothing here is a test: it never fails on a budget,
 * it only measures. The budgets themselves live in README.md.
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase } from '../../src/db/connection.ts';
import { finalizeDatabase } from '../../src/db/finalize.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { compactInventory } from '../../src/db/inventoryRetention.ts';
import { migrate, SQLITE_SCHEMA_VERSION } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { generateStoreDataset } from '../../src/publisher/generate.ts';
import { writeStoreDataset } from '../../src/publisher/write.ts';
import { SYNTHETIC_CAPABILITIES, syntheticSnapshot, type SyntheticProduct } from '../helpers/synthetic.ts';

interface BenchOptions {
  products: number;
  years: number;
  intervalDays: number;
  out: string;
}

/** Small deterministic PRNG (mulberry32) so runs are comparable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Catalogue {
  price: number[];
  availability: ('in_stock' | 'low_stock' | 'out_of_stock')[];
  quantity: number[];
  listed: boolean[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] as number;
}

const ms = (n: number): string => `${n.toFixed(1)} ms`;
const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(2)} MB`;

export async function runBench(options: BenchOptions): Promise<Record<string, string | number>> {
  const random = rng(20260906);
  const { products, years, intervalDays } = options;
  const runs = Math.floor((years * 365) / intervalDays);
  const catalogue: Catalogue = {
    price: Array.from({ length: products }, () => 10 * (5 + Math.floor(random() * 400))),
    availability: Array.from({ length: products }, () => 'in_stock' as const),
    quantity: Array.from({ length: products }, () => Math.floor(random() * 2000)),
    listed: Array.from({ length: products }, () => true),
  };
  const dir = path.resolve(options.out, `p${products}-y${years}-d${intervalDays}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const dbPath = path.join(dir, 'work.sqlite');
  const db = openDatabase(dbPath);
  migrate(db);

  const start = Date.UTC(2021, 0, 1);
  const importTimes: number[] = [];
  let peakRss = process.memoryUsage().rss;
  const t0 = performance.now();
  for (let r = 0; r < runs; r++) {
    // Churn per run: 1 % price changes, 3 % availability flips, 20 % inventory
    // drift, 0.2 % delistings and relistings.
    for (let i = 0; i < products; i++) {
      const u = random();
      if (u < 0.01) catalogue.price[i] = Math.max(10, Math.round(((catalogue.price[i] as number) * (0.8 + random() * 0.4)) / 10) * 10);
      if (u >= 0.01 && u < 0.04) {
        const a = catalogue.availability[i];
        catalogue.availability[i] = a === 'in_stock' ? 'low_stock' : a === 'low_stock' ? 'out_of_stock' : 'in_stock';
      }
      if (random() < 0.2) catalogue.quantity[i] = Math.max(0, (catalogue.quantity[i] as number) + Math.floor(random() * 40) - 20);
      if (random() < 0.002) catalogue.listed[i] = !catalogue.listed[i];
    }
    const items: SyntheticProduct[] = [];
    for (let i = 0; i < products; i++) {
      if (!catalogue.listed[i]) continue;
      const availability = catalogue.availability[i] as 'in_stock' | 'low_stock' | 'out_of_stock';
      items.push({
        id: String(100000 + i),
        name: `Synthetic part ${i}`,
        price: catalogue.price[i] as number,
        availability,
        purchasable: availability !== 'out_of_stock',
        quantity: availability === 'out_of_stock' ? 0 : (catalogue.quantity[i] as number),
      });
    }
    const observedAt = new Date(start + r * intervalDays * 86_400_000).toISOString();
    const snapshot = syntheticSnapshot(observedAt, items, { storeId: 'bench' });
    const a = performance.now();
    importSnapshot(db, snapshot, { capabilities: SYNTHETIC_CAPABILITIES, now: () => new Date(observedAt) });
    compactInventory(db, { retentionDays: 400, now: () => new Date(observedAt) });
    importTimes.push(performance.now() - a);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const importTotal = performance.now() - t0;

  const g0 = performance.now();
  const history = readStoreHistory(db, 'bench');
  const readMs = performance.now() - g0;
  const g1 = performance.now();
  const dataset = generateStoreDataset(history, { generatedAt: new Date().toISOString(), sqliteSchemaVersion: SQLITE_SCHEMA_VERSION, sourceSchemaVersion: 'bench', inventoryPointLimit: 730 });
  const generateMs = performance.now() - g1;
  const w0 = performance.now();
  const written = await writeStoreDataset(path.join(dir, 'site'), dataset);
  const writeMs = performance.now() - w0;
  const f0 = performance.now();
  const finalized = await finalizeDatabase(db, path.join(dir, 'site', 'state'), () => new Date());
  const finalizeMs = performance.now() - f0;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const dbBytes = (await stat(path.join(dir, 'site', 'state', finalized.fileName))).size;

  const sorted = [...importTimes].sort((x, y) => x - y);
  let changePoints = 0;
  for (const p of dataset.products) for (const o of p.offers) for (const s of o.segments) changePoints += s.points.length;
  return {
    products,
    years,
    intervalDays,
    runs,
    'import p50': ms(percentile(sorted, 50)),
    'import p95': ms(percentile(sorted, 95)),
    'import max': ms(percentile(sorted, 100)),
    'import total': `${(importTotal / 1000).toFixed(1)} s`,
    'read history': ms(readMs),
    generate: ms(generateMs),
    write: ms(writeMs),
    finalize: ms(finalizeMs),
    'sqlite size': mb(dbBytes),
    'site bytes': mb(written.bytesTotal),
    'max product file': `${(written.bytesMax / 1024).toFixed(1)} KB`,
    'price change points': changePoints,
    'peak RSS': mb(peakRss),
  };
}

function table(rows: Record<string, string | number>[]): string {
  const keys = Object.keys(rows[0] ?? {});
  const lines = [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`];
  for (const row of rows) lines.push(`| ${keys.map((k) => String(row[k])).join(' | ')} |`);
  return lines.join('\n');
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const { values } = parseArgs({
    options: {
      products: { type: 'string', default: '2000' },
      years: { type: 'string', default: '1,3,5' },
      'interval-days': { type: 'string', default: '1' },
      out: { type: 'string', default: path.join('test-results', 'bench') },
    },
  });
  const rows: Record<string, string | number>[] = [];
  for (const y of values.years.split(',').map(Number)) {
    const row = await runBench({ products: Number(values.products), years: y, intervalDays: Number(values['interval-days']), out: values.out });
    process.stderr.write(`${JSON.stringify(row)}\n`);
    rows.push(row);
  }
  process.stdout.write(`${table(rows)}\n`);
}
