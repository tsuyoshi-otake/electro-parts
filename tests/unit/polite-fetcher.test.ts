import { describe, expect, it } from 'vitest';
import {
  FetchFailedError,
  parseRetryAfterMs,
  PoliteFetcher,
  RequestBudgetExceededError,
  type HttpTransport,
  type PoliteFetcherOptions,
  type TransportResponse,
} from '../../src/collectors/politeFetcher.ts';

interface Scripted {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  error?: string;
  /** Simulated response latency in virtual ms. */
  delayMs?: number;
}

/** Virtual clock: `sleep` advances time instantly and records every wait. */
function harness(script: Scripted[], overrides: Partial<PoliteFetcherOptions> = {}) {
  let clock = 1_000_000;
  const waits: number[] = [];
  const requests: { url: string; at: number; headers: Record<string, string> }[] = [];
  const transport: HttpTransport = async (url, init) => {
    const step = script.shift();
    if (step === undefined) throw new Error(`unexpected request ${url}`);
    requests.push({ url, at: clock, headers: init.headers });
    if (step.delayMs !== undefined) clock += step.delayMs;
    if (step.error !== undefined) throw new Error(step.error);
    const res: TransportResponse = {
      status: step.status ?? 200,
      header: (n) => step.headers?.[n.toLowerCase()] ?? null,
      bytes: async () => new TextEncoder().encode(step.body ?? 'ok'),
    };
    return res;
  };
  const fetcher = new PoliteFetcher({
    userAgent: 'test-agent/1.0',
    transport,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: () => 0.5,
    minIntervalMs: 1000,
    jitterMs: 500,
    backoffBaseMs: 2000,
    ...overrides,
  });
  return { fetcher, waits, requests, clock: () => clock };
}

describe('PoliteFetcher', () => {
  it('spaces requests by the minimum interval plus jitter and sends an identifying agent', async () => {
    const h = harness([{ body: 'a' }, { body: 'b' }, { body: 'c' }]);
    const [a, b, c] = await Promise.all([h.fetcher.fetchText('u1'), h.fetcher.fetchText('u2'), h.fetcher.fetchText('u3')]);
    expect([a, b, c]).toEqual(['a', 'b', 'c']);
    expect(h.requests.map((r) => r.url)).toEqual(['u1', 'u2', 'u3']);
    // interval 1000 + 0.5 * 500 jitter between request starts
    expect(h.requests[1]!.at - h.requests[0]!.at).toBe(1250);
    expect(h.requests[2]!.at - h.requests[1]!.at).toBe(1250);
    expect(h.requests[0]!.headers['user-agent']).toBe('test-agent/1.0');
    expect(h.fetcher.stats).toMatchObject({ logicalPages: 3, httpAttempts: 3, successfulResponses: 3, retries: 0, failures: 0 });
  });

  it('counts response latency toward the interval', async () => {
    const h = harness([{ body: 'a', delayMs: 900 }, { body: 'b' }]);
    await h.fetcher.fetchText('u1');
    await h.fetcher.fetchText('u2');
    expect(h.requests[1]!.at - h.requests[0]!.at).toBe(1250);
    expect(h.waits).toEqual([350]);
  });

  it('retries 5xx and network errors with exponential backoff', async () => {
    const h = harness([{ status: 503 }, { error: 'ECONNRESET' }, { body: 'finally' }]);
    await expect(h.fetcher.fetchText('u')).resolves.toBe('finally');
    // backoff = base * 2^(attempt-1) * (0.5 + random) = 2000, 4000
    expect(h.waits).toEqual([2000, 4000]);
    expect(h.fetcher.stats).toMatchObject({ logicalPages: 1, httpAttempts: 3, successfulResponses: 1, retries: 2, failures: 0 });
  });

  it('honours Retry-After when it is longer than the backoff', async () => {
    const h = harness([{ status: 429, headers: { 'retry-after': '30' } }, { body: 'ok' }]);
    await h.fetcher.fetchText('u');
    expect(h.waits).toEqual([30_000]);
    const dated = harness([{ status: 503, headers: { 'retry-after': new Date(1_000_000 + 45_000).toUTCString() } }, { body: 'ok' }]);
    await dated.fetcher.fetchText('u');
    expect(dated.waits[0]).toBeGreaterThanOrEqual(44_000);
    expect(dated.waits[0]).toBeLessThanOrEqual(45_000);
  });

  it('stops the run when Retry-After exceeds its wait limit and blocks queued requests', async () => {
    const h = harness([{ status: 429, headers: { 'retry-after': '99999' } }, { body: 'must not be fetched' }], { maxWaitMs: 60_000 });
    const first = h.fetcher.fetchText('u');
    const queued = h.fetcher.fetchText('v');
    await expect(first).rejects.toThrow(/Retry-After 99999000 ms/);
    await expect(queued).rejects.toThrow(/blocked by Retry-After/);
    expect(h.waits).toEqual([]);
    expect(h.requests.map((request) => request.url)).toEqual(['u']);
  });

  it('keeps the server block after a final rate-limited attempt', async () => {
    const h = harness([{ status: 429, headers: { 'retry-after': '30' } }, { body: 'must not be fetched' }], { maxAttempts: 1 });
    await expect(h.fetcher.fetchText('u')).rejects.toThrow(/failed after 1 attempts/);
    await expect(h.fetcher.fetchText('v')).rejects.toThrow(/blocked by Retry-After/);
    expect(h.requests.map((request) => request.url)).toEqual(['u']);
  });

  it('gives up after maxAttempts and reports the last status', async () => {
    const h = harness([{ status: 502 }, { status: 502 }, { status: 502 }, { status: 502 }]);
    const err = await h.fetcher.fetchText('u').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchFailedError);
    expect((err as FetchFailedError).status).toBe(502);
    expect((err as FetchFailedError).attempts).toBe(4);
    expect(h.fetcher.stats.failures).toBe(1);
    // Later requests still work; the failure does not poison the queue.
    h.requests.length = 0;
    const ok = harness([{ body: 'x' }]);
    await expect(ok.fetcher.fetchText('v')).resolves.toBe('x');
  });

  it('does not retry ordinary client errors', async () => {
    const h = harness([{ status: 404 }]);
    await expect(h.fetcher.fetchText('u')).rejects.toThrow(/HTTP 404 \(not retried\)/);
    expect(h.waits).toEqual([]);
    expect(h.fetcher.stats.httpAttempts).toBe(1);
  });

  it('treats a transient body (maintenance page) as retryable even with HTTP 200', async () => {
    const maintenance = '<div class="block-custom-error-403">';
    const h = harness([{ status: 200, body: maintenance }, { status: 403, body: maintenance }, { body: 'real' }], {
      isTransientBody: (_s, body) => body.includes('block-custom-error-403'),
    });
    await expect(h.fetcher.fetchText('u')).resolves.toBe('real');
    expect(h.fetcher.stats.retries).toBe(2);
  });

  it('times out slow responses and retries them', async () => {
    let calls = 0;
    const transport: HttpTransport = (_url, init) =>
      new Promise((resolve, reject) => {
        calls++;
        if (calls === 1) {
          init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
        } else {
          resolve({ status: 200, header: () => null, bytes: async () => new TextEncoder().encode('late but fine') });
        }
      });
    const fetcher = new PoliteFetcher({ userAgent: 'x', transport, timeoutMs: 20, minIntervalMs: 0, jitterMs: 0, backoffBaseMs: 1, sleep: async () => undefined });
    await expect(fetcher.fetchText('u')).resolves.toBe('late but fine');
    expect(fetcher.stats.retries).toBe(1);
  });

  it('stops at the request budget', async () => {
    const h = harness([{ body: 'a' }, { body: 'b' }, { body: 'c' }], { maxRequests: 2 });
    await h.fetcher.fetchText('u1');
    await h.fetcher.fetchText('u2');
    await expect(h.fetcher.fetchText('u3')).rejects.toBeInstanceOf(RequestBudgetExceededError);
  });

  it('parses Retry-After values', () => {
    expect(parseRetryAfterMs('12', 0)).toBe(12_000);
    expect(parseRetryAfterMs(' 3 ', 0)).toBe(3000);
    expect(parseRetryAfterMs('soon', 0)).toBeNull();
    expect(parseRetryAfterMs(null, 0)).toBeNull();
    expect(parseRetryAfterMs(new Date(5000).toUTCString(), 4000)).toBe(1000);
    expect(parseRetryAfterMs(new Date(1000).toUTCString(), 4000)).toBe(0);
  });
});
