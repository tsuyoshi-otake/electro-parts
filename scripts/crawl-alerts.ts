import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { PipelineReport } from '../src/pipeline/report.ts';

/**
 * Raises one GitHub Issue per store the scheduled crawl did not observe, and
 * closes it when a later run observes the store again. A red job nobody opens
 * is the failure mode this exists for: the notice has to arrive where the
 * owner already looks.
 *
 * Dependency-free on purpose (only `node:` modules and a type import, so
 * `node scripts/crawl-alerts.ts` needs no `npm ci`): it runs in the one job
 * that holds an `issues: write` token, and the crawl job that parses store
 * pages and runs npm dependencies must not hold a token that can write.
 *
 * Report contents are external text (store pages end up in error messages),
 * so everything that reaches an Issue goes through `sanitizeLine`.
 */
export const ALERT_LABEL = 'crawl-alert';
export const MAX_REASONS = 10;
export const MAX_REASON_LENGTH = 300;

const STORE_ID = /^[a-z0-9][a-z0-9-]*$/;
const OUTCOMES = ['published', 'unchanged', 'quarantined', 'failed'];
const QUARANTINE_PREFIX = 'quarantined: ';
const COLLECT_ERROR_PREFIX = 'collect error: ';
const NO_FAILURE_REPORT = 'the pipeline exited without writing a failure report; see the job log';

const storeMarker = (storeId: string): string => `<!-- crawl-alert store=${storeId} -->`;
const runMarker = (runId: string): string => `<!-- crawl-alert run=${runId} -->`;
const alertTitle = (storeId: string): string => `Crawl alert: ${storeId} was not observed`;

/**
 * One line of external text made safe to embed: no control characters, no
 * backtick that could close the code fence, and no `<!--` that could forge a
 * marker the reconciliation trusts.
 */
export function sanitizeLine(text: string): string {
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/`/g, "'")
    .replace(/<!--/g, '<! --')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > MAX_REASON_LENGTH ? `${cleaned.slice(0, MAX_REASON_LENGTH - 1)}…` : cleaned;
}

export type StoreVerdict =
  | { storeId: string; kind: 'alert'; outcome: 'quarantined' | 'failed'; stage: string | null; reasons: string[] }
  | { storeId: string; kind: 'observed' }
  | { storeId: string; kind: 'not_attempted' };

export interface ReportFile {
  file: string;
  report: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateReport(file: string, value: unknown): PipelineReport {
  if (!isRecord(value)) throw new Error(`${file}: the report is not an object`);
  if (typeof value.storeId !== 'string' || !STORE_ID.test(value.storeId)) throw new Error(`${file}: invalid storeId`);
  if (typeof value.outcome !== 'string' || !OUTCOMES.includes(value.outcome)) throw new Error(`${file}: invalid outcome`);
  if (!Array.isArray(value.stages)) throw new Error(`${file}: stages is not an array`);
  if (!Array.isArray(value.warnings)) throw new Error(`${file}: warnings is not an array`);
  return value as unknown as PipelineReport;
}

/** More than MAX_REASONS lines would bury the Issue; the cut says how many went. */
function capReasons(reasons: string[]): string[] {
  if (reasons.length <= MAX_REASONS) return reasons;
  const kept = reasons.slice(0, MAX_REASONS - 1);
  kept.push(`… ${reasons.length - kept.length} more`);
  return kept;
}

function verdictOf(report: PipelineReport): StoreVerdict {
  const storeId = report.storeId;
  if (report.outcome === 'failed') {
    const failed = report.stages.find((s) => isRecord(s) && s.status === 'failed');
    if (failed === undefined) {
      return { storeId, kind: 'alert', outcome: 'failed', stage: null, reasons: ['no stage recorded an error'] };
    }
    const error = typeof failed.error === 'string' && failed.error !== '' ? failed.error : 'no error recorded';
    // The stage name sits between backticks in the Issue, so it is sanitized like any other report text.
    const stage = sanitizeLine(String(failed.name));
    return { storeId, kind: 'alert', outcome: 'failed', stage, reasons: [sanitizeLine(`${stage}: ${error}`)] };
  }
  if (report.outcome === 'quarantined') {
    const warnings = report.warnings.filter((w): w is string => typeof w === 'string');
    // The rejection first, then what the collector reported: an incomplete
    // crawl is rejected with one generic line, and the collector's error is
    // the line that says which page broke (2026-11-09: "the listed total
    // changed from 1951 to 1950").
    const reasons = [
      ...warnings.filter((w) => w.startsWith(QUARANTINE_PREFIX)).map((w) => w.slice(QUARANTINE_PREFIX.length)),
      ...warnings.filter((w) => w.startsWith(COLLECT_ERROR_PREFIX)),
    ].map(sanitizeLine);
    return {
      storeId,
      kind: 'alert',
      outcome: 'quarantined',
      stage: null,
      reasons: reasons.length === 0 ? ['no reason recorded'] : capReasons(reasons),
    };
  }
  // published / unchanged: only a collect that really ran counts as an observation.
  const collect = report.stages.find((s) => isRecord(s) && s.name === 'collect');
  return collect !== undefined && collect.status === 'ok' ? { storeId, kind: 'observed' } : { storeId, kind: 'not_attempted' };
}

export function classifyReports(input: { reports: readonly ReportFile[]; failedStores: readonly string[] }): StoreVerdict[] {
  const byStore = new Map<string, { report: PipelineReport; failedRun: boolean }>();
  for (const { file, report } of input.reports) {
    const valid = validateReport(file, report);
    const failedRun = file.endsWith('.failed-run.json');
    const existing = byStore.get(valid.storeId);
    // The failed-run copy is the report from before the repair step overwrote it.
    if (existing === undefined || (failedRun && !existing.failedRun)) byStore.set(valid.storeId, { report: valid, failedRun });
  }
  const verdicts = new Map<string, StoreVerdict>();
  for (const [storeId, { report }] of byStore) verdicts.set(storeId, verdictOf(report));
  for (const storeId of input.failedStores) {
    if (!STORE_ID.test(storeId)) throw new Error(`invalid store id in FAILED_STORES: ${JSON.stringify(storeId)}`);
    if (verdicts.get(storeId)?.kind === 'alert') continue;
    verdicts.set(storeId, { storeId, kind: 'alert', outcome: 'failed', stage: null, reasons: [NO_FAILURE_REPORT] });
  }
  // Store ids are ASCII ([a-z0-9-]), so the default code-unit sort is the order we want; no comparator.
  return [...verdicts.keys()].sort().map((storeId) => verdicts.get(storeId) as StoreVerdict);
}

export interface OpenAlert {
  number: number;
  body: string;
  comments: string[];
}

export interface RunContext {
  runId: string;
  runAttempt: string;
  runUrl: string;
  runbookUrl: string;
  assignee: string | null;
}

export type AlertAction =
  | { type: 'create'; storeId: string; title: string; body: string; assignee: string | null }
  | { type: 'comment'; storeId: string; issue: number; body: string }
  | { type: 'close'; storeId: string; issue: number; comment: string }
  | { type: 'skip'; storeId: string; issue: number; reason: 'already_reported' };

type AlertVerdict = Extract<StoreVerdict, { kind: 'alert' }>;

function describeFailure(verdict: AlertVerdict): string {
  return `\`${verdict.outcome}\`${verdict.stage === null ? '' : ` at stage \`${verdict.stage}\``}`;
}

function alertBody(verdict: AlertVerdict, ctx: RunContext, first: boolean): string {
  const heading = first
    ? [storeMarker(verdict.storeId), `**${verdict.storeId}** was not observed: ${describeFailure(verdict)}.`]
    : [`Still not observed: ${describeFailure(verdict)}.`];
  const section = verdict.outcome === 'quarantined' ? '隔離(quarantined)が出たら' : '失敗(failed)が出たら';
  return [
    ...heading,
    '',
    `- run: ${ctx.runUrl} (attempt ${ctx.runAttempt})`,
    '',
    '```text',
    ...verdict.reasons,
    '```',
    '',
    `What to do: ${ctx.runbookUrl} (${section})`,
    ...(first ? ['This Issue is closed automatically when a later run observes the store again.'] : []),
    runMarker(ctx.runId),
  ].join('\n');
}

export function planActions(verdicts: readonly StoreVerdict[], open: readonly OpenAlert[], ctx: RunContext): AlertAction[] {
  const actions: AlertAction[] = [];
  for (const verdict of verdicts) {
    // The marker must open the body: a marker quoted further down is only text.
    const marker = storeMarker(verdict.storeId);
    const owned = open.filter((issue) => issue.body.split(/\r?\n/, 1)[0] === marker).sort((a, b) => a.number - b.number);
    if (verdict.kind === 'alert') {
      const issue = owned[0];
      if (issue === undefined) {
        actions.push({
          type: 'create',
          storeId: verdict.storeId,
          title: alertTitle(verdict.storeId),
          body: alertBody(verdict, ctx, true),
          assignee: ctx.assignee,
        });
      } else if ([issue.body, ...issue.comments].some((text) => text.includes(runMarker(ctx.runId)))) {
        // A re-run of the same run id must not post the same notice twice.
        actions.push({ type: 'skip', storeId: verdict.storeId, issue: issue.number, reason: 'already_reported' });
      } else {
        actions.push({ type: 'comment', storeId: verdict.storeId, issue: issue.number, body: alertBody(verdict, ctx, false) });
      }
    } else if (verdict.kind === 'observed') {
      for (const issue of owned) {
        actions.push({
          type: 'close',
          storeId: verdict.storeId,
          issue: issue.number,
          comment: `Observed again in ${ctx.runUrl} (attempt ${ctx.runAttempt}). Closing.`,
        });
      }
    }
  }
  return actions;
}

/** Resolves stdout; rejects on a non-zero exit. */
export type GhRunner = (args: readonly string[], stdin?: string) => Promise<string>;

export async function listOpenAlerts(gh: GhRunner): Promise<OpenAlert[]> {
  const out = await gh(['issue', 'list', '--state', 'open', '--label', ALERT_LABEL, '--limit', '100', '--json', 'number,body,comments']);
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error('gh issue list did not return JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('gh issue list did not return an array');
  return parsed.map((item: unknown): OpenAlert => {
    if (!isRecord(item) || typeof item.number !== 'number' || typeof item.body !== 'string' || !Array.isArray(item.comments)) {
      throw new Error('gh issue list returned an unexpected issue shape');
    }
    const comments = item.comments.map((c: unknown) => {
      if (!isRecord(c) || typeof c.body !== 'string') throw new Error('gh issue list returned an unexpected comment shape');
      return c.body;
    });
    return { number: item.number, body: item.body, comments };
  });
}

/**
 * Sequential and stop-on-first-error: the markers make the next run reconcile
 * whatever this one did not finish, so there is no retry here.
 */
export async function applyActions(actions: readonly AlertAction[], gh: GhRunner): Promise<void> {
  let labelEnsured = false;
  for (const action of actions) {
    switch (action.type) {
      case 'create': {
        if (!labelEnsured) {
          await gh(['label', 'create', ALERT_LABEL, '--color', 'D93F0B', '--description', 'A store was not observed by the scheduled crawl', '--force']);
          labelEnsured = true;
        }
        const args = ['issue', 'create', '--title', action.title, '--label', ALERT_LABEL, '--body-file', '-'];
        if (action.assignee !== null) args.push('--assignee', action.assignee);
        await gh(args, action.body);
        break;
      }
      case 'comment':
        await gh(['issue', 'comment', String(action.issue), '--body-file', '-'], action.body);
        break;
      case 'close':
        await gh(['issue', 'close', String(action.issue), '--comment', action.comment]);
        break;
      // 'skip' has no arm: it makes no call, so there is nothing to do.
    }
  }
}

const GH_TIMEOUT_MS = 60_000;

export const spawnGh: GhRunner = (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn('gh', [...args], { shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`gh ${args[0] ?? ''} timed out after ${GH_TIMEOUT_MS / 1000} s`));
    }, GH_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`gh ${args[0] ?? ''} exited with ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`));
    });
    // A gh that exits before reading its input breaks the pipe; the exit code
    // and stderr reported by `close` are the useful error, not EPIPE.
    child.stdin.on('error', () => undefined);
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });

const REPORT_FILE = /^pipeline-[a-z0-9][a-z0-9-]*(\.failed-run)?\.json$/;

function readReportFiles(dir: string): ReportFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => REPORT_FILE.test(path.basename(entry)) && statSync(path.join(dir, entry)).isFile())
    .sort()
    .map((entry) => {
      const file = path.join(dir, entry);
      try {
        return { file, report: JSON.parse(readFileSync(file, 'utf8')) as unknown };
      } catch (e) {
        throw new Error(`${file}: ${(e as Error).message}`);
      }
    });
}

function runContext(env: NodeJS.ProcessEnv, dryRun: boolean): RunContext {
  const placeholders: Record<string, string> = {
    GITHUB_RUN_ID: 'local',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_SHA: 'HEAD',
  };
  const value = (name: string): string => {
    const v = env[name];
    if (v) return v;
    if (dryRun) return placeholders[name] as string;
    throw new Error(`${name} is required`);
  };
  const base = `${value('GITHUB_SERVER_URL')}/${value('GITHUB_REPOSITORY')}`;
  return {
    runId: value('GITHUB_RUN_ID'),
    runAttempt: value('GITHUB_RUN_ATTEMPT'),
    runUrl: `${base}/actions/runs/${value('GITHUB_RUN_ID')}`,
    runbookUrl: `${base}/blob/${value('GITHUB_SHA')}/docs/runbook.md`,
    assignee: env.ALERT_ASSIGNEE ? env.ALERT_ASSIGNEE : null,
  };
}

function describeAction(action: AlertAction): string {
  return action.type === 'create' ? `create ${action.storeId}` : `${action.type} ${action.storeId} #${action.issue}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { reports: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } } });
  if (values.reports === undefined) throw new Error('--reports <dir> is required');
  const dryRun = values['dry-run'] === true;
  const reports = readReportFiles(values.reports);
  const failedStores = (process.env.FAILED_STORES ?? '').split(/\s+/).filter(Boolean);
  if (reports.length === 0 && failedStores.length === 0) {
    process.stdout.write('no reports and no failed stores; nothing to do\n');
    return;
  }
  const ctx = runContext(process.env, dryRun);
  const verdicts = classifyReports({ reports, failedStores });
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ verdicts, actions: planActions(verdicts, [], ctx) }, null, 2)}\n`);
    return;
  }
  const open = await listOpenAlerts(spawnGh);
  const actions = planActions(verdicts, open, ctx);
  // Printed before applying: when a call fails, the log still shows what was planned.
  for (const action of actions) process.stdout.write(`planned: ${describeAction(action)}\n`);
  await applyActions(actions, spawnGh);
  process.stdout.write(`applied ${actions.length} action(s)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
