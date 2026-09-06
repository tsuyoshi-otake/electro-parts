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

## 2026-09-06 — Workflows, benchmark, mutation testing, docs (#1, commit pending)

- Symptom: first Stryker run scored 68.95 % (< 70 break) with 100 NoCoverage mutants.
- Root cause: `vitest.related: true` only ran tests importing the mutated file directly; core is mostly exercised via adapters/DB/publisher.
- Fix: `related: false, dir: 'tests'` + `tests/unit/core-guards.test.ts` (24 tests on identity/time/price/sanity/history/stats boundaries).
- Verification: second run 89.45 % (595 killed, 7 timeout, 61 survived, 10 no coverage of 704).
- Benchmark (9,000 products, daily): 1 y import total 148.9 s, p95 460.7 ms, SQLite 14.73 MB, site 27.08 MB; 3 y import total 610.2 s, p95 740.5 ms, SQLite 35.39 MB, site 32.23 MB; 5 y row recorded in README.
- Learning: heredocs are unusable for Japanese docs in this harness; ADRs / docs written via a Python script created with the Write tool.
