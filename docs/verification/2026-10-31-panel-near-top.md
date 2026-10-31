# 0.6.2 panel near the top on M5Stack and Switch Science (#42)

Local verification of the branch `feat/panel-near-top`. It has not been deployed to Pages or submitted to the store (0.6.1 is in Chrome Web Store review). Evidence is kept under `~/tmp/electro-mount/`: `shots.mjs` and `shots-062/` (screenshots and `results.json`), `published-062/` (the published-data check on the same ZIP).

## Request

- M5Stack official shop: the panel goes in the left column, directly below the image gallery and above the video/description.
- Switch Science: directly below 「カートに追加」, above the description.
- Both as near the top as on Akizuki, without breaking the layout at narrow widths.

## Change

| Store | Anchor (first match) | Fallback |
|---|---|---|
| M5Stack | before `.m5product-detail .product-main > .product-description`, host `clear: both` | after `.product-block-list`, then after `.product-wrapper` (0.4.4) |
| Switch Science | before `.product-details > .product-block--description` | after `.product-details > .product-block--form`, then the 0.4.x chain (after `.product--outer`, …) |

The M5Stack purchase column (`.product-info-wrapper`) is absolutely positioned beside the left column at 1024 px and wider and comes earlier in DOM order, so inserting before the description does not move it. Below 1024 px `.product-info` is a left float inside a zero-height wrapper: the description's text flows under it, but a block element sits beneath it. Without `clear: both` the purchase controls covered the panel while scrolling at 390 px (25 of the scroll steps overlapped); with it, none do.

## Suites

- Fail-before: with only the tests changed, the three mount tests failed on HEAD's adapters (wrong anchor and position).
- Verify: `npm run typecheck`. Expect: all three projects pass. Passed.
- Verify: `npm test`. Expect: pass. 49 files / 636 tests passed.
- Verify: `npm run test:e2e`. Expect: pass. 17/17 passed. `extension-m5stack.spec.ts` and `switch-science-product.spec.ts` now assert that the panel is the previous sibling of the description.
- Runner and browser inventory after the suites: no vitest, Playwright or Chromium survivors.

## Live pages with the unpacked 0.6.2 ZIP

The ZIP from `npm run build:extension` (SHA-256 `e8575f97cc505930…`, 665,388 bytes) was extracted and loaded in Playwright `channel: 'chromium'` with an empty profile; the service worker reported 0.6.2. Real pages and the published Pages data, no routing, 2026-10-31.

`shots.mjs`: M5Stack ATOM Lite, Switch Science 6262 (ATOM Lite) and 11479 (M5Atom Joystick v1.1) at 1440×1000, 1024×900 and 390×844. 9/9 passed.

| Page | 1440 px | 1024 px | 390 px |
|---|---|---|---|
| M5Stack ATOM Lite | x 70, width 860 | width 664 | width 370, below the purchase column |
| SS 6262 / 11479 | width 776 | width 560 | width 370 |

- Every M5Stack entry: parent `.product-main`, next sibling `.product-description`, 0 scroll steps where `.product-info` overlaps the panel. At 1440 px the shop's fixed purchase column was observed and stayed in its own column.
- Every Switch Science entry: parent `.product-details`, previous sibling the app block under the form, next sibling `.product-block--description`.
- Page width equals the viewport in every entry (no horizontal overflow).
- Screenshots (light at all widths, dark at 1440 px) were looked at: no overlap, no clipped chart, the store headers keep their own colors.

`published.mjs` with `EXPECT_VERSION=0.6.2` (the 0.6.1 store check on the same ZIP): 14/14 passed. The Akizuki, Sengoku and KSY placements are unchanged.

Page errors seen were the stores' own, known to occur without the extension (Switch Science `empire.js`, M5Stack Goaffpro).

## Not done

- Pages deployment and a Chrome Web Store submission. The submitted 0.6.1 is in review; 0.6.2 goes to the store after that review or after cancelling it.
- The pre-submission check in `CLAUDE.md` must run again on the ZIP that Pages publishes.
