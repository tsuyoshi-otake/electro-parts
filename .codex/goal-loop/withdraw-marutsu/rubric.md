# Goal: withdraw Marutsu support after collection is refused

Workdir: repository root (electro-parts)
Tracking: #123; user explicitly cancelled support on 2026-11-16.
Max iterations: 8. Verification owner: working Codex agent directly.

## Criteria

- C1: no active Marutsu observation or page execution. Verify: `rg -n -i 'marutsu|マルツ' src userscript extension config .github tests scripts --glob '!fixtures/**'`; build userscript and extension and inspect manifest matches / userscript headers. Expect: no Marutsu runtime/config/test references or generated matches; only six existing stores remain registered.
- C2: preserve existing data and dependencies. Verify: `git diff --exit-code origin/main -- data/matching`; compare lockfile with parent of #122 apart from root version fields; inspect published state record. Expect: matching inputs/artifacts and dependency graph unchanged; published state has six stores and no Marutsu history to retain.
- C3: withdrawal is explicit and versioned. Verify: inspect README/CLAUDE/CWS listing, ADR0036 and ADR index, `public/index.html`; parse package/version/lockfile fields. Expect: six supported stores, ADR withdrawn with reason/evidence, changelog and all versions 0.7.13; original phase2 rubric superseded in its journal.
- C4: regressions pass offline. Verify: `npm test`, `npm run typecheck`, `npm run matching:check`, `npm run test:e2e`, existing package/architecture checks in CI. Expect: all exit0; no Marutsu requests; no test/browser process survivors.
- C5: operational cancellation reaches main and tracking. Verify: PR CI, immutable head-checked merge, main workflow STORES, #123 state/reason. Expect: tested withdrawal merged, Marutsu absent from workflow, #123 closed as not_planned; no additional live collection or publication required because phase1 only ran dry_run and no Marutsu history was published.
- C6: cleanup and retain only intentional evidence. Verify: git status, task temporary files/process inventory and branch list. Expect: clean checkout after merge; task-owned temporary scripts/logs and merged branch removed; original source branches and named diagnostic recovery handle retained without modifying others' files.
