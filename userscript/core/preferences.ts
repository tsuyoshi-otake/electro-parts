/**
 * The viewer's display preferences, kept in the host's storage on this device
 * and never sent anywhere. Two choices live here: whether yen references add a
 * card foreign-transaction fee (off by default), and whether the chart shows
 * the recorded stock counts.
 *
 * The fee is a published rate per card type (issuer and brand), or one the
 * viewer enters. Rates change by the issuers' announcements, so the list says
 * when it was checked; an unknown or retired card id falls back to the default
 * card and keeps the fee switch as it was.
 */

export const PREFERENCES_STORAGE_KEY = 'eph:prefs:v1';

export interface CardFeePreset {
  id: string;
  /** Issuer and brands as the viewer recognizes the card. */
  label: string;
  /** Foreign-transaction fee in percent, as the issuer publishes it. */
  percent: number;
}

/** When the preset rates were last checked against the issuers' own pages. */
export const CARD_FEE_RATES_CHECKED_ON = '2026-11-03';

/**
 * Rates as each issuer's own page states them (sources in ADR-0026). A card
 * whose rate is announced to change within days carries the new rate and says so.
 */
export const CARD_FEE_PRESETS: readonly CardFeePreset[] = [
  { id: 'smbc-visa-mastercard', label: '三井住友カード（Visa・Mastercard）', percent: 3.63 },
  { id: 'amazon-mastercard', label: 'Amazon Mastercard', percent: 2.2 },
  { id: 'rakuten', label: '楽天カード', percent: 3.63 },
  { id: 'jcb', label: 'JCBカード（JCB発行）', percent: 1.6 },
  { id: 'aeon', label: 'イオンカード', percent: 1.6 },
  { id: 'epos', label: 'エポスカード', percent: 3.85 },
  { id: 'saison', label: 'セゾンカード', percent: 3.85 },
  { id: 'paypay', label: 'PayPayカード', percent: 3.85 },
  { id: 'dcard', label: 'dカード', percent: 3.85 },
  { id: 'amex', label: 'アメリカン・エキスプレス（アメックス発行）', percent: 3.5 },
  { id: 'mufg-visa-mastercard', label: '三菱UFJカード・NICOSカード（Visa・Mastercard、2026年11月改定後）', percent: 4.5 },
];

/** The card the selector starts on; the fee itself stays off until enabled. */
export const DEFAULT_CARD_ID = 'smbc-visa-mastercard';
/** The selector value for a rate the viewer enters. */
export const CUSTOM_CARD_ID = 'custom';
/** A rate the viewer enters must lie in this range (percent). */
export const CUSTOM_FEE_LIMIT = { min: 0, max: 10 } as const;

export interface Preferences {
  cardFee: {
    enabled: boolean;
    cardId: string;
    /** The entered rate for `CUSTOM_CARD_ID`; null until one is entered. */
    customPercent: number | null;
  };
  /** Draw the recorded stock counts under the price chart. */
  showStock: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  cardFee: { enabled: false, cardId: DEFAULT_CARD_ID, customPercent: null },
  showStock: true,
};

/** The fee a yen reference includes, with what to call it; null when none applies. */
export interface AppliedCardFee {
  percent: number;
  label: string;
}

const isPreset = (id: unknown): id is string => typeof id === 'string' && CARD_FEE_PRESETS.some((p) => p.id === id);

/** A rate the viewer may enter: a finite number in the allowed range, at most two decimals. */
export function validCustomPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < CUSTOM_FEE_LIMIT.min || value > CUSTOM_FEE_LIMIT.max) return null;
  return Math.round(value * 100) / 100;
}

/** Stored text to preferences; anything unreadable keeps the default for that part. */
export function parsePreferences(text: string | null): Preferences {
  if (text === null) return DEFAULT_PREFERENCES;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES;
  const r = raw as Record<string, unknown>;
  const fee = typeof r['cardFee'] === 'object' && r['cardFee'] !== null ? r['cardFee'] as Record<string, unknown> : {};
  const cardId = fee['cardId'] === CUSTOM_CARD_ID || isPreset(fee['cardId']) ? fee['cardId'] as string : DEFAULT_CARD_ID;
  return {
    cardFee: {
      enabled: fee['enabled'] === true,
      cardId,
      customPercent: validCustomPercent(fee['customPercent']),
    },
    showStock: typeof r['showStock'] === 'boolean' ? r['showStock'] : DEFAULT_PREFERENCES.showStock,
  };
}

export function serializePreferences(preferences: Preferences): string {
  return JSON.stringify(preferences);
}

/** The fee to add, or null when the switch is off or an entered rate is missing. */
export function appliedCardFee(preferences: Preferences): AppliedCardFee | null {
  const { enabled, cardId, customPercent } = preferences.cardFee;
  if (!enabled) return null;
  if (cardId === CUSTOM_CARD_ID) return customPercent === null ? null : { percent: customPercent, label: '入力した料率' };
  const preset = CARD_FEE_PRESETS.find((p) => p.id === cardId) ?? CARD_FEE_PRESETS.find((p) => p.id === DEFAULT_CARD_ID)!;
  return { percent: preset.percent, label: preset.label };
}

/** `3.63%`: up to two decimals, no trailing zeros. */
export function formatFeePercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}
