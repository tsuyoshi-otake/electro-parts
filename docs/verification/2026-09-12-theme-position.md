# 0.4.7 local theme colour and insertion positions

This is an intermediate local verification, not a release or store submission.

- Verify: build the ZIP, extract it, load that directory in a fresh persistent Chromium profile, and read the service worker manifest. Expect: version 0.4.7. Passed.
- Verify: open the three live ATOM Lite pages with the saved dark theme and assert computed body and history panel background colours. Expect: both `rgb(24, 24, 24)` (`#181818`). Passed for all three stores.
- Verify: wait for both related-store prices and the chart, then screenshot with the preceding page section visible. Expect: actual page context and a settled history panel. Passed; images inspected.
- Verify: close Chromium in `finally` and list the launched profile/script processes. Expect: zero survivors. Passed.

Evidence: `C:/Users/developer/tmp/electro-ui047/positions-181818/`. Script: `C:/Users/developer/tmp/electro-ui047/positions.cjs`. ZIP: `C:/Users/developer/tmp/electro-ui047/181818.zip` (202102 bytes). TKW run: `28da4dc2f92018f490acb6a066cd8dbf`, exit 0.

At a 1280px viewport, panel document positions were approximately 616px for Akizuki (below gallery/purchase controls), 2766px for Switch Science (after product description/share controls), and 6036px for M5Stack (after reviews, before footer). These depend on content and viewport. No insertion position was changed in this check.

Remaining issues: the latter two positions require substantial scrolling; the M5Stack shop's floating chat widget can overlap the panel. Earlier whole-page checks also found uncovered light surfaces; this colour check does not certify all page surfaces or mobile layouts. No deployment was performed.
