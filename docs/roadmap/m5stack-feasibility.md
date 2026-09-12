# M5Stack公式ショップ対応

2026-09-12。ユーザーの指示で追加店舗の対象をエレショップからM5Stack公式ショップへ変更。全件収集の実現性調査は完了。コレクター・公開・拡張機能への実装は未着手。

## 実測結果

- [公開商品一覧JSON](https://shop.m5stack.com/products.json?limit=250&page=1)を直列で3ページ取得。250 + 250 + 164 = **664商品、706 variants**。商品handleの重複0件。19商品に複数variantがある。
- [サイトマップ](https://shop.m5stack.com/sitemap.xml)の索引1件・商品サイトマップ1件と照合し、664商品すべて一致。取りこぼし0件、一覧だけに存在する商品0件。件数はこの調査時点の公開商品で、販売可能な商品数とは異なる。
- variantのavailableはtrueが473件、falseが233件。公開JSONに在庫数量のフィールドはない。数量0と解釈せず、数量非公開として扱う。
- 全706variantの価格文字列は小数2桁形式。[サンプル商品](https://shop.m5stack.com/products/m5stamp-lora-module-sx1262)のHTMLでShopify.currency.activeとpriceCurrencyがUSDと確認できた。S014 / S014-I / S014-IFは$5.50 / $7.50 / $7.95。サンプルは1商品であり全ページのDOM検証ではない。
- [robots.txt](https://shop.m5stack.com/robots.txt)を取得し、今回の一覧・サイトマップ・商品URLはDisallow対象でないことを確認。コメントにはUCP/MCPの案内もあるが、今回は購入操作を行わず公開商品JSONを読み取った。

全件収集は一覧3 + サイトマップ2 = **5リクエスト**で照合まで完了する。ページ数は固定せず短いページで終了し、上限と繰返し検知を設ける。商品N件に対してO(ceil(N/250))の一覧リクエストで済み、個別商品HTMLのO(N)巡回は不要。実測では1.8秒の待機を各応答後に挟んだ。2日更新の実装対象として現実的な規模。

実装ではこの5リクエストに、毎回のUSD確認用ホームページ1リクエストを加え、計6リクエストとなった。実装結果は [対応仕様](m5stack-support.md) と [検証記録](../../.codex/goal-loop/m5stack/journal.md) を参照。

## 実装方針

1. M5Stack固有のアダプター・コレクター・店舗設定を追加し、既存のStoreCollector境界を使う。SSの円専用パーサーをUSDに流用しない。USDは整数セントで厳密に保存する（5.50 → 550）。端数の丸めは禁止。
2. variantのID・SKU・元価格・構成を保持し、複数構成を最安variantだけに潰さない。在庫は購入可否、数量は非公開。税の含有はtaxableだけで断定せず、未確認ならunknown。送料・輸入税を含む総額とは表示しない。
3. 初期はUSDの価格・在庫履歴を表示する。円換算は追加しない。国内店舗との同一性照合と価格比較可否は別判定。既存コアは通貨と整数最小単位に対応し、UIもUSD小数2桁に対応するが、店舗追加のテストは必要。
4. サイトマップのURLエンコードとJSONのUnicode handleを同じ正規形にする。`2-%E2%9C%96-15-pinheader-bus-socket-smd-for-13-2-module-10-sets` と `2-✖-15-pinheader-bus-socket-smd-for-13-2-module-10-sets` が今回の実例。ASCII限定の既存店舗バリデーターをそのまま流用すると1商品を落とす。
5. 2日更新の設定、公開データ、拡張の対象ホスト・ページマウント・配布資料を追加する。申請前には提出ZIPをローカルPlaywrightで実際に読み込み、既存店舗とM5Stackの実商品ページを確認する。

## 実装の検証基準

- Verify: 保存済み一覧3ページを読み、サイトマップのパスを一度デコードして集合照合する。Expect: 664商品・706variants・差分0件。Unicode商品も有効な商品キー・URLへ変換される。
- Verify: USDの5.50 / 7.95、無効な小数桁、複数variant、available欠落・falseのテストを実行する。Expect: 550 / 795セント、無効値拒否、構成情報保持、欠落を在庫ありにしない。
- Verify: ページ取得失敗・上限到達・同一ページ反復・サイトマップ不一致を模擬する。Expect: complete:falseで終了し、部分取得を掲載終了へ変換しない。
- Verify: ローカルfixtureで収集→保存→公開→拡張表示を確認する。Expect: USD小数2桁・観測日時・数量非公開・初期ライトと保存テーマが表示され、既存JPY表示も維持される。
- Verify: 提出ZIPのローカルPlaywright確認をCLAUDE.mdの手順で実施する。Expect: manifestの版一致、ライブ表示成功、画像の目視確認、検証プロセス残存0件。

## 証跡

`C:/Users/developer/tmp/electro-m5stack/` にrobots.txt、サイトマップ、一覧JSON3ページ、商品HTML1件、research.cjs、summary.json、summary-normalized.jsonを保存。
初回TKW run `8f4384b2a228539ca861d8584342b0b8` はURLエンコード差の検査でexit 1。ネットワーク再取得はせず、保存データで正規化を適用した検査がexit 0、差分0件となった。調査用nodeプロセス残存0件を確認。実装テストやブラウザー検証を完了したという意味ではない。
