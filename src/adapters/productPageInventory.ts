import type { Availability } from '../core/domain.ts';

/**
 * The raw-snapshot section that holds the stock counts read from product
 * pages, for a store whose bulk catalogue carries only an in-stock flag
 * (ADR-0027). The collector fills it; the snapshot adapter turns it into
 * quantities. It records what was read and what was not, so a count missing
 * from `quantities` is "not read this run", never "zero".
 */
export interface ProductPageInventoryRaw {
  /** `observationRound` of the run; with `shards` it names the rotation slice read. */
  round: number;
  shards: number;
  shard: number;
  /** Products that could have been read (the store's own eligibility rule). */
  eligible: number;
  /** Products in this run's slice, after the page cap. */
  selected: number;
  /** Product pages fetched and recognised. */
  read: number;
  /** Selected products not read, with the reason; at most `maxFailures + 1`. */
  failures: { key: string; reason: string }[];
  /** Why the stage stopped before the end of its slice, or null. */
  stopped: string | null;
  /**
   * Count shown by the page, by offer (variant) id. `null`: the page was read
   * but gave no usable count for that offer (for example a negative one).
   */
  quantities: Record<string, number | null>;
}

function fail(message: string): never {
  throw new Error(`productPages: ${message}`);
}
function count(v: unknown, field: string, min = 0): number {
  if (!Number.isSafeInteger(v) || (v as number) < min) fail(`${field} must be an integer >= ${min}`);
  return v as number;
}

/** Throws on a section that does not have the shape above. */
export function validateProductPageInventoryRaw(value: unknown): ProductPageInventoryRaw {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected an object');
  const v = value as Record<string, unknown>;
  const shards = count(v['shards'], 'shards', 1);
  const shard = count(v['shard'], 'shard');
  if (shard >= shards) fail('shard must be below shards');
  const selected = count(v['selected'], 'selected');
  const read = count(v['read'], 'read');
  if (selected > count(v['eligible'], 'eligible') || read > selected) fail('read <= selected <= eligible');
  if (!Array.isArray(v['failures'])) fail('failures must be an array');
  for (const f of v['failures']) {
    const r = f as Record<string, unknown> | null;
    if (r === null || typeof r !== 'object' || typeof r['key'] !== 'string' || typeof r['reason'] !== 'string') fail('invalid failure');
  }
  if (v['stopped'] !== null && typeof v['stopped'] !== 'string') fail('stopped must be a string or null');
  const q = v['quantities'];
  if (q === null || typeof q !== 'object' || Array.isArray(q)) fail('quantities must be an object');
  for (const [id, n] of Object.entries(q as Record<string, unknown>)) if (n !== null) count(n, `quantities.${id}`);
  count(v['round'], 'round', Number.MIN_SAFE_INTEGER);
  return value as ProductPageInventoryRaw;
}

/**
 * The availability of one offer with its page count. Without the section (a
 * snapshot from before the store's pages were read) the count is not exposed,
 * as it was then. With it, the count is site-reported:
 * - read with a count → that count;
 * - read without a usable count → no count (the series records "not shown");
 * - not read, and the catalogue says it cannot be bought → no count as well,
 *   because an earlier count held over would contradict the sold-out state;
 * - not read otherwise (outside this run's slice, or the fetch failed) →
 *   unobserved, so the series keeps its last count.
 */
export function withPageQuantity(
  availability: Pick<Availability, 'state' | 'purchasable' | 'rawStatus'>,
  pages: ProductPageInventoryRaw | undefined,
  offerId: string,
): Availability {
  if (pages === undefined) return { ...availability, quantity: null, quantitySemantics: 'not_exposed' };
  if (Object.hasOwn(pages.quantities, offerId)) return { ...availability, quantity: pages.quantities[offerId] ?? null, quantitySemantics: 'site_reported' };
  return availability.purchasable === false
    ? { ...availability, quantity: null, quantitySemantics: 'site_reported' }
    : { ...availability, quantity: null, quantitySemantics: 'site_reported', quantityUnobserved: true };
}
