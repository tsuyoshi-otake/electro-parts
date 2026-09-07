import { beforeAll, describe, expect, it } from 'vitest';
import { akizukiPageAdapter, pageKeyFromPath } from '../../userscript/adapters/akizuki.ts';
import { loadHtml, readFixtureHtml } from './helpers.ts';

const AT = (pathname: string, hostname = 'akizukidenshi.com') => ({ hostname, pathname });

describe('Akizuki page adapter', () => {
  let html: string;
  beforeAll(async () => {
    html = await readFixtureHtml('g109951');
  });

  it('matches Akizuki product URLs and nothing else', () => {
    expect(akizukiPageAdapter.matchPatterns).toEqual(['https://akizukidenshi.com/catalog/g/*']);
    expect(akizukiPageAdapter.matches(AT('/catalog/g/g109951/'))).toBe(true);
    expect(akizukiPageAdapter.matches(AT('/catalog/g/g109951/', 'www.akizukidenshi.com'))).toBe(true);
    expect(akizukiPageAdapter.matches(AT('/catalog/r/rkit/'))).toBe(false);
    expect(akizukiPageAdapter.matches(AT('/catalog/g/g109951/', 'www.aitendo.com'))).toBe(false);
    expect(akizukiPageAdapter.matches(AT('/products/9381', 'www.switch-science.com'))).toBe(false);
    expect(pageKeyFromPath('/catalog/g/g109951/')).toBe('109951');
    expect(pageKeyFromPath('/catalog/g/g109951')).toBe('109951');
    expect(pageKeyFromPath('/catalog/g/gABC/')).toBeNull();
  });

  it('extracts the sales code from the saved product page and finds the mount point', () => {
    loadHtml(document, html);
    expect(akizukiPageAdapter.extractPageKey(document, AT('/catalog/g/g109951/'))).toBe('109951');
    const mount = akizukiPageAdapter.findMountPoint(document);
    // Inside the centre pane, which is a plain full-width block. Placed as a
    // sibling it would become an extra item of the detail grid: 420px wide
    // and below the page's last section.
    expect(mount?.anchor.className).toContain('pane-goods-center');
    expect(mount?.position).toBe('prepend');
    expect(mount?.hostStyle).toBeUndefined();
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

  it('degrades through the container chain down to the product name heading', () => {
    loadHtml(document, html);
    document.querySelector('.pane-goods-center')?.remove();
    // The fallbacks land inside the detail grid, so they must claim every column.
    expect(akizukiPageAdapter.findMountPoint(document)).toMatchObject({ position: 'append', hostStyle: { 'grid-column': '1 / -1' } });
    expect(akizukiPageAdapter.findMountPoint(document)?.anchor.className).toContain('block-goods-detail');

    document.querySelector('.block-goods-detail')?.remove();
    // The heading lives inside the detail block, so re-add the pieces the last
    // two fallbacks look for.
    const sales = document.createElement('div');
    sales.id = 'SalesArea';
    document.body.appendChild(sales);
    const h1 = document.createElement('h1');
    h1.className = 'block-goods-name--text';
    document.body.appendChild(h1);
    expect(akizukiPageAdapter.findMountPoint(document)).toMatchObject({ anchor: sales, position: 'append' });

    sales.remove();
    const mount = akizukiPageAdapter.findMountPoint(document);
    expect(mount?.anchor.tagName).toBe('H1');
    expect(mount?.position).toBe('after');
    h1.remove();
    expect(akizukiPageAdapter.findMountPoint(document)).toBeNull();
  });
});
