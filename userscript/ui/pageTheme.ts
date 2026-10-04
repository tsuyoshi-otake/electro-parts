/** Store adapters supply surfaces; this module only owns reversible page styles. */
export function pageThemeCss(surfaces: string, extra = '', preserve = ''): string {
  const scope = 'html[data-eph-page-theme="dark"]';
  const target = preserve ? `:not(:is(${preserve})):not(:is(${preserve}) *)` : '';
  return `
${scope} { color-scheme: dark; background-color: #3e3e3e !important; }
${scope} body { background-color: #3e3e3e !important; color: #e6edf3 !important; }
${scope} :is(${surfaces}, input:not([type="image"]), select, textarea, table, tr, td, th)${target} { background-color: #3e3e3e !important; border-color: var(--eph-page-border, #3d4856) !important; }
${scope} :is(h1,h2,h3,h4,h5,h6,p,span,div,li,dt,dd,label,legend,summary,td,th,input,textarea,select)${target} { color: #e6edf3 !important; }
${scope} a${target} { color: #91bdff !important; }
${scope} :is(button,[role="button"],input[type="submit"],input[type="button"])${target} { background-color: #253c59 !important; color: #e6edf3 !important; border-color: #6e8bab !important; }
${scope} :is(button,[role="button"],input[type="submit"])${target}:not(:disabled):hover { background-color: #345278 !important; }
${scope} :is(button,[role="button"],input[type="submit"])${target}:not(:disabled):active { background-color: #1a2c42 !important; }
${scope} :is(button,input,select,textarea)${target}:disabled { color: #a0aab8 !important; background-color: #252b34 !important; }
${scope} :is(a,button,input,select,textarea,[tabindex])${target}:focus-visible { outline: 2px solid #91bdff !important; outline-offset: 2px !important; }
${scope} ${target}::placeholder { color: #aeb9c8 !important; opacity: 1; }
${preserve ? `${scope} :is(${preserve}) { color-scheme: light; color: var(--eph-preserved-color, CanvasText); }` : ''}
${extra}
`;
}

export const PAGE_THEME_CONTROL_ID = 'electronics-page-theme-control';

export interface PageTheme {
  set(theme: 'light' | 'dark'): void;
  /**
   * While the dark page colors are applied, shows a fixed button that restores
   * the store's own colors and then calls `onLight`. For pages where no
   * history panel (and therefore no theme switch) is shown.
   */
  offerLightReset(onLight: () => void): void;
  destroy(): void;
}

/**
 * The caller must own the document (one controller per page): restoring light
 * removes the page attribute outright instead of guessing what another
 * script left there.
 */
export function createPageTheme(doc: Document, css: string): PageTheme {
  const style = doc.createElement('style');
  style.dataset['ephPageTheme'] = '';
  style.textContent = css;
  const root = doc.documentElement;
  let control: HTMLElement | null = null;
  let destroyed = false;
  const restore = () => {
    style.remove();
    control?.remove();
    control = null;
    root.removeAttribute('data-eph-page-theme');
  };
  const theme: PageTheme = {
    set(value) {
      if (destroyed) return;
      if (value === 'light' || !css) { restore(); return; }
      if (!style.isConnected) (doc.head ?? root).appendChild(style);
      root.setAttribute('data-eph-page-theme', 'dark');
    },
    offerLightReset(onLight) {
      if (destroyed || control !== null || !style.isConnected || doc.body === null) return;
      const toggleHost = doc.createElement('div');
      toggleHost.id = PAGE_THEME_CONTROL_ID;
      const shadow = toggleHost.attachShadow({ mode: 'open' });
      const controlStyle = doc.createElement('style');
      controlStyle.textContent = ':host{position:fixed;bottom:16px;left:16px;z-index:10000}button{font:13px system-ui;padding:10px 14px;min-height:44px;background:#253c59;color:#e6edf3;border:1px solid #91bdff;border-radius:6px;cursor:pointer}button:hover{background:#345278}button:focus-visible{outline:2px solid #91bdff;outline-offset:3px}';
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = 'ライトに戻す';
      button.addEventListener('click', () => {
        theme.set('light');
        onLight();
      });
      shadow.append(controlStyle, button);
      doc.body.appendChild(toggleHost);
      control = toggleHost;
    },
    destroy() { destroyed = true; restore(); },
  };
  return theme;
}
