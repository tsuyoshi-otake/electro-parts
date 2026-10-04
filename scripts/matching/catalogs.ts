import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { validateAkizukiRaw } from '../../src/adapters/akizuki/snapshotAdapter.ts';
import type { AkizukiRawSnapshot } from '../../src/adapters/akizuki/rawSchema.ts';
import { validateM5StackRaw } from '../../src/adapters/m5stack/snapshotAdapter.ts';
import { m5stackPageKey, m5stackProductUrl } from '../../src/adapters/m5stack/identity.ts';
import type { M5StackItem, M5StackSnapshot } from '../../src/adapters/m5stack/rawSchema.ts';
import { validateSwitchScienceRaw } from '../../src/adapters/switch-science/snapshotAdapter.ts';
import type { SwitchScienceRawItem, SwitchScienceRawSnapshot } from '../../src/adapters/switch-science/rawSchema.ts';
import { assertCatalog, hash, listingKey, normalizeCode, type Catalog, type Listing } from './model.ts';

type RetailerStore = 'akizuki' | 'switch-science';
const order = (a: Listing, b: Listing): number => listingKey(a) < listingKey(b) ? -1 : 1;

/** Saved-catalogue item fields (old scraper shape) projected to identity evidence. Prices and stock never enter. */
function retailerListing(storeId: RetailerStore, item: Record<string, unknown>, observedAt: string): Listing {
  const str = (key: string): string => typeof item[key] === 'string' ? item[key] as string : '';
  const ss = storeId === 'switch-science';
  const modelNumber = str('modelNumber');
  const manufacturer = str('manufacturerName') || (ss ? str('vendor') : modelNumber.startsWith('M5STACK-') ? 'M5Stack' : '');
  return {
    storeId, pageKey: str('salesCode'), name: str('name'), modelNumber, manufacturer,
    manufacturerProductName: str('manufacturerProductName'), manufacturerProductCode: str('manufacturerProductCode'), productCode: str('productCode'), sku: str('sku'),
    url: str('url'), observedAt,
    codes: identityCodes(storeId, manufacturer, [modelNumber, str('manufacturerProductCode'), str('productCode')]
      .filter(value => !ss || !/^\d+$/.test(value) || (value !== str('sku') && value !== str('salesCode')))),
    expectedModels: [...new Set([modelNumber, ...(ss && str('sku') ? [str('sku')] : [])])],
  };
}

function m5stackListing(p: M5StackItem, observedAt: string): Listing {
  const variants = p.variants.map(v => ({ offerId: String(v.id), sku: v.sku ?? '', name: v.title }));
  const model = variants.length === 1 ? variants[0]!.sku : '';
  return { storeId: 'm5stack', pageKey: m5stackPageKey(p.handle), name: p.title, modelNumber: model,
    url: m5stackProductUrl(p.handle), manufacturer: p.vendor?.toLowerCase() === 'm5stack-store' ? 'M5Stack' : p.vendor ?? '', manufacturerProductName: p.title,
    manufacturerProductCode: model, productCode: '', sku: '', codes: identityCodes('m5stack', p.vendor ?? '', variants.map(v => v.sku)),
    expectedModels: [model], observedAt, variants, vendor: p.vendor ?? '' };
}

/**
 * Current Switch Science collector item → the old saved-catalogue fields. The store's Shopify tags carry the
 * manufacturer evidence (`mfr:name:`, `mfr:prod:code:`, `mfr:prod:name:`, `code:`); `code:prefix:` is a grouping tag.
 * The old catalogue's modelNumber is the manufacturer code, or the store's code when the manufacturer code is empty,
 * and its names have whitespace runs collapsed (none of its 10,343 names holds two spaces; 125 current titles do).
 */
function switchScienceItem(i: SwitchScienceRawItem): Record<string, unknown> {
  const tags = i.tags ?? [];
  const tag = (prefix: string): string => (tags.find(t => t.startsWith(prefix) && !t.startsWith('code:prefix:')) ?? '').slice(prefix.length);
  return { salesCode: i.handle, name: i.title.replace(/\s+/g, ' ').trim(), url: i.url, vendor: i.vendor ?? '', modelNumber: tag('mfr:prod:code:') || tag('code:'), productCode: tag('code:'),
    manufacturerName: tag('mfr:name:'), manufacturerProductCode: tag('mfr:prod:code:'), manufacturerProductName: tag('mfr:prod:name:'), sku: i.variants[0]?.sku ?? '' };
}

/** Append complete manufacturer evidence without silently refreshing reviewed retailer rows. */
export async function appendM5Stack(catalog: Catalog, file: string): Promise<Catalog> {
  assertCatalog(catalog);
  if (catalog.sources.some(s => s.storeId === 'm5stack')) throw new Error('M5Stack source already exists; explicit re-review required');
  const text = gunzipSync(await readFile(file)).toString('utf8');
  const raw = JSON.parse(text) as M5StackSnapshot;
  const validation = validateM5StackRaw(raw);
  if (validation.errors.length) throw new Error(`incomplete M5Stack catalogue: ${JSON.stringify(validation)}`);
  const listings = raw.items.map(p => m5stackListing(p, raw.retrievedAt)).sort(order);
  const result: Catalog = { ...catalog, sources: [...catalog.sources, { storeId: 'm5stack', file: path.basename(file), sha256: hash(text), observedAt: raw.retrievedAt, count: listings.length }], listings: [...catalog.listings, ...listings] };
  assertCatalog(result); return result;
}

/** Only observed, manufacturer-scoped shop prefixes; revision suffixes are untouched. */
export function identityCodes(storeId: string, manufacturer: string, values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map(value => {
    const code = normalizeCode(value);
    if ((storeId === 'akizuki' && code.startsWith('M5STACK-')) || (manufacturer === 'M5Stack' && code.startsWith('M5STACK-'))) return code.slice(8);
    if (manufacturer === 'Raspberry Pi Trading' && /^RPI-SC\d+$/.test(code)) return code.slice(4);
    if (manufacturer === 'DFRobot' && /^DFROBOT-(DFR|SEN|FIT|DRI)\d/.test(code)) return code.slice(8);
    if (manufacturer === 'Arduino' && /^ARDUINO-(ABX|A|AKX|AFX|ASX|K|X)\d/.test(code)) return code.slice(8);
    if (storeId === 'akizuki' && /^SKU:?\d+$/.test(code)) return code.replace(/^SKU:?/, '');
    return code;
  }))].sort();
}

/** Explicit import command, not part of a crawl or build. Full snapshots stay local. */
export async function importCatalogs(files: readonly [string, string]): Promise<Catalog> {
  const catalog: Catalog = { schemaVersion: 1, sources: [], listings: [] };
  for (const [i, file] of files.entries()) {
    const bytes = await readFile(file);
    const raw = JSON.parse(bytes.toString('utf8')) as { complete: boolean; retrievedAt: string; items: Record<string, unknown>[] };
    if (raw.complete !== true || !Array.isArray(raw.items)) throw new Error(`incomplete saved catalogue: ${file}`);
    const storeId: RetailerStore = i === 0 ? 'akizuki' : 'switch-science';
    catalog.sources.push({ storeId, file: path.basename(file), sha256: hash(bytes.toString('utf8')), observedAt: raw.retrievedAt, count: raw.items.length });
    for (const item of raw.items) catalog.listings.push(retailerListing(storeId, item, raw.retrievedAt));
  }
  catalog.listings.sort(order);
  assertCatalog(catalog); return catalog;
}

/** A complete snapshot file projected to listings; `text` is hashed into the source. */
export interface SnapshotListings { text: string; observedAt: string; listings: Listing[] }

/** One complete collector snapshot projected to listings, after the store's own completeness validation. */
export async function snapshotListings(storeId: string, file: string): Promise<SnapshotListings> {
  const bytes = await readFile(file);
  const text = (file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
  const raw = JSON.parse(text) as { retrievedAt: string };
  const errors = (storeId === 'akizuki' ? validateAkizukiRaw(raw) : storeId === 'switch-science' ? validateSwitchScienceRaw(raw)
    : storeId === 'm5stack' ? validateM5StackRaw(raw) : { errors: [`unknown store ${storeId}`] }).errors;
  if (errors.length) throw new Error(`incomplete ${storeId} snapshot: ${errors.slice(0, 3).join('; ')}`);
  const listings = storeId === 'akizuki'
    ? (raw as AkizukiRawSnapshot).items.map(i => retailerListing('akizuki', { salesCode: i.salesCode, modelNumber: i.modelNumber, name: i.name, url: i.url }, raw.retrievedAt))
    : storeId === 'switch-science'
      ? (raw as SwitchScienceRawSnapshot).items.map(i => retailerListing('switch-science', switchScienceItem(i), raw.retrievedAt))
      : (raw as M5StackSnapshot).items.map(p => m5stackListing(p, raw.retrievedAt));
  return { text, observedAt: raw.retrievedAt, listings };
}

export interface SupplementReport {
  storeId: string; file: string; observedAt: string; snapshotCount: number;
  added: number; replaced: { key: string; changed: Record<string, [unknown, unknown]> }[];
  /** Present in both; the pinned row is kept, whatever changed. */
  keptPinned: number; keptPinnedWithChanges: number;
  /** Pinned rows the newer snapshot no longer lists. They stay as the reviewed evidence. */
  absentFromSnapshot: string[];
}

/**
 * Supplement a store with a newer complete snapshot. Only listings absent from every earlier source are added.
 * A pinned row changes only when its key is named in `replace`, and the old row is recorded as retired on its source.
 * Reviews that cite a replaced row become stale and must be re-reviewed; nothing is re-approved here.
 */
export function appendSupplement(catalog: Catalog, storeId: string, file: string, snapshot: SnapshotListings, replace: ReadonlySet<string>): { catalog: Catalog; report: SupplementReport } {
  assertCatalog(catalog);
  const pinned = new Map(catalog.listings.map(p => [listingKey(p), p]));
  const fresh = new Map(snapshot.listings.map(p => [listingKey(p), p]));
  if (fresh.size !== snapshot.listings.length) throw new Error(`duplicate listing in ${storeId} snapshot`);
  for (const key of replace) {
    if (!key.startsWith(`${storeId}/`)) continue;
    const before = pinned.get(key); const after = fresh.get(key);
    if (!before || !after) throw new Error(`replace needs the row in both catalogues: ${key}`);
    if (JSON.stringify({ ...before, observedAt: '' }) === JSON.stringify({ ...after, observedAt: '' })) throw new Error(`replace without an identity change: ${key}`);
  }
  const diff = (a: Listing, b: Listing): Record<string, [unknown, unknown]> => Object.fromEntries((Object.keys({ ...a, ...b }) as (keyof Listing)[])
    .filter(k => k !== 'observedAt' && JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => [k, [a[k], b[k]]]));
  const report: SupplementReport = { storeId, file: path.basename(file), observedAt: snapshot.observedAt, snapshotCount: snapshot.listings.length,
    added: 0, replaced: [], keptPinned: 0, keptPinnedWithChanges: 0, absentFromSnapshot: [] };
  const added: Listing[] = [];
  const replacements = new Map<string, Listing>();
  const retired = new Map<string, string[]>();
  for (const p of snapshot.listings) {
    const key = listingKey(p); const old = pinned.get(key);
    if (!old) { added.push(p); report.added++; continue; }
    if (!replace.has(key)) { report.keptPinned++; if (Object.keys(diff(old, p)).length) report.keptPinnedWithChanges++; continue; }
    replacements.set(key, p); report.replaced.push({ key, changed: diff(old, p) });
    retired.set(old.observedAt, [...(retired.get(old.observedAt) ?? []), key]);
  }
  for (const p of catalog.listings) if (p.storeId === storeId && !fresh.has(listingKey(p))) report.absentFromSnapshot.push(listingKey(p));
  if (!added.length && !replacements.size) throw new Error(`supplement adds nothing: ${storeId}`);
  const sources = catalog.sources.map(source => source.storeId === storeId && retired.has(source.observedAt)
    ? { ...source, retired: [...(source.retired ?? []), ...retired.get(source.observedAt)!].sort() } : source);
  sources.push({ storeId, file: path.basename(file), sha256: hash(snapshot.text), observedAt: snapshot.observedAt, count: added.length + replacements.size, supplement: { snapshotCount: snapshot.listings.length } });
  // Replaced rows stay in place and added rows follow, so existing lines of catalog.jsonl do not move.
  const listings = [...catalog.listings.map(p => replacements.get(listingKey(p)) ?? p), ...added.sort(order)];
  const result: Catalog = { ...catalog, sources, listings };
  assertCatalog(result);
  return { catalog: result, report };
}

/** Apply supplements in order. Every `replace` key must be replaced by one of them, so a typo cannot pass silently. */
export function applySupplements(catalog: Catalog, steps: readonly { storeId: string; file: string; snapshot: SnapshotListings }[], replace: ReadonlySet<string>): { catalog: Catalog; reports: SupplementReport[] } {
  let next = catalog;
  const reports: SupplementReport[] = [];
  for (const step of steps) {
    const applied = appendSupplement(next, step.storeId, step.file, step.snapshot, replace);
    next = applied.catalog; reports.push(applied.report);
  }
  const unused = [...replace].filter(key => !reports.some(r => r.replaced.some(x => x.key === key)));
  if (unused.length) throw new Error(`--replace names rows no supplement replaced: ${unused.join(', ')}`);
  return { catalog: next, reports };
}
