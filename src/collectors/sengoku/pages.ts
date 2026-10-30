/**
 * Parsers for the two pages the せんごくネット通販 collector reads (ADR-0024):
 * the category page (`category.php?cid=`), for the category tree, and a
 * listing page (`search.php?cid=&st=`), for 40 product rows and the listing's
 * own counter. Pure functions over the HTML string, no DOM library (ADR-0008).
 *
 * A row is reduced to facts before anything is read from it: the product
 * description is cut out of the markup first, and the image is reduced to its
 * alt text. Anything that does not have the expected shape throws, so the
 * crawl ends incomplete instead of publishing a guess.
 */
import { isSengokuCode } from '../../adapters/sengoku/identity.ts';
import { SENGOKU_QUOTE_LABEL, type SengokuItem, type SengokuPriceLine } from '../../adapters/sengoku/rawSchema.ts';

export interface SengokuCategory {
  cid: number;
  name: string;
  children: SengokuCategory[];
}

export interface SengokuListingPage {
  /** S, E and T of 「S件～E件(全T件)」. */
  start: number;
  end: number;
  total: number;
  rows: SengokuListingRow[];
}

export type SengokuListingRow = Omit<SengokuItem, 'listings'>;

export class SengokuPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SengokuPageError';
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Tags removed, entities decoded, ASCII whitespace runs collapsed. Full-width spaces in names stay. */
function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/[\t\n\r ]+/g, ' ').trim();
}

function integer(digits: string): number {
  return Number.parseInt(digits.replace(/,/g, ''), 10);
}

const CATEGORY_TOKEN = new RegExp([
  /<div class="category_class"><a href="\/mod\/sgk_cart\/(?:category|search)\.php\?cid=(\d+)">([\s\S]*?)<\/a><\/div>/.source,
  /<div class="category_lv0">■<a href="\/mod\/sgk_cart\/search\.php\?cid=(\d+)">([\s\S]*?)<\/a><\/div>/.source,
  /<p>・<a href="\/mod\/sgk_cart\/search\.php\?cid=(\d+)">([\s\S]*?)<\/a><\/p>/.source,
].join('|'), 'g');

/**
 * The categories under `rootCid`, three levels deep, from the main area of
 * its category page: 「category_class」 children, their 「■」 children and
 * their 「・」 children. The side menu lists the same first level; the two
 * must agree, which catches a main area that changed shape.
 */
export function parseSengokuCategoryTree(html: string, rootCid: number): SengokuCategory[] {
  const mainAt = html.indexOf('<div id="main">');
  if (mainAt < 0) throw new SengokuPageError('category page: no main area');
  const menu = new Set<number>();
  const menuRe = new RegExp(`<div class="category_sub" data-parent-cid="${rootCid}"><a href="/mod/sgk_cart/search\\.php\\?cid=(\\d+)">`, 'g');
  for (const m of html.slice(0, mainAt).matchAll(menuRe)) menu.add(Number(m[1]));

  const roots: SengokuCategory[] = [];
  const seen = new Set<number>();
  let level1: SengokuCategory | null = null;
  let level2: SengokuCategory | null = null;
  for (const m of html.slice(mainAt).matchAll(CATEGORY_TOKEN)) {
    const cid = Number(m[1] ?? m[3] ?? m[5]);
    const name = cleanText(m[2] ?? m[4] ?? m[6] ?? '');
    if (!Number.isSafeInteger(cid) || cid < 1 || name === '') throw new SengokuPageError(`category page: unreadable category ${m[0]}`);
    if (seen.has(cid)) throw new SengokuPageError(`category page: category ${cid} appears twice`);
    seen.add(cid);
    const node: SengokuCategory = { cid, name, children: [] };
    if (m[1] !== undefined) {
      roots.push(node);
      level1 = node;
      level2 = null;
    } else if (m[3] !== undefined) {
      if (level1 === null) throw new SengokuPageError(`category page: ${cid} comes before any top category`);
      level1.children.push(node);
      level2 = node;
    } else {
      if (level2 === null) throw new SengokuPageError(`category page: ${cid} comes before any ■ category`);
      level2.children.push(node);
    }
  }
  if (roots.length === 0) throw new SengokuPageError('category page: no categories');
  const same = menu.size === roots.length && roots.every((r) => menu.has(r.cid));
  if (!same) throw new SengokuPageError(`category page: the side menu lists ${menu.size} categories and the main area ${roots.length}, not the same ones`);
  return roots;
}

const COUNTER = /<div class="item_nums">\s*([\d,]+)件[～〜~]([\d,]+)件\(全([\d,]+)件\)\s*<\/div>/;
/** The listing table's own price heading. */
const TAX_INCLUDED_HEADING = '通販価格(税込)';
const TABLE = /<table class="[^"]*\bitem_list_table\b[^"]*"[^>]*>([\s\S]*?)<\/table>/;
const DESCRIPTION_START = '<div class="item_list1_description">';
const PRICE_START = '<div class="item_list1_price">';
const ROW = /<tr\b[^>]*\bclass="item_list_row"[^>]*>([\s\S]*?)<\/tr>/g;
const IMAGE_CELL = /<td class="item_list1_image">([\s\S]*?)<\/td>/;
const IMAGE_LINK = /<a class="([^"]*)" href="\.\/detail\.php\?code=([^"&]+)">/;
const NAME_CELL = /<td class="item_list1_name">([\s\S]*?)<a href="\.\/detail\.php\?code=([^"&]+)">([\s\S]*?)<\/a>\s*(?:<br\s*\/?>)?\s*<div class="item_list1_price">([\s\S]*?)<\/div>\s*<\/td>/;
const DETAIL_CELL = /<td class="item_list1_detail">([\s\S]*?)<\/td>/;
const DETAIL_LINK = /<a href="\.\/detail\.php\?code=([^"&]+)">/;
/**
 * One price line: `【数量1個〜】単価&nbsp;¥1340<br>`, or a label alone when the
 * shop gives no quantity (`特価&nbsp;¥500<br>`, `1リール&nbsp;¥75605<br>`), or a
 * quote request without a price (`【数量1個〜】&nbsp;価格お見積り<br>`, also
 * printed as `価格お見積り&nbsp;¥0`). A label never contains 【 or 】, so a
 * quantity the pattern cannot read is left over as text and refused instead
 * of being taken for a label.
 */
const PRICE_LINE = /(?:【数量([\d,]+)([^〜～】\d][^〜～】]*)[〜～]】)?(?:&nbsp;|\s)*(?:(価格お見積り)(?:(?:&nbsp;|\s)*(?:¥|￥|&yen;)0)?|([^&<¥￥【】]+?)(?:&nbsp;|\s)*(?:¥|￥|&yen;)([\d,]+))\s*<br\s*\/?>/g;

/**
 * Cuts every product description out of the listing markup. A description
 * runs from its own opening tag to the price block that follows it, so its
 * text, whatever it contains, is never parsed.
 */
export function withoutDescriptions(html: string): string {
  let out = '';
  let at = 0;
  for (let open = html.indexOf(DESCRIPTION_START, at); open >= 0; open = html.indexOf(DESCRIPTION_START, at)) {
    const price = html.indexOf(PRICE_START, open);
    if (price < 0) throw new SengokuPageError('listing page: a description is not followed by a price block');
    out += html.slice(at, open);
    at = price;
  }
  return out + html.slice(at);
}

function parsePriceLines(html: string, subject: string): SengokuPriceLine[] {
  const lines: SengokuPriceLine[] = [];
  const rest = html.replace(PRICE_LINE, (_, quantity: string | undefined, unit: string | undefined, quote: string | undefined, label: string | undefined, yen: string | undefined) => {
    lines.push({
      minQuantity: quantity === undefined ? null : integer(quantity), quantityUnit: unit === undefined ? null : cleanText(unit),
      label: quote ?? cleanText(label!), amountYen: quote === undefined ? integer(yen!) : null,
    });
    return '';
  });
  // A price block with nothing in it shows no price (seen once, EEHD-5MAE on 2026-10-30); anything else must be read whole.
  if (cleanText(html) === '') return lines;
  if (lines.length === 0 || cleanText(rest) !== '' || lines.some((t) => t.label === '' || t.quantityUnit === ''
    || (t.label === SENGOKU_QUOTE_LABEL) !== (t.amountYen === null) || t.amountYen === 0)) {
    throw new SengokuPageError(`${subject}: unreadable price text ${JSON.stringify(cleanText(html))}`);
  }
  return lines;
}

function parseRow(row: string, position: number): SengokuListingRow {
  const subject = `row ${position}`;
  const name = NAME_CELL.exec(row);
  if (name === null) throw new SengokuPageError(`${subject}: no name cell with a product link and a price block`);
  const code = name[2]!;
  if (!isSengokuCode(code)) throw new SengokuPageError(`${subject}: unexpected product code ${JSON.stringify(code)}`);
  const detail = DETAIL_CELL.exec(row);
  if (detail === null || DETAIL_LINK.exec(detail[1]!)?.[1] !== code) throw new SengokuPageError(`${subject} (${code}): the detail cell does not link the same product`);
  const imageCell = IMAGE_CELL.exec(row)?.[1];
  if (imageCell === undefined) throw new SengokuPageError(`${subject} (${code}): no image cell`);
  const imageLink = IMAGE_LINK.exec(imageCell);
  if (imageLink === null || imageLink[2] !== code) throw new SengokuPageError(`${subject} (${code}): the image cell does not link the same product`);
  const alt = /<img\b[^>]*?\balt="([^"]*)"/.exec(imageCell)?.[1];
  const productName = cleanText(name[3]!);
  if (productName === '') throw new SengokuPageError(`${subject} (${code}): empty name`);
  return {
    code,
    name: productName,
    maker: cleanText(name[1]!) || null,
    model: alt === undefined ? null : cleanText(alt) || null,
    priceLines: parsePriceLines(name[4]!, `${subject} (${code})`),
    outOfStockClass: imageLink[1]!.split(/\s+/).includes('outofstock'),
    stockMark: cleanText(detail[1]!) || null,
  };
}

/** One page of a listing: its counter and its product rows, in page order. */
export function parseSengokuListingPage(html: string): SengokuListingPage {
  const counter = COUNTER.exec(html);
  if (counter === null) throw new SengokuPageError('listing page: no 「S件～E件(全T件)」 counter');
  const table = TABLE.exec(html)?.[1];
  if (table === undefined) throw new SengokuPageError('listing page: no listing table');
  if (!table.includes(TAX_INCLUDED_HEADING)) throw new SengokuPageError(`listing page: the price heading no longer says ${TAX_INCLUDED_HEADING}`);
  const rows: SengokuListingRow[] = [];
  for (const m of withoutDescriptions(table).matchAll(ROW)) {
    // The heading row shares the class.
    if (/<th\b/.test(m[1]!)) continue;
    rows.push(parseRow(m[1]!, rows.length + 1));
  }
  return { start: integer(counter[1]!), end: integer(counter[2]!), total: integer(counter[3]!), rows };
}
