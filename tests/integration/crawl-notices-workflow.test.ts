import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newReport, stage } from '../../src/pipeline/report.ts';

/**
 * The crawl notices are two scripts and the workflow wiring around them. The
 * wiring is where they can silently stop working: a limit that drifted from the
 * job's timeout, a write token that moved into the job that runs npm
 * dependencies, a script that quietly grew an import and now needs `npm ci`.
 * This pins those, and runs both scripts the way the workflow does: plain
 * `node`, no tsx.
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'crawl-publish.yml'), 'utf8');
const alertsScript = path.join(repoRoot, 'scripts', 'crawl-alerts.ts');
const budgetScript = path.join(repoRoot, 'scripts', 'run-budget.ts');

/** The text of one top-level job, up to the next job (there is no YAML parser in the repo). */
function jobBlock(name: string): string {
  const start = new RegExp(`^  ${name}:\\n`, 'm').exec(workflow);
  if (start === null) throw new Error(`no job ${name}`);
  const rest = workflow.slice(start.index + start[0].length);
  const next = /^  [a-z][a-z0-9_-]*:\n/m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

/** The `key: value` lines of a job's own `permissions:` block. */
function permissionsOf(block: string): string[] {
  const m = /^    permissions:\n((?:      .*\n)+)/m.exec(block);
  if (m === null) throw new Error('no permissions block');
  return (m[1] as string)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'crawl-notices-'));
  tmpDirs.push(dir);
  return dir;
}

function run(script: string, args: string[], env: Record<string, string | undefined>) {
  const base = { ...process.env };
  delete base.GH_TOKEN;
  delete base.GITHUB_TOKEN;
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('crawl notices: workflow wiring', () => {
  it('keeps the run-length limit equal to the crawl job timeout', () => {
    const timeout = /^    timeout-minutes: (\d+)$/m.exec(jobBlock('crawl'))?.[1];
    const limit = /JOB_LIMIT_MINUTES: (\d+)/.exec(jobBlock('crawl'))?.[1];
    expect(timeout).toBeDefined();
    expect(limit).toBe(timeout);
  });
  it('gives the alerts job exactly contents:read and issues:write, and no dependency install', () => {
    const block = jobBlock('alerts');
    expect(permissionsOf(block).sort()).toEqual(['contents: read', 'issues: write']);
    expect(block).not.toContain('npm ci');
    expect(block).not.toMatch(/\btsx\b/);
    expect(block).toContain('node scripts/crawl-alerts.ts');
  });
  it('keeps issue write access out of the crawl job', () => {
    expect(permissionsOf(jobBlock('crawl')).join('\n')).not.toMatch(/issues:/);
    expect(workflow).toMatch(/^permissions: \{\}$/m);
  });
  it('treats every exit code except 0 and 3 as a failed store', () => {
    expect(workflow).toContain('if [ "$code" != "0" ] && [ "$code" != "3" ]; then');
    expect(workflow).not.toContain('if [ "$code" = "1" ]; then');
  });
  it('notes the start time in the first step of the crawl job', () => {
    const steps = jobBlock('crawl').split(/^ {6}- name: /m);
    expect(steps[1]).toContain('Note when the job started');
    expect(steps[1]).toContain('JOB_STARTED_AT=$(date +%s)');
  });
});

describe('crawl notices: scripts have no dependencies', () => {
  for (const script of [alertsScript, budgetScript]) {
    it(`${path.basename(script)} imports only node: modules or types`, () => {
      const source = readFileSync(script, 'utf8');
      const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gms)];
      expect(imports.length).toBeGreaterThan(0);
      for (const [, isType, from] of imports) {
        expect(isType !== undefined || (from as string).startsWith('node:'), `${from} must be a node: module or a type import`).toBe(true);
      }
      expect(source).not.toMatch(/\brequire\(|\bimport\(/);
    });
  }
});

describe('crawl notices: crawl-alerts.ts as the alerts job runs it', () => {
  it('plans a create for the quarantined store only, with plain node', () => {
    const dir = tmp();
    const reports = path.join(dir, 'reports');
    mkdirSync(reports);
    const quarantined = newReport('alpha', () => new Date(0));
    quarantined.outcome = 'quarantined';
    quarantined.warnings.push('quarantined: too few items');
    const observed = newReport('beta', () => new Date(0));
    observed.outcome = 'published';
    stage(observed, 'collect').status = 'ok';
    const republish = newReport('gamma', () => new Date(0));
    republish.outcome = 'unchanged';
    writeFileSync(path.join(reports, 'pipeline-alpha.json'), JSON.stringify(quarantined));
    writeFileSync(path.join(reports, 'pipeline-beta.json'), JSON.stringify(observed));
    writeFileSync(path.join(reports, 'pipeline-gamma.json'), JSON.stringify(republish));
    writeFileSync(path.join(reports, 'pipeline-alpha.md'), 'not a report');

    const result = run(alertsScript, ['--reports', dir, '--dry-run'], { FAILED_STORES: '', GH_TOKEN: undefined });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout) as { verdicts: { storeId: string; kind: string }[]; actions: { type: string; storeId: string }[] };
    expect(out.verdicts.map((v) => [v.storeId, v.kind])).toEqual([
      ['alpha', 'alert'],
      ['beta', 'observed'],
      ['gamma', 'not_attempted'],
    ]);
    expect(out.actions.map((a) => [a.type, a.storeId])).toEqual([['create', 'alpha']]);
  });
  it('does nothing without reports or failed stores, and needs no GITHUB_* variables for that', () => {
    const result = run(alertsScript, ['--reports', path.join(tmp(), 'missing')], { FAILED_STORES: '' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('no reports and no failed stores; nothing to do');
  });
  it('exits 1 on a malformed report instead of skipping it', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'pipeline-alpha.json'), '{"storeId":"alpha"}');
    const result = run(alertsScript, ['--reports', dir, '--dry-run'], { FAILED_STORES: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pipeline-alpha.json');
  });
  it('requires the GITHUB_* variables outside a dry run', () => {
    const dir = tmp();
    const r = newReport('alpha', () => new Date(0));
    r.outcome = 'failed';
    writeFileSync(path.join(dir, 'pipeline-alpha.json'), JSON.stringify(r));
    const result = run(alertsScript, ['--reports', dir], {
      FAILED_STORES: '',
      GITHUB_RUN_ID: undefined,
      GITHUB_RUN_ATTEMPT: undefined,
      GITHUB_SERVER_URL: undefined,
      GITHUB_REPOSITORY: undefined,
      GITHUB_SHA: undefined,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/GITHUB_\w+ is required/);
  });
});

describe('crawl notices: run-budget.ts as the crawl job runs it', () => {
  const startedMinutesAgo = (minutes: number) => String(Math.floor(Date.now() / 1000) - minutes * 60);

  it('warns and writes the summary when the job is past 80 % of its limit', () => {
    const summary = path.join(tmp(), 'summary.md');
    const result = run(budgetScript, [], {
      JOB_STARTED_AT: startedMinutesAgo(193),
      JOB_LIMIT_MINUTES: '240',
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('::warning title=Run length near the limit::');
    expect(result.stdout).toMatch(/run length: \d+ min of 240/);
    expect(readFileSync(summary, 'utf8')).toContain('### Run length');
  });
  it('stays quiet when the job is well within its limit', () => {
    const summary = path.join(tmp(), 'summary.md');
    const result = run(budgetScript, [], {
      JOB_STARTED_AT: startedMinutesAgo(10),
      JOB_LIMIT_MINUTES: '240',
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain('::warning');
    // The elapsed time is rounded up, so the clock ticking over reads as 11.
    expect(result.stdout).toMatch(/run length: 1[01] min of 240/);
    expect(readFileSync(summary, 'utf8')).toMatch(/1[01] min of the job/);
  });
  it('exits 1 on missing or invalid input', () => {
    expect(run(budgetScript, [], { JOB_STARTED_AT: undefined, JOB_LIMIT_MINUTES: '240' }).status).toBe(1);
    expect(run(budgetScript, [], { JOB_STARTED_AT: 'abc', JOB_LIMIT_MINUTES: '240' }).status).toBe(1);
    expect(run(budgetScript, [], { JOB_STARTED_AT: startedMinutesAgo(1), JOB_LIMIT_MINUTES: undefined }).status).toBe(1);
    expect(run(budgetScript, [], { JOB_STARTED_AT: startedMinutesAgo(1), JOB_LIMIT_MINUTES: '0' }).status).toBe(1);
  });
});
