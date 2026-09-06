/**
 * Validation outcome shared by store adapters and the pipeline. A snapshot is
 * importable only when `errors` is empty; warnings are recorded in
 * `crawl_runs.validation_result` and surfaced in the workflow summary.
 */
export interface ValidationIssue {
  code: string;
  message: string;
  /** Optional identifier (product id, genre, ...) for triage. */
  subject?: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Free-form counters (item count, missing model numbers, ...). */
  metrics: Record<string, number>;
}

export function emptyValidation(): ValidationResult {
  return { errors: [], warnings: [], metrics: {} };
}

export function isImportable(result: ValidationResult): boolean {
  return result.errors.length === 0;
}

export function mergeValidation(a: ValidationResult, b: ValidationResult): ValidationResult {
  return {
    errors: [...a.errors, ...b.errors],
    warnings: [...a.warnings, ...b.warnings],
    metrics: { ...a.metrics, ...b.metrics },
  };
}

export class SnapshotRejectedError extends Error {
  readonly result: ValidationResult;
  constructor(message: string, result: ValidationResult) {
    super(message);
    this.name = 'SnapshotRejectedError';
    this.result = result;
  }
}
