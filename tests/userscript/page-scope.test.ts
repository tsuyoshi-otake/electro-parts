import { describe, expect, it } from 'vitest';
import { PAGE_ADAPTERS } from '../../userscript/adapters/registry.ts';
import { isSupportedUrlPattern, matchesUrlPattern } from '../../userscript/core/urlPattern.ts';

const at = (url: string) => {
  const u = new URL(url);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search };
};
const owners = (url: string) => PAGE_ADAPTERS.filter((a) => a.matchPatterns.some((p) => matchesUrlPattern(p, at(url)))).map((a) => a.storeId);

describe('URL pattern subset', () => {
  it('compares the host exactly and the path plus query with `*` as the only wildcard', () => {
    expect(matchesUrlPattern('https://shop.example/', at('https://shop.example/'))).toBe(true);
    expect(matchesUrlPattern('https://shop.example/', at('https://shop.example/?ref=x'))).toBe(false);
    expect(matchesUrlPattern('https://shop.example/?*', at('https://shop.example/?ref=x'))).toBe(true);
    expect(matchesUrlPattern('https://shop.example/?*', at('https://shop.example/cart'))).toBe(false);
    expect(matchesUrlPattern('https://shop.example/search*', at('https://shop.example/search?q=led'))).toBe(true);
    expect(matchesUrlPattern('https://shop.example/a.b*', at('https://shop.example/aXb'))).toBe(false);
    expect(matchesUrlPattern('https://shop.example/p/*', at('https://sub.shop.example/p/1'))).toBe(false);
    expect(matchesUrlPattern('https://shop.example/p/*', at('https://shop.example.evil/p/1'))).toBe(false);
  });

  it('never matches outside the subset', () => {
    for (const pattern of ['http://shop.example/*', 'https://*.shop.example/*', '<all_urls>', 'https://shop.example']) {
      expect(isSupportedUrlPattern(pattern), pattern).toBe(false);
      expect(matchesUrlPattern(pattern, at('https://shop.example/x')), pattern).toBe(false);
    }
  });
});

describe('page scope of the registered stores', () => {
  it('declares only supported patterns', () => {
    for (const pattern of PAGE_ADAPTERS.flatMap((a) => a.matchPatterns)) expect(isSupportedUrlPattern(pattern), pattern).toBe(true);
  });

  it.each([
    'https://akizukidenshi.com/catalog/cart/cart.aspx',
    'https://akizukidenshi.com/catalog/customer/menu.aspx',
    'https://akizukidenshi.com/catalog/customer/history.aspx',
    'https://akizukidenshi.com/catalog/quickorder/quickorder.aspx',
    'https://akizukidenshi.com/catalog/contact/contact.aspx',
    'https://www.switch-science.com/cart',
    'https://www.switch-science.com/checkouts/cn/abc',
    'https://www.switch-science.com/account/login',
    'https://www.switch-science.com/account',
    'https://shop.m5stack.com/cart',
    'https://shop.m5stack.com/checkout',
    'https://shop.m5stack.com/checkouts/abc',
    'https://shop.m5stack.com/account/register',
  ])('leaves %s alone', (url) => {
    expect(owners(url)).toEqual([]);
  });

  it.each([
    ['https://akizukidenshi.com/', 'akizuki'],
    ['https://akizukidenshi.com/catalog/default.aspx', 'akizuki'],
    ['https://akizukidenshi.com/catalog/g/g117209/', 'akizuki'],
    ['https://akizukidenshi.com/catalog/r/rsbcomp1/', 'akizuki'],
    ['https://akizukidenshi.com/catalog/goods/search.aspx?search=x', 'akizuki'],
    ['https://www.switch-science.com/', 'switch-science'],
    ['https://www.switch-science.com/products/6262', 'switch-science'],
    ['https://www.switch-science.com/collections/all/products/9381', 'switch-science'],
    ['https://www.switch-science.com/search?q=atom', 'switch-science'],
    ['https://shop.m5stack.com/?ref=x', 'm5stack'],
    ['https://shop.m5stack.com/products/atom-lite-esp32-development-kit?variant=1', 'm5stack'],
    ['https://shop.m5stack.com/collections/m5-atom', 'm5stack'],
  ])('themes %s for %s', (url, storeId) => {
    expect(owners(url)).toEqual([storeId]);
  });

  it('keeps every product page an adapter recognizes inside its own scope', () => {
    for (const url of ['https://akizukidenshi.com/catalog/g/g109951/', 'https://www.switch-science.com/products/9381',
      'https://www.switch-science.com/collections/all/products/9381', 'https://shop.m5stack.com/collections/atom/products/atom-lite']) {
      const product = PAGE_ADAPTERS.filter((a) => a.matches(at(url))).map((a) => a.storeId);
      expect(product, url).toHaveLength(1);
      expect(owners(url), url).toEqual(product);
    }
  });
});
