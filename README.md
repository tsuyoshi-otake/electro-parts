# Electronics Price History (electro-parts)

日本の電子部品通販サイトの商品ページに、**観測した価格・在庫表示・掲載状況の履歴**を表示するプロジェクトです。

- クローラーが 1 日 1 回、対象サイトのカタログ一覧ページを巡回して生スナップショットを保存し、
- 店舗ごとの SQLite に**変化点だけ**を取り込み、
- 静的 JSON(契約 v1)として GitHub Pages に公開し、
- Tampermonkey ユーザースクリプト **Electronics Price History** が商品ページにパネルを差し込みます。

Phase 1 の対象は **秋月電子通商**(`akizuki`)のみです。Phase 2(aitendo)、Phase 3(スイッチサイエンス)は設計上の拡張点だけを用意し、実装していません([docs/roadmap/roadmap.md](docs/roadmap/roadmap.md))。

> データについて: 表示される値はこのプロジェクトが観測した時点の店頭表示の記録で、店舗の公式データではありません。観測間隔(約 1 日)の間の変化は記録されません。詳しくは [データの注意点](#データの注意点) を読んでください。

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
3. 秋月電子通商の商品ページ(`https://akizukidenshi.com/catalog/g/g<通販コード>/`)を開くと、購入エリアの下に「Electronics Price History」パネルが出ます。

パネルの内容:

- 現在の記録価格、前回の記録価格からの変化(差額と %)、観測期間内の最低〜最高
- 直近 30 / 90 / 365 日の最低・最高
- 最新の在庫表示(店舗表示の在庫数を含む)
- 段階(ステップ)チャート。掲載が途切れた期間は線を切り、価格幅がある場合は帯で示します
- 変更点の一覧表(折りたたみ)、データの注意点、観測期間・データ版・取得時刻

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
| Collector | `src/collectors/akizuki/`(一覧ページの正規表現パーサー、丁寧な fetcher は `src/collectors/politeFetcher.ts`) | 店舗別 |
| Snapshot Adapter | `src/adapters/akizuki/`(生スキーマ → 共通ドメイン、在庫文言の解釈、capabilities) | 店舗別 |
| 共通ドメイン・履歴コア | `src/core/`(domain / price / history / stats / sanity / identity / validation) | 知らない |
| SQLite | `src/db/`(migrations、順序非依存の取り込み、在庫の保持期間、最終化と検証) | 知らない(`store_id` 列で分離) |
| Publisher | `src/publisher/`(契約 v1 型・検証・生成・原子的書き込み) | 知らない |
| Pipeline / CLI | `src/pipeline/`, `src/cli/main.ts` | 知らない(`config/<store>.json` とレジストリで解決) |
| 店舗レジストリ | `src/stores/`(`registry.ts` = adapter、`collectorRegistry.ts` = collector) | ここだけ |
| ユーザースクリプト共通コア | `userscript/core/`(dataClient、cache、controller、format)、`userscript/ui/`(panel、chart) | 知らない |
| Page Adapter | `userscript/adapters/akizuki.ts`、`registry.ts` | 店舗別 |

共通コアに `if (store === 'akizuki')` は存在しません(CI の grep と設計レビューで確認)。店舗差は `StoreCapabilities`(範囲価格の有無、在庫数の意味など)としてデータに載り、UI はそれを見て表示を変えます。

### ドメインの要点

- **同一性** は `(store_id, external_product_id)`。秋月では通販コードが `external_product_id` かつ `pageKey`(URL の `g<コード>`)です。これはアダプター内の前提であり、共通コアは両者を別の文字列として扱います。店舗をまたぐ名寄せ、型番による自動マージはしません。
- **Product と Offer**: Phase 1 の秋月は商品 = 1 オファー(`__default__`)。バリアント・集約オファーは型と DB にあり、合成データでテストしています。
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

- `--bootstrap` は**公開済み状態が無いときだけ**許可されます。状態があるのに付けると失敗します。
- 2 回目以降は `--bootstrap` なし。`config/akizuki.json` の `previousStateUrl` から `state.json` と SQLite を取得し、SHA-256・サイズ・`integrity_check`・スキーマ版を検証してから使います。取得できなければ失敗します(履歴の巻き戻しを防ぐため)。
- ローカルで前回状態を渡すときは `--previous-dir site/state`。
- 保存済みスナップショットを取り込むときは `--snapshot snapshots/akizuki-….json.gz`(クロールをスキップ)。

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

設定 `config/akizuki.json` の主なキー: `collector.userAgent`(識別可能な UA、連絡先入り)、`collector.minIntervalMs` / `jitterMs`(既定 1500 ms + 0〜750 ms)、`maxAttempts`、`maxRequests`(1 回の上限)、`sanity.*`(隔離しきい値)、`inventory.retentionDays` / `pointLimit`、`paths.*`、`previousStateUrl`。

## GitHub Actions と公開

| ワークフロー | トリガー | 内容 |
|---|---|---|
| `crawl-publish.yml` | 毎日 20:17 UTC(05:17 JST)、`workflow_dispatch`(`bootstrap`、`dry_run`、`snapshot_retention_days`) | パイプライン → Actions summary にレポート → `site/` にユーザースクリプトと index を追加 → 検証 → 成果物アップロード(スナップショット 30 日、レポートと状態 90 日)→ `publishable` のときだけ Pages へデプロイ → 公開後にマニフェストの `datasetVersion` を確認 |
| `ci.yml` | push(main)、pull_request、手動 | `npm audit`、typecheck、vitest(全プロジェクト)、ユーザースクリプトのビルドと禁止 API・CDN 参照の検査、Playwright E2E、Stryker(PR 以外) |

- 公開は `pages-publish` の concurrency グループで**単一ライター**。実行中の公開はキャンセルされず、後続はキューに入ります。
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
| ユニット | `tests/unit/` | 価格正規化、在庫文言、履歴コア、統計、一覧パーサー、丁寧な fetcher、設定 |
| プロパティ(fast-check) | `tests/property/` | 取り込み順序非依存、系列の不変条件、パーサーの頑健性 |
| DB | `tests/db/` | 冪等取り込み、変化点、在庫保持、隔離、メタデータ変化 |
| 契約 | `tests/contract/` | 生成物の検証、決定性(同じ DB → 同じ `datasetVersion`) |
| 統合 | `tests/integration/` | 保存済み一覧ページに対するクロール、**実データ**(2026-08-02 と 2026-09-06 の秋月全量スナップショット。FT232RQ キット 109951: 1150 → 1200 円、RE-280RA 106438: 250 → 280 円)、パイプラインの状態機械 |
| ユーザースクリプト(jsdom) | `tests/userscript/` | キャッシュ/LRU、SWR、Page Adapter、コントローラー、チャート |
| E2E(Playwright) | `tests/e2e/` | ビルド済みユーザースクリプトを**保存済み**商品ページで実行。両オリジンとも route interception で提供し、本物のサイトには触れません。キャッシュ再利用、障害時の fail-open、未収録商品を検証 |
| 変異(Stryker) | `stryker.config.mjs` | `src/core/` の履歴・価格・統計・健全性・同一性・時刻 |
| ベンチ | `tests/bench/run-bench.ts` | 合成カタログで 1 / 3 / 5 年分を毎日取り込み |

Playwright は初回に `npx playwright install chromium` が必要です。

実績: ユニット～統合 204 テスト（22 ファイル、13 s）、E2E 3 テスト（7 s）、変異スコア **89.45 %**（704 変異体: killed 595 / timeout 7 / survived 61 / no coverage 10、しきい値 break 70）。

## 性能予算と実測

予算(Phase 1、秋月約 8,800 商品):

| 項目 | 予算 |
|---|---|
| 1 回のクロール | 18 ジャンル・約 200 ページ、1.5〜2.25 s 間隔で 10 分以内 |
| 取り込み(1 スナップショット) | 5 年分の履歴があっても 10 s 以内 |
| 生成 + 書き込み | 30 s 以内 |
| 商品ファイル | 中央値 2 KB 以下、最大 64 KB 以下(5 年分) |
| データセット全体 | 5 年分で 50 MB 以下 |
| ユーザースクリプト | 1 商品ページで通信 2 回以下(マニフェスト + 商品)、キャッシュ有効時 0 回。バンドル 100 KB 以下 |
| Actions 実行時間 | 30 分以内 |

実測(`npm run bench -- --products 9000 --years 1,3,5 --interval-days 1`、Windows 11 / Node 26。合成データは毎日 1 % の価格変更、3 % の在庫表示変化、20 % の在庫数変動、0.2 % の掲載変化):

<!-- bench:start -->
(ベンチ結果はこの下に貼ります)
<!-- bench:end -->

実データ: 2 run(2026-08-02、2026-09-06)から 8,809 商品ファイルを生成し、ユーザースクリプトのバンドルは約 49.6 KB(圧縮なし)。

## データの注意点

パネルとマニフェストの `caveats` に同じ内容が載ります。

- **observation_window**: 履歴はこのプロジェクトが観測を始めた日以降のものです。それ以前の価格は分かりません。
- **sampling_interval**: 観測は約 1 日 1 回です。観測の間に起きた変化(短時間の値下げ、在庫の増減)は記録されません。「変化点の時刻」は**変化を初めて観測した時刻**で、実際に変わった時刻ではありません。
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
5. テスト: 保存済みページのフィクスチャ、実データ統合テスト、E2E。

共通コアに店舗名が現れたらレビューで差し戻します。

## 設計判断(ADR)

[docs/adr/](docs/adr/) に 11 本あります。

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

ライセンス: MIT。観測データは店舗の表示を記録したもので、権利は各店舗にあります。
