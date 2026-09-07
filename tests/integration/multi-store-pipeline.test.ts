import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HttpTransport } from '../../src/collectors/politeFetcher.ts';
import { verifyStateDir } from '../../src/db/finalize.ts';
import { parsePipelineConfig, type PipelineConfig } from '../../src/pipeline/config.ts';
import { runPipeline, SITE_STATE_DIR, type RunOptions, type RunResult } from '../../src/pipeline/run.ts';
import { syntheticItem, type SyntheticListing } from '../helpers/akizukiHtml.ts';
import {
  addListing,
  fakeSite,
  resetSite,
  transportFor as akizukiTransport,
  FAKE_BASE as AKIZUKI_BASE,
  type FakeSite,
} from '../helpers/fakeAkizukiSite.ts';
import { addProducts, fakeShop, transportFor as shopifyTransport, FAKE_BASE as SHOP_BASE, type FakeShop } from '../helpers/fakeShopifySite.ts';

/**
 * Two stores publishing into one site.
 *
 * The stores share exactly three things, and every one of them is a way for
 * one store's run to damage the other's data: one SQLite history, one
 * `state/` directory, and one `site/` tree that the deployment replaces
 * wholesale. So the runs have to be chained — the second store starts from
 * the state the first one just wrote — and a store whose run fails has to be
 * put back into the site before it is deployed, or Pages loses it.
 */
describe('two stores publishing into one site', () => {
  let root: string;
  let pagesDir: string;
  let akizukiConfig: PipelineConfig;
  let switchScienceConfig: PipelineConfig;
  const akizuki: FakeSite = fakeSite();
  const shop: FakeShop = fakeShop();
  /** Distinct, ordered observation times so `latestObservedAt` is meaningful. */
  const clock = (() => {
    let t = Date.parse('2026-09-07T06:00:00.000Z');
    return () => new Date((t += 1000));
  })();
  /** Set by the second cycle, checked after the republish in the third. */
  let switchScienceVersion = '';

  const catalog = (n: number, overrides: (i: number) => Partial<SyntheticListing> = () => ({})): SyntheticListing[] =>
    Array.from({ length: n }, (_, i) => syntheticItem(i + 1, overrides(i + 1)));

  const siteDir = (): string => path.join(root, 'site');
  const stateDir = (): string => path.join(siteDir(), SITE_STATE_DIR);
  const storePath = (storeId: string, ...rest: string[]): string => path.join(siteDir(), 'data', 'v1', 'stores', storeId, ...rest);
  const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);
  const readJson = async (file: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  const manifestOf = (storeId: string): Promise<Record<string, unknown>> => readJson(storePath(storeId, 'manifest.json'));

  /** The price series a store's product file publishes, in minor units. */
  const pricesOf = async (storeId: string, pageKey: string): Promise<number[]> => {
    const product = (await readJson(storePath(storeId, 'products', `${pageKey}.json`))) as unknown as {
      offers: { segments: { points: [number, string, number, number][] }[] }[];
    };
    return product.offers[0]!.segments[0]!.points.map((p) => p[2]);
  };

  const runStore = (config: PipelineConfig, transport: HttpTransport, options: Omit<Partial<RunOptions>, 'config' | 'deps'>): Promise<RunResult> =>
    runPipeline({
      config,
      bootstrap: false,
      cwd: root,
      deps: { log: () => undefined, now: clock, transport, sleep: async () => undefined, random: () => 0 },
      ...options,
    });

  const runAkizuki = (options: Omit<Partial<RunOptions>, 'config' | 'deps'>): Promise<RunResult> =>
    runStore(akizukiConfig, akizukiTransport(akizuki), options);
  const runSwitchScience = (options: Omit<Partial<RunOptions>, 'config' | 'deps'>): Promise<RunResult> =>
    runStore(switchScienceConfig, shopifyTransport(shop), options);

  /** Simulates the deploy: the state the run produced becomes the published one. */
  const deploy = async (): Promise<void> => {
    await rm(pagesDir, { recursive: true, force: true });
    await cp(stateDir(), pagesDir, { recursive: true });
  };

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ep-multistore-'));
    pagesDir = path.join(root, 'published-state');
    akizukiConfig = parsePipelineConfig({
      storeId: 'akizuki',
      collector: { userAgent: 'electro-parts test agent', baseUrl: AKIZUKI_BASE, listingKinds: ['r'], minIntervalMs: 500, jitterMs: 0 },
      inventory: { retentionDays: 400, pointLimit: 10 },
      previousStateUrl: null,
    });
    switchScienceConfig = parsePipelineConfig({
      storeId: 'switch-science',
      collector: { userAgent: 'electro-parts test agent', baseUrl: SHOP_BASE, pageLimit: 10, minIntervalMs: 500, jitterMs: 0 },
      inventory: { retentionDays: 400, pointLimit: 10 },
      previousStateUrl: null,
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lets a second store join a published site without bootstrapping over the first', async () => {
    addListing(akizuki, { kind: 'r', slug: 'rkit' }, '組立キット', catalog(20), 10);
    addProducts(shop, 20);

    const first = await runAkizuki({ previous: { dir: pagesDir }, bootstrap: true });
    expect(first.report.outcome).toBe('published');
    expect(first.report.mode).toBe('bootstrap');

    // A store that arrives later is not a bootstrap. The site already has a
    // history, and starting from an empty one would throw the other store away
    // — which is exactly what the refusal is there to prevent.
    const refused = await runSwitchScience({ previous: { dir: stateDir() }, bootstrap: true });
    expect(refused.report.outcome).toBe('failed');
    expect(refused.report.stages[0]!.error).toMatch(/refusing to bootstrap/);
    expect(refused.report.publishable).toBe(false);

    const joined = await runSwitchScience({ previous: { dir: stateDir() } });
    expect(joined.report.outcome).toBe('published');
    expect(joined.report.mode).toBe('incremental');
    // Incremental over a state that has never seen this store: no runs of its
    // own to continue from, and the other store's runs are none of its business.
    expect(joined.report.stages[0]!.details).toMatchObject({ previousRuns: 0 });
    expect(joined.report.stages[3]!.details).toMatchObject({ status: 'imported', productsNew: 20 });

    // Both datasets stand side by side, and the second run did not rewrite the
    // first store's files: same dataset version, still 20 products.
    expect(await manifestOf('akizuki')).toMatchObject({ storeId: 'akizuki', productCount: 20, datasetVersion: first.report.datasetVersion });
    expect(await manifestOf('switch-science')).toMatchObject({ storeId: 'switch-science', productCount: 20 });
    expect(await exists(storePath('akizuki', 'products', '100003.json'))).toBe(true);
    expect(await exists(storePath('switch-science', 'products', '1003.json'))).toBe(true);

    const state = await verifyStateDir(stateDir());
    expect(state.stores).toEqual({
      akizuki: { runCount: 1, latestObservedAt: expect.stringMatching(/^2026-09-07T06/) },
      'switch-science': { runCount: 1, latestObservedAt: expect.stringMatching(/^2026-09-07T06/) },
    });
  });

  it('advances both histories in one cycle, each run starting from what the previous one wrote', async () => {
    await deploy();
    // One price change on each side, in key spaces that overlap in shape but
    // not in meaning: `1003` is a Switch Science handle, `100003` an Akizuki
    // sales code, and neither store may see the other's change.
    resetSite(akizuki);
    addListing(akizuki, { kind: 'r', slug: 'rkit' }, '組立キット', catalog(20, (i) => (i === 3 ? { priceYen: 999 } : {})), 10);
    shop.products[2]!.variants[0]!.price = '900';

    // Akizuki reads the published state; Switch Science reads what the Akizuki
    // run just wrote. Run in parallel from the same published state, the second
    // to finalize would silently drop the first one's run.
    const a = await runAkizuki({ previous: { dir: pagesDir } });
    const s = await runSwitchScience({ previous: { dir: stateDir() } });
    expect([a.report.outcome, s.report.outcome]).toEqual(['published', 'published']);
    expect(s.report.stages[0]!.details).toMatchObject({ previousRuns: 1 });
    switchScienceVersion = s.report.datasetVersion!;

    expect(await pricesOf('akizuki', '100003')).toEqual([130, 999]);
    expect(await pricesOf('switch-science', '1003')).toEqual([300, 900]);
    // Untouched products keep a single point: neither run rewrote the other's history.
    expect(await pricesOf('akizuki', '100004')).toEqual([140]);
    expect(await pricesOf('switch-science', '1004')).toEqual([400]);

    const state = await verifyStateDir(stateDir());
    expect(state.stores['akizuki']!.runCount).toBe(2);
    expect(state.stores['switch-science']!.runCount).toBe(2);
  });

  it('puts a failed store back into the site with a republish instead of deleting it from Pages', async () => {
    await deploy();
    // CI checks the repository out fresh, so a run starts from an empty site
    // directory: whatever it does not write is deleted from Pages on deploy.
    await rm(siteDir(), { recursive: true, force: true });
    resetSite(akizuki);
    addListing(akizuki, { kind: 'r', slug: 'rkit' }, '組立キット', catalog(20, (i) => ({ availableQuantity: 90 + i, ...(i === 3 ? { priceYen: 999 } : {}) })), 10);
    const a = await runAkizuki({ previous: { dir: pagesDir } });
    expect(a.report.outcome).toBe('published');

    shop.sitemapMissing = true;
    const failed = await runSwitchScience({ previous: { dir: stateDir() } });
    shop.sitemapMissing = false;
    expect(failed.report.outcome).toBe('failed');
    expect(failed.report.publishable).toBe(false);
    // Nothing was written for it, so the site now carries one store. Deployed
    // as it stands, it would take the other store's dataset off Pages.
    expect(await exists(storePath('switch-science'))).toBe(false);
    expect(await exists(storePath('akizuki', 'manifest.json'))).toBe(true);

    const republished = await runSwitchScience({ previous: { dir: stateDir() }, republish: true });
    expect(republished.report.outcome).toBe('unchanged');
    expect(republished.report.publishable).toBe(true);
    expect(republished.report.stages.map((st) => `${st.name}:${st.status}`)).toEqual([
      'previous_state:ok',
      'collect:skipped',
      'validate:skipped',
      'import:skipped',
      'compact:skipped',
      'generate:ok',
      'finalize:ok',
      'verify:ok',
    ]);

    // The history did not move, so what comes back is the dataset that is
    // already published — the failed run cost the store a cycle, not its data.
    expect(await manifestOf('switch-science')).toMatchObject({ datasetVersion: switchScienceVersion });
    expect(await pricesOf('switch-science', '1003')).toEqual([300, 900]);
    // And the republish left the store that did run alone.
    expect(await manifestOf('akizuki')).toMatchObject({ datasetVersion: a.report.datasetVersion });
    const state = await verifyStateDir(stateDir());
    expect(state.stores['akizuki']!.runCount).toBe(3);
    expect(state.stores['switch-science']!.runCount).toBe(2);
  });
});
