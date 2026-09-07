import { PAGE_ADAPTERS } from '../userscript/adapters/registry.ts';
import { PRODUCT_RELATIONS, STORE_LABELS } from '../userscript/adapters/productRelations.ts';
import { mountHistoryPanel } from '../userscript/core/controller.ts';
import { DataClient } from '../userscript/core/dataClient.ts';
import { indexRelations } from '../userscript/core/relations.ts';
import type { HostEnv } from '../userscript/core/types.ts';
import { resolveDataBaseUrl } from './dataOrigin.ts';
import { FETCH_TEXT, type FetchTextResponse } from './messages.ts';

/**
 * The extension's `HostEnv` binding and start-up, the counterpart of the
 * Tampermonkey binding in `userscript/main.ts`. The panel, its store adapters
 * and the whole core are the same files both builds use; only what is bound
 * here differs, which is what `HostEnv` exists for.
 *
 * Network goes through the service worker (see background.ts) so the store's
 * page never issues the request; storage is `chrome.storage.local`, scoped to
 * this extension. Nothing is sent anywhere: there is no telemetry.
 */

const LOG_PREFIX = '[Electronics Price History]';
const BASE_URL_KEY = 'dataBaseUrl';

export function chromeHost(): HostEnv {
  return {
    fetchText: async (url, timeoutMs) => {
      const answer = (await chrome.runtime.sendMessage({ type: FETCH_TEXT, url, timeoutMs })) as FetchTextResponse | undefined;
      if (answer === undefined) throw new Error('the extension worker did not answer');
      if (!answer.ok) throw new Error(answer.error);
      return { status: answer.status, text: answer.text };
    },
    storage: {
      get: async (key) => {
        const read = await chrome.storage.local.get(key);
        const value = read[key];
        return typeof value === 'string' ? value : null;
      },
      set: async (key, value) => chrome.storage.local.set({ [key]: value }),
      remove: async (key) => chrome.storage.local.remove(key),
    },
    now: () => Date.now(),
    log: (level, message) => {
      if (level === 'debug') return;
      (level === 'error' ? console.error : console.warn)(`${LOG_PREFIX} ${message}`);
    },
  };
}

/** The configured data origin, or the default when storage is empty or unreadable. */
export async function readDataBaseUrl(): Promise<string> {
  try {
    const read = await chrome.storage.local.get(BASE_URL_KEY);
    return resolveDataBaseUrl(read[BASE_URL_KEY]);
  } catch {
    return resolveDataBaseUrl(undefined);
  }
}

export async function start(doc: Document = document, loc: Location = window.location): Promise<void> {
  const host = chromeHost();
  const dataBaseUrl = await readDataBaseUrl();
  await mountHistoryPanel({
    adapters: PAGE_ADAPTERS,
    host,
    client: new DataClient(host, { baseUrl: dataBaseUrl }),
    doc,
    location: loc,
    dataBaseUrl,
    relationIndex: indexRelations(PRODUCT_RELATIONS),
    storeLabels: STORE_LABELS,
  });
}

export { LOG_PREFIX };
