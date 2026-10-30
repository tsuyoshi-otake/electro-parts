import { isSengokuCode } from '../../src/adapters/sengoku/identity.ts';
import type { StorePageAdapter } from '../core/types.ts';
import { pageThemeCss } from '../ui/pageTheme.ts';

const HOSTNAME = 'www.sengoku.co.jp';
const DETAIL_PATH = '/mod/sgk_cart/detail.php';

/**
 * The product a detail page shows: the management code printed under its
 * price table (「管理コード：<span>…</span>」). The address names it too
 * (`?code=`); when it does, both must agree, ignoring letter case.
 */
function shownProduct(doc: Document): string | null {
  const code = doc.querySelector('#productno02 > span')?.textContent?.trim() ?? '';
  if (!isSengokuCode(code)) return null;
  const fromAddress = new URLSearchParams(doc.location?.search ?? '').get('code');
  return fromAddress === null || fromAddress.trim().toUpperCase() === code ? code : null;
}

export const sengokuPageAdapter: StorePageAdapter = {
  // Browsing pages only. The cart, order, member and inquiry pages stay as they are.
  storeId: 'sengoku',
  matchPatterns: [
    'https://www.sengoku.co.jp/',
    'https://www.sengoku.co.jp/?*',
    'https://www.sengoku.co.jp/index.php*',
    'https://www.sengoku.co.jp/mod/sgk_cart/category.php*',
    'https://www.sengoku.co.jp/mod/sgk_cart/search.php*',
    'https://www.sengoku.co.jp/mod/sgk_cart/detail.php*',
  ],
  // The header's logo image is drawn for a white background, so the header keeps the shop's colors: white
  // behind the logo, the blue bar with its yellow greeting below it. The red and teal headings of the top
  // page keep their white-on-color too; the pale boxes (side menus, headings, item rows) go dark.
  pageThemeCss: pageThemeCss('#whole, #container, #main, #contents, .contents01, #l_area, #r_area, #l_category, #l_category_ttl, #l_menu_list, #r_menu_list, li.r_menu, #information, #display_box, #detail_whole, #footernavi, #footer, h1.categoryttl, h1.item_detail_ttl, .contents01 > h1:not([class]), .category_box, .goods_item, .goods_item_price', `
html[data-eph-page-theme="dark"] { --eph-preserved-color: #222222; }
html[data-eph-page-theme="dark"] #header { background-color: #fff !important; }
html[data-eph-page-theme="dark"] :is(h1.newitem_ttl, h1.featured) { --eph-preserved-color: #fff; }
`, '#header, .header_bar, h1.newitem_ttl, h1.featured'),
  matches: (location) => location.hostname === HOSTNAME && location.pathname === DETAIL_PATH,
  extractPageKey(doc, location) {
    return location.hostname === HOSTNAME && location.pathname === DETAIL_PATH ? shownProduct(doc) : null;
  },
  findMountPoint(doc) {
    // Below the product block (photo, name, prices and code), across the content width.
    const whole = doc.getElementById('detail_whole');
    if (whole !== null) return { anchor: whole, position: 'after', hostStyle: { display: 'block', clear: 'both' } };
    const code = doc.getElementById('productno02');
    if (code !== null) return { anchor: code, position: 'after', hostStyle: { display: 'block', clear: 'both' } };
    const title = doc.querySelector('h1.item_detail_ttl');
    return title === null ? null : { anchor: title, position: 'after', hostStyle: { display: 'block', clear: 'both' } };
  },
};
