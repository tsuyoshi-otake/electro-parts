import { catalogStores, compatibleMakers, listingKey, pairId, usefulCode, type Catalog, type Listing } from './model.ts';

/**
 * Name-based discovery (ADR-0018 0.6.5): pairs the code keys cannot find because one of the two listings has no code
 * of its own, while both names carry the same rare model-like token (秋月 「タイマーIC NJM555D」 and せんごく
 * 「タイマーIC NJM555D」 with an empty model field). A proposal is not a candidate: the pair is searched only through
 * a reviewed alias and then reviewed like any other. Listings that both have codes of their own are proposed only as
 * similar-product leads (`proposeSimilar`, 0.6.6 and 0.6.7).
 */
export interface NameProposal { id: string; products: [string, string]; tokens: string[]; similarity: number }
export interface NameDiscovery {
  /** A token in more listings than this names a chip, standard or series, not one product. */
  maxListings: number;
  /**
   * A pair is kept when either listing ranks the other among its `perListing` most similar listings of that shop.
   * Known pairs are ranked too, so the kept pairs do not depend on what is already reviewed and reviewing drains the queue.
   */
  perListing: number;
  /** Least character-trigram Dice of the two cleaned names. */
  minSimilarity: number;
}
/**
 * Measured on the 2026-11-02 catalogue (ADR-0018 0.6.5): 11 of 15 sampled pairs at similarity 0.3 or more were the
 * same product and 1 of 15 between 0.2 and 0.3; none of 30 below 0.2, nor 20 found through tokens in 21 to 40 listings.
 */
export const NAME_DISCOVERY: NameDiscovery = { maxListings: 20, perListing: 2, minSimilarity: 0.2 };

/** Shop notes that say nothing about the product: 《お取り寄せ商品》, 【取寄せ品】 and other bracketed labels, [EOL], --販売終了. */
const SHOP_NOTE = /《[^》]*》|【[^】]*】|\[EOL\]|--(?:販売終了|在庫限り)$/g;
export const cleanName = (p: Pick<Listing, 'name'>): string => p.name.normalize('NFKC').toUpperCase().replace(SHOP_NOTE, ' ').replace(/\s+/g, ' ').trim();

const UNIT = 'V|MV|KV|A|MA|UA|MAH|AH|W|MW|KW|HZ|KHZ|MHZ|GHZ|M|MM|CM|UM|NM|KG|G|MG|P|PIN|PINS|K|MP|BIT|KB|MB|GB|TB|PCS|PC|CH|DB|DPI|FPS|RPM|N|LM|LX|C|F|UF|NF|PF|UH|MH|H|OHM|S|MS|US|L|ML|IN|INCH|AWG';
/** Measurements and counts name a property, not a product: `5V`, `5V3A`, `3.3V`, `100MHZ`, `2X20`, `4-PIN`, `AWG22`, `V2.1`. */
const MEASUREMENT = new RegExp(`^(?:(?:\\d+(?:\\.\\d+)?(?:${UNIT}))+|\\d+X\\d+|\\d+-(?:PIN|PINS|P|CH|CHANNEL|WAY)|AWG\\d+|V(?:ER)?\\d+(?:\\.\\d+)*)$`);
const trimPunctuation = (s: string): string => s.replace(/^[-+./]+|[-+./]+$/g, '');

/** Letter-and-digit words of the cleaned name, and each `/` alternative of one (`DHT12/BMP280/BMM150`). */
export function nameTokens(p: Pick<Listing, 'name'>): string[] {
  const tokens = new Set<string>();
  for (const word of cleanName(p).split(/[^A-Z0-9\-+./]+/)) {
    const whole = trimPunctuation(word);
    for (const token of whole.includes('/') ? [whole, ...whole.split('/').map(trimPunctuation)] : [whole]) {
      if (token.length >= 4 && /[A-Z]/.test(token) && /\d/.test(token) && !MEASUREMENT.test(token)) tokens.add(token);
    }
  }
  return [...tokens];
}

const trigrams = (s: string): Set<string> => {
  const text = s.replace(/\s/g, '');
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= text.length; i++) grams.add(text.slice(i, i + 3));
  return grams;
};
const dice = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return a.size + b.size ? Math.round(2000 * shared / (a.size + b.size)) / 1000 : 0;
};

type OwnCodes = (p: Listing) => readonly string[];

/**
 * Pairs of listings from different shops with compatible makers whose names share a model-like token in at most
 * `maxListings` listings, oriented by catalogue store order. `bothCoded` picks the pairs where both listings have codes
 * of their own (similar-product leads) or the others (identity leads).
 *
 * O(N·L) to read the names and O(Σ min(df, maxListings)²) ≤ O(N·T·maxListings) to pair listings inside each token's
 * block (T tokens per listing). Never an N × M cross join.
 */
function tokenPairs(catalog: Catalog, ownCodes: OwnCodes, maxListings: number, bothCoded: boolean): Map<string, { products: [Listing, Listing]; tokens: string[] }> {
  const storeOrder = new Map(catalogStores(catalog).map((storeId, i) => [storeId, i]));
  const coded = new Map<Listing, boolean>();
  const blocks = new Map<string, Listing[]>();
  for (const p of catalog.listings) {
    const codes = ownCodes(p).filter(usefulCode);
    coded.set(p, codes.length > 0);
    // A name may carry the other listing's code, so a listing's own codes join its name tokens.
    for (const token of new Set([...nameTokens(p), ...codes])) {
      const block = blocks.get(token) ?? []; block.push(p); blocks.set(token, block);
    }
  }
  const pairs = new Map<string, { products: [Listing, Listing]; tokens: string[] }>();
  for (const [token, block] of blocks) {
    if (block.length > maxListings) continue;
    for (let i = 0; i < block.length; i++) for (let j = i + 1; j < block.length; j++) {
      const [a, b] = storeOrder.get(block[i]!.storeId)! <= storeOrder.get(block[j]!.storeId)! ? [block[i]!, block[j]!] : [block[j]!, block[i]!];
      if (a.storeId === b.storeId || Boolean(coded.get(a) && coded.get(b)) !== bothCoded || !compatibleMakers(a, b)) continue;
      const id = pairId(a, b);
      const pair = pairs.get(id) ?? { products: [a, b], tokens: [] };
      pair.tokens.push(token); pairs.set(id, pair);
    }
  }
  return pairs;
}

/**
 * Identity leads. `known`: pair ids the code keys, aliases or families already hold. `ownCodes`: a listing's codes from
 * its own fields (stored and derived, not aliases), which decide whether code discovery could have paired it.
 * Two listings with codes of their own that the code keys leave apart are at best similar products: 1 of 87 sampled
 * such pairs was the same product (ADR-0018 0.6.5), so they are left to `proposeSimilar`.
 *
 * `tokenPairs`, then O(P log P) to rank the P blocked pairs.
 */
export function proposeByName(catalog: Catalog, known: ReadonlySet<string>, ownCodes: OwnCodes, options: NameDiscovery = NAME_DISCOVERY): NameProposal[] {
  const pairs = tokenPairs(catalog, ownCodes, options.maxListings, false);
  const grams = new Map<Listing, Set<string>>();
  const gramsOf = (p: Listing): Set<string> => grams.get(p) ?? grams.set(p, trigrams(cleanName(p))).get(p)!;
  const scored = [...pairs].map(([id, { products, tokens }]) => ({ id, products, tokens: tokens.sort(), similarity: dice(gramsOf(products[0]), gramsOf(products[1])) }));
  const ranked = new Map<string, typeof scored>();
  for (const pair of scored) for (const [p, q] of [pair.products, [pair.products[1], pair.products[0]]] as const) {
    const key = `${listingKey(p)}\n${q.storeId}`;
    const list = ranked.get(key) ?? []; list.push(pair); ranked.set(key, list);
  }
  const kept = new Set<string>();
  for (const list of ranked.values()) {
    list.sort((x, y) => y.similarity - x.similarity || (x.id < y.id ? -1 : 1));
    for (const pair of list.slice(0, options.perListing)) kept.add(pair.id);
  }
  return scored.filter(pair => kept.has(pair.id) && pair.similarity >= options.minSimilarity && !known.has(pair.id))
    .map(({ id, products, tokens, similarity }): NameProposal => ({ id, products: [listingKey(products[0]), listingKey(products[1])], tokens, similarity }))
    .sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
}

/**
 * A code and its prefixes at `-` boundaries that are model-like codes themselves: `AI-003-PRO` → `AI-003`, `AI-003-PRO`.
 * A stem needs a letter, so a book's ISBN prefix (`978-4-8222`) names no product line.
 */
export function codeStems(codes: readonly string[]): string[] {
  const stems = new Set<string>();
  for (const code of codes.filter(usefulCode)) {
    const parts = code.split('-');
    for (let i = 1; i <= parts.length; i++) {
      const stem = parts.slice(0, i).join('-');
      if (usefulCode(stem) && /[A-Z]/.test(stem)) stems.add(stem);
    }
  }
  return [...stems];
}

export interface SimilarProposal { id: string; products: [string, string]; tokens: string[]; stems: string[] }
export interface SimilarDiscovery {
  /** As `NAME_DISCOVERY.maxListings`: a name token in more listings names a chip, standard or series. */
  maxListings: number;
  /**
   * A base code that more listings carry as a stem names a product range, not one line: `C008` covers ATOM Lite,
   * Matrix and Voice, `U078` both UnitV and UnitV2.
   */
  maxStemListings: number;
}
/**
 * Measured on the 2026-11-02 catalogue (ADR-0018 0.6.7): of pairs found only through a base code, 23 of 24 sampled were
 * similar when at most 10 listings carried the stem, and 7 of 12 with 11 to 20.
 */
export const SIMILAR_DISCOVERY: SimilarDiscovery = { maxListings: NAME_DISCOVERY.maxListings, maxStemListings: 10 };

/**
 * Similar-product leads: two listings from different shops, with different codes of their own that share a stem.
 * - 0.6.6: their names share a rare model-like token, such as UnitV2 `U078-M12` and `U078-USB`.
 * - 0.6.7: one listing's own code is the stem the other code extends (CardKB `U035` and `U035-B`), and at most
 *   `maxStemListings` listings carry it, even when the names share no token (「カード型キーボードユニット」 and 「CardKB Mini」).
 * A lead is not a candidate: a review only adds it to a family or dismisses it. Name pairs without a shared stem
 * (another maker's board around the same chip) are not proposed: of 82 sampled on 2026-11-02, 36 were similar and 37
 * unrelated (ADR-0018 0.6.6). Two codes that both extend a stem (`MK-617-5`, `MK-617-6`) need the name token.
 *
 * `tokenPairs`, plus O(N·C·K) for the stems and O(Σ min(df, maxStemListings)²) to pair listings inside each stem's
 * block (C codes of K parts per listing), then O(C·K) per pair. Never an N × M cross join.
 */
export function proposeSimilar(catalog: Catalog, known: ReadonlySet<string>, ownCodes: OwnCodes, options: SimilarDiscovery = SIMILAR_DISCOVERY): SimilarProposal[] {
  const stems = new Map<Listing, Set<string>>();
  const stemsOf = (p: Listing): Set<string> => stems.get(p) ?? stems.set(p, new Set(codeStems(ownCodes(p)))).get(p)!;
  const pairs = new Map<string, { products: [Listing, Listing]; tokens: string[] }>(tokenPairs(catalog, ownCodes, options.maxListings, true));
  const storeOrder = new Map(catalogStores(catalog).map((storeId, i) => [storeId, i]));
  const blocks = new Map<string, Listing[]>();
  for (const p of catalog.listings) for (const stem of stemsOf(p)) {
    const block = blocks.get(stem) ?? []; block.push(p); blocks.set(stem, block);
  }
  for (const [stem, block] of blocks) {
    if (block.length > options.maxStemListings) continue;
    for (let i = 0; i < block.length; i++) for (let j = i + 1; j < block.length; j++) {
      const [a, b] = storeOrder.get(block[i]!.storeId)! <= storeOrder.get(block[j]!.storeId)! ? [block[i]!, block[j]!] : [block[j]!, block[i]!];
      if (a.storeId === b.storeId || !compatibleMakers(a, b) || !(ownCodes(a).includes(stem) || ownCodes(b).includes(stem))) continue;
      const id = pairId(a, b);
      if (!pairs.has(id)) pairs.set(id, { products: [a, b], tokens: [] });
    }
  }
  const proposals: SimilarProposal[] = [];
  for (const [id, { products: [a, b], tokens }] of pairs) {
    const shared = [...stemsOf(a)].filter(stem => stemsOf(b).has(stem));
    if (shared.length && !known.has(id)) proposals.push({ id, products: [listingKey(a), listingKey(b)], tokens: [...tokens].sort(), stems: shared.sort() });
  }
  return proposals.sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
}
