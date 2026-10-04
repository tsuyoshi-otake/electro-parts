/**
 * The subset of Chrome match patterns that adapters declare in `matchPatterns`:
 * `https://<exact host>/<path>`, where `*` is the only wildcard and the path is
 * compared with the URL's path plus query, as Chrome and Tampermonkey compare
 * it. The browser applies the same list before the script runs; the controller
 * re-checks it so a host that ignores the list cannot theme other pages.
 * Anything outside this subset never matches (fail-closed).
 */

const PATTERN = /^https:\/\/([a-z0-9.-]+)(\/[^#]*)$/;

export function isSupportedUrlPattern(pattern: string): boolean {
  return PATTERN.test(pattern);
}

export function matchesUrlPattern(
  pattern: string,
  location: Pick<Location, 'hostname' | 'pathname'> & Partial<Pick<Location, 'search'>>,
): boolean {
  const m = PATTERN.exec(pattern);
  if (m === null || m[1] !== location.hostname) return false;
  const path = (m[2] as string).split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${path}$`).test(location.pathname + (location.search ?? ''));
}
