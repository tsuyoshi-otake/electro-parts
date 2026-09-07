# 運用ランブック

対象店舗は `.github/workflows/crawl-publish.yml` の `env.STORES`(現在 `akizuki switch-science`)。1 つの job の中で**この順に直列**で回る。共有しているのは 1 つの SQLite 履歴、1 つの `state/`、そして Pages が丸ごと差し替える 1 つの `site/` で、そのすべてが「片方の run がもう片方のデータを壊す経路」になる。

## 初回(ブートストラップ)

1. リポジトリを public にし、Settings → Pages → Source を **GitHub Actions** にする。
2. Actions → "Crawl and publish" → Run workflow で `stores: akizuki`、`bootstrap: true`。
   - 公開状態(`state/state.json`)が**存在しない**ときだけ成功する。存在するときはパイプラインが拒否する(誤って履歴を消さない)。
   - `bootstrap` は `stores` にちょうど 1 店舗を指定したときだけ通る。空(= 全店舗)だとワークフローが先に止める。
3. 完了後、`https://<owner>.github.io/electro-parts/data/v1/stores/akizuki/manifest.json` の `datasetVersion` と `runCount: 1` を確認する。

## 店舗を追加する

コード側の手順は README の「新しい店舗を追加するには」。**運用としてやることは 1 つだけで、それは `bootstrap` を使わないこと。**

- 既に公開状態があるので、新店舗も通常の run(`bootstrap` なし)で始める。前回状態にその店舗の run が 0 件あるだけで、失敗ではない。
- 初回だけ `stores: <新店舗>` を指定すると、既存店舗はクロールされず公開済みデータセットのまま(`--republish`)で、新店舗だけが観測される。
- 完了後、両方の `manifest.json` と `state/state.json` の `stores` を確認する。既存店舗の `datasetVersion` が変わっていなければ正しい。

## 月次の run

- schedule は `17 20 1 * *`(UTC)= 毎月 2 日の日本時間 05:17(ADR-0013)。
- 頻度が低いぶん、1 回失敗すると次の自動 run まで 1 か月空く。**失敗・隔離が出たら、直してから `workflow_dispatch` で回し直す**のが通常の運用。特定の店舗だけ直したいときは `stores` にその店舗を書く(他店舗は公開済みデータセットのまま維持される)。
- Actions summary に**店舗ごとに**、結果(`published` / `unchanged` / `quarantined` / `failed`)、run 時間、リクエスト数、件数、価格変更数、隔離理由が出る。最後に `### Site` として、サイトに載った店舗と `datasetVersion`、サイトサイズが出る。
- 終了コード(店舗ごと): 0 = 公開または変化なし、3 = 隔離(公開は続く、warning)、1 = 失敗。
- **1 店舗が失敗しても、他店舗の公開は止まらない。** 失敗した店舗は公開済み履歴から `--republish` で復元されてからデプロイされ、ジョブ自体は最後に失敗する(`failed_stores` に名前が出る)。復元もできなければゲートがデプロイを拒否する。

## 隔離(quarantined)が出たら

隔離は店舗ごと。片方が隔離されても、もう片方の公開は普通に続く。

1. summary のその店舗の `sanity.*` コードと指標を読む。
   - `item_count_drop` / `missing_product_ratio`: サイト側の一覧が欠けた可能性。`npm run crawl -- --config config/<store>.json` をローカルで実行し、`complete` と `issues`、`catalog.uncovered` を見る。
   - `price_change_ratio`: 本当の価格改定か、読み違い(秋月なら単位・税、スイッチサイエンスなら `price` 文字列の解釈)。スナップショット成果物(`snapshot-<store>-<run id>`)を落として数件を目で比較する。
   - `unavailable_price_ratio`: 価格表示の変更。スイッチサイエンスはしきい値が 2 % と厳しい(JSON の `price` は素直な数値文字列なので、読めない価格が増えるのは形が変わった証拠)。
2. 本当の変化(価格改定)だった場合: `config/<store>.json` の `sanity` しきい値を一時的に上げてコミットし、`workflow_dispatch` で `stores: <store>` を指定して回し直して取り込む(次の schedule を待つと 1 か月空く)。または成果物のスナップショットを `--snapshot` で再取り込みする(下記)。
3. 隔離された run は `rejected_runs` に残る。取り込み直したい run は同じ観測時刻のスナップショットで `--snapshot` を指定すると通常の取り込みになる(隔離記録は残る)。

## 特定スナップショットの取り込み直し

### Actions で(クロールし直さない)

取り込み以降の段階(validate / import / generate)を直したときは、**前の run が集めたスナップショットを再利用する**。クロールをやり直すと秋月なら約 2,700 リクエストを相手サイトに無駄に投げることになる。

- Actions → "Crawl and publish" → Run workflow → `reimport_snapshot_from_run` に元の run id、`stores` に**その 1 店舗だけ**を入れる(スナップショットは店舗のものなので、複数店舗を指定するとワークフローが止める)。
- その run の `snapshot-<store>-<run id>` 成果物を落として `--snapshot` で流すので、`collect` は走らない(数十秒で終わる)。指定しなかった店舗は `--republish` で公開済みデータセットを保つ。
- 成果物の保持は 90 日。それを過ぎた run のスナップショットは使えないので、通常のクロールをやり直す。

### ローカルで

```bash
node --import tsx src/cli/main.ts pipeline --config config/akizuki.json --snapshot snapshots/akizuki-<timestamp>.json
```

前回状態は `previousStateUrl` から取得される。ローカルで試すだけなら `--previous-dir` に成果物 `state-<run id>` を展開したディレクトリを渡す。2 店舗を続けて回すときは、2 店舗目の `--previous-dir` を **1 店舗目が書いた `site/state`** にする(同じ前回状態から並行に回すと、後から最終化したほうが他方の run を捨てる)。

## サイトだけ差し替える(観測を増やさない)

ユーザースクリプトのバンドルやランディングページなど、**データではなくサイトの中身**を直したときに使う。公開済みの履歴をそのまま再生成してデプロイするだけで、クロールも取り込みもしない。

- Actions → "Crawl and publish" → Run workflow → `republish` にチェック(全店舗が対象になる)。
- 段階は `previous_state` → `generate` → `finalize` → `verify` だけ走り、`collect` / `validate` / `import` / `compact` は skipped。結果は `unchanged`(exit 0)。
- **run 数も `datasetVersion` も変わらない。** ここが再取り込みとの違いで、同じスナップショットをもう一度取り込むと「同じ内容の観測」が 1 回増えてしまう。サイトを直したいだけのときにそれをやってはいけない。
- ローカルでは `node --import tsx src/cli/main.ts pipeline --config config/<store>.json --republish`。
- `--bootstrap` や `--snapshot` とは併用できない(どちらも観測を持ち込むため、run は失敗する)。
- ワークフローは同じ仕組みを 2 か所で自動的に使う: `stores` で選ばれなかった店舗の維持と、失敗した店舗の復元。どちらも「公開済み履歴からその店舗のデータセットを作り直す」だけで、観測は増えない。

## ロールバック

壊れた状態を公開してしまった場合。**SQLite は全店舗で 1 つなので、状態を巻き戻すと全店舗が巻き戻る。** 1 店舗だけの取り込みを取り消す手段は無い(隔離は取り込みそのものを止めるので、そちらは巻き戻しにならない)。

1. Actions の該当 run(直前の正常な run)の成果物 `state-<run id>` をダウンロードして展開する(`state.json` と `history.sqlite`)。
2. ローカルで `pipeline --config config/akizuki.json --previous-dir <展開先> --snapshot <その日のスナップショット>` を実行し、`site/` を生成する。スナップショットなしで再生成だけしたい場合は `--snapshot` に前回受理済みのスナップショットを渡す(同じハッシュなので no-op になり、生成・最終化だけ行われる)。
3. `site/` を Pages にデプロイする。Actions の workflow_dispatch にはロールバック入力がないので、手動でブランチに成果物を置く代わりに、**新しい workflow を一時的に作らず**、ローカルの `site/` を `actions/upload-pages-artifact` 相当の手順でアップロードする方法を推奨する(`gh api` は使わない。`actions/deploy-pages` はワークフローからしか動かないため、実際には「ロールバック用の workflow_dispatch を追加する」小さな変更をコミットするのが現実的)。
4. その後の run は公開された(戻した)状態を前回状態として続く。

## 失敗(failed)が出たら

- 前回状態の取得失敗(`previous_state`): Pages が落ちている、または初回で `bootstrap` を忘れている。Pages の URL に `state/state.json` があるか確認。
- 取得が不完全(`collect` で `complete: false`): サイトのメンテナンス、WAF、ページ構造変更、あるいはサイトマップにある商品が本体の巡回に出なかった(`catalog.uncovered` > `maxUncoveredProducts`、ADR-0012)。summary の `issues` を見る。ローカルで `npm run crawl -- --config config/<store>.json` を実行し、保存済みフィクスチャ(`tests/fixtures/<store>/`)と実ページを比較する。
- スイッチサイエンスでカタログ JSON の形が変わった: `/collections/all/products.json` が想定と違う形を返すと、そのページで巡回を止めて失敗する(飛ばして進めると、それ以降の件数がすべて推測になるため → ADR-0014)。エラーにどのページかが出る。API 自体が無効化された場合は HTML を読む収集器を `StoreCollector` の背後に足す(共通コアは変わらない)。
- 403 が出る: User-Agent が拒否されている。過去に `crawler` という語を含む UA が拒否された。UA を変えるときは ADR-0009 を守り、識別可能で連絡先を含むものにする。**ブラウザ UA に偽装しない。**
- verify 失敗: 生成物の契約検証エラー。Publisher のバグなのでコードを直す。
- デプロイされない(`publishable: false`): サイトに載っていない店舗がある。summary の `### Site` に、どの店舗のマニフェストが無いかが出る。履歴に run がある店舗は自動で復元されるので、ここまで来るのは「復元も失敗した」か「その店舗の設定ファイルが無い」場合。**この状態でデプロイしないのは意図した動作**で、公開サイトから店舗が丸ごと消えるより run が 1 回無駄になるほうがましだから。

## 頻度を下げる / 止める

- 止める: workflow の schedule をコメントアウトしてコミット。公開データはそのまま残る。
- 下げる: cron を変える。**このとき `caveats.sampling_interval` の文言も直す**(キーは `src/publisher/generate.ts`、利用者に見える文言は `userscript/core/format.ts`)。

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
npm run crawl -- --config config/switch-science.json --out snapshots
```

```bash
node --import tsx src/cli/main.ts pipeline --config config/akizuki.json --bootstrap --snapshot snapshots/<file>.json
```

```bash
node --import tsx src/cli/main.ts summary --report reports/pipeline-akizuki.json
```
