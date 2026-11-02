# Goal: close the cross-store discovery gaps of Issue #48 and release the mapping as 0.6.4
Workdir: C:\Codes\tsuyoshi-otake\electro-parts (branch fix/discovery-keys-064, uncommitted changes against HEAD)

Scratch scripts go to the system temp directory, never into the repository. Run TypeScript snippets with `node --import tsx` (use a `.mts` file for top-level await; a script that imports repository modules by relative path must sit in the repository root while it runs, then be deleted). In Git Bash, arguments that start with `/` are rewritten as paths; put patterns inside script files. `git show HEAD:<path>` gives the committed version of a file.

## Criteria
- C1: The generated mapping is current. Verify: `npm run matching:check`. Expect: exit 0 and the line `{"candidates":4087,"pending":0,"relations":4836,"same":3931,"similar":823,"pricePolicies":2}`.
- C2: Already-reviewed candidates and reviews are untouched. Verify: compare `data/matching/candidates.jsonl` with `git show HEAD:data/matching/candidates.jsonl` line by line (parse each line as JSON, key by `id`), and the first 3,842 entries of `data/matching/reviews.json` with HEAD's `reviews.json`. Expect: every one of HEAD's 3,842 candidates is present with identical `codes`, `fingerprint`, `products` and `derived`; there are exactly 245 new ids; HEAD's 3,842 reviews deep-equal the first 3,842 entries of the working-tree file; the working-tree file has 4,087 entries.
- C3: The new discovery rules behave as specified and are tested. Verify: `npx vitest run tests/unit/matching-generator.test.ts`; read `derivedCodes`, `referenceKeys`, `resaleReference` and `SENGOKU_RESALE_LABELS` in `scripts/matching/catalogs.ts`, and `discover` and `makerClaim` in `scripts/matching/model.ts`. Then call `derivedCodes` and `referenceKeys` yourself on listings built from these rows (other fields may be empty strings): akizuki `TC74HC138AP(F)`; akizuki `P-421-5(E)R`; sengoku `PIC16F84A-20I/SS`; switch-science `POLOLU-3424`; switch-science `SFE-BOB-11083`; sengoku `AMCS-473/630`; sengoku `SSCI-012164/1216`; sengoku model `【10444】X` with vendor `Waveshare`; sengoku model `【3650】M5STACK-PROTO-MODULE` with vendor `M5STACK`. Expect: 44 tests pass. The derived keys are, in order of the rows: `TC74HC138AP`; `P-421-5`; none; none; `BOB-11083`; none; `SSCI-012164`; `10444`, `X`; `PROTO-MODULE`. The last two come from 0.6.3 rules (the Waveshare bracket SKU and the M5Stack-scoped prefix), so they equal the output of HEAD's `derivedCodes` for the same rows. `X` is later dropped as too short. 【N】 is not a derived key on either row. `referenceKeys` gives `SWITCH-SCIENCE/1216` for the `SSCI-012164/1216` row, nothing for the Waveshare row, and `SWITCH-SCIENCE/3650` for the M5STACK row. `discover` adds later-tier pairs only when the ids are absent from earlier results. `makerClaim` returns `''` only for a switch-science row whose manufacturer is `スイッチサイエンス`.
- C4: Every new candidate has a complete review. Verify: in a script, take the reviews at index 3,842 onward in `data/matching/reviews.json` and join them to `data/matching/candidates.jsonl` and `data/matching/catalog.jsonl` (rows keyed `storeId/pageKey`). Expect:
  - Each of the 245 reviews matches a candidate id and fingerprint.
  - Decisions: `same_product` 208, `unresolved` 15, `rejected` 22.
  - Every `same_product` has a `missingEvidence` entry containing `価格比較条件は未承認`.
  - Every `unresolved` has non-empty `missingEvidence`; every `rejected` has empty `missingEvidence`.
  - Every `differences` entry matches `^[^:]+: (.+?)「.*」 ↔ (.+?)「.*」$`, with group 1 and group 2 being the two products' store labels in product order. The labels are 秋月電子, スイッチサイエンス, M5Stack公式, KSY and せんごく.
  - `reviewerModel` is `Claude Sonnet 5.5` or `Claude Opus 5.5`, and each Opus review's evidence contains `初回判定（Claude Sonnet 5.5）は`.
  - Pair outcomes: `["akizuki","107553","sengoku","EEHD-0HY7"]` (TLP785 GR vs GB) is `rejected`; `["akizuki","107554","sengoku","EEHD-0HY7"]` is `same_product`; `["switch-science","1216","sengoku","EEHD-0SS7"]` is `same_product`.
- C5: Reviews do not contradict each other through same-product links. Verify: build connected components over all `same_product` reviews in `data/matching/reviews.json` (review ids are either `a<akizuki>-s<switch-science>` or a JSON array `[store, page, store, page]`). For every `unresolved` or `rejected` review, check whether its two rows fall in one component. Expect: the only such reviews are `a116956-s5843` and `a130198-s5682`, and both already exist in HEAD's `reviews.json` with the same decision.
- C6: The full suites pass and leave nothing running. Verify: `npm run typecheck`, `npm test`, `npm run test:e2e` (about 1 minute; if global setup fails with `EPERM: rename` under `test-results`, wait 45 seconds and run it once more), `npm audit --audit-level=high`. Afterwards list processes whose command line contains `vitest`, `ms-playwright` or `playwright` together with this repository's path, excluding your own shell. Expect: all four exit 0 (649 unit tests in 50 files; 17 E2E passed); no such process remains.
- C7: Architecture guards hold. Verify:
  - Run `grep -rniE 'akizuki|aitendo|switch[-_ ]?science|akizukidenshi|m5stack|ksy|sengoku' src/core src/db src/publisher src/pipeline userscript/core userscript/ui | grep -vE ':[0-9]+:\s*(//|\*|/\*)'`.
  - Run `git diff --stat HEAD -- src userscript/core userscript/ui extension`.
  - Run `git diff HEAD -- package.json package-lock.json`.

  Expect: the grep prints nothing; the second diff is empty; the package diff changes only the version fields, from 0.6.3 to 0.6.4.
- C8: The records state the change with the measured numbers. Verify: read the following.
  - The `## 0.6.4` section and the lines containing `【N】` in `docs/adr/0018-reviewed-catalog-mapping-pipeline.md`.
  - The `## 0.6.4` section of `docs/roadmap/three-store-mapping.md`.
  - The first `<h2>` and its paragraph in `public/index.html`.
  - The paragraph starting `0.6.4 の対応表` in README.md.
  - The count line in `docs/chrome-web-store-listing.md`.
  - The version in `userscript/version.ts`.

  Expect:
  - ADR-0018 0.6.4 describes the derived-key rules, the tiered discovery, `makerClaim` and the label-gated `【N】` with the 420/420 and 37/37 measurements. The 0.6.1 `【N】` line notes that 0.6.4 changed it.
  - The roadmap table's rows sum to 245 candidates, 208 same, 15 unresolved and 22 excluded.
  - Build `generate(...)` once from HEAD's `data/matching` files and once from the working-tree files, both with the working-tree scripts, and compare their `report.byStorePair`. For each row, 新しい候補 equals that pair's `pending` in the HEAD-data build. Its 同一商品確認済み and 要確認 columns equal the increase in `verified` and `unresolved` from the HEAD-data build to the working-tree build.
  - The roadmap accounts for all 15 unresolved pairs (grouped rows are fine) and says that name-only similar products are out of scope.
  - index.html and README state 4,836 relations (3,931 / 2 / 823 / 6 / 74) and 245 candidates (208 / 15 / 22).
  - The listing says 約3,900組, and `userscript/version.ts` is 0.6.4.
