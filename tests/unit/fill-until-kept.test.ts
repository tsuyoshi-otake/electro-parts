import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FILL_ROUNDS, fillUntilKept } from '../../scripts/lib/fill-until-kept.ts';

type Field = 'description' | 'purpose' | 'storage' | 'host';
const FIELDS: readonly Field[] = ['description', 'purpose', 'storage', 'host'];

/**
 * A stand-in dashboard: `held` is what each field holds on the server. `onPut`
 * decides what a put does to the server, so a test can make a save stick, be
 * ignored, or undo another field.
 */
function dashboard(held: Record<Field, boolean>, onPut: (field: Field, held: Record<Field, boolean>, putsOfField: number) => void) {
  const log: string[] = [];
  const puts = new Map<Field, number>();
  return {
    log, puts, held,
    io: {
      async put(field: Field) {
        puts.set(field, (puts.get(field) ?? 0) + 1);
        log.push(`put ${field}`);
        onPut(field, held, puts.get(field)!);
      },
      async kept(field: Field) {
        log.push(`read ${field}`);
        return held[field];
      },
    },
  };
}

const sticks = (field: Field, held: Record<Field, boolean>) => { held[field] = true; };
const allStale = (): Record<Field, boolean> => ({ description: false, purpose: false, storage: false, host: false });

describe('fillUntilKept', () => {
  it('does not touch a dashboard that already holds every text', async () => {
    const d = dashboard({ description: true, purpose: true, storage: true, host: true }, sticks);
    expect(await fillUntilKept(FIELDS, d.io)).toEqual([]);
    expect(d.log).toEqual(['read description', 'read purpose', 'read storage', 'read host']);
  });

  it('puts only the fields that are not kept, in order, and reads every field back after the puts', async () => {
    const d = dashboard({ description: true, purpose: false, storage: true, host: false }, sticks);
    expect(await fillUntilKept(FIELDS, d.io)).toEqual([]);
    expect(d.log).toEqual([
      'read description', 'read purpose', 'read storage', 'read host',
      'put purpose', 'put host',
      'read description', 'read purpose', 'read storage', 'read host',
    ]);
  });

  it('puts a field again when a later save undid it, and nothing else', async () => {
    // Saving `storage` the first time puts `purpose` back to its old text (a save landing out of order).
    const d = dashboard(allStale(), (field, held, n) => {
      held[field] = true;
      if (field === 'storage' && n === 1) held.purpose = false;
    });
    expect(await fillUntilKept(FIELDS, d.io)).toEqual([]);
    expect([...d.puts]).toEqual([['description', 1], ['purpose', 2], ['storage', 1], ['host', 1]]);
  });

  it('reads back a field that was already kept too, because another field\'s save can undo it', async () => {
    // `description` holds its text at the start and is not put; saving `purpose` the first time puts it back to the old text.
    const d = dashboard({ description: true, purpose: false, storage: true, host: true }, (field, held, n) => {
      held[field] = true;
      if (field === 'purpose' && n === 1) held.description = false;
    });
    expect(await fillUntilKept(FIELDS, d.io)).toEqual([]);
    expect([...d.puts]).toEqual([['purpose', 1], ['description', 1]]);
    expect(d.held).toEqual({ description: true, purpose: true, storage: true, host: true });
  });

  it('gives up after the rounds it was given and names what is still not kept', async () => {
    const d = dashboard(allStale(), (field, held) => { if (field !== 'storage') held[field] = true; });
    expect(await fillUntilKept(FIELDS, d.io)).toEqual(['storage']);
    expect(d.puts.get('storage')).toBe(FILL_ROUNDS);
    expect(d.puts.get('host')).toBe(1);
    expect(await fillUntilKept(FIELDS, dashboard(allStale(), () => {}).io, 1)).toEqual([...FIELDS]);
  });

  it('puts nothing when it is given no rounds', async () => {
    const d = dashboard(allStale(), sticks);
    expect(await fillUntilKept(FIELDS, d.io, 0)).toEqual([...FIELDS]);
    expect(d.puts.size).toBe(0);
  });

  it('property: a field is put once more for each save that is ignored, at most once per round, and is reported only when it never sticks', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ description: fc.nat(5), purpose: fc.nat(5), storage: fc.nat(5), host: fc.nat(5) }),
      fc.integer({ min: 1, max: 5 }),
      async (ignored, rounds) => {
        // `ignored[f]` puts of the field are ignored before one sticks.
        const d = dashboard(allStale(), (field, held, n) => { if (n > ignored[field]) held[field] = true; });
        const unkept = await fillUntilKept(FIELDS, d.io, rounds);
        for (const f of FIELDS) {
          expect(d.puts.get(f) ?? 0, f).toBe(Math.min(ignored[f] + 1, rounds));
          expect(unkept.includes(f), f).toBe(ignored[f] >= rounds);
        }
      },
    ));
  });
});
