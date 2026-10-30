/**
 * The texts pasted into the Chrome Web Store dashboard, read from their one
 * source, `docs/chrome-web-store-listing.md`.
 *
 * The dashboard is filled by `scripts/cws-dashboard.ts`, so the document stays
 * the original and the dashboard a copy of it. The dashboard has one field for
 * the host permission; the document keeps the data origin and the
 * content-script sites as two rows, and the field receives both, in that order.
 */

export interface StoreListingTexts {
  /** Store listing tab, 「説明」. */
  description: string;
  /** Privacy tab, 「単一用途の説明」. */
  singlePurpose: string;
  /** Privacy tab, 「storage が必要な理由」. */
  storageReason: string;
  /** Privacy tab, 「ホスト権限 が必要な理由」: the data origin row, a blank line, the content-script row. */
  hostReason: string;
}

export const STORE_LISTING_DOC = 'docs/chrome-web-store-listing.md';

function fencedBlockAfter(markdown: string, heading: string): string {
  const at = markdown.indexOf(`\n${heading}\n`);
  if (at < 0) throw new Error(`${STORE_LISTING_DOC}: heading not found: ${heading}`);
  const block = /\n```\n([\s\S]*?)\n```\n/.exec(markdown.slice(at));
  if (!block?.[1]) throw new Error(`${STORE_LISTING_DOC}: no fenced block after ${heading}`);
  return block[1];
}

function tableValue(markdown: string, rowLabel: RegExp): string {
  const rows = markdown.split('\n').filter((line) => line.startsWith('| '));
  const row = rows.find((line) => rowLabel.test(line.split(' | ')[0]!.slice(2)));
  const value = row ? /\| `([^`]+)` \|$/.exec(row)?.[1] : undefined;
  if (!value) throw new Error(`${STORE_LISTING_DOC}: no pasted value in the row ${rowLabel}`);
  return value;
}

export function readStoreListingTexts(markdown: string): StoreListingTexts {
  const text = markdown.replace(/\r\n/g, '\n');
  return {
    description: fencedBlockAfter(text, '### 説明(そのまま貼る)'),
    singlePurpose: fencedBlockAfter(text, '### 単一用途の説明(そのまま貼る)'),
    storageReason: tableValue(text, /^`storage`$/),
    hostReason: `${tableValue(text, /^ホスト権限 /)}\n\n${tableValue(text, /^コンテンツスクリプトの対象サイト$/)}`,
  };
}
