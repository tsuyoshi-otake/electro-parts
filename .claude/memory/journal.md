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
