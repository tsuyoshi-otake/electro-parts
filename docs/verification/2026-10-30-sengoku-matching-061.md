# 0.6.1 せんごく cross-store mapping (#39)

Local verification of the 0.6.1 ZIP on `feat/sengoku-matching`; not deployed to Pages or submitted to the store. Scope, counts, the 18 unresolved pairs and what is out of scope are in [three-store-mapping.md](../roadmap/three-store-mapping.md#061-せんごくの追加2026-10-30判定); the pipeline decisions are in [ADR-0018](../adr/0018-reviewed-catalog-mapping-pipeline.md#061-せんごくネット通販の追加).

## Reviews

- 2,348 Sengoku candidates in 36 maker batches, one Claude Sonnet 5.5 subagent each. A merge script checked every row: id and fingerprint equal to the candidate, decision in the enum, evidence of at least 40 characters, the price-condition note on every same product, missing evidence on every unresolved pair, the reviewed offer on every official M5Stack variant, and every difference in the `項目: 他店「…」 ↔ せんごく「…」` form. 0 problems. First decisions: same 2,282, unresolved 20, rejected 46.
- Integrating review (Claude Opus 5.5): eight readers read all 2,348 rows as tables (decision, codes, both names and makers, differences, missing evidence) and raised 19 flags; the 10 conflicts found by the merge (one store product joined to two different products of another store) were ruled together with them. 23 rows changed: 9 unresolved to same (one store's catalogue error or a short maker code confirmed by the full names), 10 same to unresolved (rating, version, form or colour contradictions on one maker part number, e.g. the five NJM78xxFA pairs), 3 unresolved to rejected (a maker-numbered version and two coincidental short codes), 1 text-only fix. One flag was declined: SS 3263 ↔ 53PN stays unresolved. Each changed row carries reviewer Claude Opus 5.5 and the first decision in its evidence. Final: same 2,281, unresolved 18, rejected 49; 0 conflicts. The 74 remaining one-to-many joins are Akizuki pack-size pages of one part.

## Suites

- Verify: `npm run matching:check`. Expect: generated files byte-identical to the sources. Passed (3,592 candidates, 0 pending, 3,655 relations: same 3,493, similar 108, price policies 2).
- Verify: `npm run typecheck`. Expect: exit 0. Passed.
- Verify: `npm test`. Expect: pass. 49 files / 636 tests passed, including the new generator test that every reviewed Sengoku pair joins as an identity only, with the integrating review's changes on record.
- Verify: `npm run test:e2e`. Expect: pass. 17/17 passed.
- Verify: `npm audit --audit-level=high`. Expect: exit 0. Passed.
- Verify: the CI guard steps replayed locally (store names in the common core, HTML-string sinks, CDN, remote code, undeclared chrome APIs, `fetch` in the content script). Expect: no hits. Passed.
- Runner and browser inventory after the suites, the live check and the startup measurement: no node, Chromium or Playwright process whose command line names the work directory or `ms-playwright`; no profile directory left.

Found by the suites and fixed:

- E2E cross-store: Akizuki 117209 (ATOM Lite) gained a third identity card (せんごく EEHD-5LAU), so the spec expects three store-price cards, checks the Sengoku card by relation id, and allows 10 data requests (5 in the 429 case) instead of 8 (4).
- E2E Sengoku extension: the saved site has no EEHD-5LAU history, and a page without its own record shows 「記録なし」 and no relation cards. The spec serves the saved EEHD-6N43 history under EEHD-5LAU and selects the Akizuki link by `data-focus-key`, since the card has two links to the same page.

## Live check of the ZIP

ZIP built with `scripts/build-extension.ts --zip`: 665,336 bytes, SHA256 `4fd7e94764b9dc5dcf252a243aaaab6f81ebb5321e69de534658d08f870ed8d6`, 7 files. Manifest: version 0.6.1, permissions `storage`, host permissions `https://tsuyoshi-otake.github.io/*` only.

The extracted ZIP was loaded with `chromium.launchPersistentContext`, `channel: 'chromium'`, a fresh profile, `--load-extension`, 420 s deadline. Real store pages and the published Pages data for Akizuki, Switch Science, M5Stack and KSY. **Sengoku data is not on Pages yet**, so only `/electro-parts/data/v1/stores/sengoku/**` was answered from the local pipeline run of 2026-10-30 (`~/tmp/electro-sengoku/pipeline/site`); the routed paths were recorded and checked. Result: 14/14 checks passed in 31 s (results.json SHA256 `7a032242…810d8d6d`).

- Verify: service worker `chrome.runtime.getManifest().version`. Expect: 0.6.1. Passed.
- Verify: Sengoku EEHD-5LAU (ATOM Lite) on a profile without saved settings. Expect: panel below `#detail_whole`; ￥2,380, tax included, 1個, stock and observation time; light theme; Akizuki 117209 (￥1,980), SS 6262 (￥1,793) and the official variant ($7.50) as reference cards with observation times and product links; no loading, fetch error or price difference; the evidence names the model and the reviewer; the change list opens. Passed.
- Verify: choose dark, reload. Expect: dark on the panel and the page (`body` rgb(62, 62, 62)), the store header stays white, and the saved dark wins after reload. Passed.
- Verify: Sengoku EEHD-0EPK (Grove cable). Expect: the SS 797 difference reads from the viewed store, 「販売数量: せんごく「1本単価 / 5本入1組」 → スイッチサイエンス「5本セット」」, and the KSY 765 card is shown. Passed.
- Verify: Sengoku EEHD-4F8Y (NJM7809FA). Expect: Akizuki 100162 only under 「要確認の候補 (1)」, no identity card and no price difference. Passed.
- Verify: reverse direction. Expect: Akizuki 117209 keeps the approved SS difference and two series (the SS series hides and returns) and shows a Sengoku card with ￥2,380 and the Sengoku link; SS 2178 shows the ADA-2305 card and not the MCX connector that shares 2305; the official ATOM Lite shows the Sengoku yen card beside the USD record; KSY 1017 (Pi 5 case) shows the Sengoku EEHD-68KT card. Passed.
- Verify: page exceptions with the extension vs. the same pages without it. Expect: none caused by the extension. Passed: SS `empire.js` `_updatePrice` null `innerHTML` and the M5Stack Goaffpro "already loaded" error both occur without the extension.
- Screenshots inspected: `sengoku-5LAU-light.png`, `sengoku-5LAU-dark.png`, `sengoku-0EPK.png`, `sengoku-4F8Y.png`, `akizuki-117209.png`, `ss-2178.png`, `m5stack-atom-lite.png`, `ksy-1017.png`. No broken or missing parts; the chat bubble at the bottom right of the M5Stack shot is the store's.

## Bundle size and startup

The generated relation table grew from 2.16 MB to 5.69 MB, so the content script grew from about 2.45 MB to 5.98 MB and the ZIP from 284,990 to 665,336 bytes. Measured offline on the saved Sengoku page with every request answered locally, the same page for both versions, 9 loads each after one warm-up (`perf.mjs`): the panel root appears at a median of 19 ms after navigation start with 0.6.1 against 16 ms with 0.6.0, and the page's used JS heap (CDP `JSHeapUsedSize`) is 24.0 MB against 15.5 MB. The cost is about 8.5 MB per open store tab; there is no budget for the generated table (README counts it separately).

Evidence: `~/tmp/electro-sengoku-061/` (ZIP, `live/results.json`, `live/live.mjs`, `live/noext-results.json`, `live/perf.json`, `live/shots/`, the merged reviews and the integration rulings).

Completed: batch and integrating reviews, local suites, local Chromium with the ZIP (Sengoku data routed from the local run). Not done: CI, Pages deployment of Sengoku data, the same check with the published Sengoku data and no routing, normal Chrome reload, store submission.
