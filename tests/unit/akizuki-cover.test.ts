import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  buildCoverSource,
  decideCrawl,
  FULL_CRAWL_SLACK_MS,
  parseCoverSource,
  pickRepair,
  planCover,
  serializeCoverSource,
  type CoverSettings,
  type CoverSource,
  type ListingMembership,
} from '../../src/collectors/akizuki/cover.ts';
import type { AkizukiSitemap } from '../../src/collectors/akizuki/sitemap.ts';

const card = (id: string, pages: number, codes: string[], extra: Partial<ListingMembership> = {}): ListingMembership => ({ id, pages, layout: 'card', truncated: false, codes, ...extra });
const source = (memberships: ListingMembership[], builtAt = '2026-11-01T00:00:00.000Z'): CoverSource => buildCoverSource(builtAt, ['c', 'r'], memberships);
const idsOf = (plan: { id: string }[]) => plan.map((l) => l.id);
const sitemapOf = (ids: string[]): AkizukiSitemap => ({
  productCodes: [],
  categorySlugs: ids.filter((i) => i.startsWith('c/')).map((i) => i.slice(2)),
  genreSlugs: ids.filter((i) => i.startsWith('r/')).map((i) => i.slice(2)),
  sources: [],
  lastModified: null,
});
const SETTINGS: CoverSettings = { fullCrawlEveryDays: 7, maxRepairListings: 40, escalateAfterMissing: 30 };

describe('buildCoverSource', () => {
  it('indexes products once, sorts everything and drops a listing that showed nothing', () => {
    const s = source([card('r/b', 2, ['300', '100', '100']), card('c/a', 1, ['200', '100']), card('c/empty', 1, [])]);
    expect(s.products).toEqual(['100', '200', '300']);
    expect(s.listings.map((l) => [l.id, l.pages, l.codes])).toEqual([['c/a', 1, [0, 1]], ['r/b', 2, [0, 2]]]);
    expect(s.families).toEqual(['c', 'r']);
  });

  it('stores the families sorted whatever order the config listed them in, so that the file it writes is one it can read back', () => {
    const s = buildCoverSource('2026-11-01T00:00:00.000Z', ['r', 'c'], [card('c/a', 1, ['1']), card('r/b', 1, ['2'])]);
    expect(s.families).toEqual(['c', 'r']);
    expect(parseCoverSource(serializeCoverSource(s))).toEqual({ source: s });
  });
});

describe('planCover', () => {
  it('takes the listing with the most new products per page first, and never reads a listing that adds nothing', () => {
    // a: 4 new for 1 page (4.0), b: 6 for 2 pages (3.0), c: 5 for 10 pages (0.5), d only repeats.
    const s = source([
      card('c/a', 1, ['1', '2', '3', '4']),
      card('c/b', 2, ['1', '2', '5', '6', '7', '8']),
      card('c/c', 10, ['9', '10', '11', '12', '13']),
      card('c/d', 1, ['1', '5']),
    ]);
    expect(idsOf(planCover(s))).toEqual(['c/a', 'c/b', 'c/c']);
  });

  it('breaks ties by more products, then by id, whatever order the listings are given in', () => {
    const memberships = [card('r/z', 1, ['1', '2']), card('c/y', 1, ['3', '4']), card('c/x', 2, ['5', '6', '7', '8'])];
    const forward = idsOf(planCover(source(memberships)));
    const reversed = idsOf(planCover(source([...memberships].reverse())));
    expect(forward).toEqual(['c/x', 'c/y', 'r/z']);
    expect(reversed).toEqual(forward);
  });

  it('on equal score takes the listing with more new products even when its id sorts later', () => {
    // Both add one product per page; c/z adds two products for two pages, c/a one for one.
    const memberships = [card('c/a', 1, ['1']), card('c/z', 2, ['2', '3'])];
    expect(idsOf(planCover(source(memberships)))).toEqual(['c/z', 'c/a']);
    expect(idsOf(planCover(source([...memberships].reverse())))).toEqual(['c/z', 'c/a']);
  });

  it('uses a table or truncated listing only for products no stable card listing shows', () => {
    const s = source([
      card('c/cards', 5, ['1', '2', '3']),
      card('c/table', 1, ['1', '2', '3', '4', '5', '6'], { layout: 'table' }),
      card('c/capped', 1, ['1', '2', '3', '4', '7'], { truncated: true }),
    ]);
    // The table listing is far cheaper per product, but its occurrences carry no stock quantity.
    expect(idsOf(planCover(s))).toEqual(['c/cards', 'c/table', 'c/capped']);
    const plan = planCover(s);
    expect(plan[0]?.layout).toBe('card');
    // What the fallback adds is only what the cards lack: 4, 5, 6 from the table, then 7 from the capped one.
    expect(plan.slice(1).map((l) => l.id)).toEqual(['c/table', 'c/capped']);
  });

  it('property: the plan covers exactly the products the listings show, each listing adds something, and it never costs more than reading all', () => {
    const codes = Array.from({ length: 40 }, (_, i) => String(1000 + i));
    const listing = fc.record({
      pages: fc.integer({ min: 1, max: 8 }),
      layout: fc.constantFrom('card', 'card', 'table'),
      truncated: fc.boolean(),
      members: fc.uniqueArray(fc.constantFrom(...codes), { minLength: 1, maxLength: 15 }),
    });
    fc.assert(
      fc.property(fc.array(listing, { minLength: 1, maxLength: 25 }), (specs) => {
        const memberships = specs.map((l, i): ListingMembership => ({ id: `c/l${String(i).padStart(2, '0')}`, pages: l.pages, layout: l.layout as 'card' | 'table', truncated: l.truncated, codes: l.members }));
        const s = source(memberships);
        const plan = planCover(s);
        const reached = new Set(plan.flatMap((l) => l.codes));
        expect(reached.size).toBe(s.products.length);
        const seen = new Set<number>();
        for (const l of plan) {
          expect(l.codes.some((i) => !seen.has(i))).toBe(true);
          for (const i of l.codes) seen.add(i);
        }
        expect(plan.reduce((n, l) => n + l.pages, 0)).toBeLessThanOrEqual(s.listings.reduce((n, l) => n + l.pages, 0));
        expect(new Set(idsOf(plan)).size).toBe(plan.length);
      }),
    );
  });
});

describe('pickRepair', () => {
  const s = source([
    card('c/a', 1, ['1', '2']),
    card('c/cheap-table', 1, ['3', '4', '5'], { layout: 'table' }),
    card('c/dear-card', 6, ['3', '4']),
    card('c/read', 1, ['3']),
  ]);
  const idx = (...codes: string[]) => new Set(codes.map((c) => s.products.indexOf(c)));

  it('prefers a stable card listing even when a table listing is cheaper per product', () => {
    expect(pickRepair(s, idx('3', '4'), new Set(['c/read']))?.id).toBe('c/dear-card');
  });

  it('takes the card listing with the most missing products per page, then the one with more, then the smaller id', () => {
    const cards = source([
      card('c/a-dear', 4, ['1', '2', '3']),
      card('c/b-cheap', 1, ['1', '2']),
      card('c/c-small', 1, ['3']),
      card('c/d-big', 3, ['1', '2', '3']),
      card('c/e-twin', 3, ['1', '2', '3']),
    ]);
    const at = (...codes: string[]) => new Set(codes.map((c) => cards.products.indexOf(c)));
    // Per page: dear 0.75, cheap 2, small 1, big 1, twin 1.
    expect(pickRepair(cards, at('1', '2', '3'), new Set())?.id).toBe('c/b-cheap');
    // With the cheap one read: small, big and twin tie on score 1; big and twin add three products to small's one, and the smaller id wins.
    expect(pickRepair(cards, at('1', '2', '3'), new Set(['c/b-cheap']))?.id).toBe('c/d-big');
    expect(pickRepair(cards, at('1', '2', '3'), new Set(['c/b-cheap', 'c/d-big']))?.id).toBe('c/e-twin');
    // Only products still missing count: with just 3 missing, small (1 product, 1 page) beats big (1 product, 3 pages).
    expect(pickRepair(cards, at('3'), new Set(['c/b-cheap']))?.id).toBe('c/c-small');
  });

  it('falls back to a table listing when no card listing shows a missing product', () => {
    expect(pickRepair(s, idx('5'), new Set())?.id).toBe('c/cheap-table');
  });

  it('skips listings already read and returns null when nothing unread shows a missing product', () => {
    expect(pickRepair(s, idx('3'), new Set(['c/read', 'c/dear-card', 'c/cheap-table']))).toBeNull();
    expect(pickRepair(s, new Set(), new Set())).toBeNull();
  });
});

describe('decideCrawl', () => {
  const built = '2026-11-01T00:00:00.000Z';
  const s = source([card('c/a', 1, ['1', '2']), card('r/b', 2, ['3'])], built);
  const sitemap = sitemapOf(['c/a', 'r/b', 'c/new']);
  const at = (days: number) => new Date(Date.parse(built) + days * 86_400_000);
  const decide = (over: Partial<Parameters<typeof decideCrawl>[0]> = {}) =>
    decideCrawl({ source: s, settings: SETTINGS, kinds: ['c', 'r'], sitemap, now: at(1), explicitListings: false, ...over });

  it('plans a cover run from a fresh source of the same families', () => {
    const d = decide();
    expect(d.mode).toBe('cover');
    expect(d.mode === 'cover' && idsOf(d.plan)).toEqual(['c/a', 'r/b']);
    expect(d.reason).toContain('2 listings (3 pages)');
  });

  it.each([
    ['is not configured', { settings: undefined }, 'not configured'],
    ['has explicit listings', { explicitListings: true }, 'given explicitly'],
    ['has no source', { source: null }, 'no cover source'],
    ['walks other families', { kinds: ['c'] as const }, 'covers c+r, this run walks c'],
    ['has a source from the future', { now: at(-1) }, 'not before this run'],
    ['has a planned listing gone from the sitemap', { sitemap: sitemapOf(['c/a']) }, '1 planned listing(s) are no longer in the sitemap, e.g. r/b'],
  ])('reads everything when the run %s', (_name, over, reason) => {
    const d = decide(over as Partial<Parameters<typeof decideCrawl>[0]>);
    expect(d.mode).toBe('full');
    expect(d.reason).toContain(reason);
  });

  it('comes back to a full run N days after the last one, with a few hours of slack for the run that built it', () => {
    expect(decide({ now: at(6.5) }).mode).toBe('cover');
    expect(decide({ now: new Date(at(7).getTime() - FULL_CRAWL_SLACK_MS - 1) }).mode).toBe('cover');
    expect(decide({ now: new Date(at(7).getTime() - FULL_CRAWL_SLACK_MS) }).mode).toBe('full');
    expect(decide({ now: at(9) }).reason).toContain('9.0 days ago (a full run every 7 days)');
  });

  it('the slack is six hours: 6 h 1 ms before the seventh day is still a cover run, exactly 6 h before is full', () => {
    expect(FULL_CRAWL_SLACK_MS).toBe(6 * 3_600_000);
    expect(decide({ now: new Date(Date.parse(built) + 7 * 86_400_000 - 6 * 3_600_000 - 1) }).mode).toBe('cover');
    expect(decide({ now: new Date(Date.parse(built) + 7 * 86_400_000 - 6 * 3_600_000) }).mode).toBe('full');
  });

  it('compares the families as sets: a config listing r before c still plans a cover run', () => {
    expect(decide({ kinds: ['r', 'c'] }).mode).toBe('cover');
  });

  it('a configured interval of one day means every run is full', () => {
    expect(decide({ settings: { ...SETTINGS, fullCrawlEveryDays: 1 }, now: at(1) }).mode).toBe('full');
  });
});

describe('cover source file', () => {
  const s = source([card('c/a', 3, ['100', '200']), card('r/b', 2, ['200', '300'], { layout: 'table', truncated: true })]);

  it('round-trips', () => {
    expect(parseCoverSource(serializeCoverSource(s))).toEqual({ source: s });
  });

  const gz = (o: unknown) => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(o), 'utf8')));
  it.each<[string, (o: Record<string, any>) => void, string]>([
    ['another version', (o) => { o['version'] = 2; }, 'version 2'],
    ['a date that is none', (o) => { o['builtAt'] = 'yesterday'; }, 'builtAt'],
    ['families out of order', (o) => { o['families'] = ['r', 'c']; }, 'families'],
    ['no products', (o) => { o['products'] = []; }, 'products'],
    ['unsorted products', (o) => { o['products'] = ['300', '200', '100']; }, 'products'],
    ['a product that is not a sales code', (o) => { o['products'] = ['100', 'abc', '300']; }, 'products'],
    ['a repeated listing id', (o) => { o['listings'][1].id = o['listings'][0].id; }, 'bad or repeated id'],
    ['a page count beyond the site cap', (o) => { o['listings'][0].pages = 51; }, 'pages out of range'],
    ['an unknown layout', (o) => { o['listings'][0].layout = 'grid'; }, 'layout'],
    ['an index outside the products', (o) => { o['listings'][0].codes = [0, 9]; }, 'codes'],
    ['indexes that are not ascending', (o) => { o['listings'][0].codes = [1, 0]; }, 'codes'],
    ['an id of neither family', (o) => { o['listings'][0].id = 'x/big'; }, 'bad or repeated id'],
    ['an id with a path in it', (o) => { o['listings'][0].id = 'c/a/b'; }, 'bad or repeated id'],
    ['an id with a slug beyond 61 characters', (o) => { o['listings'][0].id = `c/${'a'.repeat(62)}`; }, 'bad or repeated id'],
    ['an id that is not a string', (o) => { o['listings'][0].id = 7; }, 'bad or repeated id'],
    ['a page count of zero', (o) => { o['listings'][0].pages = 0; }, 'pages out of range'],
    ['a page count that is not whole', (o) => { o['listings'][0].pages = 1.5; }, 'pages out of range'],
    ['a truncated flag that is not a boolean', (o) => { o['listings'][0].truncated = 'no'; }, 'truncated'],
    ['a listing with no products', (o) => { o['listings'][0].codes = []; }, 'codes'],
    ['a repeated index', (o) => { o['listings'][0].codes = [0, 0]; }, 'codes'],
    ['a listing that is not an object', (o) => { o['listings'][0] = 5; }, 'not an object'],
    ['no listings', (o) => { o['listings'] = []; }, 'listings'],
    ['an unknown family', (o) => { o['families'] = ['c', 'x']; }, 'families'],
    ['a repeated family', (o) => { o['families'] = ['c', 'c']; }, 'families'],
    ['no family', (o) => { o['families'] = []; }, 'families'],
    ['a repeated product', (o) => { o['products'] = ['100', '100', '300']; }, 'products'],
    ['a sales code of more than 12 digits', (o) => { o['products'] = ['100', '200', '1234567890123']; }, 'products'],
    ['a product that no listing shows', (o) => { o['listings'][0].codes = [0, 1]; o['listings'][1].codes = [1]; }, 'shown by no listing'],
  ])('refuses %s without throwing', (_name, mutate, message) => {
    const o = JSON.parse(JSON.stringify(s)) as Record<string, any>;
    mutate(o);
    const parsed = parseCoverSource(gz(o));
    expect('error' in parsed && parsed.error).toContain(message);
  });

  it('accepts a listing of exactly the site cap of 50 pages and a slug of 61 characters', () => {
    const edge = source([card(`c/${'a'.repeat(60)}`, 50, ['100']), card('r/b', 1, ['200'])]);
    expect(parseCoverSource(serializeCoverSource(edge))).toEqual({ source: edge });
  });

  it('refuses bytes that are not gzip or not JSON, and a JSON value that is not an object', () => {
    expect('error' in parseCoverSource(new Uint8Array([1, 2, 3]))).toBe(true);
    expect('error' in parseCoverSource(new Uint8Array(gzipSync(Buffer.from('not json'))))).toBe(true);
    expect('error' in parseCoverSource(gz([1, 2]))).toBe(true);
  });
});
