import { describe, expect, it } from 'vitest';
import { RUN_BUDGET_WARN_RATIO, runBudget } from '../../scripts/run-budget.ts';

const MIN = 60;

describe('runBudget', () => {
  it('uses 80 % as the default ratio', () => {
    expect(RUN_BUDGET_WARN_RATIO).toBe(0.8);
    expect(runBudget({ elapsedSeconds: 0, limitMinutes: 240 }).warnAboveMinutes).toBe(192);
  });
  it('does not warn at exactly the mark', () => {
    const b = runBudget({ elapsedSeconds: 192 * MIN, limitMinutes: 240 });
    expect(b.overThreshold).toBe(false);
    expect(b.warning).toBeNull();
  });
  it('warns one second above the mark', () => {
    const b = runBudget({ elapsedSeconds: 192 * MIN + 1, limitMinutes: 240 });
    expect(b.overThreshold).toBe(true);
    expect(b.warning).not.toBeNull();
  });
  it('rounds elapsed minutes up and the percentage to the nearest integer', () => {
    const b = runBudget({ elapsedSeconds: 61, limitMinutes: 240 });
    expect(b.elapsedMinutes).toBe(2);
    expect(runBudget({ elapsedSeconds: 60, limitMinutes: 240 }).elapsedMinutes).toBe(1);
    expect(runBudget({ elapsedSeconds: 0, limitMinutes: 240 }).elapsedMinutes).toBe(0);
    // 100 min of 240 = 41.67 %, 99 min = 41.25 %
    expect(runBudget({ elapsedSeconds: 100 * MIN, limitMinutes: 240 }).percent).toBe(42);
    expect(runBudget({ elapsedSeconds: 99 * MIN, limitMinutes: 240 }).percent).toBe(41);
  });
  it('renders the Markdown summary exactly', () => {
    const b = runBudget({ elapsedSeconds: 100 * MIN, limitMinutes: 240 });
    expect(b.summary).toBe(
      "### Run length\n\n100 min of the job's 240-minute limit (42 %). A warning is raised above 192 min.\n",
    );
  });
  it('renders the warning annotation exactly', () => {
    const b = runBudget({ elapsedSeconds: 200 * MIN, limitMinutes: 240 });
    expect(b.warning).toBe(
      '::warning title=Run length near the limit::200 min of the 240-minute job limit (83 %), above the 192-minute mark. See docs/runbook.md before the job starts being cancelled.',
    );
  });
  it('honours a custom ratio, and accepts 1', () => {
    expect(runBudget({ elapsedSeconds: 51 * MIN, limitMinutes: 100, warnRatio: 0.5 }).overThreshold).toBe(true);
    expect(runBudget({ elapsedSeconds: 50 * MIN, limitMinutes: 100, warnRatio: 0.5 }).overThreshold).toBe(false);
    expect(runBudget({ elapsedSeconds: 100 * MIN, limitMinutes: 100, warnRatio: 1 }).overThreshold).toBe(false);
    expect(runBudget({ elapsedSeconds: 100 * MIN + 1, limitMinutes: 100, warnRatio: 1 }).overThreshold).toBe(true);
  });
  it('rejects invalid elapsed seconds', () => {
    for (const elapsedSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => runBudget({ elapsedSeconds, limitMinutes: 240 })).toThrow(/invalid elapsedSeconds/);
    }
  });
  it('rejects invalid limits', () => {
    for (const limitMinutes of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => runBudget({ elapsedSeconds: 1, limitMinutes })).toThrow(/invalid limitMinutes/);
    }
  });
  it('rejects ratios outside (0, 1]', () => {
    for (const warnRatio of [0, -0.1, 1.01, Number.NaN]) {
      expect(() => runBudget({ elapsedSeconds: 1, limitMinutes: 240, warnRatio })).toThrow(/invalid warnRatio/);
    }
  });
  it('accepts zero elapsed seconds', () => {
    expect(() => runBudget({ elapsedSeconds: 0, limitMinutes: 240 })).not.toThrow();
  });
});
