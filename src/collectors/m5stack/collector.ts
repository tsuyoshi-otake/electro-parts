import { M5STACK_STORE } from '../../adapters/m5stack/identity.ts';
import { shopifyCollector } from '../shopify/collector.ts';
import { readM5StackProductPage } from './productPage.ts';

export const m5stackCollector = shopifyCollector(M5STACK_STORE, readM5StackProductPage);
