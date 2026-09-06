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
  /** Tampermonkey `@match` patterns; the build script copies them into the header. */
  readonly matchPatterns: readonly string[];
  matches(location: Pick<Location, 'hostname' | 'pathname'>): boolean;
  /** The page key of the product shown, or null when the page is not a product page. */
  extractPageKey(doc: Document, location: Pick<Location, 'hostname' | 'pathname'>): string | null;
  findMountPoint(doc: Document): MountPoint | null;
}

export interface HostResponse {
  status: number;
  text: string;
}

export interface HostStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface HostEnv {
  /** Anonymous GET (no cookies), rejects on network failure or timeout. */
  fetchText(url: string, timeoutMs: number): Promise<HostResponse>;
  storage: HostStorage;
  now(): number;
  log(level: 'debug' | 'warn' | 'error', message: string): void;
}
