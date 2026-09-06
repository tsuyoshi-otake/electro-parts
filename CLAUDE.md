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
