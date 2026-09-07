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

/**
 * How many issues of one code are listed before the rest are summarised. A
 * catalogue-wide fault would otherwise produce one issue per product and bury
 * the run report under ten thousand identical lines.
 */
export const MAX_ISSUES_PER_CODE = 20;

/**
 * Accumulates validation issues while keeping a full count per code, so a
 * truncated list never hides the true scale of a problem:
 * `metrics['issue.<code>']` always holds every occurrence, listed or not.
 *
 * Store-neutral on purpose — every adapter validates the same way, and an
 * adapter that invents its own reporting is one whose failures read differently
 * in the run summary.
 */
export class IssueCollector {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];
  readonly metrics: Record<string, number> = {};
  private readonly counts = new Map<string, number>();

  error(code: string, message: string, subject?: string): void {
    this.push(this.errors, code, message, subject);
  }

  warn(code: string, message: string, subject?: string): void {
    this.push(this.warnings, code, message, subject);
  }

  private push(list: ValidationIssue[], code: string, message: string, subject?: string): void {
    const n = (this.counts.get(code) ?? 0) + 1;
    this.counts.set(code, n);
    this.metrics[`issue.${code}`] = n;
    if (n <= MAX_ISSUES_PER_CODE) list.push(subject === undefined ? { code, message } : { code, message, subject });
    else if (n === MAX_ISSUES_PER_CODE + 1) list.push({ code, message: `further ${code} issues suppressed` });
  }

  result(): ValidationResult {
    return { errors: this.errors, warnings: this.warnings, metrics: this.metrics };
  }
}
