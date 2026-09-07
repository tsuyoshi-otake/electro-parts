import { describe, expect, it } from 'vitest';
import {
  collectSitemapHandles,
  fetchSwitchScienceSitemap,
  handleFromProductUrl,
  isProductSitemapUrl,
  sitemapIndexUrl,
} from '../../src/collectors/switch-science/sitemap.ts';
import { SitemapError } from '../../src/collectors/sitemapXml.ts';
import { addProducts, fakeShop, fetcherFor, FAKE_BASE, FAKE_SITEMAP_INDEX } from '../helpers/fakeShopifySite.ts';

describe('Switch Science sitemap URLs', () => {
  it('reads the handle out of a product URL, percent-decoded, with or without a trailing slash', () => {
    expect(handleFromProductUrl('https://www.switch-science.com/products/9381')).toBe('9381');
    expect(handleFromProductUrl('https://www.switch-science.com/products/9381/')).toBe('9381');
    expect(handleFromProductUrl('http://shop.test/products/rpicm-pl')).toBe('rpicm-pl');
    expect(handleFromProductUrl('https://shop.test/products/%E3%83%8D%E3%82%B8')).toBe('ネジ');
  });

  it('is not fooled by URLs that are not a product page', () => {
    for (const url of [
      'https://www.switch-science.com/',
      'https://www.switch-science.com/collections/all',
      'https://www.switch-science.com/products/9381/reviews',
      'https://www.switch-science.com/blogs/products/9381',
      'https://www.switch-science.com/products/9381?variant=1',
    ]) {
      expect(handleFromProductUrl(url), url).toBeNull();
    }
    expect(handleFromProductUrl('https://shop.test/products/%E3%81')).toBeNull();
  });

  it('only recognises the product children of the sitemap index', () => {
    expect(isProductSitemapUrl(`${FAKE_BASE}/sitemap_products_1.xml?from=1&to=99`)).toBe(true);
    expect(isProductSitemapUrl(`${FAKE_BASE}/sitemap_products_11.xml`)).toBe(true);
    expect(isProductSitemapUrl(`${FAKE_BASE}/sitemap_pages_1.xml`)).toBe(false);
    expect(isProductSitemapUrl(`${FAKE_BASE}/sitemap_collections_1.xml?from=1`)).toBe(false);
    expect(isProductSitemapUrl(`${FAKE_BASE}/sitemap_products_x.xml`)).toBe(false);
  });

  it('separates usable handles from ones that could not be a page key', () => {
    const sets = { handles: new Set<string>(), unsupported: new Set<string>() };
    collectSitemapHandles(
      `<urlset><url><loc>https://shop.test/</loc></url>
       <url><loc>https://shop.test/products/9381</loc></url>
       <url><loc>https://shop.test/products/%E3%83%8D%E3%82%B8</loc></url>
       <url><loc>https://shop.test/collections/all</loc></url></urlset>`,
      sets,
    );
    expect([...sets.handles]).toEqual(['9381']);
    expect([...sets.unsupported]).toEqual(['ネジ']);
  });

  it('points at the sitemap the store advertises in robots.txt', () => {
    expect(sitemapIndexUrl('https://www.switch-science.com')).toBe('https://www.switch-science.com/sitemap.xml');
  });
});

describe('fetchSwitchScienceSitemap', () => {
  it('reads only the product children and returns every handle once, sorted', async () => {
    const shop = fakeShop({ sitemapChildren: 3 });
    addProducts(shop, 7);
    const sitemap = await fetchSwitchScienceSitemap({ fetcher: fetcherFor(shop), baseUrl: FAKE_BASE });
    expect(sitemap.handles).toEqual(['1001', '1002', '1003', '1004', '1005', '1006', '1007']);
    expect(sitemap.sources).toHaveLength(3);
    expect(sitemap.indexEntryCount).toBe(4);
    expect(sitemap.unsupportedHandles).toEqual([]);
    // The index and its three product children — never the pages sitemap.
    expect(shop.log).toEqual([
      FAKE_SITEMAP_INDEX,
      `${FAKE_BASE}/sitemap_products_1.xml?from=100&to=199`,
      `${FAKE_BASE}/sitemap_products_2.xml?from=200&to=299`,
      `${FAKE_BASE}/sitemap_products_3.xml?from=300&to=399`,
    ]);
  });

  it('has no partial answer: an unreadable sitemap throws instead of shrinking the oracle', async () => {
    const missing = fakeShop({ sitemapMissing: true });
    addProducts(missing, 3);
    await expect(fetchSwitchScienceSitemap({ fetcher: fetcherFor(missing), baseUrl: FAKE_BASE })).rejects.toThrow(/HTTP 404/);

    const noProducts = fakeShop({ sitemapChildren: 0 });
    await expect(fetchSwitchScienceSitemap({ fetcher: fetcherFor(noProducts), baseUrl: FAKE_BASE })).rejects.toThrow(SitemapError);

    const empty = fakeShop();
    await expect(fetchSwitchScienceSitemap({ fetcher: fetcherFor(empty), baseUrl: FAKE_BASE })).rejects.toThrow(/no product URLs/);
  });

  it('refuses an index with more product children than the configured cap', async () => {
    const shop = fakeShop({ sitemapChildren: 5 });
    addProducts(shop, 5);
    await expect(fetchSwitchScienceSitemap({ fetcher: fetcherFor(shop), baseUrl: FAKE_BASE, maxSubSitemaps: 4 })).rejects.toThrow(
      /5 product sub-sitemaps, above the cap of 4/,
    );
  });
});
