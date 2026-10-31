# Goal: Mount the history panel near the top on M5Stack and Switch Science product pages (Issue #42, 0.6.2)
Workdir: C:\Codes\tsuyoshi-otake\electro-parts (branch feat/panel-near-top, uncommitted changes against HEAD)

Requirement (from the user): on the M5Stack official shop the panel goes in the left column directly
below the image gallery and above the description; on Switch Science directly below 「カートに追加」 and
above the description — as near the top as on Akizuki — without breaking layout at narrow widths.

## Criteria
- C1: Types check. Verify: `npm run typecheck`. Expect: exit 0.
- C2: The adapters mount at the new anchors and degrade in order. Verify: read `findMountPoint` in
  `userscript/adapters/m5stack.ts` and `userscript/adapters/switch-science.ts`, then run
  `npx vitest run tests/unit/m5stack.test.ts tests/userscript/switch-science-page-adapter.test.ts`.
  Expect: M5Stack returns `before` `.m5product-detail .product-main > .product-description` with
  hostStyle exactly `{clear:'both'}`, else falls back to the pre-existing anchors; Switch Science returns
  `before` `.product-details > .product-block--description`, else `after` `.product-details > .product-block--form`,
  else the pre-existing chain (`.product--outer` after, …) unchanged; the tests assert these anchors and pass.
- C3: Fail-before evidence: HEAD's adapters cannot satisfy the new tests. Verify:
  `git show HEAD:userscript/adapters/m5stack.ts | grep -c "product-description"` and
  `git show HEAD:userscript/adapters/switch-science.ts | grep -c "product-block--description"`.
  Expect: both print 0 (the new expectations name anchors HEAD never returned).
- C4: Whole unit/contract suite. Verify: `timeout 900 npm test`. Expect: exit 0, 0 failed.
- C5: Saved-page E2E with the real unpacked extension/userscript. Verify: `timeout 600 npm run test:e2e`.
  Expect: exit 0, 0 failed; `tests/e2e/extension-m5stack.spec.ts` and `tests/e2e/switch-science-product.spec.ts`
  assert the panel is the previous sibling of the description.
- C6: Project rules. Verify: (a) the CI step "Common core must not name a store" command from
  `.github/workflows/ci.yml` run locally; (b) `git diff --name-only HEAD` lists no file under src/core, src/db,
  src/publisher, src/pipeline, userscript/core, userscript/ui; (c) `grep -nE "innerHTML|outerHTML|insertAdjacentHTML"`
  on the two changed adapters. Expect: (a) no hits, (b) none listed, (c) no hits.
- C7: Version and user-facing docs are consistent. Verify: read `userscript/version.ts`, `package.json` "version",
  `package-lock.json` top-level "version" and `packages[""].version`, `public/index.html`, `README.md`,
  `docs/roadmap/m5stack-support.md`. Expect: all versions are 0.6.2; index.html has a `<h2>0.6.2: …</h2>` entry
  above 0.6.1 describing both new positions, and its intro does not claim the M5Stack panel is under the purchase
  area; README's install list describes both positions; the roadmap doc describes the new anchor, the fallback,
  and why `clear: both` is needed.
- C8: Live-page evidence exists and shows the requested placement without overlap or overflow. Verify: read
  `C:\Users\developer\tmp\electro-mount\shots-062\results.json` and look at
  `m5-atom-lite-desktop-light.png`, `m5-atom-lite-phone-light.png`, `ss-6262-desktop-light.png`,
  `ss-11479-phone-light.png` in that folder. Expect: 9 results all `pass:true`; every M5 entry has parent
  `div.product-main`, next `div.product-description…` and `columnOverlapSteps` 0; every SS entry has parent
  `div.product-details` and next `…product-block--description`; `pageWidth` equals `viewport` in every entry;
  the images show the "Electronics Price History" panel below the gallery (M5Stack) / below 「カートに追加」
  (Switch Science) with no element overlapping it.
