import { shopifyPageKey, type ShopifyStore } from './identity.ts';

export interface ShopifyVariant {
  id: number; sku: string | null; title: string; price: string;
  compare_at_price: string | null; available: boolean; taxable: boolean | null;
}
export interface ShopifyItem {
  id: number; handle: string; title: string; vendor: string | null;
  product_type: string | null; updated_at: string | null; variants: ShopifyVariant[];
}
export interface ShopifySnapshot {
  schemaVersion: 1; currency: string; currencyEvidence: string; retrievedAt: string;
  complete: boolean; catalogHandles: string[]; pageCount: number;
  items: ShopifyItem[]; errors: string[];
}
/** Minor units of a two-decimal `products.json` amount in `currency`. */
export function decimalMinor(raw: unknown, currency: string): number {
  if (typeof raw !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Invalid ${currency} decimal`);
  const [whole, fraction = ''] = raw.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error(`${currency} amount out of range`);
  return amount;
}
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
function requiredString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing ${field}`);
  return v;
}
function optionalString(v: unknown): string | null { return typeof v === 'string' && v.trim() ? v : null; }
function id(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) <= 0) throw new Error('Invalid Shopify id');
  return v as number;
}
export function parseShopifyItem(store: ShopifyStore, value: unknown): ShopifyItem {
  const p = record(value);
  const handle = requiredString(p['handle'], 'handle');
  shopifyPageKey(store, handle); // Fails closed rather than silently dropping unaddressable products.
  if (!Array.isArray(p['variants']) || !p['variants'].length) throw new Error(`${handle}: missing variants`);
  const seen = new Set<number>();
  const variants = p['variants'].map((value): ShopifyVariant => {
    const v = record(value); const variantId = id(v['id']);
    if (seen.has(variantId)) throw new Error(`${handle}: duplicate variant`);
    seen.add(variantId);
    if (typeof v['available'] !== 'boolean') throw new Error(`${handle}: missing availability`);
    const price = requiredString(v['price'], 'price'); decimalMinor(price, store.currency);
    const compare = v['compare_at_price'];
    if (compare !== null && compare !== undefined) decimalMinor(compare, store.currency);
    return { id: variantId, title: requiredString(v['title'], 'variant title'), sku: optionalString(v['sku']),
      price, compare_at_price: compare == null ? null : compare as string,
      available: v['available'], taxable: typeof v['taxable'] === 'boolean' ? v['taxable'] : null };
  });
  return { id: id(p['id']), handle, title: requiredString(p['title'], 'title'), vendor: optionalString(p['vendor']),
    product_type: optionalString(p['product_type']), updated_at: optionalString(p['updated_at']), variants };
}
export function parseShopifyPage(store: ShopifyStore, value: unknown): ShopifyItem[] {
  const p = record(value);
  if (!Array.isArray(p['products'])) throw new Error('Missing products array');
  return p['products'].map((item) => parseShopifyItem(store, item));
}
