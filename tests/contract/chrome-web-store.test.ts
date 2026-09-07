import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildExtensionFiles,
  EXTENSION_DESCRIPTION,
  EXTENSION_NAME,
  extensionManifest,
  PRIVACY_POLICY_URL,
  SOURCE_URL,
} from '../../scripts/build-extension.ts';
import { DEFAULT_DATA_BASE_URL } from '../../userscript/version.ts';

/**
 * What the Chrome Web Store checks, checked here.
 *
 * Review itself is a human decision, but most of the ways an upload is rejected
 * are mechanical: a name or description over the limit, a version Chrome cannot
 * parse, a manifest key that is not allowed in an uploaded package, a
 * permission nobody asked for, or code that fetches and runs more code. Those
 * belong in a test, not in a checklist somebody remembers to read.
 *
 * Sibling file `extension-manifest.test.ts` pins the *generation rule* (the
 * manifest follows the adapter registry and the data hosts); this one pins the
 * *store policy* the generated result has to satisfy.
 */

/** Keys the Web Store rejects, or that would widen what the extension can do. */
const FORBIDDEN_MANIFEST_KEYS = [
  'update_url', // set by the store; an uploaded package carrying one is refused
  'key',
  'web_accessible_resources',
  'externally_connectable',
  'content_security_policy',
  'declarative_net_request',
  'oauth2',
  'sandbox',
  'chrome_url_overrides',
] as const;

const FORBIDDEN_PERMISSIONS = [
  '<all_urls>',
  'tabs',
  'cookies',
  'history',
  'scripting',
  'webRequest',
  'webRequestBlocking',
  'management',
  'debugger',
  'downloads',
  'nativeMessaging',
  'declarativeNetRequest',
  'unlimitedStorage',
  'clipboardRead',
] as const;

const BUNDLES = ['content.js', 'background.js'] as const;

async function bundles(): Promise<Map<string, string>> {
  const files = await buildExtensionFiles();
  return new Map(files.filter((f) => f.name.endsWith('.js')).map((f) => [f.name, f.data.toString('utf8')]));
}

describe('Chrome Web Store package requirements', () => {
  const manifest = extensionManifest();

  it('keeps the listing strings inside the store limits', () => {
    expect(manifest.name).toBe(EXTENSION_NAME);
    expect([...manifest.name].length).toBeLessThanOrEqual(45);
    expect(manifest.description).toBe(EXTENSION_DESCRIPTION);
    // Counted in code points: the description is Japanese.
    expect([...manifest.description].length).toBeGreaterThan(0);
    expect([...manifest.description].length).toBeLessThanOrEqual(132);
    expect(manifest.homepage_url).toBe(SOURCE_URL);
  });

  it('uses a version Chrome can parse and the store can order', () => {
    const parts = manifest.version.split('.');
    expect(parts.length).toBeGreaterThanOrEqual(1);
    expect(parts.length).toBeLessThanOrEqual(4);
    for (const part of parts) {
      expect(part, manifest.version).toMatch(/^(0|[1-9]\d*)$/); // integers, no leading zeros
      expect(Number(part)).toBeLessThanOrEqual(65_535);
    }
  });

  it('declares no manifest key the store refuses or that widens access', () => {
    const keys = Object.keys(manifest);
    for (const forbidden of FORBIDDEN_MANIFEST_KEYS) expect(keys).not.toContain(forbidden);
  });

  it('asks for no permission beyond storage and the data origin', () => {
    const asked = [...manifest.permissions, ...manifest.host_permissions];
    for (const forbidden of FORBIDDEN_PERMISSIONS) expect(asked).not.toContain(forbidden);
    for (const host of manifest.host_permissions) {
      expect(host, 'host permissions must be https and specific').toMatch(/^https:\/\/[^*]+\/\*$/);
      expect(new URL(host.replace('/*', '/')).origin).toBe(new URL(DEFAULT_DATA_BASE_URL).origin);
    }
  });

  it('ships a 128px icon, which the store listing requires', () => {
    expect(manifest.icons['128']).toBe('icons/icon-128.png');
  });

  it('packs every file at a plain relative path, manifest.json at the root', async () => {
    const files = await buildExtensionFiles();
    expect(files.map((f) => f.name)).toContain('manifest.json');
    for (const file of files) {
      expect(file.name).not.toMatch(/^[/\\]/);
      expect(file.name).not.toContain('..');
      expect(file.name).not.toContain('\\');
    }
  });

  it('executes no remote code and touches no API it did not ask for', async () => {
    for (const [name, code] of await bundles()) {
      expect(code, `${name}: eval`).not.toMatch(/\beval\s*\(/);
      expect(code, `${name}: Function constructor`).not.toMatch(/new\s+Function\s*\(/);
      expect(code, `${name}: dynamic import`).not.toMatch(/\bimport\s*\(/);
      expect(code, `${name}: script injection`).not.toMatch(/createElement\(\s*['"]script['"]/);
      expect(code, `${name}: XHR`).not.toContain('XMLHttpRequest');
      expect(code, `${name}: undeclared chrome API`).not.toMatch(/chrome\.(tabs|cookies|scripting|webRequest|history|downloads|management)\b/);
    }
  });

  it('keeps the network in the worker: the content script never fetches', async () => {
    const loaded = await bundles();
    for (const name of BUNDLES) expect(loaded.has(name), name).toBe(true);
    expect(loaded.get('content.js')).not.toMatch(/\bfetch\s*\(/);
    expect(loaded.get('background.js')).toMatch(/\bfetch\s*\(/);
  });

  it('hands the reviewer a readable file that says where it came from', async () => {
    for (const [name, code] of await bundles()) {
      expect(code.startsWith('/**'), name).toBe(true);
      expect(code, name).toContain(SOURCE_URL);
      expect(code, name).toContain('npm run build:extension');
      expect(code, name).toContain('no minification');
      // Unminified: a reviewer has to be able to read it. Minified bundles run
      // to a handful of very long lines.
      const longest = code.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
      expect(longest, `${name} longest line`).toBeLessThan(5_000);
    }
  });

  it('publishes the privacy policy the listing points at', async () => {
    expect(PRIVACY_POLICY_URL).toBe(`${DEFAULT_DATA_BASE_URL}/privacy.html`);
    const page = await readFile(path.resolve(process.cwd(), 'public', 'privacy.html'), 'utf8');
    expect(page).toContain(EXTENSION_NAME);
    // The three claims the store's data-usage disclosure is certified against.
    expect(page).toContain('収集しません');
    expect(page).toContain('chrome.storage.local');
    expect(page).toContain(new URL(DEFAULT_DATA_BASE_URL).host);
  });
});
