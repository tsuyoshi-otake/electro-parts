import type { HttpTransport } from '../collectors/politeFetcher.ts';

/**
 * Boundary between the store-neutral pipeline and a store's crawler. A
 * collector turns its own config section into a raw snapshot document in the
 * store's raw schema; the matching StoreSnapshotAdapter validates that
 * document afterwards. The pipeline never looks inside `raw`.
 */
export interface CollectDeps {
  log: (message: string) => void;
  now?: () => Date;
  /** Injectable HTTP transport (tests run against a fake site). */
  transport?: HttpTransport;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /**
   * A directory that survives from one run to the next (the workflow caches
   * it), for data a collector derives and can rebuild: losing it must only cost
   * the collector time, never correctness. Absent when nothing is kept (the
   * standalone `collect` command, tests).
   */
  carryDir?: string;
}

export interface CollectOutcome {
  raw: unknown;
  /** UTC ISO timestamp the snapshot claims as its observation time. */
  retrievedAt: string;
  complete: boolean;
  errors: string[];
  warnings: string[];
  /** Store-neutral counters for the run summary. */
  metrics: Record<string, number>;
}

export interface StoreCollector {
  readonly storeId: string;
  /** Throws when the config section is invalid; must not perform network access. */
  validateConfig(config: Record<string, unknown>): void;
  collect(config: Record<string, unknown>, deps: CollectDeps): Promise<CollectOutcome>;
}
