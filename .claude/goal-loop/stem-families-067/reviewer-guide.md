# Reviewing base-code leads (electro-parts 0.6.7)

You review groups of product listings from five Japanese electronics shops. Shop labels: 秋月電子, スイッチサイエンス, M5Stack公式, KSY, せんごく. In each group, pairs of listings from different shops are **leads**: one listing's own code is a base code (`U013`, `2SC5200`, `MP-121M`) and the other listing's code extends it (`U013-V11`, `2SC5200-O`, `MP-121M-1`). Their names may share no word at all. A lead is maybe two variants of one product line, maybe the same item written differently, maybe two unrelated products.

Your job: decide, in natural language from the given fields only, which listings form a **family of similar products**, and dismiss every lead that does not belong in one. Do not browse the web. `スイッチサイエンス` as `maker` on a スイッチサイエンス row only means the shop resells it. A せんごく name that starts with 【number】 resells the スイッチサイエンス page with that number.

## Input

The input file is a JSON array of groups. Each group has:
- `listings`: `key`, `label` (shop), `name`, `model`, `maker`, optional `makerName`, `makerCode`, `vendor`, `ownCodes`, `url`, and for M5Stack公式 pages `variants` (`offerId`, `sku`, `name`).
- `leads`: the pairs to decide (`products`: two keys, `stems`: the shared code stems).
- `knownLinks`: relations already reviewed between listings of the group. `same_product` means the two listings sell the same product; `similar_product` with `family` means they are already in that family.
- `existingFamilies`: families some listings already belong to, with every member (`variant`, `features`; members outside this group also show `label` and `name`).

## Three outcomes for a lead

1. **Similar (family)**: two different products a shopper could pick instead of each other for the same job — the same kind and purpose, differing in version or revision where the maker sells each under its own code (`U013` and `U013-V11`, `K010-AWS` and `K010-AWS-V13`), generation, chip, lens, connector, capacity, colour, pin pitch, or sold alone vs with accessories. You must be able to name a concrete difference from the fields.
2. **`different`** (dismiss): not realistic alternatives:
   - different product types that share a code stem: a module vs a board, kit, case, cable or other accessory made for it; a chip vs an evaluation board built around it;
   - mating halves (plug vs jack, male vs female, post vs housing);
   - boards or accessories for different hosts (a base for Core2 vs one for CoreS3);
   - a bundle whose main product differs, or a single item vs a set that contains it plus other things.
3. **`identity`** (dismiss): the two may be the **same item**. The extension adds only an ordering, packaging, rank, lead-free or other suffix whose meaning the fields do not show (`MP-121M` vs `MP-121M-1`, `B02B-PASK` vs `B02B-PASK-1`, a transistor `2SC5200` vs `2SC5200-O` when the base listing states no rank), or the base listing does not say which revision it sells. Missing information on one side is not proof of a difference. These pairs go to a separate identity review; never put them in one family with different variants.

When the extension names a version or configuration (`-V11`, `-V13`, `-B`, `-AWS`, a lens, a capacity) that the names or the other fields confirm, it is a separate product: decide between similar and different. When you cannot tell what the extension means, choose `identity`, not similar.

## Families

A family is a set of listings that are **pairwise** realistic alternatives. Every pair of members from different shops whose `variant` differs becomes a similar-product relation, so every member must be comparable with every other member. If one member only fits some of them, make two smaller families or leave it out.

- New families go in `families`. To add listings to a family in `existingFamilies` (for example the M5Stack公式 and せんごく pages of products already in it), use `extensions` instead of a new family. An extension member uses exactly the family's feature keys; a listing linked by `same_product` to an existing member takes that member's `variant` and `features` unchanged.
- Each listing appears at most once in your families and extensions of a group.

## Output

Write a JSON array to the output file named in your task, one object per input group, in input order:

```json
{"group": 1,
 "families": [{"label": "ADC I2Cユニット", "purpose": "I2Cでアナログ電圧を読み取るM5Stack用ユニット",
   "members": [{"key": "switch-science/5221", "variant": "U013", "features": {"型番": "U013", "ADC": "ADS1100"}, "offerId": null}]}],
 "extensions": [{"family": "core2", "members": [{"key": "m5stack/h-m5stack-core2-for-aws-kit-v1-3", "variant": "aws13", "features": {"...": "same keys as the family"}, "offerId": "<from variants>"}]}],
 "dismissed": [{"products": ["akizuki/102474", "sengoku/A5RW-6SGC"], "decision": "identity", "evidence": "類似候補（共通語幹: 2SC5200）。..."}],
 "notes": ""}
```

Rules, all checked by `check067.cjs` (run it before you finish and fix every violation):
1. Every lead of the group is covered exactly once: either both of its listings are members of one family (a new one, or an existing one including your extension), or it is in `dismissed` with `products` copied in the lead's order. Never both.
2. New family members: at least 2 shops. Listings linked by a `same_product` known link must have the same `variant` and identical `features`.
3. `features`: every member of a family has the same keys. Values are concrete facts read from the fields (name, model, codes, variant names), e.g. 型番, 版, チップ, レンズ, 付属品. Never 「記載なし」, 「不明」, 「未記載」 or a guess. Members with different `variant` must differ in at least one value; members with the same `variant` have identical values. A `型番` key holding the maker's code (without a shop prefix such as `M5STACK-`) is a concrete value.
4. `offerId`: for a listing with `variants`, the `offerId` of the variant matching that member (its `sku` should carry the member's code); `null` for listings without `variants`. If no variant matches, leave the listing out and dismiss its leads.
5. `label` and `purpose`: Japanese. `label` names the product line; `purpose` says the common use.
6. `evidence` (dismissals): Japanese, at least 40 characters, starting 「類似候補（共通語幹: <stems joined with 、>）。」, then both products by shop label and quoted name, then the reason. For `identity`, say what may be the same and which fact is missing.

Judge every group yourself; do not write a script that decides by rules. Your final message is only the last line `check067.cjs` printed.
