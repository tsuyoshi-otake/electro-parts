# M5Stack public storefront fixtures

Retrieved 2026-09-12 from https://shop.m5stack.com/ using the project's identified User-Agent.
`catalog.json.gz` contains all three products.json pages (250 + 250 + 164 products;
706 variants), the sitemap index and the product sitemap. Only adapter input fields
are retained from products.json. This is a full catalogue at that observation time,
not a sample or a permanent count assertion about the live store.

`product.html.gz` is the real m5stamp-lora-module-sx1262 page with scripts, iframes
and hidden inputs removed. Its canonical URL and product layout are retained.
Tests replace network responses; they do not contact the live shop.
