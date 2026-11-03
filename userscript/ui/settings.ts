import {
  CARD_FEE_PRESETS, CARD_FEE_RATES_CHECKED_ON, CUSTOM_CARD_ID, CUSTOM_FEE_LIMIT,
  formatFeePercent, validCustomPercent, type Preferences,
} from '../core/preferences.ts';

/**
 * The settings button and its modal. A native `<dialog>` opened with
 * `showModal()` gives the top layer, the inert page behind it, Escape and the
 * focus return; a host without `showModal` gets the open attribute and the same
 * close paths. Every change is saved at once and re-renders the panel, so the
 * dialog is rebuilt open from `settingsOpen` and keeps focus by its focus keys.
 */

export const SETTINGS_CSS = `
.eph dialog.settings { width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); }
.eph dialog.settings::backdrop { background: rgba(0, 0, 0, .4); }
.eph dialog.settings h2 { margin: 0 0 10px; font-size: 15px; }
.eph dialog.settings fieldset { margin: 0 0 12px; padding: 8px 10px 10px; border: 1px solid var(--line); border-radius: 6px; }
.eph dialog.settings legend { padding: 0 4px; font-size: 12px; font-weight: 700; }
.eph dialog.settings label { display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 13px; cursor: pointer; }
.eph dialog.settings label.field { display: block; cursor: default; }
.eph dialog.settings label.field > span { display: block; font-size: 12px; color: var(--muted); }
.eph dialog.settings select, .eph dialog.settings input[type="number"] { width: 100%; min-height: 32px; font-size: 13px; }
.eph dialog.settings input[type="number"] { font: inherit; padding: 2px 6px; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; }
.eph dialog.settings .hint { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
.eph dialog.settings .error { margin: 4px 0 0; font-size: 12px; color: var(--up); }
.eph dialog.settings .actions { display: flex; justify-content: flex-end; }
.eph dialog.settings .actions button { font: inherit; font-size: 13px; min-height: 32px; padding: 4px 14px; border: 1px solid var(--muted); border-radius: 4px; background: var(--chip); color: var(--fg); cursor: pointer; }
.eph dialog.settings :is(input, select, button):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (pointer: coarse) { .eph dialog.settings label, .eph dialog.settings .actions button { min-height: 44px; } }
`;

export interface SettingsHandlers {
  /** Saves and re-renders; the dialog stays open. */
  change(next: Preferences): void;
  /** The dialog was closed by Escape or its close button. */
  closed(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, content = '', className = ''): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

/** Builds the dialog, closed; the caller places it after the button that opens it. */
export function buildSettingsDialog(doc: Document, prefs: Preferences, handlers: SettingsHandlers): HTMLDialogElement {
  const dialog = el(doc, 'dialog', '', 'settings');
  dialog.setAttribute('aria-labelledby', 'eph-settings-title');
  const title = el(doc, 'h2', '表示設定');
  title.id = 'eph-settings-title';
  dialog.appendChild(title);

  const fee = el(doc, 'fieldset');
  fee.appendChild(el(doc, 'legend', '円換算'));
  const enabledLabel = el(doc, 'label');
  const enabled = el(doc, 'input');
  enabled.type = 'checkbox';
  enabled.checked = prefs.cardFee.enabled;
  enabled.dataset['focusKey'] = 'pref-fee-enabled';
  enabled.addEventListener('change', () => handlers.change({ ...prefs, cardFee: { ...prefs.cardFee, enabled: enabled.checked } }));
  enabledLabel.append(enabled, doc.createTextNode('カードの海外事務手数料を円換算に含める'));
  fee.appendChild(enabledLabel);

  const cardLabel = el(doc, 'label', '', 'field');
  cardLabel.appendChild(el(doc, 'span', 'カードの種類'));
  const card = el(doc, 'select');
  card.dataset['focusKey'] = 'pref-fee-card';
  for (const preset of CARD_FEE_PRESETS) {
    // The rate leads: a narrow select cuts the end of the label, and the rate is what is chosen by.
    const option = el(doc, 'option', `${formatFeePercent(preset.percent)}　${preset.label}`);
    option.value = preset.id;
    option.selected = preset.id === prefs.cardFee.cardId;
    card.appendChild(option);
  }
  const custom = el(doc, 'option', 'その他（料率を入力）');
  custom.value = CUSTOM_CARD_ID;
  custom.selected = prefs.cardFee.cardId === CUSTOM_CARD_ID;
  card.appendChild(custom);
  card.addEventListener('change', () => handlers.change({ ...prefs, cardFee: { ...prefs.cardFee, cardId: card.value } }));
  cardLabel.appendChild(card);
  fee.appendChild(cardLabel);

  if (prefs.cardFee.cardId === CUSTOM_CARD_ID) {
    const percentLabel = el(doc, 'label', '', 'field');
    percentLabel.appendChild(el(doc, 'span', `料率（%、${CUSTOM_FEE_LIMIT.min}〜${CUSTOM_FEE_LIMIT.max}）`));
    const percent = el(doc, 'input');
    percent.type = 'number';
    percent.min = String(CUSTOM_FEE_LIMIT.min);
    percent.max = String(CUSTOM_FEE_LIMIT.max);
    percent.step = '0.01';
    percent.inputMode = 'decimal';
    percent.value = prefs.cardFee.customPercent === null ? '' : String(prefs.cardFee.customPercent);
    percent.dataset['focusKey'] = 'pref-fee-percent';
    const error = el(doc, 'p', '', 'error');
    error.id = 'eph-fee-percent-error';
    error.hidden = true;
    percent.setAttribute('aria-describedby', error.id);
    percent.addEventListener('change', () => {
      const value = percent.value.trim() === '' ? null : validCustomPercent(Number(percent.value));
      if (percent.value.trim() !== '' && value === null) {
        error.textContent = `${CUSTOM_FEE_LIMIT.min}〜${CUSTOM_FEE_LIMIT.max} の数値を入力してください`;
        error.hidden = false;
        percent.setAttribute('aria-invalid', 'true');
        return;
      }
      handlers.change({ ...prefs, cardFee: { ...prefs.cardFee, customPercent: value } });
    });
    percentLabel.appendChild(percent);
    fee.append(percentLabel, error);
    if (prefs.cardFee.enabled && prefs.cardFee.customPercent === null) fee.appendChild(el(doc, 'p', '料率を入力するまで手数料は加算されません。', 'hint'));
  }
  fee.appendChild(el(doc, 'p', `料率は各カード会社の公表値（${CARD_FEE_RATES_CHECKED_ON} 確認）。カードや時期で変わることがあり、実際の請求額は決済日の換算レートで決まります。`, 'hint'));
  dialog.appendChild(fee);

  const stock = el(doc, 'fieldset');
  stock.appendChild(el(doc, 'legend', '在庫'));
  const stockLabel = el(doc, 'label');
  const showStock = el(doc, 'input');
  showStock.type = 'checkbox';
  showStock.checked = prefs.showStock;
  showStock.dataset['focusKey'] = 'pref-show-stock';
  showStock.addEventListener('change', () => handlers.change({ ...prefs, showStock: showStock.checked }));
  stockLabel.append(showStock, doc.createTextNode('在庫数の推移をグラフに表示'));
  stock.append(stockLabel, el(doc, 'p', '店舗が在庫数を表示し、その数を記録している商品だけに表示します。', 'hint'));
  dialog.appendChild(stock);

  const actions = el(doc, 'div', '', 'actions');
  const close = el(doc, 'button', '閉じる');
  close.type = 'button';
  close.dataset['focusKey'] = 'pref-close';
  close.addEventListener('click', () => closeSettingsDialog(dialog));
  actions.appendChild(close);
  dialog.appendChild(actions);

  // A re-render removes this dialog while it is open; only a close the viewer made counts.
  dialog.addEventListener('close', () => { if (dialog.isConnected) handlers.closed(); });
  // A modal closes on Escape by itself; a dialog the fallback opened needs this.
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape' && dialog.dataset['fallback'] !== undefined) closeSettingsDialog(dialog); });
  return dialog;
}

export function openSettingsDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  try {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      return;
    }
  } catch { /* Not connected yet, or the host refused a modal: fall back to a plain open dialog. */ }
  dialog.dataset['fallback'] = '';
  dialog.setAttribute('open', '');
}

export function closeSettingsDialog(dialog: HTMLDialogElement): void {
  delete dialog.dataset['fallback'];
  if (typeof dialog.close === 'function') {
    dialog.close();
    return;
  }
  dialog.removeAttribute('open');
  dialog.dispatchEvent(new (dialog.ownerDocument.defaultView?.Event ?? Event)('close'));
}
