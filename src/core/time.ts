/**
 * Timestamps are normalized to UTC epoch milliseconds internally and to
 * `YYYY-MM-DDTHH:mm:ss.sssZ` strings at boundaries. Inputs must carry an
 * explicit offset or `Z`; naive timestamps are rejected so that a file name or
 * a local-time string can never silently shift the observation time.
 */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseUtcMs(value: string): number {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) {
    throw new Error(`timestamp must be ISO-8601 with an explicit offset: ${JSON.stringify(value)}`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`invalid timestamp: ${JSON.stringify(value)}`);
  return ms;
}

export function toUtcIso(ms: number): string {
  if (!Number.isSafeInteger(ms)) throw new Error(`invalid epoch ms: ${String(ms)}`);
  return new Date(ms).toISOString();
}

export function normalizeUtcIso(value: string): string {
  return toUtcIso(parseUtcMs(value));
}

export function isValidEpochMs(ms: unknown): ms is number {
  // 2000-01-01 .. 2100-01-01
  return typeof ms === 'number' && Number.isSafeInteger(ms) && ms >= 946684800000 && ms < 4102444800000;
}
