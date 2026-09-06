import type { Availability, AvailabilityState } from '../../core/domain.ts';
import type { AkizukiRawStock } from './rawSchema.ts';

/**
 * Maps Akizuki's free-text stock status to the common availability state.
 * `purchasable` is authoritative for buy/no-buy; the text only refines the
 * state. `null` means the layout showed no cart either way, so the badge text
 * is the only evidence and may still resolve to a stocked state.
 * The raw text is always preserved in `rawStatus`.
 */
export function mapAkizukiAvailabilityState(status: string | null, purchasable: boolean | null): AvailabilityState {
  const s = (status ?? '').trim();
  if (s.includes('販売終了')) return 'discontinued';
  if (purchasable === true) {
    if (s.startsWith('在庫僅少')) return 'low_stock';
    if (s.startsWith('在庫あり')) return 'in_stock';
    if (s === '') return 'in_stock';
    return 'in_stock';
  }
  if (purchasable === null) {
    if (s.startsWith('在庫僅少')) return 'low_stock';
    if (s.startsWith('在庫あり')) return 'in_stock';
    if (s === '') return 'unknown';
  }
  if (s.includes('入荷予定')) return 'restocking';
  if (s.includes('入荷未定') || s.includes('納期未定') || s.includes('納期確認中')) return 'out_of_stock';
  if (s === '') return 'unknown';
  return 'out_of_stock';
}

export function normalizeAkizukiAvailability(stock: AkizukiRawStock): Availability {
  const purchasable = typeof stock.purchasable === 'boolean' ? stock.purchasable : null;
  const quantity =
    typeof stock.availableQuantity === 'number' && Number.isSafeInteger(stock.availableQuantity) && stock.availableQuantity >= 0
      ? stock.availableQuantity
      : null;
  return {
    state: mapAkizukiAvailabilityState(stock.status, purchasable),
    purchasable,
    quantity,
    // Akizuki shows the purchasable quantity of the web shop; it is a site
    // reported figure, not a physical inventory count.
    quantitySemantics: quantity === null ? 'unknown' : 'site_reported',
    rawStatus: typeof stock.status === 'string' ? stock.status : null,
  };
}
