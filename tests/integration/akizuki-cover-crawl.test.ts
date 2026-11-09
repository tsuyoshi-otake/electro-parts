import { describe, expect, it } from 'vitest';
import { akizukiSnapshotAdapter } from '../../src/adapters/akizuki/snapshotAdapter.ts';
import type { AkizukiRawSnapshot } from '../../src/adapters/akizuki/rawSchema.ts';
import { crawlAkizuki } from '../../src/collectors/akizuki/crawl.ts';
import { parseCoverSource, planCover, serializeCoverSource, type CoverSettings } from '../../src/collectors/akizuki/cover.ts';
import { syntheticItem, type SyntheticListing } from '../helpers/akizukiHtml.ts';
import { addListing, FAKE_BASE as BASE, fakeSite, fetcherFor, resetSite, type FakeSite } from '../helpers/fakeAkizukiSite.ts';

const DAY0 = new Date('2026-11-01T00:00:00.000Z');
const clock = (at: Date) => {
  let t = at.getTime();
  return () => new Date((t += 60_000));
};
const SETTINGS: CoverSettings = { fullCrawlEveryDays: 7, maxRepairListings: 10, escalateAfterMissing: 2 };
const item = (n: number, o: Partial<SyntheticListing> = {}) => syntheticItem(n, o);
const group = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => item(from + i));
const c = (slug: string) => ({ kind: 'c' as const, slug });
const r = (slug: string) => ({ kind: 'r' as const, slug });
const pageRequests = (s: FakeSite) => s.log.filter((u) => u.includes('/catalog/')).length;

/**
 * 30 products. `big` shows 1-20, `rest` 15-30 (so 15-20 sit in both), `small`
 * repeats 1-5 and `tag` 18-24: with these costs the cover is `big` + `rest`.
 */
function shop(s: FakeSite, rest: SyntheticListing[] = group(15, 30)): void {
  addListing(s, c('big'), 'Big', group(1, 20), 10);
  addListing(s, c('rest'), 'Rest', rest, 10);
  addListing(s, c('small'), 'Small', group(1, 5), 10);
  addListing(s, r('tag'), 'Tag', group(18, 24), 10);
}

async function fullRun(s: FakeSite, at = DAY0) {
  return crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE, listingKinds: ['c', 'r'], cover: { source: null, settings: SETTINGS }, now: clock(at) });
}

const withoutPlacement = (snap: AkizukiRawSnapshot) =>
  snap.items.map(({ sourceListings: _a, sourcePage: _b, positionOnPage: _c, duplicateOccurrences: _d, ...rest }) => rest);

describe('Akizuki cover crawl against a fake site', () => {
  it('a full run with no source reads every listing, says why, and hands back what to plan from', async () => {
    const s = fakeSite();
    shop(s);
    const result = await fullRun(s);
    expect(result.snapshot.complete).toBe(true);
    expect(result.snapshot.crawl).toEqual({
      mode: 'full', reason: 'no cover source from an earlier full run', families: ['c', 'r'], sourceBuiltAt: null,
      plannedListings: 4, repairListings: 0, missingAfterRepair: 0, escalated: false,
    });
    expect(result.snapshot.listings.map((l) => [l.slug, l.layout])).toEqual([['big', 'card'], ['rest', 'card'], ['small', 'card'], ['tag', 'card']]);
    expect(pageRequests(s)).toBe(2 + 2 + 1 + 1);
    const source = result.coverSource!;
    expect(source.builtAt).toBe(result.snapshot.retrievedAt);
    expect(source.products).toHaveLength(30);
    expect(source.listings.map((l) => l.id)).toEqual(['c/big', 'c/rest', 'c/small', 'r/tag']);
    expect(parseCoverSource(serializeCoverSource(source))).toEqual({ source });
    expect(akizukiSnapshotAdapter.validateRaw(result.snapshot).errors).toEqual([]);
  });

  it('records the layout and the cap of each listing it read, so that the plan takes card listings that are not capped first', async () => {
    const s = fakeSite();
    shop(s);
    // c/table shows all 30 on one page, r/capped all 30 on three pages with a counter at the site's cap of 3,000:
    // by pages alone either would win, but only c/big and c/rest are listings whose content is stable and complete.
    addListing(s, c('table'), 'Table', group(1, 30), 30, 30, 'table');
    addListing(s, r('capped'), 'Capped', group(1, 30), 10, 3000);
    const full = await fullRun(s);
    expect(full.snapshot.complete).toBe(true);
    const shown = (id: string) => full.coverSource!.listings.find((l) => l.id === id);
    expect(shown('c/table')).toMatchObject({ layout: 'table', truncated: false, pages: 1 });
    expect(shown('r/capped')).toMatchObject({ layout: 'card', truncated: true, pages: 3 });
    expect(shown('c/big')).toMatchObject({ layout: 'card', truncated: false, pages: 2 });
    expect(planCover(full.coverSource!).map((l) => l.id)).toEqual(['c/big', 'c/rest']);
    s.log.length = 0;
    const cover = await crawlAkizuki({
      fetcher: fetcherFor(s), baseUrl: BASE, listingKinds: ['c', 'r'], maxUncoveredProducts: 0,
      cover: { source: full.coverSource, settings: SETTINGS }, now: clock(new Date(DAY0.getTime() + 86_400_000)),
    });
    expect(pageRequests(s)).toBe(4);
    expect(cover.snapshot.crawl).toMatchObject({ mode: 'cover', plannedListings: 2 });
  });

  it('a later run reads only the planned listings and records exactly what a full run would', async () => {
    const s = fakeSite();
    shop(s);
    const full = await fullRun(s);
    s.log.length = 0;
    const cover = await crawlAkizuki({
      fetcher: fetcherFor(s), baseUrl: BASE, listingKinds: ['c', 'r'], cover: { source: full.coverSource, settings: SETTINGS }, now: clock(new Date(DAY0.getTime() + 86_400_000)),
    });
    expect(cover.coverSource).toBeNull();
    // c/big and c/rest cover all 30 for 4 pages; c/small and r/tag add nothing and are not read.
    expect(s.log.filter((u) => u.includes('/catalog/'))).toEqual([
      `${BASE}/catalog/c/big/`, `${BASE}/catalog/c/big_p2/`, `${BASE}/catalog/c/rest/`, `${BASE}/catalog/c/rest_p2/`,
    ]);
    const snap = cover.snapshot;
    expect(snap.complete).toBe(true);
    expect(snap.crawl).toMatchObject({ mode: 'cover', sourceBuiltAt: full.snapshot.retrievedAt, plannedListings: 2, repairListings: 0, missingAfterRepair: 0, escalated: false });
    expect(snap.crawl?.reason).toContain('2 listings (4 pages) planned');
    expect(snap.listingCount).toBe(2);
    expect(withoutPlacement(snap)).toEqual(withoutPlacement(full.snapshot));
    // What the importer and the sanity check compare on is the same as for a full run.
    expect(akizukiSnapshotAdapter.validateRaw(snap).errors).toEqual([]);
    const a = akizukiSnapshotAdapter.normalize(snap, 'a');
    const b = akizukiSnapshotAdapter.normalize(full.snapshot, 'b');
    expect(a.coverageId).toBe('sitemap:c+r');
    expect(a.coverageId).toBe(b.coverageId);
    expect(a.products).toEqual(b.products);
  });

  /** Runs a full day, lets `change` rewrite the shop, then runs the next day as a cover run. */
  async function nextDay(change: (s: FakeSite) => void, extra: { maxUncoveredProducts?: number; settings?: CoverSettings; days?: number; first?: (s: FakeSite) => void } = {}) {
    const s = fakeSite();
    (extra.first ?? shop)(s);
    const full = await fullRun(s);
    resetSite(s);
    change(s);
    s.log.length = 0;
    const next = await crawlAkizuki({
      fetcher: fetcherFor(s), baseUrl: BASE, listingKinds: ['c', 'r'], maxUncoveredProducts: extra.maxUncoveredProducts ?? 0,
      cover: { source: full.coverSource, settings: extra.settings ?? SETTINGS }, now: clock(new Date(DAY0.getTime() + (extra.days ?? 1) * 86_400_000)),
    });
    return { s, full, next, listingsRead: s.log.filter((u) => u.includes('/catalog/') && !u.includes('_p')).map((u) => u.slice(BASE.length + 9, -1)) };
  }

  it('puts back a product that left a planned listing but is still in another one', async () => {
    // 22 moved out of c/rest and is now only in r/tag, which the plan did not read.
    const { next, listingsRead } = await nextDay((s) => shop(s, group(15, 30).filter((i) => i.salesCode !== '100022')));
    expect(listingsRead).toEqual(['c/big', 'c/rest', 'r/tag']);
    expect(next.snapshot.complete).toBe(true);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'cover', plannedListings: 2, repairListings: 1, missingAfterRepair: 0, escalated: false });
    expect(next.snapshot.items.map((i) => i.salesCode)).toContain('100022');
    expect(next.snapshot.items).toHaveLength(30);
  });

  it('treats a product no listing shows any more as gone, and says so', async () => {
    const { next } = await nextDay(
      (s) => {
        shop(s, group(15, 29));
        s.products.add('100030'); // its page is still in the sitemap, as for a product the shop took off every listing
      },
      { maxUncoveredProducts: 5 },
    );
    expect(next.snapshot.complete).toBe(true);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'cover', repairListings: 0, missingAfterRepair: 1, escalated: false });
    expect(next.snapshot.items).toHaveLength(29);
    expect(next.snapshot.validation.warnings).toContain('1 product(s) of the last full run were not found in the 2 listings read and are treated as gone');
  });

  it('reads every other listing when more than the allowed number of products are missing, and becomes a full run', async () => {
    const { next, listingsRead } = await nextDay(
      (s) => {
        shop(s, group(15, 25));
        for (const n of [26, 27, 28, 29, 30]) s.products.add(String(100000 + n));
      },
      { maxUncoveredProducts: 5 },
    );
    expect(listingsRead).toEqual(['c/big', 'c/rest', 'c/small', 'r/tag']);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'full', plannedListings: 2, repairListings: 0, missingAfterRepair: 5, escalated: true });
    expect(next.snapshot.crawl?.reason).toContain('5 product(s) of the last full run were missing');
    expect(next.snapshot.listingCount).toBe(4);
    // An escalated run has read everything, so it renews the source like any full run.
    expect(next.coverSource?.listings.map((l) => l.id)).toEqual(['c/big', 'c/rest', 'c/small', 'r/tag']);
    expect(next.coverSource?.products).toHaveLength(25);
  });

  it('asks a failing site for nothing more: no repair, no full run, an incomplete snapshot', async () => {
    const { next, listingsRead } = await nextDay((s) => {
      shop(s);
      s.failures.set(`${BASE}/catalog/c/rest_p2/`, 99);
    });
    expect(next.snapshot.complete).toBe(false);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'cover', repairListings: 0, escalated: false });
    expect(listingsRead).toEqual(['c/big', 'c/rest']);
    expect(next.coverSource).toBeNull();
  });

  it('escalates above the allowed number of missing products and not at it', async () => {
    // escalateAfterMissing is 2. Products 29 and 30 sit only in c/rest, so taking them out of every listing leaves them missing.
    const gone = (from: number, to: number) => (s: FakeSite) => {
      shop(s, group(15, from));
      for (let n = from + 1; n <= to; n++) s.products.add(String(100000 + n));
    };
    const atLimit = await nextDay(gone(28, 30), { maxUncoveredProducts: 5 });
    expect(atLimit.next.snapshot.crawl).toMatchObject({ mode: 'cover', missingAfterRepair: 2, escalated: false });
    expect(atLimit.listingsRead).toEqual(['c/big', 'c/rest']);
    const above = await nextDay(gone(27, 30), { maxUncoveredProducts: 5 });
    expect(above.next.snapshot.crawl).toMatchObject({ mode: 'full', missingAfterRepair: 3, escalated: true });
    expect(above.listingsRead).toEqual(['c/big', 'c/rest', 'c/small', 'r/tag']);
  });

  /**
   * `c/main` shows 1-12 on two pages and is the whole cover. The `r/t1`..`r/t4` listings show one of 1-4
   * each and `r/t5` shows 11 and 12, so no listing but `c/main` is ever planned.
   */
  const mainAndTags = (s: FakeSite, main = group(1, 12)) => {
    addListing(s, c('main'), 'Main', main, 10);
    for (const n of [1, 2, 3, 4]) addListing(s, r(`t${n}`), `Tag ${n}`, [item(n)], 10);
    addListing(s, r('t5'), 'Tag 5', [item(11), item(12)], 10);
  };

  it('reads no more repair listings than it is allowed to', async () => {
    // 1-4 left c/main and are in the four single-product tag listings; two repairs find two of them.
    const { next, listingsRead } = await nextDay((s) => mainAndTags(s, group(5, 12)), {
      first: mainAndTags, maxUncoveredProducts: 5, settings: { ...SETTINGS, maxRepairListings: 2 },
    });
    expect(listingsRead).toEqual(['c/main', 'r/t1', 'r/t2']);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'cover', plannedListings: 1, repairListings: 2, missingAfterRepair: 2, escalated: false });
    expect(next.snapshot.items.map((i) => i.salesCode).sort()).toEqual(['100001', '100002', ...group(5, 12).map((i) => i.salesCode)]);
    // With room for four repairs the same day finds all of them, one listing per product, cheapest and smallest id first.
    const roomy = await nextDay((s) => mainAndTags(s, group(5, 12)), { first: mainAndTags, maxUncoveredProducts: 5, settings: { ...SETTINGS, maxRepairListings: 4 } });
    expect(roomy.listingsRead).toEqual(['c/main', 'r/t1', 'r/t2', 'r/t3', 'r/t4']);
    expect(roomy.next.snapshot.crawl).toMatchObject({ repairListings: 4, missingAfterRepair: 0 });
  });

  it('repairs nothing after a page failed even though an unread listing shows what is missing', async () => {
    const { next, listingsRead } = await nextDay(
      (s) => {
        mainAndTags(s);
        s.failures.set(`${BASE}/catalog/c/main_p2/`, 99);
      },
      { first: mainAndTags },
    );
    // Page 2 of c/main (11 and 12) never arrived; r/t5 shows both and would be read as a repair if the failure did not stop it.
    expect(listingsRead).toEqual(['c/main']);
    expect(next.snapshot.complete).toBe(false);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'cover', repairListings: 0, escalated: false });
    expect(next.coverSource).toBeNull();
  });

  it('reads everything when a planned listing has left the sitemap', async () => {
    const { next, listingsRead } = await nextDay((s) => {
      addListing(s, c('big'), 'Big', group(1, 20), 10);
      addListing(s, c('small'), 'Small', group(1, 5), 10);
      addListing(s, r('tag'), 'Tag', group(18, 24), 10);
    });
    expect(listingsRead).toEqual(['c/big', 'c/small', 'r/tag']);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'full' });
    expect(next.snapshot.crawl?.reason).toContain('1 planned listing(s) are no longer in the sitemap, e.g. c/rest');
    expect(next.snapshot.complete).toBe(true);
    expect(next.coverSource).not.toBeNull();
  });

  it('reads exactly the listings it is given even when a fresh source exists, and records no source from them', async () => {
    const s = fakeSite();
    shop(s);
    const full = await fullRun(s);
    s.log.length = 0;
    const next = await crawlAkizuki({
      fetcher: fetcherFor(s), baseUrl: BASE, listingKinds: ['c', 'r'], listings: [c('big')], maxUncoveredProducts: 100,
      cover: { source: full.coverSource, settings: SETTINGS }, now: clock(new Date(DAY0.getTime() + 86_400_000)),
    });
    expect(next.snapshot.complete).toBe(true);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'full', plannedListings: 1 });
    expect(next.snapshot.crawl?.reason).toContain('given explicitly');
    expect(pageRequests(s)).toBe(2);
    expect(next.coverSource).toBeNull();
  });

  it('reads everything again once the last full run is old enough', async () => {
    const { next, listingsRead } = await nextDay((s) => shop(s), { days: 8 });
    expect(listingsRead).toEqual(['c/big', 'c/rest', 'c/small', 'r/tag']);
    expect(next.snapshot.crawl?.mode).toBe('full');
    expect(next.snapshot.crawl?.reason).toContain('8.0 days ago (a full run every 7 days)');
    expect(next.coverSource?.builtAt).toBe(next.snapshot.retrievedAt);
  });

  it('reads a product only a table listing shows, from that listing, as a full run does', async () => {
    const withSpec = (s: FakeSite) => {
      shop(s);
      addListing(s, c('spec'), 'Spec', [item(99)], 10, 1, 'table');
    };
    const { next, listingsRead } = await nextDay(withSpec, { first: withSpec });
    expect(listingsRead).toEqual(['c/big', 'c/rest', 'c/spec']);
    expect(next.snapshot.crawl).toMatchObject({ mode: 'cover', plannedListings: 3, missingAfterRepair: 0 });
    const spec = next.snapshot.items.find((i) => i.salesCode === '100099');
    expect(spec?.stock.purchasable).toBeNull();
    expect(next.snapshot.items).toHaveLength(31);
  });

  it('without the cover setting every run is a full run and the snapshot has no crawl block', async () => {
    const s = fakeSite();
    shop(s);
    const result = await crawlAkizuki({ fetcher: fetcherFor(s), baseUrl: BASE, listingKinds: ['c', 'r'], now: clock(DAY0) });
    expect(result.snapshot.crawl).toBeUndefined();
    expect(result.coverSource).toBeNull();
    expect(pageRequests(s)).toBe(6);
  });
});
