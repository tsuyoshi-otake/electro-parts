/**
 * Command-line entry point. Every command is a thin wrapper around the
 * pipeline modules; nothing here knows about a specific store.
 *
 *   pipeline  --config config/<store>.json [--bootstrap] [--previous-dir DIR] [--snapshot FILE] [--republish]
 *   crawl     --config ...                     write a raw snapshot only (exit 2 when incomplete)
 *   verify    --config ... [--site DIR]        re-verify a produced site directory
 *   summary   --report reports/pipeline-<store>.json   print Markdown for the Actions summary
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { writeRawSnapshotFile } from '../core/snapshotFile.ts';
import { loadPipelineConfig } from '../pipeline/config.ts';
import { reportToMarkdown, type PipelineReport } from '../pipeline/report.ts';
import { runPipeline, SITE_STATE_DIR } from '../pipeline/run.ts';
import { verifyPublication } from '../pipeline/verifyPublication.ts';
import { getStoreCollector } from '../stores/collectorRegistry.ts';

const USAGE = `usage:
  main.ts pipeline --config FILE [--bootstrap] [--previous-dir DIR] [--snapshot FILE] [--republish]
  main.ts crawl    --config FILE [--out DIR]
  main.ts verify   --config FILE [--site DIR]
  main.ts summary  --report FILE [--append-to FILE]`;

function log(message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

async function commandPipeline(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      bootstrap: { type: 'boolean', default: false },
      republish: { type: 'boolean', default: false },
      'previous-dir': { type: 'string' },
      snapshot: { type: 'string' },
    },
  });
  if (values.config === undefined) throw new Error(USAGE);
  const config = await loadPipelineConfig(values.config);
  const result = await runPipeline({
    config,
    bootstrap: values.bootstrap,
    republish: values.republish,
    cwd: process.cwd(),
    deps: { log },
    ...(values['previous-dir'] === undefined ? {} : { previous: { dir: values['previous-dir'] } }),
    ...(values.snapshot === undefined ? {} : { snapshotPath: values.snapshot }),
  });
  process.stdout.write(reportToMarkdown(result.report));
  log(`report written: ${result.reportPath} (outcome=${String(result.report.outcome)}, exit=${result.exitCode})`);
  return result.exitCode;
}

async function commandCrawl(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { config: { type: 'string' }, out: { type: 'string' } } });
  if (values.config === undefined) throw new Error(USAGE);
  const config = await loadPipelineConfig(values.config);
  const collector = getStoreCollector(config.storeId);
  const outcome = await collector.collect(config.collector, { log });
  const dir = values.out ?? config.paths.snapshots;
  const file = path.join(dir, `${config.storeId}-${outcome.retrievedAt.replace(/[:.]/g, '-')}.json.gz`);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const written = await writeRawSnapshotFile(file, outcome.raw);
  process.stdout.write(`${JSON.stringify({ file, complete: outcome.complete, rawSha256: written.rawSha256, bytes: written.bytes, metrics: outcome.metrics, errors: outcome.errors }, null, 2)}\n`);
  return outcome.complete ? 0 : 2;
}

async function commandVerify(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { config: { type: 'string' }, site: { type: 'string' } } });
  if (values.config === undefined) throw new Error(USAGE);
  const config = await loadPipelineConfig(values.config);
  const site = values.site ?? config.paths.site;
  const verified = await verifyPublication(site, config);
  process.stdout.write(
    `${JSON.stringify({ datasetVersion: verified.datasetVersion, productFiles: verified.productCount, bytesTotal: verified.bytesTotal, stateSha256: verified.stateSha256, stateBytes: verified.stateBytes, stores: verified.stores }, null, 2)}\n`,
  );
  return 0;
}

async function commandSummary(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { report: { type: 'string' }, 'append-to': { type: 'string' } } });
  if (values.report === undefined) throw new Error(USAGE);
  const report = JSON.parse(await readFile(values.report, 'utf8')) as PipelineReport;
  const md = reportToMarkdown(report);
  if (values['append-to'] !== undefined) await writeFile(values['append-to'], md, { flag: 'a' });
  else process.stdout.write(md);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'pipeline':
      return commandPipeline(rest);
    case 'crawl':
      return commandCrawl(rest);
    case 'verify':
      return commandVerify(rest);
    case 'summary':
      return commandSummary(rest);
    default:
      throw new Error(USAGE);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
