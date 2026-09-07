# Electronics Price History (electro-parts)

日本の電子部品通販サイトの商品ページに、**観測した価格・在庫表示・掲載状況の履歴**を表示するプロジェクトです。

- クローラーが定期的に(店舗ごとに月 1 回または週 1 回 → [ADR-0016](docs/adr/0016-per-store-observation-cadence.md))対象サイトのカタログを巡回して生スナップショットを保存し、
- 店舗ごとの SQLite に**変化点だけ**を取り込み、
- 静的 JSON(契約 v1)として GitHub Pages に公開し、
- Tampermonkey ユーザースクリプト **Electronics Price History** が商品ページにパネルを差し込みます。

対象は **秋月電子通商**(`akizuki`、一覧ページの HTML)と **スイッチサイエンス**(`switch-science`、Shopify のカタログ JSON → [ADR-0014](docs/adr/0014-shopify-catalog-api-over-html.md))の 2 店舗です。aitendo は設計上の拡張点だけを用意し、実装していません([docs/roadmap/roadmap.md](docs/roadmap/roadmap.md))。

> データについて: 表示される値はこのプロジェクトが観測した時点の店頭表示の記録で、店舗の公式データではありません。観測間隔(秋月電子通商は約 1 か月、スイッチサイエンスは約 1 週間)の間の変化は記録されません。詳しくは [データの注意点](#データの注意点) を読んでください。

## 目次

- [ユーザースクリプトのインストール](#ユーザースクリプトのインストール)
- [アーキテクチャ](#アーキテクチャ)
- [静的データ契約 v1](#静的データ契約-v1)
- [ローカルでの実行](#ローカルでの実行)
- [GitHub Actions と公開](#github-actions-と公開)
- [テスト](#テスト)
- [性能予算と実測](#性能予算と実測)
- [データの注意点](#データの注意点)
- [プライバシーとセキュリティ](#プライバシーとセキュリティ)
- [新しい店舗を追加するには](#新しい店舗を追加するには)
- [設計判断(ADR)](#設計判断adr)

## ユーザースクリプトのインストール

1. ブラウザに [Tampermonkey](https://www.tampermonkey.net/) を入れる。
2. 公開サイトの `https://tsuyoshi-otake.github.io/electro-parts/electronics-price-history.user.js` を開き、インストールする。更新は `@updateURL` 経由で自動配信されます。
3. 対応店舗の商品ページを開くと「Electronics Price History」パネルが出ます。
4. パネル見出し横の「ライト」「ダーク」で表示モードを切り替えられます。初回はOS設定に従い、選択後は再読み込みや対応店舗の移動後も設定を保持します。
   - 秋月電子通商 `https://akizukidenshi.com/catalog/g/g<通販コード>/` → 購入エリアの下。
   - スイッチサイエンス `https://www.switch-science.com/products/<handle>`(`/collections/<コレクション>/products/<handle>` も同じ商品として扱います)→ 商品情報の 2 段組みの下。

パネルの内容:

- 現在の記録価格、前回の記録価格からの変化(差額と %)、観測期間内の最低〜最高
- 直近 30 / 90 / 365 日の最低・最高
- 最新の在庫表示(店舗表示の在庫数を含む)
- 段階(ステップ)チャート。掲載が途切れた期間は線を切り、価格幅がある場合は帯で示します
- 変更点の一覧表(折りたたみ)、データの注意点、観測期間・データ版・取得時刻
- 対応表のある商品では、他店の同一商品・類似商品・要確認候補を分けて表示。販売条件まで確認済みの同一商品だけを共通グラフに重ね、記録価格差を表示します。その他は参考記録価格と商品リンクに留めます。

0.4.1 の対応表は 424 組です。同一商品は保存カタログ照合済み 293 組・未確定候補 3 組、類似商品は照合済み 108 組・候補 6 組、要確認は 14 組。Pico の MCU/無線/ヘッダーなど、13 の製品群で具体的な仕様差を示します。秋月 8,677 商品・SS 10,343 商品の保存カタログ全行から型番候補を探索していますが、現在の全商品や全別名を網羅したものではありません。詳細ページを全件再確認したという意味でもありません。

差額・重ね合わせの承認は、引き続き ATOM Lite と Arduino UNO R4 Minima の **2 組だけ**です。他は参考記録価格として、店舗ごとの観測日時・条件を表示します。関連リンクは省略せず、他商品の履歴取得は 1 ページ最大 8 商品・同時 2 件に制限します。設計は [ADR-0017](docs/adr/0017-cross-store-comparisons.md)、根拠ファイル・件数・更新手順は [ADR-0018](docs/adr/0018-reviewed-catalog-mapping-pipeline.md) を参照してください。

状態の表示: `最新`(今回取得)、`キャッシュ表示`(取得に失敗したので保存済みデータを表示)、`記録なし`(まだデータセットに含まれていない)、`取得できません`。取得に失敗してもページの動作は妨げません(fail-open)。

データ取得先を変えたいとき(自分でホストする場合)は、Tampermonkey のストレージに `dataBaseUrl` を `https://` の URL で設定します。`@connect` に無いホストは Tampermonkey が確認を出します。

## アーキテクチャ

```
Collector ─▶ Raw Snapshot ─▶ Store Snapshot Adapter ─▶ Common Normalized Domain
   (店舗別)      (gzip JSON)         (店舗別)                 (共通)
                                                            │
                                                            ▼
                                       Store-scoped SQLite(変化点履歴、隔離記録)
                                                            │
                                                            ▼
                                       Static Publisher ─▶ site/data/v1/… + site/state/
                                                            │
                                                            ▼ GitHub Pages
                                       Data Client(共通) ─▶ Store Page Adapter(店舗別) ─▶ History UI(共通)
```

| 層 | 場所 | 店舗を知っているか |
|---|---|---|
| Collector | `src/collectors/akizuki/`(一覧ページの正規表現パーサー)、`src/collectors/switch-science/`(Shopify のカタログ JSON)。丁寧な fetcher は共通で `src/collectors/politeFetcher.ts` | 店舗別 |
| Snapshot Adapter | `src/adapters/akizuki/`、`src/adapters/switch-science/`(生スキーマ → 共通ドメイン、在庫表現の解釈、capabilities) | 店舗別 |
| 共通ドメイン・履歴コア | `src/core/`(domain / price / history / stats / sanity / identity / validation) | 知らない |
| SQLite | `src/db/`(migrations、順序非依存の取り込み、在庫の保持期間、最終化と検証) | 知らない(`store_id` 列で分離) |
| Publisher | `src/publisher/`(契約 v1 型・検証・生成・原子的書き込み) | 知らない |
| Pipeline / CLI | `src/pipeline/`, `src/cli/main.ts` | 知らない(`config/<store>.json` とレジストリで解決) |
| 店舗レジストリ | `src/stores/`(`registry.ts` = adapter、`collectorRegistry.ts` = collector) | ここだけ |
| ユーザースクリプト共通コア | `userscript/core/`(dataClient、cache、controller、format)、`userscript/ui/`(panel、chart) | 知らない |
| Page Adapter | `userscript/adapters/akizuki.ts`、`userscript/adapters/switch-science.ts`、`registry.ts` | 店舗別 |

共通コアに `if (store === 'akizuki')` は存在しません(CI の grep と設計レビューで確認)。店舗差は `StoreCapabilities`(範囲価格の有無、在庫数の意味など)としてデータに載り、UI はそれを見て表示を変えます。実際に効いているのが在庫数で、秋月は表示在庫数を出し、スイッチサイエンスは公開していない(`inventoryQuantitySemantics: 'not_exposed'`)ので、パネルは在庫数の行そのものを出しません。

### ドメインの要点

- **同一性** は `(store_id, external_product_id)`。秋月では通販コードが、スイッチサイエンスでは Shopify の handle が `external_product_id` かつ `pageKey` です([ADR-0015](docs/adr/0015-shopify-handle-as-identity.md))。これはアダプター内の前提であり、共通コアは両者を別の文字列として扱います。店舗をまたぐ名寄せ、型番による自動マージはしません(handle の多くは `9381` のような数字で、秋月の通販コードと見た目が区別できません。同一性が店舗スコープである理由がこれです)。
- **Product と Offer**: 秋月は商品 = 1 オファー(`__default__`)。スイッチサイエンスは Shopify の variant を 1 オファーとし、variant ID をオファー ID にします(現在はすべて 1 variant ですが、2 つ目が付いた日に履歴が切れないため)。集約オファーは型と DB にあり、合成データでテストしています。
- **価格** は整数の最小通貨単位(JPY は円)。`state`(`exact` / `range` / `unavailable`)、`quoteKind`(`selling` / `compare_at`)、`taxTreatment`、`unitLabel`(`1個`、`1パック` など)を持ち、これらが履歴の**基準(basis)** を決めます。基準が違えば別の系列です(「1 個 100 円」と「1 袋 100 円」を同じ系列にしない)。
- **在庫** は `availability`(`in_stock`、`low_stock`、`out_of_stock`、`restocking`、`preparing`、`checking`、`discontinued`、`unknown`、`not_displayed`)、`purchasable`、`quantity` と `quantitySemantics`(`site_reported` / `unknown`)、`rawStatus`(元の文言)を保持します。
- **掲載(presence)**: 一覧から消えた商品は「掲載なし」として記録され、販売終了とは区別します。

### SQLite 履歴

- テーブルは店舗横断で共通、すべて `store_id` で分離。`stores`、`crawl_runs`(観測ごと)、`products` / `product_aliases` / `offers`、`price_bases` と系列ごとの変化点テーブル(`price_events`、`availability_events`、`presence_events`、`metadata_events`)、在庫数の `inventory_samples` / `inventory_rollups`、`rejected_runs`(隔離)。
- **取り込みは冪等かつ順序非依存**: 同じスナップショットを 2 回入れても変化なし、古い観測を後から入れても時系列順に入れた結果と同じ系列になります(プロパティテストで検証)。
- **変化点のみ保存**: 値が変わらない観測は行を増やしません。
- **在庫数** は変化点でも量が多いので保持期間(既定 400 日)と公開点数上限(既定 730)を持ちます。
- **不完全なスナップショットは取り込みません**(`complete: false` は validate 段階で拒否)。
- **健全性チェック**(件数 20 % 減、既知商品 20 % 消失、価格変更 30 % 超、価格不明 50 % 超)に落ちたスナップショットは `rejected_runs` に理由付きで隔離され、履歴は変わりません。

## 静的データ契約 v1

パス(`site/` 直下):

```
data/v1/stores/<storeId>/manifest.json
data/v1/stores/<storeId>/products/<pageKey>.json
state/state.json            最終化した SQLite のメタデータ(SHA-256、サイズ、スキーマ版、店舗別 run 数)
state/history.sqlite        次回クロールの入力(VACUUM 済み、integrity_check 済み)
electronics-price-history.user.js
```

`manifest.json` の主な項目: `contractVersion`(semver、破壊的変更でメジャーを上げ `data/v2/` に分離)、`datasetVersion`(取り込み済み run の集合から決まる 16 桁の版。すべてのファイルで同一)、`generatedAt`、`capabilities`、`observation`(run 数、最初と最新の観測時刻)、`productCount`、`productPathTemplate`、`versions`(SQLite スキーマ、ソースのスキーマ版)、`caveats`。

商品ファイルは変化点の**タプル配列**で小さく保ちます。

```jsonc
{
  "contractVersion": "1.0.0", "datasetVersion": "…", "storeId": "akizuki", "pageKey": "109951",
  "externalProductId": "109951", "generatedAt": "…",
  "metadata": { "name": "FT232RQ USBシリアル変換モジュールキット", "modelNumber": "AE-FT232RQ", "category": "…", "canonicalUrl": "…" },
  "offers": [{
    "externalOfferId": "__default__", "offerKind": "default",
    "presence": [[t, 1]],
    "segments": [{
      "basis": { "quoteKind": "selling", "taxTreatment": "tax_included", "currency": "JPY", "unitLabel": "1個" },
      "primary": true,
      "points": [[t0, "exact", 1150, 1150], [t1, "exact", 1200, 1200]],   // [時刻, state, min, max]
      "stats": { "current": …, "previousDistinct": …, "change": { "differenceMinor": 50, "percent": 4.35, "direction": "up" },
                 "observedMin": 1150, "observedMax": 1200, "changePointCount": 2, "windows": { "d30": …, "d90": …, "d365": … } }
    }],
    "availability": [[t, "in_stock", true, "site_reported", "在庫あり"]],
    "inventory": [[t, 781]]
  }],
  "caveats": ["observation_window", "sampling_interval", "absence_not_discontinued", "site_reported_quantity"]
}
```

契約の型と検証関数は `src/publisher/contract.ts` にあり、Publisher とユーザースクリプトが**同じコード**を使います。互換性ルールは [ADR-0007](docs/adr/0007-static-contract-v1.md)。

## ローカルでの実行

必要なもの: Node.js 26(`.node-version`)。SQLite は `node:sqlite` を使うので追加インストールは不要です。

```bash
npm ci
```

```bash
npm run typecheck
```

パイプライン全体(前回状態の取得 → クロール → 検証 → 取り込み → 生成 → 最終化 → 検証)を回す:

```bash
npm run pipeline -- --config config/akizuki.json --bootstrap
```

- `--bootstrap` は**公開済み状態が無いときだけ**許可されます。状態があるのに付けると失敗します。既に公開されているサイトに 2 店舗目を足すのはブートストラップ**ではありません**(`--bootstrap` なしの通常 run で、その店舗の run 数 0 から始まります)。
- 2 回目以降は `--bootstrap` なし。`config/<store>.json` の `previousStateUrl` から `state.json` と SQLite を取得し、SHA-256・サイズ・`integrity_check`・スキーマ版を検証してから使います。取得できなければ失敗します(履歴の巻き戻しを防ぐため)。
- ローカルで前回状態を渡すときは `--previous-dir site/state`。
- 保存済みスナップショットを取り込むときは `--snapshot snapshots/akizuki-….json.gz`(クロールをスキップ)。

### 2 店舗を 1 つのサイトに公開する

店舗は **SQLite 履歴・`state/` ディレクトリ・`site/` ツリー**の 3 つを共有します。だから**順番に**回し、後の店舗は前の店舗が最終化した状態から続けます。

```bash
node --import tsx src/cli/main.ts pipeline --config config/akizuki.json --previous-dir site/state
```

```bash
node --import tsx src/cli/main.ts pipeline --config config/switch-science.json --previous-dir site/state
```

- 同じ前回状態から**並行に**回してはいけません。後から最終化したほうが、もう一方の run を無かったことにします。
- 生成は自分の店舗のディレクトリ(`site/data/v1/stores/<storeId>/`)だけを置き換えるので、隣の店舗のデータセットは触りません。
- Pages はサイト全体を差し替えます。**ある店舗がこの run で何も書かなければ、公開サイトからその店舗が消えます。** 失敗した店舗は公開済み履歴から `--republish` で作り直してからデプロイします(ワークフローが自動でやります。下記)。この不変条件は `tests/integration/multi-store-pipeline.test.ts` が検証しています。

終了コード: `0` 公開可(published / unchanged)、`3` 隔離(quarantined、履歴は変わらず公開はされる)、`1` 失敗(何も公開しない)。レポートは `reports/pipeline-akizuki.json`、Markdown 要約は標準出力と `node --import tsx src/cli/main.ts summary --report reports/pipeline-akizuki.json`。

その他:

```bash
npm run crawl -- --config config/akizuki.json --out snapshots
```

```bash
npm run verify -- --config config/akizuki.json --site site
```

```bash
npm run build:userscript -- --out site --base-url https://tsuyoshi-otake.github.io/electro-parts
```

設定は `config/<storeId>.json`。共通のキーは `collector.userAgent`(識別可能な UA、連絡先入り)、`collector.minIntervalMs` / `jitterMs`(既定 1500 ms + 0〜750 ms)、`maxAttempts`、`timeoutMs`、`maxRequests`(1 回の上限)、`collector.maxUncoveredProducts`(サイトマップにあって本体の巡回に出なかった商品の許容数 → ADR-0012)、`sanity.*`(隔離しきい値)、`inventory.retentionDays` / `pointLimit`、`paths.*`、`previousStateUrl`。

店舗固有:

| キー | 店舗 | 意味 |
|---|---|---|
| `collector.listingKinds` | akizuki | 巡回する一覧の系統。`c` = 分類ツリー、`r` = ジャンルタグ。個々の slug はサイトマップから発見するので設定に書きません(ADR-0012) |
| `collector.maxPagesPerListing` | akizuki | 1 つの一覧で辿るページ数の上限 |
| `collector.collection` | switch-science | 巡回する Shopify コレクション。`all` = 公開中の全商品 |
| `collector.pageLimit` / `maxPages` | switch-science | カタログ JSON 1 ページの件数(Shopify の上限は 250)とページ数の上限 |
| `collector.maxSubSitemaps` | switch-science | サイトマップ索引から読む子サイトマップ数の上限 |

`maxUncoveredProducts` は店舗で桁が違います。秋月は 600(実測の残差 255 件はすべて販売終了で一覧から外れた商品)、スイッチサイエンスは 25(カタログ JSON とサイトマップは同じカタログの 2 つのビューなので、ずれは更新のラグぶんしか出ません)。

## GitHub Actions と公開

| ワークフロー | トリガー | 内容 |
|---|---|---|
| `crawl-publish.yml` | 毎月 1 日 20:17 UTC(2 日 05:17 JST)と毎週日曜 20:17 UTC(月曜 05:17 JST)、`workflow_dispatch`(`stores` = 観測する店舗を空白区切りで指定、空なら全部、`bootstrap`、`dry_run`、`snapshot_retention_days`、`reimport_snapshot_from_run` = 過去 run のスナップショットを再取り込みしてクロールを省く、`republish` = 公開済み履歴からサイトを作り直すだけで観測を増やさない) | 店舗を順に回す(後の店舗は前の店舗が最終化した状態から) → 履歴にあるのにサイトに無い店舗を `--republish` で復元 → Actions summary にレポート → `site/` にユーザースクリプトと index を追加 → サイトの完全性を検査 → 成果物アップロード(店舗ごとのスナップショット 90 日、レポートと状態 90 日)→ 完全なときだけ Pages へデプロイ → 公開後に店舗ごとの `datasetVersion` を確認 |
| `ci.yml` | push(main)、pull_request、手動 | `npm audit`、typecheck、vitest(全プロジェクト)、ユーザースクリプトのビルドと禁止 API・CDN 参照の検査、Playwright E2E、Stryker(PR 以外) |

- 公開は `pages-publish` の concurrency グループで**単一ライター**。実行中の公開はキャンセルされず、後続はキューに入ります。
- 店舗は 1 つの job の中で**直列**に回ります。共有するのは 1 つの SQLite と 1 つの `state/` なので、並行にすると後から最終化したほうが他方の run を捨てます。ワークフローは 1 店舗目のあと `--previous-dir site/state` を足して連結します。
- **1 店舗が失敗しても、走った店舗の公開は止めません。** ただしデプロイはサイト全体の差し替えなので、失敗した店舗をそのままにすると公開データが消えます。そこで、履歴に run がある(`state.json` の `stores.<id>.runCount > 0`)のにサイトにマニフェストが無い店舗を `--republish` で作り直し、それでも欠けていればゲートがデプロイを**拒否**します(fail-closed)。ジョブ自体は失敗した店舗があれば最後に失敗します。
- **どの schedule がどの店舗を観測するかは cron には書いてありません。** 起動した cron の周期(月次 / 週次)と、各 `config/<store>.json` の `observation.cadence` を突き合わせて選びます。選ばれなかった店舗は `--republish` で維持されるので、公開サイトから消えることはありません。現在は秋月電子通商 = 月 1(1 run 約 2,700 リクエスト)、スイッチサイエンス = 週 1(約 54 リクエスト)([ADR-0016](docs/adr/0016-per-store-observation-cadence.md))。
- Pages への反映は 1 つのアーティファクト(データ + 状態 + ユーザースクリプト)で行うので、読者が中途半端なデータセットを見ることはありません(原子的公開)。
- SQLite は git にコミットしません。最終化した DB は Pages の `state/` に公開し、次回の入力になります。バックアップは Actions の成果物(90 日)。ロールバックは「該当 run の `state-<run id>` 成果物を `--previous-dir` で読み直して公開する」手順([docs/runbook.md](docs/runbook.md))。
- 権限は最小(`contents: read`、デプロイジョブだけ `pages: write` + `id-token: write`)。アクションはコミット SHA でピン留め。シークレットは使いません。

## テスト

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run test:mutation
```

```bash
npm run bench
```

| 種類 | 場所 | 内容 |
|---|---|---|
| ユニット | `tests/unit/` | 価格正規化、在庫文言、履歴コア、統計、一覧パーサー、Shopify カタログの読み取りと handle の検証、丁寧な fetcher、設定 |
| プロパティ(fast-check) | `tests/property/` | 取り込み順序非依存、系列の不変条件、パーサーの頑健性 |
| DB | `tests/db/` | 冪等取り込み、変化点、在庫保持、隔離、メタデータ変化 |
| 契約 | `tests/contract/` | 生成物の検証、決定性(同じ DB → 同じ `datasetVersion`) |
| 統合 | `tests/integration/` | 保存済み一覧ページ / 偽 Shopify ストアに対するクロール、**実データ**(2026-08-02 と 2026-09-06 の秋月全量スナップショット。FT232RQ キット 109951: 1150 → 1200 円、RE-280RA 106438: 250 → 280 円。スイッチサイエンスは 2026-09-07 の 10,382 商品)、パイプラインの状態機械、**2 店舗が 1 つのサイトを共有する場合**(後発店舗の合流、1 サイクルで両方の履歴を進める、失敗した店舗を republish で戻す) |
| ユーザースクリプト(jsdom) | `tests/userscript/` | キャッシュ/LRU、SWR、Page Adapter、コントローラー、チャート |
| E2E(Playwright) | `tests/e2e/` | ビルド済みユーザースクリプトを**保存済み**商品ページ(秋月とスイッチサイエンス)で実行。両オリジンとも route interception で提供し、本物のサイトには触れません。キャッシュ再利用、障害時の fail-open、未収録商品、コレクション URL 経由の同一性、そして**自分の店舗のデータセットしか読まないこと**を検証 |
| 変異(Stryker) | `stryker.config.mjs` | `src/core/` の履歴・価格・統計・健全性・同一性・時刻 |
| ベンチ | `tests/bench/run-bench.ts` | 合成カタログで 1 / 3 / 5 年分を毎日取り込み(実運用より高頻度の上限側テスト) |

Playwright は初回に `npx playwright install chromium` が必要です。

実績: ユニット〜統合 323 テスト(32 ファイル、15 s)、E2E 7 テスト(10 s)、変異スコア **89.60 %**(704 変異体: killed 595 / timeout 8 / survived 60 / no coverage 10 / ignored 31、しきい値 break 70)。

## 性能予算と実測

予算(秋月約 13,000 商品 + スイッチサイエンス約 10,400 商品):

| 項目 | 予算 |
|---|---|
| 1 回のクロール(秋月) | サイトマップ 7 + 分類ツリー 458 一覧(約 780 ページ)+ ジャンルタグ 1,412 一覧(約 1,940 ページ)、1.5〜2.25 s 間隔で約 85 分 |
| 1 回のクロール(スイッチサイエンス) | サイトマップ索引 1 + 商品サイトマップ 11 + カタログ JSON 42 ページ(`limit=250`)= 約 54 リクエスト、同じ間隔で約 2 分(ADR-0014) |
| 取り込み(1 スナップショット) | 5 年分の履歴があっても 10 s 以内 |
| 生成 + 書き込み | 30 s 以内 |
| 商品ファイル | 中央値 2 KB 以下、最大 64 KB 以下(5 年分) |
| データセット全体 | 5 年分で 50 MB 以下 |
| ユーザースクリプト | 1 商品ページで通信 2 回以下(マニフェスト + 商品)、キャッシュ有効時 0 回。バンドル 100 KB 以下 |
| Actions 実行時間 | 120 分以内(ジョブ上限 180 分) |

実測(`npm run bench -- --products 9000 --years 1,3,5 --interval-days 1`、Windows 11 / Node 26。合成データは毎日 1 % の価格変更、3 % の在庫表示変化、20 % の在庫数変動、0.2 % の掲載変化):

<!-- bench:start -->
| 期間 | run 数 | 取り込み p50 | p95 | 最大 | 取り込み合計 | 履歴読み出し | 生成 | 書き込み | 最終化 | SQLite | 静的データ | 最大の商品ファイル | 価格変化点 | ピーク RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 年 | 365 | 328.0 ms | 460.7 ms | 946.2 ms | 148.9 s | 840.1 ms | 97.5 ms | 5372.2 ms | 208.6 ms | 14.73 MB | 27.08 MB | 4.7 KB | 33,879 | 464.32 MB |
| 3 年 | 1,095 | 453.8 ms | 740.5 ms | 3841.4 ms | 610.2 s | 941.7 ms | 175.3 ms | 5473.0 ms | 493.5 ms | 35.39 MB | 32.23 MB | 6.4 KB | 72,756 | 562.75 MB |
| 5 年 | 1,825 | 413.3 ms | 719.9 ms | 4508.0 ms | 905.3 s | 877.9 ms | 95.2 ms | 4281.5 ms | 509.9 ms | 53.86 MB | 39.00 MB | 7.8 KB | 110,020 | 666.30 MB |

「取り込み合計」は履歴を作るために 365〜1,825 回の取り込みを連続で回した合計で、実運用では 1 run ぶん(p95 で 0.5〜0.8 秒)だけです。ベンチは 1 日 1 回の観測を仮定しているので、月 1 回・週 1 回(ADR-0013、ADR-0016)の実運用に対しては上限側の負荷です — 実際の 5 年は 1,825 run ではなく秋月で 60 run、スイッチサイエンスで 260 run 程度で、SQLite も静的データもこの表よりはるかに小さくなります。5 年の p50 が 3 年より小さいのは同じマシンでの測定ばらつき(他プロセスの影響)で、傾向としては履歴が伸びても取り込み時間はほぼ横ばいです。「最大」は SQLite が WAL/ページを整理する run に当たったときの値。

予算に対する実測(5 年時点): 取り込み 4.5 s < 10 s、生成 + 書き込み 4.4 s < 30 s、最大の商品ファイル 7.8 KB < 64 KB、静的データ 39.0 MB < 50 MB、SQLite 53.9 MB(Pages の 1 ファイル 100 MB 制限内)。すべて予算内です。
<!-- bench:end -->

観測頻度を上げたときのサイズも測りました(23,000 商品 × 5 年、観測のたびに 1 % の商品の価格が動く合成負荷なので上限側)。

| | 月 1(60 run) | 週 1(260 run) |
|---|---|---|
| SQLite | 19.37 MB | 37.65 MB |
| 配信サイト合計 | 40.64 MB | 49.87 MB |
| 価格変化点 | 35,399 | 70,958 |
| 取り込み p50 | 756.4 ms | 872.5 ms |
| 最大の商品ファイル | 2.3 KB | 3.3 KB |

観測回数は 4.33 倍でも配信サイズは 1.23 倍にしかなりません。変化点しか保存しないので、商品名や型番のような 1 商品あたりの固定費が観測回数で増えないからです。**頻度を決めているのはサイズではなく相手サイトへの負荷**です([ADR-0016](docs/adr/0016-per-store-observation-cadence.md))。

実データ(統合テストの保存済みスナップショット): 秋月は 2 run(2026-08-02、2026-09-06)から 8,809 商品ファイルを生成。これは 18 ジャンルを手書きしていた頃のスナップショットで、サイトマップ由来の巡回(ADR-0012)に切り替えたあとの公開データは 12,772 商品(datasetVersion `3ccce668810808ca`、2026-09-06〜09-07 の 2 run)。スイッチサイエンスは 2026-09-07 の実クロール(10,382 商品、カタログ 42 ページ、商品サイトマップ 11)から 60 商品を切り出したものを使い、`¥165` のカメラケーブルから `¥8,910,000` の装置まで、価格 0 円の 4 商品も含めて写像を検証しています。ユーザースクリプトのバンドルは 58,110 バイト(56.7 KiB、圧縮なし)。

## データの注意点

パネルとマニフェストの `caveats` に同じ内容が載ります。

- **observation_window**: 履歴はこのプロジェクトが観測を始めた日以降のものです。それ以前の価格は分かりません。
- **sampling_interval** / **sampling_interval_weekly**: 観測は約 1 か月に 1 回(秋月電子通商)または約 1 週間に 1 回(スイッチサイエンス)です。観測の間に起きた変化(短時間の値下げ、在庫の増減)は記録されません。「変化点の時刻」は**変化を初めて観測した時刻**で、実際に変わった時刻ではありません。どちらが付くかは店舗ごとにマニフェストの `caveats` に出ます([ADR-0016](docs/adr/0016-per-store-observation-cadence.md))。
- **absence_not_discontinued**: 一覧から消えたことは「掲載なし」と記録します。販売終了とは限りません(一時的な非掲載、ジャンル変更、クロール範囲外など)。
- **site_reported_quantity**: 在庫数は店舗が表示した数値そのものです。店舗側の集計ルールや倉庫の実数とは異なることがあります。
- **suspicious_identity**: 同じ商品コードで名前や型番が大きく変わった場合に付きます。コードの再利用の可能性があります。
- 価格は税込・表示単位あたりの販売価格です。数量割引や送料は含みません。

## プライバシーとセキュリティ

- ユーザースクリプトは **Cookie を使わず、テレメトリを送らず**、アクセス先は `@connect` に書かれたデータホスト(`tsuyoshi-otake.github.io`)だけです。閲覧中のページの内容は外に送りません(ページキーだけをデータ URL に使います)。
- 取得は `GM_xmlhttpRequest` の `anonymous` モード(Cookie なし)。キャッシュは Tampermonkey のストレージにあり、LRU で 200 商品まで。
- 描画は Shadow DOM 内で、`textContent` と DOM API だけを使います(`innerHTML` などは CI が禁止)。外部スクリプトや CDN は読み込みません。チャートは同梱の SVG 実装です。
- ページキーなど URL に入る文字列は `src/core/identity.ts` の安全な文字集合に限定し、Publisher はサイトルートの外に書きません。
- クローラーは連絡先入りの UA、1 リクエストずつ、1.5 s + ジッタの間隔、`Retry-After` 尊重、4xx は即中止。アクセス制御を回避する仕組みはありません。
- 依存は完全ピン留め、`npm audit` を CI で実行。`.npmrc` の `min-release-age=7` で公開 7 日未満のパッケージは採用しません。
- シークレットは不要です。Pages のデプロイは OIDC トークン(`id-token: write`)だけを使います。

## 新しい店舗を追加するには

共通コアを変えずに、次を足します(Phase 2 / 3 の手順そのもの)。

1. `src/adapters/<store>/`: 生スナップショットのスキーマ、`StoreSnapshotAdapter` 実装、`StoreCapabilities`。
2. `src/collectors/<store>/`: `StoreCollector` 実装(`politeFetcher` を使う)。
3. `src/stores/registry.ts` と `collectorRegistry.ts` に登録、`config/<store>.json` を追加。
4. `userscript/adapters/<store>.ts`: `StorePageAdapter`(URL 判定、ページキー抽出、差し込み位置)。`registry.ts` に登録すると `@match` が自動で増えます。
5. `.github/workflows/crawl-publish.yml` の `env.STORES` に店舗 ID を足し、スナップショット成果物のアップロード step を 1 つ足す。`STORES` に載せるだけで、パイプラインの実行・失敗時の復元・デプロイ前の完全性検査はすべて追随します。
6. テスト: 保存済みページのフィクスチャ、実データ統合テスト、E2E。

新しい店舗を既存のサイトに足すのは `--bootstrap` **ではありません**。公開済み状態を前回状態として通常どおり回すと、その店舗だけ run 数 0 から始まります。`--bootstrap` は状態がある限り拒否されます(他店舗の履歴を消さないため)。

共通コアに店舗名が現れたらレビューで差し戻します。

## 設計判断(ADR)

[docs/adr/](docs/adr/) に設計判断を記録しています。

| # | 題名 |
|---|---|
| [0001](docs/adr/0001-product-identity.md) | 商品の同一性は `(store_id, external_product_id)`、自動名寄せをしない |
| [0002](docs/adr/0002-common-domain-contract.md) | 共通ドメイン契約: 整数の最小通貨単位、価格の状態・税・単位、Product と Offer |
| [0003](docs/adr/0003-change-point-history-in-sqlite.md) | 店舗スコープの SQLite に変化点だけを順序非依存で取り込む |
| [0004](docs/adr/0004-fail-closed-completeness.md) | 不完全なクロールは取り込まない(fail-closed) |
| [0005](docs/adr/0005-quarantine-still-publishes.md) | 隔離されたスナップショットでも公開は続ける |
| [0006](docs/adr/0006-state-publication-on-pages.md) | SQLite は git に入れず、最終化した状態を Pages に公開して次回の入力にする |
| [0007](docs/adr/0007-static-contract-v1.md) | 静的データ契約 v1: 変化点のタプル、`datasetVersion`、メジャー版の分離 |
| [0008](docs/adr/0008-listing-page-regex-parser.md) | 一覧ページは DOM ライブラリでなく正規表現で読み、保存済みページで検証する |
| [0009](docs/adr/0009-polite-crawler-identification.md) | クローラーの識別と丁寧さ |
| [0010](docs/adr/0010-userscript-swr-cache.md) | ユーザースクリプトの stale-while-revalidate キャッシュと LRU |
| [0011](docs/adr/0011-userscript-rendering-safety.md) | Shadow DOM、`innerHTML` 禁止、CDN なし、fail-open |
| [0012](docs/adr/0012-sitemap-as-catalogue-authority.md) | クロール対象はサイトマップから発見し、カバレッジの正解として使う |
| [0013](docs/adr/0013-monthly-observation-cadence.md) | 観測頻度は 1 か月に 1 回 |
| [0014](docs/adr/0014-shopify-catalog-api-over-html.md) | Switch Science は HTML ではなく Shopify のカタログ JSON から読む |
| [0015](docs/adr/0015-shopify-handle-as-identity.md) | Switch Science の商品同一性は Shopify の handle、商品 ID と SKU はエイリアス |
| [0016](docs/adr/0016-per-store-observation-cadence.md) | 観測頻度は店舗ごとに宣言する(スイッチサイエンスは週 1、秋月は月 1) |
| [0017](docs/adr/0017-cross-store-comparisons.md) | 店舗横断の対応表と価格比較承認を分離する |
| [0018](docs/adr/0018-reviewed-catalog-mapping-pipeline.md) | 保存カタログの候補探索と承認済み対応表の再生成を分離する |

ライセンス: MIT。観測データは店舗の表示を記録したもので、権利は各店舗にあります。
