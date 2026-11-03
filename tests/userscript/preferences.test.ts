import { describe, expect, it } from 'vitest';
import {
  appliedCardFee, CARD_FEE_PRESETS, DEFAULT_PREFERENCES, formatFeePercent, parsePreferences, serializePreferences, validCustomPercent,
} from '../../userscript/core/preferences.ts';

describe('display preferences', () => {
  it('starts with the card fee off, the default card selected and the stock chart on', () => {
    expect(parsePreferences(null)).toEqual({ cardFee: { enabled: false, cardId: 'smbc-visa-mastercard', customPercent: null }, showStock: true });
    expect(appliedCardFee(DEFAULT_PREFERENCES)).toBeNull();
  });

  it('round-trips what it saves', () => {
    const prefs = { cardFee: { enabled: true, cardId: 'custom', customPercent: 2.5 }, showStock: false };
    expect(parsePreferences(serializePreferences(prefs))).toEqual(prefs);
  });

  it('keeps the default for each part it cannot read', () => {
    for (const text of ['', 'not json', 'null', '42', '[]']) expect(parsePreferences(text)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(JSON.stringify({ cardFee: { enabled: 'yes', cardId: 7, customPercent: '3' }, showStock: 'no' }))).toEqual(DEFAULT_PREFERENCES);
    // A retired card id falls back to the default card; the switch stays as saved.
    expect(parsePreferences(JSON.stringify({ cardFee: { enabled: true, cardId: 'retired-card' } }))).toEqual({
      cardFee: { enabled: true, cardId: 'smbc-visa-mastercard', customPercent: null }, showStock: true,
    });
  });

  it('accepts an entered rate from 0 to 10 percent, rounded to two decimals', () => {
    expect(validCustomPercent(0)).toBe(0);
    expect(validCustomPercent(10)).toBe(10);
    expect(validCustomPercent(3.456)).toBe(3.46);
    for (const value of [-0.01, 10.01, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) expect(validCustomPercent(value)).toBeNull();
    expect(parsePreferences(JSON.stringify({ cardFee: { enabled: true, cardId: 'custom', customPercent: 50 } })).cardFee.customPercent).toBeNull();
  });

  it('applies the selected card\'s published rate, or the entered one, only while switched on', () => {
    expect(appliedCardFee({ cardFee: { enabled: true, cardId: 'amex', customPercent: null }, showStock: true })).toEqual({ percent: 3.5, label: 'アメリカン・エキスプレス（アメックス発行）' });
    expect(appliedCardFee({ cardFee: { enabled: false, cardId: 'amex', customPercent: null }, showStock: true })).toBeNull();
    expect(appliedCardFee({ cardFee: { enabled: true, cardId: 'custom', customPercent: 2.5 }, showStock: true })).toEqual({ percent: 2.5, label: '入力した料率' });
    // No rate entered yet: nothing is added rather than a guess.
    expect(appliedCardFee({ cardFee: { enabled: true, cardId: 'custom', customPercent: null }, showStock: true })).toBeNull();
  });

  it('lists each card once with a positive rate and formats rates without trailing zeros', () => {
    expect(new Set(CARD_FEE_PRESETS.map((p) => p.id)).size).toBe(CARD_FEE_PRESETS.length);
    for (const preset of CARD_FEE_PRESETS) expect(preset.percent).toBeGreaterThan(0);
    expect(CARD_FEE_PRESETS.map((p) => p.id)).not.toContain('custom');
    expect(formatFeePercent(3.63)).toBe('3.63%');
    expect(formatFeePercent(1.6)).toBe('1.6%');
    expect(formatFeePercent(3.5)).toBe('3.5%');
  });
});
