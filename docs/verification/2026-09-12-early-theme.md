# Early saved-theme application (#27)

The extension previously ran at document_idle, causing light page content to render before the saved dark theme. Extension and userscript now run at document_start. The shared controller applies saved page CSS first, then awaits DOMContentLoaded before extracting product metadata or mounting controls. No page hiding, network polling or extra permissions are used.

## Verification

- Verify: block a parser script on all three store origins. Expect: background #3e3e3e while readyState remains loading, then a working light reset after parsing completes. Passed in `tests/e2e/early-theme.spec.ts`. All 13 configured E2E tests passed, TKW `39190d3f3d68a3d5b3a12bb9dd96520c`.
- Verify: load the extracted `early-theme.zip` as an actual extension with a fresh local Chromium profile. Expect: version 0.4.7, live prices/comparisons, persistent theme, light restoration, home reset and variant links. All 22 live checks passed, TKW `3bbd122a994d7d8377844c6ae8c1ddcf`.
- Verify: record saved-dark attribute application and first paint on live ATOM Lite pages. Expect: theme applied before first paint. Measured navigation-relative milliseconds: M5Stack 272.6 vs 1796; Switch Science 247.6 vs 396; Akizuki 439.4 vs 588. Passed, TKW `d139a588a5c1191e1a455fc2f826d77c`. These are observations from one local run, not a timing guarantee on every machine; extension storage remains asynchronous. SS/M5 header style comparisons had zero differences; screenshots inspected.
- Verify: non-E2E suite and all three TypeScript projects. Expect: pass. 462 tests passed (`4ff747099c710fc5184ce6bb0fe9361c`); all typechecks passed.
- Verify: close browsers in finally, list matching browser/runner processes. Expect: zero survivors. Passed. Updated `dist/chrome-local-0.4.7-181818` from the verified ZIP; content SHA256 matches `35D36D56D51A21E0D8517D6BB2F64D62184770C13C0A7B6BA44A088A5BDF8BF3`.

Temporary scripts and evidence: `C:/Users/developer/tmp/electro-ui047/verify-early-theme.cjs`, `early-theme-verified/`, `check-first-paint.cjs`. Normal Chrome reload is manual. Not deployed or submitted to the store.
