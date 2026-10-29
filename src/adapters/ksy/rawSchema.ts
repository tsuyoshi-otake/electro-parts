import { isKsyProductId } from './identity.ts';

/**
 * Raw schema of a Raspberry Pi Shop by KSY snapshot.
 *
 * The shop is a ColdFusion single-page store. Its product list comes from
 * `remote_proxy.cfc` (`ev: product.list`) as JSON; a page of that response is
 * `{ size, conditions, failures, items: [{ Product: { PRODUCT, PRODUCTSTATUS } }] }`.
 * The snapshot keeps the fields the shop shows for each product, as returned.
 */

/** The shop's sentinel for 価格未定 (the storefront prints that text instead of the amount). */
export const KSY_UNPRICED = 99_999_999;

/** The storefront rejects page sizes outside 11..59 with a validation message. */
export const KSY_MIN_PAGE_SIZE = 11;
export const KSY_MAX_PAGE_SIZE = 59;

export interface KsyItem {
  id: number;
  name: string;
  make: string;
  /** ColdFusion serializes digit-only model numbers as JSON numbers. */
  model: string | number;
  /** Tax-included yen. `0` on series index entries, `KSY_UNPRICED` for 価格未定. */
  price: number;
  /** Consumption tax contained in `price`. */
  tax: number;
  /** Tax multiplier, e.g. 1.1. */
  taxrate: number;
  /** Quantity the shop displays as 在庫数. The cart is disabled at 0. */
  stock: number;
  /** 1 = shown in the public list. Only the public list is collected. */
  onlist: 1;
  status: { id: number; name: string };
}

export interface KsySnapshot {
  schemaVersion: 1;
  retrievedAt: string;
  complete: boolean;
  /** The list's own count of public products (`size`), the completeness oracle. */
  listedTotal: number;
  pageSize: number;
  pageCount: number;
  items: KsyItem[];
  errors: string[];
}

export interface KsyListPage {
  size: number;
  offset: number;
  items: KsyItem[];
}

export function record(value: unknown, what = 'value'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} is not an object`);
  return value as Record<string, unknown>;
}

function count(value: unknown, field: string, subject: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${subject}: ${field} is not a non-negative integer: ${JSON.stringify(value)}`);
  return value as number;
}

/**
 * Validates one stored item. The tax check is the evidence that `price`
 * includes tax: the shop's terms say so, and every priced item's `tax` is the
 * tax contained in it. A different relation means the meaning changed.
 */
export function parseKsyItem(value: unknown): KsyItem {
  const p = record(value, 'item');
  const id = p['id'];
  if (!Number.isSafeInteger(id) || !isKsyProductId(String(id))) throw new Error(`invalid product id ${JSON.stringify(id)}`);
  const subject = `product ${String(id)}`;
  const name = p['name'];
  if (typeof name !== 'string' || name.trim() === '') throw new Error(`${subject}: name missing`);
  const make = p['make'];
  if (typeof make !== 'string') throw new Error(`${subject}: make is not a string`);
  const model = p['model'];
  if (typeof model !== 'string' && !Number.isSafeInteger(model)) throw new Error(`${subject}: model is neither a string nor an integer`);
  const price = count(p['price'], 'price', subject);
  const tax = count(p['tax'], 'tax', subject);
  const taxrate = p['taxrate'];
  if (typeof taxrate !== 'number' || !(taxrate > 1 && taxrate < 1.25)) throw new Error(`${subject}: unexpected taxrate ${JSON.stringify(taxrate)}`);
  if (price > 0 && Math.abs(tax - Math.round(price - price / taxrate)) > 1) {
    throw new Error(`${subject}: tax ${tax} is not contained in price ${price}; prices may no longer include tax`);
  }
  const stock = count(p['stock'], 'stock', subject);
  if (p['onlist'] !== 1) throw new Error(`${subject}: not a public list entry (onlist ${JSON.stringify(p['onlist'])})`);
  const status = record(p['status'], `${subject} status`);
  const statusId = count(status['id'], 'status id', subject);
  const statusName = status['name'];
  if (typeof statusName !== 'string' || statusName.trim() === '') throw new Error(`${subject}: status name missing`);
  return { id: id as number, name, make, model: model as string | number, price, tax, taxrate, stock, onlist: 1, status: { id: statusId, name: statusName } };
}

/** One list entry of the API response, reduced to the stored item. */
export function ksyItemFromApi(value: unknown): KsyItem {
  const wrapper = record(record(value, 'list entry')['Product'], 'list entry Product');
  const product = record(wrapper['PRODUCT'], 'list entry PRODUCT');
  const status = record(wrapper['PRODUCTSTATUS'], 'list entry PRODUCTSTATUS');
  return parseKsyItem({
    id: product['id'], name: product['name'], make: product['make'], model: product['model'],
    price: product['price'], tax: product['tax'], taxrate: product['taxrate'], stock: product['stock'],
    onlist: product['onlist'], status: { id: status['id'], name: status['name'] },
  });
}

/**
 * Parses one page of the public list. The echoed conditions are checked
 * because the endpoint ignores parameters it does not know (a `page`
 * parameter silently returns the first page again) and because only the
 * public list (`onlist: 1`) may be collected.
 */
export function parseKsyListPage(text: string): KsyListPage {
  // ColdFusion may prefix JSON with `//` (secure JSON); the GET form does not today.
  const body = record(JSON.parse(text.replace(/^\s*\/\//, '')), 'response');
  const failures = record(body['failures'] ?? {}, 'failures');
  const messages = Object.values(failures).flat().map(String);
  if (messages.length) throw new Error(`shop rejected the query: ${messages.join('; ')}`);
  const size = count(body['size'], 'size', 'list');
  const conditions = record(body['conditions'], 'conditions');
  const offset = count(conditions['offset'], 'offset', 'list');
  if (conditions['onlist'] !== 1) throw new Error(`list is not limited to public products (onlist ${JSON.stringify(conditions['onlist'])})`);
  const items = body['items'] ?? [];
  if (!Array.isArray(items)) throw new Error('items is not an array');
  return { size, offset, items: items.map(ksyItemFromApi) };
}
