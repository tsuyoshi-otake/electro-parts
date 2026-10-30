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
 *   node --import tsx scripts/cws-dashboard.ts fill              paste the listing texts and save each tab's draft
 *   node --import tsx scripts/cws-dashboard.ts check             compare the dashboard fields with the listing doc (read-only)
 *   node --import tsx scripts/cws-dashboard.ts blockers          read 「送信できない理由」 and close it with Escape
 *   node --import tsx scripts/cws-dashboard.ts close             close that Chrome and delete its profile (it holds a sign-in)
 *
 * Options: --port (9333), --profile (~/tmp/electro-cws/profile), --chrome (Chrome's path).
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
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
  // The dashboard moves to the listing tab once the package is read.
  await page.waitForURL(/\/edit\/listing/, { timeout: 60_000 });
  await status(page);
}

async function saveDraft(page: Page): Promise<void> {
  await press(page, '下書きとして保存する');
  await page.getByText('アイテムが保存されました。').first().waitFor({ timeout: 30_000 });
}

async function fill(page: Page): Promise<void> {
  const texts = await listingTexts();
  for (const tab of ['listing', 'privacy'] as const) {
    await openTab(page, tab);
    for (const field of FIELDS.filter((f) => f.tab === tab)) {
      const box = page.getByLabel(field.label, { exact: true });
      await box.fill(texts[field.text]);
      await box.blur();
    }
    await saveDraft(page);
    console.log(`${tab}: saved`);
  }
  await check(page);
}

async function check(page: Page): Promise<void> {
  const texts = await listingTexts();
  let differs = 0;
  for (const tab of ['listing', 'privacy'] as const) {
    await openTab(page, tab);
    for (const field of FIELDS.filter((f) => f.tab === tab)) {
      const value = await page.getByLabel(field.label, { exact: true }).inputValue();
      const same = value === texts[field.text];
      if (!same) differs += 1;
      console.log(`${same ? 'same' : 'DIFFERS'}  ${field.label} (${[...value].length} chars)`);
    }
  }
  if (differs > 0) process.exitCode = 1;
}

async function blockers(page: Page): Promise<void> {
  await openTab(page, 'privacy');
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

  const deadline = setTimeout(() => { console.error('timed out after 180 s'); process.exit(2); }, 180_000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    if (command === 'close') return await close(browser, values.profile);
    const page = await dashboardPage(browser);
    if (command === 'status') await status(page);
    else if (command === 'upload' && arg) await upload(page, path.resolve(arg));
    else if (command === 'fill') await fill(page);
    else if (command === 'check') await check(page);
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
