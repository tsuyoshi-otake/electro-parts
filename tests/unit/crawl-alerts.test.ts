import { describe, expect, it } from 'vitest';
import {
  applyActions,
  classifyReports,
  listOpenAlerts,
  MAX_REASON_LENGTH,
  MAX_REASONS,
  planActions,
  sanitizeLine,
  type AlertAction,
  type GhRunner,
  type OpenAlert,
  type RunContext,
  type StoreVerdict,
} from '../../scripts/crawl-alerts.ts';
import { newReport, stage, type PipelineOutcome, type PipelineReport } from '../../src/pipeline/report.ts';

function report(storeId: string, outcome: PipelineOutcome, edit: (r: PipelineReport) => void = () => {}): PipelineReport {
  const r = newReport(storeId, () => new Date(0));
  r.outcome = outcome;
  edit(r);
  return r;
}

const observedReport = (storeId: string, outcome: PipelineOutcome = 'published'): PipelineReport =>
  report(storeId, outcome, (r) => {
    stage(r, 'collect').status = 'ok';
  });

const quarantinedReport = (storeId: string, warnings: string[]): PipelineReport =>
  report(storeId, 'quarantined', (r) => {
    r.warnings.push(...warnings);
  });

const failedReport = (storeId: string, stageName: 'collect' | 'import', error: string): PipelineReport =>
  report(storeId, 'failed', (r) => {
    const s = stage(r, stageName);
    s.status = 'failed';
    s.error = error;
  });

const file = (name: string, r: unknown) => ({ file: `reports/${name}`, report: r });

const ctx: RunContext = {
  runId: '777',
  runAttempt: '2',
  runUrl: 'https://example.test/o/r/actions/runs/777',
  runbookUrl: 'https://example.test/o/r/blob/abc/docs/runbook.md',
  assignee: 'octo',
};

const alertVerdict = (storeId: string, over: Partial<Extract<StoreVerdict, { kind: 'alert' }>> = {}): StoreVerdict => ({
  storeId,
  kind: 'alert',
  outcome: 'quarantined',
  stage: null,
  reasons: ['too few items'],
  ...over,
});

const marker = (id: string) => `<!-- crawl-alert store=${id} -->`;

describe('sanitizeLine', () => {
  it('turns every control character, including CR, LF and TAB, into a space', () => {
    expect(sanitizeLine('a\r\nb\tc\u0000d\u001be\u007ff\u009fg')).toBe('a b c d e f g');
  });
  it('replaces backticks so external text cannot close the code fence', () => {
    expect(sanitizeLine('x ``` y `z`')).toBe("x ''' y 'z'");
  });
  it('defuses an HTML comment opener so external text cannot forge a marker', () => {
    const out = sanitizeLine('<!-- crawl-alert store=alpha -->');
    expect(out).not.toContain('<!--');
    expect(out).toBe('<! -- crawl-alert store=alpha -->');
  });
  it('collapses runs of whitespace and trims', () => {
    expect(sanitizeLine('   a    b \n\n c   ')).toBe('a b c');
  });
  it('keeps a line of exactly the maximum length', () => {
    const text = 'x'.repeat(MAX_REASON_LENGTH);
    expect(sanitizeLine(text)).toBe(text);
  });
  it('cuts a longer line to the maximum length, ending in an ellipsis', () => {
    const out = sanitizeLine('x'.repeat(MAX_REASON_LENGTH + 1));
    expect(out).toHaveLength(MAX_REASON_LENGTH);
    expect(out).toBe(`${'x'.repeat(MAX_REASON_LENGTH - 1)}…`);
  });
});

describe('classifyReports: validation', () => {
  const bad: [string, unknown][] = [
    ['a non-object', 'text'],
    ['null', null],
    ['an array', []],
    ['a missing storeId', { ...observedReport('alpha'), storeId: undefined }],
    ['an uppercase storeId', { ...observedReport('alpha'), storeId: 'Alpha' }],
    ['a storeId with a path separator', { ...observedReport('alpha'), storeId: 'a/b' }],
    ['a storeId starting with a hyphen', { ...observedReport('alpha'), storeId: '-a' }],
    ['an unknown outcome', { ...observedReport('alpha'), outcome: 'weird' }],
    ['a null outcome', { ...observedReport('alpha'), outcome: null }],
    ['stages that are not an array', { ...observedReport('alpha'), stages: {} }],
    ['warnings that are not an array', { ...observedReport('alpha'), warnings: 'x' }],
  ];
  for (const [name, value] of bad) {
    it(`throws, naming the file, for ${name}`, () => {
      expect(() => classifyReports({ reports: [file('pipeline-alpha.json', value)], failedStores: [] })).toThrow(/pipeline-alpha\.json/);
    });
  }
  it('rejects an invalid id in failedStores', () => {
    expect(() => classifyReports({ reports: [], failedStores: ['ok', 'Bad Id'] })).toThrow(/FAILED_STORES/);
    expect(() => classifyReports({ reports: [], failedStores: ['../x'] })).toThrow(/FAILED_STORES/);
  });
  it('accepts ids with digits and hyphens', () => {
    const v = classifyReports({ reports: [file('pipeline-a-1.json', observedReport('a-1'))], failedStores: [] });
    expect(v).toEqual([{ storeId: 'a-1', kind: 'observed' }]);
  });
});

describe('classifyReports: verdicts', () => {
  const classify = (reports: ReturnType<typeof file>[], failedStores: string[] = []) => classifyReports({ reports, failedStores });

  it('turns a failed report into an alert at the first failed stage', () => {
    const r = failedReport('alpha', 'import', 'disk full');
    stage(r, 'collect').status = 'ok';
    stage(r, 'validate').status = 'failed';
    stage(r, 'validate').error = 'later failure';
    // import comes after validate in stage order, so validate is the first failed one.
    expect(classify([file('pipeline-alpha.json', r)])).toEqual([
      { storeId: 'alpha', kind: 'alert', outcome: 'failed', stage: 'validate', reasons: ['validate: later failure'] },
    ]);
  });
  it('sanitizes the stage error', () => {
    const r = failedReport('alpha', 'collect', 'boom `x`\n<!-- crawl-alert store=beta -->');
    const [v] = classify([file('pipeline-alpha.json', r)]);
    expect(v).toMatchObject({ reasons: ["collect: boom 'x' <! -- crawl-alert store=beta -->"] });
  });
  it('sanitizes the stage name, which the Issue puts between backticks', () => {
    const r = failedReport('alpha', 'collect', 'boom');
    (stage(r, 'collect') as { name: string }).name = 'col`lect\n<!-- x';
    const [v] = classify([file('pipeline-alpha.json', r)]);
    expect(v).toMatchObject({ stage: "col'lect <! -- x", reasons: ["col'lect <! -- x: boom"] });
  });
  it('reports a failed run with no failed stage', () => {
    expect(classify([file('pipeline-alpha.json', report('alpha', 'failed'))])).toEqual([
      { storeId: 'alpha', kind: 'alert', outcome: 'failed', stage: null, reasons: ['no stage recorded an error'] },
    ]);
  });
  it('turns a quarantined report into an alert whose reasons are the quarantine warnings without the prefix', () => {
    const r = quarantinedReport('alpha', ['unrelated note', 'quarantined: too_few_items 3 < 10', 'quarantined: price jump']);
    expect(classify([file('pipeline-alpha.json', r)])).toEqual([
      { storeId: 'alpha', kind: 'alert', outcome: 'quarantined', stage: null, reasons: ['too_few_items 3 < 10', 'price jump'] },
    ]);
  });
  it('adds what the collector reported after the rejection, whatever order the report lists them in', () => {
    // The shape of the 2026-11-09 run: the rejection is one generic line, and
    // the collector's error is the line that says which page broke.
    const r = quarantinedReport('alpha', [
      'collect: a note that is not an error',
      'collect error: Listing 12 at 40: the listed total changed from 9 to 8 during the crawl',
      'sanity: price_change_ratio 0.2',
      'quarantined: alpha.raw snapshot is not a complete collection',
    ]);
    expect(classify([file('pipeline-alpha.json', r)])).toMatchObject([
      {
        reasons: [
          'alpha.raw snapshot is not a complete collection',
          'collect error: Listing 12 at 40: the listed total changed from 9 to 8 during the crawl',
        ],
      },
    ]);
  });
  it('reports the collector error alone when the report carries no rejection line', () => {
    const r = quarantinedReport('alpha', ['collect error: `page` 3 broke']);
    expect(classify([file('pipeline-alpha.json', r)])).toMatchObject([{ reasons: ["collect error: 'page' 3 broke"] }]);
  });
  it('sanitizes quarantine reasons', () => {
    const r = quarantinedReport('alpha', ['quarantined: a`b\nc']);
    expect(classify([file('pipeline-alpha.json', r)])).toMatchObject([{ reasons: ["a'b c"] }]);
  });
  it('says so when a quarantined report carries no reason', () => {
    const r = quarantinedReport('alpha', ['unrelated note']);
    expect(classify([file('pipeline-alpha.json', r)])).toMatchObject([{ reasons: ['no reason recorded'] }]);
  });
  it('treats a published or unchanged report with a collect that ran as observed', () => {
    expect(classify([file('pipeline-alpha.json', observedReport('alpha', 'published'))])).toEqual([{ storeId: 'alpha', kind: 'observed' }]);
    expect(classify([file('pipeline-beta.json', observedReport('beta', 'unchanged'))])).toEqual([{ storeId: 'beta', kind: 'observed' }]);
  });
  it('treats a republish (collect skipped) as not attempted, for published and unchanged alike', () => {
    expect(classify([file('pipeline-alpha.json', report('alpha', 'unchanged'))])).toEqual([{ storeId: 'alpha', kind: 'not_attempted' }]);
    expect(classify([file('pipeline-beta.json', report('beta', 'published'))])).toEqual([{ storeId: 'beta', kind: 'not_attempted' }]);
  });
  it('says no error recorded when the failed stage error is null or empty', () => {
    for (const error of [null, '']) {
      const r = report('alpha', 'failed', (x) => {
        const s = stage(x, 'collect');
        s.status = 'failed';
        (s as { error: unknown }).error = error;
      });
      expect(classify([file('pipeline-alpha.json', r)])).toEqual([
        { storeId: 'alpha', kind: 'alert', outcome: 'failed', stage: 'collect', reasons: ['collect: no error recorded'] },
      ]);
    }
  });
  it('ignores non-string warnings in a quarantined report without throwing', () => {
    const r = report('alpha', 'quarantined', (x) => {
      x.warnings.push(42 as unknown as string, null as unknown as string, { note: 'x' } as unknown as string, 'quarantined: x');
    });
    expect(classify([file('pipeline-alpha.json', r)])).toEqual([
      { storeId: 'alpha', kind: 'alert', outcome: 'quarantined', stage: null, reasons: ['x'] },
    ]);
  });
  it('treats a published report with no stages at all as not attempted, without throwing', () => {
    const r = report('alpha', 'published', (x) => {
      x.stages = [];
    });
    expect(classify([file('pipeline-alpha.json', r)])).toEqual([{ storeId: 'alpha', kind: 'not_attempted' }]);
  });
  it('keeps the first report for a store, in either order, when two plain reports collide', () => {
    const quarantined = file('pipeline-alpha.json', quarantinedReport('alpha', ['quarantined: first']));
    const observed = file('other/pipeline-alpha.json', observedReport('alpha'));
    expect(classify([quarantined, observed])).toEqual([
      { storeId: 'alpha', kind: 'alert', outcome: 'quarantined', stage: null, reasons: ['first'] },
    ]);
    expect(classify([observed, quarantined])).toEqual([{ storeId: 'alpha', kind: 'observed' }]);
  });
  it('keeps the first failed-run report when two failed-run reports collide', () => {
    const first = file('pipeline-alpha.failed-run.json', failedReport('alpha', 'collect', 'first'));
    const second = file('other/pipeline-alpha.failed-run.json', failedReport('alpha', 'import', 'second'));
    expect(classify([first, second])).toEqual([
      { storeId: 'alpha', kind: 'alert', outcome: 'failed', stage: 'collect', reasons: ['collect: first'] },
    ]);
  });
  it('does not count a failed collect stage as an observation', () => {
    const r = report('alpha', 'unchanged', (x) => {
      stage(x, 'collect').status = 'failed';
    });
    expect(classify([file('pipeline-alpha.json', r)])).toEqual([{ storeId: 'alpha', kind: 'not_attempted' }]);
  });

  it('prefers the failed-run report over the report that overwrote it, in either file order', () => {
    const failedRun = file('pipeline-alpha.failed-run.json', failedReport('alpha', 'collect', 'timeout'));
    const repaired = file('pipeline-alpha.json', report('alpha', 'unchanged'));
    const expected = [{ storeId: 'alpha', kind: 'alert', outcome: 'failed', stage: 'collect', reasons: ['collect: timeout'] }];
    expect(classify([failedRun, repaired])).toEqual(expected);
    expect(classify([repaired, failedRun])).toEqual(expected);
  });

  it('makes every store in failedStores an alert, overriding observed', () => {
    expect(classify([file('pipeline-alpha.json', observedReport('alpha'))], ['alpha'])).toEqual([
      {
        storeId: 'alpha',
        kind: 'alert',
        outcome: 'failed',
        stage: null,
        reasons: ['the pipeline exited without writing a failure report; see the job log'],
      },
    ]);
  });
  it('makes a failedStores entry an alert over not_attempted and over a store with no report at all', () => {
    const v = classify([file('pipeline-alpha.json', report('alpha', 'unchanged'))], ['alpha', 'gamma']);
    expect(v.map((x) => [x.storeId, x.kind])).toEqual([
      ['alpha', 'alert'],
      ['gamma', 'alert'],
    ]);
  });
  it('keeps the richer verdict of a store that is also in failedStores', () => {
    const r = failedReport('alpha', 'collect', 'timeout');
    expect(classify([file('pipeline-alpha.json', r)], ['alpha'])).toEqual([
      { storeId: 'alpha', kind: 'alert', outcome: 'failed', stage: 'collect', reasons: ['collect: timeout'] },
    ]);
    const q = quarantinedReport('beta', ['quarantined: why']);
    expect(classify([file('pipeline-beta.json', q)], ['beta'])).toMatchObject([{ outcome: 'quarantined', reasons: ['why'] }]);
  });

  it('keeps quarantine reasons up to the cap without cutting', () => {
    const warnings = Array.from({ length: MAX_REASONS }, (_, i) => `quarantined: r${i}`);
    const [v] = classify([file('pipeline-alpha.json', quarantinedReport('alpha', warnings))]);
    expect(v).toMatchObject({ reasons: warnings.map((w) => w.replace('quarantined: ', '')) });
  });
  it('cuts reasons past the cap to the cap, the last entry counting the rest', () => {
    const warnings = Array.from({ length: MAX_REASONS + 3 }, (_, i) => `quarantined: r${i}`);
    const [v] = classify([file('pipeline-alpha.json', quarantinedReport('alpha', warnings))]);
    const reasons = (v as Extract<StoreVerdict, { kind: 'alert' }>).reasons;
    expect(reasons).toHaveLength(MAX_REASONS);
    expect(reasons.slice(0, MAX_REASONS - 1)).toEqual(Array.from({ length: MAX_REASONS - 1 }, (_, i) => `r${i}`));
    expect(reasons[MAX_REASONS - 1]).toBe('… 4 more');
  });

  it('sorts the result by storeId, neither as input nor reversed', () => {
    const ids = ['m', 'a-2', 'z', 'a1', 'b'];
    const v = classify(ids.map((id) => file(`pipeline-${id}.json`, observedReport(id))));
    expect(v.map((x) => x.storeId)).toEqual(['a-2', 'a1', 'b', 'm', 'z']);
  });
});

describe('planActions', () => {
  const issue = (number: number, body: string, comments: string[] = []): OpenAlert => ({ number, body, comments });

  it('creates an Issue with the exact body for a quarantined store with no open Issue', () => {
    const actions = planActions([alertVerdict('alpha', { reasons: ['one', 'two'] })], [], ctx);
    expect(actions).toEqual([
      {
        type: 'create',
        storeId: 'alpha',
        title: 'Crawl alert: alpha was not observed',
        assignee: 'octo',
        body: [
          '<!-- crawl-alert store=alpha -->',
          '**alpha** was not observed: `quarantined`.',
          '',
          '- run: https://example.test/o/r/actions/runs/777 (attempt 2)',
          '',
          '```text',
          'one',
          'two',
          '```',
          '',
          'What to do: https://example.test/o/r/blob/abc/docs/runbook.md (隔離(quarantined)が出たら)',
          'This Issue is closed automatically when a later run observes the store again.',
          '<!-- crawl-alert run=777 -->',
        ].join('\n'),
      },
    ]);
  });
  it('names the stage and the failed section of the runbook for a failed store, and passes a null assignee through', () => {
    const [a] = planActions(
      [alertVerdict('alpha', { outcome: 'failed', stage: 'collect', reasons: ['collect: boom'] })],
      [],
      { ...ctx, assignee: null },
    );
    expect(a).toMatchObject({ type: 'create', assignee: null });
    const body = (a as Extract<AlertAction, { type: 'create' }>).body;
    expect(body.split('\n')[1]).toBe('**alpha** was not observed: `failed` at stage `collect`.');
    expect(body).toContain('(失敗(failed)が出たら)');
    expect(body).not.toContain('隔離');
  });
  it('comments on the open Issue with the exact comment body', () => {
    const open = [issue(5, `${marker('alpha')}\nold body`)];
    expect(planActions([alertVerdict('alpha', { outcome: 'failed', stage: 'import', reasons: ['import: x'] })], open, ctx)).toEqual([
      {
        type: 'comment',
        storeId: 'alpha',
        issue: 5,
        body: [
          'Still not observed: `failed` at stage `import`.',
          '',
          '- run: https://example.test/o/r/actions/runs/777 (attempt 2)',
          '',
          '```text',
          'import: x',
          '```',
          '',
          'What to do: https://example.test/o/r/blob/abc/docs/runbook.md (失敗(failed)が出たら)',
          '<!-- crawl-alert run=777 -->',
        ].join('\n'),
      },
    ]);
  });
  it('comment bodies carry neither the store marker nor the auto-close line', () => {
    const [a] = planActions([alertVerdict('alpha')], [issue(5, marker('alpha'))], ctx);
    const body = (a as Extract<AlertAction, { type: 'comment' }>).body;
    expect(body).not.toContain('store=alpha');
    expect(body).not.toContain('closed automatically');
    expect(body.startsWith('Still not observed: `quarantined`.')).toBe(true);
  });

  it('skips when this run has already reported in the Issue body', () => {
    const open = [issue(5, `${marker('alpha')}\n<!-- crawl-alert run=777 -->`)];
    expect(planActions([alertVerdict('alpha')], open, ctx)).toEqual([{ type: 'skip', storeId: 'alpha', issue: 5, reason: 'already_reported' }]);
  });
  it('skips when this run has already reported in a comment', () => {
    const open = [issue(5, marker('alpha'), ['other', 'x\n<!-- crawl-alert run=777 -->'])];
    expect(planActions([alertVerdict('alpha')], open, ctx)).toMatchObject([{ type: 'skip', issue: 5 }]);
  });
  it('comments when only another run is recorded', () => {
    const open = [issue(5, marker('alpha'), ['<!-- crawl-alert run=776 -->'])];
    expect(planActions([alertVerdict('alpha')], open, ctx)).toMatchObject([{ type: 'comment', issue: 5 }]);
  });

  it('matches an Issue to a store only by the first line of its body', () => {
    const quoted = issue(4, `Some text\n${marker('alpha')}`);
    expect(planActions([alertVerdict('alpha')], [quoted], ctx)).toMatchObject([{ type: 'create' }]);
    const prefixed = issue(4, `${marker('alpha')} extra`);
    expect(planActions([alertVerdict('alpha')], [prefixed], ctx)).toMatchObject([{ type: 'create' }]);
    expect(planActions([], [quoted], ctx)).toEqual([]);
    expect(planActions([{ storeId: 'alpha', kind: 'observed' }], [quoted], ctx)).toEqual([]);
  });
  it('accepts a CRLF line ending after the marker', () => {
    expect(planActions([alertVerdict('alpha')], [issue(4, `${marker('alpha')}\r\nrest`)], ctx)).toMatchObject([{ type: 'comment', issue: 4 }]);
  });
  it('does not confuse one store id with another that shares its prefix', () => {
    const open = [issue(4, marker('alpha-2'))];
    expect(planActions([alertVerdict('alpha')], open, ctx)).toMatchObject([{ type: 'create' }]);
  });
  it('acts on the lowest-numbered Issue when several are open', () => {
    const open = [issue(9, marker('alpha')), issue(3, marker('alpha')), issue(6, marker('alpha'))];
    expect(planActions([alertVerdict('alpha')], open, ctx)).toMatchObject([{ type: 'comment', issue: 3 }]);
  });
  it('looks for the run marker only in the lowest-numbered Issue', () => {
    const open = [issue(9, `${marker('alpha')}\n<!-- crawl-alert run=777 -->`), issue(3, marker('alpha'))];
    expect(planActions([alertVerdict('alpha')], open, ctx)).toMatchObject([{ type: 'comment', issue: 3 }]);
  });

  it('closes every open Issue of an observed store, each with the comment', () => {
    const open = [issue(8, marker('alpha')), issue(2, marker('alpha')), issue(7, marker('beta'))];
    expect(planActions([{ storeId: 'alpha', kind: 'observed' }], open, ctx)).toEqual([
      { type: 'close', storeId: 'alpha', issue: 2, comment: 'Observed again in https://example.test/o/r/actions/runs/777 (attempt 2). Closing.' },
      { type: 'close', storeId: 'alpha', issue: 8, comment: 'Observed again in https://example.test/o/r/actions/runs/777 (attempt 2). Closing.' },
    ]);
  });
  it('does nothing for an observed store with no open Issue', () => {
    expect(planActions([{ storeId: 'alpha', kind: 'observed' }], [], ctx)).toEqual([]);
  });
  it('neither raises nor clears for a store that was not attempted', () => {
    const open = [issue(5, marker('alpha'))];
    expect(planActions([{ storeId: 'alpha', kind: 'not_attempted' }], open, ctx)).toEqual([]);
    expect(planActions([{ storeId: 'beta', kind: 'not_attempted' }], [], ctx)).toEqual([]);
  });
  it('plans in verdict order and leaves unrelated Issues alone', () => {
    const open = [issue(1, marker('beta')), issue(2, 'unrelated')];
    const actions = planActions([alertVerdict('alpha'), { storeId: 'beta', kind: 'observed' }], open, ctx);
    expect(actions.map((a) => [a.type, a.storeId])).toEqual([
      ['create', 'alpha'],
      ['close', 'beta'],
    ]);
  });
});

function recorder(fail?: (args: readonly string[]) => boolean) {
  const calls: { args: readonly string[]; stdin: string | undefined }[] = [];
  const gh: GhRunner = async (args, stdin) => {
    calls.push({ args, stdin });
    if (fail?.(args)) throw new Error('gh failed');
    return '';
  };
  return { gh, calls };
}

const LABEL_ARGS = ['label', 'create', 'crawl-alert', '--color', 'D93F0B', '--description', 'A store was not observed by the scheduled crawl', '--force'];

describe('applyActions', () => {
  const create = (storeId: string, assignee: string | null = 'octo'): AlertAction => ({
    type: 'create',
    storeId,
    title: `T ${storeId}`,
    body: `B ${storeId}`,
    assignee,
  });

  it('creates the label once, before the first create, then the Issue with the body on stdin', async () => {
    const { gh, calls } = recorder();
    await applyActions([create('alpha'), create('beta')], gh);
    expect(calls).toEqual([
      { args: LABEL_ARGS, stdin: undefined },
      { args: ['issue', 'create', '--title', 'T alpha', '--label', 'crawl-alert', '--body-file', '-', '--assignee', 'octo'], stdin: 'B alpha' },
      { args: ['issue', 'create', '--title', 'T beta', '--label', 'crawl-alert', '--body-file', '-', '--assignee', 'octo'], stdin: 'B beta' },
    ]);
  });
  it('omits --assignee when there is none', async () => {
    const { gh, calls } = recorder();
    await applyActions([create('alpha', null)], gh);
    expect(calls[1]?.args).toEqual(['issue', 'create', '--title', 'T alpha', '--label', 'crawl-alert', '--body-file', '-']);
  });
  it('does not touch the label when nothing is created', async () => {
    const { gh, calls } = recorder();
    await applyActions(
      [
        { type: 'comment', storeId: 'alpha', issue: 4, body: 'C' },
        { type: 'close', storeId: 'beta', issue: 5, comment: 'Done' },
      ],
      gh,
    );
    expect(calls.some((c) => c.args[0] === 'label')).toBe(false);
  });
  it('creates the label only before a create that comes after other actions', async () => {
    const { gh, calls } = recorder();
    await applyActions([{ type: 'comment', storeId: 'alpha', issue: 4, body: 'C' }, create('beta')], gh);
    expect(calls.map((c) => c.args[0])).toEqual(['issue', 'label', 'issue']);
  });
  it('comments with the body on stdin', async () => {
    const { gh, calls } = recorder();
    await applyActions([{ type: 'comment', storeId: 'alpha', issue: 12, body: 'hello' }], gh);
    expect(calls).toEqual([{ args: ['issue', 'comment', '12', '--body-file', '-'], stdin: 'hello' }]);
  });
  it('closes with the comment as an argument and no stdin', async () => {
    const { gh, calls } = recorder();
    await applyActions([{ type: 'close', storeId: 'alpha', issue: 12, comment: 'bye' }], gh);
    expect(calls).toEqual([{ args: ['issue', 'close', '12', '--comment', 'bye'], stdin: undefined }]);
  });
  it('makes no call for a skip', async () => {
    const { gh, calls } = recorder();
    await applyActions([{ type: 'skip', storeId: 'alpha', issue: 3, reason: 'already_reported' }], gh);
    expect(calls).toEqual([]);
  });
  it('stops at the first rejected call and runs nothing after it', async () => {
    const { gh, calls } = recorder((args) => args[0] === 'issue' && args[1] === 'comment');
    await expect(
      applyActions(
        [
          { type: 'close', storeId: 'a', issue: 1, comment: 'c' },
          { type: 'comment', storeId: 'b', issue: 2, body: 'x' },
          { type: 'close', storeId: 'c', issue: 3, comment: 'c' },
        ],
        gh,
      ),
    ).rejects.toThrow('gh failed');
    expect(calls.map((c) => c.args.slice(0, 3))).toEqual([
      ['issue', 'close', '1'],
      ['issue', 'comment', '2'],
    ]);
  });
  it('does not create the Issue when the label call is rejected, and does not retry', async () => {
    const { gh, calls } = recorder((args) => args[0] === 'label');
    await expect(applyActions([create('alpha')], gh)).rejects.toThrow('gh failed');
    expect(calls).toHaveLength(1);
  });
});

describe('listOpenAlerts', () => {
  it('asks gh for the open labelled Issues and maps comments to their bodies', async () => {
    const calls: (readonly string[])[] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      return JSON.stringify([{ number: 3, body: 'b', comments: [{ body: 'c1', author: {} }, { body: 'c2' }] }]);
    };
    expect(await listOpenAlerts(gh)).toEqual([{ number: 3, body: 'b', comments: ['c1', 'c2'] }]);
    expect(calls).toEqual([['issue', 'list', '--state', 'open', '--label', 'crawl-alert', '--limit', '100', '--json', 'number,body,comments']]);
  });
  it('rejects output that is not JSON', async () => {
    await expect(listOpenAlerts(async () => 'not json')).rejects.toThrow(/did not return JSON/);
  });
  it('rejects JSON that is not an array', async () => {
    await expect(listOpenAlerts(async () => '{"a":1}')).rejects.toThrow(/did not return an array/);
    await expect(listOpenAlerts(async () => '"text"')).rejects.toThrow(/did not return an array/);
  });
  it('rejects an issue whose number, body or comments have the wrong shape', async () => {
    await expect(listOpenAlerts(async () => '[{"number":"1","body":"x","comments":[]}]')).rejects.toThrow(/unexpected issue shape/);
    await expect(listOpenAlerts(async () => '[{"number":1,"body":null,"comments":[]}]')).rejects.toThrow(/unexpected issue shape/);
    await expect(listOpenAlerts(async () => '[{"number":1,"body":"x","comments":"none"}]')).rejects.toThrow(/unexpected issue shape/);
    await expect(listOpenAlerts(async () => '[null]')).rejects.toThrow(/unexpected issue shape/);
  });
  it('rejects a comment whose body is not a string', async () => {
    await expect(listOpenAlerts(async () => '[{"number":1,"body":"x","comments":[{"body":5}]}]')).rejects.toThrow(/unexpected comment shape/);
    await expect(listOpenAlerts(async () => '[{"number":1,"body":"x","comments":[null]}]')).rejects.toThrow(/unexpected comment shape/);
  });
  it('returns an empty list for an empty array', async () => {
    expect(await listOpenAlerts(async () => '[]')).toEqual([]);
  });
});
