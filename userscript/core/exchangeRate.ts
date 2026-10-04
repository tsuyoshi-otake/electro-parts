import { minorDigits } from './format.ts';
import type { HostEnv } from './types.ts';

/**
 * Yen reference values for prices recorded in a foreign currency, from
 * ExchangeRate-API's open endpoint (no key, rates updated once a day).
 *
 * The provider's terms forbid redistributing its rates, so they never travel
 * through the published dataset: each browser fetches them itself, keeps the
 * answer in its own storage and shows the attribution the terms require. One
 * stored entry holds the last rate and the retry state, and that entry is what
 * keeps the load at one request per day per browser across tabs and pages:
 *
 * - a stored rate is reused until the provider's next update and at least
 *   `minIntervalMs` (24 h) after it was fetched;
 * - a fetch first writes a short lease, so tabs opened together do not all fetch;
 * - a failure backs off exponentially with jitter (1 h, 2 h, 4 h ... capped at
 *   24 h). A 429 waits the full 24 h, longer than the provider's documented
 *   20-minute window and longer than any wait it could ask for on a daily
 *   rate; the host contract does not expose `Retry-After`, so this is the bound;
 * - storage that cannot be read or written means nothing is fetched, because
 *   nothing could be remembered.
 *
 * `get` never rejects. It answers the newest usable rate or null, and the
 * caller then shows the recorded price alone. The rate is a reference for
 * reading a price, never an input to comparisons between stores.
 */

/** The only URL this client requests. The extension worker allows exactly this one. */
export const EXCHANGE_RATE_URL = 'https://open.er-api.com/v6/latest/USD';
/** Required by the provider's terms wherever its rates are shown. */
export const EXCHANGE_RATE_ATTRIBUTION = { label: 'Rates By Exchange Rate API', href: 'https://www.exchangerate-api.com' } as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface JpyRate {
  /** The currency converted from, e.g. `USD`. */
  base: string;
  /** Yen per one major unit of `base`. */
  jpyPerUnit: number;
  /** When the provider last updated the rate (epoch ms). */
  updatedAt: number;
}

interface StoredRate extends JpyRate {
  /** When the provider will publish the next rate (epoch ms). */
  nextUpdateAt: number;
  /** When this browser fetched it (epoch ms). */
  fetchedAt: number;
}

interface StoredState {
  rate: StoredRate | null;
  failures: number;
  retryAt: number;
  leaseUntil: number;
}

const EMPTY: StoredState = { rate: null, failures: 0, retryAt: 0, leaseUntil: 0 };

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isRate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The provider's response for `base`, or null when it is not a successful, complete answer. */
export function parseRateResponse(text: string, base: string): Omit<StoredRate, 'fetchedAt'> | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const rates = b['rates'];
  const jpy = typeof rates === 'object' && rates !== null ? (rates as Record<string, unknown>)['JPY'] : undefined;
  const last = b['time_last_update_unix'];
  const next = b['time_next_update_unix'];
  if (b['result'] !== 'success' || b['base_code'] !== base || !isRate(jpy) || !isTime(last) || !isTime(next)) return null;
  return { base, jpyPerUnit: jpy, updatedAt: last * 1000, nextUpdateAt: next * 1000 };
}

function parseStored(text: string | null, base: string): StoredState {
  if (text === null) return EMPTY;
  try {
    const s = JSON.parse(text) as Partial<StoredState>;
    const r = s.rate;
    const rate = r !== null && typeof r === 'object' && r.base === base && isRate(r.jpyPerUnit) && isTime(r.updatedAt) && isTime(r.nextUpdateAt) && isTime(r.fetchedAt)
      ? { base, jpyPerUnit: r.jpyPerUnit, updatedAt: r.updatedAt, nextUpdateAt: r.nextUpdateAt, fetchedAt: r.fetchedAt }
      : null;
    const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return { rate, failures: count(s.failures), retryAt: count(s.retryAt), leaseUntil: count(s.leaseUntil) };
  } catch {
    return EMPTY;
  }
}

/** The yen amount, rounded to whole yen, for `minor` units of the rate's currency. */
export function yenFromMinor(minor: number, rate: JpyRate): number {
  return Math.round((minor / 10 ** minorDigits(rate.base)) * rate.jpyPerUnit);
}

export interface ExchangeRateClientOptions {
  url?: string;
  /** The currency `url` quotes; prices in any other currency get no rate. */
  base?: string;
  minIntervalMs?: number;
  /** A stored rate older than this (by the provider's update time) is not shown. */
  maxAgeMs?: number;
  leaseMs?: number;
  timeoutMs?: number;
  random?: () => number;
}

export class ExchangeRateClient {
  private readonly url: string;
  private readonly base: string;
  private readonly key: string;
  private readonly minIntervalMs: number;
  private readonly maxAgeMs: number;
  private readonly leaseMs: number;
  private readonly timeoutMs: number;
  private readonly random: () => number;
  private answer: Promise<JpyRate | null> | null = null;

  constructor(
    private readonly host: HostEnv,
    options: ExchangeRateClientOptions = {},
  ) {
    this.url = options.url ?? EXCHANGE_RATE_URL;
    this.base = options.base ?? 'USD';
    this.key = `eph:fx:v1:${encodeURIComponent(this.url)}`;
    this.minIntervalMs = options.minIntervalMs ?? DAY;
    this.maxAgeMs = options.maxAgeMs ?? 7 * DAY;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    // Longer than one bounded fetch, so a lease never expires mid-request.
    this.leaseMs = Math.max(options.leaseMs ?? 60_000, this.timeoutMs + 5_000);
    this.random = options.random ?? Math.random;
  }

  supports(currency: string): boolean {
    return currency === this.base;
  }

  /** One answer per client: re-renders and variant switches on a page never ask twice. */
  get(currency: string): Promise<JpyRate | null> {
    if (!this.supports(currency)) return Promise.resolve(null);
    this.answer ??= this.resolve().catch((e: unknown) => {
      this.host.log('warn', `exchange rate unavailable: ${String(e)}`);
      return null;
    });
    return this.answer;
  }

  private async resolve(): Promise<JpyRate | null> {
    const now = this.host.now();
    let state: StoredState;
    try {
      state = parseStored(await this.host.storage.get(this.key), this.base);
    } catch {
      this.host.log('warn', 'exchange rate storage unavailable; not fetching');
      return null;
    }
    const usable = state.rate !== null && now - state.rate.updatedAt <= this.maxAgeMs ? publicRate(state.rate) : null;
    if (!this.due(state.rate, now) || pending(state.retryAt, now) || pending(state.leaseUntil, now)) return usable;
    try {
      await this.save({ ...state, leaseUntil: now + this.leaseMs });
    } catch {
      this.host.log('warn', 'exchange rate state could not be saved; not fetching');
      return usable;
    }
    let status: number | null = null;
    try {
      const res = await this.host.fetchText(this.url, this.timeoutMs);
      status = res.status;
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const parsed = parseRateResponse(res.text, this.base);
      if (parsed === null) throw new Error('unexpected rate response');
      const rate: StoredRate = { ...parsed, fetchedAt: now };
      await this.save({ rate, failures: 0, retryAt: 0, leaseUntil: 0 }).catch(() => this.host.log('warn', 'exchange rate could not be saved'));
      return now - rate.updatedAt <= this.maxAgeMs ? publicRate(rate) : usable;
    } catch (e) {
      const failures = state.failures + 1;
      const wait = status === 429 ? DAY : Math.min(DAY, HOUR * 2 ** (failures - 1));
      const retryAt = now + Math.round(wait * (1 + 0.25 * this.random()));
      await this.save({ ...state, failures, retryAt, leaseUntil: 0 }).catch(() => undefined);
      this.host.log('warn', `exchange rate fetch failed (${(e as Error).message}); next try after ${new Date(retryAt).toISOString()}`);
      return usable;
    }
  }

  private due(rate: StoredRate | null, now: number): boolean {
    // A fetch time in the future means the clock moved back; refresh rather than wait.
    if (rate === null || rate.fetchedAt > now) return true;
    return now >= Math.max(rate.nextUpdateAt, rate.fetchedAt + this.minIntervalMs);
  }

  private save(state: StoredState): Promise<void> {
    return this.host.storage.set(this.key, JSON.stringify(state));
  }
}

/** A wait this client set and that has not passed; anything beyond its longest wait is a clock change. */
function pending(until: number, now: number): boolean {
  return now < until && until - now <= 2 * DAY;
}

function publicRate(rate: StoredRate): JpyRate {
  return { base: rate.base, jpyPerUnit: rate.jpyPerUnit, updatedAt: rate.updatedAt };
}
