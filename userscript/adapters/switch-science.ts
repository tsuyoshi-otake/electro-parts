import type { MountPoint, StorePageAdapter } from '../core/types.ts';
import { pageThemeCss } from '../ui/pageTheme.ts';

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
  // Browsing pages only. Cart, checkout and account pages stay in the store's
  // own colors.
  matchPatterns: [
    'https://www.switch-science.com/',
    'https://www.switch-science.com/?*',
    'https://www.switch-science.com/products/*',
    'https://www.switch-science.com/collections/*',
    'https://www.switch-science.com/search*',
    'https://www.switch-science.com/pages/*',
    'https://www.switch-science.com/blogs/*',
  ],
  pageThemeCss: pageThemeCss('header, footer, nav, .site-header-main, [class*="site-navigation"], .mobile-nav-panel, .navmenu-submenu, .site-footer-wrapper, .product--outer, .live-search-results, .modal, .product-tags, .skip-to-main, .productitem, .productitem--info, .productitem--image > div, .pf-anchor, [class*="pf-color-scheme"], .pf-bg-lazy',
    `html[data-eph-page-theme="dark"] { --eph-preserved-color: #1d1d1d; }
html[data-eph-page-theme="dark"] .quantity-selector__wrapper { background: #343434 !important; border: 1px solid #777 !important; border-radius: 4px; }
html[data-eph-page-theme="dark"] body .quantity-selector__wrapper :is(input.quantity-selector__input, button.quantity-selector__button):not(.site-header *) { background: transparent !important; border: 0 !important; border-radius: 0; box-shadow: none !important; }
html[data-eph-page-theme="dark"] .quantity-selector__wrapper .quantity-selector__button-wrapper:not(.quantity-selector__button-wrapper--disabled) button:hover { background: #505050 !important; }
html[data-eph-page-theme="dark"] .quantity-selector__wrapper .quantity-selector__button-wrapper:not(.quantity-selector__button-wrapper--disabled) button:active { background: #292929 !important; }
html[data-eph-page-theme="dark"] .quantity-selector__wrapper :is(button, input):focus-visible { outline-offset: -3px !important; }
/* Quantity discounts are highlighted in red-orange inline styles. */
html[data-eph-page-theme="dark"] .product-block .discount-table :is(p, td):not(.site-header *) { color: #ff9a8a !important; }
html[data-eph-page-theme="dark"] .product-block .discount-table p > span:not(.site-header *) { color: #b8c0c8 !important; }
`,'header, .site-header, .site-navigation, .mobile-nav-panel, .navmenu-submenu'),

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
