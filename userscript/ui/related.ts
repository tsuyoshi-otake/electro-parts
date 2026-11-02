import type { ProductFileV1, SegmentV1 } from '../../src/publisher/contract.ts';
import { cheapestComparable, comparisonEligibility, HOME_CURRENCY, matchesRelationProduct, orderStorePrices, primaryQuote, storePriceRank, type RelatedEntry } from '../core/relations.ts';
import { availabilityLabel, formatDateTime, formatPriceValue, formatSignedMoney } from '../core/format.ts';

export const RELATED_CSS = `
.eph .comparison-heading { margin: 0 0 8px; font-size: 12px; font-weight: 700; }
.eph .body.has-comparison { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 20px; }
.eph .stats-col { min-width: 0; container: store-summary / inline-size; }
.eph .store-prices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 12px; }
.eph .store-price { min-width: 0; border-top: 1px solid var(--line); padding-top: 10px; overflow-wrap: anywhere; }
.eph .store-price > a { display: block; font-size: 12px; line-height: 1.5; margin-bottom: 6px; }
.eph .store-price .related-meta, .eph .store-price .comparison-note { line-height: 1.5; }
@container store-summary (max-width: 399px) { .eph .store-prices { grid-template-columns: 1fr; } }
.eph .store-price .hero-value { font-size: 22px; margin: 3px 0; }
.eph .store-order { margin-top: 12px; }
.eph .store-prices-more { margin-top: 8px; }
.eph .store-prices-more > .store-prices { margin-top: 4px; }
.eph .store-price .badge.cheapest { display: inline-block; margin: 0 0 4px; }
.eph .related-name { font-size: 12px; overflow-wrap: anywhere; }
.eph .related-meta, .eph .comparison-note { font-size: 11px; color: var(--muted); }
.eph .comparison-difference { font-size: 12px; margin: 6px 0; font-variant-numeric: tabular-nums; }
.eph .related-section { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--line); }
.eph .related-card { padding: 8px 0; min-width: 0; }
.eph .related-card + .related-card { border-top: 1px solid var(--line-soft); }
.eph .related-card ul { margin: 4px 0; padding-left: 18px; }
.eph .related-title { font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
.eph .related-card .related-name { margin: 2px 0; }
.eph .related-offer { display: flex; flex-wrap: wrap; gap: 2px 10px; padding: 6px 0; }
.eph .related-offer + .related-offer { border-top: 1px dashed var(--line-soft); }
.eph .related-store { flex: 0 0 9em; }
.eph .related-offer-body { flex: 1 1 12em; min-width: 0; overflow-wrap: anywhere; }
.eph .related-offer .hero-value { font-size: 16px; margin: 2px 0; }
.eph .related-evidence { font-size: 11px; color: var(--muted); }
.eph .related-evidence p { overflow-wrap: anywhere; }
.eph .series-controls { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 4px; }
.eph .series-controls label { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; cursor: pointer; font-size: 12px; }
.eph .series-swatch { width: 22px; border-top: 3px solid var(--accent); }
.eph [data-series-index="1"] { --accent: #a14b00; }
.eph [data-series-index="2"] { --accent: #7c3aad; }
.eph [data-series-index="3"] { --accent: #007a78; }
.eph[data-theme="dark"] [data-series-index="1"] { --accent: #ffb86b; }
.eph[data-theme="dark"] [data-series-index="2"] { --accent: #d1a1ff; }
.eph[data-theme="dark"] [data-series-index="3"] { --accent: #6cd9d5; }
.eph [data-series-index="1"] .eph-line, .eph [data-series-index="3"] .eph-line { stroke-dasharray: 7 4; }
.eph [data-series-index="1"] .series-swatch, .eph [data-series-index="3"] .series-swatch { border-top-style: dashed; }
.eph a:hover { text-decoration-thickness: 2px; }
.eph a:active, .eph summary:active { color: var(--fg); }
.eph summary:hover, .eph .series-controls label:hover { background: var(--chip); }
.eph :is(a, summary, select, input, circle):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.eph circle:focus-visible { stroke: var(--fg); stroke-width: 2px; }
.eph .series-controls input { accent-color: var(--accent); }
@media (pointer: coarse) { .eph .series-controls label, .eph summary, .eph .related-card a { min-height: 44px; } }
@media (max-width: 900px) { .eph .body.has-comparison { grid-template-columns: 1fr; } }
@container (max-width: 700px) { .eph .body.has-comparison { grid-template-columns: 1fr; } }
`;

function node(doc: Document, tag: string, content: string, className = ''): HTMLElement {
  const element = doc.createElement(tag); element.textContent = content; element.className = className; return element;
}

function productLink(doc: Document, entry: RelatedEntry): HTMLElement {
  try {
    const url = new URL(entry.target.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe URL');
    const link = doc.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const offer = entry.target.offer;
    link.textContent = entry.target.name + (offer ? ` · ${offer.name === 'Default Title' ? offer.sku : `${offer.name} (${offer.sku})`}` : '');
    link.dataset['focusKey'] = `product-${entry.relation.id}`; return link;
  } catch { return node(doc, 'span', entry.target.name); }
}

function details(doc: Document, label: string, key: string): HTMLDetailsElement {
  const element = doc.createElement('details'); element.dataset['stateKey'] = key;
  const summary = node(doc, 'summary', label); summary.dataset['focusKey'] = key; element.appendChild(summary); return element;
}

function directedDifference(difference: string, sourceIndex: 0 | 1): string {
  const parts = difference.match(/^([^:]+): (.+) ↔ (.+)$/);
  return parts ? `${parts[1]}: ${sourceIndex === 0 ? parts[2] : parts[3]} → ${sourceIndex === 0 ? parts[3] : parts[2]}` : difference;
}

function evidence(doc: Document, entry: RelatedEntry): HTMLElement {
  const { relation } = entry;
  const element = details(doc, '照合根拠・比較条件', `evidence-${relation.id}`); element.className = 'related-evidence';
  element.appendChild(node(doc, 'p', relation.evidence));
  for (const difference of relation.differences) element.appendChild(node(doc, 'p', `相違点: ${directedDifference(difference, entry.sourceIndex)}`));
  if (relation.missingEvidence.length) element.appendChild(node(doc, 'p', `未確認: ${relation.missingEvidence.join(' / ')}`));
  const orderedProducts = entry.sourceIndex === 0 ? relation.products : [...relation.products].reverse();
  element.appendChild(node(doc, 'p', `型番（閲覧中 → 他店）: ${orderedProducts.map((p) => p.modelNumber).join(' → ')}`));
  element.appendChild(node(doc, 'p', `照合日: ${relation.reviewedAt} · ${relation.provenance.method === 'retailer-pages' ? '店舗ページ確認' : '保存カタログ照合'}${relation.provenance.model ? ` / 候補抽出: ${relation.provenance.model}` : ''}`));
  element.appendChild(node(doc, 'p', `照合元データ取得日（閲覧中 / 他店）: ${orderedProducts.map((p) => p.observedAt.slice(0, 10)).join(' / ')}`));
  for (const [i, source] of (relation.evidenceUrls ?? []).entries()) {
    try {
      const url = new URL(source); if (url.protocol !== 'https:' || url.username || url.password) continue;
      const link = doc.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = `仕様の根拠（${url.hostname}）`; link.dataset['focusKey'] = `source-${relation.id}-${i}`; element.appendChild(link);
    } catch { /* Invalid evidence links do not interrupt the product panel. */ }
  }
  if (relation.pricePolicy) element.appendChild(node(doc, 'p', relation.pricePolicy.evidence));
  return element;
}

function price(doc: Document, parent: HTMLElement, entry: RelatedEntry): void {
  const state = entry.state;
  if (state.kind === 'reference_only') {
    parent.appendChild(node(doc, 'div', '通信量を抑えるため履歴の自動取得は上位候補のみ。商品リンクで確認できます。', 'related-meta'));
    return;
  }
  if (state.kind !== 'ready') {
    parent.appendChild(node(doc, 'div', state.kind === 'loading' ? '記録価格を読み込み中…' : state.kind === 'missing' ? '他店の履歴はまだ記録されていません' : '他店データを取得できませんでした', 'related-meta'));
    return;
  }
  const quote = primaryQuote(state.product, entry.target);
  if (!quote) parent.appendChild(node(doc, 'div', '価格の記録なし', 'related-meta'));
  else {
    parent.appendChild(node(doc, 'div', formatPriceValue(quote.segment.stats.current, quote.segment.basis.currency), 'hero-value'));
    const availability = quote.offer.availability[quote.offer.availability.length - 1];
    if (availability) parent.appendChild(node(doc, 'div', `観測時の在庫: ${availabilityLabel(availability[1])}`, 'related-meta'));
  }
  const at = state.product.product.lastSeenAt;
  parent.appendChild(node(doc, 'div', `最終観測 ${formatDateTime(at)}${!state.product.product.listed ? ' · 最新の観測では未掲載' : ''}`, 'related-meta'));
  if (state.freshness === 'stale' || state.note) parent.appendChild(node(doc, 'div', 'キャッシュ表示・更新確認ができません', 'related-meta'));
  if (!matchesRelationProduct(entry.target, state.product)) parent.appendChild(node(doc, 'div', '商品情報が照合時と異なるため要再確認', 'related-meta'));
}

/** Rows shown before the fold; the rest stay one click away. */
export const VISIBLE_STORE_PRICES = 3;

function storePriceRow(doc: Document, current: ProductFileV1, segment: SegmentV1, entry: RelatedEntry, label: (id: string) => string, ownFresh: boolean, cheapest: boolean): HTMLElement {
  const row = node(doc, 'div', '', 'store-price'); row.dataset['relationId'] = entry.relation.id;
  row.appendChild(node(doc, 'div', label(entry.target.storeId), 'comparison-heading'));
  if (cheapest) row.appendChild(node(doc, 'div', '最安（比較条件を確認した店舗の記録価格）', 'badge cheapest'));
  row.appendChild(productLink(doc, entry));
  price(doc, row, entry);
  const currency = storePriceRank(entry)?.currency;
  if (currency && currency !== HOME_CURRENCY) row.appendChild(node(doc, 'div', '送料・関税別のため円の店舗の後に表示', 'related-meta'));
  const eligibility = comparisonEligibility(current, segment, entry);
  if (eligibility.comparable && ownFresh) {
    row.appendChild(node(doc, 'div', eligibility.label, 'related-meta'));
    if (eligibility.differenceMinor !== null) row.appendChild(node(doc, 'div', `記録価格差（他店 − 閲覧中） ${formatSignedMoney(eligibility.differenceMinor, segment.basis.currency)}`, 'comparison-difference'));
    row.appendChild(node(doc, 'div', '観測日時は店舗ごとに異なります。現在の最安価格を示すものではありません。', 'comparison-note'));
  } else row.appendChild(node(doc, 'div', `参考記録価格 · ${eligibility.comparable ? '閲覧中店舗の更新確認ができません' : eligibility.reason}`, 'comparison-note'));
  row.appendChild(evidence(doc, entry));
  return row;
}

/**
 * Verified identity rows beside the current price, in stock first and cheapest recorded price first,
 * the first few shown and the rest folded. Eligibility still controls subtraction and the 最安 badge.
 */
export function renderStorePrices(doc: Document, parent: HTMLElement, current: ProductFileV1, segment: SegmentV1, entries: readonly RelatedEntry[], label: (id: string) => string, ownFresh: boolean): void {
  const rows = orderStorePrices(entries.filter((e) => e.relation.kind === 'same_product' && e.relation.reviewStatus === 'verified'));
  if (!rows.length) return;
  const cheapest = ownFresh ? cheapestComparable(current, segment, rows) : new Set<string>();
  if (rows.length > 1) parent.appendChild(node(doc, 'div', '在庫ありの店舗を先に、記録価格の安い順に表示しています。', 'related-meta store-order'));
  const grid = node(doc, 'div', '', 'store-prices');
  for (const entry of rows.slice(0, VISIBLE_STORE_PRICES)) grid.appendChild(storePriceRow(doc, current, segment, entry, label, ownFresh, cheapest.has(entry.relation.id)));
  parent.appendChild(grid);
  const rest = rows.slice(VISIBLE_STORE_PRICES);
  if (!rest.length) return;
  const more = details(doc, `他の店舗（${rest.length}件）`, 'store-prices-more'); more.className = 'store-prices-more';
  const moreGrid = node(doc, 'div', '', 'store-prices');
  for (const entry of rest) moreGrid.appendChild(storePriceRow(doc, current, segment, entry, label, ownFresh, cheapest.has(entry.relation.id)));
  more.appendChild(moreGrid); parent.appendChild(more);
}

/**
 * One card per reviewed variant: members of one family with the same directed differences
 * differ only by store. Relations without a family distance, or without any difference,
 * keep a card of their own. Entry order (closest first) decides card and row order.
 */
function variantGroups(entries: readonly RelatedEntry[]): RelatedEntry[][] {
  const groups = new Map<string, RelatedEntry[]>();
  for (const entry of entries) {
    const { id, similarity, differences } = entry.relation;
    const key = similarity && differences.length
      ? JSON.stringify([similarity.family, differences.map((d) => directedDifference(d, entry.sourceIndex)).sort()])
      : JSON.stringify([id]);
    const group = groups.get(key);
    if (group) group.push(entry); else groups.set(key, [entry]);
  }
  return [...groups.values()];
}

function offerRow(doc: Document, entry: RelatedEntry, label: (id: string) => string): HTMLElement {
  const row = node(doc, 'div', '', 'related-offer'); row.dataset['relationId'] = entry.relation.id;
  const store = node(doc, 'div', '', 'related-store related-meta');
  store.append(node(doc, 'div', label(entry.target.storeId)), node(doc, 'div', entry.relation.reviewStatus === 'verified' ? '照合確認済み' : entry.relation.reviewStatus === 'needs_review' ? '要確認' : '候補・未確定'));
  const body = node(doc, 'div', '', 'related-offer-body');
  body.appendChild(productLink(doc, entry));
  // The card explains reference-only rows once; such a row keeps its link and evidence.
  if (entry.state.kind !== 'reference_only') price(doc, body, entry);
  body.appendChild(evidence(doc, entry));
  row.append(store, body); return row;
}

/** Unconfirmed identity and alternatives never enter the normal price chart. */
export function renderRelatedGroups(doc: Document, parent: HTMLElement, entries: readonly RelatedEntry[], label: (id: string) => string): void {
  for (const [key, title, matches] of [
    ['same', '同一商品候補', (e: RelatedEntry) => e.relation.kind === 'same_product' && e.relation.reviewStatus !== 'verified'],
    ['similar', '類似商品', (e: RelatedEntry) => e.relation.kind === 'similar_product'],
    ['unresolved', '要確認の候補', (e: RelatedEntry) => e.relation.kind === 'unresolved'],
  ] as const) {
    const group = entries.filter(matches); if (!group.length) continue;
    const cards = key === 'similar' ? variantGroups(group) : group.map((entry) => [entry]);
    const section = details(doc, `${title} (${cards.length < group.length ? `${group.length}件・${cards.length}種類` : group.length})`, `group-${key}`); section.className = 'related-section';
    section.open = key === 'similar';
    if (key === 'similar') section.appendChild(node(doc, 'p', '用途・機能が近い商品を、確認した差分が少ない順に表示します。互換性や置き換え可能性は保証しません。差分は閲覧中の商品 → 他店の商品です。差分が同じ商品は1枚にまとめ、店舗ごとに表示します。', 'related-meta'));
    for (const members of cards) {
      const card = node(doc, 'div', '', 'related-card');
      const first = members[0]!;
      if (key === 'similar') {
        card.appendChild(node(doc, 'div', members.reduce((name, e) => e.target.name.length < name.length ? e.target.name : name, first.target.name), 'related-title'));
        // Generated feature differences have an explicit ordered pair. Reverse
        // them on the other store; free-text legacy evidence keeps its wording.
        for (const difference of first.relation.differences) card.appendChild(node(doc, 'p', directedDifference(difference, first.sourceIndex), 'related-name'));
      }
      card.appendChild(node(doc, 'div', `参考記録価格（販売条件を要確認）${members.some((e) => e.state.kind === 'reference_only') ? '。通信量を抑えるため履歴の自動取得は上位候補のみで、価格のない店舗は商品リンクで確認できます。' : ''}`, 'related-meta'));
      for (const entry of members) card.appendChild(offerRow(doc, entry, label));
      section.appendChild(card);
    }
    parent.appendChild(section);
  }
}
