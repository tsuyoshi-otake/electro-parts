# Goal: Fix and verify GitHub Issues #9 through #17
Workdir: C:\Codes\tsuyoshi-otake\electro-parts
Max iterations: 8

## Criteria
- C1: A published dataset is cryptographically tied to the bundled SQLite run history, and inconsistent site/state pairs are rejected. Verify: targeted publisher, pipeline, and multi-store integration tests. Expect: mismatched run sets fail while normal and recovery flows pass.
- C2: The panel and comparison helpers select currently present offers and do not label retired-offer prices as current. Verify: userscript controller, comparison, and relation tests. Expect: an old 100-yen offer replaced by a current 250-yen offer renders 250 yen.
- C3: Offer metadata is deterministic under out-of-order imports. Verify: DB and property tests. Expect: the latest observed SKU, variant name, and kind are published for every import order.
- C4: Dataset output changes invalidate product caches without fabricating observations. Verify: publisher and data-client tests. Expect: generator/config changes alter the delivery version; generatedAt-only changes do not.
- C5: Cache entries are isolated by normalized data source and converge to the configured size across independent clients. Verify: data-client and host tests. Expect: source changes fetch the new source and concurrent storage updates leave no permanent orphan entries.
- C6: Retry-After and previous-state downloads have bounded, explicit terminal behavior. Verify: polite-fetcher and pipeline tests. Expect: no request occurs before Retry-After; overlong waits fail without retry; headers and body acquisition time out with cleanup.
- C7: The roadmap accurately separates implemented cross-store matching from future work. Verify: matching reproducibility and documentation inspection. Expect: current canonical files and workflow are named and the feature is not called unimplemented.
- C8: Release artifacts and the full repository remain valid. Verify: version bump, typecheck, matching check, full non-E2E tests, E2E, builds, workflow lint, audit, and process cleanup. Expect: every command exits 0, bundle guards hold, and no repository test runner remains.
- C9: Each completed GitHub Issue has a concrete implementation commit and is closed after readback. Verify: git log and `gh issue view` for #9-#17. Expect: English commit messages reference the issues, all issues are CLOSED, and the worktree contains no uncommitted task changes.
