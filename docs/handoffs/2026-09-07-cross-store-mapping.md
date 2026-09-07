# 引継ぎ: 店舗横断の商品照合 0.4.1

更新日: 2026-09-07。次のエージェントが調査を最初からやり直さずに続けるための記録。

## 対象とユーザーの意図

- 対象リポジトリ: `C:\Codes\tsuyoshi-otake\electro-parts` / [GitHub](https://github.com/tsuyoshi-otake/electro-parts)。会話の既定cwdが `graph-bridge-local` でも、今回の作業対象は **electro-parts**。コマンドの作業ディレクトリを毎回明示する。
- 初回80組の小さな対応表では不十分、という指摘を受け、保存カタログ全件から再現可能な候補探索を行い、同一商品と仕様違いの類似商品を分けて増やす計画が承認された。[Issue #5](https://github.com/tsuyoshi-otake/electro-parts/issues/5) に実装前の範囲・検証基準を記録。
- 作業完了後に別エージェント向けの状況引継ぎを書く、という依頼への成果物がこの文書。今回の実装・検証は主エージェントが担当し、新しいエージェントへの委任・第三者レビューは行っていない。

## リリース状況

**0.4.1は公開・検証完了。2026-09-07 15:32 JSTに公開ファイルと両店の状態を取得して確認した。Issue #5の実装範囲は完了。**

- 実装コミット: `560576487ed282e19f00198652a607171374a812`。
- 変異テスト設定修正: `920b8db746dd12bc1a27813cd95ebd71493be50a`。
- CI: [34090483577](https://github.com/tsuyoshi-otake/electro-parts/actions/runs/34090483577) は全成功。398テスト・10 E2E、コア変異スコア89.60%（既存の合格閾値70%以上）を確認。
- 公開: [34091168836](https://github.com/tsuyoshi-otake/electro-parts/actions/runs/34091168836) は `republish=true`、コミット `920b8db` で成功。公開URL: [配布ページ](https://tsuyoshi-otake.github.io/electro-parts/) / [userscript](https://tsuyoshi-otake.github.io/electro-parts/electronics-price-history.user.js)。配布中の版は0.4.1。
- 公開バンドルはローカル検証済みビルドと677,674バイトすべて一致。SHA-256: `b402547c6a585efc0e7d0c8514d3f1847d8b854ac25cecc7ac8a4344b2e441f6`。
- 公開前後でstateの店舗別観測情報、両manifestの商品数・観測情報・データ版が一致。秋月: 12,772商品 / 2観測 / `3ccce668810808ca`。SS: 10,383商品 / 1観測 / `762d7ad2cd13eaf8`。照合用の19,020行とは別の母数。
- 公開商品JSONの契約検証と価格比較適格性を両方向で確認。観測記録の差額（他店−閲覧中）はATOM Liteが秋月側−187円 / SS側+187円、UNO R4 Minimaが秋月側+350円 / SS側−350円。現在価格の保証ではない。
- この引継ぎとREADME/ADRの表記補正は公開後の文書のみのコミット。実行コード・配布バンドルは上記リリースコミットから変えていない。

## 実装済みの内容

- 秋月8,677行（2026-09-06）+ SS10,343行（2026-08-02）=19,020行の保存カタログを、価格・在庫抜きの照合用正本として保持。**現行の全商品ではない。** 店舗SKU・元型番・メーカー型番・メーカー名・ID/URL・取得日・元ファイルSHAを分離して残す。
- 索引探索で309組を抽出し、全件の判断を保存。同一293、要確認6、却下10、未判断0。初期英数字一致191組で止めず、数字型番とメーカーに限定した接頭辞対応を追加。型番一致から自動承認しない。
- 初回80組の原判定・モデル情報を保持し、13製品群の明示的に選んだ本体の特徴を合流。最終対応表424組 = 同一照合済み293 + 同一候補3 + 類似照合済み108 + 類似候補6 + 要確認14。
- 製品群はPico、Pi5、Pi4、Touch Display 2、UNO R4、Nano R4、Nano 33 IoT、UNO Q、Opta、ATOM、Core2、Basic、PoE Camera。類似カードにMCU・無線・ヘッダー・容量・画面等の差を表示し、閲覧中→他店の順序で差分の少ないものから並べる。互換性保証ではない。
- **販売条件までの価格比較承認は従来のATOM LiteとUNO R4 Minimaの2組だけ。** 同一照合済み293組すべての価格を比較できるわけではない。他は観測日付き参考記録価格。90日再確認、offer/税/単位/商品情報不一致時の降格も維持。
- 関連リンクは全件残すが、他商品履歴は1ページ最大8商品・同時2件。上限以降は `reference_only` の終端状態。manifest共有・重複排除・429自動再試行なし・描画からの取得なしを維持。
- 狭い埋め込み欄でもグラフを潰さないコンテナクエリを追加。既存テーマ、Shadow DOM、DOM生成、無アニメーション方針は変更なし。
- 現行SSカタログの既存レスポンスに含まれる説明HTML/tagsを、任意フィールドとして生スナップショットに保存。追加の店舗アクセスなし。MPN自動抽出・HTML描画は未実装。旧保存カタログのメーカー型番と、現在公開JSONのSKU/model欄は同じとは限らない。

## 正本と入口

最初に [CLAUDE.md](../../CLAUDE.md)、[検証済みルール](../../.claude/memory/rules.md)、[ADR-0018](../adr/0018-reviewed-catalog-mapping-pipeline.md) を読む。価格承認の契約は [ADR-0017](../adr/0017-cross-store-comparisons.md)。

| 用途 | ファイル |
|---|---|
| 保存情報・全件候補・メーカー別カバレッジ | `data/matching/catalog.jsonl`、`candidates.jsonl`、`coverage.json` |
| 明示的なレビュー・特徴定義・初回原判定 | `data/matching/reviews.json`、`families.json`、`legacy.json` |
| インポート・索引・再生成CLI | `scripts/matching/catalogs.ts`、`model.ts`、`generate.ts` |
| 配信用生成物（直接編集禁止） | `userscript/adapters/productRelations.ts` |
| 検索・価格可否・取得責任・表示 | `userscript/core/relations.ts`、`controller.ts`、`userscript/ui/related.ts`、`panel.ts` |
| 回帰テスト | `tests/unit/matching-generator.test.ts`、`tests/userscript/relations.test.ts`、`comparison-panel.test.ts`、`controller-panel.test.ts`、`tests/e2e/cross-store.spec.ts` |

`matching:discover` は全件候補だけを再生成し、レビューや配信表を変えない。根拠を人が確認して判断ファイルを更新した後、`matching:build` → `matching:check`。入力を変えるとフィンガープリント不一致で停止する。機械的なフィンガープリントの追認は禁止。現行raw snapshotと旧カタログの形式は違うので、importへ無条件に渡さない。

## 検証・運用

- Verify: `node node_modules/vitest/vitest.mjs run --maxWorkers 2`。Expect: 398 tests / 35 files成功。最終ローカル実行で確認済み。`npm test -- --maxWorkers=2` はこのWindowsのnpmではオプションを消費してしまったため、上の直接起動を使う。
- Verify: `npm run typecheck`、`npm run matching:check`、`npm run build:userscript`、`npm audit`。Expect: 全成功・監査0件・対応表バイト一致。0.4.1バンドルは677,674バイト。初回CI生成物もローカルビルドとバイト一致。
- CIの保存ページE2Eは10件成功。狭いviewport/広いviewport中の390px欄、両方向の比較、キーボード開閉、429終端を含む。スクリーンショットも確認。初回CI 34090235734は変異テストの事前実行のみ失敗し、Strykerの `@ts-nocheck` 挿入対象を `src/**/*.ts` に限定して解決。修正後のローカルdry runは398件成功。厳密な生成物検査を緩めたわけではない。
- Chromeの既存セッションで、公開済みJSONのコピー+製品版controller/adapters/UIを使ったプレビューを確認。Picoの7類似候補、逆方向の差分/展開根拠、ライト/ダーク、狭幅388px時のグラフ356px・横溢れ0を確認。プレビューtab/serverは終了済み。**Tampermonkeyインストール済みスクリプトの自動更新完了は未確認。** プレビューのためにインストール状態を変更していない。
- Verify: テスト後に `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` で対象repo/runnerの親子関係を確認。Expect: 自分が開始したrunner/serverが残らない。他repoのvitestが同時稼働していたので、名前だけで一括終了しない。直近の対象プロセスは残存なし。
- リリースは版を上げ、CI成功後に `gh workflow run crawl-publish.yml -f republish=true`。mainへのpushだけでは公開されない。bootstrap・再クロール・再importは今回不要。両店の公開状態を保つこと。

## 残件と次に調べる場合

1. 全現在カタログ・全別名・説明文からの候補探索は未実施。メーカー別の未照合数は `coverage.json` にあり、「候補なし」を「対象外」と解釈しない。新しいカテゴリ・店舗は対象数と未調査範囲を記録してから拡張する。
2. 同一候補3組: `a129452-s9413`（T80）、`a130098-s9751`（T-mini Plus）、`a131817-s4449`（DFR0580）。別名やメーカー情報の確認を要し、現状は候補のまま。
3. 探索からの要確認6組: `a107031-s4134`（DFR0017 V3/V3.1）、`a112585-s3634`（LattePandaライセンス）、`a116286-s3605`（MD10C定格）、`a117928-s5529`（Raytac書込状態）、`a129606-s10908`（Pi5 SC1110と1GB/2GB表記矛盾）、`a117314-s7216`（Feather色）。その他の初回要確認も残る。情報不足を実際の仕様差へ勝手に読み替えない。
4. 価格比較承認を増やす場合は両店の商品ページで販売数量・セット構成・付属品・税・offer ID・対象variantを確認し、別の承認として記録する。保存カタログの型番一致だけでは承認不可。現在価格・最安・代替互換性を保証しない。
5. 今後も検証は実装担当自身が行う。GitHub操作は `gh` のみ。依存は7日以上経過した版、lockfile維持。ブラウザはChrome優先、ローカルで不要な独立headless/SwiftShaderを起動しない。

補助的なローカル資料は `C:\Users\developer\tmp\electro-parts-matching\`。`verify-release-v041.mts`、`published-before-v041.json`、`release-verification-v041.json`、`ci-v041-initial/` のスクリーンショット等。引継ぎの正本はこの文書とリポジトリ内の根拠ファイルであり、一時フォルダーの存続には依存しない。
