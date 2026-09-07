/**
 * The single message the content script sends to the service worker.
 *
 * The content script runs inside a store's page, so the worker treats every
 * message as untrusted input: it validates the shape here and the URL against
 * the data origin before it fetches anything.
 */

export const FETCH_TEXT = 'eph:fetch-text';

export interface FetchTextRequest {
  type: typeof FETCH_TEXT;
  url: string;
  timeoutMs: number;
}

export type FetchTextResponse =
  | { ok: true; status: number; text: string }
  | { ok: false; error: string };

/** Upper bound on a request the worker will wait for, whatever the caller asks. */
export const MAX_TIMEOUT_MS = 30_000;

export function isFetchTextRequest(value: unknown): value is FetchTextRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['type'] === FETCH_TEXT && typeof v['url'] === 'string' && typeof v['timeoutMs'] === 'number' && Number.isFinite(v['timeoutMs']);
}
