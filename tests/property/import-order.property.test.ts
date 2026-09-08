import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reduceInOrder } from '../../src/core/history.ts';
import { openInMemory } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { dumpStore } from '../helpers/dbDump.ts';
import { day, dayMs, SYNTHETIC_CAPABILITIES, syntheticSnapshot, type SyntheticProduct } from '../helpers/synthetic.ts';

const seed = Number(process.env['FC_SEED'] ?? 20260906);
const numRuns = Number(process.env['FC_RUNS'] ?? 60);
const params = { seed, numRuns, verbose: true } as const;

const PRODUCT_IDS = ['p1', 'p2', 'p3'] as const;

interface ProductState {
  price: number;
  unit: string;
  availability: 'in_stock' | 'out_of_stock' | 'low_stock';
  quantity: number | null;
  name: string;
}
type RunStates = [ProductState | null, ProductState | null, ProductState | null];

/** One product's state in one run, or absent. */
const productStateArb: fc.Arbitrary<ProductState | null> = fc.option(
  fc.record({
    price: fc.constantFrom(100, 120, 150),
    unit: fc.constantFrom('1個', '1袋'),
    availability: fc.constantFrom('in_stock', 'out_of_stock', 'low_stock') as fc.Arbitrary<'in_stock' | 'out_of_stock' | 'low_stock'>,
    quantity: fc.constantFrom<number | null>(null, 0, 5, 9),
    name: fc.constantFrom('A', 'B'),
  }),
  { nil: null },
);

/** A run: for each product either absent or a state. At least one product present. */
const runArb: fc.Arbitrary<RunStates> = fc
  .tuple(productStateArb, productStateArb, productStateArb)
  .filter((states) => states.some((s) => s !== null));

const timelineArb: fc.Arbitrary<RunStates[]> = fc.array(runArb, { minLength: 1, maxLength: 7 });

function permutationArb(n: number) {
  return fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n });
}

function snapshotFor(runIndex: number, states: RunStates) {
  const products: SyntheticProduct[] = [];
  states.forEach((s, i) => {
    if (s === null) return;
    products.push({ id: PRODUCT_IDS[i]!, price: s.price, unit: s.unit, availability: s.availability, quantity: s.quantity, name: s.name });
  });
  return syntheticSnapshot(day(runIndex), products);
}

function build(timeline: RunStates[], order: number[]) {
  const db = openInMemory();
  migrate(db);
  for (const i of order) importSnapshot(db, snapshotFor(i, timeline[i]!), { capabilities: SYNTHETIC_CAPABILITIES });
  return db;
}

describe('SQLite import is order independent', () => {
  it('any import permutation yields the same database content as chronological import', () => {
    fc.assert(
      fc.property(
        timelineArb.chain((tl) => fc.tuple(fc.constant(tl), permutationArb(tl.length))),
        ([timeline, order]) => {
          const chronological = dumpStore(build(timeline, [...Array(timeline.length).keys()]), 'synthetic');
          const permuted = dumpStore(build(timeline, order), 'synthetic');
          expect(permuted).toBe(chronological);
        },
      ),
      params,
    );
  });

  it('chronological import matches the naive oracle for presence, prices and availability', () => {
    fc.assert(
      fc.property(timelineArb, (timeline) => {
        const db = build(timeline, [...Array(timeline.length).keys()]);
        const history = readStoreHistory(db, 'synthetic');
        PRODUCT_IDS.forEach((id, pi) => {
          const product = history.products.find((p) => p.externalProductId === id);
          const observations = timeline
            .map((run, ri) => ({ t: dayMs(ri), state: run[pi] }))
            .filter((o) => o.state !== null) as { t: number; state: ProductState }[];
          if (observations.length === 0) {
            expect(product).toBeUndefined();
            return;
          }
          expect(product).toBeDefined();
          // presence: known from first sighting onwards
          const firstT = observations[0]!.t;
          const presenceObs = timeline
            .map((run, ri) => ({ t: dayMs(ri), state: run[pi] !== null }))
            .filter((o) => o.t >= firstT);
          expect(product!.presence).toEqual(reduceInOrder(presenceObs, (a, b) => a === b));
          // availability (per offer, over present runs)
          const availObs = observations.map((o) => ({
            t: o.t,
            state: { state: o.state.availability, purchasable: true, quantitySemantics: o.state.quantity === null ? 'unknown' : 'site_reported', rawStatus: null },
          }));
          expect(product!.offers[0]!.availability).toEqual(
            reduceInOrder(availObs, (a, b) => a.state === b.state && a.quantitySemantics === b.quantitySemantics),
          );
          // inventory
          const invObs = observations.map((o) => ({ t: o.t, state: o.state.quantity }));
          expect(product!.offers[0]!.inventory).toEqual(reduceInOrder(invObs, (a, b) => a === b));
          // prices per unit basis
          for (const unit of ['1個', '1袋']) {
            const basis = product!.offers[0]!.bases.find((b) => b.basis.unitLabel === unit);
            const obs = observations.filter((o) => o.state.unit === unit).map((o) => ({ t: o.t, state: o.state.price }));
            if (obs.length === 0) {
              expect(basis).toBeUndefined();
              continue;
            }
            expect(basis!.prices.map((p) => ({ t: p.t, state: p.state.minAmountMinor }))).toEqual(reduceInOrder(obs, (a, b) => a === b));
            const basisPresenceObs = observations.map((o) => ({ t: o.t, state: o.state.unit === unit })).filter((o) => o.t >= obs[0]!.t);
            expect(basis!.presence).toEqual(reduceInOrder(basisPresenceObs, (a, b) => a === b));
          }
          // metadata
          const metaObs = observations.map((o) => ({ t: o.t, state: o.state.name }));
          expect(product!.metadata.map((m) => ({ t: m.t, state: m.state.name }))).toEqual(reduceInOrder(metaObs, (a, b) => a === b));
        });
      }),
      params,
    );
  });

  it('keeps offer attributes from the newest observation in every import permutation', () => {
    fc.assert(
      fc.property(permutationArb(3), (order) => {
        const snapshots = [
          syntheticSnapshot(day(0), [{ id: 'p1', sku: 'old', variantName: 'Old name' }]),
          syntheticSnapshot(day(1), [{ id: 'p1', sku: null, variantName: null }]),
          syntheticSnapshot(day(2), [{ id: 'p1', sku: 'new', variantName: 'New name' }]),
        ];
        const db = openInMemory();
        migrate(db);
        for (const index of order) importSnapshot(db, snapshots[index]!, { capabilities: SYNTHETIC_CAPABILITIES });
        const offer = readStoreHistory(db, 'synthetic').products[0]!.offers[0]!;
        expect(offer).toMatchObject({ sku: 'new', variantName: 'New name' });
      }),
      params,
    );
  });
});
