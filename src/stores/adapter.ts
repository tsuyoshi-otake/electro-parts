import type { StoreCapabilities } from '../core/capabilities.ts';
import type { NormalizedSnapshot, StoreId } from '../core/domain.ts';
import type { ValidationResult } from '../core/validation.ts';

/**
 * Boundary between a store's raw snapshot format and the common domain.
 *
 * An adapter validates a raw snapshot and normalizes identity, prices,
 * availability, quantity semantics, offers and metadata. It does NOT compute
 * history, touch SQLite, build static JSON or render anything.
 */
export interface StoreSnapshotAdapter {
  readonly storeId: StoreId;
  readonly capabilities: StoreCapabilities;
  /** Structural + semantic validation of the raw document. */
  validateRaw(raw: unknown): ValidationResult;
  /**
   * Converts a raw snapshot that passed `validateRaw` into the common domain.
   * `rawSha256` is the hash of the exact bytes the snapshot was read from.
   */
  normalize(raw: unknown, rawSha256: string): NormalizedSnapshot;
  /** Whether a page key is acceptable for this store (used for path safety). */
  isValidPageKey(pageKey: string): boolean;
  /** Canonical product page URL for a page key, if derivable. */
  productUrlForPageKey(pageKey: string): string | null;
}
