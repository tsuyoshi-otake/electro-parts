import type { MountPoint, StorePageAdapter } from '../core/types.ts';

/**
 * Switch Science product pages: `https://www.switch-science.com/products/<handle>`.
 * The page key is the Shopify handle, which is also the external product id
 * (an adapter-only assumption, see ADR-0015).
 *
 * Shopify serves the same product under `/products/<handle>` and under
 * `/collections/<collection>/products/<handle>`, so both are matched and both
 * yield the same key. The canonical link is preferred over the path because it
 * is the store's own answer to "which product is this"; when the two disagree
 * the page is treated as not a product page, since the identity would be
 * ambiguous.
 */

/**
 * Only these two shapes are a product page. `/blogs/news/products/<slug>` is an
 * article about a product, not the product, and must not be charted as one.
 */
const PRODUCT_PATH = /^\/(?:collections\/[^/]+\/)?products\/([^/?#]+)\/?$/;
/** The same, allowing the origin the canonical link carries. */
const CANONICAL = /^(?:https?:\/\/[^/]+)?\/(?:collections\/[^/]+\/)?products\/([^/?#]+)\/?$/;

function decodeHandle(encoded: string | undefined): string | null {
  if (encoded === undefined) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    // A malformed escape is not a handle; charting a guess would be worse.
    return null;
  }
}

export function pageKeyFromPath(pathname: string): string | null {
  return decodeHandle(PRODUCT_PATH.exec(pathname)?.[1]);
}

export const switchSciencePageAdapter: StorePageAdapter = {
  storeId: 'switch-science',
  matchPatterns: [
    'https://www.switch-science.com/products/*',
    'https://www.switch-science.com/collections/*/products/*',
  ],

  matches(location) {
    return (
      (location.hostname === 'www.switch-science.com' || location.hostname === 'switch-science.com') &&
      PRODUCT_PATH.test(location.pathname)
    );
  },

  extractPageKey(doc, location) {
    const candidates: string[] = [];
    const canonical = doc.querySelector('link[rel="canonical"]');
    const fromCanonical = decodeHandle(CANONICAL.exec(canonical?.getAttribute('href') ?? '')?.[1]);
    if (fromCanonical !== null) candidates.push(fromCanonical);
    const fromPath = pageKeyFromPath(location.pathname);
    if (fromPath !== null) candidates.push(fromPath);
    if (candidates.length === 0) return null;
    const first = candidates[0] as string;
    return candidates.every((c) => c === first) ? first : null;
  },

  findMountPoint(doc): MountPoint | null {
    // Below the gallery/details columns and inside the container that gives the
    // page its gutters: full content width for the chart, and the panel reads
    // as its own section rather than as an extra product column.
    //
    // Not appended to `.product--outer` itself — that element *is* the two
    // column layout, so a third child becomes a third column.
    const outer = doc.querySelector('.product--outer');
    if (outer !== null) return { anchor: outer, position: 'after' };
    const container = doc.querySelector('.product__container');
    if (container !== null) return { anchor: container, position: 'append' };
    const main = doc.querySelector('.product-main');
    if (main !== null) return { anchor: main, position: 'append' };
    const title = doc.querySelector('h1.product-title');
    if (title !== null) return { anchor: title, position: 'after' };
    return null;
  },
};
