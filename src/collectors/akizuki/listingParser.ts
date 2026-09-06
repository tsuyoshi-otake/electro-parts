/**
 * Parser for Akizuki listing pages — both the category tree
 * (`/catalog/c/<slug>/`) and the genre tags (`/catalog/r/<slug>/`), plus their
 * `_p<n>` pages. Pure function over the HTML string; no network, no DOM
 * library. The markup is regular server-rendered HTML with
 * stable BEM class names (`block-cart-i--*`), so each product block is
 * located by its class name and the fields are read with anchored patterns.
 *
 * Any structural surprise is reported through `ListingParseError` or, per
 * item, through `issues`, so the crawler can mark the run incomplete rather
 * than silently publishing a truncated catalogue.
 */
import type { AkizukiRawItem, AkizukiRawPrice, AkizukiRawStock } from '../../adapters/akizuki/rawSchema.ts';
import { akizukiProductUrl, AKIZUKI_SALES_CODE_PATTERN } from '../../adapters/akizuki/rawSchema.ts';

export interface ListingPage {
  /** Listing display name from the page header. */
  listingName: string;
  /**
   * True for a branch of the category tree that only links to its children:
   * header, no counter, no product blocks. Not an error — the products are on
   * the child categories.
   */
  indexOnly: boolean;
  /** "N件あります" counter: how many products the site says the genre has. */
  listedTotal: number;
  currentPage: number;
  /** Highest page number linked from the pager (>= currentPage). */
  lastPage: number;
  /** Site-relative path of the next page, if any (`/catalog/r/rkit_p2/`). */
  nextPath: string | null;
  items: ListingItem[];
  /** Non-fatal per-item problems (kept for the run summary). */
  issues: string[];
}

/** One product occurrence on a listing page, before cross-listing deduplication. */
export type ListingItem = Pick<AkizukiRawItem, 'salesCode' | 'modelNumber' | 'name' | 'category' | 'url' | 'prices' | 'stock'> & {
  positionOnPage: number;
};

export class ListingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingParseError';
  }
}

/**
 * The shop renders a listing in one of two layouts. Most categories use the
 * card layout (`dl.block-cart-i--goods`); categories whose products share a
 * spec sheet (heatsinks, screws, ...) use a sortable table
 * (`table.block-goods-list-l--table`) instead. Same data, different markup, so
 * each layout only contributes the patterns that locate its fields.
 */
const CARD_OPEN = /<dl class="block-cart-i--goods\b/g;
/** End of the card list: the closing of `ul.block-cart-i--items`. */
const CARD_END = /<\/ul>\s*<\/div>/;
const TABLE_OPEN = /<tr class="[^"]*js-enhanced-ecommerce-item\b/g;
const TABLE_END = /<\/tbody>/;
const TABLE_MARKER = /<table class="[^"]*block-goods-list-l--table\b/;
const MAINTENANCE_MARKER = /class="block-custom-error-403"/;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function cleanText(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();
}

function first(re: RegExp, s: string): string | null {
  const m = re.exec(s);
  return m?.[1] ?? null;
}

/** "￥1,200" → 1200; anything without digits → null. */
export function parseYen(display: string): number | null {
  const m = /(\d[\d,]*)/.exec(display);
  if (m?.[1] === undefined) return null;
  const n = Number.parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** "2362セット" → { quantity: 2362, unit: "セット" }. */
export function parseQuantityDisplay(display: string): { quantity: number | null; unit: string | null } {
  const m = /^(\d[\d,]*)\s*(.*)$/.exec(display.trim());
  if (m?.[1] === undefined) return { quantity: null, unit: null };
  const quantity = Number.parseInt(m[1].replace(/,/g, ''), 10);
  const unit = (m[2] ?? '').trim();
  return { quantity: Number.isSafeInteger(quantity) ? quantity : null, unit: unit === '' ? null : unit };
}

/** True when the response is the site's "under maintenance" / access-denied page. */
export function isAkizukiMaintenancePage(html: string): boolean {
  return MAINTENANCE_MARKER.test(html);
}

/** Where each layout keeps the fields of one product. */
interface ItemLayout {
  /** Product link (`/catalog/g/g<code>/`). */
  href: RegExp;
  /** "販売コード：<code>". */
  code: RegExp;
  name: RegExp;
  category: RegExp;
  model: RegExp;
  /** Global; capture 1 = quantity/unit, capture 2 = price display. */
  price: RegExp;
  /**
   * Whether the shop offered a cart affordance here. The table layout has no
   * cart at all, so it reports `null` (unknown) rather than `false` — the
   * stock badge is then the only availability evidence.
   */
  purchasable: (block: string) => boolean | null;
}

const CARD_LAYOUT: ItemLayout = {
  href: /class="block-cart-i--goods-name"[^>]*>\s*<a href="([^"]+)"/,
  code: /class="block-cart-i--code">\s*<strong>[^<]*<\/strong>\s*([^<]*)<\/div>/,
  name: /class="block-cart-i--goods-name">\s*<a [^>]*>([\s\S]*?)<\/a>/,
  category: /class="block-cart-i--goods-name">\s*<a [^>]*data-category="([^"]*)"/,
  model: /class="block-cart-i--model_number">\s*<strong>[^<]*<\/strong>([\s\S]*?)<\/div>/,
  price: /class="block-cart-i--price-qty">([\s\S]*?)<\/div>\s*<div class="block-cart-i--price price[^"]*">([\s\S]*?)<\/div>/g,
  purchasable: (block) => /data-purchasable-qty="/.test(block) || /class="block-cart-i--add_cart/.test(block),
};

const TABLE_LAYOUT: ItemLayout = {
  href: /class="block-goods-list-l--goods-name">\s*<a href="([^"]+)"/,
  code: /class="block-goods-list-l--code">\s*<strong>[^<]*<\/strong>\s*([^<]*)<\/div>/,
  name: /class="block-goods-list-l--goods-name">\s*<a [^>]*>([\s\S]*?)<\/a>/,
  category: /class="block-goods-list-l--goods-name">\s*<a [^>]*data-category="([^"]*)"/,
  model: /class="block-goods-list-l--model_number"[^>]*>\s*<p>([\s\S]*?)<\/p>/,
  price: /class="block-goods-list-l--price-qty">([\s\S]*?)<\/div>\s*<div class="block-goods-list-l--price price[^"]*">([\s\S]*?)<\/div>/g,
  purchasable: () => null,
};

function parseItem(block: string, position: number, issues: string[], layout: ItemLayout): ListingItem | null {
  const href = first(layout.href, block);
  const codeFromHref = href === null ? null : first(/\/catalog\/g\/g(\d+)\//, href);
  const codeText = (first(layout.code, block) ?? '').trim();
  const textUsable = AKIZUKI_SALES_CODE_PATTERN.test(codeText);
  const salesCode = textUsable ? codeText : codeFromHref;
  if (salesCode === null || !AKIZUKI_SALES_CODE_PATTERN.test(salesCode)) {
    issues.push(`item ${position}: no sales code (text=${JSON.stringify(codeText)}, href=${href ?? 'none'})`);
    return null;
  }
  if (!textUsable) {
    issues.push(`item ${position}: unusable sales code text ${JSON.stringify(codeText)}, using link ${salesCode}`);
  } else if (codeFromHref !== null && codeFromHref !== salesCode) {
    issues.push(`item ${position}: sales code ${salesCode} disagrees with link ${codeFromHref}`);
  }
  const nameHtml = first(layout.name, block);
  const name = nameHtml === null ? '' : cleanText(nameHtml);
  if (name === '') issues.push(`item ${position} (${salesCode}): empty name`);
  const categoryRaw = first(layout.category, block);
  const category = categoryRaw === null ? null : cleanText(categoryRaw) || null;
  const modelRaw = first(layout.model, block);
  const modelNumber = modelRaw === null ? null : cleanText(modelRaw) || null;

  const prices: AkizukiRawPrice[] = [];
  const priceRe = new RegExp(layout.price.source, 'g');
  for (let m = priceRe.exec(block); m !== null; m = priceRe.exec(block)) {
    const quantityUnit = cleanText(m[1] ?? '');
    const display = cleanText(m[2] ?? '').replace(/\s+\(/, '(');
    prices.push({ amountYen: parseYen(display), display, quantityUnit, taxIncluded: display.includes('税込') });
  }
  if (prices.length === 0) issues.push(`item ${position} (${salesCode}): no price block`);

  const statuses: string[] = [];
  const stockRe = /class="block-cart-i--stock-info-[\w-]+">([\s\S]*?)<\/div>/g;
  for (let m = stockRe.exec(block); m !== null; m = stockRe.exec(block)) {
    const text = cleanText(m[1] ?? '');
    if (text !== '') statuses.push(text);
  }
  if (statuses.length === 0) issues.push(`item ${position} (${salesCode}): no stock status`);
  const purchasable = layout.purchasable(block);
  const availRaw = first(/class="block-cart-i--available_purchase">[\s\S]*?<dd>([\s\S]*?)<\/dd>/, block);
  const quantityDisplay = availRaw === null ? null : cleanText(availRaw) || null;
  const parsedQty = quantityDisplay === null ? { quantity: null, unit: null } : parseQuantityDisplay(quantityDisplay);
  const stock: AkizukiRawStock = {
    status: statuses.join(' / '),
    availableQuantity: parsedQty.quantity,
    quantityUnit: parsedQty.unit,
    quantityDisplay,
    purchasable,
  };

  return { salesCode, modelNumber, name, category, url: akizukiProductUrl(salesCode), prices, stock, positionOnPage: position };
}

/** Start offsets of every product block, plus where the last one ends. */
function blockRanges(html: string, open: RegExp, end: RegExp): { starts: number[]; end: number } {
  const starts: number[] = [];
  const re = new RegExp(open.source, 'g');
  for (let m = re.exec(html); m !== null; m = re.exec(html)) starts.push(m.index);
  const lastStart = starts[starts.length - 1];
  const endMatch = lastStart === undefined ? null : end.exec(html.slice(lastStart));
  return { starts, end: lastStart === undefined || endMatch === null ? html.length : lastStart + endMatch.index };
}

/** True when the page shows products in either layout. */
function hasItems(html: string): boolean {
  if (blockRanges(html, CARD_OPEN, CARD_END).starts.length > 0) return true;
  return TABLE_MARKER.test(html) && blockRanges(html, TABLE_OPEN, TABLE_END).starts.length > 0;
}

/** Reads the products of whichever layout the page uses. */
function extractItems(html: string, issues: string[]): ListingItem[] {
  const useTable = TABLE_MARKER.test(html) && blockRanges(html, CARD_OPEN, CARD_END).starts.length === 0;
  const layout = useTable ? TABLE_LAYOUT : CARD_LAYOUT;
  const { starts, end } = blockRanges(html, useTable ? TABLE_OPEN : CARD_OPEN, useTable ? TABLE_END : CARD_END);
  const items: ListingItem[] = [];
  starts.forEach((start, i) => {
    const block = html.slice(start, i + 1 < starts.length ? starts[i + 1] : end);
    const item = parseItem(block, i + 1, issues, layout);
    if (item !== null) items.push(item);
  });
  return items;
}

export function parseAkizukiListingPage(html: string): ListingPage {
  if (isAkizukiMaintenancePage(html)) throw new ListingParseError('maintenance / access-denied page');
  const rawName = first(/<h1 class="[^"]*block-(?:genre-page|category-list)--header[^"]*">([\s\S]*?)<\/h1>/, html);
  if (rawName === null) throw new ListingParseError('listing header not found');
  const listingName = cleanText(rawName);
  const listedTotalText = first(/class="pager-count">\s*<span>([\d,]+)<\/span>/, html);
  if (listedTotalText === null) {
    // A category that only links to its children carries no counter and no
    // products. Anything else without a counter is a structural surprise.
    if (hasItems(html)) throw new ListingParseError('listed total (pager-count) not found although the page shows products');
    return { listingName, indexOnly: true, listedTotal: 0, currentPage: 1, lastPage: 1, nextPath: null, items: [], issues: [] };
  }
  const listedTotal = Number.parseInt(listedTotalText.replace(/,/g, ''), 10);
  const currentPage = Number.parseInt(first(/class="pager-current">\s*<span>(\d+)<\/span>/, html) ?? '1', 10);
  const nextPath = first(/<a rel="next" href="([^"]+)"/, html) ?? first(/<link rel="next" href="https?:\/\/[^/]+([^"]+)"/, html);
  let lastPage = currentPage;
  const pageLinkRe = /href="\/catalog\/[rc]\/[A-Za-z0-9_-]+_p(\d+)\/"/g;
  for (let m = pageLinkRe.exec(html); m !== null; m = pageLinkRe.exec(html)) {
    const n = Number.parseInt(m[1] ?? '0', 10);
    if (n > lastPage) lastPage = n;
  }

  const issues: string[] = [];
  const items = extractItems(html, issues);
  if (items.length === 0 && listedTotal > 0) throw new ListingParseError(`no product blocks found on a page listing ${listedTotal} items`);
  return { listingName, indexOnly: false, listedTotal, currentPage, lastPage, nextPath, items, issues };
}
