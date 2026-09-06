/**
 * Machine-readable record of one pipeline run. Written as JSON next to the
 * artifacts and rendered to Markdown for the Actions step summary. Stage
 * names are the pipeline's state machine; a run stops at the first failed
 * stage and later stages are reported as skipped.
 */
export const PIPELINE_STAGES = [
  'previous_state',
  'collect',
  'validate',
  'import',
  'compact',
  'generate',
  'finalize',
  'verify',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type StageStatus = 'ok' | 'failed' | 'skipped';

export interface StageRecord {
  name: PipelineStage;
  status: StageStatus;
  startedAt: string | null;
  durationMs: number | null;
  /** Small, JSON-safe facts for humans (counts, hashes, paths). */
  details: Record<string, unknown>;
  error: string | null;
}

/**
 * - published:   a new run was imported and a verified site was produced
 * - unchanged:   the snapshot was already imported; site regenerated, same datasetVersion
 * - quarantined: the snapshot failed validation or sanity; recorded in rejected_runs,
 *                site regenerated without it (so the rejection is visible in the state)
 * - failed:      a stage failed; nothing may be deployed
 */
export type PipelineOutcome = 'published' | 'unchanged' | 'quarantined' | 'failed';

export interface PipelineReport {
  reportVersion: 1;
  storeId: string;
  mode: 'bootstrap' | 'incremental' | null;
  startedAt: string;
  finishedAt: string | null;
  outcome: PipelineOutcome | null;
  /** True only when the site directory passed verification and may be deployed. */
  publishable: boolean;
  datasetVersion: string | null;
  snapshotPath: string | null;
  stages: StageRecord[];
  warnings: string[];
}

export const EXIT_CODES: Record<PipelineOutcome, number> = { published: 0, unchanged: 0, quarantined: 3, failed: 1 };

export function newReport(storeId: string, now: () => Date): PipelineReport {
  return {
    reportVersion: 1,
    storeId,
    mode: null,
    startedAt: now().toISOString(),
    finishedAt: null,
    outcome: null,
    publishable: false,
    datasetVersion: null,
    snapshotPath: null,
    stages: PIPELINE_STAGES.map((name) => ({ name, status: 'skipped', startedAt: null, durationMs: null, details: {}, error: null })),
    warnings: [],
  };
}

export class StageFailedError extends Error {
  constructor(
    readonly stage: PipelineStage,
    cause: unknown,
  ) {
    super(`${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'StageFailedError';
    this.cause = cause;
  }
}

/** Runs one stage, recording timing and outcome; rethrows as StageFailedError. */
export async function runStage<T>(
  report: PipelineReport,
  name: PipelineStage,
  now: () => Date,
  fn: (details: Record<string, unknown>) => Promise<T> | T,
): Promise<T> {
  const record = report.stages.find((s) => s.name === name);
  if (record === undefined) throw new Error(`unknown stage ${name}`);
  const start = now();
  record.startedAt = start.toISOString();
  try {
    const result = await fn(record.details);
    record.status = 'ok';
    return result;
  } catch (e) {
    record.status = 'failed';
    record.error = e instanceof Error ? e.message : String(e);
    throw new StageFailedError(name, e);
  } finally {
    record.durationMs = now().getTime() - start.getTime();
  }
}

export function stage(report: PipelineReport, name: PipelineStage): StageRecord {
  const record = report.stages.find((s) => s.name === name);
  if (record === undefined) throw new Error(`unknown stage ${name}`);
  return record;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return '';
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.replace(/\|/g, '\\|');
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v).replace(/\|/g, '\\|');
}

/** GitHub-flavoured Markdown for `$GITHUB_STEP_SUMMARY`. */
export function reportToMarkdown(r: PipelineReport): string {
  const icon: Record<StageStatus, string> = { ok: '✅', failed: '❌', skipped: '⏭️' };
  const lines: string[] = [];
  lines.push(`## Pipeline: ${r.storeId} — ${r.outcome ?? 'incomplete'}${r.mode ? ` (${r.mode})` : ''}`);
  lines.push('');
  lines.push(`- started: ${r.startedAt}`);
  if (r.finishedAt) lines.push(`- finished: ${r.finishedAt}`);
  lines.push(`- publishable: ${r.publishable ? 'yes' : 'no'}`);
  if (r.datasetVersion) lines.push(`- datasetVersion: \`${r.datasetVersion}\``);
  if (r.snapshotPath) lines.push(`- snapshot: \`${r.snapshotPath}\``);
  lines.push('');
  lines.push('| stage | status | duration | details |');
  lines.push('|---|---|---|---|');
  for (const s of r.stages) {
    const details = Object.entries(s.details)
      .map(([k, v]) => `${k}=${cell(v)}`)
      .join(', ');
    lines.push(`| ${s.name} | ${icon[s.status]} ${s.status}${s.error ? ` — ${cell(s.error)}` : ''} | ${fmtMs(s.durationMs)} | ${details} |`);
  }
  if (r.warnings.length > 0) {
    lines.push('');
    lines.push(`<details><summary>${r.warnings.length} warning(s)</summary>`);
    lines.push('');
    for (const w of r.warnings.slice(0, 50)) lines.push(`- ${w.replace(/</g, '&lt;')}`);
    if (r.warnings.length > 50) lines.push(`- … ${r.warnings.length - 50} more`);
    lines.push('');
    lines.push('</details>');
  }
  lines.push('');
  return lines.join('\n');
}
