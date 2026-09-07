import { LOG_PREFIX, start } from './host.ts';

/**
 * Content-script entry point. Fail-open: a broken panel must never break the
 * store's own page, so every failure ends as one console warning.
 */
void start().catch((e: unknown) => {
  console.warn(`${LOG_PREFIX} failed: ${e instanceof Error ? e.message : String(e)}`);
});
