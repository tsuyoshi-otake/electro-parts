# ロードマップ

秋月電子通商とスイッチサイエンスが**実装済み**、aitendo が**未実装**です。ここに書くのは「共通コアを変えずに追加できること」と「追加時に決めるべきこと」の整理です。

## 拡張点(すでに用意されているもの)

| 層 | 拡張点 | 追加時に書くもの |
|---|---|---|
| Collector | `src/collectors/<store>/` | 店舗ごとの取得(HTML、JSON API)。`RawSnapshot` を返す。`politeFetcher` は再利用 |
| Store Snapshot Adapter | `src/adapters/<store>/snapshotAdapter.ts` | `RawSnapshot` → 共通 `NormalizedSnapshot`。`StoreCapabilities` の宣言 |
| Config | `config/<store>.json` | 収集パラメータ、健全性しきい値、`previousStateUrl` |
| Workflow | `.github/workflows/crawl-publish.yml` | `env.STORES` に店舗 ID を足し、スナップショット成果物の upload step を 1 つ足すだけ。店舗は 1 つの job の中で**直列**に回る(共有する SQLite と `state/` を並行に書けないため) |
| Userscript adapter | `userscript/adapters/<store>.ts` | `StorePageAdapter`(`matches`、`pageKey`、`mountPoint`、`storeId`)。`@match` の追加 |
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

## 店舗横断の商品対応付け(将来、設計方針だけ)

自動名寄せはしない(ADR-0001)。やるなら:

- 対応表は**明示的なデータ**(`crosswalk/v1/<a>-<b>.json` のような別契約)として、根拠(メーカー型番の一致、人手確認)と付けた日時を持つ。
- UI は「他店の同じ商品」を別パネルまたはリンクで出し、履歴を混ぜない。
- 対応表の誤りは削除で戻せる(履歴は各店舗に残っているため)。

## 契約 v2 の候補(必要になるまで作らない)

- 価格ティア(数量割引)。せんごく通商のような店舗で必要。
- 複数通貨。
- 商品ファイルの分割(5 年以上、変化点が数千を超える商品)。

## やらないこと

- 購入・カート・ログインを伴う操作。
- 会員価格やクーポン価格の収集。
- アクセス制御の回避。
