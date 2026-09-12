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

The history panel is mounted **after** `.product-wrapper`, since the live shop
uses that wrapper's height to control its fixed purchase sidebar. Appending the
panel inside the wrapper can make the purchase controls cover the history while
scrolling. The saved-page test pins the insertion boundary, and local live ZIP
verification checks that `.product-info` is not fixed over the panel.
