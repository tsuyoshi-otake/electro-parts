# Pimoroni public storefront fixtures

Retrieved 2026-11-03 from https://shop.pimoroni.com/ (from Japan) with the project's identified User-Agent, 2 s apart, without following redirects.

`catalog.json.gz` holds one full capture:

- `/meta.json`: name, base currency (`GBP`), country and domain only.
- The sitemap index as served. It lists the three root product sitemaps and the market copies (`/en-eu/`, `/en-us/`, `/en-jp/` ...).
- The three root product sitemaps, reduced to their `<loc>` entries.
- All twelve `products.json` pages: 250 × 11 + 104 = 2,854 products, 3,789 variants.

Only the fields the adapter reads are kept from `products.json`. This is the full catalogue at that observation time, not a sample, and not a permanent count assertion about the live store.

`product.html.gz` is the real Presto page (`/en-jp/products/presto`, the Japan market copy a visitor from Japan is redirected to), with scripts, iframes, `noscript` blocks and hidden inputs removed. Its canonical URL, the product grid (`.product-page`: `.media`, `.purchase`, `.about`) and its inline styles are retained. The page shows yen; the catalogue amounts are GBP.

`pimoroni.css.gz` is the theme stylesheet that page links (`/cdn/shop/t/156/assets/pimoroni.css`), unchanged. It defines the color variables (and the store's own dark mode) that the dark page theme sets; the E2E serves it so the saved page renders with the store's colors.

Tests replace network responses; they do not contact the live shop.
