# 運用ランブック

## 初回(ブートストラップ)

1. リポジトリを public にし、Settings → Pages → Source を **GitHub Actions** にする。
2. Actions → "Crawl and publish" → Run workflow で `bootstrap: true`。
   - 公開状態(`state/state.json`)が**存在しない**ときだけ成功する。存在するときはパイプラインが拒否する(誤って履歴を消さない)。
3. 完了後、`https://<owner>.github.io/electro-parts/data/v1/stores/akizuki/manifest.json` の `datasetVersion` と `runCount: 1` を確認する。

## 毎日の run

- schedule は `17 20 * * *`(UTC)= 日本時間 05:17。
- Actions summary に、結果(`published` / `unchanged` / `quarantined` / `failed`)、run 時間、リクエスト数、件数、価格変更数、隔離理由、サイトサイズが出る。
- 終了コード: 0 = 公開または変化なし、3 = 隔離(公開は続く、warning)、1 = 失敗(error、デプロイなし)。

## 隔離(quarantined)が出たら

1. summary の `sanity.*` コードと指標を読む。
   - `item_count_drop` / `missing_product_ratio`: サイト側の一覧が欠けた可能性。翌日も続くなら Collector のジャンル一覧やページャー解析を疑う(`npm run crawl` をローカルで実行し、`complete` と `issues` を見る)。
   - `price_change_ratio`: 本当の価格改定か、パーサーの単位・税の読み違い。スナップショット成果物(`snapshot-<run id>`)を落として数件を目で比較する。
   - `unavailable_price_ratio`: 価格表示の変更。パーサー修正。
2. 本当の変化(価格改定)だった場合: `config/akizuki.json` の `sanity` しきい値を一時的に上げてコミットし、翌日の run で取り込む。または成果物のスナップショットを `--snapshot` で再取り込みする(下記)。
3. 隔離された run は `rejected_runs` に残る。取り込み直したい run は同じ観測時刻のスナップショットで `--snapshot` を指定すると通常の取り込みになる(隔離記録は残る)。

## 特定スナップショットの取り込み直し

```bash
node --import tsx src/cli/main.ts pipeline --config config/akizuki.json --snapshot snapshots/akizuki-<timestamp>.json
```

前回状態は `previousStateUrl` から取得される。ローカルで試すだけなら `--previous-dir` に成果物 `state-<run id>` を展開したディレクトリを渡す。

## ロールバック

壊れた状態を公開してしまった場合:

1. Actions の該当 run(直前の正常な run)の成果物 `state-<run id>` をダウンロードして展開する(`state.json` と `history.sqlite`)。
2. ローカルで `pipeline --config config/akizuki.json --previous-dir <展開先> --snapshot <その日のスナップショット>` を実行し、`site/` を生成する。スナップショットなしで再生成だけしたい場合は `--snapshot` に前回受理済みのスナップショットを渡す(同じハッシュなので no-op になり、生成・最終化だけ行われる)。
3. `site/` を Pages にデプロイする。Actions の workflow_dispatch にはロールバック入力がないので、手動でブランチに成果物を置く代わりに、**新しい workflow を一時的に作らず**、ローカルの `site/` を `actions/upload-pages-artifact` 相当の手順でアップロードする方法を推奨する(`gh api` は使わない。`actions/deploy-pages` はワークフローからしか動かないため、実際には「ロールバック用の workflow_dispatch を追加する」小さな変更をコミットするのが現実的)。
4. その後の run は公開された(戻した)状態を前回状態として続く。

## 失敗(failed)が出たら

- 前回状態の取得失敗(`previous_state`): Pages が落ちている、または初回で `bootstrap` を忘れている。Pages の URL に `state/state.json` があるか確認。
- 取得が不完全(`collect` で `complete: false`): サイトのメンテナンス、WAF、ページ構造変更。summary の `issues` を見る。翌日も続くならローカルで `npm run crawl` を実行し、保存済みフィクスチャ(`tests/fixtures/akizuki/html/`)と実ページを比較する。
- 403 が出る: User-Agent が拒否されている。過去に `crawler` という語を含む UA が拒否された。UA を変えるときは ADR-0009 を守り、識別可能で連絡先を含むものにする。**ブラウザ UA に偽装しない。**
- verify 失敗: 生成物の契約検証エラー。Publisher のバグなのでコードを直す。

## 頻度を下げる / 止める

- 止める: workflow の schedule をコメントアウトしてコミット。公開データはそのまま残る。
- 下げる: cron を変える。契約の `caveats.sampling_interval` の文言は `src/publisher/generate.ts` にある。

## サイト運営者から連絡があった場合

UA に書いたリポジトリ URL 経由で来る想定。要請に従い schedule を止め、必要なら公開データも削除する(Pages を無効化)。

## ローカルでの確認コマンド

```bash
npm run typecheck && npm test
```

```bash
npm run crawl -- --config config/akizuki.json --out snapshots
```

```bash
node --import tsx src/cli/main.ts pipeline --config config/akizuki.json --bootstrap --snapshot snapshots/<file>.json
```

```bash
node --import tsx src/cli/main.ts summary --report reports/pipeline-akizuki.json
```
