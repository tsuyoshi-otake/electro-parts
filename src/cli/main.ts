/**
 * Command-line entry point. Every command is a thin wrapper around the
 * pipeline modules; nothing here knows about a specific store.
 *
 *   pipeline  --config config/<store>.json [--bootstrap] [--previous-dir DIR] [--snapshot FILE [--collect-record FILE]] [--republish]
 *   crawl     --config ... [--out DIR] [--record FILE]
 *                                              write a raw snapshot and its collect record only, no import
 *                                              (exit 0 complete, 2 incomplete: both files are still written)
 *   verify    --config ... [--site DIR]        re-verify a produced site directory
 *   summary   --report reports/pipeline-<store>.json   print Markdown for the Actions summary
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { collectToFile, writeCollectRecord } from '../pipeline/collect.ts';
import { assertObserved, loadPipelineConfig } from '../pipeline/config.ts';
import { reportToMarkdown, type PipelineReport } from '../pipeline/report.ts';
import { runPipeline } from '../pipeline/run.ts';
import { verifyPublication } from '../pipeline/verifyPublication.ts';

const USAGE = `usage:
  main.ts pipeline --config FILE [--bootstrap] [--previous-dir DIR] [--snapshot FILE [--collect-record FILE]] [--republish]
  main.ts crawl    --config FILE [--out DIR] [--record FILE]
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
      'collect-record': { type: 'string' },
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
    ...(values['collect-record'] === undefined ? {} : { collectRecordPath: values['collect-record'] }),
  });
  process.stdout.write(reportToMarkdown(result.report));
  log(`report written: ${result.reportPath} (outcome=${String(result.report.outcome)}, exit=${result.exitCode})`);
  return result.exitCode;
}

async function commandCrawl(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { config: { type: 'string' }, out: { type: 'string' }, record: { type: 'string' } } });
  if (values.config === undefined) throw new Error(USAGE);
  const config = await loadPipelineConfig(values.config);
  assertObserved(config);
  const cwd = process.cwd();
  const { record, file } = await collectToFile({
    config,
    cwd,
    deps: { log },
    ...(values.out === undefined ? {} : { snapshotsDir: values.out }),
  });
  const recordFile = path.resolve(cwd, values.record ?? path.join(config.paths.reports, `collect-${config.storeId}.json`));
  await writeCollectRecord(recordFile, record);
  const summary = {
    file: path.relative(cwd, file),
    record: path.relative(cwd, recordFile),
    complete: record.complete,
    rawSha256: record.rawSha256,
    bytes: record.bytes,
    metrics: record.metrics,
    errors: record.errors,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return record.complete ? 0 : 2;
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
