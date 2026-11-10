import { subscribe } from 'node:diagnostics_channel';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

/**
 * Keeps what vitest drops when a worker process dies (#108): "Worker exited unexpectedly" names neither the test
 * file nor the exit code, and the two are what tell an external kill (code 1), a V8 abort (134) and a native
 * crash (0xC000…) apart. Listens for the children this process forks and writes `reports/worker-exits.json`
 * when a run ends with an unhandled error or a child that exited abnormally. Silent otherwise.
 */
interface Exit { pid: number | undefined; code: number | null; signal: string | null; livedMs: number; at: string; args: string }

export default class WorkerExitReporter {
  private readonly exits: Exit[] = [];
  private root = process.cwd();

  constructor() {
    subscribe('child_process', (message) => {
      const child = (message as { process?: ChildProcess }).process;
      if (child === undefined) return;
      const started = Date.now();
      child.once('exit', (code, signal) => {
        this.exits.push({ pid: child.pid, code, signal, livedMs: Date.now() - started, at: new Date().toISOString(), args: child.spawnargs.slice(-1).join(' ') });
      });
    });
  }

  onInit(vitest: { config: { root: string } }): void {
    this.root = vitest.config.root;
  }

  onTestRunEnd(modules: ReadonlyArray<{ relativeModuleId: string; state(): string }>, unhandledErrors: ReadonlyArray<unknown>): void {
    // Vitest stops every worker itself with SIGTERM; that and a clean exit are the normal ends.
    // Taken out of the list, so a later run in the same process (watch mode) reports only its own exits.
    const abnormal = this.exits.splice(0).filter((exit) => exit.code !== 0 && exit.signal !== 'SIGTERM');
    if (unhandledErrors.length === 0 && abnormal.length === 0) return;
    const unfinished = modules.filter((module) => !['passed', 'failed', 'skipped'].includes(module.state())).map((module) => `${module.relativeModuleId} (${module.state()})`);
    const record = {
      at: new Date().toISOString(),
      unhandledErrors: unhandledErrors.map((error) => String((error as { stack?: string })?.stack ?? error).slice(0, 2000)),
      abnormalExits: abnormal,
      unfinishedModules: unfinished,
      modules: modules.length,
      node: process.version,
    };
    const file = path.join(this.root, 'reports', 'worker-exits.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    for (const exit of abnormal) {
      console.error(`[worker-exit] pid ${exit.pid} exited with code ${exit.code}${exit.code === null ? '' : ` (0x${(exit.code >>> 0).toString(16)})`}, signal ${exit.signal}, after ${exit.livedMs} ms`);
    }
    console.error(`[worker-exit] unfinished: ${unfinished.join(', ') || '(none listed)'}; record: ${path.relative(this.root, file)}`);
  }
}
