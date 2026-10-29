/**
 * Identity of a Raspberry Pi Shop by KSY product, shared with the page
 * adapter (no Node APIs). The shop's own product number (商品番号, `pdp.id`)
 * is the identity and the page key; the permalink is the only URL that names
 * a product, because opening one from the list never changes the address.
 */
export const KSY_STORE_ID = 'ksy';
export const KSY_ORIGIN = 'https://raspberry-pi.ksyic.com';

const PRODUCT_ID = /^[1-9]\d{0,8}$/;

export function isKsyProductId(value: string): boolean {
  return PRODUCT_ID.test(value);
}

export function ksyProductUrl(productId: string): string {
  if (!isKsyProductId(productId)) throw new Error(`Invalid KSY product id: ${productId}`);
  return `${KSY_ORIGIN}/main/index/pdp.id/${productId}/pdp.open/${productId}`;
}
