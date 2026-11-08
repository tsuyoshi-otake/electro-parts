import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePipelineConfig, type PipelineConfig } from '../../src/pipeline/config.ts';
import { configCadence, observedStores, type ObservedStoresInput } from '../../scripts/observed-stores.ts';
import type { ObservationCadence } from '../../src/publisher/contract.ts';

/**
 * The crawl schedule and the published sampling caveat are two statements of
 * the same fact, made in two files. When they disagree the dataset lies about
 * how it was sampled, which is worse than sampling at the wrong rate: a reader
 * cannot tell that a gap in the history is a gap in the observation.
 *
 * So the workflow does not name which stores a schedule observes. It reads
 * `observation.cadence` from the store configs, and this test pins the other
 * half: that a schedule exists for every declared cadence, and that each cron
 * really fires at the rate its name claims.
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'crawl-publish.yml');
const workflow = readFileSync(workflowPath, 'utf8');

const crons = [...workflow.matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1] as string);
const weeklyCron = /^\s*WEEKLY_CRON: '([^']+)'/m.exec(workflow)?.[1] ?? null;
const dailyCron = /^\s*DAILY_CRON: '([^']+)'/m.exec(workflow)?.[1] ?? null;

const declaredStores = (/^\s*STORES: (.+)$/m.exec(workflow)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);

function configs(): { store: string; config: PipelineConfig }[] {
  const dir = path.join(repoRoot, 'config');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      store: f.replace(/\.json$/, ''),
      config: parsePipelineConfig(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))),
    }));
}

/** A cron field is "every" when it is `*`; anything else pins that field. */
const isEvery = (field: string): boolean => field === '*';

describe('observation cadence', () => {
  it('observes every store still observed once a day, straight from the daily wake-up (#82)', () => {
    const cadences = configs().map(({ config }) => config.observation.cadence);
    expect(cadences.every((c) => c === 'daily' || c === 'stopped')).toBe(true);
    expect(cadences).toContain('daily');
    expect(dailyCron).toBe('0 20 * * *');
    expect(crons).toEqual([dailyCron]);
    // Every wake-up is an observation day: nothing sits between the cron and the crawl.
    expect(workflow).not.toContain('observation-schedule');
    expect(workflow).not.toMatch(/^\s+needs: schedule$/m);
    expect(workflow).not.toContain('outputs.due');
  });
  it('schedules a daily cron that is actually daily', () => {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = (dailyCron as string).split(/\s+/);
    expect([minute, hour].every((f) => /^\d+$/.test(f as string)), 'a daily cron pins a time of day').toBe(true);
    for (const field of [dayOfMonth, month, dayOfWeek]) expect(isEvery(field as string), 'a daily cron pins no date').toBe(true);
  });
  it('gives every store config a place in the workflow', () => {
    const stores = configs().map((c) => c.store).sort();
    expect(stores.length).toBeGreaterThan(0);
    expect([...declaredStores].sort()).toEqual(stores);
    for (const { store, config } of configs()) expect(config.storeId).toBe(store);
  });

  it('schedules a weekly cron that is actually weekly', () => {
    const weeklyStores = configs().filter((c) => c.config.observation.cadence === 'weekly');
    if (weeklyStores.length === 0) return;
    expect(weeklyCron, 'WEEKLY_CRON must be declared while a store is weekly').not.toBeNull();
    expect(crons).toContain(weeklyCron);
    const [, , dayOfMonth, , dayOfWeek] = (weeklyCron as string).split(/\s+/);
    expect(isEvery(dayOfMonth as string), 'a weekly cron must not pin a day of the month').toBe(true);
    expect(isEvery(dayOfWeek as string), 'a weekly cron must pin a day of the week').toBe(false);
  });

  it('schedules a monthly cron that is actually monthly', () => {
    const monthlyStores = configs().filter((c) => c.config.observation.cadence === 'monthly');
    if (monthlyStores.length === 0) return;
    const monthly = crons.filter((c) => c !== weeklyCron && c !== dailyCron);
    expect(monthly.length, 'exactly one monthly schedule').toBe(1);
    const [, , dayOfMonth, month] = (monthly[0] as string).split(/\s+/);
    expect(isEvery(dayOfMonth as string), 'a monthly cron must pin a day of the month').toBe(false);
    expect(isEvery(month as string), 'a monthly cron runs every month').toBe(true);
  });

  it('never schedules a cadence no store declares', () => {
    // A stopped store is observed by no schedule at all.
    const declared = new Set(configs().map((c) => c.config.observation.cadence).filter((c) => c !== 'stopped'));
    if (!declared.has('weekly')) expect(crons).not.toContain(weeklyCron);
    expect(crons.length).toBe(declared.size);
  });

  it('reads the cadence from the configs rather than naming stores in the schedule', () => {
    // The selection loop must consult the config file; hard-coding a store
    // name next to a cron is what lets the two drift apart.
    // The selection is scripts/observed-stores.ts, which reads each config
    // through the pipeline's own parser: no second copy of the cadence
    // default lives in the workflow's shell.
    expect(workflow).toContain('observe=$(node --import tsx scripts/observed-stores.ts)');
    expect(workflow).not.toContain('.observation.cadence');
    const scheduleBlock = workflow.slice(workflow.indexOf('  schedule:'), workflow.indexOf('  workflow_dispatch:'));
    for (const { store } of configs()) expect(scheduleBlock).not.toContain(store);
  });
});

describe('which stores a run observes (#80)', () => {
  const cadences: Record<string, ObservationCadence> = { a: 'daily', b: 'weekly', c: 'stopped', d: 'monthly', e: 'daily' };
  const input = (over: Partial<ObservedStoresInput>): ObservedStoresInput => ({
    event: 'workflow_dispatch', cron: undefined, requested: '', republish: false,
    stores: Object.keys(cadences), dailyCron: '0 20 * * *', cadenceOf: (s) => cadences[s]!, ...over,
  });

  it('takes the stores that declare the schedule\'s cadence, and refuses an unknown cron', () => {
    expect(observedStores(input({ event: 'schedule', cron: '0 20 * * *' }))).toEqual(['a', 'e']);
    expect(() => observedStores(input({ event: 'schedule', cron: '0 20 */2 * *' }))).toThrow("unknown schedule '0 20 */2 * *'");
    expect(() => observedStores(input({ event: 'schedule', cron: undefined }))).toThrow("unknown schedule ''");
  });

  it('observes every store still observed when a manual run names none', () => {
    expect(observedStores(input({}))).toEqual(['a', 'b', 'd', 'e']);
    expect(observedStores(input({ requested: '  ' }))).toEqual(['a', 'b', 'd', 'e']);
  });

  it('observes named stores as named, and refuses an unknown or a stopped one', () => {
    expect(observedStores(input({ requested: 'e  b' }))).toEqual(['e', 'b']);
    // A schedule event never overrides an explicit list.
    expect(observedStores(input({ event: 'schedule', cron: '0 20 * * *', requested: 'd' }))).toEqual(['d']);
    expect(() => observedStores(input({ requested: 'a x' }))).toThrow("unknown store 'x'");
    expect(() => observedStores(input({ requested: 'a c' }))).toThrow(`store 'c' is no longer observed (observation.cadence "stopped" in config/c.json)`);
  });

  it('observes nothing on a republish, whatever was named', () => {
    expect(observedStores(input({ republish: true, requested: 'c' }))).toEqual([]);
    expect(observedStores(input({ republish: true, event: 'schedule', cron: 'nonsense' }))).toEqual([]);
  });

  it('never observes a stopped store from the real configs, by schedule or by an all-store run', () => {
    const real = { stores: declaredStores, dailyCron: dailyCron!, cadenceOf: (s: string) => configCadence(s, path.join(repoRoot, 'config')) };
    const stopped = configs().filter((c) => c.config.observation.cadence === 'stopped').map((c) => c.store);
    const observed = declaredStores.filter((s) => !stopped.includes(s));
    expect(stopped).toEqual(['ksy']);
    expect(observedStores(input({ ...real, event: 'schedule', cron: dailyCron! }))).toEqual(observed);
    expect(observedStores(input({ ...real }))).toEqual(observed);
    expect(() => observedStores(input({ ...real, requested: 'ksy' }))).toThrow('no longer observed');
  });

  it('prints the list on stdout for the workflow, and the reason as a workflow error on failure', () => {
    const cli = (env: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/observed-stores.ts'], {
      cwd: repoRoot, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, STORES: declaredStores.join(' '), DAILY_CRON: dailyCron!, EVENT_NAME: 'workflow_dispatch', EVENT_CRON: '', OBSERVE: '', REPUBLISH: 'false', ...env },
    });
    const all = cli({});
    expect(all.status).toBe(0);
    expect(all.stdout.trim().split(' ')).toEqual(declaredStores.filter((s) => s !== 'ksy'));
    const named = cli({ OBSERVE: 'ksy' });
    expect(named.status).toBe(1);
    expect(named.stdout).toBe('');
    expect(named.stderr.trim()).toBe(`::error::store 'ksy' is no longer observed (observation.cadence "stopped" in config/ksy.json)`);
    const republish = cli({ OBSERVE: 'ksy', REPUBLISH: 'true' });
    expect(republish.status).toBe(0);
    expect(republish.stdout).toBe('\n');
  });
});
