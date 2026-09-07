/**
 * Minimal Chrome extension API surface used by the extension entry points.
 * Hand-written for the same reason as `userscript/gm.d.ts`: the four calls we
 * make are easier to read here than a dependency, and anything not declared
 * here is a call this extension does not make.
 */

interface ChromeMessageSender {
  /** Extension id of the sender. Messages from other extensions carry a different id. */
  id?: string;
  origin?: string;
  url?: string;
}

interface ChromeStorageArea {
  get(keys: string | readonly string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | readonly string[]): Promise<void>;
}

declare namespace chrome {
  namespace runtime {
    /** This extension's own id; used to reject messages from anywhere else. */
    const id: string;
    function sendMessage(message: unknown): Promise<unknown>;
    namespace onMessage {
      /** Returning true keeps the channel open for an asynchronous `sendResponse`. */
      function addListener(
        listener: (message: unknown, sender: ChromeMessageSender, sendResponse: (response: unknown) => void) => boolean | undefined,
      ): void;
    }
  }
  namespace storage {
    const local: ChromeStorageArea;
  }
}
