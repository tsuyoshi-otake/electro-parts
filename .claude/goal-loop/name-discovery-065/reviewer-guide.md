# Reviewing name-based candidate pairs (electro-parts 0.6.5)

You review pairs of product listings from two Japanese electronics shops. In every pair, at least one listing has no usable model code, so the existing code matching can never pair them. They were proposed because both product names share a rare model-like word (`tokens`) and read alike (`similarity`, character-trigram Dice 0–1). A proposal is only a lead: decide from the given fields whether the two listings sell the same product.

Each input line has `n`, `id`, `tokens`, `similarity`, and `products` (two entries, in this order). Each product has `label` (the shop's display name), `key`, `name`, `model` (the shop's model field, may be empty), `maker` (manufacturer field, may be empty), `vendor` (the shop's maker label, may be empty), `url`, `ownCodes` (codes read from the shop's own fields), and for M5Stack official pages `variants` (`offerId`, `sku`, `name`).

Shop labels: 秋月電子, スイッチサイエンス, M5Stack公式, KSY, せんごく.

Judge from the given fields only. Do not browse the web.

## Decisions

- `same_product`: the same maker product, meaning the same model, revision/version, package and configuration. Differences in wording between shops are fine: Japanese vs English, a generic product-type word (「パワーアンプ」 vs 「オーディオアンプIC」), shop prefixes, word order, shop notes. A different pack quantity of the same product is still `same_product`; record it in `missingEvidence`. A side that leaves something out lacks information; that does not prove a difference.
- `similar_product`: a different but comparable product of the same kind and purpose. Examples: another version or generation, another package (DIP vs SMD, `/P` vs `/SS`), another capacity, length, colour or rank, with or without headers or insulation. Give a family proposal (below).
- `unresolved`: the fields cannot settle whether this is the same product, for example a rank, package or revision that one side does not state while the other does. List exactly what is missing.
- `rejected`: not the same and not comparable. Examples: a bare part vs a module, kit or board built around it; a product vs its accessory, case or adapter; different product types that merely share a chip, standard or series name; a shop's own "ユニット" built around another maker's part vs the bare part.

Be strict. A shared chip name is not identity. A suffix encoding a revision, package, rank or configuration makes a pair at most `similar_product`, or `unresolved` when one side is silent about it.

## Output

Write one JSON object per input line, in input order, to the output file named in your task. Use exactly these fields:

```json
{"n":1,"id":"<copied from input>","decision":"same_product|similar_product|unresolved|rejected","evidence":"...","differences":["..."],"missingEvidence":["..."],"offerIds":[null,null],"family":null,"reviewedAt":"2026-11-02","reviewerModel":"Claude Sonnet 5.5"}
```

- `evidence`, in Japanese, at least 40 characters. Start with 「名前ベースの候補（共通語: <tokens joined with 、>）。」, then name both products by shop label and quoted name, and give the reasoning: maker, model, package, configuration, purpose.
- `differences`: each entry is exactly `<項目>: <first product's label>「<its value>」 ↔ <second product's label>「<its value>」`. The first label is products[0]'s, the second is products[1]'s. Write 「記載なし」 for a value a side does not state. Example: `パッケージ: 秋月電子「DIP-8」 ↔ せんごく「記載なし」`. Put remarks that do not fit this form into `evidence`. The array may be empty.
- `missingEvidence`:
  - For `same_product`, include the entry 「税・送料・販売数量・付属品・書込サービス等の価格比較条件は未承認」, plus anything specific, such as the pack quantity or a missing maker.
  - For `unresolved`, list what is missing; this must not be empty.
  - For `rejected`, use `[]`.
  - For `similar_product`, list what is unconfirmed, such as compatibility.
- `offerIds`: `[null, null]` unless a product has `variants`. For `same_product` and `unresolved`, set that product's slot to the `offerId` of the variant it corresponds to.
- `family`: `null` unless the decision is `similar_product`. For `similar_product`, give an object:
  - `label`: short Japanese name of the product family.
  - `purpose`: the common use, in Japanese.
  - `variants`: two different short names, one per product, in product order.
  - `features`: two objects, one per product, in product order, with the same keys. Use Japanese keys such as 「パッケージ」 or 「長さ」. Every value is a non-empty string, and at least one key has different values. Use only facts stated in the fields; write 「記載なし」 when a side does not state one.

When you are done, your final message is only a count of decisions: same_product / similar_product / unresolved / rejected.
