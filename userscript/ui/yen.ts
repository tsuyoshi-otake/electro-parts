import type { PriceValueV1 } from '../../src/publisher/contract.ts';
import { EXCHANGE_RATE_ATTRIBUTION, yenFromMinor, type JpyRate } from '../core/exchangeRate.ts';
import { formatDateTime, formatMoney } from '../core/format.ts';
import { formatFeePercent, type AppliedCardFee } from '../core/preferences.ts';

/**
 * Current recorded prices read in yen. Only current prices go through here:
 * deltas, statistics, the chart and the change list keep the recorded
 * currency, because there is only today's rate and an old price converted
 * with it is not what the shop charged then. Ordering and the 最安 badge never
 * read these values (ADR-0026).
 */

export const YEN_CSS = `
.eph .fx-recorded { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.eph .fx-recorded .delta { font-size: 12px; margin-left: 6px; }
.eph .fx-note { margin-top: 10px; padding-top: 6px; border-top: 1px dashed var(--line-soft); font-size: 12px; color: var(--muted); }
.eph .fx-note p { margin: 2px 0; }
`;

export interface YenAmount {
  /** `約 ￥1,234`, or a range of two such amounts. */
  amount: string;
  /** What the amount adds on top of the rate, e.g. `カード手数料 3.63%込み`; null without a fee. */
  includes: string | null;
}

export interface YenConverter {
  /** The yen reading of a recorded value, or null when its currency has no rate or it has no price. */
  convert(value: PriceValueV1, currency: string): YenAmount | null;
  /** The rate note for every currency converted so far; nothing when none was. */
  renderNote(doc: Document, parent: HTMLElement): void;
}

export function yenConverter(rates: Readonly<Record<string, JpyRate>>, fee: AppliedCardFee | null): YenConverter {
  const used = new Map<string, JpyRate>();
  const percent = fee?.percent ?? 0;
  return {
    convert(value, currency) {
      const rate = rates[currency];
      if (rate === undefined || rate.base !== currency) return null;
      if (value.state === 'unavailable' || value.minAmountMinor === null || value.maxAmountMinor === null) return null;
      used.set(currency, rate);
      const yen = (minor: number) => formatMoney(yenFromMinor(minor, rate, percent), 'JPY');
      const amount = value.state === 'range' && value.minAmountMinor !== value.maxAmountMinor
        ? `約 ${yen(value.minAmountMinor)}〜${yen(value.maxAmountMinor)}` : `約 ${yen(value.minAmountMinor)}`;
      return { amount, includes: fee === null ? null : `カード手数料 ${formatFeePercent(fee.percent)}込み` };
    },
    renderNote(doc, parent) {
      if (used.size === 0) return;
      const note = doc.createElement('div');
      note.className = 'fx-note';
      const line = (content: string) => {
        const p = doc.createElement('p');
        p.textContent = content;
        note.appendChild(p);
        return p;
      };
      line('「約 ￥」は記録価格を円に換算した参考値です。税・送料・関税を含まず、実際の請求額とは異なります。');
      for (const rate of [...used.values()].sort((a, b) => a.base.localeCompare(b.base))) {
        // A cross rate says which quoted rates it was divided from.
        const via = rate.via === null ? '' : `${rate.via}/JPY と ${rate.via}/${rate.base} から算出、`;
        line(`1 ${rate.base} = ${rate.jpyPerUnit.toFixed(2)}円（${via}${formatDateTime(rate.updatedAt)} 更新）`);
      }
      line(fee === null
        ? 'カードの海外事務手数料は含みません（設定で加算できます）。'
        : `カードの海外事務手数料 ${formatFeePercent(fee.percent)}（${fee.label}）を加算しています。`);
      const credit = line('為替レート: ');
      const link = doc.createElement('a');
      link.href = EXCHANGE_RATE_ATTRIBUTION.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = EXCHANGE_RATE_ATTRIBUTION.label;
      credit.appendChild(link);
      parent.appendChild(note);
    },
  };
}
