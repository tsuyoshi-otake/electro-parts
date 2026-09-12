import { beforeAll, describe, expect, it } from 'vitest';
import { akizukiPageAdapter } from '../../userscript/adapters/akizuki.ts';
import { PAGE_ADAPTERS } from '../../userscript/adapters/registry.ts';
import { pageKeyFromPath, switchSciencePageAdapter } from '../../userscript/adapters/switch-science.ts';
import { loadHtml, readFixtureHtml } from './helpers.ts';

const AT = (pathname: string, hostname = 'www.switch-science.com') => ({ hostname, pathname });

describe('page adapter registry', () => {
  it('supports exactly the stores that are registered, and each URL belongs to one of them', () => {
    expect(PAGE_ADAPTERS.map((a) => a.storeId)).toEqual(['akizuki', 'switch-science', 'm5stack']);
    // The build script turns this list into the userscript's `@match` headers,
    // so a pattern added here is a page the script is allowed to run on.
    expect(PAGE_ADAPTERS.flatMap((a) => a.matchPatterns)).toEqual([
      'https://akizukidenshi.com/catalog/g/*',
      'https://www.switch-science.com/products/*',
      'https://www.switch-science.com/collections/*/products/*',
      'https://shop.m5stack.com/products/*',
      'https://shop.m5stack.com/collections/*/products/*',
    ]);
    const locations = [AT('/catalog/g/g109951/', 'akizukidenshi.com'), AT('/products/9381'), AT('/collections/all/products/9381')];
    for (const l of locations) {
      expect(PAGE_ADAPTERS.filter((a) => a.matches(l)).length, l.pathname).toBe(1);
    }
    expect(PAGE_ADAPTERS.filter((a) => a.matches(AT('/collections/all')))).toEqual([]);
    expect(akizukiPageAdapter.storeId).not.toBe(switchSciencePageAdapter.storeId);
  });
});

describe('Switch Science page adapter', () => {
  let html: string;
  beforeAll(async () => {
    html = await readFixtureHtml('9381', 'switch-science');
  });

  it('matches product pages under both paths Shopify serves them from', () => {
    expect(switchSciencePageAdapter.matches(AT('/products/9381'))).toBe(true);
    expect(switchSciencePageAdapter.matches(AT('/products/9381/'))).toBe(true);
    expect(switchSciencePageAdapter.matches(AT('/products/rpicm-pl'))).toBe(true);
    expect(switchSciencePageAdapter.matches(AT('/collections/all/products/9381'))).toBe(true);
    // The apex domain redirects to www, but the script must not miss the page
    // in the moment before it does.
    expect(switchSciencePageAdapter.matches(AT('/products/9381', 'switch-science.com'))).toBe(true);

    expect(switchSciencePageAdapter.matches(AT('/collections/all'))).toBe(false);
    expect(switchSciencePageAdapter.matches(AT('/products'))).toBe(false);
    expect(switchSciencePageAdapter.matches(AT('/products/9381/reviews'))).toBe(false);
    // An article *about* a product is not the product page.
    expect(switchSciencePageAdapter.matches(AT('/blogs/news/products/9381'))).toBe(false);
    expect(switchSciencePageAdapter.matches(AT('/products/9381', 'switch-science.evil.test'))).toBe(false);
    expect(switchSciencePageAdapter.matches(AT('/products/9381', 'akizukidenshi.com'))).toBe(false);
  });

  it('reads the handle out of a path, percent-decoded, and refuses what it cannot decode', () => {
    expect(pageKeyFromPath('/products/9381')).toBe('9381');
    expect(pageKeyFromPath('/products/9381/')).toBe('9381');
    expect(pageKeyFromPath('/collections/all/products/rpicm-pl')).toBe('rpicm-pl');
    expect(pageKeyFromPath('/products/%E3%83%8D%E3%82%B8')).toBe('ネジ');
    expect(pageKeyFromPath('/products/%E3%81')).toBeNull();
    expect(pageKeyFromPath('/collections/all')).toBeNull();
    expect(pageKeyFromPath('/blogs/news/products/9381')).toBeNull();
  });

  it('takes the identity from the saved product page and mounts below the two-column layout', () => {
    loadHtml(document, html);
    expect(switchSciencePageAdapter.extractPageKey(document, AT('/products/9381'))).toBe('9381');
    const mount = switchSciencePageAdapter.findMountPoint(document);
    // `.product--outer` *is* the gallery/details two-column grid, so the panel
    // goes after it — appended inside, it would become a third column.
    expect(mount?.anchor.className).toContain('product--outer');
    expect(mount?.anchor.tagName).toBe('ARTICLE');
    expect(mount?.position).toBe('after');
    expect(mount?.hostStyle).toBeUndefined();
  });

  it('agrees with the canonical link even when the URL carries the collection path', () => {
    loadHtml(document, html);
    // Shopify serves the same product from inside a collection; the canonical
    // link is the store's own answer, and both routes give the same key.
    expect(switchSciencePageAdapter.extractPageKey(document, AT('/collections/all/products/9381'))).toBe('9381');
  });

  it('refuses ambiguous identity rather than charting the wrong product', () => {
    loadHtml(document, html);
    document.querySelector('link[rel="canonical"]')!.setAttribute('href', 'https://www.switch-science.com/products/1234');
    expect(switchSciencePageAdapter.extractPageKey(document, AT('/products/9381'))).toBeNull();
  });

  it('falls back to the path when the page has no canonical link', () => {
    loadHtml(document, html);
    document.querySelector('link[rel="canonical"]')?.remove();
    expect(switchSciencePageAdapter.extractPageKey(document, AT('/products/9381'))).toBe('9381');
    expect(switchSciencePageAdapter.extractPageKey(document, AT('/collections/all'))).toBeNull();
  });

  it('degrades through the container chain down to the product heading, then gives up', () => {
    loadHtml(document, html);
    document.querySelector('.product--outer')!.remove();
    expect(switchSciencePageAdapter.findMountPoint(document)).toMatchObject({ position: 'append' });
    expect(switchSciencePageAdapter.findMountPoint(document)?.anchor.className).toContain('product__container');

    document.querySelector('.product__container')!.remove();
    const main = document.createElement('div');
    main.className = 'product-main';
    document.body.appendChild(main);
    expect(switchSciencePageAdapter.findMountPoint(document)).toMatchObject({ anchor: main, position: 'append' });

    main.remove();
    const h1 = document.createElement('h1');
    h1.className = 'product-title';
    document.body.appendChild(h1);
    expect(switchSciencePageAdapter.findMountPoint(document)).toMatchObject({ anchor: h1, position: 'after' });

    h1.remove();
    // A page whose layout changed entirely: no mount point, and the controller
    // renders nothing rather than injecting the panel somewhere arbitrary.
    expect(switchSciencePageAdapter.findMountPoint(document)).toBeNull();
  });
});
