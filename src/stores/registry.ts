import { akizukiSnapshotAdapter } from '../adapters/akizuki/snapshotAdapter.ts';
import type { StoreId } from '../core/domain.ts';
import type { StoreSnapshotAdapter } from './adapter.ts';

/**
 * The only place that enumerates concrete stores. Phase 1 registers Akizuki
 * alone; Phase 2/3 add one entry each without touching the core.
 */
const ADAPTERS: readonly StoreSnapshotAdapter[] = [akizukiSnapshotAdapter];

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
