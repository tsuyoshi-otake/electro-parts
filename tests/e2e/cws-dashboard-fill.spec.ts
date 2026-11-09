import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { FILL_ROUNDS } from '../../scripts/lib/fill-until-kept.ts';
import { readStoreListingTexts, STORE_LISTING_DOC } from '../../scripts/lib/store-listing.ts';
import { check, fill } from '../../scripts/cws-dashboard.ts';

/**
 * `scripts/cws-dashboard.ts` against a stand-in for the Chrome Web Store
 * dashboard (#89). No request leaves the browser: the dashboard's origin is
 * served by route interception.
 *
 * The stand-in models what 0.7.8 inferred, not what the real dashboard is
 * known to do: a field that loses focus starts a save, the save button is
 * disabled while a save runs, a save that starts while another is in flight
 * lands first (so the older one lands last and wins on the server), and the
 * form is redrawn from the server's answer to each save. The real dashboard
 * still has to be checked by the owner at the next submission.
 */
const ORIGIN = 'https://chrome.google.com';
const TAB_URL = (tab: string) => `${ORIGIN}/webstore/devconsole/00000000-0000-4000-8000-000000000000/jklcjijjlombfgmagcbmfkjglomaiipj/edit/${tab}`;
const TABS = { listing: ['説明'], privacy: ['単一用途の説明', 'storage が必要な理由', 'ホスト権限 が必要な理由'] } as const;
const LABELS: readonly string[] = [...TABS.listing, ...TABS.privacy];

interface StandIn {
  server: Record<string, string>;
  /** Saves that reached the server. */
  saves: number;
}

async function standIn(page: Page, options: { ignoring?: string } = {}): Promise<StandIn> {
  const state: StandIn = { server: Object.fromEntries(LABELS.map((l) => [l, `old text of ${l}`])), saves: 0 };
  let inFlight = 0;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const tabPage = (tab: keyof typeof TABS) => `<!doctype html><meta charset="utf-8"><body>
<header><span>ステータス: 公開済み - 一般公開</span> <button id="save">下書きとして保存する</button></header>
<div id="toast"></div>
${TABS[tab].map((label, i) => `<label for="f${i}">${label}</label><textarea id="f${i}" data-label="${label}">${escape(state.server[label]!)}</textarea>`).join('\n')}
<script>
  const toast = document.getElementById('toast'), button = document.getElementById('save');
  let saving = 0;
  async function save() {
    saving += 1; button.disabled = true; toast.textContent = 'アイテムを保存しています…';
    const sent = {};
    for (const t of document.querySelectorAll('textarea')) sent[t.dataset.label] = t.value;
    const stored = await (await fetch('/__save', { method: 'POST', body: JSON.stringify(sent) })).json();
    for (const t of document.querySelectorAll('textarea')) t.value = stored[t.dataset.label];
    saving -= 1;
    if (saving === 0) { button.disabled = false; toast.textContent = 'アイテムが保存されました。'; setTimeout(() => { if (saving === 0) toast.textContent = ''; }, 800); }
  }
  for (const t of document.querySelectorAll('textarea')) t.addEventListener('blur', save);
  button.addEventListener('click', save);
</script>`;

  await page.route(`${ORIGIN}/webstore/devconsole/**`, (route) => {
    const tab = new URL(route.request().url()).pathname.split('/').pop() as keyof typeof TABS;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: tabPage(tab) });
  });
  await page.route(`${ORIGIN}/__save`, async (route) => {
    const sent = JSON.parse(route.request().postData()!) as Record<string, string>;
    state.saves += 1;
    // Alone in flight a save takes 600 ms; one that starts while another is in flight takes 100 ms and so lands first.
    const delay = inFlight === 0 ? 600 : 100;
    inFlight += 1;
    await new Promise((r) => setTimeout(r, delay));
    inFlight -= 1;
    for (const [label, text] of Object.entries(sent)) if (label !== options.ignoring) state.server[label] = text;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.server) });
  });
  await page.goto(TAB_URL('privacy'));
  return state;
}

const wanted = async () => readStoreListingTexts(await readFile(STORE_LISTING_DOC, 'utf8'));
const WANT_OF = (t: Awaited<ReturnType<typeof wanted>>): Record<string, string> => ({
  '説明': t.description, '単一用途の説明': t.singlePurpose, 'storage が必要な理由': t.storageReason, 'ホスト権限 が必要な理由': t.hostReason,
});

test('the stand-in loses a field when fields are put in one after another, as 0.7.8 saw', async ({ page }) => {
  const state = await standIn(page);
  const want = WANT_OF(await wanted());
  for (const label of TABS.privacy) {
    await page.getByLabel(label, { exact: true }).fill(want[label]!);
    await page.getByLabel(label, { exact: true }).blur();
  }
  await page.getByRole('button', { name: '下書きとして保存する' }).evaluate((b) => (b as HTMLElement).click());
  await page.waitForTimeout(1500);
  const kept = TABS.privacy.filter((l) => state.server[l] === want[l]);
  expect(kept.length).toBeLessThan(TABS.privacy.length);
});

test('fill ends with every field holding the listing document, although saves land out of order', async ({ page }) => {
  const state = await standIn(page);
  const want = WANT_OF(await wanted());
  expect(await fill(page)).toEqual([]);
  expect(state.server).toEqual(want);
  expect(await check(page)).toBe(0);
});

test('fill on a dashboard that already holds the texts saves nothing', async ({ page }) => {
  const state = await standIn(page);
  await fill(page);
  const saves = state.saves;
  expect(await fill(page)).toEqual([]);
  expect(state.saves).toBe(saves);
});

test('fill names a field the dashboard never keeps, after a bounded number of rounds', async ({ page }) => {
  const state = await standIn(page, { ignoring: 'storage が必要な理由' });
  const want = WANT_OF(await wanted());
  expect(await fill(page)).toEqual(['storage が必要な理由']);
  expect(state.server['storage が必要な理由']).toBe('old text of storage が必要な理由');
  expect(state.server['説明']).toBe(want['説明']);
  // Every field is put once and the one that never sticks once more for each further round; a put saves at most twice (on losing focus, then the button).
  expect(state.saves).toBeLessThanOrEqual((4 + (FILL_ROUNDS - 1)) * 2);
});
