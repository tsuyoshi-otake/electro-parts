import type { StorePageAdapter } from '../core/types.ts';
import { akizukiPageAdapter } from './akizuki.ts';
import { m5stackPageAdapter } from './m5stack.ts';
import { switchSciencePageAdapter } from './switch-science.ts';

/**
 * Every supported store page adapter. The build script derives the
 * `@match` header lines from this list, so a store is supported exactly
 * when its adapter is registered here.
 */
export const PAGE_ADAPTERS: readonly StorePageAdapter[] = [akizukiPageAdapter, switchSciencePageAdapter, m5stackPageAdapter];
