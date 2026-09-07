import type { ProductFileV1, SegmentV1 } from '../../src/publisher/contract.ts';
import { comparisonEligibility, matchesRelationProduct, primaryQuote, type RelatedEntry } from '../core/relations.ts';
import { availabilityLabel, formatDateTime, formatPriceValue, formatSignedMoney } from '../core/format.ts';

export const RELATED_CSS = `
.eph .comparison-heading { margin: 0 0 8px; font-size: 12px; font-weight: 700; }
.eph .store-price { border-top: 1px solid var(--line-soft); margin-top: 10px; padding-top: 10px; }
.eph .store-price .hero-value { font-size: 22px; margin: 3px 0; }
.eph .related-name { font-size: 12px; overflow-wrap: anywhere; }
.eph .related-meta, .eph .comparison-note { font-size: 11px; color: var(--muted); }
.eph .comparison-difference { font-size: 12px; margin: 6px 0; font-variant-numeric: tabular-nums; }
.eph .related-section { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--line); }
.eph .related-card { padding: 8px 0; min-width: 0; }
.eph .related-card + .related-card { border-top: 1px solid var(--line-soft); }
.eph .related-card ul { margin: 4px 0; padding-left: 18px; }
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
@media (max-width: 900px) { .eph .body.has-comparison .stats-col { grid-row: 1; } }
`;

function node(doc: Document, tag: string, content: string, className = ''): HTMLElement {
  const element = doc.createElement(tag); element.textContent = content; element.className = className; return element;
}

function productLink(doc: Document, entry: RelatedEntry): HTMLElement {
  try {
    const url = new URL(entry.target.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe URL');
    const link = doc.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = entry.target.name; link.dataset['focusKey'] = `product-${entry.relation.id}`; return link;
  } catch { return node(doc, 'span', entry.target.name); }
}

function details(doc: Document, label: string, key: string): HTMLDetailsElement {
  const element = doc.createElement('details'); element.dataset['stateKey'] = key;
  const summary = node(doc, 'summary', label); summary.dataset['focusKey'] = key; element.appendChild(summary); return element;
}

function evidence(doc: Document, entry: RelatedEntry): HTMLElement {
  const { relation } = entry;
  const element = details(doc, '照合根拠・比較条件', `evidence-${relation.id}`); element.className = 'related-evidence';
  element.appendChild(node(doc, 'p', relation.evidence));
  for (const difference of relation.differences) element.appendChild(node(doc, 'p', `相違点: ${difference}`));
  if (relation.missingEvidence.length) element.appendChild(node(doc, 'p', `未確認: ${relation.missingEvidence.join(' / ')}`));
  element.appendChild(node(doc, 'p', `型番: ${relation.products.map((p) => p.modelNumber).join(' ↔ ')}`));
  element.appendChild(node(doc, 'p', `照合日: ${relation.reviewedAt} · ${relation.provenance.method === 'retailer-pages' ? '店舗ページ確認' : '保存カタログ照合'}${relation.provenance.model ? ` / 候補抽出: ${relation.provenance.model}` : ''}`));
  element.appendChild(node(doc, 'p', `照合元データ取得日: ${relation.products.map((p) => p.observedAt.slice(0, 10)).join(' / ')}`));
  if (relation.pricePolicy) element.appendChild(node(doc, 'p', relation.pricePolicy.evidence));
  return element;
}

function price(doc: Document, parent: HTMLElement, entry: RelatedEntry): void {
  const state = entry.state;
  if (state.kind !== 'ready') {
    parent.appendChild(node(doc, 'div', state.kind === 'loading' ? '記録価格を読み込み中…' : state.kind === 'missing' ? '他店の履歴はまだ記録されていません' : '他店データを取得できませんでした', 'related-meta'));
    return;
  }
  const quote = primaryQuote(state.product);
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

/** Verified identity rows beside the current price. Eligibility still controls subtraction. */
export function renderStorePrices(doc: Document, parent: HTMLElement, current: ProductFileV1, segment: SegmentV1, entries: readonly RelatedEntry[], label: (id: string) => string, ownFresh: boolean): void {
  for (const entry of entries.filter((e) => e.relation.kind === 'same_product' && e.relation.reviewStatus === 'verified')) {
    const row = node(doc, 'div', '', 'store-price'); row.dataset['relationId'] = entry.relation.id;
    row.appendChild(node(doc, 'div', label(entry.target.storeId), 'comparison-heading'));
    row.appendChild(productLink(doc, entry));
    price(doc, row, entry);
    const eligibility = comparisonEligibility(current, segment, entry);
    if (eligibility.comparable && ownFresh) {
      row.appendChild(node(doc, 'div', eligibility.label, 'related-meta'));
      if (eligibility.differenceMinor !== null) row.appendChild(node(doc, 'div', `記録価格差（他店 − 閲覧中） ${formatSignedMoney(eligibility.differenceMinor, segment.basis.currency)}`, 'comparison-difference'));
      row.appendChild(node(doc, 'div', '観測日時は店舗ごとに異なります。現在の最安価格を示すものではありません。', 'comparison-note'));
    } else row.appendChild(node(doc, 'div', `参考記録価格 · ${eligibility.comparable ? '閲覧中店舗の更新確認ができません' : eligibility.reason}`, 'comparison-note'));
    row.appendChild(evidence(doc, entry)); parent.appendChild(row);
  }
}

/** Unconfirmed identity and alternatives never enter the normal price chart. */
export function renderRelatedGroups(doc: Document, parent: HTMLElement, entries: readonly RelatedEntry[], label: (id: string) => string): void {
  for (const [key, title, matches] of [
    ['same', '同一商品候補', (e: RelatedEntry) => e.relation.kind === 'same_product' && e.relation.reviewStatus !== 'verified'],
    ['similar', '類似商品', (e: RelatedEntry) => e.relation.kind === 'similar_product'],
    ['unresolved', '要確認の候補', (e: RelatedEntry) => e.relation.kind === 'unresolved'],
  ] as const) {
    const group = entries.filter(matches); if (!group.length) continue;
    const section = details(doc, `${title} (${group.length})`, `group-${key}`); section.className = 'related-section';
    section.open = key === 'similar';
    if (key === 'similar') section.appendChild(node(doc, 'p', '用途・機能が近い商品です。互換性や置き換え可能性は保証しません。', 'related-meta'));
    for (const entry of group) {
      const card = node(doc, 'div', '', 'related-card'); card.dataset['relationId'] = entry.relation.id;
      card.appendChild(node(doc, 'div', `${label(entry.target.storeId)} · ${entry.relation.reviewStatus === 'verified' ? '照合確認済み' : entry.relation.reviewStatus === 'needs_review' ? '要確認' : '候補・未確定'}`, 'related-meta'));
      card.appendChild(productLink(doc, entry));
      if (key === 'similar') for (const difference of entry.relation.differences) card.appendChild(node(doc, 'p', difference, 'related-name'));
      card.appendChild(node(doc, 'div', '参考記録価格（販売条件を要確認）', 'related-meta'));
      price(doc, card, entry); card.appendChild(evidence(doc, entry)); section.appendChild(card);
    }
    parent.appendChild(section);
  }
}
