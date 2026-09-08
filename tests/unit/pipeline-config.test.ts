import { describe, expect, it } from 'vitest';
import { akizukiCollector, parseAkizukiCollectorConfig } from '../../src/collectors/akizuki/collector.ts';
import { DEFAULT_SANITY_THRESHOLDS } from '../../src/core/sanity.ts';
import { loadPipelineConfig, parsePipelineConfig } from '../../src/pipeline/config.ts';
import { newReport, reportToMarkdown, runStage, StageFailedError } from '../../src/pipeline/report.ts';
import { getStoreCollector } from '../../src/stores/collectorRegistry.ts';

describe('pipeline config', () => {
  it('applies defaults and validates the checked-in Akizuki config', async () => {
    const c = await loadPipelineConfig('config/akizuki.json');
    expect(c.storeId).toBe('akizuki');
    expect(c.sanity).toEqual(DEFAULT_SANITY_THRESHOLDS);
    expect(c.paths).toEqual({ snapshots: 'snapshots', work: 'state/work', site: 'site', reports: 'reports' });
    expect(c.previousStateUrl).toBe('https://tsuyoshi-otake.github.io/electro-parts/state');
    expect(c.previousStateTimeoutMs).toBe(60_000);
    const collector = parseAkizukiCollectorConfig(c.collector);
    // Both families, always: neither reaches the whole catalogue alone, and
    // alternating them would churn the coverage id every run (ADR-0012).
    expect(collector.listingKinds).toEqual(['c', 'r']);
    expect(collector.maxUncoveredProducts).toBe(600);
    expect(collector.maxRequests).toBeGreaterThanOrEqual(2800);
    expect(collector.minIntervalMs).toBeGreaterThanOrEqual(1000);
    expect(collector.userAgent).toContain('github.com/tsuyoshi-otake');
    expect(() => getStoreCollector('akizuki').validateConfig(c.collector)).not.toThrow();
    expect(getStoreCollector('akizuki')).toBe(akizukiCollector);
  });

  it('rejects unsafe or malformed values', () => {
    const base = { storeId: 'akizuki', collector: { userAgent: 'electro-parts test agent' } };
    expect(parsePipelineConfig(base).inventory).toEqual({ retentionDays: 400, pointLimit: 730 });
    expect(parsePipelineConfig({ ...base, previousStateTimeoutMs: 1234 }).previousStateTimeoutMs).toBe(1234);
    expect(() => parsePipelineConfig({ ...base, storeId: 'Akizuki!' })).toThrow(/store id/i);
    expect(() => parsePipelineConfig({ ...base, sanity: { maxItemCountDropRatio: 2 } })).toThrow(/between 0 and 1/);
    expect(() => parsePipelineConfig({ ...base, inventory: { retentionDays: 0 } })).toThrow(/positive integer/);
    expect(() => parsePipelineConfig({ ...base, previousStateUrl: 'http://insecure' })).toThrow(/https/);
    expect(() => parsePipelineConfig({ ...base, previousStateTimeoutMs: 0 })).toThrow(/positive integer/);
    expect(() => parsePipelineConfig({ storeId: 'akizuki' })).toThrow(/collector/);
    expect(() => getStoreCollector('aitendo')).toThrow(/no collector/);
  });

  it('collector config refuses anonymous or crawler-named agents and bad genres', () => {
    expect(() => parseAkizukiCollectorConfig({ userAgent: 'x' })).toThrow(/identify/);
    expect(() => parseAkizukiCollectorConfig({ userAgent: 'my-crawler/1.0 (+https://example.test)' })).toThrow(/crawler/);
    expect(() => parseAkizukiCollectorConfig({ userAgent: 'electro-parts test agent', genres: ['rkit'] })).toThrow(/collector.genres was removed/);
    expect(() => parseAkizukiCollectorConfig({ userAgent: 'electro-parts test agent', listingKinds: ['x'] })).toThrow(/listingKinds/);
    expect(() => parseAkizukiCollectorConfig({ userAgent: 'electro-parts test agent', baseUrl: 'https://akizukidenshi.com/catalog' })).toThrow(/origin/);
    expect(() => parseAkizukiCollectorConfig({ userAgent: 'electro-parts test agent', minIntervalMs: 100 })).toThrow(/>= 500/);
  });
});

describe('pipeline report', () => {
  it('records stage timing and renders Markdown with failures and skips', async () => {
    let t = 0;
    const now = () => new Date(1_000_000 + (t += 250));
    const report = newReport('akizuki', now);
    await runStage(report, 'previous_state', now, (d) => {
      d['mode'] = 'bootstrap';
    });
    await expect(runStage(report, 'collect', now, () => Promise.reject(new Error('boom | pipe')))).rejects.toBeInstanceOf(StageFailedError);
    report.outcome = 'failed';
    report.warnings.push('collect: <something>');
    const md = reportToMarkdown(report);
    expect(report.stages[0]).toMatchObject({ status: 'ok', durationMs: 250, details: { mode: 'bootstrap' } });
    expect(report.stages[1]).toMatchObject({ status: 'failed', error: 'boom | pipe' });
    expect(report.stages[2]!.status).toBe('skipped');
    expect(md).toContain('## Pipeline: akizuki — failed');
    expect(md).toContain('| collect | ❌ failed — boom \\| pipe |');
    expect(md).toContain('| validate | ⏭️ skipped |');
    expect(md).toContain('&lt;something>');
  });
});
