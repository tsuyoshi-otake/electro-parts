/**
 * One-off coverage probe (not part of the pipeline).
 *
 *   node --import tsx scripts/probe-akizuki-coverage.ts --kinds c,r --out <dir>
 *
 * Answers one question: does walking a listing family cover the whole Akizuki
 * catalogue? The authority is the sitemap that robots.txt advertises: it
 * enumerates every product page. The probe crawls every listing of the given
 * kinds (`c` = category tree, `r` = genre tags), unions the sales codes it can
 * extract, and diffs that against the sitemap's product set.
 *
 * The result decides the collector's coverage strategy by measurement instead
 * of assumption.
 */
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PoliteFetcher } from '../src/collectors/politeFetcher.ts';
import { isAkizukiMaintenancePage, parseAkizukiListingPage } from '../src/collectors/akizuki/listingParser.ts';
import { akizukiListingUrl, AKIZUKI_BASE_URL, type ListingKind } from '../src/collectors/akizuki/listings.ts';

const USER_AGENT = 'electro-parts-price-history/0.1 (+https://github.com/tsuyoshi-otake/electro-parts; research)';
const PAGE_CAP = 60;

interface CategoryResult {
  kind: ListingKind;
  slug: string;
  pages: number;
  listedTotal: number;
  extracted: number;
  truncated: boolean;
  error?: string;
}

/** The sitemap is the authority for the catalogue; it is cached on disk between probe runs. */
async function readSitemap(fetcher: PoliteFetcher, cacheDir: string): Promise<{ products: Set<string>; slugs: Record<ListingKind, string[]> }> {
  const productsFile = path.join(cacheDir, 'sitemap-products.json');
  const slugFile = (kind: ListingKind): string => path.join(cacheDir, `sitemap-${kind}.json`);
  try {
    const products = new Set<string>(JSON.parse(await readFile(productsFile, 'utf8')) as string[]);
    const c = JSON.parse(await readFile(slugFile('c'), 'utf8')) as string[];
    const r = JSON.parse(await readFile(slugFile('r'), 'utf8')) as string[];
    if (products.size > 0 && c.length > 0 && r.length > 0) return { products, slugs: { c, r } };
  } catch {
    // fall through to a live read
  }
  const index = await fetcher.fetchText(`${AKIZUKI_BASE_URL}/Sitemap_index.xml`);
  const products = new Set<string>();
  const found: Record<ListingKind, Set<string>> = { c: new Set(), r: new Set() };
  for (const m of index.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = m[1] as string;
    await new Promise<void>((r) => setTimeout(r, 1500));
    // The sub-sitemaps are gzip files, so they need a byte-level fetch.
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: '*/*' } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    for (const p of xml.matchAll(/\/catalog\/g\/g(\d+)\//g)) products.add(p[1] as string);
    for (const c of xml.matchAll(/\/catalog\/([cr])\/([A-Za-z0-9_-]+)\//g)) found[c[1] as ListingKind].add(c[2] as string);
  }
  const slugs = { c: [...found.c].sort(), r: [...found.r].sort() };
  await writeFile(productsFile, JSON.stringify([...products].sort()));
  for (const kind of ['c', 'r'] as const) await writeFile(slugFile(kind), JSON.stringify(slugs[kind], null, 2));
  return { products, slugs };
}

async function crawlCategory(fetcher: PoliteFetcher, kind: ListingKind, slug: string, seen: Set<string>): Promise<CategoryResult> {
  const result: CategoryResult = { kind, slug, pages: 0, listedTotal: 0, extracted: 0, truncated: false };
  for (let page = 1; ; page += 1) {
    const url = akizukiListingUrl(AKIZUKI_BASE_URL, { kind, slug }, page);
    let html: string;
    try {
      html = await fetcher.fetchText(url);
    } catch (e) {
      result.error = `${(e as Error).message} at page ${page}`;
      return result;
    }
    if (isAkizukiMaintenancePage(html)) {
      result.error = `maintenance page at ${url}`;
      return result;
    }
    let parsed;
    try {
      parsed = parseAkizukiListingPage(html);
    } catch (e) {
      // Index-only categories carry no pager and no product blocks.
      result.error = `${(e as Error).message} at page ${page}`;
      return result;
    }
    result.pages = page;
    result.listedTotal = parsed.listedTotal;
    for (const item of parsed.items) {
      seen.add(item.salesCode);
      result.extracted += 1;
    }
    if (page >= parsed.lastPage || parsed.nextPath === null) break;
    if (page >= PAGE_CAP) {
      result.truncated = true;
      break;
    }
  }
  if (result.listedTotal >= 3000) result.truncated = true;
  return result;
}

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: path.join('test-results', 'coverage-probe') },
    kinds: { type: 'string', default: 'c' },
  },
});
const kinds = values.kinds.split(',').map((k) => k.trim()) as ListingKind[];
if (kinds.some((k) => k !== 'c' && k !== 'r')) throw new Error(`--kinds accepts c and r, got ${values.kinds}`);
const outDir = path.resolve(values.out);
await mkdir(outDir, { recursive: true });

const fetcher = new PoliteFetcher({ userAgent: USER_AGENT, minIntervalMs: 1500, jitterMs: 500, maxAttempts: 3, timeoutMs: 30_000, maxRequests: 8000 });
const started = Date.now();
const { products, slugs } = await readSitemap(fetcher, outDir);
const targets = kinds.flatMap((kind) => slugs[kind].map((slug) => ({ kind, slug })));
process.stderr.write(`sitemap: ${products.size} products, ${targets.length} listings of kind ${kinds.join('+')}\n`);

const seen = new Set<string>();
const results: CategoryResult[] = [];
for (const [i, target] of targets.entries()) {
  const r = await crawlCategory(fetcher, target.kind, target.slug, seen);
  results.push(r);
  process.stderr.write(
    `[${i + 1}/${targets.length}] ${r.kind}/${r.slug} pages=${r.pages} listed=${r.listedTotal} got=${r.extracted} union=${seen.size}` +
      `${r.truncated ? ' TRUNCATED' : ''}${r.error === undefined ? '' : ` (${r.error})`}\n`,
  );
}

const missing = [...products].filter((code) => !seen.has(code));
const extra = [...seen].filter((code) => !products.has(code));
const summary = {
  startedAt: new Date(started).toISOString(),
  durationSec: Math.round((Date.now() - started) / 1000),
  httpAttempts: fetcher.stats.httpAttempts,
  kinds,
  sitemapProducts: products.size,
  listings: targets.length,
  withProducts: results.filter((r) => r.pages > 0).length,
  indexOnly: results.filter((r) => r.pages === 0).length,
  failed: results.filter((r) => r.error !== undefined).map((r) => `${r.kind}/${r.slug}: ${r.error}`),
  truncated: results.filter((r) => r.truncated).map((r) => `${r.kind}/${r.slug}`),
  covered: seen.size,
  missing: missing.length,
  extra: extra.length,
};
const stem = `summary-${kinds.join('')}`;
await writeFile(path.join(outDir, `seen-${kinds.join('')}.json`), JSON.stringify([...seen].sort()));
await writeFile(
  path.join(outDir, `${stem}.json`),
  `${JSON.stringify({ summary, results, missing, extra: extra.slice(0, 200) }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
