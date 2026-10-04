/**
 * Boundaries of the userscript core. The core never knows which store it is
 * on: a `StorePageAdapter` tells it whether a page is supported, which page
 * key it shows and where the panel may be mounted. Everything that touches
 * the browser host (network, storage, clock) goes through `HostEnv` so the
 * core can be exercised in jsdom with fakes.
 */

export interface MountPoint {
  anchor: Element;
  /** Where the panel goes relative to `anchor`. */
  position: 'before' | 'after' | 'append' | 'prepend';
  /**
   * Inline declarations the host element needs to occupy the width the panel
   * was designed for at this mount point, as CSS property names. Only the
   * store adapter knows the page's own layout, so only it can say this; the
   * panel's own styling stays inside the Shadow DOM.
   */
  hostStyle?: Readonly<Record<string, string>>;
}

export interface StorePageAdapter {
  readonly storeId: string;
  /**
   * Every page the script may run on: product pages plus browsing pages that
   * receive the saved page theme. Never cart, checkout or account pages. The
   * builds copy the list into `@match` and the extension's `matches`, and the
   * controller applies the same list (`urlPattern.ts` documents the subset).
   */
  readonly matchPatterns: readonly string[];
  /** Whether this is a product page, which gets the history panel. */
  matches(location: Pick<Location, 'hostname' | 'pathname'>): boolean;
  /** Page-wide dark styles scoped to `html[data-eph-page-theme="dark"]`; see `pageThemeCss()`. */
  pageThemeCss?: string;
  /** The page key of the product shown, or null when the page is not a product page. */
  extractPageKey(doc: Document, location: Pick<Location, 'hostname' | 'pathname'>): string | null;
  findMountPoint(doc: Document): MountPoint | null;
  initialOfferId?(location: { search?: string }): string | undefined;
}

export interface HostResponse {
  status: number;
  text: string;
}

export interface HostStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Lists keys with a prefix so cache indexes can recover after concurrent tabs race. */
  keys(prefix: string): Promise<string[]>;
}

export interface HostEnv {
  /** Anonymous GET (no cookies), rejects on network failure or timeout. */
  fetchText(url: string, timeoutMs: number): Promise<HostResponse>;
  storage: HostStorage;
  now(): number;
  log(level: 'debug' | 'warn' | 'error', message: string): void;
}
