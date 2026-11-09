/**
 * Fills the Chrome Web Store dashboard for a new version, up to but never
 * including 「審査のため送信」. The person presses that button.
 *
 * Why this way: the dashboard (`chrome.google.com/webstore/*`) refuses scripts
 * and screenshots from extensions, so Claude in Chrome cannot drive it, and
 * Chrome ignores `--remote-debugging-port` on the default profile. A separate
 * Chrome profile with a debugging port works; the person signs in there, and
 * this script attaches over CDP. See the submission section of
 * `docs/chrome-web-store-listing.md`.
 *
 *   node --import tsx scripts/cws-dashboard.ts launch            separate profile, CDP on 127.0.0.1:9333; the person signs in
 *   node --import tsx scripts/cws-dashboard.ts status            item status, draft and published versions
 *   node --import tsx scripts/cws-dashboard.ts upload <zip>      upload the verified package
 *   node --import tsx scripts/cws-dashboard.ts fill              paste the listing texts, save the draft, read every field back from a fresh tab, put again what did not stick (3 rounds); exit 1 if a field still does not hold its text
 *   node --import tsx scripts/cws-dashboard.ts check             compare the dashboard fields with the listing doc (read-only); exit 1 if one differs
 *   node --import tsx scripts/cws-dashboard.ts blockers          read 「送信できない理由」 and close it with Escape
 *   node --import tsx scripts/cws-dashboard.ts close             close that Chrome and delete its profile (it holds a sign-in)
 *
 * Options: --port (9333), --profile (~/tmp/electro-cws/profile), --chrome (Chrome's path).
 */
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FILL_ROUNDS, fillUntilKept } from './lib/fill-until-kept.ts';
import { readStoreListingTexts, STORE_LISTING_DOC, type StoreListingTexts } from './lib/store-listing.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = 'https://chrome.google.com/webstore/devconsole';
/** The published item's id; it is part of the public store URL. */
export const CWS_ITEM_ID = 'jklcjijjlombfgmagcbmfkjglomaiipj';
/**
 * The only header and dialog buttons this script presses. 「審査のため送信」 and
 * 「公開」 are absent on purpose: submitting is the person's decision.
 */
const PRESSABLE = ['下書きとして保存する', '送信できない理由', '新しいパッケージをアップロード'] as const;

type Tab = 'status' | 'package' | 'listing' | 'privacy';

/** Each pasted field, by the label the dashboard gives its textarea. */
const FIELDS: readonly { tab: Tab; label: string; text: keyof StoreListingTexts }[] = [
  { tab: 'listing', label: '説明', text: 'description' },
  { tab: 'privacy', label: '単一用途の説明', text: 'singlePurpose' },
  { tab: 'privacy', label: 'storage が必要な理由', text: 'storageReason' },
  { tab: 'privacy', label: 'ホスト権限 が必要な理由', text: 'hostReason' },
];
type Field = (typeof FIELDS)[number];

async function listingTexts(): Promise<StoreListingTexts> {
  return readStoreListingTexts(await readFile(path.join(here, '..', STORE_LISTING_DOC), 'utf8'));
}

async function dashboardPage(browser: Browser): Promise<Page> {
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().startsWith(DASHBOARD)) ?? pages[0];
  if (!page) throw new Error('the CWS Chrome has no open tab; run launch again');
  await page.bringToFront();
  return page;
}

/** Opens one tab of the item; the publisher id comes from the dashboard's own redirect. */
async function openTab(page: Page, tab: Tab): Promise<void> {
  if (!page.url().startsWith(`${DASHBOARD}/`)) {
    await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/devconsole\/[0-9a-f-]{36}/, { timeout: 30_000 });
  }
  const publisher = /\/devconsole\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!publisher) throw new Error(`not signed in to the dashboard (at ${page.url()})`);
  await page.goto(`${DASHBOARD}/${publisher}/${CWS_ITEM_ID}/edit/${tab}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('ステータス:', { exact: false }).first().waitFor({ timeout: 30_000 });
}

/**
 * Presses one allowed button that is on screen. Material overlays swallow
 * pointer clicks, so the click is dispatched on the element itself, and only
 * on a visible one: hidden dialogs keep buttons with the same labels.
 */
async function press(page: Page, label: (typeof PRESSABLE)[number]): Promise<void> {
  if (!PRESSABLE.includes(label)) throw new Error(`refusing to press ${label}`);
  const button = page.getByRole('button', { name: label }).filter({ visible: true }).first();
  await button.evaluate((b) => (b as HTMLElement).click());
}

async function status(page: Page): Promise<void> {
  await openTab(page, 'package');
  const text = await page.locator('body').innerText();
  console.log(text.match(/ステータス:[^\n]*/)?.[0] ?? 'status not found');
  for (const section of ['ドラフト', '公開済み']) {
    const version = new RegExp(`\\n${section}\\n(?:[^\\n]*\\n)*?バージョン\\t([^\\n]+)`).exec(text)?.[1];
    console.log(`${section}: ${version ?? '-'}`);
  }
}

async function upload(page: Page, zip: string): Promise<void> {
  await openTab(page, 'package');
  await press(page, '新しいパッケージをアップロード');
  await page.locator('input[type=file]').first().setInputFiles(zip);
  // The dashboard leaves the package tab once the package is read: to /edit/listing
  // until 0.5.1, to /edit for 0.6.1 (2026-10-31). status then reads the draft version.
  await page.waitForURL((url) => /\/edit(?:\/listing)?$/.test(url.pathname), { timeout: 60_000 });
  await status(page);
}

/** On screen while the dashboard saves. A save also starts by itself when a field loses focus. */
const SAVING = 'アイテムを保存しています';

async function saveDraft(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: '下書きとして保存する' }).filter({ visible: true }).first();
  // The button is disabled while a save runs, and pressing a disabled button does nothing (0.7.8: the press was lost
  // while the dashboard's own save ran). So it is waited for; still disabled after 10 s, nothing is left to press.
  const enabled = await expect(button).toBeEnabled({ timeout: 10_000 }).then(() => true, () => false);
  if (enabled) {
    await press(page, '下書きとして保存する');
    await page.getByText('アイテムが保存されました。').first().waitFor({ timeout: 30_000 });
  }
  await page.getByText(SAVING).first().waitFor({ state: 'hidden', timeout: 30_000 });
}

async function putField(page: Page, field: Field, text: string): Promise<void> {
  await openTab(page, field.tab);
  const box = page.getByLabel(field.label, { exact: true });
  await box.fill(text);
  await box.blur();
  await saveDraft(page);
  console.log(`put     ${field.label}`);
}

/** Reads the field from a freshly loaded tab: a toast or a pause proves nothing about what the dashboard kept. */
async function holdsText(page: Page, field: Field, text: string): Promise<boolean> {
  await openTab(page, field.tab);
  const value = await page.getByLabel(field.label, { exact: true }).inputValue();
  const same = value === text;
  console.log(`${same ? 'same   ' : 'DIFFERS'} ${field.label} (${[...value].length} chars)`);
  return same;
}

/** Puts each field that does not hold its text, reads all of them back, and repeats (`fillUntilKept`). Returns the labels still not kept. */
export async function fill(page: Page): Promise<string[]> {
  const texts = await listingTexts();
  const unkept = await fillUntilKept(FIELDS, {
    put: (field) => putField(page, field, texts[field.text]),
    kept: (field) => holdsText(page, field, texts[field.text]),
  });
  return unkept.map((field) => field.label);
}

/** Read-only. Returns how many fields differ from the listing document. */
export async function check(page: Page): Promise<number> {
  const texts = await listingTexts();
  let differs = 0;
  for (const field of FIELDS) if (!(await holdsText(page, field, texts[field.text]))) differs += 1;
  return differs;
}

async function blockers(page: Page): Promise<void> {
  await openTab(page, 'privacy');
  // With nothing blocking, the header shows no 「送信できない理由」 and an enabled
  // 「審査のため送信」 instead (0.6.1, 2026-10-31). That button is only read, never pressed.
  const why = page.getByRole('button', { name: '送信できない理由' }).filter({ visible: true });
  const submit = page.getByRole('button', { name: '審査のため送信' }).filter({ visible: true });
  await why.or(submit).first().waitFor({ timeout: 30_000 });
  if ((await why.count()) === 0) {
    console.log(`no blockers: 「送信できない理由」 is not shown; 「審査のため送信」 is ${(await submit.first().isEnabled()) ? 'enabled' : 'disabled'}`);
    return;
  }
  await press(page, '送信できない理由');
  const dialog = page.getByRole('dialog').filter({ hasText: '公開できません' }).filter({ visible: true }).first();
  await dialog.waitFor({ timeout: 15_000 });
  console.log(await dialog.innerText());
  // Escape, not a button: a label like 「OK」 also matches buttons of hidden dialogs.
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function launch(chrome: string, profile: string, port: number): Promise<void> {
  await mkdir(profile, { recursive: true });
  const child = spawn(chrome, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--no-first-run', '--no-default-browser-check', DASHBOARD], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`Chrome started with ${profile}. Sign in to the dashboard in that window; nothing attaches until then.`);
}

async function close(browser: Browser, profile: string): Promise<void> {
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.close').catch(() => {});
  // Chrome releases the profile shortly after it exits.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      console.log(`closed; deleted ${profile}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`could not delete ${profile}; delete it once Chrome has exited`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '9333' },
      profile: { type: 'string', default: path.join(homedir(), 'tmp', 'electro-cws', 'profile') },
      chrome: { type: 'string', default: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    },
  });
  const [command, arg] = positionals;
  const port = Number(values.port);
  if (command === 'launch') return launch(values.chrome, values.profile, port);

  const deadline = setTimeout(() => { console.error('timed out after 300 s'); process.exit(2); }, 300_000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    if (command === 'close') return await close(browser, values.profile);
    const page = await dashboardPage(browser);
    if (command === 'status') await status(page);
    else if (command === 'upload' && arg) await upload(page, path.resolve(arg));
    else if (command === 'fill') {
      const unkept = await fill(page);
      if (unkept.length > 0) {
        console.error(`not kept after ${FILL_ROUNDS} rounds: ${unkept.join(', ')}`);
        process.exitCode = 1;
      }
    } else if (command === 'check') {
      if ((await check(page)) > 0) process.exitCode = 1;
    }
    else if (command === 'blockers') await blockers(page);
    else throw new Error('usage: cws-dashboard.ts launch|status|upload <zip>|fill|check|blockers|close');
  } finally {
    clearTimeout(deadline);
    // Disconnects; the window stays open for the person.
    await browser.close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
