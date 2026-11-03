import type { Availability, AvailabilityState } from '../../core/domain.ts';
import { withPageQuantity, type ProductPageInventoryRaw } from '../productPageInventory.ts';
import type { SwitchScienceRawVariant } from './rawSchema.ts';

/**
 * Switch Science's bulk catalogue API exposes stock as a single boolean per
 * variant, so the mapping is total and lossless in one direction: `true` means
 * the variant can be bought right now, `false` means it cannot.
 *
 * That boolean says nothing about *why* — a discontinued part, a part awaiting
 * restock and a part that sold out an hour ago are all `false`. Guessing
 * between them from the title would invent a distinction the source never made,
 * so everything unavailable maps to `out_of_stock`. 43.8 % of the catalogue
 * sits on that side (measured 2026-08-02), which is why unavailability here is
 * normal rather than an anomaly.
 */
export function mapSwitchScienceAvailabilityState(available: boolean): AvailabilityState {
  return available ? 'in_stock' : 'out_of_stock';
}

/**
 * The count is the one the product page showed, when this run read it
 * (ADR-0027). A snapshot from before the pages were read has none: `null` there
 * means "not exposed", never "zero".
 */
export function normalizeSwitchScienceAvailability(variant: SwitchScienceRawVariant, pages?: ProductPageInventoryRaw): Availability {
  const available = variant.available === true;
  return withPageQuantity(
    {
      state: mapSwitchScienceAvailabilityState(available),
      purchasable: available,
      // `rawStatus` is the source's own *status text*, kept so a reader can see
      // what the store said. This source shows no such text: it sends a boolean,
      // which `state` and `purchasable` already carry in full. Echoing it back as
      // the string "available" would only put an English word into the panel
      // beside the label it duplicates.
      rawStatus: null,
    },
    pages,
    String(variant.variantId),
  );
}
