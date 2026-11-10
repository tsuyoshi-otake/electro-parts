/**
 * Page-load cost of the Chrome extension on saved product pages, measured in Chromium.
 *
 *   npm run test:e2e            # once: writes the dataset the pages read (test-results/e2e-site)
 *   npm run build:extension
 *   node --import tsx tests/bench/extension-load.ts [--ext dist/extension | none] [--runs 10]
 *
 * Opens two saved Akizuki pages (one product without relations, one with nine) and reports, as the
 * median of the runs after two warm-ups: script time in the page, total task time, JS heap after a
 * collection, and the time until the panel shows the product. `--ext none` measures the same pages
 * without the extension, which is the baseline to subtract.
 *
 * No request leaves the browser: the store page and the data origin are served by route interception.
 * Nothing here is a test: it never fails on a budget, it only measures (ADR-0035 holds the numbers).
 * The browser runs under an 8 minute limit and its profile is removed at the end.
 */
import { chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values } = parseArgs({ options: { ext: { type: 'string', default: 'dist/extension' }, runs: { type: 'string', default: '10' } } });
const ext = values.ext === 'none' ? null : path.resolve(values.ext);
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
const WARM_UP = 2;
const SETTLE_MS = 2500;

const siteDir = path.join(repo, 'test-results', 'e2e-site');
const DATA_ORIGIN = 'https://tsuyoshi-otake.github.io';
const PAGES = [
  { label: 'no relations (109951)', url: 'https://akizukidenshi.com/catalog/g/g109951/', fixture: 'g109951.html.gz' },
  { label: '9 relations (117209)', url: 'https://akizukidenshi.com/catalog/g/g117209/', fixture: 'g117209.html.gz' },
];

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const userDataDir = await mkdtemp(path.join(tmpdir(), 'eph-measure-'));
const deadline = setTimeout(() => { console.error('time limit reached'); process.exit(2); }, 8 * 60_000);
let context: BrowserContext | undefined;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: ext === null ? [] : [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const bodies = new Map<string, string>();
  for (const p of PAGES) bodies.set(p.url, gunzipSync(await readFile(path.join(repo, 'tests', 'fixtures', 'akizuki', 'html', p.fixture))).toString('utf8'));
  await context.route('https://akizukidenshi.com/**', async (route) => {
    const body = bodies.get(route.request().url());
    if (body !== undefined) await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    else await route.fulfill({ status: 204, body: '' });
  });
  await context.route(`${DATA_ORIGIN}/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/electro-parts\//, '');
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(path.join(siteDir, rel)) });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  const out: Record<string, unknown> = { extension: ext === null ? 'none' : path.basename(ext), runs };
  for (const p of PAGES) {
    const script: number[] = [];
    const task: number[] = [];
    const heap: number[] = [];
    const panelMs: number[] = [];
    let relatedRows = -1;
    for (let i = 0; i < runs + WARM_UP; i++) {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const t0 = Date.now();
      await page.goto(p.url);
      let shown = Number.NaN;
      if (ext !== null) {
        await page.locator('#electronics-price-history-root section').filter({ hasText: '観測期間' }).first().waitFor({ timeout: 20_000 });
        shown = Date.now() - t0;
      }
      await page.waitForTimeout(SETTLE_MS);
      if (ext !== null) relatedRows = await page.locator('#electronics-price-history-root a[href^="https://"]').count();
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (name: string): number => metrics.find((m) => m.name === name)?.value ?? Number.NaN;
      if (i >= WARM_UP) {
        script.push(get('ScriptDuration') * 1000);
        task.push(get('TaskDuration') * 1000);
        heap.push(get('JSHeapUsedSize') / 1_048_576);
        panelMs.push(shown);
      }
      await page.close();
    }
    out[p.label] = {
      scriptMs: { median: +median(script).toFixed(1), min: +Math.min(...script).toFixed(1), max: +Math.max(...script).toFixed(1) },
      taskMs: { median: +median(task).toFixed(1) },
      heapMB: { median: +median(heap).toFixed(2), min: +Math.min(...heap).toFixed(2), max: +Math.max(...heap).toFixed(2) },
      panelShownMs: ext === null ? null : { median: Math.round(median(panelMs)) },
      externalLinksInPanel: relatedRows,
    };
  }
  console.log(JSON.stringify(out, null, 2));
} finally {
  clearTimeout(deadline);
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}
