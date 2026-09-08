# ADR-0007: 静的データ契約 v1(変化点のタプル、`datasetVersion`、メジャー版の分離)

- 状態: 採用(2026-09-06)
- 関連: `src/publisher/contract.ts`、`src/publisher/generate.ts`、`src/publisher/write.ts`

## 背景

ユーザースクリプトは商品ページごとに 1 ファイルを取りに行く。ファイルは小さく、キャッシュしやすく、将来の変更で古いスクリプトを壊さない形でなければならない。

## 決定

- パスは `data/v1/stores/<storeId>/manifest.json` と `products/<pageKey>.json`。契約の**メジャー版がパスに入る**ので、v2 は別ディレクトリに並行公開でき、v1 のスクリプトは壊れない。
- 商品ファイルは変化点のタプル配列(`[t, state, min, max]` など)。統計(現在値、前回値、変化、最低・最高、30/90/365 日窓)は Publisher が計算して同梱し、スクリプト側は計算をやり直さない。
- `datasetVersion` は、取り込み済み run の集合に加え、DB スキーマ、静的契約、Publisher の生成規則、在庫点数上限、観測頻度など出力の意味を決める入力のハッシュ。同じ DB と生成規則からは同じ値になり、run または出力内容を変え得る生成規則が変われば値も変わる。`generatedAt` は含めない。すべてのファイルに同じ値が入り、スクリプトはこれをキャッシュの判定と `?v=` のキャッシュバスターに使う。
- マイナー変更(フィールド追加)は `contractVersion` のマイナーを上げるだけ。既存フィールドの意味変更・削除はメジャー。
- 検証関数(`validateManifestV1` / `validateProductFileV1`)は Publisher の書き込み後検証とスクリプトの受信時検証で共有する。
- 書き込みは一時ディレクトリに全ファイルを書いてから rename する(原子的)。`pageKey` は安全な文字集合に限定し、サイトルートの外に書かない。

## 理由

タプルは JSON のキー名を繰り返さないので 5 年分でも 1 商品数 KB に収まる。統計を同梱すると、スクリプトのバンドルが小さく、表示が一貫する。

## 結果

- 契約の型は `src/publisher/contract.ts` 1 か所。ユーザースクリプトの tsconfig はこのファイルを直接 include する。
- 在庫数の点は `inventoryPointLimit`(既定 730)で打ち切る。
