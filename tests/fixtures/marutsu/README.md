# マルツオンライン fixtures

The listing pages were saved from https://www.marutsu.co.jp/ through the
Wayback Machine (the shop is behind a bot check for direct saving) and
**reduced to facts**: the product description of every row was emptied
and every image address removed, because the project records facts, not
the shop's prose or images (ADR-0036). Do not add a page that carries
either.

| File | From | Kept |
|---|---|---|
| `listing-stocked.html` | `GoodsListNavi.jsp` search listing, saved 2026-01-29 (LAZOS, 本日出荷 filter) | the counter variables (`resultsDataNumber` etc.) and 3 rows with a same-day stock quantity |
| `listing-no-stock.html` | `GoodsListNavi.jsp?path=1201060010&narrow1Cond=BLACK & DECKER`, saved 2025-03-19 | the counter variables and 2 rows with no stock quantity (a lead time instead) |
| `listing-dual-view.html` | the same saved page as `listing-stocked.html` (2026-01-29) | its counter script lines (the unquoted initialisations and the quoted assignments, once per rendering), its first 3 desktop rows (as kept in `listing-stocked.html`) and its first 3 smartphone rows: the page renders the same results twice, and only the desktop rows are the listing |
| `detail-40938.html` | `/pc/i/40938/` (MI-767D), **reconstructed** | not a saved page: the shop's bot check kept the live page from being saved, so this is the page skeleton as read live on 2026-11-16 (heading, 型番・マルツコード lines, stock and price table), with the description and images left out. Replace it with a saved page at the first live verification. |

The rows of the saved listings are in the shop's current format
(`li#resultsRow_N.DETAILS_ROW`), the same format the stocked category
listings use; the saved pages' own counters are kept in the counter
variables, and the tests build their own listings from these rows
(`tests/helpers/marutsu.ts`). The collector tests never contact the live
shop.
