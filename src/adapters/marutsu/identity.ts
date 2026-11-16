/**
 * Identity of a マルツオンライン product, shared with the page adapter (no
 * Node APIs). The product page address (`/pc/i/<id>/`) names the product:
 * the numeric id in it is the identity and the page key. The shop also
 * prints a マルツコード (`M0004-0938`) on the product page and, on the
 * current listings, in the listing rows; it is kept as an alias, never as
 * the identity, because the older saved listings do not print it.
 */
export const MARUTSU_STORE_ID = 'marutsu';
export const MARUTSU_ORIGIN = 'https://www.marutsu.co.jp';

const PAGE_ID = /^\d{1,10}$/;

export function isMarutsuPageId(value: string): boolean {
  return PAGE_ID.test(value);
}

const MARUTSU_CODE = /^M\d{4}-\d{4}$/;

export function isMarutsuCode(value: string): boolean {
  return MARUTSU_CODE.test(value);
}

export function marutsuProductUrl(pageId: string): string {
  if (!isMarutsuPageId(pageId)) throw new Error(`Invalid Marutsu page id: ${pageId}`);
  return `${MARUTSU_ORIGIN}/pc/i/${pageId}/`;
}
