# ADR-0011: Shadow DOM、`innerHTML` 禁止、CDN なし、fail-open

- 状態: 採用(2026-09-06)
- 関連: `userscript/ui/panel.ts`、`userscript/ui/chart.ts`、`userscript/core/controller.ts`、`scripts/build-userscript.ts`

## 背景

ユーザースクリプトは他人のサイト上で動く。サイトの CSS に壊されず、サイトを壊さず、データ(外部から来る JSON)や商品名(サイト由来の文字列)を経由したスクリプト注入の余地をなくす必要がある。Keepa 等の既存ツールの名前・UI・コードは使わない。

## 決定

- パネルは独自のホスト要素(`#electronics-price-history-root`)の **open な Shadow DOM** に描画し、スタイルはその中に閉じる。
- DOM は `createElement` / `textContent` / `setAttribute` だけで組み立てる。`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write` は使わない。CI がビルド済みバンドルを grep して検査する。
- チャートは同梱の SVG ステップチャート(`createElementNS`)。外部ライブラリも CDN もない。`@require` も使わない。
- チャートは `IntersectionObserver` で見えるまで描かない(遅延)。差し込み位置が遅れて現れるページに備え、`MutationObserver` は 10 秒で必ず切る。
- どの段階の失敗もページに影響しない(`try` で囲み、ログだけ残す)。同じページに二重に差し込まない。
- 通信は `GM_xmlhttpRequest` の `anonymous` で、宛先は `@connect` に列挙したデータホストのみ。ページの内容を送らない。
- アクセシビリティ: チャートは `role="img"` と要約の `aria-label`、変更点の表(折りたたみ)、アニメーションを一切使わない（`transition` / `@keyframes` なし。`prefers-reduced-motion` を見る必要がない）、色だけに頼らない状態表示。
- 名前は汎用の「Electronics Price History」。店舗名はアダプターの `storeId` 経由でのみ現れる。

## 理由

Shadow DOM とテキストノードだけの構築は、注入・スタイル衝突の両方を構造的に防ぐ。CI のチェックは「うっかり」を防ぐ最後の網。

## 結果

- 太字などの装飾は要素で表現する(文字列テンプレートは使えない)。
- バンドルは約 50 KB。チャートライブラリを使わない分、表現は簡素だが予算(100 KB)に収まる。
- 追記(2026-09-07): その後 `userscript/adapters/productRelations.ts`(生成物の店舗間対応表)を同梱したので、配布するバンドル全体は 677,674 バイトになった。ここでいう予算が指すのは描画コードのほうで、そちらは 89,437 バイトと 100 KB に収まったままである(対応表は 588,237 バイト)。README の予算表もこの区別に合わせてある。
