import { isAllowedFetchUrl } from './dataOrigin.ts';
import { RELATION_INDEX_FILE, relationShardFile, relationShardIn, relationsInShard } from '../userscript/core/relationShards.ts';
import type { PackedRelationTable } from '../userscript/core/relationTable.ts';
import { FETCH_TEXT, isFetchTextRequest, isRelationsForRequest, MAX_TIMEOUT_MS, RELATIONS_FOR, type FetchTextResponse, type RelationsForResponse } from './messages.ts';

/**
 * MV3 service worker. It exists for one reason: the dataset (and the daily
 * exchange rate) is fetched from here rather than from the content script, so
 * the store's page never issues the request and never sees it. That is the property `GM_xmlhttpRequest`
 * with `anonymous: true` gives the userscript, kept.
 *
 * It is also the only code in the extension that can reach the network, so it
 * is written as a closed door: the data origin plus one exact rate URL, no
 * cookies, and a bounded wait. A page that manages to talk to it cannot use
 * it as a proxy to somewhere else.
 *
 * The second message type reads the worker's own packaged data, the reviewed
 * cross-store relation table. An index (relations/index.json) names the shard
 * (relations/shard-NN.json) a product is in. File names come from constants and
 * a validated number, so message text never reaches a path, and nothing is
 * fetched from the network for it.
 */

export async function fetchAllowedText(url: string, timeoutMs: number): Promise<FetchTextResponse> {
  if (!isAllowedFetchUrl(url)) return { ok: false, error: 'refused: url is not allowed' };
  const controller = new AbortController();
  const bounded = Math.min(Math.max(timeoutMs, 1), MAX_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), bounded);
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return { ok: true, status: res.status, text: await res.text() };
  } catch (e) {
    const message = e instanceof Error && e.name === 'AbortError' ? `timeout after ${bounded} ms` : `network error (${(e as Error).message})`;
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function readPackagedJson(file: string): Promise<unknown> {
  const res = await fetch(chrome.runtime.getURL(file));
  if (!res.ok) throw new Error(`${file} unreadable (status ${res.status})`);
  return JSON.parse(await res.text()) as unknown;
}

/** The relations of one product: the index names its shard, and only that shard is read. */
export async function readPackagedRelations(storeId: string, pageKey: string): Promise<RelationsForResponse> {
  try {
    const shard = relationShardIn(await readPackagedJson(RELATION_INDEX_FILE), storeId, pageKey);
    if (shard === null) return { ok: true, relations: [] };
    const table = (await readPackagedJson(relationShardFile(shard))) as PackedRelationTable;
    return { ok: true, relations: relationsInShard(table, storeId, pageKey) };
  } catch (e) {
    return { ok: false, error: `relations unavailable (${(e as Error).message})` };
  }
}

/**
 * Registered at the top level, as MV3 requires: the worker is woken by the
 * message, so a listener added later would miss it.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own content scripts. Another extension's message
  // arrives with its own id, and a page cannot send one at all.
  if (sender.id !== chrome.runtime.id) return undefined;
  if (isFetchTextRequest(message)) {
    void fetchAllowedText(message.url, message.timeoutMs).then(sendResponse);
    return true; // answered asynchronously
  }
  if (isRelationsForRequest(message)) {
    void readPackagedRelations(message.storeId, message.pageKey).then(sendResponse);
    return true;
  }
  return undefined;
});

export { FETCH_TEXT, RELATIONS_FOR };
