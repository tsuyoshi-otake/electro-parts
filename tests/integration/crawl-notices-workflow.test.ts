import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const stores = (/^\s*STORES: (.+)$/m.exec(workflow)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
const jobNames = ['plan', 'collect', 'publish', 'deploy', 'alerts'];

/** The `run:` blocks of a job: the shell text, which must not interpolate workflow values. */
function runBlocks(block: string): string[] {
  const multiLine = [...block.matchAll(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/gm)].map((m) => m[1] as string);
  const oneLine = [...block.matchAll(/^ {8}run: (?!\|)(.+)$/gm)].map((m) => m[1] as string);
  return [...multiLine, ...oneLine];
}

describe('crawl notices: workflow wiring', () => {
  it('has exactly the jobs plan, collect, publish, deploy and alerts', () => {
    const jobsSection = workflow.slice(workflow.indexOf('\njobs:\n'));
    const names = [...jobsSection.matchAll(/^ {2}([a-z][a-z0-9_-]*):\n/gm)].map((m) => m[1]);
    expect(names).toEqual(jobNames);
  });
  it.each([
    ['collect', '150'],
    ['publish', '60'],
  ])('keeps the run-length limit of %s equal to its own timeout (%s)', (job, minutes) => {
    const block = jobBlock(job);
    expect(/^ {4}timeout-minutes: (\d+)$/m.exec(block)?.[1]).toBe(minutes);
    expect(/JOB_LIMIT_MINUTES: (\d+)/.exec(block)?.[1]).toBe(minutes);
    expect(block).toContain('node scripts/run-budget.ts');
  });
  it('lets every job that measures its run length note its start time in its first step', () => {
    const measuring = jobNames.filter((name) => jobBlock(name).includes('scripts/run-budget.ts'));
    expect(measuring).toEqual(['collect', 'publish']);
    for (const job of measuring) {
      const steps = jobBlock(job).split(/^ {6}- name: /m);
      expect(steps[1], job).toContain('Note when the job started');
      expect(steps[1], job).toContain('JOB_STARTED_AT=$(date +%s)');
    }
  });
  it('runs the run-length step even after a failure, and skips it when the checkout did not happen', () => {
    for (const job of ['collect', 'publish']) {
      expect(jobBlock(job)).toMatch(/- name: Run length against the limit\n {8}if: always\(\) && hashFiles\('scripts\/run-budget\.ts'\) != ''\n/);
    }
  });
  it('creates the snapshot and record directories before the loop that searches them', () => {
    const step = pipelineStepRunText();
    const mkdir = step.indexOf('mkdir -p snapshots collected');
    expect(mkdir).toBeGreaterThan(-1);
    expect(mkdir).toBeLessThan(step.indexOf('for store in $STORES; do'));
  });
  it('gives the alerts job exactly contents:read and issues:write, and no dependency install', () => {
    const block = jobBlock('alerts');
    expect(permissionsOf(block).sort()).toEqual(['contents: read', 'issues: write']);
    expect(block).not.toContain('npm ci');
    expect(block).not.toMatch(/\btsx\b/);
    expect(block).toContain('node scripts/crawl-alerts.ts');
  });
  it('lets no job but alerts write issues, and the jobs that run dependencies write nothing', () => {
    for (const job of jobNames.filter((name) => name !== 'alerts')) expect(permissionsOf(jobBlock(job)).join('\n'), job).not.toMatch(/issues:/);
    for (const job of ['plan', 'collect']) expect(permissionsOf(jobBlock(job)), job).toEqual(['contents: read']);
    expect(permissionsOf(jobBlock('publish')).sort()).toEqual(['actions: read', 'contents: read']);
    for (const job of ['plan', 'collect', 'publish']) expect(permissionsOf(jobBlock(job)).join('\n'), job).not.toMatch(/: write/);
    expect(permissionsOf(jobBlock('deploy')).sort()).toEqual(['id-token: write', 'pages: write']);
    expect(workflow).toMatch(/^permissions: \{\}$/m);
  });
  it('collects each observed store in its own job from the plan, never cancelling the others', () => {
    const block = jobBlock('collect');
    expect(block).toMatch(/^ {4}needs: plan$/m);
    expect(block).toMatch(/^ {4}if: needs\.plan\.outputs\.matrix != '\[\]'$/m);
    expect(block).toMatch(/^ {6}fail-fast: false$/m);
    expect(block).toContain('store: ${{ fromJSON(needs.plan.outputs.matrix) }}');
    expect(block).toContain('name: Collect ${{ matrix.store }}');
  });
  it('uploads the snapshot and the collect record under the names the re-import and the import look for', () => {
    const block = jobBlock('collect');
    expect(block).toContain('name: snapshot-${{ matrix.store }}-${{ github.run_id }}');
    expect(block).toContain('path: snapshots/${{ matrix.store }}-*');
    expect(block).toContain('name: collect-${{ matrix.store }}-${{ github.run_id }}');
    expect(block).toContain('path: reports/collect-${{ matrix.store }}.json');
    expect(jobBlock('publish')).toContain('--name "snapshot-$OBSERVE-$RUN_ID"');
    expect(jobBlock('publish')).toContain('pattern: snapshot-*-${{ github.run_id }}');
    expect(jobBlock('publish')).toContain('pattern: collect-*-${{ github.run_id }}');
  });
  it('restores and saves the carry cache for whichever store is collected, with no store named', () => {
    const block = jobBlock('collect');
    expect(block).toContain('key: ${{ matrix.store }}-cover-${{ github.run_id }}\n');
    expect(block).toContain('restore-keys: ${{ matrix.store }}-cover-\n');
    expect(block).toContain('key: ${{ matrix.store }}-cover-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(block).toContain("if: always() && hashFiles('state/work/carry/*') != ''");
    expect(jobBlock('publish')).not.toContain('actions/cache');
  });
  it('names no store anywhere in the workflow but on the STORES line', () => {
    expect(stores.length).toBeGreaterThan(0);
    const rest = workflow.replace(/^\s*STORES: .*$/m, '').toLowerCase();
    for (const store of stores) expect(rest, store).not.toContain(store);
  });
  it('plans the matrix with jq from the observed stores, empty for a re-import', () => {
    const block = jobBlock('plan');
    expect(block).toContain('scripts/observed-stores.ts');
    expect(block).toContain(`jq -cn --arg stores "$observe" '$stores | split(" ") | map(select(. != ""))'`);
    expect(block).toMatch(/if \[ -n "\$\{REIMPORT:-\}" \]; then\n\s+matrix='\[\]'/);
    expect(block).toContain('observe: ${{ steps.observed.outputs.observe }}');
    expect(block).toContain('matrix: ${{ steps.observed.outputs.matrix }}');
    expect(block).toContain('exactly one store');
  });
  it('lets publish run after a failed collect without selecting the stores itself', () => {
    const block = jobBlock('publish');
    expect(block).toMatch(/^ {4}needs: \[plan, collect\]$/m);
    expect(block).toMatch(/^ {4}if: always\(\) && needs\.plan\.result == 'success'$/m);
    expect(block).not.toContain('observed-stores.ts');
    expect(block).toContain('OBSERVE: ${{ needs.plan.outputs.observe }}');
    expect(jobBlock('deploy')).toMatch(/^ {4}needs: publish$/m);
    expect(jobBlock('alerts')).toMatch(/^ {4}needs: publish$/m);
    expect(jobBlock('alerts')).toContain('FAILED_STORES: ${{ needs.publish.outputs.failed_stores }}');
    expect(jobBlock('deploy')).toContain('needs.publish.outputs.publishable');
    expect(workflow).not.toContain('needs.crawl');
  });
  it('fails a store with no snapshot without running its pipeline, and passes the record only when there is one', () => {
    const block = jobBlock('publish');
    expect(block).toContain('The collect job produced no snapshot; see its log.');
    expect(block).toMatch(/if \[ -z "\$file" \]; then[\s\S]*?failed="\$failed \$store"[\s\S]*?\n\s+continue\n\s+fi/);
    expect(block).toContain('flags="$flags --snapshot $file"');
    expect(block).toContain('if [ -n "$record" ]; then flags="$flags --collect-record $record"; fi');
    expect(block).toContain('*) flags="--republish" ;;');
  });
  it('reads no workflow value inside a run block of collect or publish: values arrive through env', () => {
    for (const job of ['collect', 'publish']) {
      for (const text of runBlocks(jobBlock(job))) expect(text, job).not.toMatch(/\$\{\{\s*(matrix|inputs|needs|steps|github)\./);
    }
    expect(runBlocks(jobBlock('collect')).length).toBeGreaterThan(1);
    expect(jobBlock('publish')).toContain('FAILED_STORES: ${{ steps.pipeline.outputs.failed_stores }}');
  });
  it('treats every exit code except 0 and 3 as a failed store', () => {
    expect(workflow).toContain('if [ "$code" != "0" ] && [ "$code" != "3" ]; then');
    expect(workflow).not.toContain('if [ "$code" = "1" ]; then');
  });
  it('lets the crawl exit 0 or 2 pass and fails the collect step on anything else', () => {
    const block = jobBlock('collect');
    expect(block).toContain('code=${PIPESTATUS[0]}');
    expect(block).toMatch(/set \+e\n\s+node --import tsx src\/cli\/main\.ts crawl --config "config\/\$STORE\.json" 2>&1 \| tee "collect-\$STORE\.log"/);
    expect(block).toMatch(/0\) ;;/);
    expect(block).toMatch(/2\) echo "::warning title=\$STORE incomplete::/);
    expect(block).toMatch(/\*\)\n\s+echo "::error title=\$STORE failed::[^\n]*\n\s+exit 1/);
    expect(block).toContain('STORE: ${{ matrix.store }}');
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

describe('crawl notices: run-budget.ts as the collect and publish jobs run it', () => {
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

/** The shell text of the publish job's import step, as written in the workflow (indentation removed). */
function pipelineStepRunText(): string {
  const step = jobBlock('publish')
    .split(/^ {6}- name: /m)
    .find((text) => text.startsWith('Run the pipeline for every store'));
  if (step === undefined) throw new Error('no step "Run the pipeline for every store" in the publish job');
  const body = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(step);
  if (body === null) throw new Error('the pipeline step has no run block');
  return (body[1] as string).replace(/^ {10}/gm, '');
}

/** Git Bash on Windows (a bare `bash` there can be the WSL launcher); plain `bash` elsewhere. */
function findBash(): string | undefined {
  if (process.platform !== 'win32') return 'bash';
  return ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find((candidate) => existsSync(candidate));
}
const bash = findBash();

describe('crawl notices: the import step as the publish job runs it', () => {
  const fakeNode = '#!/usr/bin/env bash\necho "$*" >> "$FAKE_NODE_LOG"\nmkdir -p site/state\necho {} > site/state/state.json\necho "fake node $*"\nexit "${FAKE_NODE_EXIT:-0}"\n';

  interface Setup {
    stores: string;
    observe: string;
    files?: string[];
    configs?: string[];
    nodeExit?: string;
  }
  function runStep(setup: Setup) {
    const dir = tmp();
    const work = path.join(dir, 'work');
    mkdirSync(path.join(work, 'config'), { recursive: true });
    for (const store of setup.configs ?? setup.stores.split(' ')) writeFileSync(path.join(work, 'config', `${store}.json`), '{}');
    for (const file of setup.files ?? []) {
      mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      writeFileSync(path.join(work, file), '{}');
    }
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'bin', 'node'), fakeNode);
    chmodSync(path.join(dir, 'bin', 'node'), 0o755);
    const script = path.join(dir, 'step.sh');
    writeFileSync(script, pipelineStepRunText());
    const output = path.join(dir, 'github-output');
    const log = path.join(dir, 'node.log');
    writeFileSync(output, '');
    writeFileSync(log, '');
    const result = spawnSync(bash as string, ['--noprofile', '--norc', '-e', script], {
      cwd: work,
      env: {
        ...process.env,
        PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
        STORES: setup.stores,
        OBSERVE: setup.observe,
        BOOTSTRAP: 'false',
        SNAPSHOT_FILE: '',
        GITHUB_OUTPUT: output,
        FAKE_NODE_LOG: log,
        FAKE_NODE_EXIT: setup.nodeExit ?? '0',
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    const calls = readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
    return { result, output: readFileSync(output, 'utf8'), calls };
  }

  const noSnapshot = 'The collect job produced no snapshot; see its log.';
  const snapshot = 'snapshots/alpha-2026-01-01T00-00-00-000Z.json.gz';
  const betaSnapshot = 'snapshots/beta-2026-01-01T00-00-00-000Z.json.gz';

  it.skipIf(bash === undefined).each([
    ['the failed observed store first', 'alpha beta'],
    ['the failed observed store last', 'beta alpha'],
  ])('marks an observed store with no snapshot as failed and republishes the others, with no snapshots directory at all (#110): %s', (_name, stores) => {
    const { result, output, calls } = runStep({ stores, observe: 'alpha' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(output).toContain('failed_stores=alpha\n');
    expect(result.stdout).toContain(`::error title=alpha failed::${noSnapshot}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('config/beta.json');
    expect(calls[0]).toContain('--republish');
    expect(calls.join('\n')).not.toContain('alpha.json');
  });
  it.skipIf(bash === undefined)('imports the snapshot without a collect record when there is none', () => {
    const { result, output, calls } = runStep({ stores: 'alpha', observe: 'alpha', files: [snapshot] });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(output).toBe('failed_stores=\n');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('config/alpha.json');
    expect(calls[0]).toContain(`--snapshot ${snapshot}`);
    expect(calls[0]).not.toContain('--collect-record');
  });
  it.skipIf(bash === undefined)('passes the collect record when there is one', () => {
    const { result, calls } = runStep({ stores: 'alpha', observe: 'alpha', files: [snapshot, 'collected/collect-alpha.json'] });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`--snapshot ${snapshot}`);
    expect(calls[0]).toContain('--collect-record collected/collect-alpha.json');
  });
  it.skipIf(bash === undefined)('imports the newest of two snapshots of one store', () => {
    const newest = 'snapshots/alpha-2026-02-01T00-00-00-000Z.json.gz';
    const { result, calls } = runStep({ stores: 'alpha', observe: 'alpha', files: [newest, snapshot] });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(calls[0]).toContain(`--snapshot ${newest}`);
    expect(calls[0]).not.toContain(snapshot);
  });
  it.skipIf(bash === undefined)('does not count a quarantine (exit 3) as failed', () => {
    const { result, output, calls } = runStep({ stores: 'alpha beta', observe: 'alpha beta', files: [snapshot, betaSnapshot], nodeExit: '3' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(output).toBe('failed_stores=\n');
    expect(calls).toHaveLength(2);
  });
  it.skipIf(bash === undefined)('counts every other exit as failed and still attempts every store', () => {
    const { result, output, calls } = runStep({ stores: 'alpha beta', observe: 'alpha beta', files: [snapshot, betaSnapshot], nodeExit: '1' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(output).toBe('failed_stores=alpha beta\n');
    expect(result.stdout).toContain('::error title=alpha failed::');
    expect(result.stdout).toContain('::error title=beta failed::');
    expect(calls).toHaveLength(2);
  });
  it.skipIf(bash === undefined)('exits 1 for a store without a config file', () => {
    const { result, calls } = runStep({ stores: 'alpha', observe: 'alpha', configs: [] });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::no config for store');
    expect(calls).toHaveLength(0);
  });
});
