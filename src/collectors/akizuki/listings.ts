/**
 * Akizuki listing pages — the pages that show many products at once, with
 * price and stock, so the crawler does not have to open 13,000 product pages.
 *
 * There are two families:
 *   `/catalog/c/<slug>/`  the category tree shown in the site navigation
 *   `/catalog/r/<slug>/`  genre tags, a cross-cutting second taxonomy
 *
 * Which ones exist is not knowledge this file holds: `sitemap.ts` reads them
 * from the site's own sitemap. Hard-coding a list is what caused products such
 * as 131975 to be missed for months — a listing nobody wrote down is a
 * listing that is never crawled.
 */
export const AKIZUKI_BASE_URL = 'https://akizukidenshi.com';

export type ListingKind = 'c' | 'r';

/**
 * Slugs are lowercase alphanumerics, sometimes with `_` or a trailing `-`
 * (`ckit-` and `clcd-` are real categories, distinct from `ckit` and `clcd`).
 */
export const AKIZUKI_LISTING_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/;

/** Any single listing stops at 3,000 results (50 pages x 60); no page-size parameter lifts it. */
export const AKIZUKI_LISTING_RESULT_CAP = 3000;
export const AKIZUKI_LISTING_PAGE_CAP = 50;

export interface ListingRef {
  kind: ListingKind;
  slug: string;
}

export function listingId(ref: ListingRef): string {
  return `${ref.kind}/${ref.slug}`;
}

export function akizukiListingUrl(baseUrl: string, ref: ListingRef, page = 1): string {
  if (!AKIZUKI_LISTING_SLUG_PATTERN.test(ref.slug)) throw new Error(`invalid listing slug ${ref.slug}`);
  if (ref.kind !== 'c' && ref.kind !== 'r') throw new Error(`invalid listing kind ${ref.kind}`);
  if (!Number.isInteger(page) || page < 1) throw new Error(`invalid page ${page}`);
  const base = `${baseUrl}/catalog/${ref.kind}/${ref.slug}`;
  return page === 1 ? `${base}/` : `${base}_p${page}/`;
}

const LISTING_URL_PATTERN = /\/catalog\/([cr])\/([A-Za-z0-9][A-Za-z0-9_-]{0,60}?)(?:_p\d+)?\/?$/;

/** Reads a listing reference back out of a URL; null when the URL is not a listing. */
export function parseListingRef(url: unknown): ListingRef | null {
  if (typeof url !== 'string') return null;
  const m = LISTING_URL_PATTERN.exec(url);
  if (m === null) return null;
  return { kind: m[1] as ListingKind, slug: m[2] as string };
}
