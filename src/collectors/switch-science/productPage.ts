import { switchScienceProductUrl } from '../../adapters/switch-science/rawSchema.ts';
import { SWITCH_SCIENCE_STOCK_DISPLAY_CAP } from '../../adapters/switch-science/capabilities.ts';
import type { ProductPageReader } from '../productPageInventory.ts';

/**
 * The stock count on a Switch Science product page (ADR-0027): one
 * `<p>在庫数: 9</p>`, or `<p>在庫数: 100+</p>` from 100 up. `100+` is recorded
 * as 100, which the store's capabilities declare as "at least". The page must
 * name the product it was asked for, and the product must have exactly one
 * variant, since the page shows one count.
 */
const STOCK = /<p>在庫数: (\d+)(\+?)<\/p>/g;
const CANONICAL = /<link rel="canonical" href="([^"]+)">/;

/**
 * Whether a product's page shows a 在庫数 line, judged from its catalogue
 * title. 「《お取り寄せ商品》」 products are ordered from the supplier on
 * request and their pages show no count: on 2026-11-04 all 51 such pages read
 * had none, and every other page read had one (#78). They are not read, so
 * the reader can keep treating a page without a count as one it does not
 * recognise.
 */
export function showsStockCount(title: string): boolean {
  return !title.startsWith('《お取り寄せ商品》');
}

export const readSwitchScienceProductPage: ProductPageReader = (html, target) => {
  if (target.offerIds.length !== 1) throw new Error(`${target.offerIds.length} variants share one count`);
  const canonical = CANONICAL.exec(html)?.[1];
  if (canonical !== switchScienceProductUrl(target.key)) throw new Error(`page is for ${canonical ?? 'no canonical URL'}`);
  const found = [...html.matchAll(STOCK)];
  if (found.length !== 1) throw new Error(`${found.length} stock counts on the page`);
  const [, digits, plus] = found[0]!;
  const n = Number(digits);
  if (plus === '+' && n !== SWITCH_SCIENCE_STOCK_DISPLAY_CAP) throw new Error(`unexpected cap ${n}+`);
  return { [target.offerIds[0]!]: n };
};
