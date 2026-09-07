/**
 * Switch Science's catalogue API.
 *
 * The storefront is Shopify, so the catalogue is available as JSON at
 * `/collections/<collection>/products.json` (ADR-0014). Reading it costs ~42
 * requests for 10,000 products where an HTML listing crawl costs thousands,
 * and it removes an entire class of failure: there is no markup to drift.
 *
 * What the endpoint gives is a *published* view — the same fields the
 * storefront renders — so this module's job is only to check the shape and
 * carry it into the raw snapshot with the store's own values intact.
 */
import { isValidSwitchScienceHandle } from '../../adapters/switch-science/snapshotAdapter.ts';
import {
  parseShopifyYen,
  switchScienceProductUrl,
  type SwitchScienceRawItem,
  type SwitchScienceRawVariant,
} from '../../adapters/switch-science/rawSchema.ts';

export const SWITCH_SCIENCE_BASE_URL = 'https://www.switch-science.com';
/** Shopify's hard maximum for this endpoint. Asking for more silently returns 250. */
export const CATALOG_PAGE_LIMIT = 250;
export const DEFAULT_COLLECTION = 'all';

export class CatalogFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogFormatError';
  }
}

export function catalogPageUrl(baseUrl: string, collection: string, page: number, limit: number): string {
  return `${baseUrl}/collections/${collection}/products.json?limit=${limit}&page=${page}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export interface ParsedCatalogPage {
  items: SwitchScienceRawItem[];
  /** Products the page contained, including those skipped below. */
  rawCount: number;
  /** Handles this store's page keys cannot address; dropped, never silently. */
  unsupportedHandles: string[];
  /** Variants whose price string was not an exact yen amount. */
  unparsablePrices: number;
}

function parseVariant(value: unknown, where: string, index: number): SwitchScienceRawVariant {
  if (!isRecord(value)) throw new CatalogFormatError(`${where}: variants[${index}] is not an object`);
  const id = value['id'];
  if (!Number.isSafeInteger(id)) throw new CatalogFormatError(`${where}: variants[${index}].id is not an integer`);
  const priceRaw = value['price'];
  if (typeof priceRaw !== 'string' && typeof priceRaw !== 'number') {
    throw new CatalogFormatError(`${where}: variants[${index}].price is ${typeof priceRaw}, expected a string`);
  }
  const compareRaw = value['compare_at_price'];
  const position = value['position'];
  return {
    variantId: id as number,
    sku: optionalString(value['sku']),
    title: typeof value['title'] === 'string' ? value['title'] : null,
    priceYen: parseShopifyYen(priceRaw),
    priceRaw: String(priceRaw),
    compareAtPriceYen: compareRaw === null || compareRaw === undefined ? null : parseShopifyYen(compareRaw),
    compareAtPriceRaw: compareRaw === null || compareRaw === undefined ? null : String(compareRaw),
    // The endpoint always sends `available`. If it ever stops, an absent flag
    // must not read as "in stock" — absent means not purchasable.
    available: value['available'] === true,
    position: Number.isSafeInteger(position) ? (position as number) : index + 1,
  };
}

/**
 * Reads one catalogue page. Throws when the *envelope* is not what the API
 * documents — a shape change should stop the run rather than quietly produce a
 * short snapshot — but drops individual products whose handle cannot be a page
 * key, because one unusable handle is not a reason to lose the catalogue. Those
 * drops come back as `catalog.uncovered` when the sitemap is compared.
 */
export function parseCatalogPage(json: unknown, page: number): ParsedCatalogPage {
  if (!isRecord(json)) throw new CatalogFormatError(`page ${page}: response is not a JSON object`);
  const products = json['products'];
  if (!Array.isArray(products)) throw new CatalogFormatError(`page ${page}: "products" is missing or not an array`);
  const items: SwitchScienceRawItem[] = [];
  const unsupportedHandles: string[] = [];
  let unparsablePrices = 0;
  products.forEach((product, i) => {
    if (!isRecord(product)) throw new CatalogFormatError(`page ${page}: products[${i}] is not an object`);
    const handle = product['handle'];
    if (typeof handle !== 'string') throw new CatalogFormatError(`page ${page}: products[${i}].handle is not a string`);
    if (!isValidSwitchScienceHandle(handle)) {
      unsupportedHandles.push(handle);
      return;
    }
    const where = `page ${page}: ${handle}`;
    const productId = product['id'];
    if (!Number.isSafeInteger(productId)) throw new CatalogFormatError(`${where}: id is not an integer`);
    const title = product['title'];
    if (typeof title !== 'string') throw new CatalogFormatError(`${where}: title is not a string`);
    const variants = product['variants'];
    if (!Array.isArray(variants) || variants.length === 0) throw new CatalogFormatError(`${where}: variants is missing or empty`);
    const parsed = variants.map((v, vi) => parseVariant(v, where, vi));
    unparsablePrices += parsed.filter((v) => v.priceYen === null).length;
    items.push({
      handle,
      productId: productId as number,
      title,
      vendor: optionalString(product['vendor']),
      productType: optionalString(product['product_type']),
      url: switchScienceProductUrl(handle),
      publishedAt: optionalString(product['published_at']),
      updatedAt: optionalString(product['updated_at']),
      variants: parsed,
      sourcePage: page,
      positionOnPage: i + 1,
    });
  });
  return { items, rawCount: products.length, unsupportedHandles, unparsablePrices };
}
