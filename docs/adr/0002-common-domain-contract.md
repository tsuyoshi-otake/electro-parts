# ADR-0002: 共通ドメイン契約(整数の最小通貨単位、価格の状態・税・単位、Product と Offer)

- 状態: 採用(2026-09-06)
- 関連: `src/core/domain.ts`、`src/core/price.ts`、`src/core/capabilities.ts`

## 背景

店舗によって価格の表現が違う。秋月は「￥1,200(税込)/1個」の確定価格、スイッチサイエンスは min〜max の幅、他店では税抜表示や「1 袋 10 個入り」の単位が混ざる。これらを 1 つの数値に潰すと履歴が嘘になる。

## 決定

- 金額は**整数の最小通貨単位**(`amountMinor`、JPY は円)。浮動小数を保持しない。
- `PriceQuote` は `quoteKind`(`selling` / `compare_at`)、`taxTreatment`(`tax_included` / `tax_excluded` / `unknown`)、`currency`、`state`(`exact` / `range` / `unavailable`)、`minAmountMinor` / `maxAmountMinor`、`unitLabel` を持つ。
- **価格基準(basis)** = `(quoteKind, taxTreatment, currency, unitLabel)`。基準が違えば別の履歴系列。ある基準の系列が「主(primary)」であり、UI の既定表示になる。
- 商品(`Product`)は 1 つ以上のオファー(`Offer`)を持つ。Phase 1 の秋月は `__default__` オファー 1 つ。バリアント(`variant`)と集約(`aggregate`)の種別は型・DB・契約に含め、合成データでテストする。
- 在庫は `availability` 列挙(`not_displayed` を含む)、`purchasable`、`quantity` と `quantitySemantics`、`rawStatus` の組で、数値だけに潰さない。
- 店舗の表現能力は `StoreCapabilities` として宣言し、Publisher が manifest に載せる。UI は capabilities を見て「在庫数は店舗表示値」などの表示を切り替える。

## 理由

浮動小数・単位の欠落・税の曖昧さは履歴の比較を壊す。基準を系列の一部にすると、「1 個 100 円」から「1 袋 100 円」への変化を値下げと誤解しない。

## 結果

- 秋月アダプターは quantityUnit(`1個`、`1セット`)を `unitLabel` に写し、税込を `tax_included` にする。
- Phase 2 / 3 のアダプターは新しい型を足さずに `range`、`tax_excluded`、バリアントを表現できる。
