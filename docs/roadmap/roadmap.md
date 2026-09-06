# ロードマップ

Phase 1(秋月電子通商)が完了した状態からの拡張計画。**Phase 2 / 3 は未実装**で、ここに書くのは「共通コアを変えずに追加できること」と「追加時に決めるべきこと」の整理です。

## 拡張点(すでに用意されているもの)

| 層 | 拡張点 | 追加時に書くもの |
|---|---|---|
| Collector | `src/collectors/<store>/` | 店舗ごとの取得(HTML、JSON API)。`RawSnapshot` を返す。`politeFetcher` は再利用 |
| Store Snapshot Adapter | `src/adapters/<store>/snapshotAdapter.ts` | `RawSnapshot` → 共通 `NormalizedSnapshot`。`StoreCapabilities` の宣言 |
| Config | `config/<store>.json` | 収集パラメータ、健全性しきい値、`previousStateUrl` |
| Workflow | `.github/workflows/crawl-publish.yml` | 店舗ごとの job または matrix。Pages のデプロイは 1 つの job にまとめる(単一ライター) |
| Userscript adapter | `userscript/adapters/<store>.ts` | `StorePageAdapter`(`matches`、`pageKey`、`mountPoint`、`storeId`)。`@match` の追加 |
| 静的契約 | `data/v1/stores/<store>/` | 変更不要。`manifest.json` の `capabilities` と `caveats` で店舗の性質を伝える |

共通コア(`src/core`、`src/db`、`src/publisher`、`src/pipeline`、`userscript/core`、`userscript/ui`)に店舗名を書かないことを CI が検査します。

## Phase 2: aitendo

- 取得: 一覧ページはサーバー描画。ページ構造は秋月と異なるので専用パーサー。`external_product_id` は商品コード。
- ドメインへの写像で決めること:
  - 在庫は「参考在庫数」表示 → `quantitySemantics: 'approximate'`、`availability` は表示語彙から写像。
  - カテゴリが一覧に出ない → `category: null`、`capabilities.hasCategory: false`。
  - 税込 / 税抜表示の確認 → `taxTreatment`。
- 契約・DB・UI の変更: なし(想定)。

## Phase 3: スイッチサイエンス

- 取得: Shopify。`/products.json?limit=250&page=N` の JSON API が使えれば HTML パーサーは不要(利用規約と robots を確認してから)。
- ドメインへの写像で決めること:
  - `external_product_id` = Shopify product ID、`pageKey` = handle。**両者が別**になる最初の店舗。`manifest.productPathTemplate` は `pageKey` を使うので静的側は変更不要。
  - バリアントごとの価格 → `Offer(kind: 'variant')` を複数。集約表示は `range` 状態の `aggregate` オファー。型は Phase 1 で用意済みで合成データのテストがある。
  - 在庫数は非公開 → `quantity: null`、`quantitySemantics: 'not_displayed'`。
- ユーザースクリプト: 商品ページ URL `/products/<handle>` から `pageKey` を取る。Shopify テーマは非同期描画が多いので `MutationObserver` の待ちが効く。

## 店舗横断の商品対応付け(Phase 4 以降、設計方針だけ)

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
