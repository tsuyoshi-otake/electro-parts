# Goal: Store listing summary and description lead with what the user gets, and every claim is true (Issue #44)
Workdir: C:\Codes\tsuyoshi-otake\electro-parts (branch feat/panel-near-top; the listing change is uncommitted against HEAD)

The texts: `EXTENSION_DESCRIPTION` in `scripts/build-extension.ts` (the manifest summary) and the fenced block
under `### 説明(そのまま貼る)` in `docs/chrome-web-store-listing.md` (pasted into the dashboard by
`scripts/cws-dashboard.ts fill` via `scripts/lib/store-listing.ts`).

## Criteria
- C1: Store limits and parsing. Verify: `npx vitest run tests/contract/chrome-web-store.test.ts`; read the summary
  row of the table in the doc and `EXTENSION_DESCRIPTION`. Expect: tests pass; the doc's 概要 row equals
  `EXTENSION_DESCRIPTION` exactly; it is ≤ 132 code points.
- C2: The texts open with the benefit, not a list of stores. Verify: read the first sentence of each. Expect: the
  summary's first clause says what is shown on the product page; the description's first paragraph says what the
  user can find out, before any store list; the description has no version numbers or per-version first-observation
  dates (`grep -nE "0\.[0-9]+\.[0-9]+|バージョン|2026年"` inside the block finds nothing).
- C3: Feature claims match the panel. Verify: for each bullet under 「■ 商品ページに出るもの」 find the code that renders
  it under `userscript/ui/` (e.g. grep `直近`, `最低`, `掲載`, `在庫`, `類似`, `互換`), and count same-product
  relations with `npm run matching:check`. Expect: every bullet has rendering code; the 30/90/365-day ranges exist;
  similar products are a separate card that states compatibility is not guaranteed; the same-product count printed
  by `matching:check` rounds to 約3,500.
- C4: Project wording rules hold (CLAUDE.md, 「店舗横断の商品照合・比較候補」). Verify: read the block and the summary.
  Expect: prices are called 記録価格/記録した時点の価格, never 現在価格; no claim of 最安 except stating it is not judged;
  differences are said to appear only where conditions were confirmed; 類似 is not presented as compatible.
- C5: Sites and scope match the content script. Verify: compute the content-script hosts with
  `node --import tsx -e 'import("./scripts/build-extension.ts").then(m=>console.log([...new Set(m.extensionManifest().content_scripts.flatMap(c=>c.matches).map(p=>new URL(p.replace(/\*/g,"x")).host))]))'`
  and compare with 「■ 対応サイト」; read `matchPatterns` in `userscript/adapters/*.ts`. Expect: every host is named;
  the text says cart/checkout/account pages are not affected, and the dark theme statement covers browsing pages of
  the same stores only.
- C6: Privacy and data claims match the policy and code. Verify: read `public/privacy.html`, the manifest
  `permissions`/`host_permissions` from `extensionManifest()`, and grep the extension worker for the exchange-rate URL
  and its once-a-day limit. Expect: no claim in 「■ データについて」 or 「■ プライバシー」 contradicts them (data origin +
  exchange rate only, at most once a day, no cookies, storage + data origin permissions, policy URL equals
  `PRIVACY_POLICY_URL`).
- C7: Whole suite still green. Verify: `npm run typecheck` and `timeout 900 npm test`. Expect: both exit 0.
