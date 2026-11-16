import { isMarutsuPageId } from '../../src/adapters/marutsu/identity.ts';
import type { StorePageAdapter } from '../core/types.ts';
import { pageThemeCss } from '../ui/pageTheme.ts';

const HOSTNAME = 'www.marutsu.co.jp';
const PRODUCT_PATH = /^\/pc\/i\/(\d+)\/$/;

/**
 * The product a product page shows: the numeric id in its own address
 * (`/pc/i/<id>/`). The page also prints a マルツコード, but the address
 * alone names the product, so nothing on the page can disagree with it.
 */
function shownProduct(location: Pick<Location, 'hostname' | 'pathname'>): string | null {
  if (location.hostname !== HOSTNAME) return null;
  const m = PRODUCT_PATH.exec(location.pathname);
  return m !== null && isMarutsuPageId(m[1]!) ? m[1]! : null;
}

export const marutsuPageAdapter: StorePageAdapter = {
  // Browsing pages only. The cart, order, member and inquiry pages stay as they are.
  storeId: 'marutsu',
  matchPatterns: [
    'https://www.marutsu.co.jp/',
    'https://www.marutsu.co.jp/?*',
    'https://www.marutsu.co.jp/Shop.jsp*',
    'https://www.marutsu.co.jp/GoodsListNavi.jsp*',
    'https://www.marutsu.co.jp/GoodsListGoodsNameNavi.jsp*',
    'https://www.marutsu.co.jp/GoodsAllCategoryList.jsp*',
    'https://www.marutsu.co.jp/LargeCategoryList.jsp*',
    'https://www.marutsu.co.jp/RatedList.jsp*',
    'https://www.marutsu.co.jp/pc/i/*',
  ],
  // The surfaces are the listing pages' own containers, read from the saved pages
  // the fixtures came from (2026-01-29). No product page has been saved yet, so
  // nothing on it is preserved in the shop's colors; its text takes the generic
  // rules. Revisit when a real product page is saved.
  pageThemeCss: pageThemeCss('.contents, .main_contents, .main_area, .goods_list_container, .item_list_container, .item_list_record, .item_spec, .search_result'),
  matches: (location) => shownProduct(location) !== null,
  extractPageKey(doc, location) {
    return shownProduct(location);
  },
  findMountPoint(doc) {
    // Below the product name heading, across the content width. The
    // product page's columns are the shop's own; the panel takes a full
    // row under the heading rather than a place inside either column.
    const title = doc.querySelector('h1');
    return title === null ? null : { anchor: title, position: 'after', hostStyle: { display: 'block', clear: 'both' } };
  },
};
