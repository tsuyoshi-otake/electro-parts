import type { MountPoint, StorePageAdapter } from '../core/types.ts';

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

export function pageKeyFromPath(pathname: string): string | null {
  const m = PRODUCT_PATH.exec(pathname);
  return m?.[1] ?? null;
}

export const akizukiPageAdapter: StorePageAdapter = {
  storeId: 'akizuki',
  matchPatterns: ['https://akizukidenshi.com/catalog/g/*'],

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
    const sales = doc.getElementById('SalesArea');
    if (sales !== null) return { anchor: sales, position: 'append' };
    const name = doc.querySelector('h1.block-goods-name--text');
    if (name !== null) return { anchor: name, position: 'after' };
    return null;
  },
};
