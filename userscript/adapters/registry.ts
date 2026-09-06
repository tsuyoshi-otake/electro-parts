import type { StorePageAdapter } from '../core/types.ts';
import { akizukiPageAdapter } from './akizuki.ts';

/**
 * Every supported store page adapter. The build script derives the
 * `@match` header lines from this list, so a store is supported exactly
 * when its adapter is registered here. Phase 1: Akizuki only.
 */
export const PAGE_ADAPTERS: readonly StorePageAdapter[] = [akizukiPageAdapter];
