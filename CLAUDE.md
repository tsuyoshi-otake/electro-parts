# electro-parts

電子部品 EC の価格・在庫・掲載履歴を集めて GitHub Pages に静的公開し、Tampermonkey で商品ページに履歴を出すプロジェクト。Phase 1 は秋月電子通商のみ。

- 全体像と実行方法: [README.md](README.md)
- 設計判断: [docs/adr/](docs/adr/README.md)
- 運用: [docs/runbook.md](docs/runbook.md)、拡張: [docs/roadmap/roadmap.md](docs/roadmap/roadmap.md)
- 過去にこのリポジトリに置いていたローカル向けカタログ JSON(gitignore 対象)の説明: [docs/local-catalog-snapshots.md](docs/local-catalog-snapshots.md)

## 作業ルール

- 共通コア(`src/core`、`src/db`、`src/publisher`、`src/pipeline`、`userscript/core`、`userscript/ui`)に店舗名を書かない。店舗固有の知識は `src/adapters/<store>`、`src/collectors/<store>`、`userscript/adapters` に置く。CI が検査する。
- ユーザースクリプトで `innerHTML` 等の HTML 文字列シンクと CDN を使わない。CI が検査する。
- `.claude/memory/rules.md` を作業開始時に読む。学びは `journal.md` に追記する。
- テストは `npm test`(vitest)、`npm run test:e2e`(Playwright、保存済みページ)、`npm run test:mutation`(Stryker、コアのみ)。ライブサイトへのアクセスはテストに含めない。
- 依存の追加は公開後 7 日以上経った版のみ。lockfile をコミットする。

## 店舗横断の商品照合・比較候補

- 0.4.1以降の正本は `data/matching/catalog.jsonl`、`reviews.json`、`families.json`、`legacy.json`。`userscript/adapters/productRelations.ts` は生成物なので直接編集しない。`npm run matching:discover` で探索、明示的な根拠確認後に `matching:build` / `matching:check`。入力の変更をフィンガープリントの一括追認で通さない。詳細は [ADR-0018](docs/adr/0018-reviewed-catalog-mapping-pipeline.md)。

- **少数サンプルを全候補と扱わない。** 調査した店舗・メーカー・カテゴリ、対象件数、重複除外後の候補数、未調査範囲を記録する。件数上限で打ち切った結果は「初回サンプル」と明記し、主要メーカー別の件数・未照合商品を確認してから候補一覧を提示する。委任した場合も統合側がこの確認を行う。
- 候補探索は `name`、`modelNumber`、利用可能なら `manufacturerName` / `manufacturerProductCode` / `manufacturerProductName` / `vendor` を併用する。保存済みカタログと現行コレクターではフィールドが違うため、実際のスキーマを確認する。まず件数・分布を出し、絞った候補だけを表示する。
- **店舗側の型番接頭辞をメーカー型番の相違と即断しない。** M5Stackでは秋月の `M5STACK-C008` とSSの `C008` のような表記差がある。メーカー・商品名の対応を確認したM5Stack候補に限定して先頭の `M5STACK-` を正規化し、元の型番も保持する。このルールを他メーカーへ無条件に適用しない。
- **バージョン・構成を表す末尾は削らない。** `K001` と `K001-V27`、`C008-B` と `C008-B-V11` は別候補として扱う。容量、無線有無、端子、ヘッダー実装、ファームウェア書込状態、付属品も照合する。片側の記載不足は「情報不足」であり、相違の証明ではない。
- M5Stack系は商品名の「M5Stack」だけで検索しない。ATOM、M5Stamp、M5Stick、NanoC6等も型番・メーカー情報から拾う。2026-09-07の再調査では、秋月2026-09-06版の `M5STACK-` 型番20商品に対し、SS2026-08-02版で上記正規化による型番一致が18組あった。これは当時の保存データでの候補数であり、固定の総数や同一性の承認ではない。
- 型番一致しない名前の近似候補も別枠で残す。例: `M5STACK-LIGHT-UNIT` ↔ `U021`、`M5STACK-BATTERY` ↔ `M002` は別名対応の確認が必要。名前や価格だけで同一商品へ昇格させない。
- **商品同一性と価格比較可否を分ける。** 税・通貨・販売数量・セット構成・対象variant・数量割引を確認する。SSの単一variantや `prices.minYen` は「1個売り」の証明ではなく、10個パックの場合もある。条件不明なら参考価格・商品リンクに留め、差額や最安表示を出さない。各店舗の観測日時を示し、保存価格を現在価格と呼ばない。
- 照合結果には店舗別商品ID・URL・元型番・根拠・不足情報・元データ取得日時・判定日時を保持する。LLMを使った場合はモデルと原判定も残す。下記の分類と確認状態を分け、重複を除き、商品IDを元データと突合する。詳細未確認の候補を本番用対応表へ自動採用しない。

### 同一商品・類似商品の分類

- **同一商品 (`same_product`)**: メーカー・製品型番・リビジョン・本体仕様が対応する同じ製品。店舗接頭辞や名称の表記差だけなら同一商品にできる。販売数量・同梱品・書込サービス等の販売条件は別途記録し、違いまたは不足があれば価格比較は未承認にする。メーカーが別型番にした構成違いは同一商品へまとめない。
- **類似商品 (`similar_product`)**: 用途・主要機能が近く、比較対象にする根拠がある別製品、またはバージョン・容量・無線有無・端子・実装等の構成が異なる製品。共通点と具体的な相違点を必ず併記する。「類似」は互換性・置き換え可能性の保証ではなく、互換性が未確認ならそう明記する。商品名が似ているだけでは採用しない。
- **要確認 (`unresolved`)**: 同一性・類似性を裏付ける情報が不足する場合。確認状態 (`reviewStatus`: `candidate` / `verified` / `needs_review`) と不足情報を残す。型番一致の暫定候補は `same_product` + `candidate` として保持できるが、確定表示はしない。既存の `insufficient_evidence` は情報不足だけを理由に類似商品へ振り分けない。
- **対象外 (`unrelated`)**: 比較する根拠がない商品。既存の `different_configuration` は用途・差分を確認して類似商品へ再分類し、`different_product` も「別製品」というだけで対象外や類似商品へ一括変換しない。
- 結果の提示は「同一商品」「類似商品」を分け、それぞれ確認状態を示す。要確認は別枠、対象外は通常の候補一覧から除外する。類似商品は同一商品の価格履歴へ混ぜず、別カード等に共通点・相違点・商品リンクを表示する。価格比較可否 (`priceComparable`) は分類・確認状態とは独立に判定する。
- この節は調査・対応表・表示設計のルール。実装範囲は [ADR-0017](docs/adr/0017-cross-store-comparisons.md) を参照し、候補件数を価格比較可能件数と混同しない。過去の照合ファイルを再分類する際は元判定を保持して再評価する。
