/**
 * Bundles the userscript with esbuild and prepends the Tampermonkey header.
 * `@match` lines come from the adapter registry, `@connect` hosts from the
 * data origin, so the header can never advertise a store without an adapter.
 *
 *   node --import tsx scripts/build-userscript.ts [--out DIR] [--base-url URL]
 */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PAGE_ADAPTERS } from '../userscript/adapters/registry.ts';
import { DATA_HOSTS, DEFAULT_DATA_BASE_URL, USERSCRIPT_VERSION } from '../userscript/version.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export const USERSCRIPT_FILE_NAME = 'electronics-price-history.user.js';

export function userscriptHeader(baseUrl: string): string {
  const lines = [
    ['@name', 'Electronics Price History'],
    ['@namespace', 'https://github.com/tsuyoshi-otake/electro-parts'],
    ['@version', USERSCRIPT_VERSION],
    ['@description', 'Shows the observed price, stock and listing history on Akizuki Denshi and Switch Science product pages.'],
    ['@author', 'tsuyoshi-otake'],
    ['@license', 'MIT'],
    ...PAGE_ADAPTERS.flatMap((a) => a.matchPatterns.map((p) => ['@match', p])),
    ...DATA_HOSTS.map((h) => ['@connect', h]),
    ['@grant', 'GM_xmlhttpRequest'],
    ['@grant', 'GM_getValue'],
    ['@grant', 'GM_setValue'],
    ['@grant', 'GM_deleteValue'],
    ['@grant', 'GM_listValues'],
    ['@run-at', 'document-idle'],
    ['@noframes', ''],
    ['@downloadURL', `${baseUrl}/${USERSCRIPT_FILE_NAME}`],
    ['@updateURL', `${baseUrl}/${USERSCRIPT_FILE_NAME}`],
  ];
  const width = Math.max(...lines.map(([k]) => (k as string).length)) + 2;
  return ['// ==UserScript==', ...lines.map(([k, v]) => `// ${(k as string).padEnd(width)}${v}`.trimEnd()), '// ==/UserScript==', ''].join('\n');
}

export async function buildUserscript(outDir: string, baseUrl = DEFAULT_DATA_BASE_URL): Promise<{ file: string; bytes: number }> {
  const result = await build({
    entryPoints: [path.join(repoRoot, 'userscript', 'main.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    minify: false,
    legalComments: 'none',
    charset: 'utf8',
    absWorkingDir: repoRoot,
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('esbuild produced no output');
  const code = `${userscriptHeader(baseUrl)}\n${output.text}`;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, USERSCRIPT_FILE_NAME);
  await writeFile(file, code, 'utf8');
  return { file, bytes: Buffer.byteLength(code, 'utf8') };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'dist' }, 'base-url': { type: 'string' } } });
  const built = await buildUserscript(path.resolve(values.out), values['base-url'] ?? DEFAULT_DATA_BASE_URL);
  process.stderr.write(`built ${built.file} (${built.bytes} bytes)\n`);
}
