# 0.4.8 yen reference for USD prices (#28)

Local verification of the 0.4.8 ZIP; not deployed to Pages or submitted to the store.

## Suites

- Verify: `npm run typecheck`. Expect: all three projects pass. Passed.
- Verify: `npm test`. Expect: pass. 45 files / 535 tests passed, TKW `npm test` run in this session.
- Verify: `npm run test:e2e`. Expect: pass. 15/15 passed, TKW `9d23d753707d022611d2b4ed2d45a700`. The M5Stack extension spec routes `open.er-api.com` with `access-control-allow-origin: *`, checks `約 ￥868` / `約 ￥1,255` after the variant switch, and one rate request across a reload.
- Runner and browser inventory after the suites: only the IDE's tsserver remained; no vitest, Playwright or Chromium survivors.

## Live check of the submitted ZIP

ZIP `fx048.zip` built with `npm run build:extension -- --zip`: 206116 bytes, SHA256 `f57053ec63ea318270d7c640ceb8dbbf248f97e62ea7dfa019063b8fe5c2f680`. Manifest: version 0.4.8, permissions `storage`, host permissions `https://tsuyoshi-otake.github.io/*` only.

The extracted ZIP was loaded with `chromium.launchPersistentContext`, `channel: 'chromium'`, a fresh profile, `--load-extension`. Real store pages, the published dataset and the real rate API were used; requests to the dataset and to `open.er-api.com` were only observed (`route.continue()`). Pages: M5Stack ATOM Lite, Switch Science 6262, Akizuki 117209.

- Verify: service worker `chrome.runtime.getManifest().version`. Expect: 0.4.8. Passed.
- Verify: M5Stack page in a profile without saved settings. Expect: `$7.50` with `約 ￥1,184（円換算の参考値）`, which equals round(7.50 × stored rate 157.820352); rate line `1 USD = 157.82円（2026-10-04 09:02 更新）`, the exclusions note and the `Rates By Exchange Rate API` link; observation dates; light theme; exactly one request to `https://open.er-api.com/v6/latest/USD`. Passed. Stored state: provider update 2026-10-04T00:02:32Z, next 2026-10-05T00:09:02Z, failures 0 (TKW `7925915309e58a57df6b846dfad1d626`).
- Verify: choose dark, reload. Expect: saved dark applies (`body` rgb(62, 62, 62)), yen reference still shown, still one rate request. Passed.
- Verify: Switch Science and Akizuki pages. Expect: JPY history with dates, no `.fx`, no further rate request, dark carried across stores; the M5Stack card on those pages stays `$7.50` without conversion. Passed.
- Verify: switch back to light, reload. Expect: light persists. Passed.
- Verify: restart the browser with the same profile and open all three pages. Expect: zero rate requests (stored rate serves a new session), no error or loading text. Passed (TKW `853888c5f228d3c92c82d1b033319512`).
- Verify: store series on the approved ATOM Lite pair. Expect: the other store's series hides when unchecked and returns when checked. Akizuki passed in the second run; Switch Science passed after waiting for the lazily drawn chart (TKW `b24d8dfcf7b4101ab2db5da4bbf2f0a0`). The first Switch Science attempt counted checkboxes before the chart entered the viewport; that was a script timing error, not a product failure.
- Verify: page exceptions with the extension vs. the same pages without it (fresh profile, no extension). Expect: none caused by the extension. Passed: Switch Science `empire.js` `_updatePrice` null `innerHTML` and M5Stack `Goaffpro is already loaded` occur without the extension as well.
- Screenshots inspected: `m5-light.png`, `m5-dark.png`, `switch-science-dark.png`, `akizuki-light-series.png`, `switch-science-light-series.png`. Layout intact; the yen line sits under the USD headline in both themes.
- Browsers closed in `finally` with a 240 s (120 s for the third run) deadline; process inventory for the temporary directory afterwards: 0.

The first live run reported five failures: three came from reading `innerText` of the shadow host (empty) instead of the shadow `<section>`, one from looking for series on the M5Stack page (the approved overlay pair is Akizuki ↔ Switch Science), one from store-side exceptions. The script was fixed and rerun; results above are from the fixed runs.

Updated `dist/chrome-local-0.4.7-181818` from the verified extracted ZIP (the folder name is kept so Chrome's registered path stays valid); per-file SHA256 list digests match (`0cc42d60793b46f14a58c51fea13ad235941c662736c7202a996766e8330379f`). Reloading it in normal Chrome is a user action.

The temporary folder `C:/Users/developer/tmp/electro-fx048/` was deleted on 2026-10-04 after the release, including the live-check scripts, results JSON and screenshots. The results above are the record. The verified ZIP is the same file Pages serves: `https://tsuyoshi-otake.github.io/electro-parts/electronics-price-history-extension.zip`, published by run 37176548713, has the same SHA256 `f57053ec…c2f680`. A fresh `npm run build:extension` from main `c21aa29` produced identical files.

Completed: CI-equivalent local suites, local Chromium with the ZIP. Not done: normal Chrome reload, Pages deployment, store submission.
