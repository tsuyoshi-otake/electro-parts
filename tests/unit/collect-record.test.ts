import { describe, expect, it } from 'vitest';
import { applyCollectRecord, COLLECT_RECORD_VERSION, parseCollectRecord, snapshotFileName, type CollectRecord } from '../../src/pipeline/collect.ts';
import { newReport } from '../../src/pipeline/report.ts';

const SHA = 'a'.repeat(64);

const record = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  recordVersion: 1,
  storeId: 'alpha',
  snapshotFile: 'alpha-2026-11-01T03-00-00-000Z.json.gz',
  rawSha256: SHA,
  bytes: 1234,
  retrievedAt: '2026-11-01T03:00:00.000Z',
  complete: true,
  errors: [],
  warnings: ['one'],
  metrics: { items: 5, pages: 2 },
  startedAt: '2026-11-01T02:00:00.000Z',
  durationMs: 3_600_000,
  ...over,
});

const without = (field: string): Record<string, unknown> => {
  const r = record();
  delete r[field];
  return r;
};

describe('parseCollectRecord', () => {
  it('returns a valid record field for field', () => {
    expect(parseCollectRecord(record())).toEqual(record());
    expect(COLLECT_RECORD_VERSION).toBe(1);
  });

  it('keeps only the known fields', () => {
    expect(parseCollectRecord(record({ extra: 1 }))).not.toHaveProperty('extra');
  });

  it.each([[null], ['text'], [3], [[]], [undefined]])('rejects a non-object (%j)', (value) => {
    expect(() => parseCollectRecord(value)).toThrow('collect record: the record is not an object');
  });

  it.each([
    ['recordVersion', 2],
    ['recordVersion', '1'],
    ['storeId', ''],
    ['storeId', 7],
    ['snapshotFile', ''],
    ['snapshotFile', 'dir/alpha.json.gz'],
    ['snapshotFile', 'dir\\alpha.json.gz'],
    ['snapshotFile', '/alpha.json.gz'],
    ['rawSha256', SHA.toUpperCase()],
    ['rawSha256', `${SHA}a`],
    ['rawSha256', `x${SHA}`],
    ['rawSha256', SHA.slice(1)],
    ['rawSha256', `${'a'.repeat(63)}g`],
    ['rawSha256', 'abc'],
    ['rawSha256', 5],
    ['bytes', -1],
    ['bytes', 1.5],
    ['bytes', '10'],
    ['bytes', Number.MAX_SAFE_INTEGER + 1],
    ['bytes', null],
    ['retrievedAt', '2026-11-01 03:00:00'],
    ['retrievedAt', '2026-11-01T03:00:00'],
    ['retrievedAt', 3],
    ['complete', 'yes'],
    ['complete', 1],
    ['errors', 'boom'],
    ['errors', [1]],
    ['warnings', 'w'],
    ['warnings', [null]],
    ['metrics', []],
    ['metrics', null],
    ['metrics', { items: '5' }],
    ['metrics', { items: Number.NaN }],
    ['metrics', { items: Number.POSITIVE_INFINITY }],
    ['metrics', { items: null }],
    ['metrics', { items: [1] }],
    ['startedAt', 'yesterday'],
    ['startedAt', 0],
    ['durationMs', -1],
    ['durationMs', '5'],
    ['durationMs', null],
    ['durationMs', Number.POSITIVE_INFINITY],
  ])('rejects %s = %j and names the field, with the reason', (field, value) => {
    expect(() => parseCollectRecord(record({ [field]: value }))).toThrow(new RegExp(`^collect record: ${field} must be \\S`));
  });

  it.each(['recordVersion', 'storeId', 'snapshotFile', 'rawSha256', 'bytes', 'retrievedAt', 'complete', 'errors', 'warnings', 'metrics', 'startedAt', 'durationMs'])(
    'rejects a record without %s',
    (field) => {
      expect(() => parseCollectRecord(without(field))).toThrow(new RegExp(`^collect record: ${field} must be \\S`));
    },
  );

  it('rejects a snapshot file name with a directory, whichever separator it uses', () => {
    expect(() => parseCollectRecord(record({ snapshotFile: 'a/b.json.gz' }))).toThrow('collect record: snapshotFile must be a base name without a directory');
    expect(() => parseCollectRecord(record({ snapshotFile: 'a\\b.json.gz' }))).toThrow('collect record: snapshotFile must be a base name without a directory');
    expect(parseCollectRecord(record({ snapshotFile: 'alpha.json.gz' })).snapshotFile).toBe('alpha.json.gz');
  });

  it('accepts the boundaries: zero and the largest safe byte count, zero duration, an offset timestamp, empty metrics', () => {
    const parsed = parseCollectRecord(record({ bytes: 0, durationMs: 0, startedAt: '2026-11-01T11:00:00+09:00', metrics: {} }));
    expect(parsed).toMatchObject({ bytes: 0, durationMs: 0, startedAt: '2026-11-01T11:00:00+09:00', metrics: {} });
    expect(parseCollectRecord(record({ bytes: Number.MAX_SAFE_INTEGER })).bytes).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('accepts a sha256 of exactly 64 lowercase hex characters', () => {
    expect(parseCollectRecord(record({ rawSha256: `0123456789abcdef${'0'.repeat(48)}` })).rawSha256).toHaveLength(64);
  });
});

describe('applyCollectRecord', () => {
  const parsed = (over: Record<string, unknown> = {}): CollectRecord => parseCollectRecord(record(over));

  it('copies the metrics, completeness, error count, size and hash into the stage details', () => {
    const report = newReport('alpha', () => new Date(0));
    const details: Record<string, unknown> = { kept: 'yes' };
    applyCollectRecord(report, details, parsed({ complete: false, errors: ['e1', 'e2'], bytes: 99 }));
    expect(details).toEqual({ kept: 'yes', items: 5, pages: 2, complete: false, errors: 2, bytes: 99, rawSha256: SHA });
  });

  it('lets the record win over a metric of the same name, as the live stage always did', () => {
    const details: Record<string, unknown> = {};
    applyCollectRecord(newReport('alpha', () => new Date(0)), details, parsed({ metrics: { complete: 7, errors: 7, bytes: 7 }, bytes: 4 }));
    expect(details).toMatchObject({ complete: true, errors: 0, bytes: 4 });
  });

  it('adds the warnings then the errors, with the prefixes the alert script reads, after what the report holds', () => {
    const report = newReport('alpha', () => new Date(0));
    report.warnings.push('earlier');
    applyCollectRecord(report, {}, parsed({ warnings: ['w1', 'w2'], errors: ['e1'] }));
    expect(report.warnings).toEqual(['earlier', 'collect: w1', 'collect: w2', 'collect error: e1']);
  });

  it('adds nothing to the warnings for a clean collection', () => {
    const report = newReport('alpha', () => new Date(0));
    applyCollectRecord(report, {}, parsed({ warnings: [], errors: [] }));
    expect(report.warnings).toEqual([]);
  });
});

describe('snapshotFileName', () => {
  it('replaces the colons and the dot of the timestamp so the name is valid on every file system', () => {
    expect(snapshotFileName('alpha', '2026-11-01T03:00:00.123Z')).toBe('alpha-2026-11-01T03-00-00-123Z.json.gz');
  });
});
