import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * How much of the crawl job's time limit one run used. A job that outgrows its
 * `timeout-minutes` is cancelled mid-store, so the run must say it is getting
 * close while it still succeeds, not only after the first cancellation.
 *
 * Dependency-free on purpose: it runs as a plain `node` step, also when the
 * install step is what broke.
 */
export const RUN_BUDGET_WARN_RATIO = 0.8;

export interface RunBudget {
  elapsedMinutes: number;
  limitMinutes: number;
  warnAboveMinutes: number;
  percent: number;
  overThreshold: boolean;
  summary: string;
  warning: string | null;
}

export function runBudget(input: { elapsedSeconds: number; limitMinutes: number; warnRatio?: number }): RunBudget {
  const { elapsedSeconds, limitMinutes } = input;
  const ratio = input.warnRatio ?? RUN_BUDGET_WARN_RATIO;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new Error(`invalid elapsedSeconds: ${elapsedSeconds}`);
  if (!Number.isFinite(limitMinutes) || limitMinutes <= 0) throw new Error(`invalid limitMinutes: ${limitMinutes}`);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new Error(`invalid warnRatio: ${ratio}`);

  const elapsedMinutes = Math.ceil(elapsedSeconds / 60);
  const percent = Math.round((elapsedSeconds / (limitMinutes * 60)) * 100);
  const warnAboveMinutes = limitMinutes * ratio;
  // Strict: a run that lands exactly on the mark has not crossed it.
  const overThreshold = elapsedSeconds > limitMinutes * 60 * ratio;
  const summary =
    `### Run length\n\n${elapsedMinutes} min of the job's ${limitMinutes}-minute limit (${percent} %). ` +
    `A warning is raised above ${warnAboveMinutes} min.\n`;
  const warning = overThreshold
    ? `::warning title=Run length near the limit::${elapsedMinutes} min of the ${limitMinutes}-minute job limit (${percent} %), ` +
      `above the ${warnAboveMinutes}-minute mark. See docs/runbook.md before the job starts being cancelled.`
    : null;
  return { elapsedMinutes, limitMinutes, warnAboveMinutes, percent, overThreshold, summary, warning };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  try {
    const startedAt = Number(env.JOB_STARTED_AT);
    if (!env.JOB_STARTED_AT || !Number.isFinite(startedAt)) throw new Error('JOB_STARTED_AT (epoch seconds) is required');
    const limitMinutes = Number(env.JOB_LIMIT_MINUTES);
    if (!env.JOB_LIMIT_MINUTES || !Number.isFinite(limitMinutes)) throw new Error('JOB_LIMIT_MINUTES is required');
    const budget = runBudget({ elapsedSeconds: Date.now() / 1000 - startedAt, limitMinutes });
    if (budget.warning !== null) process.stdout.write(`${budget.warning}\n`);
    process.stdout.write(`run length: ${budget.elapsedMinutes} min of ${budget.limitMinutes} (${budget.percent} %)\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${budget.summary}\n`);
  } catch (e) {
    // Loud on purpose: a wrong clock or limit is a bookkeeping bug. The deploy
    // job does not depend on this step.
    process.stderr.write(`::error::${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
