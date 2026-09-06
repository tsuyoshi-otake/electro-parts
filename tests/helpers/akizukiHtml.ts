/**
 * Renders synthetic Akizuki listing pages in the exact markup the real site
 * uses (class names, nesting, entity encoding), so crawler tests can run
 * against a fake site with controlled pagination, duplicates and failures,
 * and the parser can be round-trip tested with generated data.
 */
import type { ListingKind } from '../../src/collectors/akizuki/listings.ts';

export interface SyntheticListing {
  salesCode: string;
  name: string;
  modelNumber: string | null;
  category: string | null;
  priceYen: number | null;
  unit: string;
  /** Status badges rendered as consecutive `stock-info-*` divs. */
  statuses: string[];
  /** Renders the purchase form (quantity + add-to-cart). */
  purchasable: boolean;
  availableQuantity: number | null;
  quantityUnit: string;
}

/**
 * `cards` is the usual product-card list; `table` is the sortable spec table
 * some categories use instead (no cart affordance, same products).
 */
export type SyntheticLayout = 'cards' | 'table';

export interface SyntheticPage {
  /** `c` renders the category header, `r` the genre header. */
  kind: ListingKind;
  slug: string;
  name: string;
  layout?: SyntheticLayout;
  listedTotal: number;
  currentPage: number;
  lastPage: number;
  items: SyntheticListing[];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function yen(n: number): string {
  return `￥${n.toLocaleString('en-US')}`;
}

export function renderListingItem(it: SyntheticListing): string {
  const name = escapeHtml(it.name);
  const statusDivs = it.statuses.map((s, i) => `<div class="block-cart-i--stock-info-${['green', 'blue', 'gray'][i % 3]}">${escapeHtml(s)}</div>`).join('\n');
  const purchase =
    it.purchasable && it.availableQuantity !== null
      ? `<dl class="block-cart-i--available_purchase"><dt>通販購入可能数：</dt><dd>${it.availableQuantity}${escapeHtml(it.quantityUnit)}</dd></dl>
<dl class="block-cart-i--purchase_qty"><dt>数量：</dt><dd class="block-cart-i--purchase_qty-wrap">
<input type="text" name="qty_${it.salesCode}" maxlength="4" size="4" value="1" class="block-goods-list-qty-input" data-purchasable-qty="${it.availableQuantity}" autocomplete="off">
</dd></dl>
<a href="javascript:void(0);" class="block-cart-i--add_cart js-animation-add-cart" data-goods="${it.salesCode}">かごに入れる</a>`
      : '';
  const price = it.priceYen === null ? '' : `<div class="block-cart-i--price-infos"><div class="block-cart-i--price-items2">
<div class="block-cart-i--price-qty">
  ${escapeHtml(it.unit)}
</div>
<div class="block-cart-i--price price js-enhanced-ecommerce-goods-price">${yen(it.priceYen)}<span class="tax">(税込)</span></div>
</div></div>`;
  return `<dl class="block-cart-i--goods js-enhanced-ecommerce-item goods-">
  <dt class="block-cart-i--goods-image"><a href="/catalog/g/g${it.salesCode}/" title="${name}" class="js-enhanced-ecommerce-image"><figure class="img-center"><img alt="${name}" src="/img/usr/lazyloading.png"></figure></a></dt>
  <dd class="block-cart-i--goods-description">
    <div class="block-cart-i--goods-name"><a href="/catalog/g/g${it.salesCode}/" title="${name}" class="js-enhanced-ecommerce-goods-name" data-category="${escapeHtml(it.category ?? '')}" data-brand="">${name}</a></div>
    ${it.modelNumber === null ? '' : `<div class="block-cart-i--model_number"><strong>型番：</strong>${escapeHtml(it.modelNumber)}</div>`}
    <div class="block-cart-i--code"><strong>販売コード：</strong>${it.salesCode}</div>
    ${price}
    ${statusDivs}
    ${purchase}
    <div class="block-icon"></div>
  </dd>
</dl>`;
}

/** One row of the spec-table layout: no cart, no purchasable quantity. */
export function renderTableRow(it: SyntheticListing): string {
  const name = escapeHtml(it.name);
  const statusDivs = it.statuses.map((s, i) => `<div class="block-cart-i--stock-info-${['green', 'orange', 'gray'][i % 3]}">${escapeHtml(s)}</div>`).join('\n');
  const price =
    it.priceYen === null
      ? ''
      : `<div class="block-goods-list-l--price-items">
<div class="block-goods-list-l--price-qty">
${escapeHtml(it.unit)}
</div>
<div class="block-goods-list-l--price price js-enhanced-ecommerce-goods-price">${yen(it.priceYen)}<span class="tax">(税込)</span></div>
</div>`;
  return `<tr class="js-enhanced-ecommerce-item ">
<td class="block-goods-list-l--goods-name-items">
<div class="block-goods-list-l--goods-image"><a href="/catalog/g/g${it.salesCode}/" title="${name}" class="js-enhanced-ecommerce-image"><figure class="img-center"><img alt="${name}" src="/img/usr/lazyloading.png"></figure></a></div>
${statusDivs}
</td>
<td class="block-goods-list-l--goods-name-items">
<div class="block-goods-list-l--goods-name"><a href="/catalog/g/g${it.salesCode}/" title="${name}" data-category="${escapeHtml(it.category ?? '')}" data-brand="" class="js-enhanced-ecommerce-goods-name">${name}</a></div>
<div class="block-goods-list-l--code"><strong>販売コード：</strong>${it.salesCode}</div>
</td>
<td class="block-goods-list-l--price-infos">
${price}
</td>
<td class="block-goods-list-l--model_number">
<p>${it.modelNumber === null ? '' : escapeHtml(it.modelNumber)}</p>
</td>
</tr>`;
}

/** Header markup differs between the two listing families; nothing else does. */
function headerClass(kind: ListingKind): string {
  return kind === 'c' ? 'block-category-list--header' : 'block-genre-page--header';
}

export function renderListingPage(p: SyntheticPage): string {
  const pageHref = (n: number): string => (n === 1 ? `/catalog/${p.kind}/${p.slug}/` : `/catalog/${p.kind}/${p.slug}_p${n}/`);
  const next = p.currentPage < p.lastPage ? pageHref(p.currentPage + 1) : null;
  const numbers = Array.from({ length: p.lastPage }, (_, i) => i + 1)
    .map((n) => (n === p.currentPage ? `<li class="pager-current"><span>${n}</span></li>` : `<li><a href="${pageHref(n)}">${n}</a></li>`))
    .join('\n');
  const nav = next === null ? '' : `<ul class="pagination"><li class="pager-next"><a rel="next" href="${next}">次</a></li><li class="pager-last"><a href="${pageHref(p.lastPage)}">最後</a></li></ul>`;
  const groups: string[] = [];
  for (let i = 0; i < p.items.length; i += 3) groups.push(`<li>\n${p.items.slice(i, i + 3).map(renderListingItem).join('\n')}\n</li>`);
  const list =
    p.layout === 'table'
      ? `<div class="block-goods-list-l">
<table class="block-goods-list-l--table">
<thead><tr><th><div class="ttl"></div></th><th><div class="ttl">商品情報</div></th><th><div class="ttl">販売価格</div></th><th><div class="ttl">型番</div></th></tr></thead>
<tbody>
${p.items.map(renderTableRow).join('\n')}
</tbody>
</table>
</div>`
      : `<div class="block-cart-i">
<ul class="block-cart-i--items">
${groups.join('\n')}
</ul>
</div>`;
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>${escapeHtml(p.name)} 秋月電子通商-電子部品・ネット通販</title>
<link rel="canonical" href="https://akizukidenshi.com${pageHref(1)}">
${next === null ? '' : `<link rel="next" href="https://akizukidenshi.com${next}">`}
</head><body>
<h1 class="h1 ${headerClass(p.kind)}">${escapeHtml(p.name)}</h1>
<div class="block-goods-list--pager-top block-goods-list--pager pager">
<div class="pager-total"><span class="pager-count"><span>${p.listedTotal}</span>件あります</span></div>
<ul class="pagination">${numbers}</ul>
${nav}
</div>
${list}
<div class="block-goods-list--pager-bottom block-goods-list--pager pager">
<div class="pager-total"><span class="pager-count"><span>${p.listedTotal}</span>件あります</span></div>
${nav}
</div>
</body></html>`;
}

/**
 * A branch of the category tree that only links to its children: header, no
 * counter, no product blocks. Real pages such as `/catalog/c/ckeyboard/`.
 */
export function renderIndexOnlyPage(slug: string, name: string, children: readonly string[]): string {
  const links = children.map((c) => `<li><a href="/catalog/c/${c}/">${escapeHtml(c)}</a></li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>${escapeHtml(name)} 秋月電子通商-電子部品・ネット通販</title>
<link rel="canonical" href="https://akizukidenshi.com/catalog/c/${slug}/">
</head><body>
<h1 class="h1 block-category-list--header">${escapeHtml(name)}</h1>
<ul class="block-category-list--items">
${links}
</ul>
</body></html>`;
}

export const MAINTENANCE_PAGE = `<!DOCTYPE html><html><head><title>403- 現在メンテナンス中です。</title></head><body>
<div class="block-custom-error-403"><p class="block-custom-error-403--title">現在メンテナンス中です。</p></div></body></html>`;

export function syntheticItem(n: number, overrides: Partial<SyntheticListing> = {}): SyntheticListing {
  return {
    salesCode: String(100000 + n),
    name: `Synthetic part ${n} & co`,
    modelNumber: `SYN-${n}`,
    category: `Category(${n % 5})`,
    priceYen: 100 + n * 10,
    unit: '1個',
    statuses: ['在庫あり'],
    purchasable: true,
    availableQuantity: 50 + n,
    quantityUnit: '個',
    ...overrides,
  };
}
