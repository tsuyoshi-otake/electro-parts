import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manifestPath, productPath } from '../../src/publisher/contract.ts';
import { ksyPageAdapter } from '../../userscript/adapters/ksy.ts';
import { HOST_ELEMENT_ID, OWNER_ATTRIBUTE, mountHistoryPanel } from '../../userscript/core/controller.ts';
import { DataClient } from '../../userscript/core/dataClient.ts';
import { ksyProductPageHtml, openKsyProduct } from '../helpers/ksy.ts';
import { fakeHost, json, loadHtml, sampleManifest, sampleProduct } from './helpers.ts';

const HOST = 'raspberry-pi.ksyic.com';
const AT = (pathname: string, hostname = HOST) => ({ hostname, pathname });
const PERMALINK = (id: string) => `https://${HOST}/main/index/pdp.id/${id}/pdp.open/${id}`;
const BASE = 'https://data.example.test';

function openProduct(id: string, permalink = PERMALINK(id)): void {
  openKsyProduct(document, id, permalink);
}

/** Closing hides the dialog and leaves its fields as they were. */
function closeDialog(): void {
  document.getElementById('detail')!.style.display = 'none';
}

const html = ksyProductPageHtml();
beforeEach(() => {
  document.documentElement.removeAttribute(OWNER_ATTRIBUTE);
  loadHtml(document, html);
});

describe('KSY page adapter', () => {
  it('runs the dialog on the list and on permalinks, never on the cashier, account or form pages', () => {
    for (const path of ['/', '/main/index', '/main/index/pdp.id/1094/pdp.open/1094', '/main/index/c.id/12']) {
      expect(ksyPageAdapter.matches(AT(path)), path).toBe(true);
    }
    for (const path of ['/transaction', '/transaction/index', '/main/login', '/user/register', '/manager', '/info', '/news/1']) {
      expect(ksyPageAdapter.matches(AT(path)), path).toBe(false);
    }
    expect(ksyPageAdapter.matches(AT('/main/index', 'raspberry-pi.ksyic.com.evil.test'))).toBe(false);
  });

  it('reads the product from the dialog only when its number and permalink agree', () => {
    const at = AT('/main/index');
    // The saved page is as it arrives: the dialog exists but nothing is shown yet.
    expect(ksyPageAdapter.extractPageKey(document, at)).toBeNull();
    openProduct('1094');
    expect(ksyPageAdapter.extractPageKey(document, at)).toBe('1094');
    expect(ksyPageAdapter.extractPageKey(document, AT('/main/index', 'example.test'))).toBeNull();
    openProduct('1094', '/main/index/pdp.id/1094/pdp.open/1094');
    expect(ksyPageAdapter.extractPageKey(document, at)).toBe('1094');
    for (const href of [PERMALINK('483'), '#', 'https://example.test/main/index/pdp.id/1094/pdp.open/1094',
      '/main/index/pdp.id/1094/pdp.open/483', '/main/index/pdp.id/1094']) {
      openProduct('1094', href);
      expect(ksyPageAdapter.extractPageKey(document, at), href).toBeNull();
    }
    for (const id of ['', '0', '01', '1094x']) {
      openProduct(id, PERMALINK('1094'));
      expect(ksyPageAdapter.extractPageKey(document, at), id).toBeNull();
    }
    openProduct('1094');
    closeDialog();
    expect(ksyPageAdapter.extractPageKey(document, at)).toBeNull();
  });

  it('reports each product the dialog switches to, once, until unsubscribed', async () => {
    const seen: (string | null)[] = [];
    const stop = ksyPageAdapter.watchPageKey!(document, (key) => seen.push(key));
    openProduct('1094');
    await vi.waitFor(() => expect(seen).toEqual(['1094']));
    openProduct('1094');
    document.getElementById('detail_title')!.textContent = 'Raspberry Pi Pico 2';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['1094']);
    // The number changes before the permalink: in between no product is shown.
    document.getElementById('dt_id')!.textContent = '483';
    await vi.waitFor(() => expect(seen).toEqual(['1094', null]));
    document.getElementById('dt_Permalink')!.setAttribute('href', PERMALINK('483'));
    await vi.waitFor(() => expect(seen).toEqual(['1094', null, '483']));
    closeDialog();
    await vi.waitFor(() => expect(seen).toEqual(['1094', null, '483', null]));
    openProduct('483');
    await vi.waitFor(() => expect(seen).toEqual(['1094', null, '483', null, '483']));
    stop();
    openProduct('865');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['1094', null, '483', null, '483']);
  });

  it('mounts above the description, below the floating purchase column', () => {
    const mount = ksyPageAdapter.findMountPoint(document);
    expect(mount?.anchor.id).toBe('dt_Description');
    expect(mount?.position).toBe('before');
    expect(mount?.hostStyle).toEqual({ display: 'block', clear: 'both' });
    document.getElementById('dt_Description')!.remove();
    const fallback = ksyPageAdapter.findMountPoint(document);
    expect(fallback?.anchor.className).toBe('window-body');
    expect(fallback?.position).toBe('append');
  });

  it('shows the history of the product opened in the dialog and follows the next one', async () => {
    const host = fakeHost();
    host.routes.set(`${BASE}/${manifestPath('ksy')}`, json(sampleManifest({ storeId: 'ksy' })));
    host.routes.set(`${BASE}/${productPath('ksy', '1094')}`, json(sampleProduct({ storeId: 'ksy', pageKey: '1094', externalProductId: '1094' })));
    const handle = await mountHistoryPanel({
      adapters: [ksyPageAdapter], host, client: new DataClient(host, { baseUrl: BASE }), doc: document,
      location: AT('/main/index/pdp.id/1094/pdp.open/1094'), dataBaseUrl: BASE, lazyChart: false, mountTimeoutMs: 200,
    });
    expect(handle.mounted).toBe(false);
    const panelText = () => document.getElementById(HOST_ELEMENT_ID)?.shadowRoot?.querySelector('section')?.textContent ?? '';

    openProduct('1094');
    await vi.waitFor(() => expect(panelText()).toContain('￥1,200'));
    const panel = document.getElementById(HOST_ELEMENT_ID)!;
    expect(panel.closest('#detail')).not.toBeNull();
    expect(panel.nextElementSibling?.id).toBe('dt_Description');
    expect(panelText()).not.toContain('取得できませんでした');

    openProduct('483');
    await vi.waitFor(() => expect(panelText()).toContain('まだ観測データに含まれていません'));
    expect(document.querySelectorAll(`#${HOST_ELEMENT_ID}`)).toHaveLength(1);
    closeDialog();
    await vi.waitFor(() => expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull());
    expect(handle.mounted).toBe(false);
    handle.destroy();
    expect(document.getElementById(HOST_ELEMENT_ID)).toBeNull();
  });
});
