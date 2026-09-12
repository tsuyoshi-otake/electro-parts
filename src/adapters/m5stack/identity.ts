/** Reversible URL-handle encoding shared with the page adapter (no Node APIs). */
export const M5STACK_ORIGIN = 'https://shop.m5stack.com';
export function isM5StackHandle(handle: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}\p{S}._-]*$/u.test(handle) && handle.length <= 120;
}
export function m5stackPageKey(handle: string): string {
  if (!isM5StackHandle(handle)) throw new Error('Invalid M5Stack handle');
  // Escape literal underscores too, so %xx escapes cannot collide with text.
  const key = `h-${encodeURIComponent(handle).replaceAll('_', '%5F').replaceAll('%', '_')}`;
  if (key.length > 128) throw new Error('M5Stack handle exceeds page key limit');
  return key;
}
export function m5stackHandleFromKey(key: string): string | null {
  if (!/^h-[A-Za-z0-9._-]+$/.test(key)) return null;
  try {
    const handle = decodeURIComponent(key.slice(2).replaceAll('_', '%'));
    return m5stackPageKey(handle) === key ? handle : null;
  } catch { return null; }
}
export function m5stackProductUrl(handle: string): string {
  return `${M5STACK_ORIGIN}/products/${encodeURIComponent(handle)}`;
}
