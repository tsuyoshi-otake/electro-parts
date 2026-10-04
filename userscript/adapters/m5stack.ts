import { M5STACK_ORIGIN, m5stackPageKey } from '../../src/adapters/m5stack/identity.ts';
import type { StorePageAdapter } from '../core/types.ts';
import { pageThemeCss } from '../ui/pageTheme.ts';

const PATH=/^\/(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/;
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
      const u=new URL(canonical,M5STACK_ORIGIN);
      if(u.origin!==M5STACK_ORIGIN||handle(u.pathname)!==fromPath) return null;
      return m5stackPageKey(fromPath);
    } catch{return null;}
  },
  findMountPoint(doc) {
    const block=doc.querySelector('.product-block-list');
    if(block) return {anchor:block,position:'after'};
    const product=doc.querySelector('[data-section-type="product"] .product-wrapper');
    // The shop fixes its purchase sidebar while scrolling inside this wrapper.
    // Extending its height would keep that sidebar over the history panel.
    if(product) return {anchor:product,position:'after',hostStyle:{width:'calc(100% - 32px)','max-width':'1440px',margin:'0 auto'}};
    return null;
  },
};
