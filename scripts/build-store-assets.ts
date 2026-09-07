/**
 * Produces the Chrome Web Store listing images.
 *
 * The store wants screenshots of the extension doing its job. Hand-captured
 * ones go stale the first time the panel changes, and a stale screenshot is a
 * listing that misrepresents the product — which is exactly what review looks
 * for. So they are generated the same way the E2E suite proves the extension
 * works: the unpacked extension, loaded into a real browser, on saved product
 * pages, with the store's own hosts served entirely by route interception.
 *
 * Two of the shots show the cross-store comparison, which is the feature the
 * listing leads with. That needs both stores' records for one mapped product,
 * and the checked-in snapshots cover neither side of a mapped pair, so those
 * shots read the *published* dataset over the network — our own Pages origin,
 * never a store. The listing then shows prices that were really published.
 *
 *   node --import tsx scripts/build-store-assets.ts [--out DIR]
 *
 * Needs the full Chromium build once per machine: `npx playwright install chromium`.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import buildFixtureSite, { E2E_EXTENSION_DIR, E2E_SITE_DIR } from '../tests/e2e/global-setup.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** The store accepts 1280x800 or 640x400; the larger one is what the listing shows. */
export const SCREENSHOT_SIZE = { width: 1280, height: 800 } as const;

const DATA_ORIGIN = 'https://tsuyoshi-otake.github.io';

interface Shot {
  /** Output file name, without directory. */
  name: string;
  productUrl: string;
  /** Saved page, gzipped, under tests/fixtures. */
  fixture: string;
  /** Everything else on that host: served empty, so no request leaves the browser. */
  hostPattern: string;
  /**
   * `generated` serves the dataset the E2E suite builds from the checked-in
   * snapshots, so nothing leaves the machine. `published` lets the extension
   * read the live dataset from `DATA_ORIGIN`: the only way to show a real
   * cross-store comparison, because a mapped pair needs both stores' records.
   */
  dataset: 'generated' | 'published';
  /** Extra element inside the panel that must be visible before the shot. */
  requires?: string;
}

const SHOTS: readonly Shot[] = [
  {
    name: 'screenshot-comparison-akizuki.png',
    productUrl: 'https://akizukidenshi.com/catalog/g/g117209/',
    fixture: path.join('akizuki', 'html', 'g117209.html.gz'),
    hostPattern: 'https://akizukidenshi.com/**',
    dataset: 'published',
    requires: '.comparison-difference',
  },
  {
    name: 'screenshot-comparison-switch-science.png',
    productUrl: 'https://www.switch-science.com/products/6262',
    fixture: path.join('switch-science', 'html', '6262.html.gz'),
    hostPattern: 'https://www.switch-science.com/**',
    dataset: 'published',
    requires: '.comparison-difference',
  },
  {
    name: 'screenshot-akizuki.png',
    productUrl: 'https://akizukidenshi.com/catalog/g/g109951/',
    fixture: path.join('akizuki', 'html', 'g109951.html.gz'),
    hostPattern: 'https://akizukidenshi.com/**',
    dataset: 'generated',
  },
  {
    name: 'screenshot-switch-science.png',
    productUrl: 'https://www.switch-science.com/products/9381',
    fixture: path.join('switch-science', 'html', '9381.html.gz'),
    hostPattern: 'https://www.switch-science.com/**',
    dataset: 'generated',
  },
];

async function serve(context: BrowserContext, shot: Shot): Promise<void> {
  const html = gunzipSync(await readFile(path.join(repoRoot, 'tests', 'fixtures', shot.fixture))).toString('utf8');
  await context.route(shot.hostPattern, async (route) => {
    const url = route.request().url();
    if (url === shot.productUrl || url === `${shot.productUrl}/`) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
  if (shot.dataset === 'published') return; // read from the real origin, unintercepted
  await context.route(`${DATA_ORIGIN}/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/electro-parts\//, '');
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: await readFile(path.join(E2E_SITE_DIR, rel)) });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
}

async function capture(page: Page, shot: Shot, outDir: string): Promise<string> {
  await page.goto(shot.productUrl, { timeout: 30_000 });
  // The host element is created once and keeps its identity; the panel inside
  // it is replaced when the data arrives, so scroll by the host and never hold
  // a handle on the panel across that swap.
  const host = page.locator('#electronics-price-history-root');
  await host.waitFor({ state: 'attached', timeout: 30_000 });
  await host.locator('section').waitFor({ state: 'visible', timeout: 30_000 });
  // The listing image should show the feature, not the store's header. The
  // chart is drawn only once the panel is on screen, so scroll first.
  await host.scrollIntoViewIfNeeded();
  // Both charts carry .eph-chart; only the single-store one is role="img".
  await host.locator('svg.eph-chart').waitFor({ state: 'visible', timeout: 30_000 });
  // The other store's price arrives in a second request; without waiting for
  // the figure itself the shot can catch "読み込み中".
  if (shot.requires) await host.locator(shot.requires).first().waitFor({ state: 'visible', timeout: 30_000 });
  // No listing image may show a spinner: the related cards load separately.
  await page.waitForFunction(() => {
    const text = document.querySelector('#electronics-price-history-root')?.shadowRoot?.textContent ?? '';
    return text.length > 0 && !text.includes('読み込み中');
  }, undefined, { timeout: 30_000 });
  // Leave a band of the store page above the panel: the listing has to show
  // where the panel appears, not just what it contains.
  await host.evaluate((el) => { window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 96); });
  const file = path.join(outDir, shot.name);
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

export async function buildStoreAssets(outDir: string): Promise<{ files: string[] }> {
  await buildFixtureSite(); // datasets, userscript and the unpacked extension under test-results/
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  // One browser per shot. The extension caches manifests and products in
  // chrome.storage.local, so a shared profile lets the published dataset's
  // version leak into a generated-dataset shot, which then renders a
  // "publication in progress" note — an English warning in a listing image.
  for (const shot of SHOTS) {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'eph-store-'));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium', // the bundled headless shell cannot load extensions
        viewport: { ...SCREENSHOT_SIZE },
        args: [`--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`],
      });
      await serve(context, shot);
      files.push(await capture(await context.newPage(), shot, outDir));
    } finally {
      await context?.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  }
  await writeFile(
    path.join(outDir, 'README.txt'),
    [
      'Chrome Web Store listing images, generated by scripts/build-store-assets.ts.',
      `Size: ${SCREENSHOT_SIZE.width}x${SCREENSHOT_SIZE.height}. Do not edit by hand; regenerate with npm run build:store-assets.`,
      'The two comparison images read the published dataset; the other two read the dataset built from the checked-in snapshots.',
      'Listing text and the answers to the privacy questions: docs/chrome-web-store-listing.md.',
      '',
    ].join('\n'),
  );
  return { files };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'dist/store' } } });
  const { files } = await buildStoreAssets(path.resolve(values.out));
  for (const file of files) process.stderr.write(`captured ${file}\n`);
}
