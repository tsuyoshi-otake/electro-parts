import { createHash } from 'node:crypto';

/** Offline identity evidence only. Prices, stock and selling SKUs are not identity codes. */
export interface Listing {
  storeId: string; pageKey: string; name: string; modelNumber: string; url: string;
  manufacturer: string; manufacturerProductName: string; manufacturerProductCode: string; productCode: string; sku: string; codes: string[];
  expectedModels: string[]; observedAt: string;
  variants?: { offerId: string; sku: string; name: string }[];
  vendor?: string;
}
/**
 * One complete snapshot file. A listing belongs to the source with its storeId and observedAt.
 * A store's first source is its pinned catalogue; a later `supplement` adds only listings absent from earlier
 * sources plus rows the operator named explicitly, so reviewed rows keep their fingerprints.
 */
export interface Source {
  storeId: string; file: string; sha256: string; observedAt: string;
  /** Rows taken from the file (all of them for a pinned catalogue). */
  count: number;
  supplement?: { snapshotCount: number };
  /** Keys of this source's rows that a later supplement replaced after explicit review. */
  retired?: string[];
}
export interface Catalog {
  schemaVersion: 1;
  sources: Source[];
  listings: Listing[];
}
export interface Candidate { id: string; products: [Listing, Listing]; codes: string[]; fingerprint: string }
export interface Review {
  id: string; fingerprint: string; decision: 'same_product' | 'unresolved' | 'rejected';
  evidence: string; differences: string[]; missingEvidence: string[]; reviewedAt: string;
  offerIds?: [string | null, string | null];
  reviewerModel?: string;
  detailEvidence?: { url: string; sourceFile: string; sha256: string; finding: string };
}
export interface Family {
  id: string; label: string; purpose: string; reviewedAt: string;
  sources: string[];
  /** Each listing is explicitly reviewed. A name regex never enrols accessories. */
  members: { key: string; fingerprint: string; variant: string; features: Record<string, string> }[];
}
export const normalizeCode = (value: string): string => value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
export const listingKey = (p: Pick<Listing, 'storeId' | 'pageKey'>): string => `${p.storeId}/${p.pageKey}`;
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const fingerprint = (p: Listing): string => hash(JSON.stringify(p));
export const pairId = (a: Listing, b: Listing): string => a.storeId === 'akizuki' && b.storeId === 'switch-science'
  ? `a${a.pageKey}-s${b.pageKey}` : JSON.stringify([a.storeId, a.pageKey, b.storeId, b.pageKey]);
export const usefulCode = (code: string): boolean => code.length >= 4 && /\d/.test(code);

/** O(N + K) lookup plus O(R log R) output ordering. Never an N x M cross join. */
export function discover(left: readonly Listing[], right: readonly Listing[]): Candidate[] {
  const index = new Map<string, Listing[]>();
  for (const p of right) for (const code of new Set(p.codes)) {
    if (!usefulCode(code)) continue;
    const group = index.get(code) ?? []; group.push(p); index.set(code, group);
  }
  const candidates = new Map<string, Candidate>();
  for (const p of left) for (const code of new Set(p.codes)) {
    if (!usefulCode(code)) continue;
    for (const q of index.get(code) ?? []) {
      if (p.storeId === q.storeId) continue;
      // Missing manufacturer is reviewable; contradictory known makers are not.
      if (p.manufacturer && q.manufacturer && normalizeCode(p.manufacturer) !== normalizeCode(q.manufacturer)) continue;
      const id = pairId(p, q);
      const existing = candidates.get(id);
      if (existing) existing.codes.push(code);
      else candidates.set(id, { id, products: [p, q], codes: [code], fingerprint: hash(fingerprint(p) + fingerprint(q)) });
    }
  }
  return [...candidates.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Stores in first-source order; pair orientation follows it. */
export const catalogStores = (catalog: Pick<Catalog, 'sources'>): string[] => [...new Set(catalog.sources.map(source => source.storeId))];
const sourceKey = (storeId: string, observedAt: string): string => `${storeId}\n${observedAt}`;

export function assertCatalog(catalog: Catalog): void {
  if (catalog.schemaVersion !== 1 || catalogStores(catalog).length < 2) throw new Error('unsupported mapping catalogue');
  const sources = new Map<string, Source>();
  const latest = new Map<string, number>();
  for (const source of catalog.sources) {
    const key = sourceKey(source.storeId, source.observedAt);
    const at = Date.parse(source.observedAt);
    if (sources.has(key) || !source.storeId || !source.file || !/^[a-f0-9]{64}$/.test(source.sha256)
      || !Number.isFinite(at) || !Number.isSafeInteger(source.count) || source.count < 1) throw new Error('invalid/duplicate source');
    // A supplement follows an earlier, older source of the same store; a pinned catalogue comes first.
    if (Boolean(source.supplement) !== latest.has(source.storeId) || (latest.has(source.storeId) && at <= latest.get(source.storeId)!)
      || (source.supplement && (!Number.isSafeInteger(source.supplement.snapshotCount) || source.supplement.snapshotCount < source.count))) throw new Error(`invalid supplement order ${source.storeId}`);
    sources.set(key, source); latest.set(source.storeId, at);
  }
  const seen = new Map<string, Listing>();
  const attributed = new Map<string, number>();
  for (const p of catalog.listings) {
    const key = listingKey(p);
    const source = sources.get(sourceKey(p.storeId, p.observedAt));
    if (!source) throw new Error(`unknown source ${key}`);
    if (seen.has(key) || !p.name || !p.pageKey || !Number.isFinite(Date.parse(p.observedAt))) throw new Error(`invalid/duplicate listing ${key}`);
    seen.set(key, p);
    attributed.set(sourceKey(p.storeId, p.observedAt), (attributed.get(sourceKey(p.storeId, p.observedAt)) ?? 0) + 1);
    if (p.variants && (!p.variants.length || new Set(p.variants.map(v => v.offerId)).size !== p.variants.length
      || p.variants.some(v => !v.offerId || !v.name))) throw new Error(`invalid variants ${key}`);
    const url = new URL(p.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`unsafe listing ${key}`);
  }
  for (const [key, source] of sources) {
    const retired = source.retired ?? [];
    // A retired row was replaced by a later source of the same store, never deleted.
    if (new Set(retired).size !== retired.length || retired.some(k => {
      const row = seen.get(k);
      return !row || row.storeId !== source.storeId || !(Date.parse(row.observedAt) > Date.parse(source.observedAt));
    })) throw new Error(`invalid retired rows ${source.storeId}`);
    if ((attributed.get(key) ?? 0) + retired.length !== source.count) throw new Error(`incomplete source ${source.storeId}`);
  }
}

/** Each store is indexed once. Earlier sources retain their historical pair orientation. */
export function discoverCatalog(catalog: Catalog): Candidate[] {
  const previous: Listing[] = [];
  const result: Candidate[] = [];
  for (const storeId of catalogStores(catalog)) {
    const current = catalog.listings.filter(p => p.storeId === storeId);
    result.push(...discover(previous, current));
    previous.push(...current);
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
