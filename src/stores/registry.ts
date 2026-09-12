import { akizukiSnapshotAdapter } from '../adapters/akizuki/snapshotAdapter.ts';
import { m5stackSnapshotAdapter } from '../adapters/m5stack/snapshotAdapter.ts';
import { switchScienceSnapshotAdapter } from '../adapters/switch-science/snapshotAdapter.ts';
import type { StoreId } from '../core/domain.ts';
import type { StoreSnapshotAdapter } from './adapter.ts';

/**
 * The only place that enumerates concrete stores. Adding a store is one entry
 * here and one in `collectorRegistry.ts`; nothing in the core changes.
 */
const ADAPTERS: readonly StoreSnapshotAdapter[] = [akizukiSnapshotAdapter, switchScienceSnapshotAdapter, m5stackSnapshotAdapter];

export function listStoreIds(): StoreId[] {
  return ADAPTERS.map((a) => a.storeId);
}

export function getStoreAdapter(storeId: string): StoreSnapshotAdapter {
  const adapter = ADAPTERS.find((a) => a.storeId === storeId);
  if (adapter === undefined) {
    throw new Error(`unknown store "${storeId}" (known: ${listStoreIds().join(', ')})`);
  }
  return adapter;
}
