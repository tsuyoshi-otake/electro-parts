import type { DataClient, LoadState } from './dataClient.ts';
import type { HostEnv, MountPoint, StorePageAdapter } from './types.ts';
import { renderPanel, type PanelContext } from '../ui/panel.ts';
import { relatedEntries, relationProductKey, type ProductRelation } from './relations.ts';

/**
 * Page lifecycle: pick the adapter for the current location, find the page
 * key and mount point, mount a Shadow DOM host, load data with
 * stale-while-revalidate and re-render on every state change.
 *
 * Fail-open: nothing here may throw into the page. Every failure is logged
 * and, at worst, no panel is shown.
 */

export const HOST_ELEMENT_ID = 'electronics-price-history-root';
export const THEME_STORAGE_KEY = 'eph:theme';

export interface ControllerOptions {
  adapters: readonly StorePageAdapter[];
  host: HostEnv;
  client: DataClient;
  doc: Document;
  location: Pick<Location, 'hostname' | 'pathname'> & Partial<Pick<Location, 'search'>>;
  dataBaseUrl: string;
  /** How long to watch the DOM for a late mount point before giving up. */
  mountTimeoutMs?: number;
  lazyChart?: boolean;
  relationIndex?: ReadonlyMap<string, readonly ProductRelation[]>;
  storeLabels?: Readonly<Record<string, string>>;
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
    let destroyed = false;
    let cleanup = () => undefined as void;
    handle.destroy = () => { destroyed = true; cleanup(); hostEl.remove(); };

    let theme: 'light' | 'dark' = 'light';
    try {
      const saved = await host.storage.get(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch {
      host.log('warn', 'display preference unavailable; using light theme');
    }
    // Serialize writes so a slow earlier save cannot overwrite a later click.
    let themeSave = Promise.resolve();
    const ctx: PanelContext = {
      doc, dataBaseUrl: options.dataBaseUrl, lazyChart: options.lazyChart ?? true, theme,
      storeLabel: (storeId) => options.storeLabels?.[storeId] ?? storeId,
      related: relatedEntries(options.relationIndex?.get(relationProductKey(adapter.storeId, pageKey)) ?? [], adapter.storeId, pageKey),
      onThemeChange: (value) => {
        ctx.theme = value;
        themeSave = themeSave.then(() => host.storage.set(THEME_STORAGE_KEY, value)).catch(() => {
          host.log('warn', 'display preference could not be saved');
        });
      },
    };
    const initialOffer = adapter.initialOfferId?.(options.location);
    if (initialOffer) ctx.selectedOfferId = initialOffer;
    cleanup = () => ctx.cleanup?.();
    let current: LoadState = { kind: 'loading' };
    let selected: number | null = null;
    ctx.onSelectOffer = (id) => {
      ctx.selectedOfferId = id;
      selected = null;
      render();
    };
    const render = () => {
      if (destroyed) return;
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
    // Related content is not displayed without the current product. Complete
    // those states explicitly without spending requests on invisible cards.
    if ((current as LoadState).kind !== 'ready') {
      for (const entry of ctx.related ?? []) entry.state = { kind: 'error', message: 'この商品の観測データがありません' };
      return handle;
    }
    // Only the page controller owns related loads. Renders, theme changes and
    // stale-while-revalidate callbacks never initiate more work. Two workers,
    // no automatic retries, and destroyed panels do not start queued requests.
    const groups = new Map<string, NonNullable<PanelContext['related']>>();
    for (const entry of ctx.related ?? []) {
      if (entry.state.kind === 'reference_only') continue;
      const key = relationProductKey(entry.target.storeId, entry.target.pageKey);
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    const jobs = [...groups.values()];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, async () => {
      while (!destroyed && next < jobs.length) {
        const group = jobs[next++];
        const first = group?.[0];
        if (!first || !group) continue;
        await options.client.load(first.target.storeId, first.target.pageKey, (state) => {
          if (destroyed) return;
          for (const entry of group) entry.state = state;
          render();
        });
      }
    }));
  } catch (e) {
    host.log('error', `history panel failed: ${(e as Error).message}`);
  }
  return handle;
}
