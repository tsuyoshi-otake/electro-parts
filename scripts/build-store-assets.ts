/**
 * Produces the Chrome Web Store listing images.
 *
 * The store wants screenshots of the extension doing its job. Hand-captured
 * ones go stale the first time the panel changes, and a stale screenshot is a
 * listing that misrepresents the product — which is exactly what review looks
 * for. So they are generated the same way the E2E suite proves the extension
 * works: the unpacked extension, loaded into a real browser, on the same saved
 * product pages and the same generated dataset. Nothing leaves the machine;
 * both origins are served by route interception.
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
}

const SHOTS: readonly Shot[] = [
  {
    name: 'screenshot-akizuki.png',
    productUrl: 'https://akizukidenshi.com/catalog/g/g109951/',
    fixture: path.join('akizuki', 'html', 'g109951.html.gz'),
    hostPattern: 'https://akizukidenshi.com/**',
  },
  {
    name: 'screenshot-switch-science.png',
    productUrl: 'https://www.switch-science.com/products/9381',
    fixture: path.join('switch-science', 'html', '9381.html.gz'),
    hostPattern: 'https://www.switch-science.com/**',
  },
];

async function serveOffline(context: BrowserContext, shot: Shot): Promise<void> {
  const html = gunzipSync(await readFile(path.join(repoRoot, 'tests', 'fixtures', shot.fixture))).toString('utf8');
  await context.route(shot.hostPattern, async (route) => {
    const url = route.request().url();
    if (url === shot.productUrl || url === `${shot.productUrl}/`) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
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
  await host.locator('svg[role="img"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.evaluate(() => window.scrollBy(0, -80));
  const file = path.join(outDir, shot.name);
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

export async function buildStoreAssets(outDir: string): Promise<{ files: string[] }> {
  await buildFixtureSite(); // datasets, userscript and the unpacked extension under test-results/
  await mkdir(outDir, { recursive: true });
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'eph-store-'));
  let context: BrowserContext | undefined;
  const files: string[] = [];
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium', // the bundled headless shell cannot load extensions
      viewport: { ...SCREENSHOT_SIZE },
      args: [`--disable-extensions-except=${E2E_EXTENSION_DIR}`, `--load-extension=${E2E_EXTENSION_DIR}`],
    });
    for (const shot of SHOTS) {
      const scoped = await context.newPage();
      await serveOffline(context, shot);
      files.push(await capture(scoped, shot, outDir));
      await context.unrouteAll();
    }
    await writeFile(
      path.join(outDir, 'README.txt'),
      [
        'Chrome Web Store listing images, generated by scripts/build-store-assets.ts.',
        `Size: ${SCREENSHOT_SIZE.width}x${SCREENSHOT_SIZE.height}. Do not edit by hand; regenerate with npm run build:store-assets.`,
        'Listing text and the answers to the privacy questions: docs/chrome-web-store-listing.md.',
        '',
      ].join('\n'),
    );
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
  return { files };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'dist/store' } } });
  const { files } = await buildStoreAssets(path.resolve(values.out));
  for (const file of files) process.stderr.write(`captured ${file}\n`);
}
