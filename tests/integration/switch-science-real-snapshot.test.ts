import { describe, expect, it } from 'vitest';
import { SWITCH_SCIENCE_CAPABILITIES } from '../../src/adapters/switch-science/capabilities.ts';
import { validateSwitchScienceRaw } from '../../src/adapters/switch-science/snapshotAdapter.ts';
import { pricePointOf } from '../../src/core/price.ts';
import { sanityCheck } from '../../src/core/sanity.ts';
import { openInMemory } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { countRows, dumpStore } from '../helpers/dbDump.ts';
import { loadSwitchScienceNormalized, loadSwitchScienceRaw } from '../helpers/fixtures.ts';

/**
 * A 60-product cut of the real 2026-09-07 Switch Science crawl (see the fixture
 * directory's README). Expected values were read off the store's own pages and
 * recomputed from the raw JSON, not from the adapter's output.
 */
describe('Switch Science real snapshot: adapter', () => {
  it('validates with no errors, and only the warnings the catalogue really earns', async () => {
    const raw = await loadSwitchScienceRaw();
    const r = validateSwitchScienceRaw(raw.json);
    expect(r.errors).toEqual([]);
    // The store genuinely lists these four at ¥0 — 3589 renders "¥0（税込）" with
    // a sold-out badge — so they are reported, not rejected.
    expect(r.warnings.map((w) => w.subject)).toEqual(['11359', '3518', '3589', 'rpicm-pl']);
    expect(new Set(r.warnings.map((w) => w.code))).toEqual(new Set(['variant.price_zero']));
    expect(r.metrics).toMatchObject({
      itemCount: 60,
      variantCount: 60,
      catalogProductTotal: 60,
      catalogUncovered: 0,
      catalogUnlisted: 0,
      multiVariant: 0,
      missingSku: 0,
      unparsablePrice: 0,
      collectorWarnings: 0,
    });
  });

  it('normalizes every product to one variant offer with a single tax-included quote', async () => {
    const n = await loadSwitchScienceNormalized();
    expect(n.storeId).toBe('switch-science');
    expect(n.complete).toBe(true);
    expect(n.products).toHaveLength(60);
    expect(n.observedAt).toBe('2026-09-07T00:05:56.401Z');
    expect(n.coverageId).toBe('shopify:collections/all');
    expect(n.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(n.normalizedHash).toMatch(/^[0-9a-f]{64}$/);

    for (const p of n.products) {
      expect(p.externalProductId, p.externalProductId).toBe(p.pageKey);
      expect(p.metadata.canonicalUrl).toBe(`https://www.switch-science.com/products/${p.pageKey}`);
      expect(p.offers, p.pageKey).toHaveLength(1);
      const offer = p.offers[0]!;
      expect(offer.offerKind).toBe('variant');
      // The variant id, not the product id: it is what a price belongs to.
      expect(offer.externalOfferId).toMatch(/^\d{14}$/);
      // Every product in this catalogue has one unnamed "Default Title" variant,
      // which is a naming artefact, not a variant name a reader should see.
      expect(offer.variantName).toBeNull();
      expect(offer.priceQuotes, p.pageKey).toHaveLength(1);
      expect(offer.priceQuotes[0]).toMatchObject({ quoteKind: 'selling', taxTreatment: 'tax_included', currency: 'JPY', unitLabel: null });
      expect(offer.availability.quantitySemantics).toBe('not_exposed');
      expect(offer.availability.quantity).toBeNull();
    }
  });

  it('reproduces prices and stock read off the live pages', async () => {
    const by = new Map((await loadSwitchScienceNormalized()).products.map((p) => [p.externalProductId, p]));
    const quote = (id: string) => by.get(id)!.offers[0]!.priceQuotes[0]!;
    const stock = (id: string) => by.get(id)!.offers[0]!.availability;

    // ArduCAM 22-pin camera cable: ¥165 tax included, in stock.
    expect(by.get('9381')!.metadata.name).toBe('0.5 mmピッチ22ピン to 22ピンカメラケーブル（150 mm）');
    expect(pricePointOf(quote('9381'))).toMatchObject({ state: 'exact', minAmountMinor: 165, maxAmountMinor: 165 });
    expect(stock('9381')).toMatchObject({ state: 'in_stock', purchasable: true, rawStatus: null });

    // The most expensive thing in the catalogue, and discontinued: ¥8,910,000.
    expect(pricePointOf(quote('8680')).minAmountMinor).toBe(8_910_000);
    expect(stock('8680')).toMatchObject({ state: 'out_of_stock', purchasable: false });

    // A discontinued kit priced at ¥0. Zero is the store's own number, so the
    // quote is `exact 0` — not `unavailable`, which would erase the fact.
    expect(pricePointOf(quote('3589'))).toMatchObject({ state: 'exact', minAmountMinor: 0, maxAmountMinor: 0 });
    expect(stock('3589').purchasable).toBe(false);
    // ...and a ¥0 product that is still purchasable: a price-list placeholder.
    expect(pricePointOf(quote('rpicm-pl')).minAmountMinor).toBe(0);
    expect(stock('rpicm-pl').purchasable).toBe(true);

    // The handle is the identity; the SKU can differ in case and is kept as an alias.
    expect(by.get('rpicm-pl')!.aliases).toEqual([
      { kind: 'handle', value: 'rpicm-pl' },
      { kind: 'shopifyProductId', value: '8511295717574' },
      { kind: 'sku', value: 'RPICM-PL' },
    ]);
    expect(by.get('rpicm-pl')!.metadata.modelNumber).toBe('RPICM-PL');

    // Shopify sends no category on this storefront; it is absent, never guessed.
    expect(new Set([...by.values()].map((p) => p.metadata.category))).toEqual(new Set([null]));

    const states = [...by.values()].map((p) => p.offers[0]!.availability.state);
    expect(states.filter((s) => s === 'in_stock')).toHaveLength(23);
    expect(states.filter((s) => s === 'out_of_stock')).toHaveLength(37);
  });

  it('passes the sanity check: a ¥0 price is a price, so nothing counts as unavailable', async () => {
    const n = await loadSwitchScienceNormalized();
    const r = sanityCheck(n, null);
    expect(r.errors).toEqual([]);
    expect(r.metrics).toMatchObject({ itemCount: 60, unavailablePriceCount: 0 });
  });
});

describe('Switch Science real snapshot through SQLite', () => {
  it('imports once into a store-scoped history and is a no-op on re-import', async () => {
    const n = await loadSwitchScienceNormalized();
    const db = openInMemory();
    migrate(db);

    const s = importSnapshot(db, n, { capabilities: SWITCH_SCIENCE_CAPABILITIES });
    expect(s.status).toBe('imported');
    expect(s.productsNew).toBe(60);
    expect(s.productsAbsent).toBe(0);
    expect(s.changedPricePoints).toBe(60);
    expect(s.outOfOrder).toBe(false);
    expect(countRows(db, 'products')).toBe(60);
    expect(countRows(db, 'price_events')).toBe(60);
    expect(countRows(db, 'crawl_runs')).toBe(1);

    const history = readStoreHistory(db, 'switch-science');
    const cable = history.products.find((p) => p.externalProductId === '9381')!;
    expect(cable.metadata).toHaveLength(1);
    expect(cable.metadata[0]!.state.name).toBe('0.5 mmピッチ22ピン to 22ピンカメラケーブル（150 mm）');
    expect(cable.metadata[0]!.t).toBe(Date.parse('2026-09-07T00:05:56.401Z'));
    expect(cable.offers[0]!.bases[0]!.prices).toHaveLength(1);
    expect(cable.offers[0]!.bases[0]!.prices[0]!.state).toMatchObject({ minAmountMinor: 165, state: 'exact' });

    const before = dumpStore(db, 'switch-science');
    expect(importSnapshot(db, n, { capabilities: SWITCH_SCIENCE_CAPABILITIES }).status).toBe('already_imported');
    expect(dumpStore(db, 'switch-science')).toBe(before);
  });

  it('keeps two stores apart in one database', async () => {
    const ss = await loadSwitchScienceNormalized();
    const db = openInMemory();
    migrate(db);
    importSnapshot(db, ss, { capabilities: SWITCH_SCIENCE_CAPABILITIES });

    // Handles like `280` are also plausible Akizuki page keys, so identity is
    // (store_id, external_product_id): the shared database knows only the store
    // that was imported, and reading another one is an error, not empty history.
    expect(readStoreHistory(db, 'switch-science').products).toHaveLength(60);
    expect(() => readStoreHistory(db, 'akizuki')).toThrow(/store akizuki is not present/);
  });
});
