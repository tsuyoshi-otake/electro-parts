import type { DataClient, LoadState } from './dataClient.ts';
import type { ExchangeRateClient } from './exchangeRate.ts';
import type { HostEnv, MountPoint, StorePageAdapter } from './types.ts';
import { renderPanel, type PanelContext } from '../ui/panel.ts';
import { createPageTheme } from '../ui/pageTheme.ts';
import { relatedEntries, relationProductKey, type ProductRelation } from './relations.ts';
import { matchesUrlPattern } from './urlPattern.ts';

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
/** Set on `<html>` by the controller that owns the page. */
export const OWNER_ATTRIBUTE = 'data-eph-owner';

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
  /** Yen reference values for prices recorded in a foreign currency. */
  exchangeRates?: Pick<ExchangeRateClient, 'supports' | 'get'>;
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

/**
 * One controller per document. The userscript and the extension can both be
 * installed and share the page DOM (not their JavaScript), so the claim is a
 * DOM attribute taken synchronously before the first await; the second
 * instance leaves the page alone. Returns the release, or null when taken.
 */
function claimDocument(doc: Document): (() => void) | null {
  const root = doc.documentElement;
  if (root.hasAttribute(OWNER_ATTRIBUTE)) return null;
  const token = Math.random().toString(36).slice(2);
  root.setAttribute(OWNER_ATTRIBUTE, token);
  return () => {
    if (root.getAttribute(OWNER_ATTRIBUTE) === token) root.removeAttribute(OWNER_ATTRIBUTE);
  };
}

export async function mountHistoryPanel(options: ControllerOptions): Promise<ControllerHandle> {
  const { host, doc } = options;
  const handle: ControllerHandle = { mounted: false, storeId: null, pageKey: null, destroy: () => undefined };
  try {
    // The adapter's patterns are the whole scope, the same list the browser
    // applied before running us: product pages plus browsing pages, never
    // cart, checkout or account pages.
    const adapter = options.adapters.find((a) => a.matchPatterns.some((p) => matchesUrlPattern(p, options.location)));
    if (adapter === undefined) return handle;
    handle.storeId = adapter.storeId;
    // A panel from a version that predates the owner claim.
    if (doc.getElementById(HOST_ELEMENT_ID) !== null) return handle;
    const release = claimDocument(doc);
    if (release === null) {
      host.log('debug', 'another instance owns this page');
      return handle;
    }
    handle.destroy = release;
    let theme: 'light' | 'dark' = 'light';
    try {
      const saved = await host.storage.get(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch { host.log('warn', 'display preference unavailable; using light theme'); }
    const pageTheme = createPageTheme(doc, adapter.pageThemeCss ?? '');
    pageTheme.set(theme);
    handle.destroy = () => { pageTheme.destroy(); release(); };
    // Serialize writes so a slow earlier save cannot overwrite a later click.
    let themeSave = Promise.resolve();
    const saveTheme = (value: 'light' | 'dark') => {
      themeSave = themeSave.then(() => host.storage.set(THEME_STORAGE_KEY, value)).catch(() => {
        host.log('warn', 'display preference could not be saved');
      });
    };
    // Every exit without a panel keeps a direct way back to the store's colors.
    const withoutPanel = () => {
      pageTheme.offerLightReset(() => saveTheme('light'));
      return handle;
    };
    // Apply the saved page colors at document_start. Product metadata and
    // insertion anchors must wait until parsing is complete.
    if (doc.readyState === 'loading') {
      await new Promise<void>((resolve) => doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
    }
    if (!adapter.matches(options.location)) return withoutPanel();
    const pageKey = adapter.extractPageKey(doc, options.location);
    if (pageKey === null) {
      host.log('debug', 'not a product page');
      return withoutPanel();
    }
    handle.pageKey = pageKey;
    if (doc.getElementById(HOST_ELEMENT_ID) !== null) {
      host.log('debug', 'panel already mounted');
      return withoutPanel();
    }
    const mount = await waitForMountPoint(adapter, doc, options.mountTimeoutMs ?? 10_000);
    if (mount === null) {
      host.log('warn', 'mount point not found');
      return withoutPanel();
    }
    if (doc.getElementById(HOST_ELEMENT_ID) !== null) return withoutPanel();

    const hostEl = doc.createElement('div');
    hostEl.id = HOST_ELEMENT_ID;
    hostEl.setAttribute('data-store', adapter.storeId);
    hostEl.setAttribute('data-page-key', pageKey);
    const shadow = hostEl.attachShadow({ mode: 'open' });
    insert(mount, hostEl);
    handle.mounted = true;
    let destroyed = false;
    let cleanup = () => undefined as void;
    handle.destroy = () => { destroyed = true; cleanup(); pageTheme.destroy(); hostEl.remove(); release(); };
    const ctx: PanelContext = {
      doc, dataBaseUrl: options.dataBaseUrl, lazyChart: options.lazyChart ?? true, theme,
      storeLabel: (storeId) => options.storeLabels?.[storeId] ?? storeId,
      related: relatedEntries(options.relationIndex?.get(relationProductKey(adapter.storeId, pageKey)) ?? [], adapter.storeId, pageKey),
      onThemeChange: (value) => {
        ctx.theme = value;
        pageTheme.set(value);
        saveTheme(value);
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
    const loaded = current as LoadState;
    if (loaded.kind !== 'ready') {
      for (const entry of ctx.related ?? []) entry.state = { kind: 'error', message: 'この商品の観測データがありません' };
      return handle;
    }
    // A yen reference only for a product with prices in a supported currency;
    // the client answers from its stored rate on most pages and fetches at most
    // once a day. Without a rate the panel stays as it is.
    const rates = options.exchangeRates;
    const rateCurrency = rates === undefined ? undefined
      : loaded.product.offers.flatMap((offer) => offer.segments).map((segment) => segment.basis.currency).find((currency) => rates.supports(currency));
    const rateLoad = rates === undefined || rateCurrency === undefined ? Promise.resolve() : rates.get(rateCurrency).then((rate) => {
      if (destroyed || rate === null) return;
      ctx.exchangeRate = rate;
      render();
    });
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
    await Promise.all([rateLoad, ...Array.from({ length: Math.min(2, jobs.length) }, async () => {
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
    })]);
  } catch (e) {
    host.log('error', `history panel failed: ${(e as Error).message}`);
  }
  return handle;
}
