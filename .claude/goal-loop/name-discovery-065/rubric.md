# Goal: 名前ベースの照合候補探索（0.6.5, Issue #49）を、既存の照合を変えずに全件判定済みで出す
Workdir: C:\Codes\tsuyoshi-otake\electro-parts
Baseline: 0.6.4 の `data/matching`（0.6.5 の変更を入れる前の状態。0.6.4 と 0.6.5 を同じブランチで作ったため、採点時は作業用の一時コピーを使った。コミット後は 0.6.4 のコミットの `data/matching/candidates.jsonl`）。

## Criteria
- C1: 生成物が正本から再現でき、未判定の候補がない。Verify: `npm run matching:check --silent`。Expect: 終了コード0、出力に `"candidates":4176,"pending":0`。
- C2: 未判定の名前の提案がない。Verify: `npm run matching:names --silent` の出力行数と、`data/matching/coverage.json` の `nameProposals`。Expect: 0行、`nameProposals` は空配列。
- C3: 既存の候補を変えていない。Verify: baseline の `candidates.jsonl`（4,087行）の各行について、現行 `data/matching/candidates.jsonl` に同じ `id` があり、`fingerprint` と `codes` が一致するかを数える。Expect: 不一致0件。現行は4,176行で、追加の89件はどれも `data/matching/reviews.json` に同じ `id` と `fingerprint` のレビューがある。
- C4: 追加の89件のレビューが自然言語の判定の形を満たす。Verify: 追加89件のレビューを読む。Expect: 全件の `evidence` が `名前ベースの候補（共通語:` で始まる。`reviewerModel` は `Claude Sonnet 5.5` か `Claude Opus 5.5`。Opus のものは `evidence` に `初回判定（Claude Sonnet 5.5）は` を含む。`same_product` は `missingEvidence` に `価格比較条件は未承認` を含む。`unresolved` は `missingEvidence` が空でない。`rejected` は `missingEvidence` が空。
- C5: 類似商品は製品群として記録され、相違が具体的。Verify: `data/matching/families.json` で `id` が `name-` で始まる製品群を調べる。Expect: 18件。各製品群は異なる店舗の2行で、`variant` が異なり、特徴のキーが両行で同じで、少なくとも1つの値が異なる。特徴の値に `記載なし` を含まない。メンバーの行がカタログ（`data/matching/catalog.jsonl`）で `variants` を持つなら、そのメンバーに `offerId` があり、その variant が存在する。
- C6: 探索が有界で、テストと型検査が通る。Verify: `scripts/matching/names.ts` を読み、`npx vitest run tests/unit/matching-names.test.ts tests/unit/matching-generator.test.ts` と `npm run typecheck` を実行する。Expect: names.ts に計算量の記述があり、総当たり（全行×全行の二重ループ）がない。テストは全件成功し、20,000行×2店舗のテストが含まれる。typecheck は終了コード0。
- C7: 同一商品でつながる行の間に、要確認・対象外のレビューが新しく増えていない。Verify: `node .claude/goal-loop/name-discovery-065/consistency.mjs .`。Expect: `conflicts` は `a116956-s5843 unresolved` と `a130198-s5682 unresolved` の2件だけ。
- C8: 版と記録が更新されている。Verify: `package.json`・`package-lock.json`（ルートの2か所）・`userscript/version.ts` の版を読む。`docs/adr/0018-reviewed-catalog-mapping-pipeline.md`、`docs/roadmap/three-store-mapping.md`、`README.md`、`public/index.html` を読む。Expect: 版はすべて0.6.5。ADR に `## 0.6.5` があり、その下に `### 探索の段階の順序`、`### 統合確認の規則`、`### 結果` がある。照合レポートの0.6.5の表の「計」行は107・28・18・24・37で、各店舗の組の行の合計と一致する。README と index.html は0.6.5と4,905組を記載する。
- C9: 共通コアに店舗名を足していない。Verify: `git diff --name-only` と `git status --short` で変更ファイルを列挙する。Expect: `src/core`、`src/db`、`src/publisher`、`src/pipeline`、`userscript/core`、`userscript/ui` の下に変更ファイルがない。
