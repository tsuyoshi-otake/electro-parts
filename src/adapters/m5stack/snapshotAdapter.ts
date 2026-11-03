import { SHOPIFY_CAPABILITIES, shopifySnapshotAdapter } from '../shopify/snapshotAdapter.ts';
import { M5STACK_STORE } from './identity.ts';

/**
 * The collector reads every product page for its stock count (ADR-0027). The
 * page shows tiers such as 「10+ In Stock」; the count recorded is the one the
 * page carries behind that tier, per variant.
 */
export const m5stackSnapshotAdapter = shopifySnapshotAdapter(M5STACK_STORE, {
  ...SHOPIFY_CAPABILITIES,
  supportsInventoryQuantity: true,
  inventoryQuantitySemantics: 'site_reported',
});
