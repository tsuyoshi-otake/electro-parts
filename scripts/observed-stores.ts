import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePipelineConfig } from '../src/pipeline/config.ts';
import type { ObservationCadence } from '../src/publisher/contract.ts';

/**
 * Which stores one "Crawl and publish" run observes. Every other store in
 * `STORES` is regenerated from the published history with `--republish`.
 *
 * The answer comes from each store's `observation.cadence`, never from store
 * names written next to a cron (ADR-0016):
 * - a republish observes nothing;
 * - stores named in the dispatch are observed as named, but naming an unknown
 *   store or a stopped one is an error, not a silent skip;
 * - a schedule observes the stores that declare the cadence its cron stands for;
 * - a manual run with no stores observes every store that is still observed.
 */
export interface ObservedStoresInput {
  /** `github.event_name`. */
  event: string | undefined;
  /** `github.event.schedule`, the cron that started a scheduled run. */
  cron: string | undefined;
  /** The dispatch's `stores` input, space separated. */
  requested: string;
  republish: boolean;
  /** `STORES`: every store the site publishes, in run order. */
  stores: readonly string[];
  /** The workflow's `EVERY_TWO_DAYS_CRON`. */
  everyTwoDaysCron: string;
  cadenceOf: (store: string) => ObservationCadence;
}

export function observedStores(input: ObservedStoresInput): string[] {
  if (input.republish) return [];
  const requested = input.requested.split(/\s+/).filter(Boolean);
  if (requested.length > 0) {
    for (const store of requested) {
      if (!input.stores.includes(store)) throw new Error(`unknown store '${store}'; known stores: ${input.stores.join(' ')}`);
      if (input.cadenceOf(store) === 'stopped') {
        throw new Error(`store '${store}' is no longer observed (observation.cadence "stopped" in config/${store}.json)`);
      }
    }
    return requested;
  }
  if (input.event === 'schedule') {
    if (input.cron !== input.everyTwoDaysCron) throw new Error(`unknown schedule '${input.cron ?? ''}'`);
    return input.stores.filter((store) => input.cadenceOf(store) === 'every_two_days');
  }
  return input.stores.filter((store) => input.cadenceOf(store) !== 'stopped');
}

/** A store's declared cadence, read through the same parser the pipeline uses. */
export function configCadence(store: string, configDir = 'config'): ObservationCadence {
  const file = path.join(configDir, `${store}.json`);
  return parsePipelineConfig(JSON.parse(readFileSync(file, 'utf8'))).observation.cadence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  try {
    if (!env.STORES || !env.EVERY_TWO_DAYS_CRON) throw new Error('STORES and EVERY_TWO_DAYS_CRON are required');
    const observed = observedStores({
      event: env.EVENT_NAME,
      cron: env.EVENT_CRON,
      requested: env.OBSERVE ?? '',
      republish: env.REPUBLISH === 'true',
      stores: env.STORES.split(/\s+/).filter(Boolean),
      everyTwoDaysCron: env.EVERY_TWO_DAYS_CRON,
      cadenceOf: (store) => configCadence(store),
    });
    process.stdout.write(`${observed.join(' ')}\n`);
  } catch (e) {
    // stdout is the store list the workflow reads; the reason goes to the log.
    process.stderr.write(`::error::${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
