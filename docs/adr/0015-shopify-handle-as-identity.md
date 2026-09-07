# ADR-0015: Switch Science の商品同一性は Shopify の handle、商品 ID と SKU はエイリアス

- 状態: 採用(2026-09-07)
- 関連: `src/adapters/switch-science/snapshotAdapter.ts`、`userscript/adapters/switch-science.ts`、ADR-0001、ADR-0002、ADR-0014

## 背景

ADR-0001 で商品の同一性は `(store_id, external_product_id)` と決めてある。Switch Science のカタログ JSON(ADR-0014)には、その `external_product_id` になり得るものが 3 つある。

- `id`: Shopify の数値商品 ID(例 `8443434074349`)。
- `handle`: URL の末尾になる文字列。実測 10,382 商品のほとんどが数字(`9381`、`11353`)で、`rpicm-pl` のような語形も混じる。
- `variants[].sku`: 店舗が付ける SKU。空のものがある。

選び方を決めるのは収集側の都合ではない。**ユーザースクリプト側が見えるかどうか**である。ユーザースクリプトが商品ページで持っている手がかりは URL と DOM だけで、`/products/<handle>` の `<handle>` は URL に書いてある。数値 ID と SKU は書いていない。

## 決定

- `external_product_id` と `pageKey` は **handle** とする。両者は同じ値であり、公開ファイル名 `products/<handle>.json` もこれである。
- handle は `^[a-z0-9][a-z0-9._-]{0,63}$` かつ `isSafeKey` を満たすものだけを受け入れる。Shopify が許す範囲より意図的に狭い。満たさない handle は収集器が落とし、`catalog.uncovered` に計上する。**落としたことは報告する。黙って消さない。**
- 数値商品 ID と SKU はエイリアス(`handle` / `shopifyProductId` / `sku`)として記録する。記録するだけで、**引き当てには使わない**。ADR-0001 の「自動名寄せをしない」がここでも効く。
- オファー ID は variant ID とする。`DEFAULT_OFFER_ID` は使わない。
- ページ側の鍵は canonical link を優先し、パスと突き合わせる。食い違ったらその画面は商品ページとして扱わない。

## 理由

同一性は、収集側と表示側の**両方から同じ値が見えなければ機能しない**。数値 ID を選ぶと、ユーザースクリプトはそれを得るために商品ページのマークアップか埋め込み JSON を読むことになる。ADR-0014 でマークアップ依存を捨てたのに、同一性の側から呼び戻すことになる。

SKU は「型番らしさ」では一番近いが、空のものがあり(`missingSku` として毎回計測している)、店舗の運用で変わり、URL にも出ない。同一性ではなく `modelNumber` として持つのが正しい位置である。

handle の多くが数字であることは、`9381` のような値が秋月の通販コードと見た目で区別できないことを意味する。だから同一性は店舗スコープでなければならない — ADR-0001 の `(store_id, external_product_id)` が、ここで初めて実際に効く。

Shopify は同じ商品を `/products/<handle>` と `/collections/<collection>/products/<handle>` の両方で出す。どちらの URL から入っても同じ鍵になる必要があり、店舗自身の答えである canonical link をパスより優先する。両者が食い違う画面は、どちらが正しいか**こちらには決められない**ので、商品ページとして扱わない。推測で描くほうが悪い。

オファーを variant ID で持つのは将来のためである。現在はすべて 1 variant なので `DEFAULT_OFFER_ID` で足りるが、それだと商品に 2 つ目の variant が付いた日に、唯一のオファーが消えて履歴が振り出しに戻る。variant ID は今なんの費用もかからず、その日の履歴を守る。

## 結果

- handle が変更されると別商品として観測が始まり、履歴はそこで切れる。Shopify は旧 URL を新 handle へリダイレクトするので、利用者のブラウザは新しい鍵に着地し、パネルは「まだ観測データに含まれていません」から積み直す。旧系列は旧鍵のまま保持期間まで残る。
- そのとき `shopifyProductId` エイリアスが、旧鍵と新鍵が同じ商品だったことを**後から人が確かめる**手段になる。自動では繋がない(ADR-0001)。
- 共通コアは handle という概念を知らない。アダプターが `isValidPageKey` と `productUrlForPageKey` を実装するだけで、店舗ごとの鍵の形は境界の内側に収まっている。
