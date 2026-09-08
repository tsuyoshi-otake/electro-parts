# Iteration journal

## 2026-09-08 iteration 0
- Baseline before implementation: `npm test` passed 433 tests in 39 files; `npm run typecheck` and `npm run matching:check` passed.
- Offline reproductions confirmed Issues #9-#15. Issues #16 and #17 are operational/documentation improvements supported by code inspection.

## 2026-09-08 iteration 1
- Implemented publication/state binding, output-semantic dataset versions, schema v2 offer metadata ordering, and a total previous-state download deadline.
- Implemented current-offer selection, data-source cache namespaces, storage-key reconciliation, and Retry-After terminal blocking.
- Updated the cross-store roadmap and userscript version to 0.4.2.
- Verification: `npm test` passed 440 tests in 39 files; focused userscript verification passed 72 tests; Playwright passed 11/11 after adding the newly required `GM_listValues` grant to the build and test shims. Typecheck, matching check, npm audit, actionlint 1.7.12, userscript build, and extension build passed.
