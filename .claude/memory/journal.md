# Journal (append-only)

## 2026-09-06 — Phase 1 design and core (#1, f9e58af)

- Work: store-neutral domain (`Product` / `Offer` / `PriceQuote` in integer minor units, price basis, availability enum with `not_displayed`), change-point history core with order-independent reduce, Akizuki snapshot adapter.
- Verification: unit + fast-check property tests (import order independence, idempotence). `npm test` green.
- Learning: separating `pageKey` from `external_product_id` now costs nothing and unblocks Shopify handles later.

## 2026-09-06 — SQLite history with order-independent import (#1, 1e71308)

- Symptom: naive "append if different from last" import produced different series depending on import order.
- Root cause: a late-arriving observation must look at both neighbours (previous and next change point) to decide whether to insert, collapse or split.
- Fix: `planInsert` / `applyPlan` on the previous/next state; same-time different-content raises `SnapshotConflictError`; duplicate hash is `already_imported`.
- Verification: PBT over shuffled permutations equals sorted import; DB tests for conflict, presence gaps, inventory rollups.

## 2026-09-06 — Static contract v1 and deterministic publisher (#1, 6d83244)

- `datasetVersion` = hash of the set of accepted `(observedAt, normalizedHash)`; write is temp-dir + rename; `validate*V1` shared with the userscript.
- Learning: putting the contract major version in the path makes v2 a parallel directory, not a migration.

## 2026-09-06 — Akizuki collector (#1, 35a3f00)

- Symptom: live probe returned 403 with a UA containing `crawler`; `curl.exe` segfaulted on the host.
- Root cause: WAF keyword rule; local curl build issue.
- Fix: project UA with contact URL (ADR-0009); probes via `node fetch`.
- Verification: 18 genres / ~200 pages crawled completely in ~6 min at 1.5 s + jitter; recorded pages became gzip fixtures; parser PBT.
- Real-data check: FT232RQ (109951) 1150 → 1200 and RE-280RA (106438) 250 → 280 appear as change points between the 2026-08-02 and 2026-09-06 snapshots.

## 2026-09-06 — Pipeline state machine, CLI, previous state (#1, ca19cea)

- Stages previous_state → collect → validate → import → compact → generate → finalize → verify; outcomes published / unchanged / quarantined (exit 3, still publishes) / failed (exit 1).
- Learning: `--bootstrap` must be refused when a published state exists, otherwise a mis-click erases history.

## 2026-09-06 — Tampermonkey userscript (#1, 8fff596)

- Store-neutral data client (SWR on `datasetVersion`, LRU 200, negative 404 entries), Shadow DOM panel, bundled SVG step chart, Akizuki page adapter, jsdom tests, Playwright E2E on the saved product page against a local static site.
- Symptom: chart tail did not reach "now"; fixed by extending the last step to the manifest `generatedAt`.
- Learning: Buffer → ArrayBuffer slicing bug when serving fixtures; see rules.

## 2026-09-06 — Workflows, benchmark, mutation testing, docs (#1, fe9ad82)

- Symptom: first Stryker run scored 68.95 % (< 70 break) with 100 NoCoverage mutants.
- Root cause: `vitest.related: true` only ran tests importing the mutated file directly; core is mostly exercised via adapters/DB/publisher.
- Fix: `related: false, dir: 'tests'` + `tests/unit/core-guards.test.ts` (24 tests on identity/time/price/sanity/history/stats boundaries).
- Verification: second run 89.45 % (595 killed, 7 timeout, 61 survived, 10 no coverage of 704).
- Benchmark (9,000 products, daily): 1 y import total 148.9 s, p95 460.7 ms, SQLite 14.73 MB, site 27.08 MB; 3 y import total 610.2 s, p95 740.5 ms, SQLite 35.39 MB, site 32.23 MB; 5 y row recorded in README.
- Learning: heredocs are unusable for Japanese docs in this harness; ADRs / docs written via a Python script created with the Write tool.

## 2026-09-06 — Phase 1 published: public repo, Pages, bootstrap run (#1, 3e91b11)

- Work: pushed `main`, flipped the repository to public (explicitly authorised by the user, overriding the default private-only policy), enabled Pages with `build_type=workflow`, ran the bootstrap `Crawl and publish` dispatch.
- Verification before publishing: full pipeline run locally with both recorded snapshots through the exact CLI the workflow uses — bootstrap (8,701 products, `datasetVersion a7669a9381e9102f`) then incremental (8,809 product files, `6aa44a3bf73859e3`, 168 primary price changes, 132 absent, 108 new). `summary` renders the stage table; `verify` exits 0. FT232RQ 109951 shows `1150 → 1200 (+50, +4.35 %)` and RE-280RA 106438 `250 → 280 (+30, +12 %)` in the published files; exactly one product (117275) carries the `suspicious_identity` caveat, so the metadata-change path reaches the contract.
- CI on the pushed commit: typecheck + 204 tests + 3 E2E in 1m33s, mutation job 13m41s, both green.
- Benchmark (9,000 products, daily): 5-year row 1,825 runs, import p50 413.3 ms / p95 719.9 ms / max 4508.0 ms, SQLite 53.86 MB, static payload 39.00 MB, largest product file 7.8 KB, 110,020 price change points, peak RSS 666.30 MB — inside every budget.
- Symptom: the first full benchmark was killed by its `timeout` (exit 124) after the 3-year row, so the Markdown table was never printed.
- Root cause: the wrapper timeout was sized for the 1/3-year rows; the 5-year row alone needs ~20 min of import time.
- Fix: re-ran `--years 5` separately with a 5,400 s timeout; results pasted into the README between the `bench:` markers.
- Learning: size a background benchmark's timeout from the largest row, and write each row to the log as it completes (the script already did, which is why nothing was lost).
- Production bootstrap run 34034624075 succeeded in 7m51s: 18 genres / 211 pages, 211 HTTP attempts with 0 retries and 95 s of polite waiting, 12,215 occurrences deduplicated to 8,677 products, `complete=true`; import 672 ms, generate 1,971 ms (16.07 MB), finalize 81 ms (SQLite 5.93 MB), verify 897 ms; `datasetVersion 193bb3a90bc4c2c6` served from Pages together with `state/state.json`, the landing page and the userscript.
- Learning: the live crawl costs ~7.5 min wall clock, of which 95 s is deliberate waiting; the 10-minute budget holds but leaves little headroom if the catalogue grows, so `maxPagesPerGenre` and the interval are the knobs to watch.

## 2026-09-06/07 — Catalogue coverage: crawl targets from the sitemap (#1, 9cacfde)

- Symptom: the user opened product 131975 and the panel rendered but said 「記録なし」.
- Root cause: the crawler walked a hand-written list of 18 `/catalog/r/` genres. Nobody had ever checked what that list covered. Akizuki's sitemap counts 13,027 product pages; the 18 genres reached 8,677 (66.6 %). A product outside them is permanently absent, and the gap is silent by construction — a hand-written list cannot report what it omits.
- Fix: discover crawl targets from `Sitemap_index.xml` (458 `c` categories, 1,412 `r` genres, 13,027 products). Config states only which families to walk (`collector.listingKinds`); `collector.genres` is removed from raw schema 3 and is an error if still present. The sitemap's product set became the coverage oracle: `uncovered` above `maxUncoveredProducts` marks the run incomplete.
- Measurement that decided the config (full probe of every listing): `c` 11,098/13,027 (85.19 %, 777 requests), `r` 12,677/13,027 (97.31 %, 1,937), `c ∪ r` 12,772/13,027 (98.04 %, 2,714). Threshold 600: the residual is 255 and 10 of 10 sampled were 販売終了 products removed from every listing, which a listing crawl cannot reach.
- Learning: **fix the families, never alternate them.** Alternating `c` and `r` by day would churn `coverageId` (invalidating ADR-0004's missing-product comparison every run) and would fabricate delisted/relisted history for the 1,674 products only one family lists.
- Side effect: the `c` tree uses a second listing layout (`table.block-goods-list-l--table`) with no cart and no quantity, which the parser had never seen because the hand-written genre list happened to be all card layout.

## 2026-09-06/07 — Monthly observation cadence (#1, 8a3c9b9)

- Request: 「そんなに頻繁にかわらないので1ヶ月に1回でいいよ」.
- Change: cron `17 20 1 * *` (2nd of the month, 05:17 JST). ~81,000 → ~2,700 requests a month.
- Learning: a cadence change is not just the cron line. Everything downstream had to move with it — the user-visible sampling caveat in `userscript/core/format.ts` (not `src/publisher/generate.ts`, which the docs pointed at), snapshot artifact retention (30 → 90 days, otherwise the artifact expires before the next run), the runbook's recovery expectations, and the README's framing of a daily benchmark as an upper bound. Sanity thresholds were deliberately left alone: they detect parser breakage, they are not predictions about how much a month of drift should move.
- Judgment call: an 85-minute crawl was in flight when the cadence changed. Cancelled at ~12 min and re-dispatched from the new commit rather than publish a userscript claiming daily sampling and pay for a second full crawl to correct it (~350 wasted requests vs ~2,700).

## 2026-09-06/07 — Quarantined snapshot, phantom listing disagreements, re-import path (#1, 3dc2af3)

- Symptom: production run 34042660353 crawled all 12,772 products, then quarantined on 3 × `item.price_tax` ("price is not marked tax included"), so nothing was imported and Pages still served 8,677.
- Root cause: a 販売終了 row's price cell has `amountYen: null, taxIncluded: false`. `normalizeAkizukiItem` turns that into an `unavailable` quote **without reading `taxIncluded`**, so the validator was rejecting an 12,772-item snapshot over a field nothing consumes.
- Fix: only require 税込 when the cell actually states an amount (`src/adapters/akizuki/snapshotAdapter.ts`).
- Second symptom in the same run: 221 "listing differs between listings" warnings, all of the form `￥770` vs `￥770～`.
- Root cause: the spec-table layout prints **every** price with a trailing 〜. Verified live: all 54 rows of `c/cantenna-` carry it while product page g110958 shows a single price. It is the template's wording, not a range.
- Fix: `sameListing` compares recorded facts (`amountYen`, `taxIncluded`, `quantityUnit`, stock status) instead of the display string.
- Also added `reimport_snapshot_from_run` to the workflow so a pipeline-only fix can re-import a previous run's snapshot artifact instead of crawling again. Run 34048105257 re-imported and published in ~1 minute rather than 85.
- Verification: manifest `3ccce668810808ca`, productCount 12,772, `latestCoverageId sitemap:c+r`; `products/131975.json` present; the live page renders the history the user reported missing.
- Learning: **a validator must not demand a field the normalizer ignores.** The check cost a full crawl to discover, and it was guarding nothing.

## 2026-09-07 — Panel width and colliding axis dates (#1, 11644d1)

- Symptom: on the live page the panel rendered 420 px wide, below the page's last section, with its two date labels drawn on top of each other.
- Root cause (1): `.block-goods-detail` is a two-column CSS grid (measured 420 px + 660 px) whose five panes each pin their own `grid-row`. Inserting a sibling before `.pane-goods-center` made the panel an auto-placed extra grid item — 420 px wide, in a new row after every pane. The chart column collapsed to ~110 px.
- Fix (1): mount as the first child of `.pane-goods-center`, a plain 1080 px block that begins exactly under the gallery/buy columns. `MountPoint` gained an optional `hostStyle` that the controller applies to the host element, so the three fallbacks that still land inside the grid can claim `grid-column: 1 / -1`.
- Root cause (2): the chart's drawing tail had a one-day floor. For a two-observation window that is the whole span, so `end` landed mid-plot and its label overlapped the start label. The gap test also compared anchor positions, which say nothing about where a `text-anchor: end` label actually sits.
- Fix (2): tail floor 1 hour; labels placed by measured extent (58 units per date) and dropped when they repeat the previous date or would overlap it.
- Verification: live g131975 and g109951 mount into `.pane-goods-center` at 1080 px, chart 649×239, axis reads 2026-09-06 / 2026-09-07 with no overlap. 230 vitest + 3 E2E pass.
- Learning: measure the host page's own layout before choosing a mount point — `display: block` on the host says nothing when the parent is a grid with pinned rows.

## 2026-09-07 — The fix reached Pages but not the browser (#1, 839e83d)

- Symptom: none visible to me. Every check I ran said the work had shipped — CI green, Pages serving the rebuilt bundle, live pages rendering the fixed panel. I reported it complete. The user asked 「リリースした?」and that question is what exposed it.
- Root cause: `@version` stayed at `0.1.0` across the mount-point and axis fixes. Tampermonkey fetches `@updateURL` only when the advertised version exceeds the installed one, so any copy installed before 2026-09-07 would have kept the 420 px panel indefinitely. Deploying the bundle is not the same as delivering it.
- Why my verification missed it: I compared the Pages-served bundle against the local build byte-for-byte and called that proof of delivery. It proved the file was published; it said nothing about whether an installed client would ever ask for it. A fresh install (which is what the E2E fixture and my live probes do) always gets the newest file, so the whole verification path was blind to the update mechanism by construction.
- Fix: `USERSCRIPT_VERSION` and the package version to 0.2.0, rebuild (53,414 bytes, identical apart from the banner), redeploy with `--republish`.
- Learning: **for anything distributed by an updater, the version string is part of the fix.** Verify delivery from the position of an existing install, not a fresh one.

## 2026-09-07 — Second store: Switch Science, and what "one site, two stores" actually costs (#2, c75eabd)

- Request: 「スイッチサイエンスにも対応しようか、一旦コミットプッシュして」. The original spec had ruled Switch Science out of scope (Phase 3, "must not be implemented"); the user who set that constraint lifted it, so it was scope, not a safety rule.
- Work: a Shopify collector, a snapshot adapter, a userscript page adapter, `config/switch-science.json`, and `env.STORES` in the workflow. The common domain, DB schema, static contract v1 and shared UI were not touched, and the CI check forbidding store names in the core stayed green — which is the only real evidence that the layering was worth its cost.
- Collection: the storefront catalogue JSON `/collections/all/products.json?limit=250` rather than listing HTML (ADR-0014). 10,382 products = 42 catalogue pages + 12 sitemap requests ≈ **54 requests per run**, against ~2,700 for the Akizuki HTML crawl. The failure class also changed: markup drift disappears, JSON-shape drift replaces it, and the latter is mechanically detectable (`products` is not an array) so it fails closed instead of silently miscounting.
- Symptom (design, caught in review): the first draft of ADR-0014 claimed the API returns neither category nor stock count. It returns `product_type` (→ `category`); only the inventory **quantity** is absent — `available` is a boolean.
- Root cause: I generalised from one missing field to "the API is thin" without re-reading `capabilities.ts`, which I had written an hour earlier.
- Fix: the ADR now states `supportsInventoryQuantity: false` / `inventoryQuantitySemantics: 'not_exposed'` and that the panel omits the stock row rather than rendering 0 — **0 and "not published" are different claims**, and a UI that conflates them lies on every product.
- Identity: the Shopify **handle**, not the numeric product id (ADR-0015). The plan had said numeric id, with handle as the page key, making this "the first store where the two differ". Wrong: the handle is the only identifier the userscript can read from the URL, so choosing the numeric id would have sent the page adapter back into product HTML — exactly the dependency ADR-0014 exists to remove. Most handles are numeric strings, so it is store-scoped identity (ADR-0001) that keeps them from colliding with Akizuki sales codes. `shopifyProductId` and `sku` are aliases; SKU is often empty, so it also lands in `modelNumber`.
- Offers are keyed by **variant id**, not a synthetic `__default__`. Every product has one variant today; `__default__` would delete a product's whole history the day a second variant appears.
- The genuinely new problem was not the store — it was **two stores sharing one publication**. They share one SQLite history, one `state/`, and one `site/` tree that Pages replaces wholesale. Three consequences, all now pinned by `tests/integration/multi-store-pipeline.test.ts`: runs must be **serial** with the second chained via `--previous-dir site/state` (from the same previous state, the last finalize discards the other run); a store that writes nothing in a run is **deleted from the published site**, so unselected and failed stores are regenerated with `--republish` plus a state-driven restore step; and a fail-closed `gate` refuses the deploy when a manifest is missing, because losing one run beats a store vanishing from the site.
- Applied the previous entry's learning without being told: `userscript/version.ts` and `package.json` → 0.3.0 in the same commit as the bundle change.
- Verification: `npm run typecheck` clean; 315 tests / 31 files / 12.68 s; 7 E2E / 8.3 s; mutation **89.60 %** (704 mutants, killed 595 / timeout 8 / survived 60 / no coverage 10 / ignored 31); bundle 55,613 bytes; `actionlint` on both workflows exit 0; real-snapshot test over a 60-product fixture (¥165 … ¥8,910,000, four ¥0 products). Post-run process check found only the IDE's `tsserver` from before the run — no vitest/Stryker/Playwright survivors.
- Incidental: no YAML parser is installed on this box (PyYAML absent, no `yaml`/`js-yaml` in the project), so the rewritten workflow was validated with the already-installed `~/tmp/actionlint-1.7.12-win/actionlint.exe` instead of creating a venv for one parse.
- Learning: **when one artefact is published as a whole, every producer of it must be defended against the others' absence.** Adding a store was cheap; adding a *second writer to a single published tree* is what needed the republish path, the restore step and the gate. Nothing in the store abstraction hinted at that — it only showed up when the site briefly had one store's data and the other's directory gone.

## 2026-09-07 — Switch Science released to Pages, and a phantom byte discrepancy (#2, 3cd3676)

- Request: 「じゃあリリースしたの?」 — the same question that caught the 0.2.0 update-channel miss, asked again. This time the answer was an honest "no": `main` was green but nothing had been deployed, because Pages is only written by the `Crawl and publish` workflow, never by a push. Checked the live site before answering rather than reasoning from the commit log: `switch-science/manifest.json` 404, `state.json` stores `["akizuki"]`, served userscript still `@version 0.2.0` with only the Akizuki `@match`.
- Release: `workflow_dispatch` with `stores=switch-science`, no `bootstrap` (run 34073753015). Crawl + import + generate 2m11s, deploy 8s.
- Result: switch-science `datasetVersion 762d7ad2cd13eaf8`, **10,383 products**, `runCount 1`, capabilities `supportsInventoryQuantity: false` / `not_exposed` / `supportsVariants: true` as designed.
- **First production proof of the two-store invariant**: akizuki was not crawled, and its `datasetVersion` stayed `3ccce668810808ca` with `runCount` still 2. The `--republish` path regenerated its whole dataset into the new site tree without adding an observation — which is exactly the property that keeps a store from vanishing when it is not selected.
- End-to-end spot check of product 9381: aliases `handle` / `shopifyProductId 7895635787974` / `sku`, one offer keyed by **variant id** 42987508662470, a single point `[t, "exact", 165, 165]` on a `tax_included JPY` basis, `category: null`. The design decisions in ADR-0015 are visible in the published bytes, not just in tests.
- Symptom: the published bundle looked 1,199 bytes smaller than the local build (54,414 vs 55,613) — and the 0.2.0 release had shown the *same* 1,199-byte gap (52,215 vs 53,414), which I had recorded in the journal as if it were the real size.
- Root cause: my probe printed `(await res.text()).length`. That is UTF-16 code units, not bytes. The bundle carries Japanese UI strings, so every such character under-counts by 2. There was never a discrepancy.
- Fix / verification: compared `Buffer.from(await res.arrayBuffer())` against the local file — 55,613 bytes both, `buf.equals(local) === true`. The README figure was right all along.
- Learning: **a size mismatch between what you built and what was served is a measurement claim, so measure it as bytes.** I nearly opened an investigation into a CI/local build difference that did not exist; the earlier journal entry's "53,414 bytes" is the same artefact and should be read as a character count.

## 2026-09-07 — Explicit panel light/dark controls (local 0.3.1 build)

- Added light/dark buttons beside the panel title; the controller persists `eph:theme` through the existing userscript-scoped GM storage so the preference follows the user between store origins. The system preference supplies the initial value only when no explicit choice is saved.
- Verified learning: theme selection must override both the panel palette and badge colors; leaving badge colors under an OS-only media query produces mismatched badges when a user explicitly chooses the other theme. The panel now uses one `data-theme` selector for both.
- Verify: `npm run typecheck`. Expect: both TypeScript projects pass. Result: passed.
- Verify: `npm run test:unit`. Expect: shared controller, store adapter, and core tests pass. Result: 236 tests in 19 files passed. The controller's 11 tests were rerun with an explicit 10-second test timeout after completing the typed matchMedia mock.
- Verify: `npm run build:userscript` and inspect its header and forbidden HTML sinks. Expect: version 0.3.1, both store match patterns, no HTML-string sinks or CDN references. Result: passed; 57,934-byte local bundle.
- Verify: run the temporary preview at `C:/Users/developer/tmp/electro-parts-theme/serve.mts`, toggle both modes in Chrome, navigate between the two real adapter previews, and reload. Expect: selected mode, palette, chart, and text remain consistent. Result: passed with test data. No standalone browser was launched; preview processes were terminated afterward.
- Not published or installed: extension-management access was blocked by browser policy. The local build is ready for a user-managed update; do not confuse it with the currently served userscript.

## 2026-09-07 — Per-store observation cadence: weekly for Switch Science, monthly for Akizuki (#2)

- Question, not a failure: could the observation interval be weekly, and would the published site still fit? Followed by an explicit constraint — do not let us look like an attack.
- Measured before deciding (23,000 products x 5 years, synthetic load moving 1 % of prices per observation, so an upper bound): monthly (60 runs) = 19.37 MB SQLite / 40.64 MB site / 35,399 change points / 756.4 ms import p50 / 2.3 KB largest product file; weekly (260 runs) = 37.65 MB / 49.87 MB / 70,958 / 872.5 ms / 3.3 KB. **4.33x the runs costs 1.23x the site**, because only change points are stored and the per-product fixed cost (name, code, URL) does not grow with the number of observations. Pages' 1 GB limit is ~5 % used after five years.
- So size was never the constraint; the load on the store is. Observing Switch Science is ~54 requests over ~2 minutes (Shopify catalogue JSON), Akizuki ~2,700 requests over ~85 minutes (HTML crawl). A single project-wide cadence spends the expensive store's budget on the cheap one.
- Fix: `observation.cadence` (`weekly` | `monthly`) is declared per store in `config/<store>.json`; the workflow gained a second cron but does **not** name which stores it observes — it derives the wanted cadence from the cron that woke it and reads each config with jq; `generateStoreDataset` picks `sampling_interval` or the new `sampling_interval_weekly` caveat from the same value. Switch Science = weekly, Akizuki unchanged at monthly. ADR-0016.
- Verify: `~/tmp/actionlint-1.7.12-win/actionlint.exe .github/workflows/*.yml`. Expect: exit 0. Result: passed.
- Verify: `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:mutation`. Expect: clean, all green, mutation at or above the break threshold. Result: 323 tests in 32 files (15 s), 7 E2E (10 s), mutation 89.60 % (704 mutants, unchanged by the new tests), no runner survived the runs.
- Verify: `npm run build:userscript` and the CI bundle checks. Expect: 0.3.2 banner, both stores' `@match`, no HTML-string sink, no CDN reference. Result: passed, 58,110 bytes.
- Learning: **when a question is asked as "is the size OK?", answer the size question and then say what the real constraint is.** The honest answer here was "size is fine by a factor of 20, and that is not why the cadence is monthly".
- Learning: **frequency and the sampling caveat must derive from one value.** They are two statements of the same fact; if they disagree, a reader cannot tell a gap in the history from a gap in the observation. Writing store names next to a cron is exactly what lets them drift, so the schedule stays store-agnostic and `tests/integration/observation-cadence.test.ts` pins the agreement.
- Learning: **not raising a crawl rate is a decision worth writing down.** Akizuki's robots.txt has no `Crawl-delay`, so 0.53 req/s is a limit we chose, not one the store granted; the gain from weekly (a better date for a price revision) does not cover the risk of a 403, which ends the crawl entirely.
- Shipped together with the light/dark panel controls from the previous entry, which had only been built locally at 0.3.1 — they reach users as part of 0.3.2. Known limit: with no saved preference the theme is read from `prefers-color-scheme` once at mount, so a system theme change while the page is open is no longer followed live.

## 2026-09-07 — Released userscript 0.3.2 and the weekly caveat (#3, commit f39043d)

- Released with `Crawl and publish` / `republish=true` (run 34078380414): regenerates the site from the published history, so no store was crawled and no observation was added.
- Verify: the served bundle. Expect: `@version 0.3.2`, byte-identical to the local build, theme controls present. Result: 200, 58,110 bytes, `buf.equals(local) === true`, `theme-controls` and `eph:theme` present, and the weekly caveat sentence is in the bundle.
- Verify: the manifests. Expect: switch-science carries `sampling_interval_weekly`, akizuki is untouched, and neither `datasetVersion` moves (the caveat is not part of the dataset hash — asserted in tests/contract/publisher.test.ts before deploying). Result: switch-science `762d7ad2cd13eaf8` with `["observation_window","sampling_interval_weekly","absence_not_discontinued"]`; akizuki `3ccce668810808ca` with `sampling_interval`, 12,772 products.
- Verify: published `state/state.json`. Expect: run counts unchanged. Result: akizuki `runCount 2` (latest 2026-09-06T17:03:58Z), switch-science `runCount 1` (2026-09-07T01:42:04Z) — the republish added nothing, as intended.
- Verify: CI on main. Result: green (run 34078371759; includes the layering check "Common core must not name a store", mutation and E2E).
- The published manifests live at `/data/v1/stores/<store>/manifest.json`; the finalized state is at `/state/state.json` (not under `/data`). Two 404s while probing came from guessing those paths.
- Learning: **a release that must not change the data is verifiable as "nothing moved"** — datasetVersion, runCount and the other store's manifest are the assertions, not the absence of errors in the log.

## 2026-09-07 — M5Stack omitted from the cross-store matching sample

- Symptom: three Luna agents returned 20 judgments each (59 distinct pairs), but the combined sample largely omitted M5Stack. The user's question exposed the coverage gap; the sample count was not the total number of matching products.
- Verified: in the Akizuki 2026-09-06 and Switch Science 2026-08-02 local snapshots, Akizuki has 20 products whose model starts with `M5STACK-`. Comparing model/manufacturer codes after removing only that leading prefix yields 18 pairs, including BASIC V2.7, FIRE V2.7, Core2, ATOM Lite/Matrix, M5StickS3 and NanoC6. Revision suffixes were retained. This is candidate evidence, not approval of package contents or price comparability.
- Learning: audit coverage by manufacturer/category after merging capped samples; scope prefix aliases to the relevant manufacturer; retain revision/configuration suffixes and original identifiers. An omitted suffix or assembly description is uncertainty, not proof of a different product. A single Shopify variant does not establish the number of physical pieces in a sales pack.
- Change: added the reusable search, coverage, evidence and price-comparison rules to `CLAUDE.md`. No runtime or production matching table was changed.
- Follow-up: the user requested separate same-product and similar-product categories. `CLAUDE.md` now defines `same_product` / `similar_product`, separate review status and price eligibility, plus unresolved/unrelated outcomes. Similarity requires shared purpose and explicit differences; it does not assert interchangeability. Historical labels must be re-evaluated, not bulk-renamed. This is documentation only; the old sample files and UI remain unchanged.

## 2026-09-07 — Cross-store comparisons 0.4.0 (#4)

- Implemented the subsequent request: curated 80 distinct pairs (60 same-product including candidates, 8 similar, 12 unresolved), separate review status and price policy, reversible lookup and separately labelled store observations. All 20 scoped M5Stack products are represented; this is an initial catalogue, not exhaustive product matching.
- Directly reviewed retailer pages and published offer IDs for ATOM Lite and UNO R4 Minima. Only those two pairs permit arithmetic/overlays; other identities remain reference prices until sales-unit/accessory conditions are verified. Manufacturer revision suffixes remain significant. See ADR-0017 for sources and the release checklist.
- Verify: `npm run typecheck`, all unit/property/DB/integration/contract/userscript tests, `npm audit --audit-level=high`, bundle build and HTML-sink/CDN/store-layer checks. Expect: all successful. Result: 368 tests / 34 files passed; zero audit vulnerabilities; 0.4.0 bundle 221,527 bytes; no test runners remained. CI owns the saved-fixture browser E2E and unchanged-core mutation run; publication is checked separately.
- Chrome local preview used a saved copy of the published history with the production controller, adapters and UI. Verified ATOM Lite overlay and -187 yen recorded difference, light/dark switching, series visibility, and Matrix v1.1 in a separate similar-product card with revision difference and expandable evidence. The installed Tampermonkey script was not changed for this preview.
- Learning: concurrent product loads need per-store manifest deduplication too. A failed manifest is terminal for that page client, so queued candidates cannot multiply a 429; render/theme changes never enqueue requests. Serialize LRU index writes within the client to retain parallel results.
- Learning: current Shopify publication may use the handle/SKU where an older catalogue used the manufacturer code. Verify the actual published schema before accepting metadata aliases; one variant or a null unit never proves a single-unit pack.
- Pre-release screenshot correction: CI run 34085328325 passed 9 E2E tests, but visual inspection caught a final-observation change represented by a disconnected dot. A zero-duration endpoint still needs a vertical step (never a horizontal future tail); added a regression test. Moved own-store detailed statistics into a state-preserving disclosure when comparison content exists, reducing excess height on desktop and narrow screens. Added explicit lazy-observer destruction coverage. The userscript targets ES2022, so the endpoint scan uses `find`/a linear presence pass, not ES2023 `findLast`.
- Narrow-screen comparison charts redraw only their SVG at the measured column width (deduplicated ResizeObserver); the controls and hidden-series selection survive, no data requests are started, and panel cleanup disconnects the observer. This avoids scaling desktop-sized axis text down to unreadable mobile text. E2E checks the resized viewBox and subsequent checkbox behavior.

## 2026-09-07 — Reviewed catalogue mapping pipeline 0.4.1 (#5)

- Replaced direct runtime-table editing with pinned price-free evidence (19,020 listings), indexed candidate discovery, explicit fingerprinted reviews, reviewed family members, and deterministic runtime/coverage outputs. Initial 191 alphanumeric candidates expanded to 309 with numeric manufacturer codes and scoped prefixes: 293 accepted, 6 unresolved, 10 rejected. Runtime combines original provenance with 13 families: 424 relations, 293 verified same and 108 verified similar. Only the original two independent price policies remain.
- Verify: full local suite, typecheck, matching check, userscript build and audit. Result before the final source-validation additions: 398 tests / 35 files passed, zero vulnerabilities, reproducible mapping output, 677,674-byte bundle. CI owns saved-fixture E2E and core mutation; release/handoff record the final results.
- Chrome verification used existing-session local previews with cached published JSON and the production controller/adapters/UI. Pico retained seven related links; reverse-side cards and expanded evidence both reversed differences, model and source-date order. Light/dark narrow-panel measurement was width388/chart356/overflow0; preview tab and server were closed. No standalone headless was launched or installed Tampermonkey state changed.
- Learned numeric code collisions and the viewport-versus-embedding-width distinction (see distilled rules). Archived optional Shopify description HTML/tags from already-received responses without extra requests or automatic identity extraction. Source catalogue review is not full live product verification or sales approval; ADR-0018 records scope and maintenance constraints.
