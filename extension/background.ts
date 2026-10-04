import { isAllowedFetchUrl } from './dataOrigin.ts';
import { FETCH_TEXT, isFetchTextRequest, MAX_TIMEOUT_MS, type FetchTextResponse } from './messages.ts';

/**
 * MV3 service worker. It exists for one reason: the dataset (and the daily
 * exchange rate) is fetched from here rather than from the content script, so
 * the store's page never issues the request and never sees it. That is the property `GM_xmlhttpRequest`
 * with `anonymous: true` gives the userscript, kept.
 *
 * It is also the only code in the extension that can reach the network, so it
 * is written as a closed door: one message type, the data origin plus one
 * exact rate URL, no cookies, and a bounded wait. A page that manages to talk to it cannot use
 * it as a proxy to somewhere else.
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

/**
 * Registered at the top level, as MV3 requires: the worker is woken by the
 * message, so a listener added later would miss it.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own content scripts. Another extension's message
  // arrives with its own id, and a page cannot send one at all.
  if (sender.id !== chrome.runtime.id) return undefined;
  if (!isFetchTextRequest(message)) return undefined;
  void fetchAllowedText(message.url, message.timeoutMs).then(sendResponse);
  return true; // answered asynchronously
});

export { FETCH_TEXT };
