import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildExtension, buildExtensionFiles, extensionManifest, ICON_SIZES, type ExtensionFile } from '../../scripts/build-extension.ts';
import { buildUserscript, USERSCRIPT_FILE_NAME } from '../../scripts/build-userscript.ts';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { relationProductKey } from '../../userscript/core/relations.ts';
import { RELATION_INDEX_FILE, RELATION_SHARD_COUNT, relationShardFile, relationShardIn, relationsInShard } from '../../userscript/core/relationShards.ts';
import { packRelations, type PackedRelationTable } from '../../userscript/core/relationTable.ts';

/**
 * The relation table is data in the package, not code in the page: content.js carries none of it,
 * and the service worker reads the index and one shard file per page.
 */

let files: ExtensionFile[];
const text = (name: string): string => files.find((f) => f.name === name)?.data.toString('utf8') ?? '';
const bytes = (name: string): number => files.find((f) => f.name === name)?.data.length ?? 0;
const shardNames = Array.from({ length: RELATION_SHARD_COUNT }, (_, shard) => relationShardFile(shard));

/** A stretch of a reviewed rationale that survives JSON and template-literal escaping unchanged. */
const sample = PRODUCT_RELATIONS.map((r) => r.evidence.slice(0, 60)).find((s) => /^[^\\"`$\n]{40,}$/.test(s));

beforeAll(async () => {
  files = await buildExtensionFiles();
}, 120_000);

describe('extension package', () => {
  it('holds exactly the previous files plus the relation index and the 64 shard files, in a stable order', () => {
    const names = files.map((f) => f.name);
    const before = 3 + ICON_SIZES.length;
    expect(names.slice(0, before)).toEqual(['manifest.json', 'background.js', 'content.js', ...ICON_SIZES.map((s) => `icons/icon-${s}.png`)]);
    expect(names.slice(before)).toEqual([RELATION_INDEX_FILE, ...shardNames]);
    expect(names).toHaveLength(before + 1 + 64);
    expect(new Set(names).size).toBe(names.length);
    expect(RELATION_INDEX_FILE).toBe('relations/index.json');
    expect(shardNames[0]).toBe('relations/shard-00.json');
    expect(shardNames[63]).toBe('relations/shard-63.json');
  });

  it('writes compact JSON that gives each product the relations the table gives, through the index', () => {
    const rawIndex = text(RELATION_INDEX_FILE);
    const index = JSON.parse(rawIndex) as unknown;
    expect(JSON.stringify(index)).toBe(rawIndex);
    const tables = shardNames.map((name) => {
      const raw = text(name);
      expect(raw.length, name).toBeGreaterThan(0);
      const table = JSON.parse(raw) as PackedRelationTable;
      expect(JSON.stringify(table), name).toBe(raw);
      return table;
    });
    const keys = new Set(PRODUCT_RELATIONS.flatMap((r) => r.products.map((p) => relationProductKey(p.storeId, p.pageKey))));
    let checked = 0;
    for (const key of keys) {
      const [storeId, pageKey] = JSON.parse(key) as [string, string];
      const shard = relationShardIn(index, storeId, pageKey);
      expect(shard, key).not.toBeNull();
      if (checked++ % 5 === 0) {
        expect(relationsInShard(tables[shard!]!, storeId, pageKey), key).toEqual(PRODUCT_RELATIONS.filter((r) => r.products.some((p) => p.storeId === storeId && p.pageKey === pageKey)));
      }
    }
    expect(checked).toBe(keys.size);
  });

  it('keeps the shards from repeating what the table says: every relation once, so about the size of the whole table', () => {
    const total = shardNames.reduce((sum, name) => sum + bytes(name), 0);
    const whole = Buffer.byteLength(JSON.stringify(packRelations(PRODUCT_RELATIONS)), 'utf8');
    expect(total).toBeLessThan(whole * 1.3);
  });

  it('keeps the relation data out of content.js and background.js', () => {
    expect(sample).toBeDefined();
    expect(shardNames.map(text).join('\n')).toContain(sample!);
    for (const name of ['content.js', 'background.js']) {
      expect(text(name), name).not.toContain(sample!);
      expect(text(name), name).not.toContain('unpackRelations(JSON.parse(');
      expect(text(name), name).not.toContain('PRODUCT_RELATIONS');
    }
    expect(bytes('content.js')).toBeLessThan(300_000);
  });

  it('says in the banner where the table is', () => {
    for (const name of ['content.js', 'background.js']) {
      const banner = text(name).slice(0, text(name).indexOf('*/'));
      expect(banner, name).toContain('relations/');
      expect(banner, name).not.toContain('Most of content.js');
    }
  });

  it('asks for no new permission and exposes no packaged file to pages', () => {
    const manifest = JSON.parse(text('manifest.json')) as Record<string, unknown>;
    expect(Object.keys(manifest)).toEqual(['manifest_version', 'name', 'version', 'description', 'homepage_url', 'minimum_chrome_version', 'icons', 'permissions', 'host_permissions', 'background', 'content_scripts']);
    expect(manifest).not.toHaveProperty('web_accessible_resources');
    expect(manifest['permissions']).toEqual(['storage']);
    expect(manifest['host_permissions']).toEqual(extensionManifest().host_permissions);
    expect(manifest).toEqual(extensionManifest());
  });

  // The bound follows the table, so a larger reviewed table does not trip it and a wasteful layout does:
  // 0.27 of the whole table's JSON with whole components per shard (2026-11-10), 0.61 with a relation
  // stored in the shard of each of its two products.
  it('packs into a zip smaller than 0.32 of the whole table as JSON', async () => {
    const whole = Buffer.byteLength(JSON.stringify(packRelations(PRODUCT_RELATIONS)), 'utf8');
    const dir = await mkdtemp(path.join(tmpdir(), 'eph-extension-'));
    try {
      const built = await buildExtension(path.join(dir, 'out'), path.join(dir, 'extension.zip'));
      expect(built.zip?.bytes).toBeGreaterThan(0);
      expect(built.zip!.bytes).toBeLessThan(whole * 0.32);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('userscript build', () => {
  it('still carries the table inline, one file, indexed lazily', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'eph-userscript-'));
    try {
      const built = await buildUserscript(dir);
      const code = await readFile(path.join(dir, USERSCRIPT_FILE_NAME), 'utf8');
      expect(built.bytes).toBeGreaterThan(1_000_000);
      expect(code).toContain(sample!);
      expect(code).toContain('unpackRelations(JSON.parse(');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
