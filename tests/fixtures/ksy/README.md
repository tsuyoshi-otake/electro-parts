# Raspberry Pi Shop by KSY fixtures

Retrieved 2026-10-29 from https://raspberry-pi.ksyic.com/ using the project's identified User-Agent,
with plain GETs and no cookies (ADR-0023).

`list-pages.json.gz` holds the exact response bodies of the 16 public list pages
(`remote_proxy.cfc`, `ev: product.list`, `offset` 0..750, `max: 50`, registration date ascending):
50 × 15 + 26 = **776 products**, the list's own `size` at that time, with no repeated id.
Every entry has `onlist: 1`. Products hidden from the list were not collected and must
never be added here: they include customer-specific payment items.

This is the full public list at that observation time, not a permanent count assertion
about the live store. Tests replace network responses; they do not contact the live shop.

`product-page.html.gz` is the real permalink page `/main/index/pdp.id/1094/pdp.open/1094`
(Raspberry Pi Pico 2) with scripts removed. The product dialog is in the page but empty,
as it is before the shop's own script fills it; tests fill `#dt_id` and `#dt_Permalink`
the way that script does.
