# 隔日収集とライトテーマ・短期間グラフの検証

2026-09-10: ユーザーの依頼により両店舗を2日に1回05:00 JST（2026-09-11基準）に変更。ADR-0013/0016の従来の月次・週次運用を更新する。アクセス間隔と直列実行は維持する。

- Verify: `npm test -- tests/integration/observation-cadence.test.ts tests/contract/publisher.test.ts`
  Expect: 両店舗の隔日設定、cronと選択分岐、隔日の注意書きとデータバージョン更新が一致する。
- Verify: `npm test -- tests/userscript/comparison-panel.test.ts`
  Expect: 3日未満のグラフは開始・終了の時刻を表示。単一観測は点のみ、系列は自店舗の最終観測で止まる。
- Verify: `npm run typecheck` と `npm test`
  Expect: 型検査と全テストが成功し、終了後に当リポジトリのテストプロセスが残らない。

容量の参考実測はREADMEの23,000商品・5年間・週次収集の合成データ。SQLite 37.65 MB、配信サイト合計49.87 MB。実運用の将来容量を保証する数字ではない。

- Verify: npm test -- tests/userscript/controller-panel.test.ts
  Expect: OSがダークでも初期値はライト、保存したテーマは優先する。
- Verify: npm test -- tests/integration/observation-cadence.test.ts
  Expect: 800日分（年末・月末・うるう日を含む）が隔日。5時間遅延でも同じ判定。手動実行は中間日でも通過。未知cronは失敗。

検証結果: 全446テスト・3対象の型検査・actionlint・両配布ビルド成功。テストプロセス残存なし。本番反映および実ブラウザ確認は未実施。

申請準備時の互換性検証: 契約1.1の省略可能フィールド observation.samplingIntervalDays で隔日を伝達する。公開caveatsへ新キーを加えると旧0.4.2が拒否するため、追加項目を読み飛ばす互換性を旧版の実validatorで確認した。447テスト成功、npm auditは脆弱性0件。
