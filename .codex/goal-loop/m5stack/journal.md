# M5Stack verification journal — Issue #21

## Iterations

1. Added collector, normalization, URL identity and variant UI. Full fixture: 664
   products / 706 variants. First unit run exposed a test using `amount` instead
   of the contract's `minAmountMinor`; corrected the assertion, not the contract.
2. Full suite exposed two old two-store registry expectations. Updated them and
   match patterns. All 456 tests passed. Saved-page Playwright: 12 passed.
3. ZIP visual inspection found the live shop's purchase sidebar overlapping the
   panel. The shop's scroll handler uses `.product-wrapper` height. Moved the
   history outside that wrapper; added a regression assertion and narrow-width
   selection checks. A Windows EPERM in E2E setup was a transient rename lock:
   the exact same directory rename succeeded after the runner exited. No publisher
   or security settings were weakened; the subsequent run passed.
4. Rebuilt ZIP and tested the actual archive in a fresh local Chromium profile.
   All 13 checks passed; M5Stack's purchase sidebar was also verified not fixed
   over the panel. Process inventory after all runs: zero matching test/browser
   survivors. The final screenshot shows readable prices and controls; the shop's
   independent help widget can still appear over the bottom-right viewport corner.

## Local evidence

| Check | Result / TKW run |
| --- | --- |
| Unit/property/DB/contract/integration/userscript | 456 passed, `10e8fc8dcd6c1880229b3d3f7067b32c` |
| Root / userscript / extension TypeScript | exit 0, `45dc6187812bae58cdd8baac1f6522be` / `153000d931bd62f5e9f4e29836e690f3` / `bde1f2e55dd8614162941c65be67a0d8` |
| Full saved-page Playwright | 12 passed, `52f99ef8c34abeabe39441915eaf3168` |
| Final M5Stack mount + variant + narrow E2E | passed, `d08e5cc9fa19aae9325ea466b0d0a306` |
| Final M5Stack unit regression | 9 passed, `de051f16fb165398898f1fa1200f4367` |
| Live collector | 664 products / 706 variants, six requests, no retries or missing sitemap products, `0d57bec46e9211e61c5159ffddc7a009` |
| Real snapshot → existing history → local publication | 664 verified product files, `f63039977749abd265604e311c70df21` |
| Final local ZIP + live product pages | 13 checks passed, `15773670ee1c70841a09ad3f1346ffe3` |
| Dependency audit | 0 vulnerabilities, `9fed9ba8065b404b4e47623091bedc63` |
| Matching reproducibility | unchanged 424 relations / 2 price policies, `2eaf0446484dcd820cf53ef9c679b16f` |
| Workflow lint / whitespace / HTML sinks | actionlint, git diff --check and bundle scan passed |

ZIP: `dist/electronics-price-history-extension-0.4.4.zip`, 92,130 bytes,
SHA256 `d94772bd1dd93cf15dc3449a2cb958eba8404cd6a78d8a688ee21c241cf16866`.
Live local evidence: `C:/Users/developer/tmp/electro-local044/final2/` plus
`C:/Users/developer/tmp/electro-local044/verify-final2.cjs`.
Store HTML was live for all three stores. Before deployment only the M5Stack data
endpoint was intercepted to serve the real locally generated snapshot; existing
stores used public data. This is not yet public M5Stack validation or Web Store
submission. The fresh initial-theme check is M5Stack; subsequent stores retain
the explicitly restored light preference. All stores pass persisted dark reload.

Switch Science emitted the same `ProductDetails._updatePrice` / `empire.js`
exception previously reproduced without the extension in local043. Stacks are
retained in result.json. No extension-origin exception was observed.

Local rubric C1–C5: pass. Public deployment and final public-data check are tracked
separately below; Web Store submission remains a separate operation.
