# CLAUDE.md

## What this repository is

Local snapshots of the full product catalogs of Japanese electronic-parts retailers. Agents use this repository to **search for electronic parts** (availability, price, sales code, product URL) without scraping the live sites.

There is no application code here — the deliverable is the datasets themselves.

## Dataset files

One self-contained UTF-8 JSON snapshot per scrape run, named `<retailer>-...products-<ISO8601 timestamp>.json`. The timestamp in the filename (and the `retrievedAt` field inside) tells you how fresh the data is. **Always use the file with the newest timestamp per retailer.** Note the file patterns differ slightly per retailer (`-all-products-` vs `-products-`) — glob the pattern from the table, not a single shared one.

| Retailer | File pattern | Products | Notes |
|---|---|---|---|
| Akizuki Denshi (秋月電子通商) | `akizuki-all-products-*.json` | ~8,700 | Discrete components, ICs, kits. Exact stock quantities included |
| Switch Science (スイッチサイエンス) | `switch-science-all-products-*.json` | ~10,300 | Dev boards, modules (M5Stack, Adafruit, SparkFun, Seeed, Pololu, Raspberry Pi...). Availability only, no quantities |
| Aitendo (アイテンドー) | `aitendo-products-*.json` | ~6,300 | Cheap modules, LCD/OLED panels, bare boards, China-sourced kits. Reference stock quantities; **no category field** |
| Sengoku Densho (せんごく通商) | `sengoku-net-products-*-complete.json` | ~53,800 | Largest catalog here. Discrete parts, cases (タカチ), connectors, tools, even guitar parts. **Spec `description` text + quantity-break `priceTiers`**; stock is boolean |
| Kyohritsu Eleshop (共立エレショップ) | `kyohritsu-eleshop-products-*.json` | ~35,200 | Broad parts/kit catalog. **⚠️ This snapshot is encoding-broken — Japanese text and all numeric prices are unusable. See the Kyohritsu section before relying on it** |

Files are pretty-printed (8–103 MB). Loading all five costs ~2.5 s of `json.load`, so a single Python process can hold every catalog at once; still, print only projections (see the context-efficiency rules). Prefer structured queries (Python/jq) over raw Grep; Grep works for a quick "does this keyword exist" check.

**When searching for a part, check every dataset** — they overlap little:
- **Akizuki** — discrete parts (resistors, capacitors, transistors, LEDs, connectors, PIC); exact stock quantities.
- **Switch Science** — maker-ecosystem boards and modules (M5Stack, Adafruit, SparkFun...).
- **Sengoku** — the widest selection and the only one with per-item spec text; check it whenever Akizuki lacks a value/package.
- **Aitendo** — low-cost display panels, RF/audio modules, odd one-off boards; shallow, volatile stock, so a last resort for quantity.
- **Kyohritsu** — currently searchable by ASCII 型番/商品コード only (broken encoding); prefer the others until it is re-scraped.

## Akizuki schema (schemaVersion 2)

Top level: `source`, `retrievedAt`, `complete`, `genreCount` / `genres[]` (18 catalog genres with per-genre stats), `extractedTotal` / `items[]`, `deduplication` (by `salesCode`; a product listed in multiple genres appears **once** in `items` with all genres in its `sourceGenres`), `dataQuality`, `requests`, `validation` (check `validation.errors` before trusting a snapshot).

Each element of `items[]`:

```json
{
  "salesCode": "109848",                  // Akizuki's unique product ID (通販コード)
  "modelNumber": "AE-DRV8835-S",          // manufacturer/board model; may be null (~220 items)
  "name": "DRV8835使用ステッピング&DCモーター...", // product name, Japanese
  "category": "モータードライバーIC(motoric)",    // "Japanese label(ascii-slug)" — 375 categories
  "url": "https://akizukidenshi.com/catalog/g/g109848/",
  "prices": [                             // ARRAY — quantity-break pricing possible
    { "amountYen": 550, "display": "￥550(税込)", "quantityUnit": "1セット", "taxIncluded": true }
  ],
  "stock": {
    "status": "在庫あり",                  // free text, Japanese — see below
    "availableQuantity": 501,             // exact quantity; may be null
    "purchasable": true                   // authoritative buy/no-buy flag
  },
  "sourceGenres": [ { "name": "...", "url": "..." } ]
}
```

- Product page URL pattern: `https://akizukidenshi.com/catalog/g/g<salesCode>/`.
- `stock.status` is free text with 50+ variants (`在庫あり`, `在庫僅少`, `入荷未定`, `販売終了`, `在庫あり 9月中旬入荷予定`, ...). **Do not string-match status to decide availability — use `stock.purchasable`.** Use `status` only for display or restock-date hints.
- `category` embeds an ASCII slug in parentheses (e.g. `(motoric)`, `(led)`, `(mcuboard)`) — handy for exact category filtering without typing Japanese.

## Switch Science schema (schemaVersion 1)

Source is the Shopify bulk catalog API (`products.json`). Top level: `source`, `sourceCatalogApi`, `retrievedAt`, `complete`, `extractedTotal` / `items[]`, `deduplication` (by Shopify product ID), `inventory` (explains why exact quantities are absent), `dataQuality`, `validation`.

Each element of `items[]`:

```json
{
  "salesCode": "11342",                   // Switch Science catalog number == sku == handle
  "modelNumber": "KOHACRAFT-012",         // usually == productCode
  "name": "窓ぺタ！ソーラーセンサーライト",      // Japanese
  "productId": 8992241123526,             // Shopify product ID (dedup key)
  "url": "https://www.switch-science.com/products/11342",
  "vendor": "スイッチサイエンス",             // brand: SparkFun, Adafruit, M5Stack, Seeed, ...
  "manufacturerName": null,               // populated on ~half the items
  "manufacturerProductCode": null,
  "prices": {                             // OBJECT, not array (unlike Akizuki)
    "minYen": 3600, "maxYen": 3600, "varies": false, "taxIncluded": true
  },
  "stock": {
    "status": "あり",                      // only "あり" / "なし"
    "available": true,                     // authoritative flag — use this
    "availableQuantity": null              // never populated (API limitation)
  },
  "variants": [ { "sku": "11342", "priceYen": 3600, "available": true, ... } ],
  "categories": [                          // flat Shopify collection tags,
    "ツール/部品", "ツール/部品_LED・EL", ...  // "top-level" and "top-level_sub" entries
  ],
  "publishedAt": "...", "updatedAt": "..."  // JST timestamps
}
```

- Availability flag differs by dataset: Akizuki `stock.purchasable`, Switch Science `stock.available`. Roughly 44% of Switch Science items are out of stock (`なし`) — filter on `available` by default.
- `categories` is a flat list mixing hierarchy levels; sub-categories use `親_子` naming (e.g. `センサ_温度・湿度`). Filter by substring or exact tag.
- `vendor` is the fastest brand filter (e.g. all M5Stack products: `vendor == "M5Stack"`).

## Aitendo schema (schemaVersion 1.0.0)

Source is the paginated catalog listing (`/product-list`, 100 items/page). Top level: `schemaVersion`, `source`, `retrievedAt`, `startedAt`, `terminalState`, `complete`, `notes` (Japanese field notes worth reading), `crawl` (page/request stats — check `failedPageCount == 0`), `deduplication` (key priority `salesCode` → `detailUrl` → `modelNumber+name`), `dataQuality` (`counts` + `validationSamples`), `items[]`.

```json
{
  "salesCode": "21862",                   // == siteProductId; the /product/{id} path segment
  "modelNumber": "SB360",                 // from the trailing [..] in the listing name; always present
  "name": "バーニアダイアル",                 // listing name with the [型番] suffix stripped
  "listingName": "バーニアダイアル [SB360]",
  "priceTaxIncludedYen": 825,             // null for range products AND for 158 priceless items
  "priceTaxIncludedMinYen": 825,          // null only for the 158 items with no listed price at all
  "priceTaxIncludedMaxYen": 825,
  "priceTaxExcludedYen": 750, "priceTaxExcludedMinYen": 750, "priceTaxExcludedMaxYen": 750,
  "price": { "taxIncluded": { "raw": "825円", "minYen": 825, "maxYen": 825,
                              "singleYen": 825, "isRange": false }, "taxExcluded": { ... } },
  "stockStatus": "not_displayed",         // in_stock | out_of_stock | not_displayed | preparing | checking | restocking | unknown
  "stockAvailability": null,              // true (3,356) / false (1,557) / null (1,400 = unknown)
  "referenceStockQuantity": null,         // 参考在庫数, 1–1,926; present only when stockStatus == in_stock
  "stock": { "raw": "参考在庫数8点", "status": "in_stock", "availability": true,
             "referenceQuantity": 8, "quantityType": "reference" },
  "detailUrl": "https://www.aitendo.com/product/21862",
  "sourcePageNumbers": [1], "sourcePageUrls": [ "..." ], "occurrenceCount": 1
}
```

- **The URL field is `detailUrl`, not `url`** (as in Kyohritsu; Akizuki/Switch Science/Sengoku use `url`). Pattern: `https://www.aitendo.com/product/<salesCode>`.
- **Availability: use `stockAvailability` (or `stock.availability`), and treat `null` as unknown, not out of stock.** `not_displayed` (898 items) means the listing simply showed no stock line — it is *not* a stockout. Filter `stockAvailability is True` for "definitely buyable"; include `None` only when you say so explicitly.
- `referenceStockQuantity` is Aitendo's own 参考在庫数 (reference count), not a guaranteed on-hand figure — usable for ranking candidates by depth, but verify on the live page before committing to a quantity.
- Prices: **335 products are ranges** (variation products) — `priceTaxIncludedYen` is null while Min/Max are set, so display `¥min–¥max`; **158 products carry no price at all** (every 税込/税抜 field null, mostly `preparing` / `out_of_stock` items) — report them as 価格未掲載 with the `detailUrl`, never as ¥0 or ¥None. A safe display value is `priceTaxIncludedYen or priceTaxIncludedMinYen` with an explicit null branch.
- **There is no `category`/`vendor` field.** All filtering is free text over `name` + `modelNumber` (+ `listingName`). For the funnel's "distribution" round, bucket by a `modelNumber` prefix or a keyword hit table instead of categories.
- Variation products exist but per-variant rows do not: `items[]` has no `variants` array (the listing does not expose them), only the min/max price spread.
- There is no `validation` block like Akizuki's — the snapshot-trust checks are `complete` / `terminalState == "complete"`, `crawl.failedPageCount == 0`, and `dataQuality.validationIssueCount` (158 in the current snapshot = exactly the priceless items).
- Data comes from the **listing pages only**, so there are no specs, datasheets, or images. For anything beyond name/型番/price/stock, open `detailUrl`.

## Sengoku schema (schemaVersion 1.0.0)

Source is the category-search listing (`sgk_cart/search.php?cid=...`), traversed over 207 categories. Top level: `source` (a plain string here, not an object), `sourceCatalog`, `retrievedAt`, `complete`, `occurrenceTotal` / `extractedTotal` / `uniqueProductTotal`, `deduplication` (key priority `managementCode` → `salesCode` → `url`), `categoryTraversal`, `inventory`, `requestMetrics`, `dataQuality`, `validation`, `items[]`.

```json
{
  "salesCode": "1AD1-0001",               // == managementCode for every item; the ?code= query value
  "managementCode": "1AD1-0001",
  "modelNumber": "SN-3-200",              // null on ~2,850 items
  "name": "チョークコイル",
  "listingName": "チョークコイル SN-3-200",
  "manufacturer": null,                   // null on ~8,300 items; e.g. タカチ電機工業, パナソニック電工
  "priceTaxIncluded": 158,                // price of the SMALLEST-quantity tier (see below)
  "priceMinTaxIncluded": 158, "priceMaxTaxIncluded": 158,
  "priceTiers": [                         // quantity breaks, up to 5 tiers
    { "label": "【数量1個〜】単価 ¥158", "minimumQuantity": 1, "priceTaxIncluded": 158, "currency": "JPY" }
  ],
  "taxIncluded": true,
  "stock": { "status": "在庫あり",          // 在庫あり | 欠品中 | 表示不一致 (5 items)
             "available": true,           // authoritative flag; null on the 5 表示不一致 items
             "availableQuantity": null,   // never populated — site does not publish quantities
             "rawLabel": "在庫あり" },
  "description": "定格電流:1A インダクタンス:10μH 直流抵抗:0.045Ω ...", // specs! present on ~48,200 items
  "url": "https://www.sengoku.co.jp/mod/sgk_cart/detail.php?code=1AD1-0001",
  "imageUrl": "...",
  "categories": [ { "cid": "3137", "name": "コイル・コンデンサ・抵抗", "url": "..." } ],
  "sourcePages": [ ... ], "duplicateOccurrences": 2
}
```

- **`description` is unique to this dataset — search it.** Ratings, tolerances, dimensions, and pinouts live there (`定格電流:1A`, `耐圧:16V`, `外形寸法:8.5×5.5mm`), so Sengoku is the only catalog where you can filter on an electrical spec instead of hoping it appears in the product name.
- **`priceTaxIncluded` is the smallest-quantity tier, and that tier is not always quantity 1** (~1,200 items start at 【数量10個〜】). For a "cheapest single unit" comparison, check `priceTiers[0].minimumQuantity` before quoting the number; `priceMinTaxIncluded` is the *bulk* price (largest tier), not the unit price. ~21,800 items have multiple tiers.
- Availability: `stock.available` (51,976 true / 1,800 false / 5 null). Quantities are never available (`inventory.exactQuantityAvailable: false`) — for quantity-sensitive picks, check the live page.
- `categories` is a path from broad to narrow but is often depth 1 (37,869 items) — do not assume a leaf category. Filter by `cid` for exactness.
- Coverage caveat: the site caps a category listing at 4,000 results. `categoryTraversal` records 5 capped categories, all resolved by subdividing into child categories (`unresolvedCaps: []`), and `validation.completeRule` confirms the run ended with 0 unresolved caps and 0 request errors. If a future snapshot has non-empty `unresolvedCaps`, that category is silently truncated.

## Kyohritsu Eleshop schema (schemaVersion 1.0.0) — ⚠️ current snapshot is corrupted

Structure mirrors the Aitendo scraper (`source`/`notes`/`crawl`/`deduplication`/`dataQuality`/`items[]`, `crawl.taskStats[]` per genre). **But the 2026-08-02 snapshot decoded eleshop.jp's Shift_JIS pages with the wrong codec**, so before using it, know exactly what is broken and what survived:

Broken (verified on the snapshot, not recoverable from this file):
- `name`, `listingName`, `brand.name`/`brand.raw`, `categories[].name`, `categoryPath`, `labels`, `stock.raw` are mojibake — 34,781 of 35,235 names contain U+FFFD replacement characters, and **0 items have valid Japanese text**. The original bytes are lost (re-encoding to cp932/euc-jp fails), so **Japanese keyword search against this dataset returns nothing meaningful**.
- `priceTaxIncludedYen` and `price.valueYen` are **null on all 35,235 items** (that is the entire `validationIssueCount: 35239`), because the ￥ sign was mangled and the parser bailed.

Intact and usable:
- `salesCode` (e.g. `Q7V413`; URL `https://eleshop.jp/shop/g/g<salesCode>/`), `detailUrl`, `imageUrl`.
- `modelNumber` — ASCII on 34,076 items, so **part-number search still works** (`OPA1622-DIP`, `2SC1815`).
- `price.raw` still carries the digits (`"￥2,200"` → mojibake prefix + `2,200`); recover with `int(re.sub(r'[^0-9]','',re.search(r'[0-9][0-9,]*', raw).group()))` and label the result as parsed-from-raw.
- Stock: `purchasable` (34,027 true / 1,208 false), `stockStatus` (`in_stock` 8,741 / `unknown` 26,494 — `unknown` means 店舗取扱/取寄せ, *not* out of stock), `displayedStockQuantity` (populated on the 8,741 `in_stock` items, 1–71,100).
- Category **codes** survive even though the names do not: `categories[].code` is a 2/4/6/8-digit hierarchy (`11` 電子部品・半導体・ケース → `1111` 半導体 → `111124` オペアンプ → `11112420` 汎用オペアンプ), and `sourceGenre`/`sourceGenres[].name` plus `crawl.taskStats[].name` are correctly encoded Japanese — use those for genre-level filtering.
- Also note `dataQuality.counts.missingTaxIncludedPrice == 35235` is the fastest single check for "is this snapshot still broken?" A healthy re-scrape should be near 0.

**The fix is a re-scrape that decodes the pages as Shift_JIS (cp932), not a workaround here.** Until then, treat Kyohritsu as a 型番-only index.

## How to search for parts

Product names and categories are **Japanese**. Search with Japanese keywords (抵抗, コンデンサー, マイコン, 電池...) or by part/model number in ASCII (`DRV8835`, `ESP32`, `2SC1815`).

On this Windows box, always force UTF-8 when piping Japanese through Python:

```bash
cd "C:\Codes\tsuyoshi-otake\electro-parts"
PYTHONIOENCODING=utf-8 python -X utf8 -c "
import json, glob

def newest(pat):
    return sorted(glob.glob(pat))[-1]

q = 'ESP32'.lower()

# --- Akizuki ---
for i in json.load(open(newest('akizuki-all-products-*.json'), encoding='utf-8'))['items']:
    hay = (i['name'] + (i['modelNumber'] or '') + i['category']).lower()
    if q in hay and i['stock']['purchasable']:
        print('[akizuki]', i['salesCode'], i['name'],
              f\"¥{i['prices'][0]['amountYen']}\", i['url'])

# --- Switch Science ---
for i in json.load(open(newest('switch-science-all-products-*.json'), encoding='utf-8'))['items']:
    hay = (i['name'] + (i['modelNumber'] or '') + (i['manufacturerProductName'] or '')
           + ' '.join(i['categories'])).lower()
    if q in hay and i['stock']['available']:
        print('[switch-science]', i['salesCode'], i['name'],
              f\"¥{i['prices']['minYen']}\", i['url'])

# --- Aitendo ---
for i in json.load(open(newest('aitendo-products-*.json'), encoding='utf-8'))['items']:
    hay = (i['name'] + i['modelNumber']).lower()
    if q in hay and i['stockAvailability'] is not False:
        lo, hi = i['priceTaxIncludedMinYen'], i['priceTaxIncludedMaxYen']
        yen = '価格未掲載' if lo is None else (f'¥{lo}' if lo == hi else f'¥{lo}-{hi}')
        print('[aitendo]', i['salesCode'], i['name'], yen,
              i['stockStatus'], i['referenceStockQuantity'], i['detailUrl'])

# --- Sengoku (also searches the spec description) ---
for i in json.load(open(newest('sengoku-net-products-*.json'), encoding='utf-8'))['items']:
    hay = (i['name'] + (i['modelNumber'] or '') + (i['description'] or '')).lower()
    if q in hay and i['stock']['available']:
        t = i['priceTiers'][0] if i['priceTiers'] else None
        print('[sengoku]', i['salesCode'], i['name'],
              f\"¥{i['priceTaxIncluded']}\", f\"(from {t['minimumQuantity']}pcs)\" if t else '', i['url'])

# --- Kyohritsu: ASCII model numbers only, price parsed out of the mojibake raw ---
import re
for i in json.load(open(newest('kyohritsu-eleshop-products-*.json'), encoding='utf-8'))['items']:
    if q in (i['modelNumber'] or '').lower() and i['purchasable']:
        m = re.search(r'[0-9][0-9,]*', i['price']['raw'] or '')
        print('[kyohritsu]', i['salesCode'], i['modelNumber'],
              f\"¥{m.group().replace(',','') if m else '?'}\",
              i['stockStatus'], i['displayedStockQuantity'], i['detailUrl'])
"
```

Search tips:
- Match part numbers against `name` + `modelNumber` (+ Switch Science's `manufacturerProductCode`/`manufacturerProductName`, + Sengoku's `description`); they often live only in `name`.
- **The field names differ per dataset — do not copy one retailer's accessor to another.** Quick map:

  | | url field | availability | quantity | price (税込) | category |
  |---|---|---|---|---|---|
  | akizuki | `url` | `stock.purchasable` | `stock.availableQuantity` | `prices[0].amountYen` | `category` |
  | switch-science | `url` | `stock.available` | — | `prices.minYen` | `categories[]`, `vendor` |
  | aitendo | `detailUrl` | `stockAvailability` (tri-state) | `referenceStockQuantity` | `priceTaxIncludedYen`/`…MinYen` | — |
  | sengoku | `url` | `stock.available` | — | `priceTaxIncluded` + `priceTiers[]` | `categories[].cid` |
  | kyohritsu | `detailUrl` | `purchasable` | `displayedStockQuantity` | **null — parse `price.raw`** | `categories[].code` |

- Filter to buyable parts by default; mention out-of-stock hits only when relevant. Aitendo's flag is tri-state (keep `True`, drop `False`, decide case-by-case on `None`), and Kyohritsu's `stockStatus: unknown` (26,494 items) means 店舗取扱/取寄せ, not a stockout — lean on `purchasable` there.
- **Stock quantity matters as much as price when selecting a part.** "In stock" alone is not enough: a part with 3 units left is a bad recommendation for anything beyond a one-off. Akizuki (`stock.availableQuantity`) and Kyohritsu (`displayedStockQuantity`, on its 8,741 `in_stock` items) expose real numbers — surface them and prefer deeply stocked parts (hundreds+) when candidates are otherwise equivalent; treat thin stock (< the quantity the user needs, or single digits) as a risk to flag. Aitendo's `referenceStockQuantity` (参考在庫数) is indicative only. Switch Science and Sengoku expose only a boolean, so verify quantity-sensitive picks on the live product page.
- For "cheapest X": Akizuki prices are per `quantityUnit` (some are per 10 pcs / per set) — compare unit prices, not raw `amountYen`. Switch Science `prices.minYen` is a listing/variant price, not proof of a single physical unit: a product can be a pack even with one variant. Verify the contents and quantity from the product page. Sengoku's `priceTaxIncluded` is the smallest tier, whose `minimumQuantity` may be 10 or more — for bulk needs quote the matching tier from `priceTiers`. Aitendo names encode the multiple instead (`（50本入）`, `2個入`) and range products span variations — read the name before comparing prices. Cross-store arithmetic also requires matching tax, currency, revision, accessories and quote type (ADR-0017).
- Prices are 税込 in Akizuki, Switch Science, and Sengoku; Aitendo carries both 税込 and 税抜 columns — quote the 税込 one to stay comparable, and skip (or flag) the 158 items whose price is entirely absent. Kyohritsu numeric prices are all null in the current snapshot; parse `price.raw` and label the number as such.
- Japanese spelling varies: コンデンサ/コンデンサー, センサ/センサー. Match a stem (e.g. `コンデンサ`, `センサ`) to catch both.
- When reporting a part to the user, include: retailer, sales code, name, price (税込), stock status, and the product `url`.

## Context-efficient search strategy

These files are 8–103 MB and hold ~114,000 products in total. The failure mode is flooding your context with JSON you then have to re-read. Rules:

1. **Never `Read` the JSON files.** Never print whole item objects (`json.dumps(item)`). Every query runs inside Python and prints only a compact, one-line-per-item projection of the fields you need: `salesCode | name | ¥price | stock | url`. A useful result set is 5–20 lines, not 500.

2. **Count before you print (funnel pattern).** A part search is a funnel: count → distribution → top-N details.
   - Round 1: print only `len(hits)` per retailer.
   - If > ~30 hits: don't print items — print the hit distribution by `category` (Akizuki) / top-level `categories` tag or `vendor` (Switch Science) / `categories[0].name` or `manufacturer` (Sengoku) via `collections.Counter`, then refine the query with the right category/spec keyword (e.g. `3.3V`, `I2C`, package name). Aitendo has no category field and Kyohritsu's are mojibake, so bucket those by `modelNumber` prefix (or Kyohritsu's `categories[].code`) instead. Expect big hit counts from Sengoku (53,781 items) and Kyohritsu (35,235) — always count first on those two.
   - If ≤ ~30: print the one-line projection, sorted by price, capped with `[:20]`.
   - If 0: retry once with a shorter stem (`コンデンサ` not `電解コンデンサー 100uF`) before concluding it doesn't exist. Search with the *shortest distinctive token* — part-number fragments (`DRV8835`, `2SC1815`) beat descriptive phrases.

3. **One Python invocation per funnel round, all retailers at once.** Don't run separate processes per retailer or per keyword variant — batch keyword variants (spelling variants, stem forms) into a single script that reports counts for each. Each Bash round-trip costs context; three well-designed rounds should resolve almost any part search.

4. **Structured filters beat free text.** When the user's request maps to a category ("オペアンプが欲しい"), filter on `category`/`categories`/`vendor`/`cid` equality first and use free-text matching only inside that subset. Category slugs (Akizuki: `(opeamp)`, `(mcuboard)`...), `vendor` values (`M5Stack`, `Adafruit`...), Sengoku `cid`s, and Kyohritsu category `code`s are exact and cheap — and the codes still work on Kyohritsu where its names do not.

5. **Selection queries end with numbers, not lists.** "Cheapest in-stock X" should print the top 3 candidates, not everything that matched. Compute `min`/`sorted(...)[:3]` inside Python.

6. **Delegate open-ended exploration.** If the request is vague enough to need many exploratory rounds ("ロボットアームに使えそうなパーツを一通り"), push the whole funnel into a subagent (Explore / general-purpose) and have it return only the final candidate table — the intermediate rounds then never touch your context.

7. **Grep is for existence checks only** (`Grep` with `head_limit: 5` to see if a token appears at all). Never use Grep with context lines to extract item data — pretty-printed JSON makes matches span dozens of lines.

## When the parts are for JLCPCB PCBA: prefer LCSC

The datasets in this repository cover Japanese retail (hand-assembly, prototyping, one-off purchases). **They are the wrong source when the goal is a PCBA order fabricated at JLCPCB** — JLCPCB assembles from the LCSC catalog, so parts bought at these Japanese retailers cannot go on the assembly line anyway (consigned parts are possible but slow and rarely worth it).

For JLCPCB PCBA jobs:
- **Select parts from LCSC first** (`https://www.lcsc.com/` or JLCPCB's parts library `https://jlcpcb.com/parts`), identified by LCSC part numbers (`C` + digits, e.g. `C25804`). Record the C-number in the BOM — it is the key JLCPCB's assembly flow consumes.
- **Prefer "Basic" (and "Preferred") library parts over "Extended" parts.** Every Extended part adds a per-reel loading fee to the assembly order; a design that sticks to Basic parts for passives (resistors, capacitors, common transistors/diodes/regulators) is significantly cheaper to assemble.
- **Stock quantity is a first-class selection criterion, not an afterthought.** Don't just check "in stock" — check the *quantity*: it must cover BOM quantity × board count × (1 + attrition, a few % for small passives), ideally with headroom for a re-spin or second batch. Between electrically equivalent candidates, prefer the one with thousands in stock over one with dozens; thin LCSC stock on a sole-source IC is a schedule risk that can stall the whole assembly order. For critical ICs, verify stock before finalizing the schematic, and pick a Basic-library second source where possible.
- **Prefer parts with many footprint- and pinout-compatible alternatives (drop-in second sources).** The best insurance against a stockout is a part you can swap without touching the layout. Choose industry-standard packages and de-facto standard pinouts — SOT-23 transistors/MOSFETs, SOIC-8 op-amps with the standard pinout, SOT-223/SOT-89 `1117`-style regulators, 0402/0603/0805 passives, standard-pinout USB/level-shifter/EEPROM parts — over proprietary packages or vendor-unique pinouts. Before committing to an IC, search LCSC for how many *other* manufacturers offer a compatible part in the same footprint: a footprint with 5+ interchangeable sources is robust; a sole-source exotic package means any stock hiccup forces a re-layout. Apply the same lens to modules and connectors (e.g. standard pin-pitch headers over custom connectors).
- Use this repository's datasets in PCBA projects only for the parts that stay off-board: connectors mounted by hand, enclosures/hardware, development boards for firmware bring-up, or a breadboard prototype ahead of the PCB spin.

## Refreshing the data

Snapshots are static — prices and stock drift after `retrievedAt`. If freshness matters (final purchase decision, stock-critical parts), verify on the live product page (`url`) rather than trusting the snapshot. New scrape runs should write a new timestamped file following the same naming pattern, not overwrite an existing snapshot.

**Validate a new snapshot before trusting it** — the Kyohritsu file shows how a run can report `complete: true`, `failedPageCount: 0`, and still be worthless. Cheap checks on any new file:
1. `dataQuality`'s missing-price / missing-name counts are a small fraction of `items` (Kyohritsu's was 100%).
2. No `'�'` in `items[0..n]['name']`, and Japanese names actually match `[぀-ヿ一-鿿]` — catches a wrong-codec run instantly. Japanese sites still serving Shift_JIS (eleshop.jp) must be decoded as cp932.
3. Item count is in the same ballpark as the previous snapshot for that retailer.
4. Retailer-specific completeness field: Akizuki `validation.errors`, Sengoku `categoryTraversal.unresolvedCaps` + `validation.completeRule`, Aitendo/Kyohritsu `terminalState` + `crawl.failedPageCount`.
