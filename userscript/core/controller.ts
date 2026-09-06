import type { DataClient, LoadState } from './dataClient.ts';
import type { HostEnv, MountPoint, StorePageAdapter } from './types.ts';
import { renderPanel, type PanelContext } from '../ui/panel.ts';

/**
 * Page lifecycle: pick the adapter for the current location, find the page
 * key and mount point, mount a Shadow DOM host, load data with
 * stale-while-revalidate and re-render on every state change.
 *
 * Fail-open: nothing here may throw into the page. Every failure is logged
 * and, at worst, no panel is shown.
 */

export const HOST_ELEMENT_ID = 'electronics-price-history-root';

export interface ControllerOptions {
  adapters: readonly StorePageAdapter[];
  host: HostEnv;
  client: DataClient;
  doc: Document;
  location: Pick<Location, 'hostname' | 'pathname'>;
  dataBaseUrl: string;
  /** How long to watch the DOM for a late mount point before giving up. */
  mountTimeoutMs?: number;
  lazyChart?: boolean;
}

export interface ControllerHandle {
  mounted: boolean;
  storeId: string | null;
  pageKey: string | null;
  destroy(): void;
}

function insert(mount: MountPoint, node: HTMLElement): void {
  const { anchor, position } = mount;
  for (const [property, value] of Object.entries(mount.hostStyle ?? {})) node.style.setProperty(property, value);
  if (position === 'append') anchor.appendChild(node);
  else if (position === 'prepend') anchor.insertBefore(node, anchor.firstChild);
  else if (position === 'before') anchor.parentNode?.insertBefore(node, anchor);
  else anchor.parentNode?.insertBefore(node, anchor.nextSibling);
}

/** Resolves with the mount point, waiting (bounded) for late DOM if needed. */
function waitForMountPoint(adapter: StorePageAdapter, doc: Document, timeoutMs: number): Promise<MountPoint | null> {
  const first = adapter.findMountPoint(doc);
  if (first !== null) return Promise.resolve(first);
  const view = doc.defaultView;
  if (view === null || typeof view.MutationObserver !== 'function' || doc.body === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: MountPoint | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      view.clearTimeout(timer);
      resolve(value);
    };
    const observer = new view.MutationObserver(() => {
      const found = adapter.findMountPoint(doc);
      if (found !== null) finish(found);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    const timer = view.setTimeout(() => finish(null), timeoutMs);
  });
}

export async function mountHistoryPanel(options: ControllerOptions): Promise<ControllerHandle> {
  const { host, doc } = options;
  const handle: ControllerHandle = { mounted: false, storeId: null, pageKey: null, destroy: () => undefined };
  try {
    const adapter = options.adapters.find((a) => a.matches(options.location));
    if (adapter === undefined) return handle;
    handle.storeId = adapter.storeId;
    const pageKey = adapter.extractPageKey(doc, options.location);
    if (pageKey === null) {
      host.log('debug', 'not a product page');
      return handle;
    }
    handle.pageKey = pageKey;
    if (doc.getElementById(HOST_ELEMENT_ID) !== null) {
      host.log('debug', 'panel already mounted');
      return handle;
    }
    const mount = await waitForMountPoint(adapter, doc, options.mountTimeoutMs ?? 10_000);
    if (mount === null) {
      host.log('warn', 'mount point not found');
      return handle;
    }
    if (doc.getElementById(HOST_ELEMENT_ID) !== null) return handle;

    const hostEl = doc.createElement('div');
    hostEl.id = HOST_ELEMENT_ID;
    hostEl.setAttribute('data-store', adapter.storeId);
    hostEl.setAttribute('data-page-key', pageKey);
    const shadow = hostEl.attachShadow({ mode: 'open' });
    insert(mount, hostEl);
    handle.mounted = true;
    handle.destroy = () => hostEl.remove();

    const ctx: PanelContext = { doc, dataBaseUrl: options.dataBaseUrl, lazyChart: options.lazyChart ?? true };
    let current: LoadState = { kind: 'loading' };
    let selected: number | null = null;
    const render = () => {
      try {
        renderPanel(ctx, shadow, current, selected, (index) => {
          selected = index;
          render();
        });
      } catch (e) {
        host.log('error', `render failed: ${(e as Error).message}`);
      }
    };
    render();
    await options.client.load(adapter.storeId, pageKey, (state) => {
      current = state;
      render();
    });
  } catch (e) {
    host.log('error', `history panel failed: ${(e as Error).message}`);
  }
  return handle;
}
