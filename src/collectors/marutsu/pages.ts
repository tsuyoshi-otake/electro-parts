/**
 * Parser for the マルツオンライン listing pages the collector reads
 * (ADR-0036): a stocked-only category listing (`GoodsListNavi.jsp` with
 * `category=<path>&ids=1`), for its counter and its product rows. Pure
 * functions over the HTML string, no DOM library (ADR-0008).
 *
 * A row is reduced to facts before anything is read from it: every field
 * is taken from an anchored element (the row's own labelled spec entries,
 * its price block, its stock label), so the product description and the
 * specification table that follow the spec block are never parsed.
 * Anything that does not have the expected shape throws, so the crawl
 * ends incomplete instead of publishing a guess.
 *
 * The served page renders the same results twice, as desktop rows and
 * as a smartphone rendering (its fields carry an Sp marker, as in
 * `salesGoodsCodeSp_N`), and its counter script initialises the
 * counters unquoted before assigning the real values quoted once per
 * rendering. Only the desktop rows and the quoted assignments are
 * read; both were seen on the saved pages of 2025-03-19 and
 * 2026-01-29.
 */
import { isMarutsuCode } from '../../adapters/marutsu/identity.ts';
import type { MarutsuItem, MarutsuPriceTier } from '../../adapters/marutsu/rawSchema.ts';

export interface MarutsuListingPage {
  /** The listing's total, from the page's own `resultsDataNumber`. */
  total: number;
  /** The page number the page says it is (`resultsShowPageNumber`). */
  page: number;
  /** Rows per page the page says it shows (`resultsMaxShowLine`). */
  perPage: number;
  rows: MarutsuListingRow[];
}

export type MarutsuListingRow = Omit<MarutsuItem, 'listings'>;

export class MarutsuPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarutsuPageError';
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

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

/**
 * A yen amount as the shop prints it: `￥1,219.00`, `税込￥1,340.00`. The
 * two decimals are always `.00` in every row read on 2026-11-16 (the shop
 * truncates to whole yen); anything else is refused, never rounded.
 */
function yenAmount(rawText: string, subject: string): number {
  // The amount is split by the yen label's own element (`<small>￥</small>1,219.00`), so spaces go first.
  const text = rawText.replace(/\s+/g, '');
  const m = /([¥￥])([\d,]+)\.(\d{2})/.exec(text);
  if (m === null) throw new MarutsuPageError(`${subject}: unreadable price ${JSON.stringify(text)}`);
  if (m[3] !== '00') throw new MarutsuPageError(`${subject}: price ${JSON.stringify(text)} is not a whole number of yen`);
  return integer(m[2]!);
}

const TOTAL = /resultsDataNumber = "([\d,]+)"/g;
const PAGE_NUMBER = /resultsShowPageNumber = "(\d+)"/g;
const PER_PAGE = /resultsMaxShowLine = "(\d+)"/g;

/**
 * One counter of the listing script. The page first initialises its
 * script variables unquoted (`resultsShowPageNumber = 0`) and then
 * assigns the real values quoted, once per rendered results group;
 * only the quoted assignments are the page's counters, and every one
 * of them must agree.
 */
function counter(html: string, pattern: RegExp, subject: string): number {
  const values = [...html.matchAll(pattern)].map((m) => m[1]!);
  if (values.length === 0) throw new MarutsuPageError(`listing page: no ${subject} counter`);
  if (new Set(values).size !== 1) throw new MarutsuPageError(`listing page: the ${subject} counters disagree (${values.join(', ')})`);
  return integer(values[0]!);
}
const ROW_START = /<li id="resultsRow_(\d+)" class="DETAILS_ROW[^"]*">/g;
const NAME_LINK = /<a href="\/pc\/i\/(\d+)\/" id="goodsName_(\d+)_link"[^>]*class="goodsName"[^>]*>([\s\S]*?)<\/a>/;
const SALES_CODE = /<input type="hidden" id="salesGoodsCode_(\d+)"[^>]*value="(\d+)"/;
const PRICE_BLOCK = /<div class="item_price">([\s\S]*?)(?=<div id="stockNumSurround"|<div class="layout_set spec")/;
const TIER = /<span[^>]*class="unit"[^>]*>([^<]+)<\/span>[\s\S]*?<span[^>]*class="price [^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="priceAfterTax[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
const TIER_UNIT = /^([\d,]+)(.+?)以上$/;
const STOCK_NUMBER = /<label id="stockNum_(\d+)_innerId" class="NUMBER">([\d,]+)<\/label>/;
const SPEC_BLOCK = /<div class="item_spec">([\s\S]*?)(?=<ul class="item_spec_data_container"|<\/li>)/;
const SPEC_ENTRY = /<dl[^>]*>\s*<dt>([^<]+)<\/dt>\s*<dd>([\s\S]*?)<\/dd>\s*<\/dl>/g;
const MODEL_LABEL = /<label id="modelNo_\d+_innerId"[^>]*>([\s\S]*?)<\/label>/;
const SHIP_LABEL = /<label id="deliveryInstructPlanDate_\d+_innerId"[^>]*>([\s\S]*?)<\/label>/;
const MAKER_LINK = /<a[^>]*class="maker"[^>]*>([\s\S]*?)<\/a>/;
const MARUTSU_CODE_IN_TEXT = /M\d{4}-\d{4}/;

function parsePriceTiers(row: string, subject: string): MarutsuPriceTier[] {
  const block = PRICE_BLOCK.exec(row)?.[1];
  if (block === undefined) return [];
  const tiers: MarutsuPriceTier[] = [];
  for (const m of block.matchAll(TIER)) {
    const unitText = cleanText(m[1]!);
    const unit = TIER_UNIT.exec(unitText);
    if (unit === null) throw new MarutsuPageError(`${subject}: unreadable quantity tier ${JSON.stringify(unitText)}`);
    tiers.push({
      minQuantity: integer(unit[1]!),
      quantityUnit: cleanText(unit[2]!),
      amountExcludingTaxYen: yenAmount(cleanText(m[2]!), subject),
      amountIncludingTaxYen: yenAmount(cleanText(m[3]!), subject),
    });
  }
  if (tiers.length === 0 && cleanText(block) !== '') throw new MarutsuPageError(`${subject}: a price block that does not read as tiers`);
  return tiers;
}

function specEntries(row: string, subject: string): Map<string, string> {
  const block = SPEC_BLOCK.exec(row)?.[1];
  if (block === undefined) throw new MarutsuPageError(`${subject}: no spec block`);
  const entries = new Map<string, string>();
  for (const m of block.matchAll(SPEC_ENTRY)) {
    const label = cleanText(m[1]!);
    if (entries.has(label)) throw new MarutsuPageError(`${subject}: spec entry ${label} appears twice`);
    entries.set(label, m[2]!);
  }
  return entries;
}

function parseRow(block: string, index: number): MarutsuListingRow {
const subject = `row ${index + 1}`;
const nameLink = NAME_LINK.exec(block);
if (nameLink === null) throw new MarutsuPageError(`${subject}: no name link with a product address`);
if (Number(nameLink[2])!== index) throw new MarutsuPageError(`${subject}: the name link is numbered ${nameLink[2]}`);
const pageId = nameLink[1]!;
const salesCode = SALES_CODE.exec(block);
if (salesCode === null || Number(salesCode[1])!== index || salesCode[2]!== pageId) {
throw new MarutsuPageError(`${subject}: the hidden sales code does not name the same product as the name link`);
}
const entries = specEntries(block, `${subject} (${pageId})`);

const specModel = entries.has('型番：')? cleanText(MODEL_LABEL.exec(entries.get('型番：')!)?.[1]?? '') || null: null;
const linkText = cleanText(nameLink[3]!);
const bracket = /^【([^】]+)】([\s\S]*)$/.exec(linkText);
let name = linkText;
let model = specModel;
if (bracket!== null) {
if (specModel!== null && bracket[1]!== specModel) {
throw new MarutsuPageError(`${subject} (${pageId}): the name link says and the spec block says 型番 ${specModel}`);
}
model = specModel?? bracket[1]!;
name = bracket[2]!.trim();
}
if (name === '') throw new MarutsuPageError(`${subject} (${pageId}): empty name`);

let marutsuCode: string | null = null;
if (entries.has('マルツコード：')) {
const found = MARUTSU_CODE_IN_TEXT.exec(cleanText(entries.get('マルツコード：')!));
if (found === null ||!isMarutsuCode(found[0])) throw new MarutsuPageError(`${subject} (${pageId}): a マルツコード entry that does not read as a code`);
marutsuCode = found[0];
}

const stock = STOCK_NUMBER.exec(block);
let stockQuantity: number | null = null;
let stockNote: string | null = null;
if (stock!== null) {
if (Number(stock[1])!== index) throw new MarutsuPageError(`${subject} (${pageId}): the stock label is numbered ${stock[1]}`);
stockQuantity = integer(stock[2]!);
} else if (block.includes('最新在庫数を確認')) {
stockNote = '最新在庫数を確認';
}

let shipText: string | null = null;
if (entries.has('出荷予定日：')) {
const dd = entries.get('出荷予定日：')!;
shipText = cleanText(SHIP_LABEL.exec(dd)?.[1]?? dd) || null;
}

let minOrderQuantity: number | null = null;
if (entries.has('最小発注数量：')) {
const text = cleanText(entries.get('最小発注数量：')!);
const m = /^([\d,]+)/.exec(text);
if (m === null) throw new MarutsuPageError(`${subject} (${pageId}): unreadable 最小発注数量 ${JSON.stringify(text)}`);
minOrderQuantity = integer(m[1]!);
}

return {
pageId,
name,
maker: entries.has('メーカー名：')? cleanText(MAKER_LINK.exec(entries.get('メーカー名：')!)?.[1]?? entries.get('メーカー名：')!) || null: null,
model,
marutsuCode,
priceTiers: parsePriceTiers(block, `${subject} (${pageId})`),
stockQuantity,
stockNote,
shipText,
qualityRank: entries.has('品質ランク：')? cleanText(entries.get('品質ランク：')!) || null: null,
minOrderQuantity,
};
}

export interface MarutsuSubcategory {
  /** The six-digit category path (`16` + the four-digit subcategory code). */
  path: string;
  name: string;
}

const SUBCATEGORY_LINK = /<a href="LargeCategoryList\.jsp\?goodsClassCode1=(\d{2})#goodsClassName2Surround(\d{6})"[^>]*>([\s\S]*?)<\/a>/g;

/**
 * The subcategories of one top category, from the shop's category index
 * (`GoodsAllCategoryList.jsp`): each subcategory is an anchor link into
 * the top category's own list page, the anchor naming the six-digit
 * path. Only the given top category's links are read.
 */
export function parseMarutsuSubcategories(html: string, topPath: string): MarutsuSubcategory[] {
  const found: MarutsuSubcategory[] = [];
  const byPath = new Map<string, string>();
  for (const m of html.matchAll(SUBCATEGORY_LINK)) {
    if (m[1] !== topPath || !m[2]!.startsWith(topPath)) continue;
    const name = cleanText(m[3]!);
    if (name === '') throw new MarutsuPageError(`category index: subcategory ${m[2]} has no name`);
    const known = byPath.get(m[2]!);
    if (known !== undefined && known !== name) throw new MarutsuPageError(`category index: subcategory ${m[2]} appears as both ${known} and ${name}`);
    if (known === undefined) {
      byPath.set(m[2]!, name);
      found.push({ path: m[2]!, name });
    }
  }
  if (found.length === 0) throw new MarutsuPageError(`category index: no subcategories of ${topPath}`);
  return found;
}

/** One page of a stocked listing: its counter and its product rows, in page order. */
export function parseMarutsuListingPage(html: string): MarutsuListingPage {
  const total = counter(html, TOTAL, 'resultsDataNumber');
  const page = counter(html, PAGE_NUMBER, 'resultsShowPageNumber');
  const perPage = counter(html, PER_PAGE, 'resultsMaxShowLine');
  const starts = [...html.matchAll(ROW_START)];
  const rows: MarutsuListingRow[] = [];
  for (const [i, m] of starts.entries()) {
    const from = m.index;
    const to = i + 1 < starts.length ? starts[i + 1]!.index : html.length;
    const block = html.slice(from, to);
    // The page renders the same results twice: the desktop rows and a
    // smartphone rendering whose fields carry an Sp marker
    // (`salesGoodsCodeSp_N`). Only the desktop rows are the listing.
    if (block.includes('salesGoodsCodeSp_')) continue;
    if (!block.includes('salesGoodsCode_')) throw new MarutsuPageError(`listing page: row ${Number(m[1]) + 1} has no sales code input`);
    if (Number(m[1]) !== rows.length) throw new MarutsuPageError(`listing page: row ${rows.length + 1} is numbered ${m[1]}`);
    rows.push(parseRow(block, rows.length));
  }
  return { total, page, perPage, rows };
}
