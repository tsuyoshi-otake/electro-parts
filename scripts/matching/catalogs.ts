import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertCatalog, hash, normalizeCode, type Catalog, type Listing } from './model.ts';

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
