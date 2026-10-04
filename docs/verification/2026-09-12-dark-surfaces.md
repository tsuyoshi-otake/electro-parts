# Dark surfaces follow-up (#27)

Local 0.4.7 follow-up; not deployed to Pages or submitted to the store.

## Changes

- Akizuki: search box, category sidebar, section headings, inline pastel list backgrounds and footer store links.
- Switch Science: PageFly tabs/sections, related-product cards and skip link; retains the earlier navigation-gradient and hamburger fixes.
- M5Stack: inline white collection wrapper, category/filter sidebar, sold-out badges and mobile footer. Quantity SVGs now paint inside their buttons instead of disappearing behind the newly opaque button backgrounds.
- Base background stays `#181818`. Product photos, banners and logos are not inverted.

## Verification rubric and results

1. Verify: extract the newly built ZIP and load it with a fresh `chromium.launchPersistentContext`, `channel: chromium`; read manifest from its service worker. Expect: 0.4.7. Passed.
2. Verify: inspect all laid-out light-background elements on one live product and one homepage per store at 1280px and 390px. Expect: no remaining light CSS surfaces except the deliberately preserved logo images. Passed in all 12 cases; screenshots inspected, including visible M5Stack plus/minus icons. This scan is not a guarantee about every unvisited page, image, iframe or menu state.
3. Verify: actual ZIP live checks of three-store data, two-column prices, narrow chart, theme reload, original-light restoration, non-product reset and variant links. Expect: all 22 checks pass. Passed, TKW `1ce06b161bab8fb8956971b5c7622336`.
4. Verify: `node node_modules/@playwright/test/cli.js test -c tests/e2e/playwright.config.ts tests/e2e/extension-m5stack.spec.ts tests/e2e/cross-store.spec.ts`. Expect: 4 pass. Passed, TKW `80d04bbeb99d8ae87d841fe913c3b381`.
5. Verify: close each browser in `finally`, then list matching runner/profile processes. Expect: zero remaining. Passed.

Surface scan: TKW `e9ea1b2b6a4174e8f9f73f4df054a7e2`. Evidence and scripts: `C:/Users/developer/tmp/electro-ui047/`, `*-fixed.png`, `verify-dark.cjs`, `verify-final-dark.cjs`, `dark-fixed-verified/result.json`.

ZIP `dark-fixed.zip`: 202414 bytes, SHA256 `bd400aecdd349ee89e9bc3ef73f317752e84ce51c80957108902cff70cb8fd9e`. Updated local loading folder: `dist/chrome-local-0.4.7-181818`; content hash matches the verified extracted bundle. Reload in normal Chrome remains a user action.

Diagnostic failures: an E2E invocation omitted the repository config and therefore did not generate fixtures; the correct configured command passed. A copied live script initially pointed at the old extension directory; correcting that path and using a fresh profile passed. Neither failure was a product regression.

Known limits: the native M5Stack floating chat can overlap page content; Akizuki retains its fixed desktop page width on mobile. Panel insertion positions have not changed.

## Native header follow-up (user request)

Switch Science and M5Stack headers now retain native backgrounds, text, links and controls while the body remains #181818. Akizuki still darkens its header. This supersedes the earlier whole-page light-surface criterion for these two headers.

- Verify: load `native-header.zip` unpacked into a fresh local Chromium profile, read manifest 0.4.7, toggle the actual extension theme on the three live ATOM Lite pages at 1280px and 390px. Expect: Switch Science/M5Stack header computed backgrounds, colors and SVG fills match light mode; body is rgb(24, 24, 24). Passed, zero header differences in both stores at both widths. Akizuki header still changes. TKW `12cde9b39935ddbfe535507492818386`.
- Screenshots `C:/Users/developer/tmp/electro-ui047/{m5,ss,aki}-{1280,390}-native-header.png`; inspected both widths for SS/M5 and desktop Akizuki. Script: `check-headers-final.cjs`; detailed comparisons: `*-header.json` in the same directory.
- Targeted configured E2E: 4 passed, TKW `1061237d7f1215356ff7db1f7f7471f3`. Browser and runner process inventory: zero survivors.
- Updated `dist/chrome-local-0.4.7-181818` from the tested ZIP (202487 bytes); extracted and local content hashes match. Normal Chrome reload is manual; no deployment or store submission performed.

## Gray background and M5Stack borders follow-up

### Switch Science quantity control follow-up

The dark quantity selector now has one #777 outer border and a shared #343434 background. Its minus/plus buttons no longer inherit the blue primary-action background. Native hit areas, disabled minimum state and events remain owned by the store.

Verify: load `quantity.zip` as an extension and visit live product 11240 at 1280/390px. Expect: plus/minus update the quantity, typed input works, minimum-one disables the minus wrapper, keyboard Tab shows focus, transparent child backgrounds share the outer frame, and light theme restores native styling. Passed, TKW `a0a4b411e13c2c9c8c39c001b2c31444`; both screenshots inspected. Evidence: `C:/Users/developer/tmp/electro-ui047/check-quantity.cjs`, `quantity-1280.png`, `quantity-390.png`. Early diagnostics corrected an attempted click on the native disabled wrapper, increased CSS specificity to beat shared button rules, and used keyboard Tab rather than programmatic pointer-mode focus to test focus-visible. Updated the same local load folder from tested ZIP (202764 bytes); hashes match, browser process inventory empty. No store submission or deployment.

User changed the base background to #3e3e3e. Both panel and page use it; SS/M5Stack headers remain native. M5Stack structural borders (sidebar/filter, collection cards, product sections and review separators) use #626262; interactive button and selected-image accents retain their colors.

Verify: actual unpacked ZIP on three live product pages at 1280/390px. Expect: body rgb(62,62,62), SS/M5 header colors unchanged. Passed (TKW `cbeb7d5df9ccad6d7305be5da4960414`). Additional final ZIP M5 home inspection at both widths found no bright right borders among laid-out elements; screenshot inspected after adjusting collection-card dividers (TKW `60c607f017714e15736509ac50bfb665`). Evidence: `C:/Users/developer/tmp/electro-ui047/*-gray-border.png`, `check-gray-border.cjs`, `check-gray-home-final.cjs`.

Configured M5 extension E2E passed after final changes (`225a6e0107fad8e37a009c88e849e695`). Browser/runner inventory empty. Local loading folder retains the existing `chrome-local-0.4.7-181818` name to keep Chrome's registered path valid, but contents now use #3e3e3e. Updated from `dark-3e3e3e.zip` (202559 bytes), matching content hashes. Not published.
