import { M5STACK_ORIGIN, m5stackPageKey } from '../../src/adapters/m5stack/identity.ts';
import type { StorePageAdapter } from '../core/types.ts';

const PATH=/^\/(?:collections\/[^/]+\/)?products\/([^/]+)\/?$/;
function handle(path:string):string|null {
  try {const m=PATH.exec(path);return m?decodeURIComponent(m[1]!):null;} catch{return null;}
}
export const m5stackPageAdapter:StorePageAdapter={
  storeId:'m5stack',matchPatterns:['https://shop.m5stack.com/products/*','https://shop.m5stack.com/collections/*/products/*'],
  matches:location=>location.hostname==='shop.m5stack.com'&&PATH.test(location.pathname),
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
