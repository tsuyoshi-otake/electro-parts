import { isMarutsuCode, isMarutsuPageId } from './identity.ts';

/**
 * Raw schema of a マルツオンライン snapshot (ADR-0036).
 *
 * The rows of the stocked-only category listings (`GoodsListNavi.jsp` with
 * `ids=1`, the shop's 「明日出荷在庫品」 filter), reduced to facts: the
 * product page id, name, maker, model, the マルツコード when the row
 * prints one, the price tiers with their tax-excluded and tax-included
 * amounts, the same-day stock quantity when the row prints one, the
 * shipping-date text and the quality rank. Descriptions, specifications
 * and image addresses are never part of it.
 */

/** The top-level categories the crawl reads, as paths, in crawl order (ADR-0036). */
export const MARUTSU_TOP_CATEGORIES: readonly { path: string; name: string }[] = [
  { path: '05', name: 'キット' },
  { path: '11', name: '開発ツール' },
  { path: '15', name: '電気部品' },
  { path: '16', name: '電子部品' },
  { path: '17', name: '電線・配線部材' },
  { path: '19', name: '半導体' },
  { path: '21', name: 'コネクター' },
];
export const MARUTSU_TOP_CATEGORY_PATHS: readonly string[] = MARUTSU_TOP_CATEGORIES.map((c) => c.path);
/** Rows per listing page, the shop's default the collector asks for. */
export const MARUTSU_PAGE_SIZE = 50;
/** A listing never serves more than this many rows (80 pages of 50); a listing that reports more is cut off. */
export const MARUTSU_SEARCH_CAP = 4000;
/** The shipping text of a row that asks the buyer to inquire instead of naming a date. */
export const MARUTSU_INQUIRY_TEXT = 'お問合せ下さい';
/** The stock text of a marketplace (DigiKey) row, shown as a link instead of a quantity. */
export const MARUTSU_STOCK_LINK_TEXT = '最新在庫数を確認';
/** The shipping text of a marketplace (DigiKey) row, shown as a link instead of a date. */
export const MARUTSU_SHIP_LINK_TEXT = '最新納期を確認';

/**
* One quantity tier of a row's price block, in the shop's order
* (`1個以上 ￥429.00 (税抜) / 税込￥471.00`, then the larger breaks).
* Amounts are whole yen: the shop prints two decimals, always `.00` in
* every row read on 2026-11-16, and a row that prints anything else is
* refused rather than rounded.
*/
export interface MarutsuPriceTier {
/** The smallest quantity this price applies from (`1個以上` → 1). */
minQuantity: number;
/** The unit of that quantity as shown: 個, セット, 本, 袋. */
quantityUnit: string;
/** Tax-excluded yen, as printed. */
amountExcludingTaxYen: number;
/** Tax-included yen, as printed. */
amountIncludingTaxYen: number;
}

export interface MarutsuItem {
/** The numeric id of the product page address (`/pc/i/<id>/`). */
pageId: string;
/** The product name as shown, without the prefix the listing link carries. */
name: string;
/** The maker line of the spec block; null when the row has none. */
maker: string | null;
/** 型番 of the spec block (or the prefix of the name link); null when neither shows one. */
model: string | null;
/** The マルツコード when the row prints one; the saved listings of 2025-03 – 2026-01 do not, so it may be null. */
marutsuCode: string | null;
/** In the shop's order; empty when the row shows no price block. */
priceTiers: MarutsuPriceTier[];
/** 即納在庫数 as printed; null when the row shows no number (a marketplace link text instead, or nothing). */
stockQuantity: number | null;
/** The stock area's text when it is not a number (`最新在庫数を確認`); null when a number is shown or the area is absent. */
stockNote: string | null;
/** 出荷予定日 as shown: a date (`2026/11/17`), a span (`7営業日程度`), `お問合せ下さい` or `最新納期を確認`; null when absent. */
shipText: string | null;
/** 品質ランク as shown (`A`, `B`, `M1`…); null when absent. */
qualityRank: string | null;
/** 最小発注数量 as shown (`1個` → 1); null when the row does not print one. */
minOrderQuantity: number | null;
/** The listings (category paths) the product appeared in, in the order the crawl read them, each once. */
listings: string[];
}

export interface MarutsuListing {
/** The category path read (`16`, or `210008` when a capped listing was read through a subcategory). */
categoryPath: string;
/** The category name as the listing's heading shows it. */
name: string;
/** The listing's own total, below the search cap. */
listedTotal: number;
pageCount: number;
}

export interface MarutsuSnapshot {
schemaVersion: 1;
retrievedAt: string;
complete: boolean;
/** The top-level categories the crawl set out to read, in crawl order. */
categories: string[];
/** Listings read in full, in reading order. */
listings: MarutsuListing[];
/** Listings that reported the cap and were read through their subcategories instead. */
splitListings: string[];
items: MarutsuItem[];
errors: string[];
}

export function record(value: unknown, what = 'value'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} is not an object`);
  return value as Record<string, unknown>;
}

function positive(value: unknown, field: string, subject: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${subject}: ${field} is not a positive integer: ${JSON.stringify(value)}`);
  return value as number;
}

/** A stock quantity may be 0, so counts may be 0. */
function count(value: unknown, field: string, subject: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${subject}: ${field} is not a whole number: ${JSON.stringify(value)}`);
  return value as number;
}

function text(value: unknown, field: string, subject: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${subject}: ${field} missing`);
  return value;
}

function optionalText(value: unknown, field: string, subject: string): string | null {
  if (value === null) return null;
  return text(value, field, subject);
}

const CATEGORY_PATH = /^\d{2}(\d{4})?(\d{4})?$/;

export function isMarutsuCategoryPath(value: string): boolean {
  return CATEGORY_PATH.test(value);
}

export function parseMarutsuPriceTier(value: unknown, subject: string): MarutsuPriceTier {
  const t = record(value, `${subject} price tier`);
  return {
    minQuantity: count(t['minQuantity'], 'minQuantity', subject),
    quantityUnit: text(t['quantityUnit'], 'quantityUnit', subject),
    amountExcludingTaxYen: positive(t['amountExcludingTaxYen'], 'amountExcludingTaxYen', subject),
    amountIncludingTaxYen: positive(t['amountIncludingTaxYen'], 'amountIncludingTaxYen', subject),
  };
}

/** Validates one stored item. */
export function parseMarutsuItem(value: unknown): MarutsuItem {
  const p = record(value, 'item');
  const pageId = p['pageId'];
  if (typeof pageId !== 'string' || !isMarutsuPageId(pageId)) throw new Error(`invalid page id ${JSON.stringify(pageId)}`);
  const subject = `product ${pageId}`;
  const tiers = p['priceTiers'];
  if (!Array.isArray(tiers)) throw new Error(`${subject}: priceTiers missing`);
  const marutsuCode = p['marutsuCode'];
  if (marutsuCode !== null && (typeof marutsuCode !== 'string' || !isMarutsuCode(marutsuCode))) throw new Error(`${subject}: invalid マルツコード ${JSON.stringify(marutsuCode)}`);
  const listings = p['listings'];
  if (!Array.isArray(listings) || listings.length === 0) throw new Error(`${subject}: listings missing`);
  for (const path of listings) {
    if (typeof path !== 'string' || !isMarutsuCategoryPath(path)) throw new Error(`${subject}: invalid listing path ${JSON.stringify(path)}`);
  }
  if (new Set(listings).size !== listings.length) throw new Error(`${subject}: listings repeat a category`);
  return {
    pageId,
    name: text(p['name'], 'name', subject),
    maker: optionalText(p['maker'], 'maker', subject),
    model: optionalText(p['model'], 'model', subject),
    marutsuCode: marutsuCode as string | null,
    priceTiers: tiers.map((t) => parseMarutsuPriceTier(t, subject)),
    stockQuantity: p['stockQuantity'] === null ? null : count(p['stockQuantity'], 'stockQuantity', subject),
    stockNote: optionalText(p['stockNote'], 'stockNote', subject),
    shipText: optionalText(p['shipText'], 'shipText', subject),
    qualityRank: optionalText(p['qualityRank'], 'qualityRank', subject),
    minOrderQuantity: p['minOrderQuantity'] === null ? null : positive(p['minOrderQuantity'], 'minOrderQuantity', subject),
    listings: listings as string[],
  };
}
