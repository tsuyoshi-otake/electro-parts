# Classifying cross-shop product pairs (precision sample)

Each input line is one pair of product listings from two Japanese electronics shops (`products[0]`, `products[1]`). Both listings carry model codes of their own, and the codes differ, so code matching left them apart. Their codes share a stem (`stem`: the code or its prefix at a `-`), but their names share no rare model-like word. Decide from the given fields only (name, codes, maker, url text, stem). Do not browse the web.

Shop labels: 秋月電子, スイッチサイエンス, M5Stack公式, KSY, せんごく. スイッチサイエンス as `maker` on a スイッチサイエンス row means the shop resells it and says nothing about the real maker.

## Verdicts

- `same`: the same maker product (same model, revision and configuration), only written differently.
- `similar`: a different product that a buyer could realistically pick instead of the other for the same job: same kind and purpose, differing in version or generation, capacity, package, length, colour, rank, interface (I2C vs SPI breakout of the same sensor type), with or without headers, and so on. You must be able to name the shared purpose and at least one concrete difference from the fields.
- `different`: not a realistic substitute. Includes:
  - different product types that only share a chip, standard, series or a word (a bare chip vs a module, kit or board built around it; a sensor module vs a dev board that carries the sensor);
  - a product vs its accessory, case, cable, adapter, bracket or replacement part;
  - mating halves (plug vs socket, male vs female header or connector, pin vs housing);
  - boards or accessories made for different hosts (a bottom base for CoreS3 vs one for Core2; a HAT for Raspberry Pi vs a shield for Arduino) — each fits only its own host;
  - a single item vs a set or kit that contains it plus other things.
- `unknown`: the fields cannot settle it.

Be strict: a shared word or chip name is not similarity. When in doubt between `similar` and `different`, ask "would someone shopping for product A accept product B as an alternative for the same job?"

## Output

Write one JSON line per input line, in input order, to the output file named in your task:

```json
{"n":1,"id":"<copied>","verdict":"same|similar|different|unknown","reason":"<one Japanese sentence: the shared purpose and the concrete difference, or why not>"}
```

Your final message is only the counts: same / similar / different / unknown.
