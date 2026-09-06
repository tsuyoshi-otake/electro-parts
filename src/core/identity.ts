import { STORE_ID_PATTERN, type StoreId } from './domain.ts';

/**
 * Page keys and external ids are untrusted strings that end up in file names,
 * URLs and cache keys. This module is the single place that decides what is
 * safe. Store adapters may further restrict the shape (Akizuki: digits only).
 */
export const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeKey(value: string): boolean {
  if (!SAFE_KEY_PATTERN.test(value)) return false;
  // Reject dot-only segments that could be interpreted as path components.
  if (value === '.' || value === '..' || value.startsWith('..')) return false;
  return true;
}

export function assertSafeKey(value: string, what: string): string {
  if (!isSafeKey(value)) {
    throw new Error(`${what} is not a safe key: ${JSON.stringify(value)}`);
  }
  return value;
}

export function isValidStoreId(value: string): value is StoreId {
  return STORE_ID_PATTERN.test(value);
}

export function assertStoreId(value: string): StoreId {
  if (!isValidStoreId(value)) throw new Error(`invalid store id: ${JSON.stringify(value)}`);
  return value;
}

/**
 * Cache key shared by the userscript and any other client. Includes the data
 * contract major version and the store so identical page keys in different
 * stores never collide.
 */
export function productCacheKey(contractMajor: number, storeId: StoreId, pageKey: string): string {
  return `eph:${contractMajor}:${storeId}:${pageKey}`;
}

export function manifestCacheKey(contractMajor: number, storeId: StoreId): string {
  return `eph:${contractMajor}:${storeId}:__manifest__`;
}
