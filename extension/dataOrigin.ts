import { EXCHANGE_RATE_URL } from '../userscript/core/exchangeRate.ts';
import { DATA_HOSTS, DEFAULT_DATA_BASE_URL } from '../userscript/version.ts';

/**
 * The one place that decides what this extension may read.
 *
 * Both entry points ask this question -- the worker before it fetches, the
 * content script before it accepts a configured base URL -- and a single
 * answer is what keeps `host_permissions` in the manifest honest: the
 * extension can reach the data origin, one exchange rate URL, and nothing else.
 */

export function isDataOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && (DATA_HOSTS as readonly string[]).includes(parsed.hostname);
}

/**
 * Every URL the worker may fetch: the data origin, plus exactly one exchange
 * rate URL. The rate needs no host permission because its provider answers
 * with `Access-Control-Allow-Origin: *` and the worker sends no credentials;
 * matching the whole URL keeps it from becoming a second open origin.
 */
export function isAllowedFetchUrl(url: string): boolean {
  return isDataOrigin(url) || url === EXCHANGE_RATE_URL;
}

/**
 * A stored `dataBaseUrl` override, or the default. An override that points
 * anywhere but the data origin is ignored rather than obeyed: the worker
 * would refuse to fetch it, and a silent fallback beats a panel that only
 * ever reports a network error.
 */
export function resolveDataBaseUrl(stored: unknown): string {
  if (typeof stored !== 'string' || !isDataOrigin(stored)) return DEFAULT_DATA_BASE_URL;
  return stored.replace(/\/+$/, '');
}
