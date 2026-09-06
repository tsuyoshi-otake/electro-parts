/**
 * Store-neutral polite HTTP client used by every collector.
 *
 * Politeness rules (all configurable, defaults chosen for a daily full crawl
 * of a few hundred pages):
 *  - one request at a time, with a minimum interval plus random jitter
 *    between request starts;
 *  - `Retry-After` is honoured on 429/503 (seconds or HTTP-date, capped);
 *  - 429, 408, 5xx, network errors and timeouts are retried with exponential
 *    backoff and jitter, up to `maxAttempts`;
 *  - other 4xx responses fail immediately (the site said no; do not insist);
 *  - a hard request budget per run stops runaway loops;
 *  - only GET, an identifying User-Agent, no cookies, no session reuse.
 *
 * Nothing here works around access controls: a maintenance page or a
 * persistent 403 ends the crawl.
 */

export interface TransportResponse {
  status: number;
  header(name: string): string | null;
  text(): Promise<string>;
}

export type HttpTransport = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<TransportResponse>;

export interface PoliteFetcherOptions {
  userAgent: string;
  /** Minimum delay between the starts of two requests. Default 1000 ms. */
  minIntervalMs?: number;
  /** Uniform random extra delay added to every interval. Default 500 ms. */
  jitterMs?: number;
  /** Total attempts per URL including the first. Default 4. */
  maxAttempts?: number;
  /** Base of the exponential backoff. Default 2000 ms. */
  backoffBaseMs?: number;
  /** Upper bound for any single wait (backoff or Retry-After). Default 120 s. */
  maxWaitMs?: number;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Hard cap on HTTP attempts per run. Default 5000. */
  maxRequests?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Response bodies matching this predicate are treated as retryable (e.g. maintenance pages). */
  isTransientBody?: (status: number, body: string) => boolean;
  transport?: HttpTransport;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  log?: (message: string) => void;
}

export interface FetchStats {
  logicalPages: number;
  httpAttempts: number;
  successfulResponses: number;
  retries: number;
  failures: number;
  /** Milliseconds spent waiting (politeness interval + backoff). */
  waitedMs: number;
}

export class FetchFailedError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    readonly attempts: number,
    message: string,
  ) {
    super(message);
    this.name = 'FetchFailedError';
  }
}

export class RequestBudgetExceededError extends Error {
  constructor(readonly budget: number) {
    super(`request budget of ${budget} HTTP attempts exhausted`);
    this.name = 'RequestBudgetExceededError';
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Parses a Retry-After header (delta-seconds or HTTP-date) into milliseconds; null if unusable. */
export function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number.parseInt(v, 10) * 1000;
  const date = Date.parse(v);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

export const defaultTransport: HttpTransport = async (url, init) => {
  const res = await fetch(url, { method: 'GET', headers: init.headers, signal: init.signal, redirect: 'follow', credentials: 'omit' });
  return { status: res.status, header: (n) => res.headers.get(n), text: () => res.text() };
};

export class PoliteFetcher {
  readonly stats: FetchStats = { logicalPages: 0, httpAttempts: 0, successfulResponses: 0, retries: 0, failures: 0, waitedMs: 0 };
  private readonly o: Required<Omit<PoliteFetcherOptions, 'headers' | 'isTransientBody' | 'log'>> & Pick<PoliteFetcherOptions, 'headers' | 'isTransientBody' | 'log'>;
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: PoliteFetcherOptions) {
    this.o = {
      minIntervalMs: 1000,
      jitterMs: 500,
      maxAttempts: 4,
      backoffBaseMs: 2000,
      maxWaitMs: 120_000,
      timeoutMs: 30_000,
      maxRequests: 5000,
      transport: defaultTransport,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      random: () => Math.random(),
      ...options,
    };
  }

  get intervalMs(): number {
    return this.o.minIntervalMs;
  }

  /** Fetches one URL as text, serialised behind every earlier call. */
  fetchText(url: string): Promise<string> {
    const run = this.chain.then(() => this.fetchSerial(url));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async wait(ms: number): Promise<void> {
    const bounded = Math.min(Math.max(0, ms), this.o.maxWaitMs);
    if (bounded <= 0) return;
    this.stats.waitedMs += bounded;
    await this.o.sleep(bounded);
  }

  private async politePause(): Promise<void> {
    const target = this.lastStartAt + this.o.minIntervalMs + this.o.random() * this.o.jitterMs;
    const delay = target - this.o.now();
    if (delay > 0) await this.wait(delay);
  }

  private async fetchSerial(url: string): Promise<string> {
    this.stats.logicalPages++;
    let lastStatus: number | null = null;
    let lastMessage = '';
    for (let attempt = 1; attempt <= this.o.maxAttempts; attempt++) {
      if (this.stats.httpAttempts >= this.o.maxRequests) throw new RequestBudgetExceededError(this.o.maxRequests);
      await this.politePause();
      this.lastStartAt = this.o.now();
      this.stats.httpAttempts++;
      if (attempt > 1) this.stats.retries++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('timeout')), this.o.timeoutMs);
      let retryAfterMs: number | null = null;
      try {
        const res = await this.o.transport(url, {
          headers: { 'user-agent': this.o.userAgent, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'ja,en;q=0.5', ...this.o.headers },
          signal: controller.signal,
        });
        lastStatus = res.status;
        const body = await res.text();
        if (res.status >= 200 && res.status < 300) {
          if (this.o.isTransientBody?.(res.status, body) === true) {
            lastMessage = `transient body (status ${res.status})`;
          } else {
            this.stats.successfulResponses++;
            return body;
          }
        } else if (RETRYABLE_STATUS.has(res.status) || this.o.isTransientBody?.(res.status, body) === true) {
          retryAfterMs = parseRetryAfterMs(res.header('retry-after'), this.o.now());
          lastMessage = `HTTP ${res.status}`;
        } else {
          this.stats.failures++;
          throw new FetchFailedError(url, res.status, attempt, `GET ${url}: HTTP ${res.status} (not retried)`);
        }
      } catch (e) {
        if (e instanceof FetchFailedError) throw e;
        lastMessage = e instanceof Error ? e.message : String(e);
        if (controller.signal.aborted) lastMessage = `timeout after ${this.o.timeoutMs} ms`;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.o.maxAttempts) {
        const backoff = this.o.backoffBaseMs * 2 ** (attempt - 1) * (0.5 + this.o.random());
        const delay = retryAfterMs === null ? backoff : Math.max(retryAfterMs, backoff);
        this.o.log?.(`retry ${attempt}/${this.o.maxAttempts - 1} for ${url} after ${lastMessage}; waiting ${Math.round(delay)} ms`);
        await this.wait(delay);
      }
    }
    this.stats.failures++;
    throw new FetchFailedError(url, lastStatus, this.o.maxAttempts, `GET ${url} failed after ${this.o.maxAttempts} attempts: ${lastMessage}`);
  }
}
