import { isSengokuCode } from './identity.ts';

/**
 * Raw schema of a せんごくネット通販 snapshot (ADR-0024).
 *
 * The rows of the category listings (`search.php?cid=`) under 電子工作部品,
 * reduced to facts: the management code, name, maker, model (the image's
 * alt text), the tax-included price lines and the stock mark. Descriptions
 * and image addresses are never part of it.
 */

/** 電子工作部品, the only category collected. */
export const SENGOKU_ROOT_CID = 3000;
/** Rows per listing page. */
export const SENGOKU_PAGE_SIZE = 40;
/** A search returns at most this many products; a listing that reports it is cut off. */
export const SENGOKU_SEARCH_CAP = 4000;
/** The only stock mark the listings showed on 2026-10-30. */
export const SENGOKU_OUT_OF_STOCK_MARK = '欠品中';
/** A price line that asks for a quote instead of giving a price. */
export const SENGOKU_QUOTE_LABEL = '価格お見積り';

/**
 * One line of a row's price cell. A cell lists the ways the product is sold,
 * in the shop's order: quantity breaks (【数量1個〜】単価, 【数量100個〜】単価),
 * packs (【数量1組〜】10個入1組, 【数量1組〜】5000個入1リール), lines without a
 * quantity (特価, 5枚綴り, 1リール) and quote requests (【数量1個〜】価格お見積り).
 * They are not one ascending scale.
 */
export interface SengokuPriceLine {
  /** 【数量N…〜】: the smallest quantity this price applies from; null when the line shows none. */
  minQuantity: number | null;
  /** The unit of that quantity as shown: 個, 本, 組, 箱; null with `minQuantity`. */
  quantityUnit: string | null;
  /** The price basis as shown: 単価, 1本単価, 5個1組, 2本入1袋, 特価, 5枚綴り, 価格お見積り. */
  label: string;
  /** Tax-included yen; null exactly when the label is 価格お見積り. */
  amountYen: number | null;
}

export interface SengokuItem {
  code: string;
  name: string;
  /** The maker line above the name; null when the row has none. */
  maker: string | null;
  /** The product image's alt text; null when empty. */
  model: string | null;
  /** In the shop's order; empty when the row's price block is empty. */
  priceLines: SengokuPriceLine[];
  /** The image link carries `class="outofstock"`. */
  outOfStockClass: boolean;
  /** Text of the detail cell besides the detail button, such as 欠品中; null when none. */
  stockMark: string | null;
  /** The listings (cid) the product appeared in, ascending. */
  listings: number[];
}

export interface SengokuListing {
  cid: number;
  name: string;
  /** The listing's own total, T in 「S件～E件(全T件)」, below the cap. */
  listedTotal: number;
  pageCount: number;
}

export interface SengokuSnapshot {
  schemaVersion: 1;
  retrievedAt: string;
  complete: boolean;
  rootCid: number;
  /** Listings read in full, in reading order. */
  listings: SengokuListing[];
  /** Listings that reported the cap and were read through their subcategories instead. */
  splitListings: number[];
  items: SengokuItem[];
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

/** 【数量0個〜】 occurs (three products on 2026-10-30), so a quantity may be 0. */
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

function quoteAmount(value: unknown, subject: string): null {
  if (value !== null) throw new Error(`${subject}: a ${SENGOKU_QUOTE_LABEL} line has an amount`);
  return null;
}

export function parseSengokuPriceLine(value: unknown, subject: string): SengokuPriceLine {
  const t = record(value, `${subject} price line`);
  if ((t['minQuantity'] === null) !== (t['quantityUnit'] === null)) throw new Error(`${subject}: a price line has a quantity without its unit or a unit without its quantity`);
  return {
    minQuantity: t['minQuantity'] === null ? null : count(t['minQuantity'], 'minQuantity', subject),
    quantityUnit: optionalText(t['quantityUnit'], 'quantityUnit', subject),
    label: text(t['label'], 'label', subject),
    amountYen: t['label'] === SENGOKU_QUOTE_LABEL ? quoteAmount(t['amountYen'], subject) : positive(t['amountYen'], 'amountYen', subject),
  };
}

/** Validates one stored item. */
export function parseSengokuItem(value: unknown): SengokuItem {
  const p = record(value, 'item');
  const code = p['code'];
  if (typeof code !== 'string' || !isSengokuCode(code)) throw new Error(`invalid product code ${JSON.stringify(code)}`);
  const subject = `product ${code}`;
  const lines = p['priceLines'];
  if (!Array.isArray(lines)) throw new Error(`${subject}: priceLines missing`);
  const priceLines = lines.map((t) => parseSengokuPriceLine(t, subject));
  if (typeof p['outOfStockClass'] !== 'boolean') throw new Error(`${subject}: outOfStockClass is not a boolean`);
  const listings = p['listings'];
  if (!Array.isArray(listings) || listings.length === 0) throw new Error(`${subject}: listings missing`);
  listings.forEach((cid, i) => {
    positive(cid, 'listing', subject);
    if (i > 0 && (cid as number) <= (listings[i - 1] as number)) throw new Error(`${subject}: listings are not ascending and unique`);
  });
  return {
    code,
    name: text(p['name'], 'name', subject),
    maker: optionalText(p['maker'], 'maker', subject),
    model: optionalText(p['model'], 'model', subject),
    priceLines,
    outOfStockClass: p['outOfStockClass'],
    stockMark: optionalText(p['stockMark'], 'stockMark', subject),
    listings: listings as number[],
  };
}
