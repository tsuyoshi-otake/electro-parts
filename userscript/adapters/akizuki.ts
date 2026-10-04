import type { MountPoint, StorePageAdapter } from '../core/types.ts';
import { pageThemeCss } from '../ui/pageTheme.ts';

/**
 * Akizuki Denshi product pages: `https://akizukidenshi.com/catalog/g/g<salesCode>/`.
 * The page key is the sales code, which is also the external product id
 * (an adapter-only assumption, see ADR-0003). It is read from the hidden
 * `#hidden_goods` input, then the canonical link, then the path; the first
 * available source wins and disagreement between sources is treated as
 * "not a product page" because the identity would be ambiguous.
 */

const PRODUCT_PATH = /^\/catalog\/g\/g(\d+)\/?$/;
const CANONICAL = /\/catalog\/g\/g(\d+)\/?$/;

/** Span every column, for the fallbacks that land inside the detail grid. Inert elsewhere. */
const FULL_WIDTH = { 'grid-column': '1 / -1' } as const;

export function pageKeyFromPath(pathname: string): string | null {
  const m = PRODUCT_PATH.exec(pathname);
  return m?.[1] ?? null;
}

export const akizukiPageAdapter: StorePageAdapter = {
  storeId: 'akizuki',
  // Browsing pages only. Cart (/catalog/cart/), member (/catalog/customer/),
  // quick order and contact forms stay in the store's own colors.
  matchPatterns: [
    'https://akizukidenshi.com/',
    'https://akizukidenshi.com/?*',
    'https://akizukidenshi.com/catalog/default.aspx*',
    'https://akizukidenshi.com/catalog/g/*',
    'https://akizukidenshi.com/catalog/c/*',
    'https://akizukidenshi.com/catalog/r/*',
    'https://akizukidenshi.com/catalog/e/*',
    'https://akizukidenshi.com/catalog/goods/*',
    'https://akizukidenshi.com/catalog/pages/*',
    'https://akizukidenshi.com/catalog/faq/*',
  ],
  pageThemeCss: pageThemeCss('.wrapper, header, footer, nav, [class*="pane-"], [class*="block-goods-"], [class*="block-bulk-"], [class*="block-accessory-"], .block-variation--item-term, .block-search-box, [class*="block-left-menu"], [class*="block-top-event--header"], .block-footer-store-list li, .wrapper li[style*="background"], .wrapper div[style*="background-color"]',
    `
/* Stock status is color-coded in lists and on product pages. */
html[data-eph-page-theme="dark"] :is(.block-cart-i--stock-info-green, .block-goods-detail--stock-info-green) { color: #7bd8a0 !important; }
html[data-eph-page-theme="dark"] :is(.block-cart-i--stock-info-orange, .block-goods-detail--stock-info-orange) { color: #ffb366 !important; }
html[data-eph-page-theme="dark"] :is(.block-cart-i--stock-info-gray, .block-goods-detail--stock-info-gray) { color: #b8c0c8 !important; }
html[data-eph-page-theme="dark"] :is(.block-cart-i--stock-info-purple, .block-goods-detail--stock-info-purple) { color: #d0a8ff !important; }
html[data-eph-page-theme="dark"] :is(.block-cart-i--stock-info-blue, .block-goods-detail--stock-info-blue) { color: #91bdff !important; }
html[data-eph-page-theme="dark"] :is(.block-goods-favorite--btn, .block-add-cart--btn) { background-image: none !important; background-color: #253c59 !important; color: #e6edf3 !important; }
html[data-eph-page-theme="dark"] :is(.block-goods-favorite--btn, .block-add-cart--btn):hover { background-color: #345278 !important; }
`),

  matches(location) {
    return (location.hostname === 'akizukidenshi.com' || location.hostname === 'www.akizukidenshi.com') && location.pathname.startsWith('/catalog/g/');
  },

  extractPageKey(doc, location) {
    const candidates: string[] = [];
    const hidden = doc.getElementById('hidden_goods');
    if (hidden instanceof doc.defaultView!.HTMLInputElement || (hidden !== null && 'value' in hidden)) {
      const v = String((hidden as HTMLInputElement).value ?? '').trim();
      if (/^\d+$/.test(v)) candidates.push(v);
    }
    const canonical = doc.querySelector('link[rel="canonical"]');
    const href = canonical?.getAttribute('href') ?? '';
    const cm = CANONICAL.exec(href);
    if (cm?.[1] !== undefined) candidates.push(cm[1]);
    const fromPath = pageKeyFromPath(location.pathname);
    if (fromPath !== null) candidates.push(fromPath);
    if (candidates.length === 0) return null;
    const first = candidates[0] as string;
    return candidates.every((c) => c === first) ? first : null;
  },

  findMountPoint(doc): MountPoint | null {
    // Full content width, right below the gallery/buy columns: the chart needs
    // the horizontal room, and the panel reads as its own section there.
    //
    // Inside `.pane-goods-center`, not beside it. `.block-goods-detail` is a
    // two-column CSS grid (measured 420px + 660px) whose five panes each pin
    // their own `grid-row`, so an inserted sibling is auto-placed into the
    // 420px column of a new row after all of them — squeezing the chart to
    // ~110px and pushing the panel below the page's last section. The centre
    // pane is a plain 1080px block that starts exactly where we want to be.
    const center = doc.querySelector('.pane-goods-center');
    if (center !== null) return { anchor: center, position: 'prepend' };
    const detail = doc.querySelector('.block-goods-detail');
    if (detail !== null) return { anchor: detail, position: 'append', hostStyle: FULL_WIDTH };
    const sales = doc.getElementById('SalesArea');
    if (sales !== null) return { anchor: sales, position: 'append', hostStyle: FULL_WIDTH };
    const name = doc.querySelector('h1.block-goods-name--text');
    if (name !== null) return { anchor: name, position: 'after', hostStyle: FULL_WIDTH };
    return null;
  },
};
