# Goal: finish Marutsu observation and reach the phase 2 candidate checkpoint

Status: superseded on 2026-11-16 by the user's cancellation. See `../withdraw-marutsu/rubric.md`; these original criteria are retained as historical context and no longer authorize collection or matching work.

Workdir: repository root (electro-parts)
Tracking: #121 (phase 1); create/reuse a phase 2 issue before phase 2 changes.
Max iterations: 8. Verification owner: Codex itself, per repository instructions.

## Criteria

- C1: finish phase 1 without reverting the real-listing parser fix. Verify: `git diff f0b7a39799658eb72fd166c8bc99212f3e72114b -- src/collectors/marutsu tests/fixtures/marutsu`; inspect workflow STORES and root lockfile versions. Expect: no parser/fixture changes, marutsu scheduled, both versions 0.7.12.
- C2: phase 1 regression checks pass. Verify: `npm test`, `npm run typecheck`, `npm run matching:check`, `npm run test:e2e`, and PR #122 CI. Expect: every command exits 0; CI succeeds; no surviving task test/browser processes.
- C3: merge only the tested phase 1 head. Verify: `gh pr view 122 --json state,mergeCommit,headRefOid`. Expect: MERGED with tested head; #121 closed.
- C4: collect only the approved Marutsu scope. Verify: dispatch crawl-publish with stores=marutsu; inspect collect record, logs, raw snapshot and SHA-256. Expect: complete, roughly 15,380 items, seven majors, splitListings includes 16. A Cloudflare challenge/403 is an explicit stop; do not bypass or import an incomplete snapshot.
- C5: integrate phase 1 and import only the new store on add-marutsu-matching. Verify: `npm run matching:build -- --import-store marutsu=<snapshot>` and `npm run matching:discover`; compare previous catalog rows/reviews and parser with phase 1. Expect: prior rows/reviews unchanged, raw snapshot untracked, existing projection tests pass.
- C6: stop at the requested human checkpoint. Verify: recount generated unique candidates and report total, Marutsu count, M5Stack and Raspberry Pi counts per counterpart store with classification method and uninvestigated scope. Expect: no identity decisions or price policies added before Otake confirms the report.
