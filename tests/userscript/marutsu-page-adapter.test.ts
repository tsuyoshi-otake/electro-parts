import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { marutsuPageAdapter } from '../../userscript/adapters/marutsu.ts';
import { HOST_ELEMENT_ID, OWNER_ATTRIBUTE, mountHistoryPanel } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import { fakeHost, json, loadHtml, sampleManifest, sampleProduct } from './helpers.ts';

const HOST = 'www.marutsu.co.jp';
const PRODUCT = '/pc/i/40938/';
const AT = (pathname: string, hostname = HOST) => ({ hostname, pathname });
const BASE = 'https://data.example.test';
const html = readFileSync('tests/fixtures/marutsu/detail-40938.html', 'utf8');

beforeEach(() => {
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
  loadHtml(document, html);
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Marutsu page adapter', () => {
  it('puts the panel on product pages only, and runs nowhere near the cart or the account', () => {
    expect(marutsuPageAdapter.matches(AT(PRODUCT))).toBe(true);
    for (const path of ['/', '/Shop.jsp', '/GoodsListNavi.jsp', '/GoodsAllCategoryList.jsp', '/pc/i/', '/pc/i/40938', '/pc/i/M0004-0938/', '/pc/cart/', '/Login.jsp']) {
      expect(marutsuPageAdapter.matches(AT(path)), path).toBe(false);
    }
    expect(marutsuPageAdapter.matches(AT(PRODUCT, 'marutsu.co.jp.evil.test'))).toBe(false);
    expect(marutsuPageAdapter.matchPatterns.some((p) => /\/(cart|inquiry|login|mypage|member|order)/i.test(p))).toBe(false);
  });

  it('reads the page key from the product address alone', () => {
    expect(marutsuPageAdapter.extractPageKey(document, AT(PRODUCT))).toBe('40938');
    expect(marutsuPageAdapter.extractPageKey(document, AT('/pc/i/2335443/'))).toBe('2335443');
    expect(marutsuPageAdapter.extractPageKey(document, AT('/GoodsListNavi.jsp'))).toBeNull();
    expect(marutsuPageAdapter.extractPageKey(document, AT(PRODUCT, 'example.test'))).toBeNull();
  });

  it('mounts below the product name heading, across the content width', () => {
    const mount = marutsuPageAdapter.findMountPoint(document);
    expect(mount?.anchor.tagName).toBe('H1');
    expect(mount?.position).toBe('after');
    expect(mount?.hostStyle).toEqual({ display: 'block', clear: 'both' });
    document.querySelector('h1')!.remove();
    expect(marutsuPageAdapter.findMountPoint(document)).toBeNull();
  });

  it('shows the history of the product on the page below its heading', async () => {
    const host = fakeHost();
    host.routes.set(`${BASE}/${manifestPath('marutsu')}`, json(sampleManifest({ storeId: 'marutsu' })));
    host.routes.set(`${BASE}/${productPath('marutsu', '40938')}`, json(sampleProduct({ storeId: 'marutsu', pageKey: '40938', externalProductId: '40938' })));
    const handle = await mountHistoryPanel({
      adapters: [marutsuPageAdapter], host, client: new DataClient(host, { baseUrl: BASE }), doc: document,
      location: AT(PRODUCT), dataBaseUrl: BASE, lazyChart: false, mountTimeoutMs: 200,
    });
    const panelText = () => document.getElementById(HOST_ELEMENT_ID)?.shadowRoot?.querySelector('section')?.textContent ?? '';
    await vi.waitFor(() => expect(panelText()).toContain('￥1,200'));
    expect(handle.mounted).toBe(true);
    expect(document.getElementById(HOST_ELEMENT_ID)!.previousElementSibling?.tagName).toBe('H1');
    expect(panelText()).not.toContain('取得できませんでした');
    handle.destroy();
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
  });
});
