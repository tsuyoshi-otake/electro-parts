import { shopifySnapshotAdapter } from '../shopify/snapshotAdapter.ts';
import { PIMORONI_STORE } from './identity.ts';

export const pimoroniSnapshotAdapter = shopifySnapshotAdapter(PIMORONI_STORE);
