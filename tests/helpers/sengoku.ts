import { readFileSync } from 'node:fs';
import type { SengokuSnapshot } from '../../src/adapters/sengoku/rawSchema.ts';
import { sengokuSnapshotAdapter } from '../../src/adapters/sengoku/snapshotAdapter.ts';
import { sengokuCollector } from '../../src/collectors/sengoku/collector.ts';

export const SENGOKU_RETRIEVED_AT = '2026-10-30T03:30:00.000Z';

/** A reduced page saved from the shop (`tests/fixtures/sengoku/`). */
export function sengokuFixture(name: string): string {
  return readFileSync(`tests/fixtures/sengoku/${name}`, 'utf8');
}

/** The product rows of a saved listing page, as the shop printed them (the heading row left out). */
export function sengokuRows(name: string): string[] {
  return [...sengokuFixture(name).matchAll(/<tr\b[^>]*\bclass="item_list_row"[^>]*>[\s\S]*?<\/tr>/g)]
    .map((m) => m[0]).filter((row) => !/<th\b/.test(row));
}

/** A listing page in the shop's format: its counter, the tax-included price heading and the rows. */
export function sengokuListingHtml(rows: readonly string[], start: number, end: number, total: number): string {
  return `<div class="item_nums">
				${start}件～${end}件(全${total}件)
			</div>
<table class="wordBreak item_list_table" width="100%">
<tr bgcolor="#FCF3E9" class="item_list_row"><th align="center">商品画像</th><th>メーカー名<br>商品名 / 型番 / 通販価格(税込)</th><th>詳細</th></tr>
${rows.join('\n')}
</table>`;
}

export interface SyntheticListing {
  cid: number;
  name: string;
  rows: readonly string[];
  /** Reports the search cap on its first page and must be read through its children. */
  capped?: boolean;
  children?: readonly SyntheticListing[];
}

/** A category page in the shop's format: the side menu of the top level and the three-level main area. */
export function sengokuCategoryHtml(tree: readonly SyntheticListing[]): string {
  const menu = tree.map((t) => `<div class="category_sub" data-parent-cid="3000"><a href="/mod/sgk_cart/search.php?cid=${t.cid}">${t.name}</a></div>`);
  const main = tree.flatMap((t) => [
    `<div class="category_class"><a href="/mod/sgk_cart/category.php?cid=${t.cid}">${t.name}</a></div>`,
    ...(t.children ?? []).flatMap((c) => [
      `<div class="category_lv0">■<a href="/mod/sgk_cart/search.php?cid=${c.cid}">${c.name}</a></div>`,
      ...(c.children ?? []).map((g) => `<p>・<a href="/mod/sgk_cart/search.php?cid=${g.cid}">${g.name}</a></p>`),
    ]),
  ]);
  return `<div id="l_category">\n${menu.join('\n')}\n</div>\n<div id="main">\n${main.join('\n')}\n</div>`;
}

/**
 * A small shop built from the saved rows: 120 distinct products, one listing
 * read over two pages, one capped listing read through its three children,
 * two products listed in two of them, and one out-of-stock product
 * (EEHD-6N43) under コンデンサ.
 */
export function syntheticSengokuShop(): SyntheticListing[] {
  const mcu = sengokuRows('listing-3013.html');
  const passive = sengokuRows('listing-3137.html');
  const tail = sengokuRows('listing-3000-st3960.html');
  return [
    { cid: 3013, name: 'マイコン・半導体・LED', rows: [...mcu, ...tail.slice(0, 5)] },
    {
      cid: 3137, name: 'コイル・コンデンサ・抵抗', rows: passive, capped: true,
      children: [
        { cid: 3138, name: 'コイル(インダクタ)', rows: passive.slice(0, 10) },
        { cid: 3140, name: 'コンデンサ', rows: passive.slice(10) },
        { cid: 3309, name: '抵抗', rows: [...passive.slice(0, 2), ...tail.slice(5, 15)] },
      ],
    },
    { cid: 3503, name: 'センサー', rows: tail.slice(15) },
  ];
}

/** Every URL the synthetic shop answers, by the shop's own listing URLs. */
export function sengokuSite(tree: readonly SyntheticListing[]): Map<string, string> {
  const site = new Map<string, string>([['https://www.sengoku.co.jp/mod/sgk_cart/category.php?cid=3000', sengokuCategoryHtml(tree)]]);
  const add = (l: SyntheticListing) => {
    const url = (st: number) => `https://www.sengoku.co.jp/mod/sgk_cart/search.php?cid=${l.cid}${st === 0 ? '' : `&st=${st}`}`;
    if (l.capped) site.set(url(0), sengokuListingHtml(l.rows.slice(0, 40), 1, 40, 4000));
    else {
      for (let st = 0; st < l.rows.length; st += 40) {
        const end = Math.min(st + 40, l.rows.length);
        // As the shop does: an exactly full last page after the first reads S–(S−1).
        const printedEnd = st > 0 && end === st + 40 && end === l.rows.length ? st : end;
        site.set(url(st), sengokuListingHtml(l.rows.slice(st, end), st + 1, printedEnd, l.rows.length));
      }
    }
    (l.children ?? []).forEach(add);
  };
  tree.forEach(add);
  return site;
}

/** Runs the real collector against a synthetic shop; `edit` may rewrite any response body. */
export async function collectSengokuFixture(options: { tree?: SyntheticListing[]; edit?: (url: string, body: string) => string; status?: (url: string) => number } = {}) {
  const site = sengokuSite(options.tree ?? syntheticSengokuShop());
  const requests: string[] = [];
  const outcome = await sengokuCollector.collect({ userAgent: 'electro-parts-test/1.0' }, {
    log: () => {}, now: () => new Date(SENGOKU_RETRIEVED_AT), sleep: async () => {}, random: () => 0,
    transport: async (url) => {
      requests.push(url);
      const body = site.get(url);
      const status = options.status?.(url) ?? (body === undefined ? 404 : 200);
      const text = status === 200 ? options.edit?.(url, body!) ?? body! : 'Not Found';
      return { status, header: () => null, bytes: async () => Buffer.from(text) };
    },
  });
  return { ...outcome, raw: outcome.raw as SengokuSnapshot, requests };
}

export async function loadSengokuNormalized() {
  const result = await collectSengokuFixture();
  return sengokuSnapshotAdapter.normalize(result.raw, 'a'.repeat(64));
}
