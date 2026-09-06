# ADR-0001: 商品の同一性は `(store_id, external_product_id)`、自動名寄せをしない

- 状態: 採用(2026-09-06)
- 関連: Issue #1、`src/core/identity.ts`、`src/adapters/akizuki/snapshotAdapter.ts`

## 背景

価格履歴は「同じ商品」に結び付いて初めて意味を持つ。店舗ごとに ID 体系(秋月の通販コード、Shopify の product ID、URL の handle)が違い、同じ部品が複数店舗に存在し、店舗内でも型番の再利用やページ移動が起きる。

## 決定

1. 履歴の主キーは `(store_id, external_product_id)`。共通コアは両者を不透明な文字列として扱う。
2. `pageKey`(ユーザースクリプトが URL から取る値、静的ファイル名)は `external_product_id` とは**別の属性**。秋月では両方が通販コードで一致するが、それはアダプターだけが知る前提であり、共通コアは `pageKey` から商品ファイルを解決するのに manifest の `productPathTemplate` を使う。
3. 型番・商品名・URL による**自動マージはしない**。店舗をまたぐ同一商品の対応付けもしない。エイリアス(`product_aliases`)は記録するだけで、履歴を結合しない。
4. 同じ ID で名前や型番が大きく変わった場合は `metadata_events` に記録し、`suspicious_identity` の注意書きを付けて公開する。判断は人間に委ねる。
5. ID は `SAFE_KEY_PATTERN`(英数字と `._-`、128 文字以内、`..` 禁止)で検証し、ファイル名・URL・キャッシュキーに安全に使える形だけを受け付ける。

## 理由

- 誤った名寄せは履歴を汚染し、後から分離するのが極めて難しい。分けたままなら後で結合できる。
- 秋月では通販コードが URL と一致するので Phase 1 の体験は損なわれない。Phase 3 のスイッチサイエンスは `pageKey`(handle)と ID(Shopify product ID)が別になり得るため、今から分けておく。

## 結果

- Phase 2 / 3 で「同じ部品を他店で見る」機能は、別途の明示的な対応表として設計する必要がある(ロードマップ参照)。
- 商品コードの再利用は履歴の連続として見えるが、注意書きで利用者に知らせる。
