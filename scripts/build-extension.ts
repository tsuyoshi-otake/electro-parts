/**
 * Builds the Chrome extension (MV3) from the same sources as the userscript.
 *
 * The manifest is generated, never hand-written: `content_scripts[].matches`
 * comes from the adapter registry and `host_permissions` from the data origin,
 * exactly as the userscript's `@match` / `@connect` header lines do. A store
 * without an adapter therefore cannot appear in the manifest, and the
 * extension cannot ask for a host it does not read.
 *
 *   node --import tsx scripts/build-extension.ts [--out DIR] [--zip FILE]
 */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PAGE_ADAPTERS } from '../userscript/adapters/registry.ts';
import { DATA_HOSTS, USERSCRIPT_VERSION } from '../userscript/version.ts';
import { renderIcon } from './lib/icon.ts';
import { encodePng } from './lib/png.ts';
import { zipSync } from './lib/zip.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export const EXTENSION_ZIP_NAME = 'electronics-price-history-extension.zip';
export const ICON_SIZES = [16, 32, 48, 128] as const;

export interface ExtensionManifest {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  homepage_url: string;
  minimum_chrome_version: string;
  icons: Record<string, string>;
  permissions: readonly string[];
  host_permissions: readonly string[];
  background: { service_worker: string };
  content_scripts: readonly { matches: readonly string[]; js: readonly string[]; run_at: string; all_frames: boolean }[];
}

export function extensionManifest(): ExtensionManifest {
  return {
    manifest_version: 3,
    name: 'Electronics Price History',
    version: USERSCRIPT_VERSION,
    description: '対応する電子部品通販サイトの商品ページに、観測した価格・在庫・掲載状況の履歴を表示します。',
    homepage_url: 'https://github.com/tsuyoshi-otake/electro-parts',
    // Promise-returning chrome.* APIs under MV3; below this the panel would
    // fail on the first storage read rather than degrade.
    minimum_chrome_version: '102',
    icons: Object.fromEntries(ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`])),
    // Only the stored data base URL. No tabs, no cookies, no history.
    permissions: ['storage'],
    host_permissions: DATA_HOSTS.map((h) => `https://${h}/*`),
    background: { service_worker: 'background.js' },
    content_scripts: [
      {
        matches: PAGE_ADAPTERS.flatMap((a) => [...a.matchPatterns]),
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
  };
}

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [path.join(repoRoot, 'extension', entry)],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['chrome102'],
    platform: 'browser',
    minify: false,
    legalComments: 'none',
    charset: 'utf8',
    absWorkingDir: repoRoot,
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error(`esbuild produced no output for ${entry}`);
  return output.text;
}

export interface ExtensionFile {
  name: string;
  data: Buffer;
}

/** Every file of the unpacked extension, in a stable order. */
export async function buildExtensionFiles(): Promise<ExtensionFile[]> {
  const [content, background] = await Promise.all([bundle('content.ts'), bundle('background.ts')]);
  return [
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(extensionManifest(), null, 2)}\n`, 'utf8') },
    { name: 'background.js', data: Buffer.from(background, 'utf8') },
    { name: 'content.js', data: Buffer.from(content, 'utf8') },
    ...ICON_SIZES.map((size) => ({ name: `icons/icon-${size}.png`, data: encodePng(size, size, renderIcon(size)) })),
  ];
}

export async function buildExtension(outDir: string, zipPath?: string): Promise<{ dir: string; bytes: number; zip?: { file: string; bytes: number } }> {
  const files = await buildExtensionFiles();
  for (const file of files) {
    const target = path.join(outDir, file.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
  const bytes = files.reduce((sum, f) => sum + f.data.length, 0);
  if (zipPath === undefined) return { dir: outDir, bytes };
  const archive = zipSync(files);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await writeFile(zipPath, archive);
  return { dir: outDir, bytes, zip: { file: zipPath, bytes: archive.length } };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'dist/extension' }, zip: { type: 'string' } } });
  const built = await buildExtension(path.resolve(values.out), values.zip === undefined ? undefined : path.resolve(values.zip));
  process.stderr.write(`built ${built.dir} (${built.bytes} bytes)\n`);
  if (built.zip !== undefined) process.stderr.write(`packed ${built.zip.file} (${built.zip.bytes} bytes)\n`);
}
