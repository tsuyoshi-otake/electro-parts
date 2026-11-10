# 運用ランブック

対象店舗は `.github/workflows/crawl-publish.yml` の `env.STORES`。収集(クロール)は店舗ごとのジョブで**並列**に行い、取り込みと公開は 1 つのジョブの中で**`STORES` の順に直列**で行う(ADR-0034 → [収集ジョブと公開ジョブ](#収集ジョブと公開ジョブ))。共有しているのは 1 つの SQLite 履歴、1 つの `state/`、そして Pages が丸ごと差し替える 1 つの `site/` で、そのすべてが「片方の run がもう片方のデータを壊す経路」になる。だから書き手は `publish` ジョブ 1 つに限る。

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

## 定期 run(毎日)

- schedule は `0 20 * * *`(UTC)で毎朝05:00 JSTに起動し、毎日収集する(ADR-0030)。隔日だったころの判定ジョブ(`scripts/observation-schedule.ts`)は廃止した。観測する店舗を店舗ごとのジョブで並列に収集し、1 つのジョブで順に取り込む。それ以外の店舗は `--republish` で再生成する。
- **どの店舗を観測するかは cron には書いていない。** `scripts/observed-stores.ts` が `config/<store>.json` の `observation.cadence` を読んで決める。schedule は `daily` の店舗を観測し、`stores` を空にした手動実行は `stopped` 以外の全店舗を観測する。選ばれなかった店舗は `--republish` で維持する。現在は KSY だけが `stopped`(2026-11-04、ADR-0029)で、残り 5 店舗は `daily`。選んだ結果は Actions の notice(`Observed stores`)に出る。未知の cron、未知の店舗、`stopped` の店舗を `stores` に書いた場合はエラーで停止する。
- 定期実行と手動実行が重なる場合も、`pages-publish` の concurrency で直列化する。
- 観測は毎日なので、失敗・隔離が出た店舗の次の自動 run は翌朝になる。観測できなかった日は拡張機能のグラフの穴として残る。**失敗・隔離が出たら、直してから `workflow_dispatch` で回し直す**のが通常の運用。特定の店舗だけ直したいときは `stores` にその店舗を書く(他店舗は公開済みデータセットのまま維持される)。
- Actions summary に**店舗ごとに**、結果(`published` / `unchanged` / `quarantined` / `failed`)、run 時間、リクエスト数、件数、価格変更数、隔離理由が出る。最後に `### Site` として、サイトに載った店舗と `datasetVersion`、サイトサイズが出る。
- 終了コード(店舗ごと): 0 = 公開または変化なし、3 = 隔離(公開は続く、warning)、それ以外 = 失敗。1 のほか、メモリ不足やシグナルによる異常終了も失敗として扱う(何も観測していないので成功にしない。#92)。
  - ワークフローは各店舗の pipeline を `set +e` の中で動かし、終了コードを `PIPESTATUS` で読む。手順のシェルは `bash -e` なので、これが無いと 3 や 1 で手順ごと終わり、後の店舗とデプロイが止まる(2026-11-04 の定期 run、#78)。
- **1 店舗が失敗しても、他店舗の公開は止まらない。** 収集ジョブが落ちた店舗(スナップショットが無い)も、取り込みで落ちた店舗も同じ扱いで、公開済み履歴から `--republish` で復元されてからデプロイされ、`publish` ジョブ自体は最後に失敗する(`failed_stores` に名前が出る)。復元もできなければゲートがデプロイを拒否する。
- **観測できなかった店舗(隔離・失敗)は Issue で知らせる。** `alerts` ジョブが店舗ごとに `crawl-alert` ラベルの Issue を 1 件作り、次に観測できた run で自動的に閉じる。隔離だけの run はジョブが緑のまま終わるので、Issue が唯一の通知になる。→ [観測できなかった店舗の通知と run の長さ](#観測できなかった店舗の通知と-run-の長さ)
- **run の長さ**は、収集ジョブ(店舗ごと、上限 150 分)と `publish` ジョブ(上限 60 分)のそれぞれの summary に `### Run length` として、自分の上限に対する経過分と割合で出る。80 %(120 分 / 48 分)を超えると warning 注釈 `Run length near the limit` が出る。

## 隔離(quarantined)が出たら

隔離は店舗ごと。片方が隔離されても、もう片方の公開は普通に続く。ジョブは緑のまま終わるので、通知は Issue `Crawl alert: <store> was not observed`(ラベル `crawl-alert`)で届く。本文に `sanity.*` コードと run へのリンクが入っている。下の手順で直して回し直すと、観測できた run が Issue を閉じる。

1. summary のその店舗の `sanity.*` コードと指標を読む。
   - `item_count_drop` / `missing_product_ratio`: サイト側の一覧が欠けた可能性。`npm run crawl -- --config config/<store>.json` をローカルで実行し、`complete` と `issues`、`catalog.uncovered` を見る。
   - `price_change_ratio`: 本当の価格改定か、読み違い(秋月なら単位・税、スイッチサイエンスなら `price` 文字列の解釈)。スナップショット成果物(`snapshot-<store>-<run id>`)を落として数件を目で比較する。
   - `unavailable_price_ratio`: 価格表示の変更。スイッチサイエンスはしきい値が 2 % と厳しい(JSON の `price` は素直な数値文字列なので、読めない価格が増えるのは形が変わった証拠)。
2. 本当の変化(価格改定)だった場合: `config/<store>.json` の `sanity` しきい値を一時的に上げてコミットし、`workflow_dispatch` で `stores: <store>` を指定して回し直して取り込む(次の schedule は翌朝)。または成果物のスナップショットを `--snapshot` で再取り込みする(下記)。
3. 隔離された run は `rejected_runs` に残る。取り込み直したい run は同じ観測時刻のスナップショットで `--snapshot` を指定すると通常の取り込みになる(隔離記録は残る)。

## 特定スナップショットの取り込み直し

### Actions で(クロールし直さない)

取り込み以降の段階(validate / import / generate)を直したときは、**前の run が集めたスナップショットを再利用する**。クロールをやり直すと秋月なら約 2,700 リクエストを相手サイトに無駄に投げることになる。

- Actions → "Crawl and publish" → Run workflow → `reimport_snapshot_from_run` に元の run id、`stores` に**その 1 店舗だけ**を入れる(スナップショットは店舗のものなので、複数店舗を指定するとワークフローが止める)。
- その run の `snapshot-<store>-<run id>` 成果物を落として `--snapshot` で流すので、収集ジョブ(`collect`)は 1 つも起動しない(数十秒で終わる)。収集の記録(`collect-<store>-<run id>`)は使わないので、レポートの `collect` 段階は `source: file` になり、リクエスト数は出ない。指定しなかった店舗は `--republish` で公開済みデータセットを保つ。
- 成果物の保持は 90 日。それを過ぎた run のスナップショットは使えないので、通常のクロールをやり直す。

### ローカルで

```bash
node --import tsx src/cli/main.ts pipeline --config config/akizuki.json --snapshot snapshots/akizuki-<timestamp>.json
```

前回状態は `previousStateUrl` から取得される。ローカルで試すだけなら `--previous-dir` に成果物 `state-<run id>` を展開したディレクトリを渡す。2 店舗を続けて回すときは、2 店舗目の `--previous-dir` を **1 店舗目が書いた `site/state`** にする(同じ前回状態から並行に回すと、後から最終化したほうが他方の run を捨てる)。

## サイトだけ差し替える(観測を増やさない)

ユーザースクリプトのバンドル、Chrome 拡張の zip、ランディングページなど、**データではなくサイトの中身**を直したときに使う。公開済みの履歴をそのまま再生成してデプロイするだけで、クロールも取り込みもしない。

- Actions → "Crawl and publish" → Run workflow → `republish` にチェック(全店舗が対象になる)。
- 段階は `previous_state` → `generate` → `finalize` → `verify` だけ走り、`collect` / `validate` / `import` / `compact` は skipped。結果は `unchanged`(exit 0)。
- **run 数も `datasetVersion` も変わらない。** ここが再取り込みとの違いで、同じスナップショットをもう一度取り込むと「同じ内容の観測」が 1 回増えてしまう。サイトを直したいだけのときにそれをやってはいけない。
- ローカルでは `node --import tsx src/cli/main.ts pipeline --config config/<store>.json --republish`。
- `--bootstrap` や `--snapshot` とは併用できない(どちらも観測を持ち込むため、run は失敗する)。
- ワークフローは同じ仕組みを 2 か所で自動的に使う: `stores` で選ばれなかった店舗の維持と、失敗した店舗の復元。どちらも「公開済み履歴からその店舗のデータセットを作り直す」だけで、観測は増えない。

## Chrome 拡張を出し直す

拡張はユーザースクリプトと同じソース・同じ版番号から作る。片方だけ直すことはない。

1. `userscript/version.ts` の `USERSCRIPT_VERSION` を上げる(バンドルを変えたなら必須。ユーザースクリプトの自動更新も、拡張マニフェストの `version` もこの 1 か所から来る)。
2. Verify: `npm run typecheck && npm test && npm run test:e2e`。Expect: 拡張マニフェストの契約テストと、未展開の拡張を実ブラウザに読み込む E2E が通る。
3. Verify: `npm run build:extension` のあと `chrome://extensions` で `dist/extension` を読み込み、両店舗の実商品ページを開く。Expect: パネルが出る。**これは人が行う確認**で、自動化していない。
4. 公開は「サイトだけ差し替える」と同じ(`republish`)。zip は `site/electronics-price-history-extension.zip` として同じアーティファクトに入る。
5. Verify: 公開後に zip を落として `manifest.json` の `version` を見る。Expect: 上げた版。
6. **zip で入れた利用者は自動更新されない。** 取り直して読み込み直してもらう必要がある。版を上げたら README とランディングページの案内も合わせる。
7. ウェブストアに掲載している場合は、同じ zip をダッシュボードにもアップロードする。**ストアは同じ版を 2 回受け付けない**ので、版を上げずに出し直すことはできない。貼る文言と手順は `docs/chrome-web-store-listing.md`(ADR-0020)。ダッシュボードへの転記は `npm run cws:dashboard` で行い、「審査のため送信」は人が押す。プライバシーポリシー(`/privacy.html`)が 404 だと審査に出せないので、Pages の更新を先に済ませる。
8. リリースの記録は `docs/verification/<日付>-release-<版>.md` と `.claude/memory/journal.md` に残す。git のタグと GitHub Releases は v0.4.2(2026-09-08)で止めており、以後は使っていない。公開された版は Chrome の更新サービス(`clients2.google.com/service/update2/crx` の `response=updatecheck`)が返す `version` で確かめられる。

## ロールバック

壊れた状態を公開してしまった場合。**SQLite は全店舗で 1 つなので、状態を巻き戻すと全店舗が巻き戻る。** 1 店舗だけの取り込みを取り消す手段は無い(隔離は取り込みそのものを止めるので、そちらは巻き戻しにならない)。

1. Actions の該当 run(直前の正常な run)の成果物 `state-<run id>` をダウンロードして展開する(`state.json` と `history.sqlite`)。
2. ローカルで `pipeline --config config/akizuki.json --previous-dir <展開先> --snapshot <その日のスナップショット>` を実行し、`site/` を生成する。スナップショットなしで再生成だけしたい場合は `--snapshot` に前回受理済みのスナップショットを渡す(同じハッシュなので no-op になり、生成・最終化だけ行われる)。
3. `site/` を Pages にデプロイする。Actions の workflow_dispatch にはロールバック入力がないので、手動でブランチに成果物を置く代わりに、**新しい workflow を一時的に作らず**、ローカルの `site/` を `actions/upload-pages-artifact` 相当の手順でアップロードする方法を推奨する(`gh api` は使わない。`actions/deploy-pages` はワークフローからしか動かないため、実際には「ロールバック用の workflow_dispatch を追加する」小さな変更をコミットするのが現実的)。
4. その後の run は公開された(戻した)状態を前回状態として続く。

## 秋月の cover クロール

秋月は週 1 回だけ全一覧を読み(full)、ほかの日は前回の full の結果から選んだ一覧だけを読む(cover)。仕組みと判断は ADR-0032(Issue #93)。

### いつ full になるか

- 前回の full から 7 日(− 6 時間)以上たった日。毎朝 05:00 JST の run が数時間ずれても、ちょうど 7 日後に full になる。
- 記録(キャッシュ)が無い・読めない日。導入した日、Actions のキャッシュが 7 日使われず破棄された日、別ブランチで手動実行した日。
- 選んだ一覧がサイトマップから消えた日、系統が `c+r` から変わった日。
- cover の途中で多く欠けた日(escalate)。

迷ったら full になる。full は従来と同じで、約 90 分かかる。

### どちらの日だったかを見る

1. Actions の run ログで `[crawl] full run: …` または `[crawl] cover run: …` を探す。後ろに理由が付く。
2. 生スナップショットの `crawl` ブロック(`mode`、`reason`、`sourceBuiltAt`、`plannedListings`、`repairListings`、`missingAfterRepair`、`escalated`)。cover を設定したときだけ出る。
3. レポートの指標: `coverRun`(cover の日は 1)、`plannedListings`、`repairListings`、`missingAfterRepair`、`escalated`。

### 確認項目(導入後の最初の run で)

- 初日は full で、ログに `[crawl] cover source written: N listings, M products` が出る。`layout` が付いた一覧の数と、カード形式 / 表形式の割合は生スナップショットの `listings[].layout` で見る。
- 2 日目は `[crawl] cover run:` で、`plannedListings` が約 600 前後、秋月の所要時間が約 30 分。想定より大きいなら表形式の一覧が多い(ADR-0032 の見積もりは上限側)。
- cover の日の商品数が full の日と大きく違わない(sanity しきい値は従来どおり)。`missingAfterRepair` が毎日 10 件を超えるなら、計画の一覧がサイトの変化に追いついていないので、`fullCrawlEveryDays` を短くするか下の戻し方を使う。
- 7 日目前後に `the last full run was … days ago` の理由で full に戻る。

### 戻す・止める

- **cover を止める**: `config/akizuki.json` の `collector.cover` を消してコミットする。翌日から毎日 full で、`crawl` ブロックも出ない。
- **毎日 full のまま記録だけ残す**: `fullCrawlEveryDays` を `1` にする。
- **今日だけ full にする**: Actions のキャッシュ一覧で `akizuki-cover-` で始まるものをすべて削除して手動実行する(復元は一番新しいものを選ぶので、1 件だけ消しても古い記録が戻る)。記録が無いので full になり、新しい記録が書かれる。
- 記録が壊れていても run は失敗しない。ログに `cover source ignored: …` が出て、その日は full になる。

### 注意

- 記録は `state/work/carry/akizuki-cover.json.gz`。公開データ・履歴 DB・状態バックアップには入らない。消してよい。
- 新商品が計画に入っていない一覧にしか載らないと、次の full まで見えない(最大 7 日)。サイトマップに現れた新商品は `catalog.unlisted` の警告に出る。
- cover の日の `sourceListings` などの一覧内位置は full と違う。履歴・公開データには使われていない。

## 失敗(failed)が出たら

- 前回状態の取得失敗(`previous_state`): Pages が落ちている、または初回で `bootstrap` を忘れている。Pages の URL に `state/state.json` があるか確認。
- 取得が不完全(`collect` で `complete: false`): サイトのメンテナンス、WAF、ページ構造変更、あるいはサイトマップにある商品が本体の巡回に出なかった(`catalog.uncovered` > `maxUncoveredProducts`、ADR-0012)。summary の `issues` を見る。ローカルで `npm run crawl -- --config config/<store>.json` を実行し、保存済みフィクスチャ(`tests/fixtures/<store>/`)と実ページを比較する。
- スイッチサイエンスでカタログ JSON の形が変わった: `/collections/all/products.json` が想定と違う形を返すと、そのページで巡回を止めて失敗する(飛ばして進めると、それ以降の件数がすべて推測になるため → ADR-0014)。エラーにどのページかが出る。API 自体が無効化された場合は HTML を読む収集器を `StoreCollector` の背後に足す(共通コアは変わらない)。
- 403 が出る: User-Agent が拒否されている。過去に `crawler` という語を含む UA が拒否された。UA を変えるときは ADR-0009 を守り、識別可能で連絡先を含むものにする。**ブラウザ UA に偽装しない。**
- verify 失敗: 生成物の契約検証エラー。Publisher のバグなのでコードを直す。
- デプロイされない(`publishable: false`): サイトに載っていない店舗がある。summary の `### Site` に、どの店舗のマニフェストが無いかが出る。履歴に run がある店舗は自動で復元されるので、ここまで来るのは「復元も失敗した」か「その店舗の設定ファイルが無い」場合。**この状態でデプロイしないのは意図した動作**で、公開サイトから店舗が丸ごと消えるより run が 1 回無駄になるほうがましだから。

## 観測できなかった店舗の通知と run の長さ

隔離(quarantined)は公開を止めないので、ジョブは緑のまま終わる。warning 注釈だけでは見落とす(2026-11-09 のせんごく、#92)。そこで観測できなかった店舗は Issue で知らせる(ADR-0033)。

### どこに出るか

- `Crawl and publish` の `alerts` ジョブが、**店舗ごとに Issue を 1 件**作る。題名は `Crawl alert: <store> was not observed`、ラベルは `crawl-alert`、担当者はリポジトリの所有者(割り当ての通知が届く)。
- 対象は、その run で `quarantined` または `failed` で終わった店舗。本文に結果、失敗した段階、理由(`sanity.*` コードやエラー文)、run へのリンクが入る。
- 同じ店舗が次の run でも観測できなければ、新しい Issue は作らず同じ Issue にコメントを足す(1 run につき 1 回)。
- 次に観測できた run(`collect` が成功し、結果が `published` か `unchanged`)が、コメントを付けて Issue を閉じる。スナップショットの再取り込み(`reimport_snapshot_from_run`)も観測として数える。
- 作りも閉じもしない run: `dry_run=true`(`alerts` ジョブを動かさない)、その店舗を `--republish` しただけの run。

### 届いたら

1. Issue の理由を読む。`quarantined` は[隔離(quarantined)が出たら](#隔離quarantinedが出たら)、`failed` は[失敗(failed)が出たら](#失敗failedが出たら)の手順へ進む。
2. 直したら `workflow_dispatch` で `stores: <store>` を指定して回し直す。観測できれば Issue は自動で閉じる。
3. 手で閉じてもよい。次に観測できなかった run が新しい Issue を作る。

### run の長さ

- 収集ジョブ(`collect`、店舗ごと)と `publish` ジョブのそれぞれで、手順 `Run length against the limit` がジョブ開始からの経過を**そのジョブの**上限(`timeout-minutes`: `collect` 150、`publish` 60)と比べ、summary の `### Run length` に経過分と割合を出す。成果物のアップロードの後で測るので、ジョブのほぼ全体を含む。
- 80 %(`collect` 120 分、`publish` 48 分)を**超える**と warning 注釈 `Run length near the limit` が出る(ちょうど 80 % では出ない)。こちらは Issue を作らない。
- 出たら次の順で見る。
  1. どのジョブで出たかを見る。収集ジョブなら店舗が分かる。
  2. 秋月の収集ジョブで、full の日(週 1 回、約 85〜90 分)だったかを見る(→ [秋月の cover クロール](#秋月の-cover-クロール))。full の日でも 120 分は超えない想定なので、超えたらリクエスト数と 1 リクエストあたりの時間を前の run と比べる。
  3. 毎日超えるなら、そのジョブの `timeout-minutes` と `JOB_LIMIT_MINUTES` を**同じ値に**上げる(GitHub のホストランナーの上限は 360 分)。2 つの値が違うとテスト `tests/integration/crawl-notices-workflow.test.ts` が落ちる。
- アクセス間隔を詰めて短くしない(ADR-0009)。

### 仕組みと注意

- `issues: write` を持つのは `alerts` ジョブだけ。`plan`・`collect`・`publish` ジョブ(npm の依存を動かし、店舗のページを解析する)には書き込み権限を渡さない。`alerts` は `npm ci` をせず、依存のない `scripts/crawl-alerts.ts` を素の `node` で動かす。
- 入力は成果物 `reports-<run id>` の `pipeline-<store>.json`。失敗した店舗は、復元の republish が上書きする前の `pipeline-<store>.failed-run.json` を使う。レポートを書く前に終わった店舗は `failed_stores` から拾う。
- 店舗由来の文字列はデータとして扱う(コードブロックに入れ、バッククォートと HTML コメントの開始を無効化し、1 行 300 文字・10 行まで)。
- どの Issue がどの店舗のものかは、本文 1 行目のマーカー `<!-- crawl-alert store=<store> -->` で決める。**この行を編集・削除しない**(消すと次の run が別の Issue を作る)。
- ローカルで確認する: `node scripts/crawl-alerts.ts --reports <reports のあるディレクトリ> --dry-run`。`gh` を呼ばず、判定と予定の操作を JSON で出す。
- 止める: workflow の `alerts` ジョブを削除する。公開には影響しない(`deploy` は `alerts` に依存しない)。
- `alerts` ジョブが失敗しても、その run の公開は済んでいる。同じ run の通知は 1 店舗 1 回なので、ジョブを回し直しても重複しない。
- 開いている Issue の一覧は、作成の数秒後まで新しい Issue を返さないことがある(2026-11-10 の確認: 数秒以内に続けて 3 回通知すると 3 件作られ、20 秒あけると 1 件にまとまった)。run は毎日なので実運用では重複しないが、`scripts/crawl-alerts.ts` を手で続けて実行するときは間をあける。重複した Issue は、観測できた run がすべて閉じる。

## 収集ジョブと公開ジョブ

ADR-0034。run は次の順に進む。

| ジョブ | やること | 上限 |
|---|---|---|
| `plan` | 観測する店舗を決める(`Observed stores` の notice) | 10 分 |
| `Collect <store>`(店舗ごと、並列) | `crawl` コマンドでその店舗だけを読み、スナップショット(`snapshot-<store>-<run id>`)と収集の記録(`collect-<store>-<run id>`)を成果物に上げる | 150 分 |
| `publish` | 成果物を落とし、`STORES` の順に `pipeline --snapshot` で取り込み、サイトを作って検査する | 60 分 |
| `deploy` / `alerts` | 従来どおり | — |

- 各店舗へのリクエスト数・間隔・同時接続数は変わらない。1 店舗につき収集ジョブは 1 つで、その中は 1 本の直列クライアント。
- `republish=true` と `reimport_snapshot_from_run` の run では、収集ジョブは起動しない(`skipped` と表示される)。これは正常。
- 収集ジョブの結果の読み方:

  | 収集ジョブ | `publish` での扱い | 通知 |
  |---|---|---|
  | 緑(完了) | 取り込む | — |
  | 緑 + warning `collection incomplete`(終了コード 2) | スナップショットは上がる。取り込みが隔離し、公開済みデータを維持する | Issue(`quarantined`) |
  | 赤(終了コード 1、タイムアウト、成果物のアップロード失敗) | スナップショットが無いので pipeline を動かさず、`failed` として公開済み履歴から復元する。`publish` は最後に失敗する | Issue(`failed`)、ジョブの失敗通知 |

- **落ちた収集ジョブは「Re-run failed jobs」で回し直さず、原因を直してから `workflow_dispatch` で `stores: <store>` を指定して回し直す。** 同じ run の回し直しでは、同じ名前の成果物(`snapshot-<store>-<run id>` など)をもう一度上げることになり、その動作は確かめていない。新しい run なら名前が重ならず、何を観測したかも 1 つの run にまとまる。
- 収集は済んでいて取り込みだけが落ちたとき(`publish` が赤、収集ジョブは緑)は、クロールし直さずに `reimport_snapshot_from_run` にその run id を入れて取り込み直す(→ [特定スナップショットの取り込み直し](#特定スナップショットの取り込み直し))。
- 秋月の cover の記録(`state/work/carry`)は収集ジョブがキャッシュから戻し、収集ジョブが保存する。`publish` はこのキャッシュに触れない。
- ローカルで同じ流れを確かめる:

  ```bash
  node --import tsx src/cli/main.ts crawl --config config/<store>.json
  node --import tsx src/cli/main.ts pipeline --config config/<store>.json --snapshot snapshots/<store>-<timestamp>.json.gz --collect-record reports/collect-<store>.json
  ```

  記録の店舗 ID かスナップショットの SHA-256 が合わなければ、`collect` 段階が失敗する(別の run の記録を取り違えたときに気づける)。`--collect-record` を省くと、従来の `--snapshot` と同じ動作になる。
- 戻す: ワークフローを 1 つ前の版に戻す。`pipeline` の live 収集はそのまま残っているので、コードは戻さなくてよい。

## 頻度を変える / 止める

- 全店舗の定期 run を止める: workflow の schedule をコメントアウトしてコミット。公開データはそのまま残る。
- **1 店舗の観測を止める**(サイト閉鎖など、再開の見込みがない場合): `config/<store>.json` の `observation.cadence` を `"stopped"` にしてコミットする。schedule も `stores` 空の手動実行もその店舗を観測せず、毎回 `--republish` で公開済み履歴から再生成する。パイプライン自体も、`--republish` 以外(クロール・`--snapshot`・`--bootstrap`)と `crawl` コマンドを拒否する(終了コード 1)。マニフェストから `samplingIntervalDays` と観測間隔の注意書きが消え、観測期間(最初〜最後の観測日と回数)は残る。反映は次の run か `republish=true` の手動実行(ADR-0029)。
- 店舗の頻度は `config/<store>.json` の `observation.cadence` (`daily` / `weekly` / `monthly` / `stopped`)で指定する。**注意書きは cadence から決まるので、手で直さない。** 現在の workflow が持つ cron は毎日 1 本だけ。周期を追加する際は cron・`scripts/observed-stores.ts`・`tests/integration/observation-cadence.test.ts` も変更する。
- 新しい周期を足す: `src/publisher/contract.ts`(`ObservationCadence` と省略可能な観測間隔フィールド。旧版が未知のcaveatキーを拒否することに注意)、`userscript/core/format.ts`(利用者に見える文言)、workflow の cron と選択ロジック、そして上のテストを一緒に更新する(ADR-0016)。
- 毎日化後もアクセス間隔・ジッター・再試行上限は維持する。秋月の HTML 巡回は、全一覧の日(週 1 回)が約 2,700 リクエスト・約 85 分、ほかの日は約 900 リクエスト・約 30 分(ADR-0032、実測は導入後に確認)。店舗を 1 つのジョブで順に回していたころの 1 run は約 2 時間 55 分だった(2026-11-07 の run)。店舗ごとの収集ジョブに分けてからは、最も長い店舗の収集時間に取り込みを足した長さになる(ADR-0034、実測は導入後に確認)。店舗ごとのリクエスト数と間隔は変わらない。公開データとは別に、90日保存するスナップショットと状態バックアップの Actions artifact 容量をジョブごとに確認する。

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
