import type { StoreCapabilities } from '../../core/capabilities.ts';
import {
  type NormalizedOffer,
  type NormalizedProduct,
  type NormalizedSnapshot,
  type PriceQuote,
  type ProductAlias,
} from '../../core/domain.ts';
import { sha256OfCanonicalJson } from '../../core/hash.ts';
import { isSafeKey } from '../../core/identity.ts';
import { normalizeUtcIso, parseUtcMs } from '../../core/time.ts';
import { IssueCollector, type ValidationResult } from '../../core/validation.ts';
import type { StoreSnapshotAdapter } from '../../stores/adapter.ts';
import { normalizeSwitchScienceAvailability } from './availability.ts';
import { SWITCH_SCIENCE_CAPABILITIES, SWITCH_SCIENCE_STORE_ID } from './capabilities.ts';
import {
  SWITCH_SCIENCE_HANDLE_PATTERN,
  SWITCH_SCIENCE_SUPPORTED_RAW_SCHEMA_VERSIONS,
  switchScienceProductUrl,
  type SwitchScienceRawItem,
  type SwitchScienceRawSnapshot,
  type SwitchScienceRawVariant,
} from './rawSchema.ts';

/**
 * Switch Science snapshot adapter.
 *
 * Identity assumption (documented in ADR-0015): the Shopify *handle* is the
 * product identity, the page key and the URL segment
 * (`/products/<handle>`, verified against the page's own canonical link). The
 * numeric product id and the SKU are recorded as aliases, because neither of
 * them appears in the URL the userscript reads.
 *
 * Offers map one-to-one onto Shopify variants and are keyed by the variant id.
 * Today every product has exactly one variant, which would make
 * `DEFAULT_OFFER_ID` tempting — but then the day a product gains a second
 * variant is the day its single offer disappears and its history restarts. The
 * variant id costs nothing now and keeps that history intact.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isValidSwitchScienceHandle(handle: string): boolean {
  return SWITCH_SCIENCE_HANDLE_PATTERN.test(handle) && isSafeKey(handle);
}

export function validateSwitchScienceRaw(raw: unknown): ValidationResult {
  const c = new IssueCollector();
  if (!isRecord(raw)) {
    c.error('raw.not_object', 'snapshot is not a JSON object');
    return c.result();
  }
  if (
    typeof raw['schemaVersion'] !== 'number' ||
    !SWITCH_SCIENCE_SUPPORTED_RAW_SCHEMA_VERSIONS.includes(raw['schemaVersion'])
  ) {
    c.error('raw.schema_version', `unsupported schemaVersion ${JSON.stringify(raw['schemaVersion'])}`);
    return c.result();
  }
  if (typeof raw['retrievedAt'] !== 'string') {
    c.error('raw.retrieved_at', 'retrievedAt missing');
  } else {
    try {
      parseUtcMs(raw['retrievedAt']);
    } catch (e) {
      c.error('raw.retrieved_at', (e as Error).message);
    }
  }
  if (raw['complete'] !== true) c.error('raw.incomplete', 'snapshot is not marked complete');
  if (typeof raw['collection'] !== 'string' || raw['collection'] === '') {
    c.error('raw.collection', 'collection missing');
  }

  const validation = raw['validation'];
  if (isRecord(validation)) {
    const errors = validation['errors'];
    if (Array.isArray(errors) && errors.length > 0) {
      c.error('raw.collector_errors', `collector reported ${errors.length} error(s): ${String(errors[0])}`);
    }
    const warnings = validation['warnings'];
    if (Array.isArray(warnings)) {
      c.metrics['collectorWarnings'] = warnings.length;
      for (const w of warnings.slice(0, 5)) c.warn('raw.collector_warning', String(w));
    }
  } else {
    c.error('raw.validation_missing', 'validation block missing');
  }

  const catalog = raw['catalog'];
  if (isRecord(catalog)) {
    const productTotal = catalog['productTotal'];
    const uncovered = catalog['uncovered'];
    if (typeof productTotal !== 'number' || productTotal <= 0) {
      c.error('raw.catalog_total', 'catalog.productTotal missing or not positive');
    } else {
      c.metrics['catalogProductTotal'] = productTotal;
    }
    if (typeof uncovered !== 'number' || uncovered < 0) c.error('raw.catalog_uncovered', 'catalog.uncovered missing');
    else {
      c.metrics['catalogUncovered'] = uncovered;
      // The sitemap and the collection API are two views of the same catalogue
      // that the store updates independently, so a small gap is lag rather than
      // loss. The collector caps it; here it is only reported.
      if (uncovered > 0) c.warn('raw.catalog_gap', `${uncovered} catalogue product(s) the collection API never returned`);
    }
    if (typeof catalog['unlisted'] === 'number') c.metrics['catalogUnlisted'] = catalog['unlisted'];
  } else {
    c.error('raw.catalog_missing', 'catalog block missing');
  }

  const items = raw['items'];
  if (!Array.isArray(items)) {
    c.error('raw.items', 'items missing');
    return c.result();
  }
  if (items.length === 0) c.error('raw.items_empty', 'items is empty');
  c.metrics['itemCount'] = items.length;

  const seen = new Set<string>();
  let missingSku = 0;
  let unparsablePrice = 0;
  let multiVariant = 0;
  let variantTotal = 0;
  items.forEach((item, i) => {
    if (!isRecord(item)) {
      c.error('item.shape', `items[${i}] is not an object`);
      return;
    }
    const handle = item['handle'];
    const subject = typeof handle === 'string' ? handle : `#${i}`;
    if (typeof handle !== 'string' || !isValidSwitchScienceHandle(handle)) {
      c.error('item.handle', `items[${i}] has an unusable handle ${JSON.stringify(handle)}`, subject);
      return;
    }
    if (seen.has(handle)) c.error('item.duplicate', 'handle appears twice', handle);
    seen.add(handle);
    if (!Number.isSafeInteger(item['productId'])) c.error('item.product_id', 'productId is not an integer', handle);
    if (typeof item['title'] !== 'string' || item['title'].trim() === '') c.error('item.title', 'title missing', handle);
    if (item['url'] !== switchScienceProductUrl(handle)) c.error('item.url', 'url does not match handle', handle);

    const variants = item['variants'];
    if (!Array.isArray(variants) || variants.length === 0) {
      c.error('item.variants', 'variants missing or empty', handle);
      return;
    }
    if (variants.length > 1) multiVariant += 1;
    variantTotal += variants.length;
    const variantIds = new Set<number>();
    variants.forEach((variant, vi) => {
      if (!isRecord(variant)) {
        c.error('variant.shape', `items[${i}].variants[${vi}] is not an object`, handle);
        return;
      }
      const id = variant['variantId'];
      if (!Number.isSafeInteger(id)) c.error('variant.id', 'variantId is not an integer', handle);
      else if (variantIds.has(id as number)) c.error('variant.duplicate', `variantId ${String(id)} appears twice`, handle);
      else variantIds.add(id as number);
      if (typeof variant['available'] !== 'boolean') c.error('variant.available', 'available is not a boolean', handle);
      if (typeof variant['priceRaw'] !== 'string') c.error('variant.price_raw', 'priceRaw is not a string', handle);
      if (variant['sku'] === null || variant['sku'] === '') missingSku += 1;
      else if (typeof variant['sku'] !== 'string') c.error('variant.sku', 'sku is not a string or null', handle);

      const price = variant['priceYen'];
      if (price === null) {
        // Not an error: one unrepresentable price becomes an unavailable quote
        // rather than quarantining the store. A *systemic* parse failure turns
        // every quote unavailable and trips the sanity ratio instead.
        unparsablePrice += 1;
        c.warn('variant.price_unparsable', `price ${JSON.stringify(variant['priceRaw'])} is not an exact yen amount`, handle);
      } else if (!Number.isSafeInteger(price) || (price as number) < 0) {
        c.error('variant.price', `priceYen is not a non-negative integer: ${JSON.stringify(price)}`, handle);
      } else if (price === 0) {
        c.warn('variant.price_zero', 'priceYen is 0', handle);
      }

      const compare = variant['compareAtPriceYen'];
      if (compare !== null && compare !== undefined) {
        if (!Number.isSafeInteger(compare) || (compare as number) < 0) {
          c.error('variant.compare_at', `compareAtPriceYen is not a non-negative integer: ${JSON.stringify(compare)}`, handle);
        } else if (typeof price === 'number' && (compare as number) < price) {
          // A compare-at below the selling price is not a discount; recording it
          // as one would invent a saving that never existed.
          c.warn('variant.compare_at_below_price', 'compareAtPriceYen is below priceYen', handle);
        }
      }
    });
  });
  c.metrics['variantCount'] = variantTotal;
  c.metrics['missingSku'] = missingSku;
  c.metrics['unparsablePrice'] = unparsablePrice;
  c.metrics['multiVariant'] = multiVariant;
  if (typeof raw['extractedTotal'] === 'number' && raw['extractedTotal'] !== items.length) {
    c.error('raw.extracted_total', `extractedTotal ${raw['extractedTotal']} != items.length ${items.length}`);
  }
  return c.result();
}

/**
 * Coverage id: what the run claims to have observed. The collection walked is
 * the whole of it — `all` is every published product — so a future run narrowed
 * to one collection reads as a coverage change instead of a catalogue collapse.
 */
export function switchScienceCoverageId(raw: SwitchScienceRawSnapshot): string {
  return `shopify:collections/${raw.collection}`;
}

function normalizeVariant(variant: SwitchScienceRawVariant): NormalizedOffer {
  const quotes: PriceQuote[] = [
    variant.priceYen === null
      ? {
          quoteKind: 'selling',
          taxTreatment: 'tax_included',
          currency: 'JPY',
          state: 'unavailable',
          minAmountMinor: null,
          maxAmountMinor: null,
          // Shopify prices a variant, not a package: the source states no unit,
          // so none is invented.
          unitLabel: null,
        }
      : {
          quoteKind: 'selling',
          // Verified against the storefront on 2026-09-07: handle 9381 shows
          // "¥165（税込）" for the API's `price: "165"`.
          taxTreatment: 'tax_included',
          currency: 'JPY',
          state: 'exact',
          minAmountMinor: variant.priceYen,
          maxAmountMinor: variant.priceYen,
          unitLabel: null,
        },
  ];
  if (variant.compareAtPriceYen !== null) {
    quotes.push({
      quoteKind: 'compare_at',
      taxTreatment: 'tax_included',
      currency: 'JPY',
      state: 'exact',
      minAmountMinor: variant.compareAtPriceYen,
      maxAmountMinor: variant.compareAtPriceYen,
      unitLabel: null,
    });
  }
  const sku = typeof variant.sku === 'string' && variant.sku.trim() !== '' ? variant.sku.trim() : null;
  // "Default Title" is Shopify's placeholder for a product with no options; it
  // names nothing, so it is not carried into the domain as a variant name.
  const title = typeof variant.title === 'string' ? variant.title.trim() : '';
  return {
    externalOfferId: String(variant.variantId),
    offerKind: 'variant',
    sku,
    variantName: title === '' || title === 'Default Title' ? null : title,
    priceQuotes: quotes,
    availability: normalizeSwitchScienceAvailability(variant),
  };
}

export function normalizeSwitchScienceItem(item: SwitchScienceRawItem): NormalizedProduct {
  const variants = [...item.variants].sort((a, b) => a.position - b.position || a.variantId - b.variantId);
  const aliases: ProductAlias[] = [
    { kind: 'handle', value: item.handle },
    { kind: 'shopifyProductId', value: String(item.productId) },
  ];
  for (const variant of variants) {
    const sku = typeof variant.sku === 'string' ? variant.sku.trim() : '';
    if (sku !== '' && !aliases.some((a) => a.kind === 'sku' && a.value === sku)) aliases.push({ kind: 'sku', value: sku });
  }
  const productType = typeof item.productType === 'string' ? item.productType.trim() : '';
  const firstSku = aliases.find((a) => a.kind === 'sku')?.value ?? null;
  return {
    externalProductId: item.handle,
    pageKey: item.handle,
    aliases,
    metadata: {
      name: item.title.trim(),
      // Switch Science's SKU is the closest thing the catalogue has to a model
      // number; the vendor's own part number is only in the description text,
      // which is not evidence this crawler collects.
      modelNumber: firstSku,
      category: productType === '' ? null : productType,
      canonicalUrl: switchScienceProductUrl(item.handle),
    },
    offers: variants.map(normalizeVariant),
  };
}

export function normalizeSwitchScienceRaw(raw: SwitchScienceRawSnapshot, rawSha256: string): NormalizedSnapshot {
  const products = raw.items
    .map(normalizeSwitchScienceItem)
    .sort((a, b) => (a.externalProductId < b.externalProductId ? -1 : a.externalProductId > b.externalProductId ? 1 : 0));
  const body = {
    storeId: SWITCH_SCIENCE_STORE_ID,
    observedAt: normalizeUtcIso(raw.retrievedAt),
    sourceSchemaVersion: String(raw.schemaVersion),
    complete: raw.complete,
    coverageId: switchScienceCoverageId(raw),
    products,
  };
  return { ...body, rawSha256, normalizedHash: sha256OfCanonicalJson(body) };
}

export const switchScienceSnapshotAdapter: StoreSnapshotAdapter = {
  storeId: SWITCH_SCIENCE_STORE_ID,
  capabilities: SWITCH_SCIENCE_CAPABILITIES satisfies StoreCapabilities,
  validateRaw: validateSwitchScienceRaw,
  normalize(raw: unknown, rawSha256: string): NormalizedSnapshot {
    const v = validateSwitchScienceRaw(raw);
    if (v.errors.length > 0) {
      throw new Error(`switch-science snapshot rejected: ${v.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`);
    }
    return normalizeSwitchScienceRaw(raw as SwitchScienceRawSnapshot, rawSha256);
  },
  isValidPageKey(pageKey: string): boolean {
    return isValidSwitchScienceHandle(pageKey);
  },
  productUrlForPageKey(pageKey: string): string | null {
    return this.isValidPageKey(pageKey) ? switchScienceProductUrl(pageKey) : null;
  },
};
