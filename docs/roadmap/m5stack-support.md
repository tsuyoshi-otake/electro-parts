# M5Stack official shop support (0.4.4)

Tracking: [Issue #21](https://github.com/tsuyoshi-otake/electro-parts/issues/21).

## Collection and completeness

`config/m5stack.json` enables the same two-day cadence as the existing stores.
The collector reads the home page to verify unconverted USD, the sitemap index,
every product sitemap, and paginated `/products.json?limit=250&page=N` until a short
page. On 2026-09-12 this required six requests for 664 products and 706 variants.
That count describes one observation; it is not a collection limit.

Requests are serial, identified by the project's User-Agent, with 1.5 seconds plus
jitter between requests. Retry-After and bounded backoff use the common fetcher.
Currency mismatch, invalid prices, missing availability, repeated products, page
limits or uncovered sitemap products make the snapshot incomplete and prevent
import. A changing catalogue can therefore postpone publication until a later run.

## Identity and prices

The page key is `h-` followed by a reversible escaped handle. Percent escape markers
become underscores and literal underscores are escaped first. This preserves long
handles and the real `✖` handle without file-path ambiguity. Original handles,
Shopify product IDs and SKUs remain aliases. Variants retain Shopify variant IDs;
the panel offers a separate selection for each variant.

USD amounts are integer cents, without floating-point rounding. `taxable` is not
evidence of included or excluded tax, so tax treatment stays unknown. Available
means purchasable according to Shopify; inventory quantity is not published.
Compare-at prices are a separate price basis. Prices exclude any inferred shipping,
duties or currency conversion. No M5Stack cross-store identities or price comparison
policies are automatically approved by this integration.

## Local reproduction

1. Run `npm test` and `npm run typecheck`.
2. Run `npm run test:e2e` for three-store datasets and actual unpacked extension tests
   against saved pages. The fixture is the complete catalogue observed above.
3. Build `npm run build:extension -- --zip dist/electronics-price-history-extension-0.4.4.zip`.
4. Follow the ZIP verification in `CLAUDE.md` before submitting to Chrome Web Store.
   Local datasets and intercepted pages are not evidence of public deployment.

The shared publication workflow regenerates all three store datasets and refuses
deployment when an expected manifest is missing. Raw snapshots are retained as
store-specific workflow artifacts. A new store has no past history before its
first successful observation.

Adding this store to an existing deployment uses the existing finalized state;
do not pass `--bootstrap`. Locally, `node --import tsx src/cli/main.ts pipeline
--config config/m5stack.json` follows that incremental path. For an isolated local
check, copy the config and point all four output paths to a task directory first.

Since 0.6.2 (#42) the history panel is mounted in the left column, **before**
`.product-main > .product-description`: directly below the image gallery and
above the description, as near the top as on Akizuki. The purchase column
(`.product-info-wrapper`) is absolutely positioned beside it at 1024 px and wider
and comes earlier in DOM order, so the insertion does not move it, and while the
shop fixes `.product-info` during scrolling it stays in its own column. Below
1024 px `.product-info` is a left float inside a zero-height wrapper; the
description's text flows under it, but a block would sit beneath it, so the
panel host carries `clear: both`.

Without a description the panel falls back to **after** `.product-wrapper`
(the 0.4.4 position). It never goes at the end of the wrapper: the live shop
uses that wrapper's height to control its fixed purchase sidebar, and a panel
appended inside it was covered by the purchase controls while scrolling. The
saved-page tests pin both anchors, and local live ZIP verification checks at
1440, 1024 and 390 px that `.product-info` never overlaps the panel while
scrolling through it.
