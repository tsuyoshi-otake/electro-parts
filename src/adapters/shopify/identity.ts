/**
 * A Shopify storefront whose whole public catalogue (`products.json`) is
 * collected, and the reversible URL-handle page keys its products get.
 * Shared with the page adapters, so no Node APIs.
 */
export interface ShopifyStore {
  readonly storeId: string;
  /** The store's name in error messages. */
  readonly label: string;
  readonly origin: string;
  /** The storefront's base currency: every `products.json` amount is a two-decimal amount in it. */
  readonly currency: string;
  /**
   * How a run proves `currency` before it reads any amount:
   * - `storefront`: the home page's `Shopify.currency` is `currency` at rate 1.0;
   * - `meta`: `/meta.json` names `currency`, and no response may redirect. For a
   *   storefront that redirects visitors to a market (another currency) by
   *   location, where the home page proves nothing about the root catalogue.
   */
  readonly currencyEvidence: 'storefront' | 'meta';
}

export function isShopifyHandle(handle: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}\p{S}._-]*$/u.test(handle) && handle.length <= 120;
}
export function shopifyPageKey(store: ShopifyStore, handle: string): string {
  if (!isShopifyHandle(handle)) throw new Error(`Invalid ${store.label} handle`);
  // Escape literal underscores too, so %xx escapes cannot collide with text.
  const key = `h-${encodeURIComponent(handle).replaceAll('_', '%5F').replaceAll('%', '_')}`;
  if (key.length > 128) throw new Error(`${store.label} handle exceeds page key limit`);
  return key;
}
export function shopifyHandleFromKey(store: ShopifyStore, key: string): string | null {
  if (!/^h-[A-Za-z0-9._-]+$/.test(key)) return null;
  try {
    const handle = decodeURIComponent(key.slice(2).replaceAll('_', '%'));
    return shopifyPageKey(store, handle) === key ? handle : null;
  } catch { return null; }
}
export function shopifyProductUrl(store: ShopifyStore, handle: string): string {
  return `${store.origin}/products/${encodeURIComponent(handle)}`;
}
/** The raw snapshot's record of how the currency was proven. */
export function shopifyCurrencyEvidence(store: ShopifyStore): string {
  return store.currencyEvidence === 'storefront' ? `Shopify.currency:${store.currency}:1.0` : `meta.json:currency:${store.currency}`;
}
