import { describe, expect, it } from 'vitest';
import { validateProductPageInventoryRaw, withPageQuantity, type ProductPageInventoryRaw } from '../../src/adapters/productPageInventory.ts';
import { observationDayCount, observationRound, OBSERVATION_DAY_ANCHOR_MS } from '../../src/core/observationDay.ts';
import { PoliteFetcher } from '../../src/collectors/politeFetcher.ts';
import {
  parseProductPagesConfig,
  productPageWarnings,
  readProductPages,
  selectRotation,
  shardOf,
  type ProductPageReader,
  type ProductPagesConfig,
  type ProductPageTarget,
} from '../../src/collectors/productPageInventory.ts';

const DAY = 86_400_000;
const targets = (n: number): ProductPageTarget[] =>
  Array.from({ length: n }, (_, i) => ({ key: `p${i}`, url: `https://shop.test/products/p${i}`, offerIds: [`v${i}`] }));
const config = (over: Partial<ProductPagesConfig> = {}): ProductPagesConfig => ({ shards: 1, maxPages: 100, maxFailures: 5, maxMinutes: 30, ...over });
/** The page body is `count=N` for the product it is asked for. */
const reader: ProductPageReader = (html, target) => {
  const m = /^count=(-?\d+)$/.exec(html);
  if (m === null) throw new Error('no count');
  return { [target.offerIds[0]!]: Number(m[1]) };
};

function fetcher(answer: (url: string) => { status: number; body?: string }, clock = { t: 0 }) {
  const requests: string[] = [];
  const f = new PoliteFetcher({
    userAgent: 'electro-parts-test/1.0', minIntervalMs: 1000, jitterMs: 0, maxAttempts: 2, backoffBaseMs: 10,
    sleep: async (ms) => { clock.t += ms; }, now: () => clock.t, random: () => 0,
    transport: async (url) => {
      requests.push(url);
      clock.t += 200;
      const a = answer(url);
      return { status: a.status, header: () => null, bytes: async () => new TextEncoder().encode(a.body ?? '') };
    },
  });
  return { f, requests, clock };
}

async function run(answer: (url: string) => { status: number; body?: string }, over: Partial<ProductPagesConfig> = {}, list = targets(10), r = reader) {
  const { f, requests, clock } = fetcher(answer);
  const raw = await readProductPages({ fetcher: f, targets: list, reader: r, config: config(over), observedAtMs: OBSERVATION_DAY_ANCHOR_MS,
    nowMs: () => clock.t, log: () => {}, tag: '[test]' });
  return { raw, requests };
}
const ok = (url: string) => ({ status: 200, body: `count=${url.length}` });
/** Answers by the position of the page in the order the stage asks for them (1-based); a retry keeps its position. */
function byPosition(answer: (position: number, url: string) => { status: number; body?: string }) {
  const order: string[] = [];
  return (url: string) => {
    if (!order.includes(url)) order.push(url);
    return answer(order.indexOf(url) + 1, url);
  };
}

describe('observation rounds', () => {
  it('advance by one per scheduled observation day, including runs GitHub delays by hours', () => {
    for (let day = 0; day < 20; day += 2) {
      const at = OBSERVATION_DAY_ANCHOR_MS + day * DAY;
      expect(observationRound(at)).toBe(day / 2);
      expect(observationRound(at + 7 * 3_600_000)).toBe(day / 2); // 02:00 the next morning UTC
      expect(observationDayCount(at + DAY)).toBe(day + 1);
    }
    expect(() => observationRound(Number.NaN)).toThrow('Invalid');
  });
});

describe('product page config', () => {
  it('is optional and bounded', () => {
    expect(parseProductPagesConfig(undefined)).toBeNull();
    expect(parseProductPagesConfig({ shards: 4, maxPages: 1800, maxFailures: 50, maxMinutes: 55 })).toEqual({ shards: 4, maxPages: 1800, maxFailures: 50, maxMinutes: 55 });
    expect(() => parseProductPagesConfig({ shards: 0, maxPages: 1, maxFailures: 0, maxMinutes: 1 })).toThrow('shards');
    expect(() => parseProductPagesConfig({ shards: 1, maxPages: 1, maxFailures: 0, maxMinutes: 181 })).toThrow('maxMinutes');
    expect(() => parseProductPagesConfig([])).toThrow('object');
  });
});

describe('rotation', () => {
  const list = targets(400);
  it('splits the products into fixed slices that together cover each product once', () => {
    const seen = new Map<string, number>();
    for (let round = 0; round < 4; round++) {
      const { shard, slice } = selectRotation(list, round, { shards: 4, maxPages: 1000 });
      expect(shard).toBe(round);
      for (const t of slice) {
        expect(shardOf(t.key, 4)).toBe(shard);
        seen.set(t.key, (seen.get(t.key) ?? 0) + 1);
      }
    }
    expect(seen.size).toBe(400);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    // The slices are not wildly uneven (FNV-1a over p0…p399: each holds roughly a quarter).
    for (let s = 0; s < 4; s++) expect(selectRotation(list, s, { shards: 4, maxPages: 1000 }).slice.length).toBeGreaterThan(60);
  });
  it('comes back to the same slice after a full cycle, in a different order, so a cap does not starve the same products', () => {
    const a = selectRotation(list, 1, { shards: 4, maxPages: 1000 }).slice.map((t) => t.key);
    const b = selectRotation(list, 5, { shards: 4, maxPages: 1000 }).slice.map((t) => t.key);
    expect([...b].sort()).toEqual([...a].sort());
    expect(b).not.toEqual(a);
    const capped = (round: number) => new Set(selectRotation(list, round, { shards: 4, maxPages: 10 }).slice.map((t) => t.key));
    expect([...capped(1)].some((k) => !capped(5).has(k))).toBe(true);
  });
  it('reads every product each round with one slice', () => {
    expect(selectRotation(list, 7, { shards: 1, maxPages: 1000 }).slice).toHaveLength(400);
    expect(selectRotation(list, 7, { shards: 1, maxPages: 25 }).slice).toHaveLength(25);
  });
});

describe('reading product pages', () => {
  it('records each count by offer and reports what it read', async () => {
    const { raw, requests } = await run(ok);
    expect(requests).toHaveLength(10);
    expect(raw).toMatchObject({ round: 0, shards: 1, shard: 0, eligible: 10, selected: 10, read: 10, failures: [], stopped: null });
    expect(raw.quantities['v3']).toBe('https://shop.test/products/p3'.length);
    expect(productPageWarnings(raw)).toEqual([]);
  });
  it('skips a removed product (404) and goes on', async () => {
    const { raw, requests } = await run((u) => (u.endsWith('/p2') ? { status: 404 } : ok(u)));
    expect(requests).toHaveLength(10);
    expect(raw.read).toBe(9);
    expect(raw.failures).toEqual([{ key: 'p2', reason: expect.stringContaining('HTTP 404') }]);
    expect(raw.quantities).not.toHaveProperty('v2');
    expect(productPageWarnings(raw)[0]).toContain('1 product page(s) not read');
  });
  it('stops on a rate limit instead of asking again', async () => {
    const { raw, requests } = await run(byPosition((n, u) => (n === 2 ? { status: 429 } : ok(u))));
    expect(raw.stopped).toMatch(/^rate limited/);
    expect(raw.read).toBe(1);
    expect(new Set(requests).size).toBe(2); // the fetcher's own retry, then nothing after the second page
    expect(productPageWarnings(raw)[0]).toContain('stopped early (1/10 read)');
  });
  it('stops after three consecutive failures from a store that is not answering', async () => {
    const { raw } = await run(byPosition((n, u) => (n >= 4 ? { status: 503 } : ok(u))), { maxFailures: 50 });
    expect(raw.read).toBe(3);
    expect(raw.failures).toHaveLength(3);
    expect(raw.stopped).toMatch(/^3 consecutive fetch failures/);
  });
  it('counts an unrecognised page as a failure and stops past maxFailures', async () => {
    const { raw } = await run(byPosition((n, u) => (n <= 6 ? { status: 200, body: 'changed theme' } : ok(u))), { maxFailures: 2 });
    expect(raw.failures.map((f) => f.reason)).toEqual(['unrecognised page: no count', 'unrecognised page: no count', 'unrecognised page: no count']);
    expect(raw.stopped).toBe('more than 2 failed pages');
    expect(raw.read).toBe(0);
  });
  it('rejects a count for an offer the product does not have, or a negative count', async () => {
    const stray: ProductPageReader = () => ({ other: 1 });
    expect((await run(ok, {}, targets(1), stray)).raw.failures[0]!.reason).toContain('unknown offer other');
    const { raw } = await run(() => ({ status: 200, body: 'count=-2' }), {}, targets(1));
    expect(raw.failures[0]!.reason).toContain('invalid count -2');
    expect(raw.quantities).toEqual({});
  });
  it('accepts a page read with no usable count for an offer', async () => {
    const none: ProductPageReader = (_html, target) => ({ [target.offerIds[0]!]: null });
    const { raw } = await run(ok, {}, targets(1), none);
    expect(raw).toMatchObject({ read: 1, failures: [], quantities: { v0: null } });
  });
  it('keeps to its time limit', async () => {
    // 1000 ms apart: the 2-minute limit is reached after about 120 pages of 300.
    const { raw } = await run(ok, { maxMinutes: 2, maxPages: 1000 }, targets(300));
    expect(raw.stopped).toMatch(/^time limit of 2 min reached/);
    expect(raw.read).toBeGreaterThan(100);
    expect(raw.read).toBeLessThan(130);
  });
  it('stops when the run request budget is spent', async () => {
    const clock = { t: 0 };
    const f = new PoliteFetcher({ userAgent: 'electro-parts-test/1.0', maxRequests: 4, sleep: async () => {}, now: () => clock.t, random: () => 0,
      transport: async (url) => ({ status: 200, header: () => null, bytes: async () => new TextEncoder().encode(`count=${url.length}`) }) });
    const raw = await readProductPages({ fetcher: f, targets: targets(10), reader, config: config(), observedAtMs: OBSERVATION_DAY_ANCHOR_MS, nowMs: () => clock.t, log: () => {}, tag: '' });
    expect(raw.read).toBe(4);
    expect(raw.stopped).toContain('request budget of 4');
  });
});

describe('page counts in the snapshot', () => {
  const pages: ProductPageInventoryRaw = { round: 3, shards: 4, shard: 3, eligible: 3, selected: 3, read: 2, failures: [{ key: 'b', reason: 'HTTP 404' }], stopped: null, quantities: { '11': 7, '12': 0, '14': null } };
  const base = { state: 'in_stock' as const, purchasable: true, rawStatus: null };
  it('reads a count, marks an unread offer unobserved, and keeps old snapshots not exposed', () => {
    expect(withPageQuantity(base, pages, '11')).toEqual({ ...base, quantity: 7, quantitySemantics: 'site_reported' });
    expect(withPageQuantity(base, pages, '12')).toEqual({ ...base, quantity: 0, quantitySemantics: 'site_reported' });
    expect(withPageQuantity(base, pages, '13')).toEqual({ ...base, quantity: null, quantitySemantics: 'site_reported', quantityUnobserved: true });
    expect(withPageQuantity(base, undefined, '11')).toEqual({ ...base, quantity: null, quantitySemantics: 'not_exposed' });
  });
  it('records no count, instead of keeping the last one, for a page without a usable count or an unread offer that cannot be bought', () => {
    expect(withPageQuantity(base, pages, '14')).toEqual({ ...base, quantity: null, quantitySemantics: 'site_reported' });
    const soldOut = { state: 'out_of_stock' as const, purchasable: false, rawStatus: null };
    expect(withPageQuantity(soldOut, pages, '13')).toEqual({ ...soldOut, quantity: null, quantitySemantics: 'site_reported' });
    // A read count still wins over the catalogue flag.
    expect(withPageQuantity(soldOut, pages, '12')).toEqual({ ...soldOut, quantity: 0, quantitySemantics: 'site_reported' });
    // Unknown purchasability is not "cannot be bought": the series keeps its count.
    expect(withPageQuantity({ ...base, purchasable: null }, pages, '13')).toMatchObject({ quantityUnobserved: true });
  });
  it('validates the section shape', () => {
    expect(validateProductPageInventoryRaw(pages)).toBe(pages);
    expect(() => validateProductPageInventoryRaw({ ...pages, shard: 4 })).toThrow('shard must be below shards');
    expect(() => validateProductPageInventoryRaw({ ...pages, read: 4 })).toThrow('read <= selected');
    expect(() => validateProductPageInventoryRaw({ ...pages, quantities: { '11': -1 } })).toThrow('quantities.11');
    expect(() => validateProductPageInventoryRaw({ ...pages, stopped: 1 })).toThrow('stopped');
  });
});
