import type { ProductPageReader } from '../productPageInventory.ts';

/**
 * The stock counts on an M5Stack product page (ADR-0027). The page shows
 * a tier such as 「10+ In Stock」; the count behind it is in two places:
 * - a stock app's script sets `_SIConfig.product.variants[i]['inventory_quantity'] = N;`
 *   for every variant, including sold-out ones, by index into `_SIConfig.product`;
 * - the theme's variant `<option>` carries `data-inventory="N"`, but only for
 *   the variants it lists (a sold-out one may be missing).
 * The script is read first; every option that is also present must agree with
 * it, or the page is not recognised. Without the script, the options alone are
 * read. A negative count (sold beyond stock) is not a count the page shows, so
 * that variant is recorded as read with no count (`null`): its line breaks
 * instead of holding an earlier count.
 */
const PRODUCT_LINE = /^[ \t]*_SIConfig\.product = (\{.*\});[ \t]*$/m;
const SCRIPT_COUNT = /_SIConfig\.product\.variants\[(\d+)\]\['inventory_quantity'\] = (-?\d+);/g;
const OPTION_TAG = /<option\b[^>]*>/g;

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

function scriptCounts(html: string, handle: string): Map<string, number> | null {
  const line = PRODUCT_LINE.exec(html);
  if (line === null) return null;
  const product = JSON.parse(line[1]!) as { handle?: unknown; variants?: unknown };
  if (product.handle !== handle) throw new Error(`page is for ${String(product.handle)}, not ${handle}`);
  if (!Array.isArray(product.variants) || product.variants.length === 0) throw new Error('product script has no variants');
  const ids = product.variants.map((v: { id?: unknown }) => {
    if (!Number.isSafeInteger(v.id)) throw new Error('product script variant without id');
    return String(v.id);
  });
  const counts = new Map<string, number>();
  for (const m of html.matchAll(SCRIPT_COUNT)) {
    const id = ids[Number(m[1])];
    if (id === undefined) throw new Error(`count for variant index ${m[1]} beyond ${ids.length} variants`);
    if (counts.has(id)) throw new Error(`variant ${id} counted twice`);
    counts.set(id, Number(m[2]));
  }
  if (counts.size === 0) throw new Error('product script has no counts');
  return counts;
}

function optionCounts(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [tag] of html.matchAll(OPTION_TAG)) {
    const inventory = attr(tag, 'data-inventory');
    if (inventory === null) continue;
    const id = attr(tag, 'value');
    if (id === null || !/^\d+$/.test(id) || !/^-?\d+$/.test(inventory)) throw new Error(`unrecognised variant option ${tag}`);
    if (counts.has(id)) throw new Error(`variant ${id} listed twice`);
    counts.set(id, Number(inventory));
  }
  return counts;
}

export const readM5StackProductPage: ProductPageReader = (html, target) => {
  const script = scriptCounts(html, target.key);
  const options = optionCounts(html);
  for (const [id, n] of options) {
    if (script !== null && script.has(id) && script.get(id) !== n) throw new Error(`variant ${id}: script ${script.get(id)} but option ${n}`);
  }
  const counts = script ?? options;
  if (counts.size === 0) throw new Error('no stock counts on the page');
  const out: Record<string, number | null> = {};
  for (const [id, n] of counts) out[id] = n >= 0 ? n : null;
  return out;
};
