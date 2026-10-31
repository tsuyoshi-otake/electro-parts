/**
 * Identity of a せんごくネット通販 product, shared with the page adapter (no
 * Node APIs). The shop's management code (管理コード, `detail.php?code=`) is
 * the identity and the page key. Every code seen on 2026-10-30 (120 listing
 * rows) was two groups of four uppercase letters or digits; the pattern
 * allows a little more and rejects anything that could not be a code.
 */
export const SENGOKU_STORE_ID = 'sengoku';
export const SENGOKU_ORIGIN = 'https://www.sengoku.co.jp';

const CODE = /^[0-9A-Z]{1,12}(?:-[0-9A-Z]{1,12}){0,3}$/;

export function isSengokuCode(value: string): boolean {
  return CODE.test(value);
}

export function sengokuProductUrl(code: string): string {
  if (!isSengokuCode(code)) throw new Error(`Invalid Sengoku product code: ${code}`);
  return `${SENGOKU_ORIGIN}/mod/sgk_cart/detail.php?code=${code}`;
}
