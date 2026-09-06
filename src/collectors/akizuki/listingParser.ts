/**
 * Parser for Akizuki genre listing pages (`/catalog/r/<genre>/`,
 * `/catalog/r/<genre>_p<n>/`). Pure function over the HTML string; no
 * network, no DOM library. The markup is regular server-rendered HTML with
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
  /** Genre display name from the page header. */
  genreName: string;
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

/** One product occurrence on a listing page, before cross-genre deduplication. */
export type ListingItem = Pick<AkizukiRawItem, 'salesCode' | 'modelNumber' | 'name' | 'category' | 'url' | 'prices' | 'stock'> & {
  positionOnPage: number;
};

export class ListingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListingParseError';
  }
}

const ITEM_OPEN = /<dl class="block-cart-i--goods\b/g;
/** End of the product list: the closing of `ul.block-cart-i--items`. */
const ITEMS_END = /<\/ul>\s*<\/div>/;
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

function parseItem(block: string, position: number, issues: string[]): ListingItem | null {
  const href = first(/class="block-cart-i--goods-name"[^>]*>\s*<a href="([^"]+)"/, block);
  const codeFromHref = href === null ? null : first(/\/catalog\/g\/g(\d+)\//, href);
  const codeText = (first(/class="block-cart-i--code">\s*<strong>[^<]*<\/strong>\s*([^<]*)<\/div>/, block) ?? '').trim();
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
  const nameHtml = first(/class="block-cart-i--goods-name">\s*<a [^>]*>([\s\S]*?)<\/a>/, block);
  const name = nameHtml === null ? '' : cleanText(nameHtml);
  if (name === '') issues.push(`item ${position} (${salesCode}): empty name`);
  const categoryRaw = first(/class="block-cart-i--goods-name">\s*<a [^>]*data-category="([^"]*)"/, block);
  const category = categoryRaw === null ? null : cleanText(categoryRaw) || null;
  const modelRaw = first(/class="block-cart-i--model_number">\s*<strong>[^<]*<\/strong>([\s\S]*?)<\/div>/, block);
  const modelNumber = modelRaw === null ? null : cleanText(modelRaw) || null;

  const prices: AkizukiRawPrice[] = [];
  const priceRe = /class="block-cart-i--price-qty">([\s\S]*?)<\/div>\s*<div class="block-cart-i--price price[^"]*">([\s\S]*?)<\/div>/g;
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
  const purchasable = /data-purchasable-qty="/.test(block) || /class="block-cart-i--add_cart/.test(block);
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

export function parseAkizukiListingPage(html: string): ListingPage {
  if (isAkizukiMaintenancePage(html)) throw new ListingParseError('maintenance / access-denied page');
  const genreName = first(/<h1 class="[^"]*block-genre-page--header[^"]*">([\s\S]*?)<\/h1>/, html);
  if (genreName === null) throw new ListingParseError('genre header not found');
  const listedTotalText = first(/class="pager-count">\s*<span>([\d,]+)<\/span>/, html);
  if (listedTotalText === null) throw new ListingParseError('listed total (pager-count) not found');
  const listedTotal = Number.parseInt(listedTotalText.replace(/,/g, ''), 10);
  const currentPage = Number.parseInt(first(/class="pager-current">\s*<span>(\d+)<\/span>/, html) ?? '1', 10);
  const nextPath = first(/<a rel="next" href="([^"]+)"/, html) ?? first(/<link rel="next" href="https?:\/\/[^/]+([^"]+)"/, html);
  let lastPage = currentPage;
  const pageLinkRe = /href="\/catalog\/r\/[A-Za-z0-9]+_p(\d+)\/"/g;
  for (let m = pageLinkRe.exec(html); m !== null; m = pageLinkRe.exec(html)) {
    const n = Number.parseInt(m[1] ?? '0', 10);
    if (n > lastPage) lastPage = n;
  }

  const issues: string[] = [];
  const items: ListingItem[] = [];
  const starts: number[] = [];
  ITEM_OPEN.lastIndex = 0;
  for (let m = ITEM_OPEN.exec(html); m !== null; m = ITEM_OPEN.exec(html)) starts.push(m.index);
  const lastStart = starts[starts.length - 1];
  const endMatch = lastStart === undefined ? null : ITEMS_END.exec(html.slice(lastStart));
  const end = lastStart === undefined || endMatch === null ? html.length : lastStart + endMatch.index;
  starts.forEach((start, i) => {
    const block = html.slice(start, i + 1 < starts.length ? starts[i + 1] : end);
    const item = parseItem(block, i + 1, issues);
    if (item !== null) items.push(item);
  });
  if (items.length === 0 && listedTotal > 0) throw new ListingParseError(`no product blocks found on a page listing ${listedTotal} items`);
  return { genreName: cleanText(genreName), listedTotal, currentPage, lastPage, nextPath, items, issues };
}
