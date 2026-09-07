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

/**
 * Promotional tiles. The store shows these where a screenshot does not fit —
 * the small one in listings, the marquee one if the item is ever featured.
 * They carry no claim that is not already in the manifest and the listing:
 * the name, what the panel shows, and the two stores actually supported.
 */
const TILES = [
  { name: 'promo-tile-small.png', width: 440, height: 280 },
  { name: 'promo-tile-marquee.png', width: 1400, height: 560 },
] as const;

/**
 * The tile markup. Every size is derived from the tile height, so one design
 * serves both canvases. The background is opaque on purpose: the store rejects
 * PNGs with an alpha channel, and Chromium writes a 24-bit PNG only when
 * nothing on the page is transparent.
 */
function tileHtml(iconUri: string, width: number, height: number): string {
  const unit = height / 280; // the small tile is the reference design
  return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    body {
      width: ${width}px; height: ${height}px; box-sizing: border-box;
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      gap: ${0.05 * height}px; padding: ${0.09 * height}px;
      background: #12212f; color: #f4f7fa; text-align: center;
      font-family: "Yu Gothic UI", "Yu Gothic", Meiryo, system-ui, sans-serif;
    }
    img { width: ${64 * unit}px; height: ${64 * unit}px; }
    .name { font-size: ${26 * unit}px; font-weight: 700; letter-spacing: .01em; }
    .rule { width: ${120 * unit}px; height: ${2 * unit}px; background: #2f4f68; }
    .what { font-size: ${17 * unit}px; line-height: 1.5; }
    .stores { font-size: ${15 * unit}px; color: #9fb6c8; }
  </style>
  <img src="${iconUri}" alt="">
  <div class="name">Electronics Price History</div>
  <div class="rule"></div>
  <div class="what">価格・在庫・掲載状況の履歴を<br>商品ページに表示</div>
  <div class="stores">秋月電子通商 / スイッチサイエンス</div>`;
}

async function captureTiles(outDir: string, files: string[]): Promise<void> {
  const icon = await readFile(path.join(E2E_EXTENSION_DIR, 'icons', 'icon-128.png'));
  const iconUri = `data:image/png;base64,${icon.toString('base64')}`;
  // No extension is involved here, so one plain browser serves both tiles.
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    for (const tile of TILES) {
      const page = await browser.newPage({ viewport: { width: tile.width, height: tile.height } });
      await page.setContent(tileHtml(iconUri, tile.width, tile.height), { waitUntil: 'load' });
      const file = path.join(outDir, tile.name);
      await page.screenshot({ path: file });
      await page.close();
      files.push(file);
    }
  } finally {
    await browser.close();
  }
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
  await captureTiles(outDir, files);
  await writeFile(
    path.join(outDir, 'README.txt'),
    [
      'Chrome Web Store listing images, generated by scripts/build-store-assets.ts.',
      `Screenshots: ${SCREENSHOT_SIZE.width}x${SCREENSHOT_SIZE.height}. Promotional tiles: ${TILES.map((t) => `${t.width}x${t.height}`).join(', ')}.`,
      'Do not edit by hand; regenerate with npm run build:store-assets.',
      'The two comparison images read the published dataset; the other two read the dataset built from the checked-in snapshots.',
      'The store icon is the packaged icons/icon-128.png; it is not generated here.',
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
