/**
 * Properties of the Shopify money parser and of the handle identity it feeds.
 *
 * A price that enters the history wrong is worse than one that is missing: a
 * rounded yen amount becomes a change point the store never made. So the
 * parser's contract is exactness, and these properties test it from both
 * directions — every representable amount round-trips through every decimal
 * spelling the API might use, and nothing else is ever accepted.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isValidSwitchScienceHandle } from '../../src/adapters/switch-science/snapshotAdapter.ts';
import { parseShopifyYen, switchScienceProductUrl, SWITCH_SCIENCE_PRODUCT_URL_PREFIX } from '../../src/adapters/switch-science/rawSchema.ts';
import { handleFromProductUrl } from '../../src/collectors/switch-science/sitemap.ts';
import { isSafeKey } from '../../src/core/identity.ts';

const seed = Number(process.env['FC_SEED'] ?? 20260907);
const numRuns = Number(process.env['FC_RUNS'] ?? 300);
const opts = { seed, numRuns } as const;

/** Yen amounts the store can express: a non-negative integer of at most 12 digits. */
const yenArb = fc.integer({ min: 0, max: 999_999_999_999 });
/** The decimal spellings of an exact amount: `1100`, `1100.0`, `1100.000000`. */
const zeroFractionArb = fc.string({ unit: fc.constant('0'), minLength: 1, maxLength: 8 });

describe('parseShopifyYen', () => {
  it('reads every exact amount back, however many trailing zeros the API sends', () => {
    fc.assert(
      fc.property(yenArb, fc.option(zeroFractionArb, { nil: null }), (yen, zeros) => {
        const text = zeros === null ? String(yen) : `${yen}.${zeros}`;
        expect(parseShopifyYen(text)).toBe(yen);
      }),
      opts,
    );
  });

  it('rejects anything with a real fraction rather than rounding it into the history', () => {
    fc.assert(
      fc.property(yenArb, fc.integer({ min: 1, max: 999_999 }), (yen, fraction) => {
        // A fraction with at least one non-zero digit is not a yen amount.
        expect(parseShopifyYen(`${yen}.${fraction}`)).toBeNull();
      }),
      opts,
    );
  });

  it('accepts a string only when it is exactly the decimal form of the number it returns', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), (s) => {
        const parsed = parseShopifyYen(s);
        if (parsed === null) return;
        expect(Number.isSafeInteger(parsed) && parsed >= 0).toBe(true);
        // Whatever spelling arrived, the value is the number the digits say.
        expect(Number(s.trim())).toBe(parsed);
      }),
      opts,
    );
  });

  it('never invents an amount from a value that is not a number or a numeric string', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(null, undefined, true, false, Number.NaN, Infinity, -Infinity, -1, 1.5, '', ' ', 'お問い合わせ', '¥165', '1,650', '1e3'),
          fc.array(fc.anything(), { maxLength: 3 }),
          fc.object({ maxDepth: 1 }),
        ),
        (v) => {
          expect(parseShopifyYen(v)).toBeNull();
        },
      ),
      opts,
    );
  });

  it('takes a safe integer from a number, and only a safe non-negative one', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(parseShopifyYen(n)).toBe(n >= 0 ? n : null);
      }),
      opts,
    );
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isSafeInteger(d)), (d) => {
        expect(parseShopifyYen(d)).toBeNull();
      }),
      opts,
    );
  });
});

describe('Switch Science handle identity', () => {
  /** Handles the store's URLs can carry — the pattern's own alphabet. */
  const handleArb = fc
    .stringMatching(/^[a-z0-9][a-z0-9._-]{0,63}$/)
    .filter((h) => h.length <= 64 && isValidSwitchScienceHandle(h));

  it('survives the round trip through the product URL the store publishes', () => {
    fc.assert(
      fc.property(handleArb, (handle) => {
        const url = switchScienceProductUrl(handle);
        expect(url.startsWith(SWITCH_SCIENCE_PRODUCT_URL_PREFIX)).toBe(true);
        expect(handleFromProductUrl(url)).toBe(handle);
        // The URL a browser normalises with a trailing slash is the same product.
        expect(handleFromProductUrl(`${url}/`)).toBe(handle);
      }),
      opts,
    );
  });

  it('accepts only handles that are safe to use as a file name and a cache key', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (s) => {
        if (!isValidSwitchScienceHandle(s)) return;
        expect(isSafeKey(s)).toBe(true);
        expect(s).toBe(encodeURIComponent(s));
        expect(s.includes('/')).toBe(false);
        expect(s.startsWith('.')).toBe(false);
      }),
      opts,
    );
  });

  it('never reads a handle out of a URL that is not a product page on this store', () => {
    fc.assert(
      fc.property(
        handleArb,
        fc.constantFrom('collections', 'blogs/products', 'pages', 'products/extra', 'cart'),
        (handle, path) => {
          expect(handleFromProductUrl(`https://www.switch-science.com/${path}/${handle}`)).toBeNull();
        },
      ),
      opts,
    );
  });
});
