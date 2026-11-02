import type { ShopifyStore } from '../shopify/identity.ts';

/**
 * Pimoroni: the root catalogue is in the GBP base currency, but HTML pages
 * redirect visitors to a market by location (Japan to `/en-jp`, in JPY), so
 * the home page proves nothing. `/meta.json` names the base currency.
 */
export const PIMORONI_STORE: ShopifyStore = {
  storeId: 'pimoroni', label: 'Pimoroni', origin: 'https://shop.pimoroni.com', currency: 'GBP', currencyEvidence: 'meta',
};
