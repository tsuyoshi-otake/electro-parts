import { PIMORONI_STORE } from '../../adapters/pimoroni/identity.ts';
import { shopifyCollector } from '../shopify/collector.ts';

export const pimoroniCollector = shopifyCollector(PIMORONI_STORE);
