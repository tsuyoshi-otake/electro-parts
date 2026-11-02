import type { ShopifyStore } from '../shopify/identity.ts';

/** The M5Stack official shop: its home page shows the unconverted USD base currency. */
export const M5STACK_STORE: ShopifyStore = {
  storeId: 'm5stack', label: 'M5Stack', origin: 'https://shop.m5stack.com', currency: 'USD', currencyEvidence: 'storefront',
};
