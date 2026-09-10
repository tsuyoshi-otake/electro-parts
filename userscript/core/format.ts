import type { AvailabilityState } from '../../src/core/domain.ts';
import type { PriceBasis } from '../../src/core/price.ts';
import type { CaveatKey, PriceValueV1 } from '../../src/publisher/contract.ts';

/** Minor units per major unit; anything unknown is treated as two decimals. */
const MINOR_DIGITS: Record<string, number> = { JPY: 0, KRW: 0, USD: 2, EUR: 2 };

export function formatMoney(minor: number, currency: string): string {
  const digits = MINOR_DIGITS[currency] ?? 2;
  const major = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${currency}`;
  }
}

export function formatPriceValue(value: PriceValueV1, currency: string): string {
  if (value.state === 'unavailable' || value.minAmountMinor === null || value.maxAmountMinor === null) return '価格表示なし';
  if (value.state === 'range' && value.minAmountMinor !== value.maxAmountMinor) return `${formatMoney(value.minAmountMinor, currency)}〜${formatMoney(value.maxAmountMinor, currency)}`;
  return formatMoney(value.minAmountMinor, currency);
}

export function formatDate(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatSignedMoney(minor: number, currency: string): string {
  const sign = minor > 0 ? '+' : minor < 0 ? '−' : '±';
  return `${sign}${formatMoney(Math.abs(minor), currency)}`;
}

export function formatPercent(p: number): string {
  const sign = p > 0 ? '+' : p < 0 ? '−' : '±';
  return `${sign}${(Math.round(Math.abs(p) * 10) / 10).toFixed(1)}%`;
}

const TAX_LABEL: Record<PriceBasis['taxTreatment'], string> = { tax_included: '税込', tax_excluded: '税抜', unknown: '税区分不明' };
const QUOTE_LABEL: Record<PriceBasis['quoteKind'], string> = { selling: '販売価格', compare_at: '参考価格' };

export function basisLabel(basis: PriceBasis): string {
  const parts = [QUOTE_LABEL[basis.quoteKind], TAX_LABEL[basis.taxTreatment]];
  if (basis.unitLabel !== null) parts.push(basis.unitLabel);
  if (basis.currency !== 'JPY') parts.push(basis.currency);
  return parts.join(' / ');
}

const AVAILABILITY_LABEL: Record<AvailabilityState, string> = {
  in_stock: '在庫あり',
  low_stock: '在庫僅少',
  out_of_stock: '在庫なし',
  restocking: '入荷待ち',
  preparing: '準備中',
  checking: '在庫確認中',
  discontinued: '販売終了',
  unknown: '不明',
  not_displayed: '表示なし',
};

export function availabilityLabel(state: AvailabilityState): string {
  return AVAILABILITY_LABEL[state] ?? state;
}

export const CAVEAT_TEXT: Record<CaveatKey, string> = {
  observation_window: '表示される最安値・最高値は観測期間内の値であり、全期間の最安値ではありません。',
  sampling_interval: '価格・在庫はおおむね1か月に1回の観測です。観測の間の変化は記録されません。',
  sampling_interval_weekly: '価格・在庫はおおむね1週間に1回の観測です。観測の間の変化は記録されません。',
  sampling_interval_every_two_days: '価格・在庫はおおむね2日に1回の観測です。観測の間の変化は記録されません。',
  absence_not_discontinued: '一覧から消えた商品は「未掲載」であり、販売終了とは限りません。',
  site_reported_quantity: '在庫数はサイト表示値をそのまま記録したもので、実在庫を保証しません。',
  quantity_semantics_unknown: '在庫数の意味(実在庫か目安か)は不明です。',
  suspicious_identity: '商品名と型番が同時に変わった記録があり、同じ番号が別商品に再利用された可能性があります。',
};

export function caveatText(key: CaveatKey): string {
  return CAVEAT_TEXT[key] ?? key;
}
