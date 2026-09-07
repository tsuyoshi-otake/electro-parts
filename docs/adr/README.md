# Architecture Decision Records

| # | 題名 | 状態 |
|---|---|---|
| 0001 | [商品の同一性は `(store_id, external_product_id)`、自動名寄せをしない](0001-product-identity.md) | 採用 |
| 0002 | [共通ドメイン契約(整数の最小通貨単位、価格の状態・税・単位、Product と Offer)](0002-common-domain-contract.md) | 採用 |
| 0003 | [店舗スコープの SQLite に変化点だけを順序非依存で取り込む](0003-change-point-history-in-sqlite.md) | 採用 |
| 0004 | [不完全なクロールは取り込まない(fail-closed)](0004-fail-closed-completeness.md) | 採用 |
| 0005 | [隔離されたスナップショットでも公開は続ける](0005-quarantine-still-publishes.md) | 採用 |
| 0006 | [SQLite は git に入れず、最終化した状態を Pages に公開して次回の入力にする](0006-state-publication-on-pages.md) | 採用 |
| 0007 | [静的データ契約 v1(変化点のタプル、`datasetVersion`、メジャー版の分離)](0007-static-contract-v1.md) | 採用 |
| 0008 | [一覧ページは DOM ライブラリでなく正規表現で読み、保存済みページで検証する](0008-listing-page-regex-parser.md) | 採用 |
| 0009 | [クローラーの識別と丁寧さ](0009-polite-crawler-identification.md) | 採用 |
| 0010 | [ユーザースクリプトの stale-while-revalidate キャッシュと LRU](0010-userscript-swr-cache.md) | 採用 |
| 0011 | [Shadow DOM、`innerHTML` 禁止、CDN なし、fail-open](0011-userscript-rendering-safety.md) | 採用 |
| 0012 | [クロール対象はサイトマップから発見し、カバレッジの正解として使う](0012-sitemap-as-catalogue-authority.md) | 採用 |
| 0013 | [観測頻度は 1 か月に 1 回](0013-monthly-observation-cadence.md) | 採用 |
| 0014 | [Switch Science は HTML ではなく Shopify のカタログ JSON から読む](0014-shopify-catalog-api-over-html.md) | 採用 |
| 0015 | [Switch Science の商品同一性は Shopify の handle、商品 ID と SKU はエイリアス](0015-shopify-handle-as-identity.md) | 採用 |
| 0016 | [観測頻度は店舗ごとに宣言する(スイッチサイエンスは週 1、秋月は月 1)](0016-per-store-observation-cadence.md) | 採用 |
| 0017 | [店舗横断の対応表と価格比較承認を分離する](0017-cross-store-comparisons.md) | 採用 |
| 0018 | [保存カタログの候補探索と承認済み対応表の再生成を分離する](0018-reviewed-catalog-mapping-pipeline.md) | 採用 |

新しい ADR は次の番号で追加する。置き換える場合は古い ADR の状態を「置換」にして相互リンクする。
