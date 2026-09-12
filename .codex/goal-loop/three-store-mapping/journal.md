# Three-store mapping verification (#23)

## 2026-09-12 / iteration 1

- C1/C2: Read all 521 new exact-code pairs in four complete batches, including original names, model codes and variant configuration. 517 accepted, 2 unresolved, 2 rejected. Existing 309 reviews/fingerprints and 2 price policies preserved. Full source scope and exceptions: docs/roadmap/three-store-mapping.md.
- C3: Added reviewed offer bindings, variant-specific reference prices and links, source selection filtering and deep-link selection. Generator serialization keys include offer ID so LED lengths sharing one product page cannot overwrite each other.
- C4 failure: E2E expected only two stores (six requests / one related card), now three stores (eight requests / two cards). Updated synthetic official reference data and the bounded-failure expectation. No production request limit increased.
- C5 failure: the initial variant screenshot preceded lazy chart rendering. Scroll before waiting for svg.eph-chart; do not treat a successful screenshot call as visual verification.

## 2026-09-12 / iteration 2

- C1 pass: matching:check reports candidates 830 / pending 0 / relations 943 / same verified 810 / similar verified 108 / price policies 2. Reimported the complete official snapshot onto e97e611's original retailer catalogue; all 19,684 serialized rows are byte-identical. Corrected importer vendor property ordering, without rewriting fingerprints or reviews.
- C2 pass: 3 complete sources, all pairs searched, scoped manufacturer normalization, original vendor/model/date preserved. New relation breakdown: Akizuki/official 18; SS/official 499; unresolved 2; rejected 2. Alias candidates remain separate, not promoted. USD sales conditions remain unapproved.
- C3 pass: targeted regression tests reject missing/changed/wrong variants, preserve distinct offer entries and filter reference cards. Real official LED strip deep link selects 20cm/SS5209; switching to 10cm selects SS5208. Screenshot shows $4.95 and JPY946 with separate observation dates.
- C4 local pass: typecheck (TKW 4a58fda59113e251f37603f787d75e00); 459 tests / 40 files (29eeb243102acb22e03118729c3bec9f); all 12 E2E (34a68ef8f414f441101aaf3de5384cc4). After adding wrong-variant rejection, all 25 generator tests pass (8c25d5a51a7acda6d3729640d61238f5). CI pending at this commit.
- C5 local pass: extracted actual ZIP loaded as MV3 in fresh local Playwright Chromium profile, service worker manifest 0.4.5, all 3 ATOM Lite real pages and real public data. All 10 live checks pass (e989256c6a48d29b69f47d14c2f67682), plus chart-visible variant check (ba9e7e8cded1c0cea40d1294b253ebde). Inspected all 3 light/dark screenshots and variants.png. SS empire.js ProductDetails._updatePrice page errors match the already isolated store-side error; no extension failure observed. The official shop's chat widget overlaps its own corner of the screenshot.
- ZIP: 200,267 bytes; SHA-256 a4031db4653e5ca87914406789478f97c7c86725ffb95391a5ee5cb6286f758a. Scripts, result JSON and viewed images: C:/Users/developer/tmp/electro-local045/. Owned node/chrome processes enumerated after completion: 0 survivors.
- README, Pages source and Web Store description source updated. Dashboard was not modified or submitted; available gallery automation is blocked. CI, merge and republish verification remain before terminal pass.
- Verification performed directly by the implementing agent; no independent agent review requested or used.
