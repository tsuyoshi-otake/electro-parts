import { describe, expect, it } from 'vitest';
import { KSY_UNPRICED, parseKsyItem } from '../../src/adapters/ksy/rawSchema.ts';
import { ksySnapshotAdapter, validateKsyRaw } from '../../src/adapters/ksy/snapshotAdapter.ts';
import { ksyCollector, ksyListUrl } from '../../src/collectors/ksy/collector.ts';
import { sanityCheck } from '../../src/core/sanity.ts';
import { loadPipelineConfig } from '../../src/pipeline/config.ts';
import { collectKsyFixture, ksyFixture, loadKsyNormalized, requestedOffset } from '../helpers/ksy.ts';

type Body = { size: number; conditions: Record<string, unknown>; failures: Record<string, unknown>; items: { Product: { PRODUCT: Record<string, unknown>; PRODUCTSTATUS: Record<string, unknown> } }[] };
const edit = (body: string, change: (b: Body) => void): string => {
  const b = JSON.parse(body) as Body;
  change(b);
  return JSON.stringify(b);
};

describe('KSY public list collection', () => {
  it('reads all 776 public products in 16 cookie-less GETs and matches the listed total', async () => {
    const headers: Record<string, string>[] = [];
    const fixture = ksyFixture();
    const outcome = await ksyCollector.collect({ userAgent: 'electro-parts-test/1.0' }, {
      log: () => {}, now: () => new Date(fixture.retrievedAt), sleep: async () => {}, random: () => 0,
      transport: async (url, init) => {
        headers.push(init.headers);
        const body = fixture.pages[requestedOffset(url) / 50]!;
        return { status: 200, header: () => null, bytes: async () => Buffer.from(body) };
      },
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.complete).toBe(true);
    expect(outcome.metrics).toMatchObject({ items: 776, listedTotal: 776, listPages: 16, httpAttempts: 16, unpriced: 24 });
    for (const h of headers) {
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('cookie');
      expect(h['user-agent']).toBe('electro-parts-test/1.0');
    }
    expect(validateKsyRaw(outcome.raw).errors).toEqual([]);
  });

  it('asks for the public list by offset in registration order, with nothing but the query', () => {
    const u = new URL(ksyListUrl(100, 50));
    expect(u.origin + u.pathname).toBe('https://raspberry-pi.ksyic.com/remote_proxy.cfc');
    expect([...u.searchParams.keys()]).toEqual(['method', 'returnFormat', 'argumentCollection']);
    expect(JSON.parse(u.searchParams.get('argumentCollection')!)).toEqual({ args: { ev: 'product.list', conditions: { offset: 100, max: 50, sort: 7, sortdesc: 0 } } });
  });

  it.each<[string, (url: string, body: string) => string, Record<string, unknown>?]>([
    // The shop ignores parameters it does not know and serves the first page again.
    ['ignored pagination', (_url, body) => ksyFixture().pages[0] ?? body],
    ['offset echoed differently', (url, body) => requestedOffset(url) === 100 ? edit(body, (b) => { b.conditions['offset'] = 0; }) : body],
    ['total changes mid-crawl', (url, body) => requestedOffset(url) === 300 ? edit(body, (b) => { b.size = 777; }) : body],
    ['short page', (url, body) => requestedOffset(url) === 200 ? edit(body, (b) => { b.items.pop(); }) : body],
    ['repeated product', (url, body) => requestedOffset(url) === 50 ? edit(body, (b) => {
      b.items[0]!.Product.PRODUCT['id'] = (JSON.parse(ksyFixture().pages[0]!) as Body).items[0]!.Product.PRODUCT['id'];
    }) : body],
    ['validation message', (_url, body) => edit(body, (b) => { b.failures = { max: ['表示数には、60より小さな値を指定してください。'] }; })],
    ['hidden product', (url, body) => requestedOffset(url) === 0 ? edit(body, (b) => { b.items[3]!.Product.PRODUCT['onlist'] = 0; }) : body],
    ['list not limited to public products', (_url, body) => edit(body, (b) => { b.conditions['onlist'] = '0,1'; })],
    ['price no longer includes tax', (url, body) => requestedOffset(url) === 0 ? edit(body, (b) => {
      const p = b.items.find((i) => (i.Product.PRODUCT['price'] as number) > 0)!.Product.PRODUCT;
      p['tax'] = Math.round((p['price'] as number) * 0.1);
    }) : body],
    ['non-JSON maintenance page', (url, body) => requestedOffset(url) === 650 ? '<html>メンテナンス中</html>' : body],
    ['page cap', (_url, body) => body, { maxPages: 15 }],
  ])('fails closed: %s', async (_reason, change, config) => {
    const r = await collectKsyFixture(change, config ?? {});
    expect(r.complete).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(validateKsyRaw(r.raw).errors.length).toBeGreaterThan(0);
  });

  it('stops at a refusal without insisting', async () => {
    const fixture = ksyFixture();
    let calls = 0;
    const outcome = await ksyCollector.collect({ userAgent: 'electro-parts-test/1.0' }, {
      log: () => {}, sleep: async () => {}, random: () => 0,
      transport: async () => {
        calls += 1;
        return { status: 403, header: () => null, bytes: async () => Buffer.from(fixture.pages[0]!) };
      },
    });
    expect(calls).toBe(1);
    expect(outcome.complete).toBe(false);
    expect(outcome.errors[0]).toContain('403');
  });

  it('rejects configurations the shop or the politeness rules forbid, before any request', () => {
    expect(() => ksyCollector.validateConfig({ userAgent: 'x' })).toThrow();
    expect(() => ksyCollector.validateConfig({ userAgent: 'electro-parts-test/1.0', pageSize: 60 })).toThrow();
    expect(() => ksyCollector.validateConfig({ userAgent: 'electro-parts-test/1.0', pageSize: 10 })).toThrow();
    expect(() => ksyCollector.validateConfig({ userAgent: 'electro-parts-test/1.0', minIntervalMs: 100 })).toThrow();
    expect(() => ksyCollector.validateConfig({ userAgent: 'electro-parts-test/1.0' })).not.toThrow();
  });
});

describe('KSY snapshot normalization', () => {
  it('keeps the shop number as identity and permalink, with tax-included yen and the displayed stock', async () => {
    const s = await loadKsyNormalized();
    expect(s.products).toHaveLength(776);
    expect(s.coverageId).toBe('list:public');
    const pico = s.products.find((p) => p.pageKey === '1094')!;
    expect(pico.metadata).toEqual({ name: 'Raspberry Pi Pico 2', modelNumber: 'SC1631', category: null,
      canonicalUrl: 'https://raspberry-pi.ksyic.com/main/index/pdp.id/1094/pdp.open/1094' });
    expect(pico.offers[0]!.priceQuotes).toEqual([{ quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY',
      state: 'exact', minAmountMinor: 913, maxAmountMinor: 913, unitLabel: null }]);
    expect(pico.offers[0]!.availability).toEqual({ state: 'in_stock', purchasable: true, quantity: 363, quantitySemantics: 'site_reported', rawStatus: null });
  });

  it('records 価格未定 and series index entries as no price, never as an amount', async () => {
    const s = await loadKsyNormalized();
    for (const key of ['482', '1059']) {
      const quote = s.products.find((p) => p.pageKey === key)!.offers[0]!.priceQuotes[0]!;
      expect(quote).toMatchObject({ state: 'unavailable', minAmountMinor: null, maxAmountMinor: null });
    }
    const amounts = s.products.flatMap((p) => p.offers[0]!.priceQuotes).map((q) => q.minAmountMinor);
    expect(amounts).not.toContain(KSY_UNPRICED);
    expect(amounts).not.toContain(0);
  });

  it('maps product status next to the stock without hiding the quantity', async () => {
    const s = await loadKsyNormalized();
    const availability = (key: string) => s.products.find((p) => p.pageKey === key)!.offers[0]!.availability;
    expect(availability('1070')).toMatchObject({ state: 'discontinued', purchasable: false, quantity: 0, rawStatus: '終了品' });
    expect(availability('483')).toMatchObject({ state: 'preparing', purchasable: false, quantity: 0, rawStatus: '販売予定品' });
    expect(availability('865')).toMatchObject({ state: 'in_stock', purchasable: true, quantity: 2, rawStatus: '販売予定品' });
    expect(availability('482')).toMatchObject({ state: 'out_of_stock', purchasable: false, quantity: 0, rawStatus: null });
  });

  it('keeps digit-only model numbers as text and empty ones as missing', async () => {
    const s = await loadKsyNormalized();
    expect(s.products.find((p) => p.pageKey === '204')!.metadata.modelNumber).toBe('4910066630270');
    expect(s.products.find((p) => p.pageKey === '156')!.metadata.modelNumber).toBe('110218');
    expect(s.products.filter((p) => p.metadata.modelNumber === null)).toHaveLength(9);
    expect(parseKsyItem({ id: 7, name: 'x', make: '', model: 12, price: 110, tax: 10, taxrate: 1.1, stock: 0, onlist: 1, status: { id: 1, name: '現行品' } }).model).toBe(12);
    expect(() => parseKsyItem({ id: 7, name: 'x', make: '', model: 1.5, price: 110, tax: 10, taxrate: 1.1, stock: 0, onlist: 1, status: { id: 1, name: '現行品' } })).toThrow();
  });

  it('validates page keys as shop numbers only', () => {
    expect(ksySnapshotAdapter.isValidPageKey('1094')).toBe(true);
    for (const key of ['0', '01', '1094/x', '../1', '', '1'.repeat(10)]) expect(ksySnapshotAdapter.isValidPageKey(key), key).toBe(false);
    expect(ksySnapshotAdapter.productUrlForPageKey('1094')).toBe('https://raspberry-pi.ksyic.com/main/index/pdp.id/1094/pdp.open/1094');
    expect(ksySnapshotAdapter.productUrlForPageKey('x')).toBeNull();
  });

  it('rejects snapshots that are not the complete public list', async () => {
    const r = await collectKsyFixture();
    expect(validateKsyRaw({ ...r.raw, items: r.raw.items.slice(1) }).errors).toHaveLength(1);
    expect(validateKsyRaw({ ...r.raw, items: [...r.raw.items.slice(1), r.raw.items[0], r.raw.items[0]].slice(1) }).errors).toHaveLength(1);
    expect(validateKsyRaw({ ...r.raw, complete: false }).errors).toHaveLength(1);
    expect(validateKsyRaw({ ...r.raw, pageCount: 15 }).errors).toHaveLength(1);
    expect(() => ksySnapshotAdapter.normalize({ ...r.raw, errors: ['x'] }, 'a'.repeat(64))).toThrow();
  });

  it('passes the configured sanity thresholds on the saved list', async () => {
    const config = await loadPipelineConfig('config/ksy.json');
    const s = await loadKsyNormalized();
    const result = sanityCheck(s, null, config.sanity);
    expect(result.errors).toEqual([]);
    expect(result.metrics['unavailablePriceCount']).toBe(43);
    expect(config.observation.cadence).toBe('every_two_days');
  });
});
