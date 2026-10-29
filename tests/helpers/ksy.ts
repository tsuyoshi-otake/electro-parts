import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { KsySnapshot } from '../../src/adapters/ksy/rawSchema.ts';
import { ksySnapshotAdapter } from '../../src/adapters/ksy/snapshotAdapter.ts';
import { ksyCollector } from '../../src/collectors/ksy/collector.ts';

export interface KsyFixture {
  retrievedAt: string;
  pageSize: number;
  /** Exact response bodies, in offset order. */
  pages: string[];
}

export function ksyFixture(): KsyFixture {
  return JSON.parse(gunzipSync(readFileSync('tests/fixtures/ksy/list-pages.json.gz')).toString()) as KsyFixture;
}

export function ksyProductPageHtml(): string {
  return gunzipSync(readFileSync('tests/fixtures/ksy/product-page.html.gz')).toString();
}

/** What the shop's own script does when it opens a product in the dialog of the saved page (`ksyProductPageHtml`). */
export function openKsyProduct(doc: Document, id: string, permalink: string): void {
  doc.getElementById('dt_id')!.textContent = id;
  doc.getElementById('dt_Permalink')!.setAttribute('href', permalink);
  doc.getElementById('detail')!.style.display = 'block';
}

/** The `offset` a list URL asks for, as the shop reads it. */
export function requestedOffset(url: string): number {
  const args = JSON.parse(new URL(url).searchParams.get('argumentCollection') ?? '{}') as { args?: { conditions?: { offset?: number } } };
  return args.args?.conditions?.offset ?? 0;
}

/** Runs the real collector against the saved pages; `edit` may rewrite any response body. */
export async function collectKsyFixture(edit?: (url: string, body: string) => string, config: Record<string, unknown> = {}) {
  const fixture = ksyFixture();
  const requests: string[] = [];
  const outcome = await ksyCollector.collect({ userAgent: 'electro-parts-test/1.0', ...config }, {
    log: () => {}, now: () => new Date(fixture.retrievedAt), sleep: async () => {}, random: () => 0,
    transport: async (url) => {
      requests.push(url);
      const page = fixture.pages[requestedOffset(url) / fixture.pageSize] ?? fixture.pages[0]!;
      const body = edit?.(url, page) ?? page;
      return { status: 200, header: () => null, bytes: async () => Buffer.from(body) };
    },
  });
  return { ...outcome, raw: outcome.raw as KsySnapshot, requests };
}

export async function loadKsyNormalized() {
  const result = await collectKsyFixture();
  return ksySnapshotAdapter.normalize(result.raw, 'a'.repeat(64));
}
