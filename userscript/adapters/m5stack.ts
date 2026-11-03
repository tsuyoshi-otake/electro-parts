import { M5STACK_STORE } from '../../src/adapters/m5stack/identity.ts';
import { shopifyPageKey } from '../../src/adapters/shopify/identity.ts';
import type { StorePageAdapter } from '../core/types.ts';
import { pageThemeCss } from '../ui/pageTheme.ts';

const PATH=/^\/(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/;
/** The purchase column drops under the gallery here (measured 2026-11-03: one column at 768 px, beside it at 769 px). */
const ONE_COLUMN='(max-width: 768px)';
function handle(path:string):string|null {
  try {const m=PATH.exec(path);return m?decodeURIComponent(m[1]!):null;} catch{return null;}
}
export const m5stackPageAdapter:StorePageAdapter={
  // Browsing pages only. Cart, checkout and account pages stay in the store's own colors.
  storeId:'m5stack',matchPatterns:[
    'https://shop.m5stack.com/',
    'https://shop.m5stack.com/?*',
    'https://shop.m5stack.com/products/*',
    'https://shop.m5stack.com/collections/*',
    'https://shop.m5stack.com/search*',
    'https://shop.m5stack.com/pages/*',
    'https://shop.m5stack.com/blogs/*',
  ],
  pageThemeCss: pageThemeCss('header, footer, .product-template, .product-wrapper, .product-info, .m5-col-search-wrapper, .footer-container, .footer-bottom, .footer-nav, #eb-preload-mask, .m5chatbox-bubble, .shopify-section > div[style*="background-color"], .col-vertical-nav-wrapper, .col-filter-title, .product-card-out', `
html[data-eph-page-theme="dark"] { --eph-preserved-color: #343434; --eph-page-border: #626262; }
html[data-eph-page-theme="dark"] :is(.col-vertical-nav-wrapper, .col-vertical-nav-wrapper div, .col-list, .col-list div, .col-list-top, .product-main div, .product-info, .jdgm-rev-widg, .jdgm-rev, hr):not(header *) { border-color: #626262 !important; }
html[data-eph-page-theme="dark"] button svg:not(header *) :is(path,ellipse,polygon) { fill: #e6edf3 !important; }
/* The shop absolutely positions these icons outside the static buttons. Keep
   them in the button's own paint order when its background becomes opaque. */
html[data-eph-page-theme="dark"] .product-info button:is(.minus,.plus) { position: relative !important; }
html[data-eph-page-theme="dark"] .product-info button:is(.minus,.plus) svg { position: static !important; width: 16px !important; height: 16px !important; margin: auto !important; }
html[data-eph-page-theme="dark"] .m5product-detail * { box-shadow: none !important; }
`, 'header'),
  matches:location=>location.hostname==='shop.m5stack.com'&&PATH.test(location.pathname),
  initialOfferId(location) {
    const variant = new URLSearchParams(location.search ?? '').get('variant');
    return variant && /^[1-9]\d*$/.test(variant) ? variant : undefined;
  },
  extractPageKey(doc,location) {
    if(location.hostname!=='shop.m5stack.com') return null;
    const fromPath=handle(location.pathname);
    if(fromPath===null) return null;
    try {
      const canonical=doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
      if(!canonical) return null;
      const u=new URL(canonical,M5STACK_STORE.origin);
      if(u.origin!==M5STACK_STORE.origin||handle(u.pathname)!==fromPath) return null;
      return shopifyPageKey(M5STACK_STORE,fromPath);
    } catch{return null;}
  },
  layoutQuery:ONE_COLUMN,
  findMountPoint(doc) {
    // One column: the product form's last child, under add to cart and the
    // payment buttons. Before the description it would sit below the "Also Add"
    // upsell, 740-890 px under the button (measured 2026-11-03 at 390 and 768 px).
    // Not after the form: the upsell script inserts itself right after the form
    // once it loads, which is after we mount. Inside, the panel's controls stay in
    // its shadow tree, so they are not the form's controls and never submit it.
    // Picking a variant keeps the form and its children.
    const form=doc.defaultView?.matchMedia?.(ONE_COLUMN).matches===true
      ?doc.querySelector('.product-info-wrapper .product__content form.shopify-product-form'):null;
    if(form) return {anchor:form,position:'append'};
    // Left column, directly below the image gallery and above the description,
    // as near the top as Akizuki's panel. The purchase column beside it is
    // absolutely positioned and comes earlier in DOM order, so inserting here
    // does not move it, and its fixed state while scrolling stays in its own column.
    // Below 1024 px the purchase column is a left float inside a zero-height wrapper:
    // the description's text flows under it, but a block would sit beneath it, so
    // the panel clears the float.
    const description=doc.querySelector('.m5product-detail .product-main > .product-description');
    if(description) return {anchor:description,position:'before',hostStyle:{clear:'both'}};
    const block=doc.querySelector('.product-block-list');
    if(block) return {anchor:block,position:'after'};
    const product=doc.querySelector('[data-section-type="product"] .product-wrapper');
    // The shop fixes its purchase sidebar while scrolling inside this wrapper.
    // Extending its height would keep that sidebar over the history panel.
    if(product) return {anchor:product,position:'after',hostStyle:{width:'calc(100% - 32px)','max-width':'1440px',margin:'0 auto'}};
    return null;
  },
};
