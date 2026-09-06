import { beforeAll, describe, expect, it } from 'vitest';
import { akizukiPageAdapter, pageKeyFromPath } from '../../userscript/adapters/akizuki.ts';
import { PAGE_ADAPTERS } from '../../userscript/adapters/registry.ts';
import { loadHtml, readFixtureHtml } from './helpers.ts';

const AT = (pathname: string, hostname = 'akizukidenshi.com') => ({ hostname, pathname });

describe('Akizuki page adapter', () => {
  let html: string;
  beforeAll(async () => {
    html = await readFixtureHtml('g109951');
  });

  it('is the only registered adapter and only matches Akizuki product URLs', () => {
    expect(PAGE_ADAPTERS.map((a) => a.storeId)).toEqual(['akizuki']);
    expect(PAGE_ADAPTERS.flatMap((a) => a.matchPatterns)).toEqual(['https://akizukidenshi.com/catalog/g/*']);
    expect(akizukiPageAdapter.matches(AT('/catalog/g/g109951/'))).toBe(true);
    expect(akizukiPageAdapter.matches(AT('/catalog/g/g109951/', 'www.akizukidenshi.com'))).toBe(true);
    expect(akizukiPageAdapter.matches(AT('/catalog/r/rkit/'))).toBe(false);
    expect(akizukiPageAdapter.matches(AT('/catalog/g/g109951/', 'www.aitendo.com'))).toBe(false);
    expect(pageKeyFromPath('/catalog/g/g109951/')).toBe('109951');
    expect(pageKeyFromPath('/catalog/g/g109951')).toBe('109951');
    expect(pageKeyFromPath('/catalog/g/gABC/')).toBeNull();
  });

  it('extracts the sales code from the saved product page and finds the mount point', () => {
    loadHtml(document, html);
    expect(akizukiPageAdapter.extractPageKey(document, AT('/catalog/g/g109951/'))).toBe('109951');
    const mount = akizukiPageAdapter.findMountPoint(document);
    expect(mount?.anchor.id).toBe('SalesArea');
    expect(mount?.position).toBe('append');
  });

  it('refuses ambiguous identity (hidden input disagreeing with the canonical link)', () => {
    loadHtml(document, html);
    (document.getElementById('hidden_goods') as HTMLInputElement).value = '999999';
    expect(akizukiPageAdapter.extractPageKey(document, AT('/catalog/g/g109951/'))).toBeNull();
  });

  it('falls back to the canonical link, then the path, when the hidden input is absent', () => {
    loadHtml(document, html);
    document.getElementById('hidden_goods')?.remove();
    expect(akizukiPageAdapter.extractPageKey(document, AT('/catalog/g/g109951/'))).toBe('109951');
    document.querySelector('link[rel="canonical"]')?.remove();
    expect(akizukiPageAdapter.extractPageKey(document, AT('/catalog/g/g109951/'))).toBe('109951');
    expect(akizukiPageAdapter.extractPageKey(document, AT('/catalog/g/'))).toBeNull();
  });

  it('falls back to the product name heading when the sales area is missing', () => {
    loadHtml(document, html);
    document.getElementById('SalesArea')?.remove();
    const mount = akizukiPageAdapter.findMountPoint(document);
    expect(mount?.anchor.tagName).toBe('H1');
    expect(mount?.position).toBe('after');
    document.querySelector('h1.block-goods-name--text')?.remove();
    expect(akizukiPageAdapter.findMountPoint(document)).toBeNull();
  });
});
