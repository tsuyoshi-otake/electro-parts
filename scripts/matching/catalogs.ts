import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { validateM5StackRaw } from '../../src/adapters/m5stack/snapshotAdapter.ts';
import { m5stackPageKey, m5stackProductUrl } from '../../src/adapters/m5stack/identity.ts';
import type { M5StackSnapshot } from '../../src/adapters/m5stack/rawSchema.ts';
import { assertCatalog, hash, normalizeCode, type Catalog, type Listing } from './model.ts';

/** Append complete manufacturer evidence without silently refreshing reviewed retailer rows. */
export async function appendM5Stack(catalog: Catalog, file: string): Promise<Catalog> {
  assertCatalog(catalog);
  if (catalog.sources.some(s => s.storeId === 'm5stack')) throw new Error('M5Stack source already exists; explicit re-review required');
  const text = gunzipSync(await readFile(file)).toString('utf8');
  const raw = JSON.parse(text) as M5StackSnapshot;
  const validation = validateM5StackRaw(raw);
  if (validation.errors.length) throw new Error(`incomplete M5Stack catalogue: ${JSON.stringify(validation)}`);
  const listings: Listing[] = raw.items.map(p => {
    const variants = p.variants.map(v => ({ offerId: String(v.id), sku: v.sku ?? '', name: v.title }));
    const model = variants.length === 1 ? variants[0]!.sku : '';
    return { storeId: 'm5stack', pageKey: m5stackPageKey(p.handle), name: p.title, modelNumber: model,
      url: m5stackProductUrl(p.handle), manufacturer: p.vendor?.toLowerCase() === 'm5stack-store' ? 'M5Stack' : p.vendor ?? '', manufacturerProductName: p.title,
      manufacturerProductCode: model, productCode: '', sku: '', codes: identityCodes('m5stack', p.vendor ?? '', variants.map(v => v.sku)),
      expectedModels: [model], observedAt: raw.retrievedAt, variants, vendor: p.vendor ?? '' };
  });
  listings.sort((a, b) => a.pageKey < b.pageKey ? -1 : 1);
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
    const storeId = i === 0 ? 'akizuki' : 'switch-science';
    catalog.sources.push({ storeId, file: path.basename(file), sha256: hash(bytes.toString('utf8')), observedAt: raw.retrievedAt, count: raw.items.length });
    for (const item of raw.items) {
      const str = (key: string): string => typeof item[key] === 'string' ? item[key] as string : '';
      const modelNumber = str('modelNumber');
      const manufacturer = str('manufacturerName') || (i === 1 ? str('vendor') : modelNumber.startsWith('M5STACK-') ? 'M5Stack' : '');
      const listing: Listing = {
        storeId, pageKey: str('salesCode'), name: str('name'), modelNumber, manufacturer,
        manufacturerProductName: str('manufacturerProductName'), manufacturerProductCode: str('manufacturerProductCode'), productCode: str('productCode'), sku: str('sku'),
        url: str('url'), observedAt: raw.retrievedAt,
        codes: identityCodes(storeId, manufacturer, [modelNumber, str('manufacturerProductCode'), str('productCode')]
          .filter(value => i === 0 || !/^\d+$/.test(value) || (value !== str('sku') && value !== str('salesCode')))),
        expectedModels: [...new Set([modelNumber, ...(i === 1 && str('sku') ? [str('sku')] : [])])],
      };
      catalog.listings.push(listing);
    }
  }
  catalog.listings.sort((a, b) => `${a.storeId}/${a.pageKey}` < `${b.storeId}/${b.pageKey}` ? -1 : 1);
  assertCatalog(catalog); return catalog;
}
