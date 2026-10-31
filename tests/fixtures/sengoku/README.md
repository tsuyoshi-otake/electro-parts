# せんごくネット通販 fixtures

Retrieved 2026-10-30 from https://www.sengoku.co.jp/ using the project's identified User-Agent,
with plain GETs and no cookies (ADR-0024), then **reduced to facts**. The shop's terms (article 7)
forbid reproducing its content without permission, so nothing here may carry a product description,
a product image or an image address. Do not add a page that does.

| File | From | Kept |
|---|---|---|
| `category-3000.html` | `/mod/sgk_cart/category.php?cid=3000` | the side menu's children of 3000 and the main area's three category levels (31 / 235 / 396), one line each |
| `listing-3013.html` | `/mod/sgk_cart/search.php?cid=3013` | the counter (`1件～40件(全2139件)`) and the listing table |
| `listing-3137.html` | `/mod/sgk_cart/search.php?cid=3137` | the same; a capped listing (`全4000件`) with two out-of-stock rows and several price lines |
| `listing-3000-st3960.html` | `/mod/sgk_cart/search.php?cid=3000&st=3960` | the same; the counter past the cap reads `3961件～3960件(全4000件)` |
| `detail-EEHD-6N43.html` | `/mod/sgk_cart/detail.php?code=EEHD-6N43` | the page skeleton the panel mounts in: header, breadcrumbs, name, model, price table and `#productno02`, without the description, images or the cart form |

In the listing tables every `item_list1_description` block was cut out (from its opening tag to the
price block, as the collector does) and every `src` attribute removed; rows keep the code, maker,
name, image alt text (the model), price lines and the out-of-stock mark. These are the shop's pages
at that time, not a permanent assertion about the live store.

The collector tests do not replay these pages. They build a small shop in the shop's format from
these rows (`tests/helpers/sengoku.ts`): a category page, listings with their own counters and a
capped listing read through its children. Tests never contact the live shop.
