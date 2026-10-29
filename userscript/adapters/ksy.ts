import { KSY_ORIGIN, isKsyProductId } from '../../src/adapters/ksy/identity.ts';
import type { StorePageAdapter } from '../core/types.ts';
import { pageThemeCss } from '../ui/pageTheme.ts';

const HOSTNAME = 'raspberry-pi.ksyic.com';
const PERMALINK = /^\/main\/index\/pdp\.id\/(\d+)\/pdp\.open\/(\d+)\/?$/;

/**
 * The product the shop's detail dialog shows while it is open: its product
 * number (商品番号) and its permalink must name the same product. The shop
 * fills both when it opens a product, from the list or from a permalink, and
 * never changes the address, so the dialog is the only place that says which
 * product is shown. Closing hides the dialog and leaves its fields filled.
 */
function shownProduct(doc: Document): string | null {
  const dialog = doc.getElementById('detail');
  const view = doc.defaultView;
  if (dialog === null || view === null || view.getComputedStyle(dialog).display === 'none') return null;
  const id = doc.getElementById('dt_id')?.textContent?.trim() ?? '';
  if (!isKsyProductId(id)) return null;
  try {
    const url = new URL(doc.getElementById('dt_Permalink')?.getAttribute('href') ?? '', KSY_ORIGIN);
    const m = url.origin === KSY_ORIGIN ? PERMALINK.exec(url.pathname) : null;
    return m !== null && m[1] === id && m[2] === id ? id : null;
  } catch {
    return null;
  }
}

export const ksyPageAdapter: StorePageAdapter = {
  // Browsing pages only. The cashier (/transaction), registration and password
  // reset (/user), my page (/manager) and the inquiry form (/info) stay as they are.
  storeId: 'ksy',
  matchPatterns: [
    'https://raspberry-pi.ksyic.com/',
    'https://raspberry-pi.ksyic.com/?*',
    'https://raspberry-pi.ksyic.com/main/index*',
    'https://raspberry-pi.ksyic.com/news/*',
    'https://raspberry-pi.ksyic.com/page/*',
    'https://raspberry-pi.ksyic.com/forcustomer/*',
  ],
  // The logo images are drawn for the white header, and the dialogs' title
  // bars carry the shop's own colors with white text; both stay as they are.
  // The header itself is transparent over the white body, so it keeps white
  // only when given it explicitly.
  // The right column's frame headings sit on the frame border with their own white background.
  pageThemeCss: pageThemeCss('.window > .window-body, #panel-right .frame > h4, #panel-right dt > h4, .list-menu > .item.active, td.cm, #registration, #cart_frame', `
html[data-eph-page-theme="dark"] { --eph-preserved-color: #222222; --eph-page-border: #626262; }
html[data-eph-page-theme="dark"] header { background-color: #fff !important; }
html[data-eph-page-theme="dark"] .window > .title { color: #fff !important; }
html[data-eph-page-theme="dark"] .window > .window-body { border-color: #626262 !important; }
`, 'header, .window > .title'),
  // Every product opens in the dialog over the list, on the list and on a permalink.
  matches: (location) => location.hostname === HOSTNAME && (location.pathname === '/' || location.pathname.startsWith('/main/index')),
  extractPageKey(doc, location) {
    return location.hostname === HOSTNAME ? shownProduct(doc) : null;
  },
  watchPageKey(doc, onChange) {
    const dialog = doc.getElementById('detail');
    const view = doc.defaultView;
    if (dialog === null || view === null || typeof view.MutationObserver !== 'function') return () => undefined;
    let last = shownProduct(doc);
    const observer = new view.MutationObserver(() => {
      const key = shownProduct(doc);
      if (key === last) return;
      last = key;
      onChange(key);
    });
    // `style`: the shop opens and closes the dialog by its display.
    observer.observe(dialog, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'style'] });
    return () => observer.disconnect();
  },
  findMountPoint(doc) {
    // Below the photos and the purchase column, above the long description.
    // The purchase column floats; the panel starts below it.
    const description = doc.querySelector('#detail #dt_Description');
    if (description !== null) return { anchor: description, position: 'before', hostStyle: { display: 'block', clear: 'both' } };
    const body = doc.querySelector('#detail > .window-body');
    return body === null ? null : { anchor: body, position: 'append', hostStyle: { display: 'block', clear: 'both' } };
  },
};
