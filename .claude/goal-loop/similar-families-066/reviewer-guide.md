# Reviewing similar-product groups (electro-parts 0.6.6)

You review groups of product listings from five Japanese electronics shops. Shop labels: 秋月電子, スイッチサイエンス, M5Stack公式, KSY, せんごく. In each group, listings from different shops have **different** model codes of their own, but their names share a rare model-like word and their codes share a stem (`U078-M12` and `U078-USB` share `U078`). Each such pair is a **lead**: maybe two variants of one product line (another version, lens, header pitch, capacity, with or without accessories) that a shopper could pick instead of each other.

Your job: decide, in natural language from the given fields only, which listings form a **family of similar products**, and dismiss every lead that does not belong in one. Do not browse the web. `スイッチサイエンス` as `maker` on a スイッチサイエンス row only means the shop resells it.

## Input

The input file is a JSON array of groups. Each group has:
- `listings`: `key`, `label`, `name`, `model`, `maker`, `vendor`, `ownCodes`, `url`, and for M5Stack公式 pages `variants` (`offerId`, `sku`, `name`).
- `leads`: the pairs to decide (`products`: two keys, `stems`: the shared code stems).
- `knownLinks`: relations already reviewed between listings of the group. `same_product` means the two listings sell the same product.
- `existingFamilies`: families some listings already belong to (do not repeat them).

## What belongs in a family

A family is a set of listings that are **pairwise** realistic alternatives for the same job: the same kind of product with the same purpose, differing in version or revision (`K010` vs `K010-V11`), generation, sensor or lens (`OV2640` vs `PY260`, M12 lens vs standard), header pin pitch, capacity, connector, colour, or sold alone vs with accessories (the same device with or without a watch kit).

Every pair of members from different shops whose `variant` differs becomes a similar-product relation, so every member must be comparable with every other member. If one member only fits some of them, make two smaller families or leave it out.

Not similar (dismiss as `different`):
- different product types that share a code stem: a module vs a board, kit, case, cable, tyre or other accessory made for it; an evaluation board vs a USB interface board for another use;
- mating halves (plug vs socket, male vs female);
- boards or accessories for different hosts (a base for Core2 vs one for CoreS3), unless they are the same function and the host is only one feature among others;
- a bundle whose main product differs (a robot kit vs the controller sold alone).

Possibly the same product (dismiss as `identity`): the codes differ only in how they are written (`HQ_SC0861` vs `SC0861`), or one side's revision is unstated so the two may be the same item. These are left to an identity review; do not put such a pair in one family with different variants.

## Output

Write a JSON array to the output file named in your task, one object per input group, in input order:

```json
{"group": 1,
 "families": [{"label": "UnitV2 AIカメラ", "purpose": "単体でAI画像認識を実行するカメラユニット",
   "members": [{"key": "switch-science/7536", "variant": "U078-M12", "features": {"型番": "U078-M12", "レンズ": "M12交換レンズ"}, "offerId": null}]}],
 "dismissed": [{"products": ["switch-science/6212", "sengoku/EEHD-5WT5"], "decision": "different", "evidence": "類似候補（共通語幹: U078）。..."}],
 "notes": ""}
```

Rules, all checked by a script:
1. Every lead of the group appears exactly once: either both of its listings are members of one of your families, or it is in `dismissed` (with `products` copied in the same order). Never both.
2. Members of one family: at least 2 shops. Listings linked by a `same_product` known link must have the same `variant` string, and identical `features`.
3. `features`: every member of a family has the same keys. Values are concrete facts read from the fields (name, model, codes, variant names), e.g. 型番, 版, レンズ, センサー, ピン間隔, 付属品. Never 「記載なし」, 「不明」 or a guess. Members with different `variant` must differ in at least one value; members with the same `variant` have identical values. A `型番` key holding the maker's code (without a shop prefix such as `M5STACK-`) is a concrete value.
4. `offerId`: for a listing with `variants`, the `offerId` of the variant matching that member (its `sku` should carry the member's code); `null` for listings without `variants`. If no variant matches, leave the listing out and dismiss its leads.
5. `label` and `purpose`: Japanese. `label` names the product line; `purpose` says the common use.
6. `evidence` (dismissals): Japanese, at least 40 characters, starting 「類似候補（共通語幹: <stems joined with 、>）。」, then both products by shop label and quoted name, then the reason.

Judge every group yourself; do not write a script that decides by rules. Your final message is only: families / members / dismissed different / dismissed identity.
