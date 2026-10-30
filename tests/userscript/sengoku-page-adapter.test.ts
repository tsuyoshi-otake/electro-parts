import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { sengokuPageAdapter } from '../../userscript/adapters/sengoku.ts';
import { HOST_ELEMENT_ID, OWNER_ATTRIBUTE, mountHistoryPanel } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import { fakeHost, json, loadHtml, sampleManifest, sampleProduct } from './helpers.ts';

const HOST = 'www.sengoku.co.jp';
const DETAIL = '/mod/sgk_cart/detail.php';
const AT = (pathname: string, hostname = HOST) => ({ hostname, pathname });
const BASE = 'https://data.example.test';
const html = readFileSync('tests/fixtures/sengoku/detail-EEHD-6N43.html', 'utf8');

/** The address bar of the jsdom window, as the shop's links leave it. */
function address(search: string): void {
  window.history.replaceState(null, '', `${DETAIL}${search}`);
}

beforeEach(() => {
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
  loadHtml(document, html);
  address('?code=EEHD-6N43');
});
afterEach(() => address(''));

describe('Sengoku page adapter', () => {
  it('puts the panel on detail pages only, and runs nowhere near the cart or the account', () => {
    expect(sengokuPageAdapter.matches(AT(DETAIL))).toBe(true);
    for (const path of ['/', '/index.php', '/mod/sgk_cart/search.php', '/mod/sgk_cart/category.php', '/mod/sgk_cart/cart.php', '/mod/sgk_cart/detail.php/x']) {
      expect(sengokuPageAdapter.matches(AT(path)), path).toBe(false);
    }
    expect(sengokuPageAdapter.matches(AT(DETAIL, 'sengoku.co.jp.evil.test'))).toBe(false);
    expect(sengokuPageAdapter.matchPatterns.some((p) => /\/(cart|inquiry|login|mypage|member|order)/.test(p))).toBe(false);
  });

  it('reads the management code under the price table, when the address agrees with it', () => {
    const at = AT(DETAIL);
    expect(sengokuPageAdapter.extractPageKey(document, at)).toBe('EEHD-6N43');
    address('?code=eehd-6n43');
    expect(sengokuPageAdapter.extractPageKey(document, at)).toBe('EEHD-6N43');
    address('');
    expect(sengokuPageAdapter.extractPageKey(document, at)).toBe('EEHD-6N43');
    address('?code=EEHD-6N44');
    expect(sengokuPageAdapter.extractPageKey(document, at)).toBeNull();
    address('?code=EEHD-6N43');
    expect(sengokuPageAdapter.extractPageKey(document, AT('/mod/sgk_cart/search.php'))).toBeNull();
    expect(sengokuPageAdapter.extractPageKey(document, AT(DETAIL, 'example.test'))).toBeNull();
    for (const text of ['', 'EEHD 6N43', '<b>EEHD-6N43</b>', 'eehd-6n43']) {
      document.querySelector('#productno02 > span')!.textContent = text;
      expect(sengokuPageAdapter.extractPageKey(document, at), text).toBeNull();
    }
    document.getElementById('productno02')!.remove();
    expect(sengokuPageAdapter.extractPageKey(document, at)).toBeNull();
  });

  it('mounts below the whole product block, across the content width', () => {
    const mount = sengokuPageAdapter.findMountPoint(document);
    expect(mount?.anchor.id).toBe('detail_whole');
    expect(mount?.position).toBe('after');
    expect(mount?.hostStyle).toEqual({ display: 'block', clear: 'both' });
    const code = document.getElementById('productno02')!;
    document.querySelector('.contents01')!.append(code);
    document.getElementById('detail_whole')!.remove();
    expect(sengokuPageAdapter.findMountPoint(document)?.anchor.id).toBe('productno02');
    code.remove();
    expect(sengokuPageAdapter.findMountPoint(document)?.anchor.className).toBe('item_detail_ttl');
    document.querySelector('h1.item_detail_ttl')!.remove();
    expect(sengokuPageAdapter.findMountPoint(document)).toBeNull();
  });

  it('keeps the header and the colored headings in the shop colours when the page is dark', () => {
    const css = sengokuPageAdapter.pageThemeCss!;
    expect(css).toContain(':not(:is(#header, .header_bar, h1.newitem_ttl, h1.featured))');
    // White behind the logo only; the blue bar below it keeps its own color.
    expect(css).toContain('html[data-eph-page-theme="dark"] #header { background-color: #fff !important; }');
    expect(css).not.toMatch(/\.header_bar\)?\s*\{/);
    expect(css).toContain(':is(h1.newitem_ttl, h1.featured) { --eph-preserved-color: #fff; }');
  });

  it('darkens the pale boxes the shop draws around menus, headings and item rows', () => {
    for (const box of ['#l_category_ttl', 'li.r_menu', 'h1.categoryttl', 'h1.item_detail_ttl', '.contents01 > h1:not([class])', '.category_box', '.goods_item']) {
      expect(sengokuPageAdapter.pageThemeCss).toContain(box);
    }
  });

  it('shows the history of the product on the page below its product block', async () => {
    const host = fakeHost();
    host.routes.set(`${BASE}/${manifestPath('sengoku')}`, json(sampleManifest({ storeId: 'sengoku' })));
    host.routes.set(`${BASE}/${productPath('sengoku', 'EEHD-6N43')}`, json(sampleProduct({ storeId: 'sengoku', pageKey: 'EEHD-6N43', externalProductId: 'EEHD-6N43' })));
    const handle = await mountHistoryPanel({
      adapters: [sengokuPageAdapter], host, client: new DataClient(host, { baseUrl: BASE }), doc: document,
      location: AT(DETAIL), dataBaseUrl: BASE, lazyChart: false, mountTimeoutMs: 200,
    });
    const panelText = () => document.getElementById(HOST_ELEMENT_ID)?.shadowRoot?.querySelector('section')?.textContent ?? '';
    await vi.waitFor(() => expect(panelText()).toContain('￥1,200'));
    expect(handle.mounted).toBe(true);
    expect(document.getElementById(HOST_ELEMENT_ID)!.previousElementSibling?.id).toBe('detail_whole');
    expect(panelText()).not.toContain('取得できませんでした');
    handle.destroy();
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
  });
});
