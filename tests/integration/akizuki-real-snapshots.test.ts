import { describe, expect, it } from 'vitest';
import { validateAkizukiRaw } from '../../src/adapters/akizuki/snapshotAdapter.ts';
import { comparePrices, pricePointOf } from '../../src/core/price.ts';
import { sanityCheck, summarizeForSanity } from '../../src/core/sanity.ts';
import { loadAkizukiNormalized, loadAkizukiRaw } from '../helpers/fixtures.ts';

/**
 * Real Akizuki snapshots (2026-08-02 and 2026-09-06). Expected values were
 * derived independently with a throw-away script over the raw JSON before
 * the adapter existed, and cross-checked by hand for the named products.
 */
describe('Akizuki real snapshot: adapter', () => {
  it('both snapshots validate without errors', async () => {
    for (const which of ['aug', 'sep'] as const) {
      const raw = await loadAkizukiRaw(which);
      const r = validateAkizukiRaw(raw.json);
      expect(r.errors, which).toEqual([]);
      expect(r.metrics['genreCount']).toBe(18);
    }
  });

  it('normalizes the expected number of products with stable identity', async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');
    expect(aug.products.length).toBe(8701);
    expect(sep.products.length).toBe(8677);
    // observedAt comes from `retrievedAt` inside the file, NOT from the file
    // name (the collector names files a few ms after it stamps the payload).
    expect(aug.observedAt).toBe('2026-08-02T06:38:13.852Z');
    expect(sep.observedAt).toBe('2026-09-06T09:54:15.029Z');
    expect(aug.coverageId).toBe(sep.coverageId);
    expect(aug.coverageId.split('+')).toHaveLength(18);
    expect(aug.normalizedHash).not.toBe(sep.normalizedHash);
    expect(aug.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    for (const p of sep.products) {
      expect(p.externalProductId).toBe(p.pageKey);
      expect(p.offers).toHaveLength(1);
      expect(p.offers[0]!.priceQuotes).toHaveLength(1);
    }
  });

  it('reproduces independently verified price changes', async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');
    const byId = (s: typeof aug) => new Map(s.products.map((p) => [p.externalProductId, p]));
    const a = byId(aug);
    const b = byId(sep);
    const price = (m: typeof a, id: string) => pricePointOf(m.get(id)!.offers[0]!.priceQuotes[0]!);
    const unit = (m: typeof a, id: string) => m.get(id)!.offers[0]!.priceQuotes[0]!.unitLabel;

    // FT232RQ USB serial kit
    expect(a.get('109951')!.metadata.modelNumber).toBe('AE-TTL-232R');
    expect(price(a, '109951').minAmountMinor).toBe(1150);
    expect(price(b, '109951').minAmountMinor).toBe(1200);
    expect(unit(b, '109951')).toBe('1セット');
    const c = comparePrices(price(a, '109951'), price(b, '109951'));
    expect(c).toEqual({ differenceMinor: 50, percent: 4.35, direction: 'up' });

    // RE-280RA motor
    expect(a.get('106438')!.metadata.modelNumber).toBe('RE-280RA-2865');
    expect(price(a, '106438').minAmountMinor).toBe(250);
    expect(price(b, '106438').minAmountMinor).toBe(280);
    expect(unit(b, '106438')).toBe('1個');

    // other ups and downs
    expect([price(a, '110958').minAmountMinor, price(b, '110958').minAmountMinor]).toEqual([550, 770]);
    expect([price(a, '108270').minAmountMinor, price(b, '108270').minAmountMinor]).toEqual([1480, 1815]);
    expect([price(a, '129380').minAmountMinor, price(b, '129380').minAmountMinor]).toEqual([1580, 1450]);
    expect([price(a, '116170').minAmountMinor, price(b, '116170').minAmountMinor]).toEqual([9850, 8800]);
    expect([price(a, '113472').minAmountMinor, price(b, '113472').minAmountMinor]).toEqual([400, 330]);
  });

  it('reproduces the full diff counts between the two snapshots', async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');
    const a = new Map(aug.products.map((p) => [p.externalProductId, p]));
    const b = new Map(sep.products.map((p) => [p.externalProductId, p]));
    let up = 0;
    let down = 0;
    let same = 0;
    let unitChanged = 0;
    let nameChanged = 0;
    let modelChanged = 0;
    let availChanged = 0;
    let purchasableChanged = 0;
    let onlyA = 0;
    let onlyB = 0;
    for (const [id, pa] of a) {
      const pb = b.get(id);
      if (!pb) {
        onlyA += 1;
        continue;
      }
      const qa = pa.offers[0]!.priceQuotes[0]!;
      const qb = pb.offers[0]!.priceQuotes[0]!;
      if (qa.unitLabel !== qb.unitLabel) unitChanged += 1;
      const cmp = comparePrices(pricePointOf(qa), pricePointOf(qb));
      if (cmp.direction === 'up') up += 1;
      else if (cmp.direction === 'down') down += 1;
      else same += 1;
      if (pa.metadata.name !== pb.metadata.name) nameChanged += 1;
      if (pa.metadata.modelNumber !== pb.metadata.modelNumber) modelChanged += 1;
      const aa = pa.offers[0]!.availability;
      const ab = pb.offers[0]!.availability;
      if (aa.rawStatus !== ab.rawStatus) availChanged += 1;
      if (aa.purchasable !== ab.purchasable) purchasableChanged += 1;
    }
    for (const id of b.keys()) if (!a.has(id)) onlyB += 1;
    expect({ up, down, same, unitChanged, nameChanged, modelChanged, availChanged, purchasableChanged, onlyA, onlyB }).toEqual({
      up: 165,
      down: 3,
      same: 8401,
      unitChanged: 0,
      nameChanged: 2,
      modelChanged: 5,
      availChanged: 566,
      purchasableChanged: 88,
      onlyA: 132,
      onlyB: 108,
    });
  });

  it('maps every real status into a known availability state, with null quantity only for non-purchasable items', async () => {
    const sep = await loadAkizukiNormalized('sep');
    const dist = new Map<string, number>();
    let nullQty = 0;
    for (const p of sep.products) {
      const av = p.offers[0]!.availability;
      dist.set(av.state, (dist.get(av.state) ?? 0) + 1);
      if (av.quantity === null) {
        nullQty += 1;
        expect(av.purchasable).toBe(false);
        expect(av.quantitySemantics).toBe('unknown');
      } else {
        expect(av.quantitySemantics).toBe('site_reported');
      }
    }
    expect(nullQty).toBe(133);
    expect(dist.get('unknown') ?? 0).toBe(0);
    expect((dist.get('in_stock') ?? 0) + (dist.get('low_stock') ?? 0)).toBeGreaterThan(8000);
    expect(dist.get('discontinued') ?? 0).toBeGreaterThan(0);
  });

  it('passes the store-neutral sanity check between the two real runs', async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');
    const r = sanityCheck(sep, summarizeForSanity(aug));
    expect(r.errors).toEqual([]);
    expect(r.metrics['missingProducts']).toBe(132);
    expect(r.metrics['newProducts']).toBe(108);
    expect(r.metrics['primaryPriceChanges']).toBe(168);
  });

  it('quarantines a snapshot that lost a quarter of the catalog', async () => {
    const aug = await loadAkizukiNormalized('aug');
    const sep = await loadAkizukiNormalized('sep');
    const truncated = { ...sep, products: sep.products.slice(0, Math.floor(sep.products.length * 0.7)) };
    const r = sanityCheck(truncated, summarizeForSanity(aug));
    expect(r.errors.map((e) => e.code)).toContain('sanity.item_count_drop');
  });
});
