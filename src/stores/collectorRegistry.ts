import { akizukiCollector } from '../collectors/akizuki/collector.ts';
import { switchScienceCollector } from '../collectors/switch-science/collector.ts';
import type { StoreCollector } from './collector.ts';

/** Mirror of `registry.ts` for collectors: one entry per store, nothing else. */
const COLLECTORS: readonly StoreCollector[] = [akizukiCollector, switchScienceCollector];

export function getStoreCollector(storeId: string): StoreCollector {
  const c = COLLECTORS.find((x) => x.storeId === storeId);
  if (c === undefined) throw new Error(`no collector for store "${storeId}" (known: ${COLLECTORS.map((x) => x.storeId).join(', ')})`);
  return c;
}
