import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../../userscript/core/preferences.ts';
import { buildSettingsDialog, openSettingsDialog } from '../../userscript/ui/settings.ts';

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
