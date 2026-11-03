import { describe, expect, it, vi } from 'vitest';
import { CARD_FEE_PRESETS, CUSTOM_CARD_ID, DEFAULT_PREFERENCES, formatFeePercent } from '../../userscript/core/preferences.ts';
import { buildSettingsDialog, openSettingsDialog } from '../../userscript/ui/settings.ts';

describe('card options', () => {
  it('lead with the rate, so a narrow select that cuts the label still shows it', () => {
    const dialog = buildSettingsDialog(document, DEFAULT_PREFERENCES, { change: vi.fn(), closed: vi.fn() });
    const options = [...dialog.querySelectorAll<HTMLOptionElement>('select option')];
    const presets = options.filter((option) => option.value !== CUSTOM_CARD_ID);
    expect(presets.map((option) => option.value)).toEqual(CARD_FEE_PRESETS.map((preset) => preset.id));
    for (const [index, preset] of CARD_FEE_PRESETS.entries()) {
      expect(presets[index]!.textContent).toBe(`${formatFeePercent(preset.percent)}　${preset.label}`);
    }
    expect(options.find((option) => option.value === CUSTOM_CARD_ID)!.textContent).toBe('その他（料率を入力）');
  });
});

describe('settings dialog fallback', () => {
  it('closes on Escape when the host refuses a modal and the dialog opens as a plain open dialog', () => {
    // A host that has showModal but refuses it, e.g. for a dialog it cannot make modal.
    // jsdom has no showModal, so it goes on the prototype before the dialog is built.
    const proto = HTMLDialogElement.prototype as { showModal?: () => void };
    expect(proto.showModal).toBeUndefined();
    proto.showModal = () => { throw new DOMException('refused', 'InvalidStateError'); };
    const closed = vi.fn();
    const dialog = buildSettingsDialog(document, DEFAULT_PREFERENCES, { change: vi.fn(), closed });
    document.body.appendChild(dialog);
    try {
      openSettingsDialog(dialog);
      expect(dialog.hasAttribute('open')).toBe(true);
      dialog.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(closed).toHaveBeenCalledTimes(1);
      // Other keys leave it open.
      openSettingsDialog(dialog);
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(dialog.hasAttribute('open')).toBe(true);
    } finally {
      dialog.remove();
      delete proto.showModal;
    }
  });
});
