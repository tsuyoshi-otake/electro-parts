import type { Availability, AvailabilityState } from '../../core/domain.ts';
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

export function normalizeSwitchScienceAvailability(variant: SwitchScienceRawVariant): Availability {
  const available = variant.available === true;
  return {
    state: mapSwitchScienceAvailabilityState(available),
    purchasable: available,
    // The bulk API never carries a quantity. `null` here means "not exposed",
    // never "zero" — the distinction the domain model exists to preserve.
    quantity: null,
    quantitySemantics: 'not_exposed',
    // `rawStatus` is the source's own *status text*, kept so a reader can see
    // what the store said. This source shows no such text: it sends a boolean,
    // which `state` and `purchasable` already carry in full. Echoing it back as
    // the string "available" would only put an English word into the panel
    // beside the label it duplicates.
    rawStatus: null,
  };
}
