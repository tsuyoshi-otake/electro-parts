import { createHash } from 'node:crypto';

/** Offline identity evidence only. Prices, stock and selling SKUs are not identity codes. */
export interface Listing {
  storeId: string; pageKey: string; name: string; modelNumber: string; url: string;
  manufacturer: string; manufacturerProductName: string; manufacturerProductCode: string; productCode: string; sku: string; codes: string[];
  expectedModels: string[]; observedAt: string;
  variants?: { offerId: string; sku: string; name: string }[];
  vendor?: string;
}
export interface Catalog {
  schemaVersion: 1;
  sources: { storeId: string; file: string; sha256: string; observedAt: string; count: number }[];
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

export function assertCatalog(catalog: Catalog): void {
  if (catalog.schemaVersion !== 1 || catalog.sources.length < 2) throw new Error('unsupported mapping catalogue');
  const sourceIds = new Set(catalog.sources.map(source => source.storeId));
  if (sourceIds.size !== catalog.sources.length || catalog.sources.some(source => !source.storeId || !source.file || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !Number.isFinite(Date.parse(source.observedAt)) || !Number.isSafeInteger(source.count) || source.count < 1)) throw new Error('invalid/duplicate source');
  const seen = new Set<string>();
  for (const p of catalog.listings) {
    const key = listingKey(p);
    if (!sourceIds.has(p.storeId)) throw new Error(`unknown source ${key}`);
    if (seen.has(key) || !p.name || !p.pageKey || !Number.isFinite(Date.parse(p.observedAt))) throw new Error(`invalid/duplicate listing ${key}`);
    seen.add(key);
    if (p.variants && (!p.variants.length || new Set(p.variants.map(v => v.offerId)).size !== p.variants.length
      || p.variants.some(v => !v.offerId || !v.name))) throw new Error(`invalid variants ${key}`);
    const url = new URL(p.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`unsafe listing ${key}`);
  }
  for (const source of catalog.sources) if (catalog.listings.filter(p => p.storeId === source.storeId).length !== source.count) throw new Error(`incomplete source ${source.storeId}`);
}

/** Each store is indexed once. Earlier sources retain their historical pair orientation. */
export function discoverCatalog(catalog: Catalog): Candidate[] {
  const previous: Listing[] = [];
  const result: Candidate[] = [];
  for (const source of catalog.sources) {
    const current = catalog.listings.filter(p => p.storeId === source.storeId);
    result.push(...discover(previous, current));
    previous.push(...current);
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
