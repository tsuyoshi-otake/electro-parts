# M5Stack public storefront fixtures

Retrieved 2026-09-12 from https://shop.m5stack.com/ using the project's identified User-Agent.
`catalog.json.gz` contains all three products.json pages (250 + 250 + 164 products;
706 variants), the sitemap index and the product sitemap. Only adapter input fields
are retained from products.json. This is a full catalogue at that observation time,
not a sample or a permanent count assertion about the live store.

`product.html.gz` is the real m5stamp-lora-module-sx1262 page with scripts, iframes
and hidden inputs removed. Its canonical URL and product layout are retained.
Tests replace network responses; they do not contact the live shop.

`product-tab5-stock-lines.html.gz` and `product-lora-stock-lines.html.gz` (Issue #74,
ADR-0027) are lines cut from the real m5stack-tab5-iot-development-kit-esp32-p4 and
m5stamp-lora-module-sx1262 pages retrieved 2026-11-04: the canonical link, the
`_SIConfig.product = {...};` line, the `_SIConfig.product.variants[i]['inventory_quantity']`
lines, the variant `<option data-inventory>` elements and the 「10+ In Stock」 line.
Nothing else from the pages is kept. The counts in them are that day's values, not
assertions about the live store. In the Tab5 page the second variant has no `<option>`;
that is how the page was, and the test relies on it.
