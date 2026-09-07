/**
 * Turns a live product page into a test fixture: strips scripts, blanks
 * anything token-shaped, prepends a provenance comment and gzips the result
 * into `tests/fixtures/<store>/html/<name>.html.gz`.
 *
 * Usage: npx tsx scripts/make-html-fixture.ts <store> <name> <url>
 */
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const USER_AGENT = 'electro-parts-price-history/0.1 (+https://github.com/tsuyoshi-otake/electro-parts; research)';

export function sanitizeHtml(html: string, host: string, retrievedAt: string): string {
  const banner = `<!-- Test fixture: sanitized copy of a public ${host} page retrieved ${retrievedAt} (scripts removed, tokens blanked). Used only for parser and UI tests inside this repository. -->\n`;
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/(name="__RequestVerificationToken"[^>]*value=")[^"]*/gi, '$1')
    .replace(/((?:csrf|token|session|api[_-]?key)[A-Za-z_-]*"\s*(?:content|value)=")[^"]*/gi, '$1');
  return cleaned.replace(/(<!DOCTYPE html>\r?\n?)/i, `$1${banner}`);
}

async function main(): Promise<void> {
  const [store, name, url] = process.argv.slice(2);
  if (store === undefined || name === undefined || url === undefined) {
    throw new Error('usage: make-html-fixture.ts <store> <name> <url>');
  }
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: '*/*' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const html = sanitizeHtml(await res.text(), new URL(url).host, new Date().toISOString().slice(0, 10));
  const dir = path.join('tests', 'fixtures', store, 'html');
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${name}.html.gz`);
  writeFileSync(out, gzipSync(Buffer.from(html, 'utf8')));
  console.log(`${out} <- ${url} (${html.length} chars)`);
}

await main();
