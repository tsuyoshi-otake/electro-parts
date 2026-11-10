import type { ProductRelation } from '../userscript/core/relations.ts';

/**
 * The messages the content script sends to the service worker.
 *
 * The content script runs inside a store's page, so the worker treats every
 * message as untrusted input: it validates the shape here, and the URL against
 * the data origin before it fetches anything. A relations request carries only
 * a product key; the worker derives the packaged file it reads from that key.
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

export const RELATIONS_FOR = 'eph:relations-for';

export interface RelationsForRequest {
  type: typeof RELATIONS_FOR;
  storeId: string;
  pageKey: string;
}

export type RelationsForResponse =
  | { ok: true; relations: ProductRelation[] }
  | { ok: false; error: string };

/** A store id or page key is a short token; anything longer is not one. */
export const MAX_KEY_LENGTH = 200;

/** Upper bound on a request the worker will wait for, whatever the caller asks. */
export const MAX_TIMEOUT_MS = 30_000;

export function isFetchTextRequest(value: unknown): value is FetchTextRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['type'] === FETCH_TEXT && typeof v['url'] === 'string' && typeof v['timeoutMs'] === 'number' && Number.isFinite(v['timeoutMs']);
}

const isKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH;

export function isRelationsForRequest(value: unknown): value is RelationsForRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['type'] === RELATIONS_FOR && isKey(v['storeId']) && isKey(v['pageKey']);
}
