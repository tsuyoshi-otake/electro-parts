import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkerExitReporter from '../helpers/workerExitReporter.ts';

/**
 * The reporter exists for the day a worker dies (#108). That day cannot be scheduled, so these tests make it
 * happen in small: a real child process that exits the way a killed, an aborted and a normally stopped worker do.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function reporterIn(): { reporter: WorkerExitReporter; file: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'worker-exit-'));
  dirs.push(root);
  const reporter = new WorkerExitReporter();
  reporter.onInit({ config: { root } });
  return { reporter, file: path.join(root, 'reports', 'worker-exits.json') };
}
const moduleOf = (relativeModuleId: string, state: string) => ({ relativeModuleId, state: () => state });
/** A child that ends by itself with `code`, or is ended with `signal` when one is given. */
function child(code: number, signal?: NodeJS.Signals): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['-e', signal === undefined ? `process.exit(${code})` : 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    proc.once('error', reject);
    proc.once('exit', () => resolve());
    if (signal !== undefined) proc.once('spawn', () => proc.kill(signal));
  });
}

describe('worker exit reporter', () => {
  it('writes nothing after a run without an unhandled error or an abnormal exit', async () => {
    const { reporter, file } = reporterIn();
    await child(0);
    await child(0, 'SIGTERM'); // how vitest stops every worker
    reporter.onTestRunEnd([moduleOf('tests/unit/a.test.ts', 'passed')], []);
    expect(existsSync(file)).toBe(false);
  });

  it('records the exit code of a child that died, the unfinished file and the unhandled error', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reporter, file } = reporterIn();
    await child(134);
    await child(0, 'SIGTERM');
    reporter.onTestRunEnd(
      [moduleOf('tests/unit/a.test.ts', 'passed'), moduleOf('tests/unit/b.test.ts', 'pending'), moduleOf('tests/unit/c.test.ts', 'failed'), moduleOf('tests/unit/d.test.ts', 'skipped')],
      [new Error('Worker exited unexpectedly')],
    );
    const record = JSON.parse(readFileSync(file, 'utf8')) as { abnormalExits: { code: number | null; signal: string | null; livedMs: number }[]; unfinishedModules: string[]; unhandledErrors: string[]; modules: number };
    expect(record.abnormalExits.map((exit) => [exit.code, exit.signal])).toEqual([[134, null]]);
    expect(record.abnormalExits[0]?.livedMs).toBeGreaterThanOrEqual(0);
    expect(record.unfinishedModules).toEqual(['tests/unit/b.test.ts (pending)']);
    expect(record.unhandledErrors[0]).toContain('Worker exited unexpectedly');
    expect(record.modules).toBe(4);
    const printed = stderr.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toContain('exited with code 134 (0x86)');
    expect(printed).toContain('unfinished: tests/unit/b.test.ts (pending)');
  });

  it('records an abnormal exit even when vitest reported no unhandled error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reporter, file } = reporterIn();
    await child(1);
    reporter.onTestRunEnd([moduleOf('tests/unit/a.test.ts', 'passed')], []);
    const record = JSON.parse(readFileSync(file, 'utf8')) as { abnormalExits: { code: number | null }[]; unfinishedModules: string[] };
    expect(record.abnormalExits.map((exit) => exit.code)).toEqual([1]);
    expect(record.unfinishedModules).toEqual([]);
  });

  it('reports an exit once: the next run in the same process starts empty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reporter, file } = reporterIn();
    await child(134);
    reporter.onTestRunEnd([moduleOf('tests/unit/a.test.ts', 'pending')], []);
    rmSync(file);
    reporter.onTestRunEnd([moduleOf('tests/unit/a.test.ts', 'passed')], []);
    expect(existsSync(file)).toBe(false);
  });

  it('records an unhandled error even when no child exited abnormally', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reporter, file } = reporterIn();
    reporter.onTestRunEnd([moduleOf('tests/unit/a.test.ts', 'passed')], ['boom']);
    const record = JSON.parse(readFileSync(file, 'utf8')) as { abnormalExits: unknown[]; unhandledErrors: string[] };
    expect(record.abnormalExits).toEqual([]);
    expect(record.unhandledErrors).toEqual(['boom']);
  });
});
