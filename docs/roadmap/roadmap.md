# ロードマップ

秋月電子通商・スイッチサイエンス・M5Stack公式ショップ・Raspberry Pi Shop by KSY・せんごくネット通販(電子工作部品)が**実装済み**、aitendo が**未実装**です。M5StackのUSD・全商品収集・バリエーション対応は [対応仕様](m5stack-support.md)、KSYの公開一覧の収集と商品ダイアログの扱いは [ADR-0023](../adr/0023-ksy-public-list-and-in-place-product-dialog.md) を参照してください。エレショップは収集規模と一括提供元が課題のため保留です。

## 拡張点(すでに用意されているもの)

| 層 | 拡張点 | 追加時に書くもの |
|---|---|---|
| Collector | `src/collectors/<store>/` | 店舗ごとの取得(HTML、JSON API)。`RawSnapshot` を返す。`politeFetcher` は再利用 |
| Store Snapshot Adapter | `src/adapters/<store>/snapshotAdapter.ts` | `RawSnapshot` → 共通 `NormalizedSnapshot`。`StoreCapabilities` の宣言 |
| Config | `config/<store>.json` | 収集パラメータ、健全性しきい値、`previousStateUrl` |
| Workflow | `.github/workflows/crawl-publish.yml` | `env.STORES` に店舗 ID を足し、スナップショット成果物の upload step を 1 つ足すだけ。店舗は 1 つの job の中で**直列**に回る(共有する SQLite と `state/` を並行に書けないため) |
| Userscript adapter | `userscript/adapters/<store>.ts` | `StorePageAdapter`(`matches`、`pageKey`、`mountPoint`、`storeId`)。`@match` の追加。ページ遷移なしで表示中の商品が変わる店舗は `watchPageKey` も書く(ADR-0023) |
| 静的契約 | `data/v1/stores/<store>/` | 変更不要。`manifest.json` の `capabilities` と `caveats` で店舗の性質を伝える |

共通コア(`src/core`、`src/db`、`src/publisher`、`src/pipeline`、`userscript/core`、`userscript/ui`)に店舗名を書かないことを CI が検査します。

## aitendo(未実装)

- 取得: 一覧ページはサーバー描画。ページ構造は秋月と異なるので専用パーサー。`external_product_id` は商品コード。
- ドメインへの写像で決めること:
  - 在庫は「参考在庫数」表示 → `quantitySemantics: 'approximate'`、`availability` は表示語彙から写像。
  - カテゴリが一覧に出ない → `category: null`、`capabilities.hasCategory: false`。
  - 税込 / 税抜表示の確認 → `taxTreatment`。
- 契約・DB・UI の変更: なし(想定)。

## スイッチサイエンス(実装済み)

共通コア・DB・静的契約はどれも変えずに入りました。計画と食い違った点を記録として残します。

- 取得: Shopify のカタログ JSON `/collections/all/products.json?limit=250&page=N`(ADR-0014)。実測 10,382 商品をカタログ 42 ページ + サイトマップ 12 リクエスト = 1 回あたり約 54 リクエストで取り切る。HTML パーサーは不要になった。
- **同一性は handle**(ADR-0015)。計画は `external_product_id` = 数値 product ID、`pageKey` = handle で「両者が別になる最初の店舗」としていたが、実際は両方 handle にした。ユーザースクリプトが URL から得られるのは handle だけで、数値 ID を選ぶと商品ページのマークアップを読むことになる — ADR-0014 で捨てた依存を、同一性の側から呼び戻すことになる。数値 ID と SKU はエイリアスとして記録する。
- 在庫数は `quantitySemantics: 'not_displayed'` ではなく **`'not_exposed'`**。一括カタログ API が返すのは `available` の真偽値だけで、数は「表示されていない」のではなく最初から無い。パネルは在庫数の行そのものを出さない。
- バリアント: 現在は全商品が 1 variant だが、オファー ID は `__default__` ではなく **variant ID** にした。2 つ目の variant が付いた日に唯一のオファーが消えて履歴が振り出しに戻るのを避けるため。集約 `range` オファーは未使用(型と DB には残っている)。
- ユーザースクリプト: `MutationObserver` の待ちは要らなかった。商品ページはサーバー描画で、canonical link も差し込み先も初回 HTML にある。`/collections/<コレクション>/products/<handle>` も同じ商品として扱い、canonical link とパスが食い違う画面は商品ページとして扱わない。

## Raspberry Pi Shop by KSY(実装済み)

共通コア・DB・静的契約は変えずに入りました。ユーザースクリプトの契約に、ページ遷移なしで商品が変わる画面のための省略可能な `watchPageKey` を足しました。

- 取得: 店舗の画面が使う公開一覧の JSON を、Cookie なしの GET で `offset` ごとに読みます(`page` は無視されます)。応答の `size` を全件の基準にし、ずれたら fail-closed で止めます。
- 範囲: 公開一覧(`onlist: 1`)だけです。ID は走査しません。一覧に出ない商品には顧客別の決済用商品が含まれるためです。
- 写像: 税込の円、表示された在庫数(`site_reported`)、`価格未定` とシリーズ一覧用の項目は価格なし。店舗間の対応表には0.5.1から入っています。
- 詳細: [ADR-0023](../adr/0023-ksy-public-list-and-in-place-product-dialog.md)

## せんごくネット通販(実装済み)

共通コア・DB・静的契約・ユーザースクリプトの契約は変えずに入りました。

- 範囲: 分類「電子工作部品」(`cid=3000`)の下だけです。分類の木は毎回その分類ページから読みます。
- 取得: 分類一覧(`search.php?cid=`)を 40 行ずつ読みます。検索は 4000 件までしか返さないため、4000 件と表示した分類はその下の分類ごとに読み、さらに下でも 4000 件なら fail-closed で止めます。各ページの「S件～E件(全T件)」で行数とページ送りを照合します。
- 記録するもの: 管理コード・商品名・メーカー・型番(画像の alt)・税込の価格欄の各行(表示どおり)・欠品の印・掲載の有無。説明文と画像は扱いません(利用規約第 7 条への配慮)。
- 写像: 価格欄の1行目の税込価格(同じ表記の行が金額違いで並べば幅、「価格お見積り」は価格なし)、在庫は数量なし(`not_exposed`)の在庫あり / 在庫なし。店舗間の対応表には0.6.1から入っています(類似商品は対象外)。
- 詳細: [ADR-0024](../adr/0024-sengoku-electronic-parts-category-listings.md)

## 店舗横断の商品照合(実装済み)

根拠をレビューした対応表と、同一商品・類似商品を分ける表示は実装済みです。正本は `data/matching/catalog.jsonl`、`reviews.json`、`families.json`、`legacy.json` で、ユーザースクリプトに組み込む `userscript/adapters/productRelations.ts` は生成物です。探索・レビュー・生成の手順とデータ項目は [ADR-0018](../adr/0018-reviewed-catalog-mapping-pipeline.md)、UI と価格取得の境界は [ADR-0017](../adr/0017-cross-store-comparisons.md) を参照してください。

- 商品の同一性・類似性と、価格比較の承認は別に管理する。候補件数を価格比較可能件数として扱わない。
- 他店の履歴は別カードとして表示し、店舗ごとの商品履歴へ混ぜない。
- 対応表の変更は正本のレビュー記録を更新して `npm run matching:build` で生成し、`npm run matching:check` で整合性を確認する。

今後は、未調査メーカーと未照合商品の調査、根拠の更新、店舗追加に伴う対応表の拡張を行います。KSYでは、店舗接頭辞付きのCM4発注コード・店舗独自コードの商品・類似商品が未照合です（[照合範囲](three-store-mapping.md#051-ksyの追加2026-10-29判定)）。せんごくでは、メーカー表示のない接頭辞付き型番・商品名の【N】だけで結びつく組・類似商品が未照合です（[照合範囲](three-store-mapping.md#061-せんごくの追加2026-10-30判定)）。商品仕様・販売数量・価格条件の証拠が足りない候補は、確定表示や価格差表示へ昇格させません。

## 契約 v2 の候補(必要になるまで作らない)

- 価格ティア(数量割引・包装違い)の公開。せんごくネット通販は保存データにだけ価格欄の全行を残している。
- 異なる通貨間の価格比較（USDそのものの記録・表示はv1、現在の記録価格への円換算の参考値は0.4.8で対応済み。[ADR-0022](../adr/0022-yen-reference-from-daily-exchange-rate.md)）。
- 商品ファイルの分割(5 年以上、変化点が数千を超える商品)。

## やらないこと

- 購入・カート・ログインを伴う操作。
- 会員価格やクーポン価格の収集。
- アクセス制御の回避。
