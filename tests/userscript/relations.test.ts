import { describe, expect, it } from 'vitest';
import { PRODUCT_RELATIONS } from '../../userscript/adapters/productRelations.ts';
import { PAGE_ADAPTERS } from '../../userscript/adapters/registry.ts';
import { comparisonEligibility, currentOffer, indexRelations, matchesRelationProduct, primaryQuote, relatedEntries, relationProductKey, MAX_RELATED_HISTORY_LOADS } from '../../userscript/core/relations.ts';
import { comparisonFixture } from './comparison-fixtures.ts';

describe('curated relation catalogue', () => {
  it('ranks identity first and closest reviewed family differences next without dropping links', () => {
    const entries = relatedEntries(PRODUCT_RELATIONS, 'akizuki', '116132');
    expect(entries[0]!.relation).toMatchObject({kind: 'same_product', reviewStatus: 'verified'});
    const distances = entries.filter(e => e.relation.similarity).map(e => e.relation.similarity!.distance);
    expect(distances).toEqual([...distances].sort((a,b) => a-b));
    expect(entries.filter(e => e.state.kind === 'loading').length).toBeLessThanOrEqual(MAX_RELATED_HISTORY_LOADS);
    expect(entries.length).toBe(PRODUCT_RELATIONS.filter(r => r.products.some(p => p.storeId === 'akizuki' && p.pageKey === '116132')).length);
  });
  it('contains unique, reversible store-scoped pairs with source evidence and safe endpoint URLs', () => {
    document.head.replaceChildren(); document.body.replaceChildren();
    const seen = new Set<string>();
    for (const r of PRODUCT_RELATIONS) {
      expect(seen.has(r.id)).toBe(false); seen.add(r.id);
      expect(r.evidence.length).toBeGreaterThan(10);
      expect(Number.isFinite(Date.parse(r.reviewedAt))).toBe(true);
      expect(r.products[0].storeId).not.toBe(r.products[1].storeId);
      for (const p of r.products) {
        expect(p.expectedNames).toContain(p.name); expect(p.expectedModels).toContain(p.modelNumber);
        expect(Number.isFinite(Date.parse(p.observedAt))).toBe(true);
        const url = new URL(p.url); expect(url.protocol).toBe('https:');
        const adapter = PAGE_ADAPTERS.find((a) => a.storeId === p.storeId)!;
        expect(adapter.matches(url)).toBe(true);
        expect(adapter.extractPageKey(document, url)).toBe(p.pageKey);
      }
      if (r.kind === 'similar_product') { expect(r.differences.length).toBeGreaterThan(0); expect(r.pricePolicy).toBeNull(); }
      if (r.kind === 'unresolved') expect(r.reviewStatus).toBe('needs_review');
      if (r.pricePolicy) {
        expect(r.kind).toBe('same_product'); expect(r.reviewStatus).toBe('verified');
        expect(r.provenance.method).toBe('retailer-pages'); expect(r.pricePolicy.evidence.length).toBeGreaterThan(20);
        expect(r.pricePolicy.offerIds).toHaveLength(2);
      }
      const index = indexRelations([r]);
      for (const [i, p] of r.products.entries()) {
        const entries = relatedEntries(index.get(relationProductKey(p.storeId, p.pageKey))!, p.storeId, p.pageKey);
        expect(entries).toHaveLength(1); expect(entries[0]!.sourceIndex).toBe(i);
        expect(entries[0]!.target).toBe(r.products[i === 0 ? 1 : 0]);
      }
    }
  });

  it('covers all 20 scoped M5Stack products, preserves revision alternatives, and does not relabel uncertainty as similarity', () => {
    const ids = new Set(PRODUCT_RELATIONS.flatMap((r) => r.products.filter((p) => p.storeId === 'akizuki' && p.modelNumber.startsWith('M5STACK-')).map((p) => p.pageKey)));
    expect(ids.size).toBe(20);
    for (const id of ['117375', '117209', '117215', '116170', '131822', '129456', '117217', '117218']) expect(ids.has(id)).toBe(true);
    expect(PRODUCT_RELATIONS.find((r) => r.id === 'a117215-s6260')!.kind).toBe('same_product');
    expect(PRODUCT_RELATIONS.find((r) => r.id === 'a117215-s11175')!.kind).toBe('similar_product');
    expect(PRODUCT_RELATIONS.find((r) => r.id === 'a117217-s4051')!.kind).toBe('unresolved');
    expect(PRODUCT_RELATIONS.find((r) => r.id === 'a117928-s5529')!.kind).toBe('unresolved');
    expect(relatedEntries(PRODUCT_RELATIONS, 'unknown', '123')).toEqual([]);
  });
});

describe('comparison eligibility', () => {
  it('selects the currently present offer when a retired offer appears first', () => {
    const f = comparisonFixture();
    const active = f.current.offers[0]!;
    const retired = structuredClone(active);
    retired.externalOfferId = 'retired';
    retired.presence = [[f.current.product.firstSeenAt, 1], [f.current.product.lastSeenAt, 0]];
    f.current.offers = [retired, active];
    expect(currentOffer(f.current)).toBe(active);
    expect(primaryQuote(f.current)?.offer).toBe(active);
    expect(comparisonEligibility(f.current, active.segments[0]!, f.entry)).toMatchObject({ comparable: true });
  });

  it('permits reviewed primary quotes and reverses the signed difference on the other store', () => {
    const f = comparisonFixture();
    expect(comparisonEligibility(f.current, f.segment, f.entry)).toMatchObject({ comparable: true, differenceMinor: 300 });
    const reversed = { ...f.entry, sourceIndex: 1 as const, target: f.relation.products[0], state: { ...f.entry.state, kind: 'ready' as const, product: f.current, manifest: null, freshness: 'fresh' as const, storedAt: 1, note: null } };
    expect(comparisonEligibility(f.other, f.otherSegment, reversed)).toMatchObject({ comparable: true, differenceMinor: -300 });
  });

  it.each(['candidate', 'similar', 'unresolved', 'no-policy', 'unknown-unit', 'different-unit', 'currency', 'tax', 'quote', 'variant', 'new-offer-id', 'old-segment', 'unlisted', 'absent-segment', 'changed-name', 'changed-model', 'suspicious', 'expired', 'stale', 'version-note', 'loading', 'missing', 'error'])(
    'blocks arithmetic/overlays for %s', (reason) => {
      const f = comparisonFixture();
      switch (reason) {
        case 'candidate': f.relation.reviewStatus = 'candidate'; break;
        case 'similar': f.relation.kind = 'similar_product'; break;
        case 'unresolved': f.relation.kind = 'unresolved'; break;
        case 'no-policy': f.relation.pricePolicy = null; break;
        case 'unknown-unit': f.otherSegment.basis.unitLabel = null; break;
        case 'different-unit': f.otherSegment.basis.unitLabel = '10個'; break;
        case 'currency': f.otherSegment.basis.currency = 'USD'; break;
        case 'tax': f.otherSegment.basis.taxTreatment = 'tax_excluded'; break;
        case 'quote': f.otherSegment.basis.quoteKind = 'compare_at'; break;
        case 'variant': f.other.offers.push(structuredClone(f.other.offers[0]!)); break;
        case 'new-offer-id': f.other.offers[0]!.externalOfferId = 'replaced'; break;
        case 'old-segment': f.segment = structuredClone(f.segment); break;
        case 'unlisted': f.other.product.listed = false; break;
        case 'absent-segment': f.otherSegment.presence.push([f.other.product.lastSeenAt, 0]); break;
        case 'changed-name': f.other.product.current.name += ' V2'; break;
        case 'changed-model': f.other.product.current.modelNumber += '-V2'; break;
        case 'suspicious': f.other.product.metadata[0]!.suspicious = true; break;
        case 'expired': f.relation.pricePolicy!.verifiedAt = '2025-01-01'; break;
        case 'stale': if (f.entry.state.kind === 'ready') f.entry.state.freshness = 'stale'; break;
        case 'version-note': if (f.entry.state.kind === 'ready') f.entry.state.note = 'publication mismatch'; break;
        case 'loading': f.entry.state = { kind: 'loading' }; break;
        case 'missing': f.entry.state = { kind: 'missing', manifest: null, freshness: 'fresh' }; break;
        case 'error': f.entry.state = { kind: 'error', message: 'offline' }; break;
      }
      expect(comparisonEligibility(f.current, f.segment, f.entry).comparable).toBe(false);
    },
  );

  it('requires explicit package evidence for a null unit and avoids subtracting price ranges', () => {
    const f = comparisonFixture(); f.otherSegment.basis.unitLabel = null;
    f.relation.pricePolicy!.units = [['1個'], [null]];
    expect(comparisonEligibility(f.current, f.segment, f.entry).comparable).toBe(true);
    f.otherSegment.stats.current = { state: 'range', minAmountMinor: 1000, maxAmountMinor: 1500 };
    expect(comparisonEligibility(f.current, f.segment, f.entry)).toMatchObject({ comparable: true, differenceMinor: null });
    f.other.storeId = 'foreign';
    expect(matchesRelationProduct(f.entry.target, f.other)).toBe(false);
  });
});
