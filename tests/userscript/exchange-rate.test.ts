import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath, type ProductFileV1 } from '../../src/publisher/contract.ts';
import { HOST_ELEMENT_ID, mountHistoryPanel, OWNER_ATTRIBUTE } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import { EXCHANGE_RATE_URL, ExchangeRateClient, parseRateResponse, yenFromMinor } from '../../userscript/core/exchangeRate.ts';
import type { HostResponse } from '../../userscript/core/types.ts';
import { fakeHost, json, sampleManifest, sampleProduct, testAdapter, type FakeHost } from './helpers.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;
const KEY = `eph:fx:v1:${encodeURIComponent(EXCHANGE_RATE_URL)}`;

/** The open endpoint's answer, last updated an hour before `NOW`. */
function providerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const last = NOW / 1000 - 3600;
  return {
    result: 'success', provider: 'https://www.exchangerate-api.com', base_code: 'USD',
    time_last_update_unix: last, time_next_update_unix: last + 86_400 + 390, rates: { USD: 1, JPY: 157.820352, GBP: 0.78 }, ...overrides,
  };
}
/** Yen per pound from that answer: 157.820352 / 0.78. */
const JPY_PER_GBP = 157.820352 / 0.78;

function rateHost(response: HostResponse | Error = json(providerBody())): FakeHost {
  const host = fakeHost(NOW);
  host.routes.set(EXCHANGE_RATE_URL, response);
  return host;
}

/** A new page in the same browser: same storage, new client. */
const page = (host: FakeHost) => new ExchangeRateClient(host, { random: () => 0 });
const rateRequests = (host: FakeHost) => host.requests.filter((url) => url === EXCHANGE_RATE_URL).length;
const stored = (host: FakeHost) => JSON.parse(host.store.get(KEY) ?? 'null') as { failures: number; retryAt: number; leaseUntil: number } | null;

describe('provider response', () => {
  it('accepts a successful USD answer with a positive JPY rate and update times', () => {
    expect(parseRateResponse(JSON.stringify(providerBody()), 'USD')).toEqual({
      base: 'USD', jpyPerUnit: 157.820352, cross: {}, updatedAt: NOW - HOUR, nextUpdateAt: NOW - HOUR + DAY + 390_000,
    });
  });

  it('derives yen per unit of a cross currency from the same answer, leaving out one it lacks', () => {
    expect(parseRateResponse(JSON.stringify(providerBody()), 'USD', ['GBP', 'EUR'])?.cross).toEqual({ GBP: JPY_PER_GBP });
    for (const GBP of [0, '0.78', undefined]) {
      const parsed = parseRateResponse(JSON.stringify(providerBody({ rates: { USD: 1, JPY: 157.820352, GBP } })), 'USD', ['GBP']);
      // The direct rate stays usable; only the cross rate is missing.
      expect(parsed).toMatchObject({ jpyPerUnit: 157.820352, cross: {} });
    }
  });

  it.each([
    ['an error result', providerBody({ result: 'error', 'error-type': 'unsupported-code' })],
    ['another base', providerBody({ base_code: 'EUR' })],
    ['no JPY', providerBody({ rates: { USD: 1 } })],
    ['a zero JPY', providerBody({ rates: { JPY: 0 } })],
    ['a string JPY', providerBody({ rates: { JPY: '157.8' } })],
    ['no update time', providerBody({ time_last_update_unix: undefined })],
    ['no next update time', providerBody({ time_next_update_unix: 'tomorrow' })],
  ])('rejects %s', (_name, body) => {
    expect(parseRateResponse(JSON.stringify(body), 'USD')).toBeNull();
  });

  it('rejects text that is not a JSON object', () => {
    expect(parseRateResponse('<html>', 'USD')).toBeNull();
    expect(parseRateResponse('null', 'USD')).toBeNull();
  });

  it('converts minor units to whole yen', () => {
    const rate = { base: 'USD', jpyPerUnit: 157.820352, via: null, updatedAt: NOW };
    expect(yenFromMinor(550, rate)).toBe(868); // 868.01
    expect(yenFromMinor(795, rate)).toBe(1255); // 1254.67
    expect(yenFromMinor(5750, { base: 'GBP', jpyPerUnit: JPY_PER_GBP, via: 'USD', updatedAt: NOW })).toBe(11634); // 11634.19
  });
});

describe('once a day per browser', () => {
  it('fetches once, then later pages reuse the stored rate without a request', async () => {
    const host = rateHost();
    await expect(page(host).get('USD')).resolves.toEqual({ base: 'USD', jpyPerUnit: 157.820352, via: null, updatedAt: NOW - HOUR });
    host.clock = NOW + 12 * HOUR;
    await expect(page(host).get('USD')).resolves.toMatchObject({ jpyPerUnit: 157.820352 });
    expect(rateRequests(host)).toBe(1);
  });

  it('refreshes only after both the provider update and 24 hours since the fetch', async () => {
    const host = rateHost();
    await page(host).get('USD');
    host.clock = NOW + 23 * HOUR + 30 * 60_000; // past the provider's next update (23 h 6.5 min), not 24 h
    await page(host).get('USD');
    expect(rateRequests(host)).toBe(1);
    host.clock = NOW + DAY;
    await page(host).get('USD');
    expect(rateRequests(host)).toBe(2);
  });

  it('asks once per client however often a page renders', async () => {
    const host = rateHost();
    const client = page(host);
    await Promise.all([client.get('USD'), client.get('USD'), client.get('USD')]);
    expect(rateRequests(host)).toBe(1);
  });

  it('does not fetch for prices in another currency', async () => {
    const host = rateHost();
    for (const currency of ['JPY', 'EUR']) {
      expect(page(host).supports(currency)).toBe(false);
      await expect(page(host).get(currency)).resolves.toBeNull();
    }
    expect(host.requests).toHaveLength(0);
  });

  it('answers GBP as a cross rate from the same stored answer, without a request of its own', async () => {
    const host = rateHost();
    expect(page(host).supports('GBP')).toBe(true);
    await expect(page(host).get('GBP')).resolves.toEqual({ base: 'GBP', jpyPerUnit: JPY_PER_GBP, via: 'USD', updatedAt: NOW - HOUR });
    host.clock = NOW + 12 * HOUR;
    await expect(page(host).get('USD')).resolves.toMatchObject({ base: 'USD', jpyPerUnit: 157.820352, via: null });
    await expect(page(host).get('GBP')).resolves.toMatchObject({ jpyPerUnit: JPY_PER_GBP });
    expect(rateRequests(host)).toBe(1);
  });

  it('refreshes an entry saved before cross rates once when GBP is asked, and not for USD', async () => {
    const host = rateHost();
    // What 0.6.x stored: the USD rate alone, fetched an hour ago.
    const old = { base: 'USD', jpyPerUnit: 150, updatedAt: NOW - 2 * HOUR, nextUpdateAt: NOW + 20 * HOUR, fetchedAt: NOW - HOUR };
    host.store.set(KEY, JSON.stringify({ rate: old, failures: 0, retryAt: 0, leaseUntil: 0 }));
    await expect(page(host).get('USD')).resolves.toMatchObject({ jpyPerUnit: 150 });
    expect(rateRequests(host)).toBe(0);
    await expect(page(host).get('GBP')).resolves.toMatchObject({ jpyPerUnit: JPY_PER_GBP });
    expect(rateRequests(host)).toBe(1);
    await page(host).get('GBP');
    expect(rateRequests(host)).toBe(1);
  });

  it('answers no GBP rate when the answer lacks one, and does not fetch again for it', async () => {
    const host = rateHost(json(providerBody({ rates: { USD: 1, JPY: 157.820352 } })));
    await expect(page(host).get('GBP')).resolves.toBeNull();
    await expect(page(host).get('GBP')).resolves.toBeNull();
    await expect(page(host).get('USD')).resolves.toMatchObject({ jpyPerUnit: 157.820352 });
    expect(rateRequests(host)).toBe(1);
  });

  it('keeps an old entry\'s backoff when GBP asks for a refresh', async () => {
    const host = rateHost();
    const old = { base: 'USD', jpyPerUnit: 150, updatedAt: NOW - 2 * HOUR, nextUpdateAt: NOW + 20 * HOUR, fetchedAt: NOW - HOUR };
    host.store.set(KEY, JSON.stringify({ rate: old, failures: 2, retryAt: NOW + HOUR, leaseUntil: 0 }));
    await expect(page(host).get('GBP')).resolves.toBeNull();
    expect(rateRequests(host)).toBe(0);
  });

  it('lets a tab that starts during another tab\'s fetch use the lease instead of fetching', async () => {
    const host = rateHost();
    let answer: (value: HostResponse) => void = () => undefined;
    const fetchText = host.fetchText.bind(host);
    host.fetchText = (url, timeoutMs) => (url === EXCHANGE_RATE_URL ? new Promise((resolve) => { host.requests.push(url); answer = resolve; }) : fetchText(url, timeoutMs));
    const first = page(host).get('USD');
    await vi.waitFor(() => expect(rateRequests(host)).toBe(1));
    await expect(page(host).get('USD')).resolves.toBeNull();
    answer(json(providerBody()));
    await expect(first).resolves.toMatchObject({ jpyPerUnit: 157.820352 });
    expect(rateRequests(host)).toBe(1);
    expect(stored(host)?.leaseUntil).toBe(0);
  });

  it('treats a fetch time in the future as a clock change and refreshes', async () => {
    const host = rateHost();
    await page(host).get('USD');
    host.clock = NOW - 3 * DAY;
    await page(host).get('USD');
    expect(rateRequests(host)).toBe(2);
  });
});

describe('failures', () => {
  it('backs off exponentially, keeps the last rate and resets after a success', async () => {
    const host = rateHost();
    await page(host).get('USD');
    host.routes.set(EXCHANGE_RATE_URL, { status: 503, text: 'down' });
    host.clock = NOW + DAY;
    await expect(page(host).get('USD')).resolves.toMatchObject({ jpyPerUnit: 157.820352 }); // fail-open to the stored rate
    expect(stored(host)).toMatchObject({ failures: 1, retryAt: NOW + DAY + HOUR });
    host.clock = NOW + DAY + 59 * 60_000;
    await page(host).get('USD');
    expect(rateRequests(host)).toBe(2);
    host.clock = NOW + DAY + HOUR;
    await page(host).get('USD');
    expect(stored(host)).toMatchObject({ failures: 2, retryAt: NOW + DAY + 3 * HOUR });
    host.routes.set(EXCHANGE_RATE_URL, json(providerBody({ rates: { JPY: 150 } })));
    host.clock = NOW + DAY + 3 * HOUR;
    await expect(page(host).get('USD')).resolves.toMatchObject({ jpyPerUnit: 150 });
    expect(stored(host)).toMatchObject({ failures: 0, retryAt: 0, leaseUntil: 0 });
    expect(rateRequests(host)).toBe(4);
  });

  it('adds jitter of up to a quarter of the wait', async () => {
    const host = rateHost({ status: 500, text: '' });
    await new ExchangeRateClient(host, { random: () => 0.999 }).get('USD');
    expect(stored(host)?.retryAt).toBe(NOW + Math.round(HOUR * 1.24975));
  });

  it('waits a full day after a 429, longer than the provider\'s 20-minute window', async () => {
    const host = rateHost({ status: 429, text: '{"result":"error","error-type":"rate-limited"}' });
    await expect(page(host).get('USD')).resolves.toBeNull();
    expect(stored(host)).toMatchObject({ failures: 1, retryAt: NOW + DAY });
    host.clock = NOW + 23 * HOUR;
    await page(host).get('USD');
    expect(rateRequests(host)).toBe(1);
  });

  it('counts a network error and an unexpected answer as failures', async () => {
    const host = rateHost(new Error('timeout after 15000 ms'));
    await expect(page(host).get('USD')).resolves.toBeNull();
    expect(stored(host)?.failures).toBe(1);
    host.routes.set(EXCHANGE_RATE_URL, json(providerBody({ result: 'error' })));
    host.clock = NOW + HOUR;
    await expect(page(host).get('USD')).resolves.toBeNull();
    expect(stored(host)).toMatchObject({ failures: 2, retryAt: NOW + 3 * HOUR });
  });

  it('stops showing a stored rate older than a week when it cannot be refreshed', async () => {
    const host = rateHost();
    await page(host).get('USD');
    host.routes.set(EXCHANGE_RATE_URL, { status: 503, text: '' });
    host.clock = NOW + 6 * DAY;
    await expect(page(host).get('USD')).resolves.not.toBeNull();
    host.clock = NOW + 8 * DAY;
    await expect(page(host).get('USD')).resolves.toBeNull();
  });

  it('does not fetch when storage cannot be read, or the lease cannot be written', async () => {
    const unreadable = rateHost();
    unreadable.storage.get = async () => { throw new Error('quota'); };
    await expect(page(unreadable).get('USD')).resolves.toBeNull();
    const readOnly = rateHost();
    readOnly.storage.set = async () => { throw new Error('quota'); };
    await expect(page(readOnly).get('USD')).resolves.toBeNull();
    expect([...unreadable.requests, ...readOnly.requests]).toHaveLength(0);
  });

  it('ignores a corrupt stored entry and replaces it', async () => {
    const host = rateHost();
    host.store.set(KEY, '{"rate":{"base":"USD","jpyPerUnit":-1}');
    await expect(page(host).get('USD')).resolves.toMatchObject({ jpyPerUnit: 157.820352 });
    expect(rateRequests(host)).toBe(1);
  });
});

describe('panel yen reference', () => {
  const BASE = 'https://data.example.test';

  /** A product recorded in USD cents: $5.00, then $5.50. */
  function usdProduct(): ProductFileV1 {
    const product = sampleProduct();
    const segment = product.offers[0]!.segments[0]!;
    segment.basis = { quoteKind: 'selling', taxTreatment: 'unknown', currency: 'USD', unitLabel: null };
    segment.points = [[segment.points[0]![0], 'exact', 500, 500], [segment.points[1]![0], 'exact', 550, 550]];
    segment.stats = { ...segment.stats, current: { state: 'exact', minAmountMinor: 550, maxAmountMinor: 550 },
      previousDistinct: { state: 'exact', minAmountMinor: 500, maxAmountMinor: 500 }, change: { differenceMinor: 50, percent: 10, direction: 'up' },
      observedMinMinor: 500, observedMaxMinor: 550, windows: { d30: { minMinor: 500, maxMinor: 550 }, d90: null, d365: null } };
    return product;
  }

  async function mount(host: FakeHost, product: ProductFileV1 | null, rates = new ExchangeRateClient(host)) {
    const buy = document.createElement('div');
    buy.id = 'buy';
    document.body.appendChild(buy);
    host.routes.set(`${BASE}/${manifestPath('teststore')}`, json(sampleManifest()));
    if (product !== null) host.routes.set(`${BASE}/${productPath('teststore', 'P1')}`, json(product));
    const handle = await mountHistoryPanel({ adapters: [testAdapter], host, client: new DataClient(host, { baseUrl: BASE }), doc: document,
      location: { hostname: 'example.test', pathname: '/p/P1' }, dataBaseUrl: BASE, lazyChart: false, exchangeRates: rates });
    handles.push(handle);
    return document.getElementById(HOST_ELEMENT_ID)!.shadowRoot!;
  }

  const handles: { destroy(): void }[] = [];
  afterEach(() => {
    for (const handle of handles.splice(0)) handle.destroy();
    document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
    document.body.replaceChildren();
  });

  it('shows the current USD price in yen with the rate, its date and the attribution', async () => {
    const shadow = await mount(rateHost(), usdProduct());
    const fx = shadow.querySelector('.fx');
    expect(fx?.querySelector('.fx-value')?.textContent).toBe('約 ￥868（円換算の参考値）');
    expect(fx?.textContent).toContain('1 USD = 157.82円');
    expect(fx?.textContent).toContain('税・送料・関税・決済時の換算を含みません');
    const link = fx?.querySelector('a');
    expect(link?.textContent).toBe('Rates By Exchange Rate API');
    expect(link?.getAttribute('href')).toBe('https://www.exchangerate-api.com');
    expect(link?.rel).toBe('noopener noreferrer');
    // Directly after the headline price.
    expect(fx?.previousElementSibling?.className).toBe('hero-value');
  });

  it('shows a GBP price in yen with the cross rate and the two quoted rates it came from', async () => {
    const gbp = usdProduct();
    const segment = gbp.offers[0]!.segments[0]!;
    segment.basis = { ...segment.basis, currency: 'GBP' };
    segment.stats = { ...segment.stats, current: { state: 'exact', minAmountMinor: 5750, maxAmountMinor: 5750 } };
    const host = rateHost();
    const shadow = await mount(host, gbp);
    const fx = shadow.querySelector('.fx');
    expect(fx?.querySelector('.fx-value')?.textContent).toBe('約 ￥11,634（円換算の参考値）');
    expect(fx?.textContent).toContain('1 GBP = 202.33円（USD/JPY と USD/GBP から算出、');
    expect(fx?.querySelector('a')?.textContent).toBe('Rates By Exchange Rate API');
    expect(shadow.querySelector('.hero-value')?.textContent).toContain('£57.50');
    expect(rateRequests(host)).toBe(1);
  });

  it('converts only that figure: the delta, statistics and chart stay in USD', async () => {
    const shadow = await mount(rateHost(), usdProduct());
    expect(shadow.querySelector('.hero-value')?.textContent).toContain('+$0.50');
    const outside = [...shadow.querySelectorAll('.rows, svg')].map((el) => el.textContent ?? '').join(' ');
    expect(outside).toContain('$5.00');
    expect(outside).not.toMatch(/[¥￥]/);
    expect(shadow.querySelectorAll('.fx')).toHaveLength(1);
  });

  it('keeps the USD panel unchanged when no rate is available', async () => {
    const shadow = await mount(rateHost({ status: 503, text: '' }), usdProduct());
    expect(shadow.querySelector('.fx')).toBeNull();
    expect(shadow.querySelector('.hero-value')?.textContent).toContain('$5.50');
  });

  it('does not ask for a rate for a yen product or a product without data', async () => {
    for (const product of [sampleProduct(), null]) {
      const host = rateHost();
      const rates = new ExchangeRateClient(host);
      const get = vi.spyOn(rates, 'get');
      const shadow = await mount(host, product, rates);
      expect(get).not.toHaveBeenCalled();
      expect(rateRequests(host)).toBe(0);
      expect(shadow.querySelector('.fx')).toBeNull();
      for (const handle of handles.splice(0)) handle.destroy();
      document.body.replaceChildren();
    }
  });
});
