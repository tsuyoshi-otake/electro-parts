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
