import { describe, expect, it } from 'vitest';
import {
  assertSeriesInvariants,
  expandPresentRuns,
  insertObservation,
  canonicalPresence,
  insertPresence,
  reduceInOrder,
  SeriesConflictError,
  stateAt,
  type ChangePoint,
} from '../../src/core/history.ts';

const eq = (a: string, b: string) => a === b;

function importAll(observations: ChangePoint<string>[], order: number[]): ChangePoint<string>[] {
  let series: ChangePoint<string>[] = [];
  const imported: number[] = [];
  for (const i of order) {
    const obs = observations[i] as ChangePoint<string>;
    const runs = imported.slice().sort((a, b) => a - b);
    series = insertObservation(series, obs, runs, eq).series;
    imported.push(obs.t);
    assertSeriesInvariants(series, eq);
  }
  return series;
}

describe('insertObservation', () => {
  it('compresses unchanged observations into a single change point', () => {
    const obs = [1, 2, 3, 4, 5].map((t) => ({ t, state: 'A' }));
    expect(importAll(obs, [0, 1, 2, 3, 4])).toEqual([{ t: 1, state: 'A' }]);
  });

  it('records a change point when the state changes', () => {
    const obs = [
      { t: 1, state: 'A' },
      { t: 2, state: 'A' },
      { t: 3, state: 'B' },
      { t: 4, state: 'B' },
    ];
    expect(importAll(obs, [0, 1, 2, 3])).toEqual([
      { t: 1, state: 'A' },
      { t: 3, state: 'B' },
    ]);
  });

  it('splits an existing span when an older observation with a different state arrives (A,B,A)', () => {
    // True history: t1 A, t3 B, t5 A. Import t1, t5 first (compressed to [t1 A]), then t3 B.
    const obs = [
      { t: 1, state: 'A' },
      { t: 3, state: 'B' },
      { t: 5, state: 'A' },
    ];
    expect(importAll(obs, [0, 2, 1])).toEqual(reduceInOrder(obs, eq));
    expect(importAll(obs, [2, 0, 1])).toEqual(reduceInOrder(obs, eq));
  });

  it('places the return change point at the next observed run, not at the last one', () => {
    // t1 A, t2 A, t3 B, t4 A, t5 A ; import order 1,2,4,5,3
    const obs = [1, 2, 3, 4, 5].map((t) => ({ t, state: t === 3 ? 'B' : 'A' }));
    const result = importAll(obs, [0, 1, 3, 4, 2]);
    expect(result).toEqual([
      { t: 1, state: 'A' },
      { t: 3, state: 'B' },
      { t: 4, state: 'A' },
    ]);
  });

  it('merges with the following change point when the state starts earlier than known', () => {
    const obs = [
      { t: 1, state: 'A' },
      { t: 2, state: 'B' },
      { t: 3, state: 'B' },
    ];
    // import t1, t3 then t2
    expect(importAll(obs, [0, 2, 1])).toEqual([
      { t: 1, state: 'A' },
      { t: 2, state: 'B' },
    ]);
  });

  it('inserts before the head and merges when equal', () => {
    const obs = [
      { t: 1, state: 'B' },
      { t: 2, state: 'B' },
    ];
    expect(importAll(obs, [1, 0])).toEqual([{ t: 1, state: 'B' }]);
    const obs2 = [
      { t: 1, state: 'A' },
      { t: 2, state: 'B' },
    ];
    expect(importAll(obs2, [1, 0])).toEqual([
      { t: 1, state: 'A' },
      { t: 2, state: 'B' },
    ]);
  });

  it('is idempotent for repeated observations', () => {
    const base = [
      { t: 1, state: 'A' },
      { t: 2, state: 'B' },
    ];
    const r = insertObservation(base, { t: 2, state: 'B' }, [1], eq);
    expect(r.changed).toBe(false);
    expect(r.series).toEqual(base);
  });

  it('rejects a conflicting state at an existing time', () => {
    const base = [{ t: 1, state: 'A' }];
    expect(() => insertObservation(base, { t: 1, state: 'B' }, [], eq)).toThrow(SeriesConflictError);
  });

  it('reports changed=false when the observation matches the surrounding span', () => {
    const base = [
      { t: 1, state: 'A' },
      { t: 5, state: 'B' },
    ];
    const r = insertObservation(base, { t: 3, state: 'A' }, [1, 5], eq);
    expect(r.changed).toBe(false);
  });
});

describe('insertPresence', () => {
  it('keeps a leading absent observation in storage but trims it in the canonical view', () => {
    // Runs 1 and 2 exist; the product was first seen in run 3. Later, run 1
    // reports it absent. That is real information: if run 0 is imported
    // afterwards with the product present, the gap at run 1 must survive.
    const r = insertPresence([{ t: 3, state: true }], { t: 1, state: false }, [2, 3]);
    expect(r.changed).toBe(true);
    expect(r.series).toEqual([
      { t: 1, state: false },
      { t: 3, state: true },
    ]);
    expect(canonicalPresence(r.series)).toEqual([{ t: 3, state: true }]);
    const later = insertPresence(r.series, { t: 0, state: true }, [1, 2, 3]);
    expect(later.series).toEqual([
      { t: 0, state: true },
      { t: 1, state: false },
      { t: 3, state: true },
    ]);
  });

  it('stores absent on an empty series and canonicalizes to empty', () => {
    const s = insertPresence([], { t: 1, state: false }, []).series;
    expect(s).toEqual([{ t: 1, state: false }]);
    expect(canonicalPresence(s)).toEqual([]);
  });

  it('records absence after presence and presence again', () => {
    let s = insertPresence([], { t: 1, state: true }, []).series;
    s = insertPresence(s, { t: 2, state: false }, [1]).series;
    s = insertPresence(s, { t: 3, state: true }, [1, 2]).series;
    expect(s).toEqual([
      { t: 1, state: true },
      { t: 2, state: false },
      { t: 3, state: true },
    ]);
  });
});

describe('expandPresentRuns / stateAt', () => {
  it('expands presence spans over run times', () => {
    const presence = [
      { t: 2, state: true },
      { t: 4, state: false },
      { t: 6, state: true },
    ];
    expect(expandPresentRuns(presence, [1, 2, 3, 4, 5, 6, 7])).toEqual([2, 3, 6, 7]);
  });

  it('stateAt returns the state in effect', () => {
    const s = [
      { t: 2, state: 'A' },
      { t: 4, state: 'B' },
    ];
    expect(stateAt(s, 1)).toBeUndefined();
    expect(stateAt(s, 2)).toBe('A');
    expect(stateAt(s, 3)).toBe('A');
    expect(stateAt(s, 4)).toBe('B');
    expect(stateAt(s, 99)).toBe('B');
  });
});
