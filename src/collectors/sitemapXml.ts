/**
 * Store-neutral XML sitemap reading.
 *
 * Both stores publish a sitemap and both crawlers use it the same way: as the
 * authoritative list of what the catalogue holds, so that a listing the site
 * silently drops is visible as a coverage gap instead of looking like a
 * delisting. The XML shape is the sitemaps.org standard, not a store's, which
 * is why the parsing lives here rather than in either store's collector.
 *
 * Deliberately a regex reader, not an XML parser: the documents are
 * machine-generated, the two elements needed are `<loc>` and `<lastmod>`, and a
 * dependency-free reader is one less thing to keep patched.
 */
import { gunzipSync } from 'node:zlib';

export interface SitemapIndexEntry {
  url: string;
  lastModified: string | null;
}

export class SitemapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SitemapError';
  }
}

const LOC = /<loc>\s*([^<]+?)\s*<\/loc>/g;
const SITEMAP_ENTRY = /<sitemap>([\s\S]*?)<\/sitemap>/g;
const LASTMOD = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/;
const GZIP_MAGIC = [0x1f, 0x8b];

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Resolves the XML entities a `<loc>` may contain. Sitemap URLs with query
 * strings arrive as `...?from=1&amp;to=2`, and fetching that literally asks for
 * a URL the site does not serve.
 */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X') ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Every `<loc>` in document order, entity-decoded. */
export function parseSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  LOC.lastIndex = 0;
  for (let m = LOC.exec(xml); m !== null; m = LOC.exec(xml)) locs.push(decodeXmlEntities(m[1] as string));
  return locs;
}

/** Parses a sitemap index into its sub-sitemap entries. Throws when it lists none. */
export function parseSitemapIndex(xml: string): SitemapIndexEntry[] {
  const entries: SitemapIndexEntry[] = [];
  SITEMAP_ENTRY.lastIndex = 0;
  for (let m = SITEMAP_ENTRY.exec(xml); m !== null; m = SITEMAP_ENTRY.exec(xml)) {
    const block = m[1] as string;
    LOC.lastIndex = 0;
    const loc = LOC.exec(block)?.[1];
    if (loc === undefined) continue;
    entries.push({ url: decodeXmlEntities(loc), lastModified: LASTMOD.exec(block)?.[1] ?? null });
  }
  if (entries.length === 0) throw new SitemapError('sitemap index lists no sub-sitemaps');
  return entries;
}

/** The newest `lastmod` across a set of entries, or null when none carried one. */
export function newestLastModified(entries: readonly SitemapIndexEntry[]): string | null {
  return entries.reduce<string | null>(
    (newest, s) => (s.lastModified !== null && (newest === null || s.lastModified > newest) ? s.lastModified : newest),
    null,
  );
}

/** Decompresses a sub-sitemap body; plain XML is accepted as well. */
export function decodeSitemapBody(bytes: Uint8Array, url: string): string {
  const gzipped = bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  try {
    return new TextDecoder().decode(gzipped ? gunzipSync(bytes) : bytes);
  } catch (e) {
    throw new SitemapError(`${url}: cannot decode sitemap body (${(e as Error).message})`);
  }
}
