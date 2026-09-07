import { describe, expect, it } from 'vitest';
import { buildExtensionFiles, extensionManifest, ICON_SIZES } from '../../scripts/build-extension.ts';
import { PAGE_ADAPTERS } from '../../userscript/adapters/registry.ts';
import { DATA_HOSTS, USERSCRIPT_VERSION } from '../../userscript/version.ts';

/**
 * The manifest is generated, so what is pinned here is the generation rule:
 * the extension advertises exactly the stores that have an adapter and exactly
 * the origin it reads, and nothing else. A store added to the registry shows
 * up in `matches` for free; a permission added by hand fails this file.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(data: Buffer): { width: number; height: number } {
  expect(data.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(data.toString('latin1', 12, 16)).toBe('IHDR');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe('extension manifest', () => {
  const manifest = extensionManifest();

  it('is MV3 and carries the userscript version', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe(USERSCRIPT_VERSION);
    // Chrome accepts 1-4 dot-separated integers; anything else fails to load.
    expect(manifest.version).toMatch(/^\d+(\.\d+){0,3}$/);
  });

  it('matches exactly the registered adapters', () => {
    const content = manifest.content_scripts[0];
    expect(manifest.content_scripts).toHaveLength(1);
    expect(content?.matches).toEqual(PAGE_ADAPTERS.flatMap((a) => [...a.matchPatterns]));
    expect(content?.run_at).toBe('document_idle');
    expect(content?.all_frames).toBe(false);
  });

  it('asks for the data origin and nothing else', () => {
    expect(manifest.host_permissions).toEqual(DATA_HOSTS.map((h) => `https://${h}/*`));
    expect(manifest.permissions).toEqual(['storage']);
    // A store page is read by the content script, never fetched by the worker.
    const stores = PAGE_ADAPTERS.flatMap((a) => a.matchPatterns.map((p) => new URL(p.replace('*', '')).hostname));
    for (const permission of manifest.host_permissions) {
      expect(stores).not.toContain(new URL(permission).hostname);
    }
    expect(manifest.host_permissions).not.toContain('<all_urls>');
  });

  it('references only files the build produces', async () => {
    const files = await buildExtensionFiles();
    const names = files.map((f) => f.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain(manifest.background.service_worker);
    for (const js of manifest.content_scripts[0]?.js ?? []) expect(names).toContain(js);
    for (const icon of Object.values(manifest.icons)) expect(names).toContain(icon);

    const written = files.find((f) => f.name === 'manifest.json');
    expect(JSON.parse(written?.data.toString('utf8') ?? '{}')).toEqual(manifest);
  });

  it('draws every declared icon at its declared size', async () => {
    const files = await buildExtensionFiles();
    for (const size of ICON_SIZES) {
      const icon = files.find((f) => f.name === `icons/icon-${size}.png`);
      expect(icon, `icon-${size}.png`).toBeDefined();
      expect(pngSize(icon?.data ?? Buffer.alloc(0))).toEqual({ width: size, height: size });
      expect(manifest.icons[String(size)]).toBe(`icons/icon-${size}.png`);
    }
  });

  it('bundles no HTML-string sink and no remote code', async () => {
    const files = await buildExtensionFiles();
    for (const name of ['content.js', 'background.js']) {
      const code = files.find((f) => f.name === name)?.data.toString('utf8') ?? '';
      expect(code, name).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
      expect(code, name).not.toMatch(/https?:\/\/[^"' ]*(cdn|unpkg|jsdelivr)/);
    }
  });
});
