import type { ProductFileV1 } from '../../src/publisher/contract.ts';
import type { DataClient, LoadState } from './dataClient.ts';
import type { ExchangeRateClient } from './exchangeRate.ts';
import type { HostEnv, MountPoint, StorePageAdapter } from './types.ts';
import { keepPanelStateAcrossReinsert, renderPanel, type PanelContext } from '../ui/panel.ts';
import { createPageTheme } from '../ui/pageTheme.ts';
import { relatedEntries, relationProductKey, type ProductRelation, type RelationSource } from './relations.ts';
import { matchesUrlPattern } from './urlPattern.ts';
import { parsePreferences, PREFERENCES_STORAGE_KEY, serializePreferences, type Preferences } from './preferences.ts';

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
/** Related cards are an addition to the product: past this wait the panel stays as it is and the pending work ends. */
export const RELATIONS_WAIT_MS = 10_000;

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
  /** Absent means no relations: the panel shows the product alone. */
  relations?: RelationSource;
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

/** The one panel a controller shows at a time. */
interface Panel {
  readonly pageKey: string;
  /** False once closed, or when the page removed the panel's host. */
  attached(): boolean;
  /** Terminal: removes the host and stops the panel's renders and pending loads. */
  close(): void;
}

/**
 * Puts the host at the mount point, carrying that mount point's declarations
 * only (the controller is the one writer of the host's inline style). A host
 * already there is left alone. A host already in the document moves with
 * `moveBefore` where the browser has it, which keeps its state (focus, an open
 * modal dialog); otherwise it is re-inserted. Returns true only for that
 * re-insertion of a host that was in the document, which lost that state.
 */
function insert(mount: MountPoint, node: HTMLElement): boolean {
  const { anchor, position } = mount;
  node.removeAttribute('style');
  for (const [property, value] of Object.entries(mount.hostStyle ?? {})) node.style.setProperty(property, value);
  const parent = position === 'append' || position === 'prepend' ? anchor : anchor.parentNode;
  if (parent === null) return false;
  const before = position === 'append' ? null : position === 'prepend' ? anchor.firstChild : position === 'before' ? anchor : anchor.nextSibling;
  if (node.parentNode === parent && (before === node || node.nextSibling === before)) return false;
  const moveBefore = (parent as ParentNode & { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore;
  if (node.isConnected && typeof moveBefore === 'function') {
    try {
      moveBefore.call(parent, node, before);
      return false;
    } catch { /* Refused (another document or shadow tree): re-insert below. */ }
  }
  const reinserted = node.isConnected;
  parent.insertBefore(node, before);
  return reinserted;
}

/**
 * Keeps the host where the adapter wants it when the page's layout switches:
 * each time the adapter's layout query flips, its mount point is asked again.
 * A host the page removed, or a layout with no mount point, stays as it is.
 * A re-inserted host gets its open settings dialog and focus back. Returns the
 * stop.
 */
function followLayout(adapter: StorePageAdapter, doc: Document, node: HTMLElement, shadow: ShadowRoot, host: HostEnv): () => void {
  const view = doc.defaultView;
  if (adapter.layoutQuery === undefined || view === null || typeof view.matchMedia !== 'function') return () => undefined;
  const query = view.matchMedia(adapter.layoutQuery);
  const relocate = () => {
    if (!node.isConnected) return;
    try {
      const mount = adapter.findMountPoint(doc);
      if (mount === null) return;
      const restore = keepPanelStateAcrossReinsert(shadow);
      if (insert(mount, node)) restore();
    } catch (e) {
      host.log('error', `panel could not follow the layout: ${(e as Error).message}`);
    }
  };
  query.addEventListener('change', relocate);
  return () => query.removeEventListener('change', relocate);
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
    // Read alongside the theme so the page colors are not delayed by it.
    const preferencesRead = host.storage.get(PREFERENCES_STORAGE_KEY).then(parsePreferences, () => {
      host.log('warn', 'settings unavailable; using defaults');
      return parsePreferences(null);
    });
    let theme: 'light' | 'dark' = 'light';
    try {
      const saved = await host.storage.get(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch { host.log('warn', 'display preference unavailable; using light theme'); }
    const pageTheme = createPageTheme(doc, adapter.pageThemeCss ?? '');
    pageTheme.set(theme);
    let preferences: Preferences = await preferencesRead;
    handle.destroy = () => { pageTheme.destroy(); release(); };
    // Serialize writes so a slow earlier save cannot overwrite a later click.
    let themeSave = Promise.resolve();
    const saveTheme = (value: 'light' | 'dark') => {
      themeSave = themeSave.then(() => host.storage.set(THEME_STORAGE_KEY, value)).catch(() => {
        host.log('warn', 'display preference could not be saved');
      });
    };
    let preferencesSave = Promise.resolve();
    const savePreferences = (value: Preferences) => {
      preferencesSave = preferencesSave.then(() => host.storage.set(PREFERENCES_STORAGE_KEY, serializePreferences(value))).catch(() => {
        host.log('warn', 'settings could not be saved');
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

    // At most one panel at a time. `close` is terminal for that panel: its
    // pending loads stop starting work and its renders stop, whoever closed it.
    let panel: Panel | null = null;
    const show = async (pageKey: string): Promise<void> => {
      let closed = false;
      let hostEl: HTMLElement | null = null;
      let cleanup = () => undefined as void;
      let stopWaitingForRelations = () => undefined as void;
      const self: Panel = {
        pageKey,
        // Until the host exists the panel is still being set up (or found no
        // place); only a host the page removed later needs a new panel.
        attached: () => !closed && (hostEl === null || hostEl.isConnected),
        close: () => {
          if (closed) return;
          closed = true;
          cleanup();
          hostEl?.remove();
          if (panel === self) panel = null;
          if (hostEl !== null) handle.mounted = false;
        },
      };
      panel = self;
      handle.pageKey = pageKey;
      if (doc.getElementById(HOST_ELEMENT_ID) !== null) {
        host.log('debug', 'panel already mounted');
        return;
      }
      const mount = await waitForMountPoint(adapter, doc, options.mountTimeoutMs ?? 10_000);
      if (closed) return;
      if (mount === null) {
        host.log('warn', 'mount point not found');
        return;
      }
      if (doc.getElementById(HOST_ELEMENT_ID) !== null) return;

      hostEl = doc.createElement('div');
      hostEl.id = HOST_ELEMENT_ID;
      hostEl.setAttribute('data-store', adapter.storeId);
      hostEl.setAttribute('data-page-key', pageKey);
      const shadow = hostEl.attachShadow({ mode: 'open' });
      insert(mount, hostEl);
      handle.mounted = true;
      const stopFollowingLayout = followLayout(adapter, doc, hostEl, shadow, host);
      // The panel carries the theme switch; a reset offered while none was shown would only cover the page.
      pageTheme.withdrawLightReset();
      const ctx: PanelContext = {
        doc, dataBaseUrl: options.dataBaseUrl, lazyChart: options.lazyChart ?? true, theme,
        storeLabel: (storeId) => options.storeLabels?.[storeId] ?? storeId,
        related: [],
        onThemeChange: (value) => {
          theme = value;
          ctx.theme = value;
          pageTheme.set(value);
          saveTheme(value);
        },
        preferences,
        onPreferencesChange: (value) => {
          preferences = value;
          ctx.preferences = value;
          savePreferences(value);
          render();
        },
      };
      const initialOffer = adapter.initialOfferId?.(options.location);
      if (initialOffer) ctx.selectedOfferId = initialOffer;
      cleanup = () => {
        stopFollowingLayout();
        ctx.cleanup?.();
        stopWaitingForRelations();
      };
      let current: LoadState = { kind: 'loading' };
      let selected: number | null = null;
      ctx.onSelectOffer = (id) => {
        ctx.selectedOfferId = id;
        selected = null;
        render();
      };
      const render = () => {
        if (closed) return;
        try {
          renderPanel(ctx, shadow, current, selected, (index) => {
            selected = index;
            render();
          });
        } catch (e) {
          host.log('error', `render failed: ${(e as Error).message}`);
        }
      };
      // The product and its relations load side by side; neither waits for the
      // other to render. Every way the relations end (answer, failure, the wait
      // bound, a closed panel) settles this promise, and none of them throws.
      const loadRelations = (source: RelationSource): Promise<void> => new Promise<void>((settle) => {
        let done = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          settle();
        };
        const fail = (message: string) => {
          if (done) return;
          host.log('warn', `related products unavailable: ${message}`);
          finish();
        };
        stopWaitingForRelations = finish;
        timer = setTimeout(() => fail(`no answer within ${RELATIONS_WAIT_MS} ms`), RELATIONS_WAIT_MS);
        // A synchronous throw from the source becomes a rejection like any other.
        new Promise<readonly ProductRelation[]>((resolve) => resolve(source.relationsFor(adapter.storeId, pageKey))).then((relations) => {
          // After the bound or a close the answer is late: it changes nothing.
          if (done) return;
          ctx.related = relatedEntries(relations, adapter.storeId, pageKey);
          render();
          finish();
        }).catch((e: unknown) => fail((e as Error).message));
      });
      render();
      const relationsSettled = options.relations === undefined ? null : loadRelations(options.relations);
      await options.client.load(adapter.storeId, pageKey, (state) => {
        current = state;
        render();
      });
      const loaded = current as LoadState;
      // Current prices in a supported currency read in yen, on the viewed product
      // and on loaded rows of other stores alike. The client answers from its
      // stored rate on most pages and fetches at most once a day; each currency
      // is asked once per panel. Without a rate the panel shows recorded prices.
      const rates = options.exchangeRates;
      const rateLoads = new Map<string, Promise<void>>();
      const ensureRates = (product: ProductFileV1) => {
        if (rates === undefined) return;
        for (const currency of new Set(product.offers.flatMap((offer) => offer.segments).map((segment) => segment.basis.currency))) {
          if (!rates.supports(currency) || rateLoads.has(currency)) continue;
          rateLoads.set(currency, rates.get(currency).then((rate) => {
            if (closed || rate === null) return;
            ctx.yenRates = { ...ctx.yenRates, [currency]: rate };
            render();
          }));
        }
      };
      if (loaded.kind === 'ready') ensureRates(loaded.product);
      // What follows reads the related entries, so it starts once the relations have settled too.
      if (relationsSettled !== null) await relationsSettled;
      // Related content is not displayed without the current product. Complete
      // those states explicitly without spending requests on invisible cards.
      if (loaded.kind !== 'ready') {
        for (const entry of ctx.related ?? []) entry.state = { kind: 'error', message: 'この商品の観測データがありません' };
        return;
      }
      // Only the page controller owns related loads. Renders, theme changes and
      // stale-while-revalidate callbacks never initiate more work. Two workers,
      // no automatic retries, and closed panels do not start queued requests.
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
        while (!closed && next < jobs.length) {
          const group = jobs[next++];
          const first = group?.[0];
          if (!first || !group) continue;
          await options.client.load(first.target.storeId, first.target.pageKey, (state) => {
            if (closed) return;
            for (const entry of group) entry.state = state;
            if (state.kind === 'ready') ensureRates(state.product);
            render();
          });
        }
      }));
      await Promise.all(rateLoads.values());
    };

    const watch = adapter.watchPageKey;
    if (watch === undefined) {
      const pageKey = adapter.extractPageKey(doc, options.location);
      if (pageKey === null) {
        host.log('debug', 'not a product page');
        return withoutPanel();
      }
      handle.destroy = () => { panel?.close(); pageTheme.destroy(); release(); };
      await show(pageKey);
      return handle.mounted ? handle : withoutPanel();
    }

    // The product shown changes in place: follow it with one panel at a time.
    // A key the adapter reports again keeps its panel unless the page removed it.
    const follow = (pageKey: string | null) => {
      if (pageKey !== null && panel?.pageKey === pageKey && panel.attached()) return;
      panel?.close();
      handle.pageKey = pageKey;
      if (pageKey === null) {
        withoutPanel();
        return;
      }
      void show(pageKey).then(() => {
        if (!handle.mounted && handle.pageKey === pageKey) withoutPanel();
      }).catch((e: unknown) => host.log('error', `history panel failed: ${(e as Error).message}`));
    };
    const unwatch = watch.call(adapter, doc, follow);
    handle.destroy = () => { unwatch(); panel?.close(); pageTheme.destroy(); release(); };
    const initial = adapter.extractPageKey(doc, options.location);
    if (initial === null) {
      host.log('debug', 'no product shown yet');
      return withoutPanel();
    }
    await show(initial);
  } catch (e) {
    host.log('error', `history panel failed: ${(e as Error).message}`);
  }
  return handle;
}
