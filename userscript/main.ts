import { PAGE_ADAPTERS } from './adapters/registry.ts';
import { mountHistoryPanel } from './core/controller.ts';
import { DataClient } from './core/dataClient.ts';
import type { HostEnv } from './core/types.ts';
import { DEFAULT_DATA_BASE_URL } from './version.ts';
import { PRODUCT_RELATIONS, STORE_LABELS } from './adapters/productRelations.ts';
import { indexRelations } from './core/relations.ts';

/**
 * Tampermonkey entry point. Binds the store-neutral core to the GM APIs:
 * anonymous cross-origin GETs through GM_xmlhttpRequest (no cookies, no
 * page-origin fetch), script-scoped GM storage for the cache, and console
 * logging. No telemetry of any kind leaves the browser.
 */

const LOG_PREFIX = '[Electronics Price History]';

function gmHost(): HostEnv {
  return {
    fetchText: (url, timeoutMs) =>
      new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: timeoutMs,
          anonymous: true,
          headers: { Accept: 'application/json' },
          onload: (res) => resolve({ status: res.status, text: res.responseText }),
          onerror: (res) => reject(new Error(`network error (status ${res.status})`)),
          ontimeout: () => reject(new Error(`timeout after ${timeoutMs} ms`)),
        });
      }),
    storage: {
      get: async (key) => {
        const v = GM_getValue(key, null);
        return typeof v === 'string' ? v : null;
      },
      set: async (key, value) => GM_setValue(key, value),
      remove: async (key) => GM_deleteValue(key),
      keys: async (prefix) => GM_listValues().filter((key) => key.startsWith(prefix)),
    },
    now: () => Date.now(),
    log: (level, message) => {
      if (level === 'debug') return;
      (level === 'error' ? console.error : console.warn)(`${LOG_PREFIX} ${message}`);
    },
  };
}

function resolveBaseUrl(): string {
  const configured = GM_getValue('dataBaseUrl', null);
  if (typeof configured === 'string' && /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(configured)) return configured;
  return DEFAULT_DATA_BASE_URL;
}

(async () => {
  try {
    const host = gmHost();
    const dataBaseUrl = resolveBaseUrl();
    const client = new DataClient(host, { baseUrl: dataBaseUrl });
    await mountHistoryPanel({ adapters: PAGE_ADAPTERS, host, client, doc: document, location: window.location, dataBaseUrl,
      relationIndex: indexRelations(PRODUCT_RELATIONS), storeLabels: STORE_LABELS });
  } catch (e) {
    console.warn(`${LOG_PREFIX} failed: ${(e as Error).message}`);
  }
})();
