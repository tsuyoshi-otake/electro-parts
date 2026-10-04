# 0.4.9 mapping supplement (#30)

Local verification of the 0.4.9 ZIP; not deployed to Pages or submitted to the store. Scope, counts and reviews are in [three-store-mapping.md](../roadmap/three-store-mapping.md#049の補完2026-10-04判定).

## Suites

- Verify: `npm run matching:check`. Expect: generated files byte-identical to the canonical sources. Passed.
- Verify: `npm run typecheck`. Expect: all three projects pass. Passed.
- Verify: `npm test`. Expect: pass. 45 files / 539 tests passed (matching generator 29, including the new `catalogue supplements` group; relations 25 scoped M5Stack products).
- Verify: `npm run test:e2e`. Expect: pass. 15/15 passed, TKW `c0d5fa336281f319212d51ccdefc353a`.
- Verify: `npm audit`. Expect: 0 vulnerabilities. Passed.
- Runner and browser inventory after the suites: no vitest, Playwright or Chromium survivors.

## Live check of the submitted ZIP

ZIP `ext049.zip` built with `npm run build:extension -- --zip <file>`: 224638 bytes, SHA256 `395a2f120505518291b793ebe852990ce00621f0f68052d775e71f957990937f`. Manifest: version 0.4.9, permissions `storage`, host permissions `https://tsuyoshi-otake.github.io/*` only.

The extracted ZIP was loaded with `chromium.launchPersistentContext`, `channel: 'chromium'`, a fresh profile, `--load-extension`, 300 s deadline. Real store pages, the published dataset and the real rate API were used, with no routing. Pages: Akizuki 116011 (K016-P), M5Stack K016-P, Switch Science 6785 (A014-C) and 11349 (K016-P-SE), Akizuki 117209 (ATOM Lite). Result: 26/26 checks passed in 26.2 s, TKW `9c22187dd35d55731df181d8056b4335`.

- Verify: service worker `chrome.runtime.getManifest().version`. Expect: 0.4.9. Passed.
- Verify: Akizuki 116011 in a profile without saved settings. Expect: light theme; own history with ￥ price, chart and dates; new card `a116011-s6470` (SS 6470, ￥4,180) and the replaced official K016-P row ($19.95), both with a date and no 「商品情報が照合時と異なるため要再確認」. Passed.
- Verify: choose dark, reload. Expect: saved dark (`body` rgb(62, 62, 62)). Passed.
- Verify: M5Stack K016-P. Expect: dark carried across stores; $ history with `約 ￥3,149（円換算の参考値）` (1 USD = 157.82円, 2026-10-04 09:02 更新); Akizuki (￥4,200) and SS 6470 (￥4,180) cards without the drift notice. Passed. The 0.4.8 cards on this page showed the drift notice because the "[EOL] " prefix was dropped.
- Verify: SS 6785. Expect: the replaced row's card to official A014-C ($13.50) without the drift notice. Passed.
- Verify: SS 11349. Expect: the new card to official K016-P-SE ($19.00). Passed.
- Verify: Akizuki 117209, switch back to light, reload, then toggle the Switch Science series. Expect: light persists; the series count is 2, it hides when unchecked and returns when checked. Passed.
- Verify: page exceptions with the extension vs. the same SS pages in a fresh profile without it. Expect: none caused by the extension. Passed: `empire.js` `_updatePrice` null `innerHTML` on SS 6785 and 11349 occurs without the extension as well.
- Verify: requests. Expect: at most one request to `open.er-api.com`; dataset requests only under `/electro-parts/`. Passed (1 and 15).
- Screenshots inspected: `akiK016P-light.png`, `m5K016P-dark-viewport.png`, `ss6785-dark-viewport.png`, `ss11349-dark.png`, `akiAtom-series.png`. Layout intact; the SS and M5Stack headers keep the store's own colours in dark mode.
- Browser closed in `finally`; process inventory for the temporary directory afterwards: 0.

The first live run (TKW `ee13db3230ed4d359fa0fa9dfccf79af`) reported 8 failures, all from the script: same-product cards are `.store-price[data-relation-id]`, not `.related-card`, and the M5Stack yen line renders after the panel, so the panel screenshot was blank. The script now selects `[data-relation-id]` and waits for `.fx-value`; the results above are from the fixed run.

Updated `dist/chrome-local-0.4.7-181818` from the verified extracted ZIP (the folder name is kept so Chrome's registered path stays valid); per-file SHA256 list digests match (`894f9f80ff92c063b837870e936b121e70e3f25d11156a62512cdb455a1d35c7`). Reloading it in normal Chrome is a user action.

Independent rubric verifier (`.claude/goal-loop/mapping-supplement-049/rubric.md`, fresh context): 9/9 pass in iteration 1. It reran the suites and the catalogue invariants itself. The source SHA-256 values in `catalog.jsonl` hash the decompressed snapshot text, not the `.json.gz` bytes.

Completed: local suites, local Chromium with the ZIP. Not done: CI, normal Chrome reload, Pages deployment, store submission.

Update after the release: PR #31 CI "Typecheck and tests" passed and the PR was squash-merged as `4d8aff5` (tree identical to the verified `821e0a6`). Pages was republished by "Crawl and publish" with `republish=true` (run 37182529022: schedule, generate and deploy succeeded). The Pages ZIP has SHA256 `395a2f12…57990937f`, the same as the verified ZIP; the userscript serves `@version 0.4.9`. The three store manifests kept their dataset versions, product counts, run counts and latest observation times (akizuki `656ba41853907f43` 12,813 / 14, switch-science `82b28269bdf48607` 10,442 / 13, m5stack `3fbd7fd0a3441e7f` 672 / 12). The 0.4.9 changelog entry in `public/index.html` was missing from #31 and was added afterwards. Normal Chrome reload and store submission are user actions.

