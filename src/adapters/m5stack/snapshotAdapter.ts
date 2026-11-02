import { shopifySnapshotAdapter } from '../shopify/snapshotAdapter.ts';
import { M5STACK_STORE } from './identity.ts';

export const m5stackSnapshotAdapter = shopifySnapshotAdapter(M5STACK_STORE);
