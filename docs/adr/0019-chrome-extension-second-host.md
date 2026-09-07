# ADR-0019: Chrome 拡張はユーザースクリプトの第 2 のホスト束縛として出す

状態: 採用 / 2026-09-07 / Issue #6 / userscript 0.4.1

## 背景と境界

パネルを見るのに Tampermonkey の導入が要る。拡張機能を 1 つ入れれば済む利用者にとっては、これは余分な段階が 1 つ多い。

境界: 表示するもの・取得するデータ・観測頻度は変えない。`userscript/core`・`userscript/ui`・`userscript/adapters` は 1 行も変えない(変える必要が出るとしたら、それはホストの抽象が足りていないという意味であり、そのときは `HostEnv` を直す)。Chrome ウェブストアへの登録は範囲外。

## 決定

- `extension/` はユーザースクリプトと**同じソースから作る第 2 のホスト束縛**である。`userscript/main.ts` が GM API を `HostEnv` に束ねるのと同じ位置に `extension/host.ts` が居る。パネル・アダプタ・データクライアントは共有物であり、複製しない。
- 束縛の中身は 3 つだけ。保存先は `chrome.storage.local`、時刻は `Date.now()`、通信は**サービスワーカーへのメッセージ 1 種類**(`eph:fetch-text`)。
- 通信をコンテンツスクリプトから直接行わない。ワーカーが `credentials: 'omit'` で取得するので、店舗のページはこちらの取得を発行元としても観測しない。これは `GM_xmlhttpRequest { anonymous: true }` が与えていた性質をそのまま保つためであり、同時に取得先の CORS 設定に依存しなくなる。
- ワーカーは拡張内で唯一ネットワークに触れる場所であり、閉じた扉として書く。受け付けるメッセージは 1 種類、送り主は自分の拡張 ID のみ、URL は `DATA_HOSTS` の https のみ、待ち時間は上限 30 秒。店舗のページから任意の中継として使えない。
- `manifest.json` は**生成物**で、手書きしない。`content_scripts[].matches` はアダプタ登録簿から、`host_permissions` は `DATA_HOSTS` から、`version` は `USERSCRIPT_VERSION` から作る。権限は `storage` だけで、`tabs`・`cookies`・`<all_urls>` は持たない。
- アイコンも生成物とする(`scripts/lib/icon.ts` + `png.ts`)。バイナリを 1 つも repo に置かず、色はパネルの配色から取る。
- 配布は `site/electronics-price-history-extension.zip` 1 つ。展開して「パッケージ化されていない拡張機能を読み込む」で入れる。**ウェブストアには出さない**。
- 版はユーザースクリプトと同じ番号を使う。両方が同じバンドルから出る以上、別々の番号は嘘になる。

## 理由

拡張とユーザースクリプトの差は、**ブラウザが何を貸してくれるか**だけである。表示も判断もデータも同じものを見せる約束なので、共有すべきものを共有しない実装(コピーした UI、別に書いたアダプタ)は、いずれ片方だけ直る。`HostEnv` は最初からこのための継ぎ目だった。今回それが実際に足りているかの試験になり、足りていた — 共有側の変更は 0 行である。

マニフェストを生成物にしたのは ADR-0016 と同じ理由による。「対応店舗」がアダプタ登録簿とマニフェストの 2 か所にあると、片方だけ編集できてしまう。生成にすれば、店舗を足したときに `matches` が自動で正しくなり、逆に手で足した権限はテストで落ちる。

ウェブストアに出さないのは、審査と公開者責任を引き受ける判断がまだ無いからである。zip の手動導入は毎回「デベロッパーモードの拡張機能」警告が出るし、自動更新もされない。それを承知の上で、まず配れる形にする。

## 結果

- 拡張には自動更新が無い。ユーザースクリプトは `@updateURL` で新版を取りに行くが、拡張の利用者は zip を取り直す必要がある。版を上げたときは README とサイトの案内で知らせる。
- `matches` はアダプタの `matchPatterns` そのままなので、`www.akizukidenshi.com` は対象外(ユーザースクリプトと同じ挙動)。変えるならアダプタ側を変える。
- ワーカー経由の取得により、データ取得元の CORS ヘッダに依存しなくなった。GitHub Pages が `Access-Control-Allow-Origin: *` を止めても拡張は動く(ユーザースクリプトは GM 側に依存したまま)。
- 1 商品ページあたりの通信はユーザースクリプトと同じ 2 回で、E2E がその上限を実ブラウザで検査する。
- 秋月・スイッチサイエンスへのリクエストは増えない。この ADR は相手サイトへの負荷を変えない。

## 更新・検証手順

1. Verify: `npm run typecheck`。Expect: `tsconfig.json` / `userscript/tsconfig.json` / `extension/tsconfig.json` の 3 つとも成功。
2. Verify: `npm test`。Expect: `tests/contract/extension-manifest.test.ts` がマニフェストを登録簿・`DATA_HOSTS`・版と突き合わせ、`tests/unit/extension-fetch-proxy.test.ts` がワーカーの拒否・タイムアウト上限・送り主検査を、`tests/userscript/extension-host.test.ts` が保存済みページでの実際の描画を検査する。テストプロセスが終了したことも確認する。
3. Verify: `npm run test:e2e`。Expect: `extension-akizuki.spec.ts` が実ブラウザに未展開の拡張を読み込み、ワーカーが取得したデータでパネルが出て、通信が 2 回であること。ローカルで独立 headless を起動しない(Playwright に任せる)。
4. Verify: `npm run build:extension` の後 `chrome://extensions` で `dist/extension` を読み込み、両店舗の実商品ページを開く。Expect: パネルが購入エリアの下に出る。これは人が行う確認であり、自動化していない。
5. 公開は `gh workflow run crawl-publish.yml -f republish=true`。Verify: `https://tsuyoshi-otake.github.io/electro-parts/electronics-price-history-extension.zip` が新しい版のマニフェストを含むこと。Expect: 観測回数・データ版は不変。
