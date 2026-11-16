import { readFileSync } from 'node:fs';
import type { MarutsuSnapshot } from '../../src/adapters/marutsu/rawSchema.ts';
import { marutsuSnapshotAdapter } from '../../src/adapters/marutsu/snapshotAdapter.ts';
import { marutsuCollector, marutsuCategoryIndexUrl, marutsuListingUrl } from '../../src/collectors/marutsu/collector.ts';

export const MARUTSU_RETRIEVED_AT = '2026-11-16T09:55:00.000Z';

/** A reduced page saved from the shop (`tests/fixtures/marutsu/`). */
export function marutsuFixture(name: string): string {
  return readFileSync(`tests/fixtures/marutsu/${name}`, 'utf8');
}

/** The product rows of a saved listing page, as the shop printed them. */
export function marutsuRows(name: string): string[] {
  const html = marutsuFixture(name);
  const starts = [...html.matchAll(/<li id="resultsRow_\d+" class="DETAILS_ROW[^"]*">/g)];
  // A row contains lists of its own, so the last row runs to the end of the page, not to the first `</ul>`.
  return starts.map((m, i) => html.slice(m.index, i + 1 < starts.length ? starts[i + 1]!.index : html.length));
}

/**
 * A saved row as the shop would print it at another position: every
 * element id in a row carries the row's own number, and a clone that
 * stands for another product carries that product's page id instead.
 */
export function marutsuRow(row: string, oldIndex: number, index: number, newPageId?: string): string {
  let out = row
    .replaceAll(`resultsRow_${oldIndex}`, `resultsRow_${index}`)
    .replaceAll(`_${oldIndex}_`, `_${index}_`)
    .replaceAll(`_${oldIndex}"`, `_${index}"`);
  if (newPageId !== undefined) {
    const oldId = /\/pc\/i\/(\d+)\//.exec(out)?.[1];
    if (oldId === undefined) throw new Error('a row without a product address cannot be cloned');
    out = out.replaceAll(`/pc/i/${oldId}/`, `/pc/i/${newPageId}/`).replaceAll(`value="${oldId}"`, `value="${newPageId}"`);
  }
  return out;
}

/** A listing page in the shop's format: its counter variables and the rows of one page. */
export function marutsuListingHtml(rows: readonly string[], total: number, page = 1, perPage = 50): string {
  return `<script>
		var resultsDataNumber = "${total}";
		var resultsShowPageNumber = "${page}";
		var resultsMaxShowLine = "${perPage}";
	</script>
<ul>
${rows.join('\n')}
</ul>`;
}

/** The category index page in the shop's format: anchor links into each top category's own list page. */
export function marutsuCategoryIndexHtml(subcategories: readonly { top: string; path: string; name: string }[]): string {
  return subcategories
    .map((s) => `<a href="LargeCategoryList.jsp?goodsClassCode1=${s.top}#goodsClassName2Surround${s.path}">${s.name}</a>`)
    .join('\n');
}

export interface SyntheticMarutsuListing {
  path: string;
  name: string;
  rows: readonly string[];
  /** Reports the search cap on its first page and must be read through its subcategories. */
  capped?: boolean;
}

export interface SyntheticMarutsuShop {
  listings: readonly SyntheticMarutsuListing[];
  subcategories: readonly { top: string; path: string; name: string }[];
}

/**
 * A small shop built from the saved rows: every top category the
 * collector reads, one of them empty, one capped and read through two
 * subcategories, one listing of 55 products over two pages, and products
 * shared between listings (the stocked rows appear in キット and again
 * under 電子部品's subcategories; the first no-stock row appears in
 * 開発ツール and again under 電解コンデンサー).
 */
export function syntheticMarutsuShop(): SyntheticMarutsuShop {
  const stocked = marutsuRows('listing-stocked.html');
  const noStock = marutsuRows('listing-no-stock.html');
  // 55 clones of the first stocked row under new page ids; each page's rows are numbered from 0, as the shop's pages do.
  const bulk = Array.from({ length: 55 }, (_, i) => marutsuRow(stocked[0]!, 0, i % 50, String(9000001 + i)));
  return {
    listings: [
      { path: '05', name: 'キット', rows: stocked },
      { path: '11', name: '開発ツール', rows: noStock },
      { path: '15', name: '電気部品', rows: [] },
      { path: '16', name: '電子部品', rows: stocked.slice(0, 2), capped: true },
      { path: '160004', name: 'セラミックコンデンサー', rows: [marutsuRow(stocked[0]!, 0, 0), marutsuRow(stocked[1]!, 1, 1)] },
      { path: '160015', name: '電解コンデンサー', rows: [marutsuRow(stocked[2]!, 2, 0), marutsuRow(noStock[0]!, 0, 1)] },
      { path: '17', name: '電線・配線部材', rows: bulk },
      { path: '19', name: '半導体', rows: [marutsuRow(stocked[0]!, 0, 0, '9000100')] },
      { path: '21', name: 'コネクター', rows: [marutsuRow(stocked[0]!, 0, 0, '9000200')] },
    ],
    subcategories: [
      { top: '16', path: '160004', name: 'セラミックコンデンサー' },
      { top: '16', path: '160015', name: '電解コンデンサー' },
    ],
  };
}

/** Every URL the synthetic shop answers, by the shop's own listing URLs. */
export function marutsuSite(shop: SyntheticMarutsuShop): Map<string, string> {
  const site = new Map<string, string>([[marutsuCategoryIndexUrl(), marutsuCategoryIndexHtml(shop.subcategories)]]);
  for (const listing of shop.listings) {
    if (listing.capped) {
      site.set(marutsuListingUrl(listing.path, 1), marutsuListingHtml(listing.rows, 4000));
      continue;
    }
    const total = listing.rows.length;
    const pages = Math.max(1, Math.ceil(total / 50));
    for (let page = 1; page <= pages; page += 1) {
      site.set(marutsuListingUrl(listing.path, page), marutsuListingHtml(listing.rows.slice((page - 1) * 50, page * 50), total, page));
    }
  }
  return site;
}

/** Runs the real collector against a synthetic shop; `edit` may rewrite any response body. */
export async function collectMarutsuFixture(options: {
  shop?: SyntheticMarutsuShop; edit?: (url: string, body: string) => string; status?: (url: string) => number;
  /** Collector settings on top of the user agent. */
  config?: Record<string, unknown>;
  /** Receives every wait the collector asks for (the fetcher's pacing and the re-read settle wait). */
  sleeps?: number[];
} = {}) {
  const site = marutsuSite(options.shop ?? syntheticMarutsuShop());
  const requests: string[] = [];
  const outcome = await marutsuCollector.collect({ userAgent: 'electro-parts-test/1.0', ...options.config }, {
    log: () => {}, now: () => new Date(MARUTSU_RETRIEVED_AT), sleep: async (ms) => { options.sleeps?.push(ms); }, random: () => 0,
    transport: async (url) => {
      requests.push(url);
      const body = site.get(url);
      const status = options.status?.(url) ?? (body === undefined ? 404 : 200);
      const text = status === 200 ? options.edit?.(url, body!) ?? body! : 'Not Found';
      return { status, header: () => null, bytes: async () => Buffer.from(text) };
    },
  });
  return { ...outcome, raw: outcome.raw as MarutsuSnapshot, requests };
}

export async function loadMarutsuNormalized() {
  const result = await collectMarutsuFixture();
  return marutsuSnapshotAdapter.normalize(result.raw, 'a'.repeat(64));
}
