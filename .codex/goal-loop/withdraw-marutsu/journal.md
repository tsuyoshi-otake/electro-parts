# Marutsu withdrawal (#123)

## 2026-11-16 — iteration 1

- Objective: user explicitly cancelled support after the refused first collection and diagnostic follow-ups. No additional Marutsu access is permitted or needed.
- Baseline: main32cf114 had all phase1 code; the only local untracked file was the task's diagnostic journal. Tracking #123 is reused and retitled for withdrawal. No worktree created; branch revert/marutsu-support-123 uses the existing checkout.
- State boundary: fetched the project's public state descriptor (850 bytes, producedAt2026-11-16T00:30:25.291Z) before removing config. It names only akizuki/ksy/m5stack/pimoroni/sengoku/switch-science; there is no Marutsu observation or history to preserve. No site collection or Pages publication was performed.
- Change: invert the runtime/test/config/docs additions of PR122, retain ADR0036 as withdrawn with evidence and keep historical phase2 verification records. Remove the store's unused source/fixtures instead of leaving unreachable code. The userscript/extension version is0.7.13, with a public changelog entry.
- Direct checks so far: runtime/config/test source search for marutsu has no hits; all src, userscript/adapters, extension, config, scripts, tests and workflow files are byte-identical to32cf114's parent. Matching data has no diff against main. Parsed dependency lock is deep-equal to the pre-Marutsu lock after normalizing only the two root version fields. All package/lock/userscript versions and built extension version equal0.7.13. Built extension manifest and userscript have no Marutsu matches/code. Typecheck and matching:check exit0.
- Regression runs: npm test (900-second process-tree timeout), typecheck (180s), matching:check (180s), npm run test:e2e (600s). Remaining results are appended below before completion.

### Local verification result

- npm test:80 files /1,248 tests passed;1 pre-existing skip;112.04s, exit0. npm run test:e2e:30 passed in1.7m, exit0. Typecheck and matching:check both exit0; matching summary remains6,010 candidates /7,475 relations /2 price policies.
- Process inventory found0 task runners or descendants, using recorded runner IDs plus repository-path matching. git diff --check passed. Existing matching files and dependency contents remain unchanged. Local result: C1-C4 PASS; C5-C6 pending PR/merge/cleanup.

## Scope / architecture / future IRV

- A: store registration across collection, snapshot import and page integration; dedicated store modules/config/tests/fixtures; supported-store descriptions and version metadata. The independent context delegate identified entry points and the published-state precondition only; the working Codex agent owns all verification.
- B: scope expands to the public state contract because workflow restoration needs config for any store with saved history. The descriptor proved that Marutsu was never published, so no data migration or generic stopped-store behavior was needed.
- C: no new abstraction, state owner, public API or dependency direction. Existing six-store behavior and matching state remain owned by their original modules. Removing Marutsu removes its registry dependencies and generated page matches.
- D: no structural IRV reduction is claimed. The next proposal can find the withdrawal reason and actual failure evidence in ADR0036/#123, and recover the old parser from Git if explicitly reconsidered; it must still establish that approved collection is feasible before enabling observation.
