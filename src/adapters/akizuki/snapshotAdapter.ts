import type { StoreCapabilities } from '../../core/capabilities.ts';
import {
  DEFAULT_OFFER_ID,
  type NormalizedOffer,
  type NormalizedProduct,
  type NormalizedSnapshot,
  type PriceQuote,
} from '../../core/domain.ts';
import { sha256OfCanonicalJson } from '../../core/hash.ts';
import { isSafeKey } from '../../core/identity.ts';
import { normalizeUtcIso, parseUtcMs } from '../../core/time.ts';
import type { ValidationIssue, ValidationResult } from '../../core/validation.ts';
import type { StoreSnapshotAdapter } from '../../stores/adapter.ts';
import { normalizeAkizukiAvailability } from './availability.ts';
import { AKIZUKI_CAPABILITIES, AKIZUKI_STORE_ID } from './capabilities.ts';
import {
  AKIZUKI_RAW_SCHEMA_VERSION,
  AKIZUKI_SALES_CODE_PATTERN,
  akizukiProductUrl,
  type AkizukiRawItem,
  type AkizukiRawSnapshot,
} from './rawSchema.ts';

/**
 * Akizuki snapshot adapter.
 *
 * Identity assumption (Akizuki-specific, documented in ADR-0003): the sales
 * code ("販売コード") is the product identity, the page key and the URL segment
 * (`/catalog/g/g<salesCode>/`). This mapping lives only here.
 */
const MAX_ISSUES_PER_CODE = 20;

const GENRE_SLUG_PATTERN = /\/catalog\/r\/([a-z0-9]+)\/?$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class IssueCollector {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];
  readonly metrics: Record<string, number> = {};
  private readonly counts = new Map<string, number>();

  error(code: string, message: string, subject?: string): void {
    this.push(this.errors, code, message, subject);
  }

  warn(code: string, message: string, subject?: string): void {
    this.push(this.warnings, code, message, subject);
  }

  private push(list: ValidationIssue[], code: string, message: string, subject?: string): void {
    const n = (this.counts.get(code) ?? 0) + 1;
    this.counts.set(code, n);
    this.metrics[`issue.${code}`] = n;
    if (n <= MAX_ISSUES_PER_CODE) list.push(subject === undefined ? { code, message } : { code, message, subject });
    else if (n === MAX_ISSUES_PER_CODE + 1) list.push({ code, message: `further ${code} issues suppressed` });
  }

  result(): ValidationResult {
    return { errors: this.errors, warnings: this.warnings, metrics: this.metrics };
  }
}

export function validateAkizukiRaw(raw: unknown): ValidationResult {
  const c = new IssueCollector();
  if (!isRecord(raw)) {
    c.error('raw.not_object', 'snapshot is not a JSON object');
    return c.result();
  }
  if (raw['schemaVersion'] !== AKIZUKI_RAW_SCHEMA_VERSION) {
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

  const validation = raw['validation'];
  if (isRecord(validation)) {
    const errors = validation['errors'];
    if (Array.isArray(errors) && errors.length > 0) {
      c.error('raw.collector_errors', `collector reported ${errors.length} error(s): ${String(errors[0])}`);
    }
    if (typeof validation['genreMismatches'] === 'number' && validation['genreMismatches'] > 0) {
      c.error('raw.genre_mismatch', `${validation['genreMismatches']} genre(s) did not match listed totals`);
    }
    const warnings = validation['warnings'];
    if (Array.isArray(warnings)) {
      c.metrics['collectorWarnings'] = warnings.length;
      for (const w of warnings.slice(0, 5)) c.warn('raw.collector_warning', String(w));
    }
  } else {
    c.error('raw.validation_missing', 'validation block missing');
  }

  const genres = raw['genres'];
  if (!Array.isArray(genres) || genres.length === 0) {
    c.error('raw.genres', 'genres missing or empty');
  } else {
    const slugs = new Set<string>();
    genres.forEach((g, i) => {
      if (!isRecord(g)) {
        c.error('raw.genre_shape', `genre[${i}] is not an object`);
        return;
      }
      const slug = genreSlug(g['url']);
      if (slug === null) c.error('raw.genre_url', `genre[${i}] has no recognizable url`, String(g['name']));
      else if (slugs.has(slug)) c.error('raw.genre_duplicate', `genre ${slug} listed twice`, slug);
      else slugs.add(slug);
      if (g['failedPages'] !== 0) c.error('raw.genre_failed_pages', `genre has failed pages`, slug ?? String(i));
      if (g['matchesListedTotal'] !== true) c.error('raw.genre_total_mismatch', `extracted count differs from listed total`, slug ?? String(i));
    });
    c.metrics['genreCount'] = genres.length;
  }

  const items = raw['items'];
  if (!Array.isArray(items)) {
    c.error('raw.items', 'items missing');
    return c.result();
  }
  if (items.length === 0) c.error('raw.items_empty', 'items is empty');
  c.metrics['itemCount'] = items.length;

  const seen = new Set<string>();
  let missingModel = 0;
  let missingCategory = 0;
  let nullQuantity = 0;
  items.forEach((item, i) => {
    if (!isRecord(item)) {
      c.error('item.shape', `items[${i}] is not an object`);
      return;
    }
    const code = item['salesCode'];
    const subject = typeof code === 'string' ? code : `#${i}`;
    if (typeof code !== 'string' || !AKIZUKI_SALES_CODE_PATTERN.test(code)) {
      c.error('item.sales_code', `items[${i}] has an invalid salesCode ${JSON.stringify(code)}`, subject);
      return;
    }
    if (seen.has(code)) c.error('item.duplicate', 'salesCode appears twice', code);
    seen.add(code);
    if (typeof item['name'] !== 'string' || item['name'].trim() === '') c.error('item.name', 'name missing', code);
    if (item['modelNumber'] === null) missingModel += 1;
    else if (typeof item['modelNumber'] !== 'string') c.error('item.model_number', 'modelNumber not a string', code);
    if (item['category'] === null || item['category'] === undefined) missingCategory += 1;
    else if (typeof item['category'] !== 'string') c.error('item.category', 'category not a string', code);
    if (item['url'] !== akizukiProductUrl(code)) c.error('item.url', `url does not match salesCode`, code);

    const prices = item['prices'];
    if (!Array.isArray(prices) || prices.length === 0) {
      c.error('item.prices', 'prices missing or empty', code);
    } else {
      if (prices.length > 1) c.warn('item.multiple_prices', `${prices.length} prices; only the first is used`, code);
      const p = prices[0];
      if (!isRecord(p)) c.error('item.price_shape', 'price is not an object', code);
      else {
        const amount = p['amountYen'];
        if (amount !== null && (!Number.isSafeInteger(amount) || (amount as number) < 0)) {
          c.error('item.price_amount', `amountYen is not a non-negative integer: ${JSON.stringify(amount)}`, code);
        }
        if (amount === 0) c.warn('item.price_zero', 'amountYen is 0', code);
        if (typeof p['quantityUnit'] !== 'string' || p['quantityUnit'] === '') c.error('item.price_unit', 'quantityUnit missing', code);
        if (p['taxIncluded'] !== true) c.error('item.price_tax', 'price is not marked tax included', code);
      }
    }

    const stock = item['stock'];
    if (!isRecord(stock)) {
      c.error('item.stock', 'stock missing', code);
    } else {
      if (typeof stock['purchasable'] !== 'boolean') c.error('item.purchasable', 'purchasable not boolean', code);
      if (typeof stock['status'] !== 'string') c.error('item.status', 'status not a string', code);
      const q = stock['availableQuantity'];
      if (q === null) nullQuantity += 1;
      else if (!Number.isSafeInteger(q) || (q as number) < 0) c.error('item.quantity', `availableQuantity invalid: ${JSON.stringify(q)}`, code);
      else if (stock['purchasable'] === false && (q as number) > 0) c.warn('item.quantity_not_purchasable', 'quantity > 0 but not purchasable', code);
    }
  });
  c.metrics['missingModelNumber'] = missingModel;
  c.metrics['missingCategory'] = missingCategory;
  c.metrics['nullQuantity'] = nullQuantity;
  if (typeof raw['extractedTotal'] === 'number' && raw['extractedTotal'] !== items.length) {
    c.error('raw.extracted_total', `extractedTotal ${raw['extractedTotal']} != items.length ${items.length}`);
  }
  return c.result();
}

function genreSlug(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = GENRE_SLUG_PATTERN.exec(url);
  return m?.[1]?.toLowerCase() ?? null;
}

/** Coverage id: sorted genre slugs joined by `+`, e.g. `rai+rbatt+...`. */
export function akizukiCoverageId(raw: AkizukiRawSnapshot): string {
  const slugs = raw.genres.map((g) => genreSlug(g.url)).filter((s): s is string => s !== null);
  return [...new Set(slugs)].sort().join('+');
}

export function normalizeAkizukiItem(item: AkizukiRawItem): NormalizedProduct {
  const price = item.prices[0];
  const quote: PriceQuote =
    price === undefined || price.amountYen === null
      ? {
          quoteKind: 'selling',
          taxTreatment: 'tax_included',
          currency: 'JPY',
          state: 'unavailable',
          minAmountMinor: null,
          maxAmountMinor: null,
          unitLabel: price?.quantityUnit ?? null,
        }
      : {
          quoteKind: 'selling',
          taxTreatment: price.taxIncluded ? 'tax_included' : 'tax_excluded',
          currency: 'JPY',
          state: 'exact',
          minAmountMinor: price.amountYen,
          maxAmountMinor: price.amountYen,
          unitLabel: price.quantityUnit,
        };
  const offer: NormalizedOffer = {
    externalOfferId: DEFAULT_OFFER_ID,
    offerKind: 'default',
    sku: null,
    variantName: null,
    priceQuotes: [quote],
    availability: normalizeAkizukiAvailability(item.stock),
  };
  return {
    externalProductId: item.salesCode,
    pageKey: item.salesCode,
    aliases: [{ kind: 'salesCode', value: item.salesCode }],
    metadata: {
      name: item.name.trim(),
      modelNumber: item.modelNumber === null ? null : item.modelNumber.trim() || null,
      category: item.category === null || item.category === undefined ? null : item.category.trim() || null,
      canonicalUrl: akizukiProductUrl(item.salesCode),
    },
    offers: [offer],
  };
}

export function normalizeAkizukiRaw(raw: AkizukiRawSnapshot, rawSha256: string): NormalizedSnapshot {
  const products = raw.items
    .map(normalizeAkizukiItem)
    .sort((a, b) => (a.externalProductId < b.externalProductId ? -1 : a.externalProductId > b.externalProductId ? 1 : 0));
  const observedAt = normalizeUtcIso(raw.retrievedAt);
  const coverageId = akizukiCoverageId(raw);
  const body = {
    storeId: AKIZUKI_STORE_ID,
    observedAt,
    sourceSchemaVersion: String(raw.schemaVersion),
    complete: raw.complete,
    coverageId,
    products,
  };
  return { ...body, rawSha256, normalizedHash: sha256OfCanonicalJson(body) };
}

export const akizukiSnapshotAdapter: StoreSnapshotAdapter = {
  storeId: AKIZUKI_STORE_ID,
  capabilities: AKIZUKI_CAPABILITIES satisfies StoreCapabilities,
  validateRaw: validateAkizukiRaw,
  normalize(raw: unknown, rawSha256: string): NormalizedSnapshot {
    const v = validateAkizukiRaw(raw);
    if (v.errors.length > 0) {
      throw new Error(`akizuki snapshot rejected: ${v.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`);
    }
    return normalizeAkizukiRaw(raw as AkizukiRawSnapshot, rawSha256);
  },
  isValidPageKey(pageKey: string): boolean {
    return AKIZUKI_SALES_CODE_PATTERN.test(pageKey) && isSafeKey(pageKey);
  },
  productUrlForPageKey(pageKey: string): string | null {
    return this.isValidPageKey(pageKey) ? akizukiProductUrl(pageKey) : null;
  },
};
