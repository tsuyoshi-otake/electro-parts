import { PIMORONI_STORE } from '../../src/adapters/pimoroni/identity.ts';
import { shopifyPageKey } from '../../src/adapters/shopify/identity.ts';
import type { StorePageAdapter } from '../core/types.ts';

const HOSTNAME = 'shop.pimoroni.com';
/**
 * The root (GB) pages and the Japan market copies. The shop sends visitors from
 * Japan to `/en-jp`, where it shows yen; the panel shows the GBP base price
 * either way. Other markets' copies are not matched.
 */
const PATH = /^\/(?:en-jp\/)?(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/;
/** The product page's own breakpoint: `.product-page` drops to one column (its inline style). */
const ONE_COLUMN = 'screen and (max-width: 1024px)';
function handle(path: string): string | null {
  try { const m = PATH.exec(path); return m ? decodeURIComponent(m[1]!) : null; } catch { return null; }
}

/**
 * The shop draws everything from its own color variables (it has its own dark
 * mode). The dark page theme sets those variables to the project's base
 * `#3e3e3e` instead of overriding element colors. The header is dark already;
 * its light values are restored so it keeps the store's colors. Images are not
 * filtered.
 */
const DARK = 'html[data-eph-page-theme="dark"]';
const PAGE_THEME_CSS = `
${DARK} { color-scheme: dark; background-color: #3e3e3e !important;
  --black: #e6edf3; --grey: #b8c0cc; --pale: #6b6b6b; --pale-rgb: 107, 107, 107; --faint: rgba(255, 255, 255, .08);
  --surface: #343434; --ground: #3e3e3e; --ground-light: rgba(255, 255, 255, .06);
  --cyan-ink: #3fd3e8; --magenta-ink: #ff8be6; --violet-ink: #d4a0ff; --green-ink: #4fd88f; --orange-ink: #ffa04d; --yellow-ink: #ffd34d; --red-ink: #ff8fa3;
  --light-shadow: 0 0 2px rgba(0, 0, 0, .3), 0 1px 3px rgba(0, 0, 0, .2), 0 2px 8px rgba(0, 0, 0, .2);
  --mid-shadow: 0 0 2px rgba(0, 0, 0, .2), 0 3px 6px rgba(0, 0, 0, .2), 0 4px 12px rgba(0, 0, 0, .3);
  --heavy-shadow: 0 0 4px rgba(0, 0, 0, .3), 0 4px 8px rgba(0, 0, 0, .3), 0 8px 16px rgba(0, 0, 0, .5); }
${DARK} body { background-color: #3e3e3e !important; color: #e6edf3 !important; }
${DARK} .container { background-color: #3e3e3e !important; }
${DARK} #header { color-scheme: light; --black: #3d3d3d; --grey: #8a8a8a; --pale: #bac0ca; --pale-rgb: 218, 216, 218; --faint: #f5f5f5;
  --surface: #ffffff; --ground: #eaebf2; --ground-light: #f6f7fa;
  --cyan-ink: #22818e; --magenta-ink: #c530a8; --violet-ink: #b026ff; --green-ink: #268056; --orange-ink: #b16218; --yellow-ink: #8b7325; --red-ink: #d83050; }
${DARK} :is(a, button, input, select, textarea, [tabindex]):not(#header *):focus-visible { outline: 2px solid #91bdff !important; outline-offset: 2px !important; }
`;

export const pimoroniPageAdapter: StorePageAdapter = {
  // Browsing pages only. Cart, checkout and account pages stay in the store's own colors.
  storeId: 'pimoroni',
  matchPatterns: [
    'https://shop.pimoroni.com/',
    'https://shop.pimoroni.com/?*',
    'https://shop.pimoroni.com/products/*',
    'https://shop.pimoroni.com/collections/*',
    'https://shop.pimoroni.com/search*',
    'https://shop.pimoroni.com/pages/*',
    'https://shop.pimoroni.com/blogs/*',
    'https://shop.pimoroni.com/en-jp',
    'https://shop.pimoroni.com/en-jp?*',
    'https://shop.pimoroni.com/en-jp/',
    'https://shop.pimoroni.com/en-jp/?*',
    'https://shop.pimoroni.com/en-jp/products/*',
    'https://shop.pimoroni.com/en-jp/collections/*',
    'https://shop.pimoroni.com/en-jp/search*',
    'https://shop.pimoroni.com/en-jp/pages/*',
    'https://shop.pimoroni.com/en-jp/blogs/*',
  ],
  pageThemeCss: PAGE_THEME_CSS,
  matches: (location) => location.hostname === HOSTNAME && PATH.test(location.pathname),
  initialOfferId(location) {
    const variant = new URLSearchParams(location.search ?? '').get('variant');
    return variant && /^[1-9]\d*$/.test(variant) ? variant : undefined;
  },
  extractPageKey(doc, location) {
    if (location.hostname !== HOSTNAME) return null;
    const fromPath = handle(location.pathname);
    if (fromPath === null) return null;
    try {
      const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
      if (!canonical) return null;
      const u = new URL(canonical, PIMORONI_STORE.origin);
      if (u.origin !== PIMORONI_STORE.origin || handle(u.pathname) !== fromPath) return null;
      return shopifyPageKey(PIMORONI_STORE, fromPath);
    } catch { return null; }
  },
  layoutQuery: ONE_COLUMN,
  findMountPoint(doc) {
    // One column: right after the add-to-cart row and its tax note, inside the
    // purchase box. After the whole purchase column it would sit below the
    // cross-sell and the newsletter, 1,400-1,600 px under the button (measured
    // 2026-11-03 at 390 and 1024 px). Picking a variant keeps that box.
    const addToCart = doc.defaultView?.matchMedia?.(ONE_COLUMN).matches === true
      ? doc.querySelector('.product-page > .purchase #add_to_cart') : null;
    if (addToCart) return { anchor: addToCart, position: 'after' };
    // Two columns: `.product-page` is a grid with the gallery and then the
    // description in the left column, the sticky purchase column on the right.
    // Before the description is the left column under the gallery: once it is
    // scrolled into view, add to cart sticks beside it (measured 2026-11-03 at
    // 1280-1920 px). Not inside the purchase column: that column sticks at the
    // top and is already taller than the screen, so the panel's lower half would
    // stay out of view until the end of the product page.
    const about = doc.querySelector('.product-page > .about');
    if (about) return { anchor: about, position: 'before', hostStyle: { 'grid-column': '1' } };
    const purchase = doc.querySelector('.product-page > .purchase');
    if (purchase) return { anchor: purchase, position: 'after', hostStyle: { 'grid-column': '1' } };
    const page = doc.querySelector('.product-page');
    if (page) return { anchor: page, position: 'after' };
    return null;
  },
};
