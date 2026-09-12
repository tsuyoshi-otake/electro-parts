# Goal: M5Stack全商品を収集・公開し、拡張でUSD履歴を表示する
Workdir: C:/Codes/tsuyoshi-otake/electro-parts
Max iterations: 8

- C1: 全商品とvariantを損失なく収集。Verify: 保存済み664商品706variantの統合テスト。Expect: サイトマップ差分0、Unicode handleを安全に公開、失敗・反復・上限はcomplete:false。
- C2: USD整数セント・税unknown・数量非公開を保持。Verify: adapter unit tests、npm run typecheck、npm test。Expect: 小数価格・異常値・欠落在庫・variant構成のテスト成功、JPY回帰なし。
- C3: 3店舗の公開・拡張設定を統合。Verify: 両build、manifest tests、workflow検査。Expect: M5Stackのmatch、2日更新設定、3店舗の公開保持、版0.4.4。
- C4: ローカルPlaywrightで表示検証。Verify: npm run test:e2eと提出ZIPの専用プロファイル読み込み。Expect: USDと構成・テーマ・グラフを表示、スクリーンショット目視、残存プロセス0。公開前のM5Stackデータはローカル生成データとして区別する。
- C5: 完成物と手順を保存。Verify: git diff --check、変更と検証記録・Issue照合。Expect: 再現手順、実行証跡、未公開/公開/未申請の状態を明記。
