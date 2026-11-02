import { M5STACK_STORE } from '../../adapters/m5stack/identity.ts';
import { shopifyCollector } from '../shopify/collector.ts';

export const m5stackCollector = shopifyCollector(M5STACK_STORE);
