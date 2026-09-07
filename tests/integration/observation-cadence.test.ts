import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePipelineConfig, type PipelineConfig } from '../../src/pipeline/config.ts';

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
    const monthly = crons.filter((c) => c !== weeklyCron);
    expect(monthly.length, 'exactly one monthly schedule').toBe(1);
    const [, , dayOfMonth, month] = (monthly[0] as string).split(/\s+/);
    expect(isEvery(dayOfMonth as string), 'a monthly cron must pin a day of the month').toBe(false);
    expect(isEvery(month as string), 'a monthly cron runs every month').toBe(true);
  });

  it('never schedules a cadence no store declares', () => {
    const declared = new Set(configs().map((c) => c.config.observation.cadence));
    if (!declared.has('weekly')) expect(crons).not.toContain(weeklyCron);
    expect(crons.length).toBe(declared.size);
  });

  it('reads the cadence from the configs rather than naming stores in the schedule', () => {
    // The selection loop must consult the config file; hard-coding a store
    // name next to a cron is what lets the two drift apart.
    expect(workflow).toContain(`jq -r '.observation.cadence // "monthly"' "config/$store.json"`);
    const scheduleBlock = workflow.slice(workflow.indexOf('  schedule:'), workflow.indexOf('  workflow_dispatch:'));
    for (const { store } of configs()) expect(scheduleBlock).not.toContain(store);
  });
});
