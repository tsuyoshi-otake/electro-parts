# Switch Science fixtures

## `switch-science-sample-2026-09-07T00-05-56-401Z.json.gz`

A cut of a real crawl (`retrievedAt` 2026-09-07T00:05:56.401Z, 10,382 products,
42 catalogue pages, 11 product sitemaps). Keeping the whole snapshot would put
7.8 MB of gzip in the repository for every future crawl format change, so
`items` was sampled deterministically:

- seven named products, each there for a reason:
  `9381` (the price verified by hand against the storefront: ¥165 tax included),
  `3589`, `3518`, `rpicm-pl`, `11359` (the four products the store prices at
  ¥0 — the page really does print "¥0（税込）" next to a 売り切れ badge),
  `8680` (the most expensive product, ¥8,910,000) and `280` (the cheapest
  non-zero, ¥1);
- then every 149th product of the handle-sorted catalogue until 60 were
  collected. `rpicm-pl` is also the only non-numeric handle in the catalogue.

Everything else is the store's own output, unedited. The counts that describe
the *cut* were recomputed so the file stays self-consistent and passes the
adapter's cross-checks: `extractedTotal`, `catalog.{productTotal,covered,
uncovered,uncoveredSample,unlisted}`, `deduplication` and `dataQuality`. The
`requests` block still describes the full crawl it was cut from.

Regenerate with `npx tsx src/cli/main.ts crawl --config config/switch-science.json`
and re-cut; the tests assert on values from this file, so update them together.

## `html/9381.html.gz`

The product page of handle `9381`, fetched with
`npx tsx scripts/make-html-fixture.ts switch-science 9381 https://www.switch-science.com/products/9381`
(scripts removed, token-shaped attributes blanked, provenance banner
prepended). The userscript page adapter is tested against this file rather
than against the live site.
