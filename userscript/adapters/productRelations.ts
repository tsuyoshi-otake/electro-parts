// Curated initial cross-store catalogue. See docs/adr/0017-cross-store-comparisons.md.
// No snapshot prices or stock are embedded; the userscript reads published histories.
import type { ProductRelation } from '../core/relations.ts';

export const STORE_LABELS: Readonly<Record<string, string>> = {
  'akizuki': '秋月電子',
  'switch-science': 'スイッチサイエンス',
};

export const PRODUCT_RELATIONS: readonly ProductRelation[] = [
  {
    "id": "a106680-s4453",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "106680",
        "name": "L298N使用 2Aデュアルモーターコントローラー",
        "modelNumber": "DRI0002",
        "url": "https://akizukidenshi.com/catalog/g/g106680/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "L298N使用 2Aデュアルモーターコントローラー"
        ],
        "expectedModels": [
          "DRI0002"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "4453",
        "name": "《お取り寄せ商品》MDV 2x2A DC Motor Controller (L298N)",
        "modelNumber": "DRI0002",
        "url": "https://www.switch-science.com/products/4453",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "《お取り寄せ商品》MDV 2x2A DC Motor Controller (L298N)"
        ],
        "expectedModels": [
          "DRI0002",
          "4453"
        ]
      }
    ],
    "evidence": "modelNumber DRI0002が一致し、両方の商品名がL298Nの2x2AデュアルDCモーターコントローラーを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber DRI0002が一致し、両方の商品名がL298Nの2x2AデュアルDCモーターコントローラーを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a106875-s1607",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "106875",
        "name": "メモリー液晶(LS027B4DH01)評価キット",
        "modelNumber": "AE-MEMLCD",
        "url": "https://akizukidenshi.com/catalog/g/g106875/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "メモリー液晶(LS027B4DH01)評価キット"
        ],
        "expectedModels": [
          "AE-MEMLCD"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1607",
        "name": "モノクロHR-TFTメモリ液晶モジュール LS027B4DH01--販売終了",
        "modelNumber": "P-04944",
        "url": "https://www.switch-science.com/products/1607",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "モノクロHR-TFTメモリ液晶モジュール LS027B4DH01--販売終了"
        ],
        "expectedModels": [
          "P-04944",
          "1607"
        ]
      }
    ],
    "evidence": "両方の名称にLS027B4DH01メモリー液晶が現れる一方、秋月はAE-MEMLCD評価キット、SSはP-04944の液晶モジュールで、評価キットの同梱品とモジュール単体との差分が記録から分からず、同一商品か構成違いかを確定できない。",
    "differences": [],
    "missingEvidence": [
      "評価キットに含まれる部品一覧",
      "モジュール単体との構成差"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "insufficient_evidence",
      "originalReason": "両方の名称にLS027B4DH01メモリー液晶が現れる一方、秋月はAE-MEMLCD評価キット、SSはP-04944の液晶モジュールで、評価キットの同梱品とモジュール単体との差分が記録から分からず、同一商品か構成違いかを確定できない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a107007-s2608",
    "kind": "similar_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "107007",
        "name": "超小型グラフィックLCDピッチ変換キット",
        "modelNumber": "AE-AQM1248",
        "url": "https://akizukidenshi.com/catalog/g/g107007/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "超小型グラフィックLCDピッチ変換キット"
        ],
        "expectedModels": [
          "AE-AQM1248"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "2608",
        "name": "AQM1248A小型グラフィック液晶ボード",
        "modelNumber": "SSCI-026086",
        "url": "https://www.switch-science.com/products/2608",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "AQM1248A小型グラフィック液晶ボード"
        ],
        "expectedModels": [
          "SSCI-026086",
          "2608"
        ]
      }
    ],
    "evidence": "両方の名称にAQM1248A系小型グラフィック液晶が現れるが、秋月はAE-AQM1248ピッチ変換キット、SSはSSCI-026086液晶ボードで型番と構成が一致しないため、同一完成品とは確定できない。",
    "differences": [
      "両方の名称にAQM1248A系小型グラフィック液晶が現れるが、秋月はAE-AQM1248ピッチ変換キット、SSはSSCI-026086液晶ボードで型番と構成が一致しないため、同一完成品とは確定できない。"
    ],
    "missingEvidence": [
      "ピッチ変換キットと液晶ボードの構成部品・実装状態",
      "両記録を結ぶメーカー型番"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_configuration",
      "originalReason": "両方の名称にAQM1248A系小型グラフィック液晶が現れるが、秋月はAE-AQM1248ピッチ変換キット、SSはSSCI-026086液晶ボードで型番と構成が一致しないため、同一完成品とは確定できない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a107381-s837",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "107381",
        "name": "Arduino Mega2560 Rev3",
        "modelNumber": "A000067",
        "url": "https://akizukidenshi.com/catalog/g/g107381/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Mega2560 Rev3"
        ],
        "expectedModels": [
          "A000067"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "837",
        "name": "Arduino Mega 2560 R3",
        "modelNumber": "A000067",
        "url": "https://www.switch-science.com/products/837",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Mega 2560 R3"
        ],
        "expectedModels": [
          "A000067",
          "837"
        ]
      }
    ],
    "evidence": "modelNumber=A000067とArduino Mega 2560 R3の名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=A000067とArduino Mega 2560 R3の名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a107383-s1073",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "107383",
        "name": "Arduino Uno SMD Rev3",
        "modelNumber": "A000073",
        "url": "https://akizukidenshi.com/catalog/g/g107383/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Uno SMD Rev3"
        ],
        "expectedModels": [
          "A000073"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1073",
        "name": "Arduino Uno SMD R3",
        "modelNumber": "A000073",
        "url": "https://www.switch-science.com/products/1073",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Uno SMD R3"
        ],
        "expectedModels": [
          "A000073",
          "1073"
        ]
      }
    ],
    "evidence": "modelNumber=A000073、Arduino Uno SMD R3/Rev3の名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=A000073、Arduino Uno SMD R3/Rev3の名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a107385-s789",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "107385",
        "name": "Arduino Uno Rev3",
        "modelNumber": "A000066",
        "url": "https://akizukidenshi.com/catalog/g/g107385/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Uno Rev3"
        ],
        "expectedModels": [
          "A000066"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "789",
        "name": "Arduino Uno R3",
        "modelNumber": "A000066",
        "url": "https://www.switch-science.com/products/789",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Uno R3"
        ],
        "expectedModels": [
          "A000066",
          "789"
        ]
      }
    ],
    "evidence": "modelNumber=A000066およびArduino Uno R3の名称が一致し、両方とも完成ボードとして記録されている。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=A000066およびArduino Uno R3の名称が一致し、両方とも完成ボードとして記録されている。"
    },
    "pricePolicy": null
  },
  {
    "id": "a107558-s2336",
    "kind": "similar_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "107558",
        "name": "スペーサー M3 5mm TP-5SM",
        "modelNumber": "TP-5SM",
        "url": "https://akizukidenshi.com/catalog/g/g107558/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "スペーサー M3 5mm TP-5SM"
        ],
        "expectedModels": [
          "TP-5SM"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "2336",
        "name": "M3×6mm両側メススペーサ・M3×5mmネジ 各4本セット",
        "modelNumber": "ILOGIC-009",
        "url": "https://www.switch-science.com/products/2336",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M3×6mm両側メススペーサ・M3×5mmネジ 各4本セット"
        ],
        "expectedModels": [
          "ILOGIC-009",
          "2336"
        ]
      }
    ],
    "evidence": "M3・5mmという一部寸法は近いが、秋月はTP-5SMの単体スペーサー、SSはM3×6mm両側メススペーサとM3×5mmねじ各4本のセットで、寸法・数量・構成が異なる。",
    "differences": [
      "M3・5mmという一部寸法は近いが、秋月はTP-5SMの単体スペーサー、SSはM3×6mm両側メススペーサとM3×5mmねじ各4本のセットで、寸法・数量・構成が異なる。"
    ],
    "missingEvidence": [
      "スペーサーの材質・ねじ形状、両側メス仕様の有無、同一メーカー根拠"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_configuration",
      "originalReason": "M3・5mmという一部寸法は近いが、秋月はTP-5SMの単体スペーサー、SSはM3×6mm両側メススペーサとM3×5mmねじ各4本のセットで、寸法・数量・構成が異なる。"
    },
    "pricePolicy": null
  },
  {
    "id": "a107607-s3259",
    "kind": "similar_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "107607",
        "name": "USBケーブル USB2.0 Aオス-マイクロBオス 1.5m A-microB",
        "modelNumber": "USBcable A-microB",
        "url": "https://akizukidenshi.com/catalog/g/g107607/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "USBケーブル USB2.0 Aオス-マイクロBオス 1.5m A-microB"
        ],
        "expectedModels": [
          "USBcable A-microB"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "3259",
        "name": "長めのUSB2.0ケーブル（A-microBタイプ）1.8m--販売終了",
        "modelNumber": "C165-06-B1.8",
        "url": "https://www.switch-science.com/products/3259",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "長めのUSB2.0ケーブル（A-microBタイプ）1.8m--販売終了"
        ],
        "expectedModels": [
          "C165-06-B1.8",
          "3259"
        ]
      }
    ],
    "evidence": "双方とも USB2.0 A-microB ケーブルだが、秋月は1.5m、SSは1.8mで長さが異なる。",
    "differences": [
      "双方とも USB2.0 A-microB ケーブルだが、秋月は1.5m、SSは1.8mで長さが異なる。"
    ],
    "missingEvidence": [
      "同一メーカー製品かどうかの共通コード、販売数量単位"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_configuration",
      "originalReason": "双方とも USB2.0 A-microB ケーブルだが、秋月は1.5m、SSは1.8mで長さが異なる。"
    },
    "pricePolicy": null
  },
  {
    "id": "a109059-s2554",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "109059",
        "name": "Arduino Nano",
        "modelNumber": "A000005",
        "url": "https://akizukidenshi.com/catalog/g/g109059/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Nano"
        ],
        "expectedModels": [
          "A000005"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "2554",
        "name": "Arduino Nano",
        "modelNumber": "A000005",
        "url": "https://www.switch-science.com/products/2554",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Nano"
        ],
        "expectedModels": [
          "A000005",
          "2554"
        ]
      }
    ],
    "evidence": "両方のmodelNumberとmanufacturerProductCodeがA000005で、名称もArduino Nanoで一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "両方のmodelNumberとmanufacturerProductCodeがA000005で、名称もArduino Nanoで一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a109283-s1629",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "109283",
        "name": "Grove RGBバックライト液晶モジュール",
        "modelNumber": "104030001",
        "url": "https://akizukidenshi.com/catalog/g/g109283/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Grove RGBバックライト液晶モジュール"
        ],
        "expectedModels": [
          "104030001"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1629",
        "name": "GROVE - RGBバックライト液晶モジュール",
        "modelNumber": "104030001",
        "url": "https://www.switch-science.com/products/1629",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "GROVE - RGBバックライト液晶モジュール"
        ],
        "expectedModels": [
          "104030001",
          "1629"
        ]
      }
    ],
    "evidence": "modelNumber 104030001が一致し、両方の商品名がGrove RGBバックライト液晶モジュールを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber 104030001が一致し、両方の商品名がGrove RGBバックライト液晶モジュールを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a109485-s1514",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "109485",
        "name": "10bit 8ch ADコンバーター MCP3008-I/P",
        "modelNumber": "MCP3008-I/P",
        "url": "https://akizukidenshi.com/catalog/g/g109485/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "10bit 8ch ADコンバーター MCP3008-I/P"
        ],
        "expectedModels": [
          "MCP3008-I/P"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1514",
        "name": "MCP3008 8チャネル 10ビット A/Dコンバータ(SPI接続)",
        "modelNumber": "MCP3008-I/P",
        "url": "https://www.switch-science.com/products/1514",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "MCP3008 8チャネル 10ビット A/Dコンバータ(SPI接続)"
        ],
        "expectedModels": [
          "MCP3008-I/P",
          "1514"
        ]
      }
    ],
    "evidence": "型番 MCP3008-I/P、10ビット8チャネル A/Dコンバーターという機能、Microchip製品コードが一致する。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 MCP3008-I/P、10ビット8チャネル A/Dコンバーターという機能、Microchip製品コードが一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a112366-s3499",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "112366",
        "name": "ブレッドボード 6穴版 EIC-3901",
        "modelNumber": "0165-40-4-39010",
        "url": "https://akizukidenshi.com/catalog/g/g112366/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "ブレッドボード 6穴版 EIC-3901"
        ],
        "expectedModels": [
          "0165-40-4-39010"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "3499",
        "name": "幅が広いブレッドボード",
        "modelNumber": "0165-42-4-39010",
        "url": "https://www.switch-science.com/products/3499",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "幅が広いブレッドボード"
        ],
        "expectedModels": [
          "0165-42-4-39010",
          "3499"
        ]
      }
    ],
    "evidence": "両方とも E-LINE 系のブレッドボード候補だが、型番が 0165-40-4-39010 と 0165-42-4-39010 で異なり、秋月は6穴版、SSは幅広と記載されるため構成差または別品の切り分けができない。",
    "differences": [],
    "missingEvidence": [
      "穴数・寸法の完全な一致、型番差の意味、SS側の販売数量単位"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "insufficient_evidence",
      "originalReason": "両方とも E-LINE 系のブレッドボード候補だが、型番が 0165-40-4-39010 と 0165-42-4-39010 で異なり、秋月は6穴版、SSは幅広と記載されるため構成差または別品の切り分けができない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a112633-s2090",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "112633",
        "name": "PHコネクター ベース付ポスト サイド型 2P S2B-PH-K-S",
        "modelNumber": "S2B-PH-K-S(LF)(SN)",
        "url": "https://akizukidenshi.com/catalog/g/g112633/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "PHコネクター ベース付ポスト サイド型 2P S2B-PH-K-S"
        ],
        "expectedModels": [
          "S2B-PH-K-S(LF)(SN)"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "2090",
        "name": "JST製2ピンPHコネクタ用ソケット",
        "modelNumber": "S2B-PH-K-S",
        "url": "https://www.switch-science.com/products/2090",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "JST製2ピンPHコネクタ用ソケット"
        ],
        "expectedModels": [
          "S2B-PH-K-S",
          "2090"
        ]
      }
    ],
    "evidence": "末尾仕様の省略は実物の相違を証明しないため、構成違いの断定を保留する。",
    "differences": [],
    "missingEvidence": [
      "SS側でLF/SN末尾仕様とコネクタの販売数量を確認できない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_configuration",
      "originalReason": "基本型番 S2B-PH-K-S とJST PH 2ピンソケットは一致するが、秋月には (LF)(SN) の末尾仕様があり、SS側のコードは末尾なし。鉛フリー／めっき等の構成差を解消できない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a113289-s3752",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "113289",
        "name": "Wi-Fiモジュール ESP-WROOM-02D",
        "modelNumber": "ESP-WROOM-02D",
        "url": "https://akizukidenshi.com/catalog/g/g113289/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Wi-Fiモジュール ESP-WROOM-02D"
        ],
        "expectedModels": [
          "ESP-WROOM-02D"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "3752",
        "name": "ESP-WROOM-02D Wi-Fiモジュール--在庫限り",
        "modelNumber": "ESP-WROOM-02D",
        "url": "https://www.switch-science.com/products/3752",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "ESP-WROOM-02D Wi-Fiモジュール--在庫限り"
        ],
        "expectedModels": [
          "ESP-WROOM-02D",
          "3752"
        ]
      }
    ],
    "evidence": "modelNumberが一致し、両方の商品名がESP-WROOM-02D Wi-Fiモジュールを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumberが一致し、両方の商品名がESP-WROOM-02D Wi-Fiモジュールを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a113428-s1167",
    "kind": "similar_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "113428",
        "name": "USB OTGケーブル TypeC 10cm",
        "modelNumber": "USB2.0_TYPE-C_OTG_CABLE_0.1m",
        "url": "https://akizukidenshi.com/catalog/g/g113428/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "USB OTGケーブル TypeC 10cm"
        ],
        "expectedModels": [
          "USB2.0_TYPE-C_OTG_CABLE_0.1m"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1167",
        "name": "USB OTG ケーブル(Aメス-microA)10cm",
        "modelNumber": "CAB-11604",
        "url": "https://www.switch-science.com/products/1167",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "USB OTG ケーブル(Aメス-microA)10cm"
        ],
        "expectedModels": [
          "CAB-11604",
          "1167"
        ]
      }
    ],
    "evidence": "長さは双方10cmだが、秋月はType-C OTGケーブル、SSはAメス-microA OTGケーブルでコネクタ構成が異なる。",
    "differences": [
      "長さは双方10cmだが、秋月はType-C OTGケーブル、SSはAメス-microA OTGケーブルでコネクタ構成が異なる。"
    ],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_product",
      "originalReason": "長さは双方10cmだが、秋月はType-C OTGケーブル、SSはAメス-microA OTGケーブルでコネクタ構成が異なる。"
    },
    "pricePolicy": null
  },
  {
    "id": "a113430-s1167",
    "kind": "similar_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "113430",
        "name": "USB OTGケーブル microB 10cm",
        "modelNumber": "USB2.0_microB_OTG_CABLE_0.1m",
        "url": "https://akizukidenshi.com/catalog/g/g113430/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "USB OTGケーブル microB 10cm"
        ],
        "expectedModels": [
          "USB2.0_microB_OTG_CABLE_0.1m"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1167",
        "name": "USB OTG ケーブル(Aメス-microA)10cm",
        "modelNumber": "CAB-11604",
        "url": "https://www.switch-science.com/products/1167",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "USB OTG ケーブル(Aメス-microA)10cm"
        ],
        "expectedModels": [
          "CAB-11604",
          "1167"
        ]
      }
    ],
    "evidence": "秋月はmicroB側のOTGケーブル、SSはmicroA側のOTGケーブルで、同じ10cmでも端子仕様が異なる。",
    "differences": [
      "秋月はmicroB側のOTGケーブル、SSはmicroA側のOTGケーブルで、同じ10cmでも端子仕様が異なる。"
    ],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_product",
      "originalReason": "秋月はmicroB側のOTGケーブル、SSはmicroA側のOTGケーブルで、同じ10cmでも端子仕様が異なる。"
    },
    "pricePolicy": null
  },
  {
    "id": "a114651-s4089",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "114651",
        "name": "XBeeモジュール S2C 802.15.4 ワイヤアンテナ XB24CAWIT-001",
        "modelNumber": "XB24CAWIT-001",
        "url": "https://akizukidenshi.com/catalog/g/g114651/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "XBeeモジュール S2C 802.15.4 ワイヤアンテナ XB24CAWIT-001"
        ],
        "expectedModels": [
          "XB24CAWIT-001"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "4089",
        "name": "XBee S2C / ワイヤアンテナ型",
        "modelNumber": "XB24CAWIT-001",
        "url": "https://www.switch-science.com/products/4089",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "XBee S2C / ワイヤアンテナ型"
        ],
        "expectedModels": [
          "XB24CAWIT-001",
          "4089"
        ]
      }
    ],
    "evidence": "modelNumber XB24CAWIT-001が一致し、両方の商品名がXBee S2Cワイヤアンテナ型を示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber XB24CAWIT-001が一致し、両方の商品名がXBee S2Cワイヤアンテナ型を示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a114839-s5681",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "114839",
        "name": "Raspberry Pi 4 Model B 2GB(ラズベリーパイフォーモデルビー)",
        "modelNumber": "SC0193(9)",
        "url": "https://akizukidenshi.com/catalog/g/g114839/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi 4 Model B 2GB(ラズベリーパイフォーモデルビー)"
        ],
        "expectedModels": [
          "SC0193(9)"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "5681",
        "name": "Raspberry Pi 4 Model B / 2GB",
        "modelNumber": "SC0193(9)",
        "url": "https://www.switch-science.com/products/5681",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi 4 Model B / 2GB"
        ],
        "expectedModels": [
          "SC0193(9)",
          "5681"
        ]
      }
    ],
    "evidence": "modelNumber=SC0193(9)が一致し、両方ともRaspberry Pi 4 Model B 2GBと記録されている。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=SC0193(9)が一致し、両方ともRaspberry Pi 4 Model B 2GBと記録されている。"
    },
    "pricePolicy": null
  },
  {
    "id": "a115200-s8648",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "115200",
        "name": "Arduino Nano Every (半完成品セミキット)",
        "modelNumber": "ABX00028",
        "url": "https://akizukidenshi.com/catalog/g/g115200/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Nano Every (半完成品セミキット)"
        ],
        "expectedModels": [
          "ABX00028"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "8648",
        "name": "Arduino Nano Every（ピンヘッダ未実装）",
        "modelNumber": "ABX00028",
        "url": "https://www.switch-science.com/products/8648",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Nano Every（ピンヘッダ未実装）"
        ],
        "expectedModels": [
          "ABX00028",
          "8648"
        ]
      }
    ],
    "evidence": "半完成品セミキットとピンヘッダ未実装は同じ状態を指す可能性もあり、相違の断定を保留する。",
    "differences": [],
    "missingEvidence": [
      "秋月のセミキットに含まれる部品とSS未実装品の付属品内訳"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_configuration",
      "originalReason": "modelNumber=ABX00028は一致するが、秋月は半完成品セミキット、SSはピンヘッダ未実装品と記載しており、部品/組立状態の構成が異なる可能性がある。"
    },
    "pricePolicy": null
  },
  {
    "id": "a116132-s6900",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "116132",
        "name": "Raspberry Pi Pico ラズベリーパイピコ",
        "modelNumber": "SC0915",
        "url": "https://akizukidenshi.com/catalog/g/g116132/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi Pico ラズベリーパイピコ"
        ],
        "expectedModels": [
          "SC0915"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "6900",
        "name": "Raspberry Pi Pico",
        "modelNumber": "SC0915",
        "url": "https://www.switch-science.com/products/6900",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi Pico"
        ],
        "expectedModels": [
          "SC0915",
          "6900"
        ]
      }
    ],
    "evidence": "modelNumber=SC0915とRaspberry Pi Picoの名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=SC0915とRaspberry Pi Picoの名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a116170-s11050",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "116170",
        "name": "M5Stack Core2 IoT開発キット",
        "modelNumber": "M5STACK-K010-V13",
        "url": "https://akizukidenshi.com/catalog/g/g116170/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack Core2 IoT開発キット"
        ],
        "expectedModels": [
          "M5STACK-K010-V13"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "11050",
        "name": "M5Stack Core2 v1.3",
        "modelNumber": "K010-V13",
        "url": "https://www.switch-science.com/products/11050",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack Core2 v1.3"
        ],
        "expectedModels": [
          "K010-V13",
          "11050"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 K010-V13 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a116406-s9698",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "116406",
        "name": "圧力センサー MF01A-N-221-A04",
        "modelNumber": "MF01A-N-221-A04",
        "url": "https://akizukidenshi.com/catalog/g/g116406/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "圧力センサー MF01A-N-221-A04"
        ],
        "expectedModels": [
          "MF01A-N-221-A04"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9698",
        "name": "感圧センサ（円形・小）",
        "modelNumber": "MF01A-N-221-A04",
        "url": "https://www.switch-science.com/products/9698",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "感圧センサ（円形・小）"
        ],
        "expectedModels": [
          "MF01A-N-221-A04",
          "9698"
        ]
      }
    ],
    "evidence": "modelNumber MF01A-N-221-A04が一致し、秋月の圧力センサーとSSのALPHA感圧センサの型番が同一のため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber MF01A-N-221-A04が一致し、秋月の圧力センサーとSSのALPHA感圧センサの型番が同一のため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a116410-s6125",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "116410",
        "name": "曲げセンサー MB060-N-221-A02",
        "modelNumber": "MB060-N-221-A02",
        "url": "https://akizukidenshi.com/catalog/g/g116410/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "曲げセンサー MB060-N-221-A02"
        ],
        "expectedModels": [
          "MB060-N-221-A02"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "6125",
        "name": "曲げセンサ（60mm）",
        "modelNumber": "MB060-N-221-A02",
        "url": "https://www.switch-science.com/products/6125",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "曲げセンサ（60mm）"
        ],
        "expectedModels": [
          "MB060-N-221-A02",
          "6125"
        ]
      }
    ],
    "evidence": "modelNumber MB060-N-221-A02が一致し、両方の商品名が60mm曲げセンサーを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber MB060-N-221-A02が一致し、両方の商品名が60mm曲げセンサーを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a116411-s6126",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "116411",
        "name": "曲げセンサー MB090-N-221-A02",
        "modelNumber": "MB090-N-221-A02",
        "url": "https://akizukidenshi.com/catalog/g/g116411/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "曲げセンサー MB090-N-221-A02"
        ],
        "expectedModels": [
          "MB090-N-221-A02"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "6126",
        "name": "曲げセンサ（90mm）",
        "modelNumber": "MB090-N-221-A02",
        "url": "https://www.switch-science.com/products/6126",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "曲げセンサ（90mm）"
        ],
        "expectedModels": [
          "MB090-N-221-A02",
          "6126"
        ]
      }
    ],
    "evidence": "modelNumber MB090-N-221-A02が一致し、両方の商品名が90mm曲げセンサーを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber MB090-N-221-A02が一致し、両方の商品名が90mm曲げセンサーを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a116556-s7384",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "116556",
        "name": "Arduino MKR WiFi 1010",
        "modelNumber": "ABX00023",
        "url": "https://akizukidenshi.com/catalog/g/g116556/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino MKR WiFi 1010"
        ],
        "expectedModels": [
          "ABX00023"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7384",
        "name": "Arduino MKR WiFi 1010",
        "modelNumber": "ABX00023",
        "url": "https://www.switch-science.com/products/7384",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino MKR WiFi 1010"
        ],
        "expectedModels": [
          "ABX00023",
          "7384"
        ]
      }
    ],
    "evidence": "modelNumber=ABX00023およびArduino MKR WiFi 1010の名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=ABX00023およびArduino MKR WiFi 1010の名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a116777-s7512",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "116777",
        "name": "Mini vibration motor 2.0mm",
        "modelNumber": "316040001",
        "url": "https://akizukidenshi.com/catalog/g/g116777/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Mini vibration motor 2.0mm"
        ],
        "expectedModels": [
          "316040001"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7512",
        "name": "ミニ振動モーター 2.0 mm",
        "modelNumber": "316040001",
        "url": "https://www.switch-science.com/products/7512",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "ミニ振動モーター 2.0 mm"
        ],
        "expectedModels": [
          "316040001",
          "7512"
        ]
      }
    ],
    "evidence": "型番 316040001 と「ミニ振動モーター 2.0 mm」の商品名が一致し、メーカーも Seeed と記録されている。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 316040001 と「ミニ振動モーター 2.0 mm」の商品名が一致し、メーカーも Seeed と記録されている。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117016-s1035",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117016",
        "name": "USBケーブル USB2.0 Type-Aオス⇔マイクロBオス 0.5m A-microB",
        "modelNumber": "LDUC1231-0.5m",
        "url": "https://akizukidenshi.com/catalog/g/g117016/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "USBケーブル USB2.0 Type-Aオス⇔マイクロBオス 0.5m A-microB"
        ],
        "expectedModels": [
          "LDUC1231-0.5m"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1035",
        "name": "USB2.0ケーブル(A-microBタイプ)50cm",
        "modelNumber": "C165-06-B0.5",
        "url": "https://www.switch-science.com/products/1035",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "USB2.0ケーブル(A-microBタイプ)50cm"
        ],
        "expectedModels": [
          "C165-06-B0.5",
          "1035"
        ]
      }
    ],
    "evidence": "USB2.0 A-microB 50cmという仕様は一致するが、秋月側は汎用品コード、SS側は C165-06-B0.5 でメーカー製品同一性を示す共通コードがない。",
    "differences": [],
    "missingEvidence": [
      "メーカー／製品コードの共通根拠、SS側の販売数量単位"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "insufficient_evidence",
      "originalReason": "USB2.0 A-microB 50cmという仕様は一致するが、秋月側は汎用品コード、SS側は C165-06-B0.5 でメーカー製品同一性を示す共通コードがない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117017-s3792",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117017",
        "name": "USBケーブル USB2.0 Type-Aオス⇔Type-Cオス 0.5m",
        "modelNumber": "LDUC2611-0.5m",
        "url": "https://akizukidenshi.com/catalog/g/g117017/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "USBケーブル USB2.0 Type-Aオス⇔Type-Cオス 0.5m"
        ],
        "expectedModels": [
          "LDUC2611-0.5m"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "3792",
        "name": "USB2.0ケーブル（A-Type Cタイプ）50cm",
        "modelNumber": "C160-U32-CMAMN-B0.5",
        "url": "https://www.switch-science.com/products/3792",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "USB2.0ケーブル（A-Type Cタイプ）50cm"
        ],
        "expectedModels": [
          "C160-U32-CMAMN-B0.5",
          "3792"
        ]
      }
    ],
    "evidence": "USB2.0 A-Type-C 50cmという仕様は近いが、秋月は LDUC2611、SSは C160-U32-CMAMN-B0.5 で、一般仕様だけでは同一メーカー製品といえない。",
    "differences": [],
    "missingEvidence": [
      "メーカー／製品コードの共通根拠、SS側の販売数量単位"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "insufficient_evidence",
      "originalReason": "USB2.0 A-Type-C 50cmという仕様は近いが、秋月は LDUC2611、SSは C160-U32-CMAMN-B0.5 で、一般仕様だけでは同一メーカー製品といえない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117205-s6784",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117205",
        "name": "M5Stack Core2 for AWS - ESP32 IoT開発キット",
        "modelNumber": "M5STACK-K010-AWS",
        "url": "https://akizukidenshi.com/catalog/g/g117205/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack Core2 for AWS - ESP32 IoT開発キット"
        ],
        "expectedModels": [
          "M5STACK-K010-AWS"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "6784",
        "name": "M5Stack Core2 for AWS - ESP32 IoT開発キット--在庫限り",
        "modelNumber": "K010-AWS",
        "url": "https://www.switch-science.com/products/6784",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack Core2 for AWS - ESP32 IoT開発キット--在庫限り"
        ],
        "expectedModels": [
          "K010-AWS",
          "6784"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 K010-AWS と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117207-s7160",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117207",
        "name": "M5Stack UnitV2 AI カメラ(SSD202D)",
        "modelNumber": "M5STACK-U078-D",
        "url": "https://akizukidenshi.com/catalog/g/g117207/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack UnitV2 AI カメラ(SSD202D)"
        ],
        "expectedModels": [
          "M5STACK-U078-D"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7160",
        "name": "M5Stack UnitV2 AI カメラ（SSD202D）",
        "modelNumber": "U078-D",
        "url": "https://www.switch-science.com/products/7160",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack UnitV2 AI カメラ（SSD202D）"
        ],
        "expectedModels": [
          "U078-D",
          "7160"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 U078-D と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117208-s7483",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117208",
        "name": "M5Stack Tough ESP32 IoT開発キット",
        "modelNumber": "M5STACK-K034",
        "url": "https://akizukidenshi.com/catalog/g/g117208/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack Tough ESP32 IoT開発キット"
        ],
        "expectedModels": [
          "M5STACK-K034"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7483",
        "name": "M5Stack Tough ESP32 IoT開発キット",
        "modelNumber": "K034",
        "url": "https://www.switch-science.com/products/7483",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack Tough ESP32 IoT開発キット"
        ],
        "expectedModels": [
          "K034",
          "7483"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 K034 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117209-s6262",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117209",
        "name": "ATOM Lite",
        "modelNumber": "M5STACK-C008",
        "url": "https://akizukidenshi.com/catalog/g/g117209/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "ATOM Lite"
        ],
        "expectedModels": [
          "M5STACK-C008"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "6262",
        "name": "ATOM Lite",
        "modelNumber": "C008",
        "url": "https://www.switch-science.com/products/6262",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "ATOM Lite"
        ],
        "expectedModels": [
          "C008",
          "6262"
        ]
      }
    ],
    "evidence": "2026-09-07に両店舗の商品ページを確認。C008/ATOM Liteが対応し、秋月は1個、SSの内容物はATOM Lite本体1点。単品の税込通常価格を比較（送料・数量割引を除く）。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "retailer-pages",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": {
      "label": "本体1台・税込通常価格（送料・数量割引別）",
      "units": [
        [
          "1個"
        ],
        [
          null
        ]
      ],
      "offerIds": [
        "__default__",
        "42382099284166"
      ],
      "evidence": "2026-09-07に両店舗の商品ページを確認。C008/ATOM Liteが対応し、秋月は1個、SSの内容物はATOM Lite本体1点。単品の税込通常価格を比較（送料・数量割引を除く）。",
      "verifiedAt": "2026-09-07"
    }
  },
  {
    "id": "a117210-s7360",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117210",
        "name": "M5Stamp Pico Mate",
        "modelNumber": "M5STACK-K051",
        "url": "https://akizukidenshi.com/catalog/g/g117210/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stamp Pico Mate"
        ],
        "expectedModels": [
          "M5STACK-K051"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7360",
        "name": "M5Stamp Pico Mate",
        "modelNumber": "K051",
        "url": "https://www.switch-science.com/products/7360",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stamp Pico Mate"
        ],
        "expectedModels": [
          "K051",
          "7360"
        ]
      }
    ],
    "evidence": "名称はM5Stamp Pico Mateで一致するが、秋月modelNumber=M5STACK-K051とSSのmanufacturerProductCode=K051が厳密には異なり、さらにヘッダ実装状態は秋月側に記載がないため同一構成を確定できない。",
    "differences": [],
    "missingEvidence": [
      "秋月modelNumberのM5STACK-接頭辞とSS型番K051の対応",
      "秋月側のピンヘッダ実装状態と付属品構成"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "insufficient_evidence",
      "originalReason": "名称はM5Stamp Pico Mateで一致するが、秋月modelNumber=M5STACK-K051とSSのmanufacturerProductCode=K051が厳密には異なり、さらにヘッダ実装状態は秋月側に記載がないため同一構成を確定できない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117213-s7254",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117213",
        "name": "M5Stack用温湿度気圧センサーユニット Ver.3(ENV Ⅲ)",
        "modelNumber": "M5STACK-U001-C",
        "url": "https://akizukidenshi.com/catalog/g/g117213/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack用温湿度気圧センサーユニット Ver.3(ENV Ⅲ)"
        ],
        "expectedModels": [
          "M5STACK-U001-C"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7254",
        "name": "M5Stack用温湿度気圧センサユニット Ver.3（ENV Ⅲ）",
        "modelNumber": "U001-C",
        "url": "https://www.switch-science.com/products/7254",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack用温湿度気圧センサユニット Ver.3（ENV Ⅲ）"
        ],
        "expectedModels": [
          "U001-C",
          "7254"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 U001-C と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117214-s9009",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117214",
        "name": "M5Stack FIRE IoT開発キット(PSRAM) V2.7",
        "modelNumber": "M5STACK-K007-V27",
        "url": "https://akizukidenshi.com/catalog/g/g117214/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack FIRE IoT開発キット(PSRAM) V2.7"
        ],
        "expectedModels": [
          "M5STACK-K007-V27"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9009",
        "name": "M5Stack FIRE IoT開発キット（PSRAM） V2.7",
        "modelNumber": "K007-V27",
        "url": "https://www.switch-science.com/products/9009",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack FIRE IoT開発キット（PSRAM） V2.7"
        ],
        "expectedModels": [
          "K007-V27",
          "9009"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 K007-V27 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117215-s11175",
    "kind": "similar_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117215",
        "name": "ATOM Matrix",
        "modelNumber": "M5STACK-C008-B",
        "url": "https://akizukidenshi.com/catalog/g/g117215/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "ATOM Matrix"
        ],
        "expectedModels": [
          "M5STACK-C008-B"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "11175",
        "name": "ATOM Matrix v1.1",
        "modelNumber": "C008-B-V11",
        "url": "https://www.switch-science.com/products/11175",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "ATOM Matrix v1.1"
        ],
        "expectedModels": [
          "C008-B-V11",
          "11175"
        ]
      }
    ],
    "evidence": "いずれもATOM Matrixシリーズの小型ESP32開発ボード。",
    "differences": [
      "C008-B と C008-B-V11（v1.1）のリビジョン差。互換性は未確認。"
    ],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117215-s6260",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117215",
        "name": "ATOM Matrix",
        "modelNumber": "M5STACK-C008-B",
        "url": "https://akizukidenshi.com/catalog/g/g117215/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "ATOM Matrix"
        ],
        "expectedModels": [
          "M5STACK-C008-B"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "6260",
        "name": "ATOM Matrix",
        "modelNumber": "C008-B",
        "url": "https://www.switch-science.com/products/6260",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "ATOM Matrix"
        ],
        "expectedModels": [
          "C008-B",
          "6260"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 C008-B と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117216-s7233",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117216",
        "name": "M5Stack用1.3インチ 128 x 64 OLEDディスプレイユニット",
        "modelNumber": "M5STACK-U119",
        "url": "https://akizukidenshi.com/catalog/g/g117216/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack用1.3インチ 128 x 64 OLEDディスプレイユニット"
        ],
        "expectedModels": [
          "M5STACK-U119"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7233",
        "name": "M5Stack用1.3インチ 128 x 64 OLEDディスプレイユニット",
        "modelNumber": "U119",
        "url": "https://www.switch-science.com/products/7233",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack用1.3インチ 128 x 64 OLEDディスプレイユニット"
        ],
        "expectedModels": [
          "U119",
          "7233"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 U119 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117217-s4051",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117217",
        "name": "M5Stack用光センサーユニット",
        "modelNumber": "M5STACK-LIGHT-UNIT",
        "url": "https://akizukidenshi.com/catalog/g/g117217/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack用光センサーユニット"
        ],
        "expectedModels": [
          "M5STACK-LIGHT-UNIT"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "4051",
        "name": "M5Stack用光センサユニット [U021]",
        "modelNumber": "U021",
        "url": "https://www.switch-science.com/products/4051",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack用光センサユニット [U021]"
        ],
        "expectedModels": [
          "U021",
          "4051"
        ]
      }
    ],
    "evidence": "用途と名称は光センサーユニットで対応するが、LIGHT-UNIT と U021 の別名対応は未確認。",
    "differences": [],
    "missingEvidence": [
      "型番の別名対応と構成"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117218-s3653",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117218",
        "name": "M5Stack用電池モジュール",
        "modelNumber": "M5STACK-BATTERY",
        "url": "https://akizukidenshi.com/catalog/g/g117218/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack用電池モジュール"
        ],
        "expectedModels": [
          "M5STACK-BATTERY"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "3653",
        "name": "M5Stack用電池モジュール [M002]",
        "modelNumber": "M002",
        "url": "https://www.switch-science.com/products/3653",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack用電池モジュール [M002]"
        ],
        "expectedModels": [
          "M002",
          "3653"
        ]
      }
    ],
    "evidence": "用途と名称は電池モジュールで対応するが、BATTERY と M002 の別名対応は未確認。",
    "differences": [],
    "missingEvidence": [
      "型番の別名対応と構成"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117240-s7471",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117240",
        "name": "CP2104/CH9102搭載 ESP32 ダウンローダキット",
        "modelNumber": "M5STACK-A105",
        "url": "https://akizukidenshi.com/catalog/g/g117240/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "CP2104/CH9102搭載 ESP32 ダウンローダキット"
        ],
        "expectedModels": [
          "M5STACK-A105"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7471",
        "name": "CP2104/CH9102搭載 ESP32 ダウンローダキット--在庫限り",
        "modelNumber": "A105",
        "url": "https://www.switch-science.com/products/7471",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "CP2104/CH9102搭載 ESP32 ダウンローダキット--在庫限り"
        ],
        "expectedModels": [
          "A105",
          "7471"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 A105 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117375-s3647",
    "kind": "similar_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117375",
        "name": "M5Stack BASIC V2.7",
        "modelNumber": "M5STACK-K001-V27",
        "url": "https://akizukidenshi.com/catalog/g/g117375/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack BASIC V2.7"
        ],
        "expectedModels": [
          "M5STACK-K001-V27"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "3647",
        "name": "M5Stack Basic--販売終了",
        "modelNumber": "K001",
        "url": "https://www.switch-science.com/products/3647",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack Basic--販売終了"
        ],
        "expectedModels": [
          "K001",
          "3647"
        ]
      }
    ],
    "evidence": "いずれもM5Stack Basicシリーズの開発キット。",
    "differences": [
      "K001-V27（V2.7）とK001（旧版）のリビジョン差。旧版は保存カタログで販売終了。互換性は未確認。"
    ],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117375-s9010",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117375",
        "name": "M5Stack BASIC V2.7",
        "modelNumber": "M5STACK-K001-V27",
        "url": "https://akizukidenshi.com/catalog/g/g117375/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack BASIC V2.7"
        ],
        "expectedModels": [
          "M5STACK-K001-V27"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9010",
        "name": "M5Stack Basic V2.7",
        "modelNumber": "K001-V27",
        "url": "https://www.switch-science.com/products/9010",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack Basic V2.7"
        ],
        "expectedModels": [
          "K001-V27",
          "9010"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 K001-V27 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117454-s8348",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117454",
        "name": "Seeed Studio XIAO ESP32C3",
        "modelNumber": "113991054",
        "url": "https://akizukidenshi.com/catalog/g/g117454/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Seeed Studio XIAO ESP32C3"
        ],
        "expectedModels": [
          "113991054"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "8348",
        "name": "Seeed Studio XIAO ESP32C3",
        "modelNumber": "113991054",
        "url": "https://www.switch-science.com/products/8348",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Seeed Studio XIAO ESP32C3"
        ],
        "expectedModels": [
          "113991054",
          "8348"
        ]
      }
    ],
    "evidence": "modelNumber=113991054とSeeed Studio XIAO ESP32C3の名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=113991054とSeeed Studio XIAO ESP32C3の名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117618-s8676",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117618",
        "name": "LoRa用アンテナ TX915-JKS-20",
        "modelNumber": "DTA-L9101-C",
        "url": "https://akizukidenshi.com/catalog/g/g117618/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "LoRa用アンテナ TX915-JKS-20"
        ],
        "expectedModels": [
          "DTA-L9101-C"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "8676",
        "name": "LoRa用アンテナ [TX915-JKS-20]",
        "modelNumber": "DTA-LO9002",
        "url": "https://www.switch-science.com/products/8676",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "LoRa用アンテナ [TX915-JKS-20]"
        ],
        "expectedModels": [
          "DTA-LO9002",
          "8676"
        ]
      }
    ],
    "evidence": "商品名中の TX915-JKS-20 と価格は一致するが、秋月 modelNumber=DTA-L9101-C、SS modelNumber=DTA-LO9002 と異なり、アンテナの寸法・メーカー型番の対応が確認できない。",
    "differences": [],
    "missingEvidence": [
      "DTA-L9101-C と DTA-LO9002 の対応関係、アンテナ寸法・コネクタ仕様、SS側の販売数量単位"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "insufficient_evidence",
      "originalReason": "商品名中の TX915-JKS-20 と価格は一致するが、秋月 modelNumber=DTA-L9101-C、SS modelNumber=DTA-LO9002 と異なり、アンテナの寸法・メーカー型番の対応が確認できない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117928-s5529",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117928",
        "name": "ブートローダー書込済Bluetoothモジュール MDBT50Q-1MV2",
        "modelNumber": "MDBT50Q-1MV2",
        "url": "https://akizukidenshi.com/catalog/g/g117928/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "ブートローダー書込済Bluetoothモジュール MDBT50Q-1MV2"
        ],
        "expectedModels": [
          "MDBT50Q-1MV2"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "5529",
        "name": "nRF52840 MDBT50Q-1MV2 モジュール（チップアンテナ）",
        "modelNumber": "MDBT50Q-1MV2",
        "url": "https://www.switch-science.com/products/5529",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "nRF52840 MDBT50Q-1MV2 モジュール（チップアンテナ）"
        ],
        "expectedModels": [
          "MDBT50Q-1MV2",
          "5529"
        ]
      }
    ],
    "evidence": "秋月側はブートローダー書込済と明記。SS側の書込状態が不明なので、販売状態の同一性を保留する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber MDBT50Q-1MV2が一致し、両方の商品名が同じBluetooth/nRF52840モジュールを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117956-s7894",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117956",
        "name": "M5Stamp C3U Mate",
        "modelNumber": "M5STACK-K122",
        "url": "https://akizukidenshi.com/catalog/g/g117956/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stamp C3U Mate"
        ],
        "expectedModels": [
          "M5STACK-K122"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "7894",
        "name": "M5Stamp C3U Mate",
        "modelNumber": "K122",
        "url": "https://www.switch-science.com/products/7894",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stamp C3U Mate"
        ],
        "expectedModels": [
          "K122",
          "7894"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 K122 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a117976-s9003",
    "kind": "unresolved",
    "reviewStatus": "needs_review",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117976",
        "name": "Arduino Nano 33 IoT",
        "modelNumber": "ABX00027",
        "url": "https://akizukidenshi.com/catalog/g/g117976/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Nano 33 IoT"
        ],
        "expectedModels": [
          "ABX00027"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9003",
        "name": "Arduino Nano 33 IoT（ピンヘッダ未実装）",
        "modelNumber": "ABX00027",
        "url": "https://www.switch-science.com/products/9003",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Nano 33 IoT（ピンヘッダ未実装）"
        ],
        "expectedModels": [
          "ABX00027",
          "9003"
        ]
      }
    ],
    "evidence": "型番ABX00027は一致するが、SSはピンヘッダ未実装と明記する一方、秋月の名称は実装状態を記載していないため完成品の構成を確定できない。",
    "differences": [],
    "missingEvidence": [
      "秋月側のピンヘッダ実装/未実装および付属品構成"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "insufficient_evidence",
      "originalReason": "型番ABX00027は一致するが、SSはピンヘッダ未実装と明記する一方、秋月の名称は実装状態を記載していないため完成品の構成を確定できない。"
    },
    "pricePolicy": null
  },
  {
    "id": "a117977-s9002",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "117977",
        "name": "Arduino Nano 33 IoTピンヘッダー付",
        "modelNumber": "ABX00032",
        "url": "https://akizukidenshi.com/catalog/g/g117977/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Nano 33 IoTピンヘッダー付"
        ],
        "expectedModels": [
          "ABX00032"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9002",
        "name": "Arduino Nano 33 IoT（ピンヘッダ実装済）",
        "modelNumber": "ABX00032",
        "url": "https://www.switch-science.com/products/9002",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Nano 33 IoT（ピンヘッダ実装済）"
        ],
        "expectedModels": [
          "ABX00032",
          "9002"
        ]
      }
    ],
    "evidence": "modelNumber=ABX00032が一致し、両方ともピンヘッダー実装済みArduino Nano 33 IoTと明記している。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=ABX00032が一致し、両方ともピンヘッダー実装済みArduino Nano 33 IoTと明記している。"
    },
    "pricePolicy": null
  },
  {
    "id": "a118079-s8969",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "118079",
        "name": "Seeed Studio XIAO ESP32S3 Sense",
        "modelNumber": "113991115",
        "url": "https://akizukidenshi.com/catalog/g/g118079/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Seeed Studio XIAO ESP32S3 Sense"
        ],
        "expectedModels": [
          "113991115"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "8969",
        "name": "Seeed Studio XIAO ESP32S3 Sense",
        "modelNumber": "113991115",
        "url": "https://www.switch-science.com/products/8969",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Seeed Studio XIAO ESP32S3 Sense"
        ],
        "expectedModels": [
          "113991115",
          "8969"
        ]
      }
    ],
    "evidence": "modelNumber=113991115とSeeed Studio XIAO ESP32S3 Senseの名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=113991115とSeeed Studio XIAO ESP32S3 Senseの名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a118086-s8172",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "118086",
        "name": "Raspberry Pi Pico WH(完成品)",
        "modelNumber": "SC0919",
        "url": "https://akizukidenshi.com/catalog/g/g118086/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi Pico WH(完成品)"
        ],
        "expectedModels": [
          "SC0919"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "8172",
        "name": "Raspberry Pi Pico WH",
        "modelNumber": "SC0919",
        "url": "https://www.switch-science.com/products/8172",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi Pico WH"
        ],
        "expectedModels": [
          "SC0919",
          "8172"
        ]
      }
    ],
    "evidence": "modelNumber=SC0919とPico WHの名称が一致し、秋月は完成品、SSは同型WHとしている。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=SC0919とPico WHの名称が一致し、秋月は完成品、SSは同型WHとしている。"
    },
    "pricePolicy": null
  },
  {
    "id": "a118114-s9000",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "118114",
        "name": "Arduino UNO R4 Minima",
        "modelNumber": "ABX00080",
        "url": "https://akizukidenshi.com/catalog/g/g118114/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino UNO R4 Minima"
        ],
        "expectedModels": [
          "ABX00080"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9000",
        "name": "Arduino Uno R4 Minima",
        "modelNumber": "ABX00080",
        "url": "https://www.switch-science.com/products/9000",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Uno R4 Minima"
        ],
        "expectedModels": [
          "ABX00080",
          "9000"
        ]
      }
    ],
    "evidence": "2026-09-07に両店舗の商品ページを確認。ABX00080/UNO R4 Minimaが対応。秋月は1台、SSは個単位販売で10個以上の数量値引きは別条件。単品の税込通常価格を比較（送料・保証サービス差・数量割引を除く）。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "retailer-pages",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "両店ともArduino UNO R4 Minimaで、modelNumberとメーカー製品コードがABX00080で一致するため同一完成品と判断できる。"
    },
    "pricePolicy": {
      "label": "本体1台・税込通常価格（送料・数量割引別）",
      "units": [
        [
          "1台"
        ],
        [
          null
        ]
      ],
      "offerIds": [
        "__default__",
        "42723749232838"
      ],
      "evidence": "2026-09-07に両店舗の商品ページを確認。ABX00080/UNO R4 Minimaが対応。秋月は1台、SSは個単位販売で10個以上の数量値引きは別条件。単品の税込通常価格を比較（送料・保証サービス差・数量割引を除く）。",
      "verifiedAt": "2026-09-07"
    }
  },
  {
    "id": "a118154-s8660",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "118154",
        "name": "M5Stack PoEカメラ Wi-Fi付き(OV2640)",
        "modelNumber": "M5STACK-U121-B",
        "url": "https://akizukidenshi.com/catalog/g/g118154/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack PoEカメラ Wi-Fi付き(OV2640)"
        ],
        "expectedModels": [
          "M5STACK-U121-B"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "8660",
        "name": "M5Stack PoEカメラ Wi-Fi付き（OV2640）--在庫限り",
        "modelNumber": "U121-B",
        "url": "https://www.switch-science.com/products/8660",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack PoEカメラ Wi-Fi付き（OV2640）--在庫限り"
        ],
        "expectedModels": [
          "U121-B",
          "8660"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 U121-B と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a118246-s9090",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "118246",
        "name": "Arduino UNO R4 WiFi",
        "modelNumber": "ABX00087",
        "url": "https://akizukidenshi.com/catalog/g/g118246/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino UNO R4 WiFi"
        ],
        "expectedModels": [
          "ABX00087"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9090",
        "name": "Arduino Uno R4 WiFi",
        "modelNumber": "ABX00087",
        "url": "https://www.switch-science.com/products/9090",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Uno R4 WiFi"
        ],
        "expectedModels": [
          "ABX00087",
          "9090"
        ]
      }
    ],
    "evidence": "modelNumber=ABX00087とArduino Uno R4 WiFiの名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=ABX00087とArduino Uno R4 WiFiの名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a118306-s9414",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "118306",
        "name": "実験用安定化電源 DP100",
        "modelNumber": "DP100",
        "url": "https://akizukidenshi.com/catalog/g/g118306/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "実験用安定化電源 DP100"
        ],
        "expectedModels": [
          "DP100"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9414",
        "name": "DP100 USB-PD入力 安定化電源",
        "modelNumber": "DP100",
        "url": "https://www.switch-science.com/products/9414",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "DP100 USB-PD入力 安定化電源"
        ],
        "expectedModels": [
          "DP100",
          "9414"
        ]
      }
    ],
    "evidence": "型番 DP100 と実験用／USB-PD入力の安定化電源という製品名が一致し、ALIENTEK製品として対応する。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 DP100 と実験用／USB-PD入力の安定化電源という製品名が一致し、ALIENTEK製品として対応する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a129326-s9250",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "129326",
        "name": "Raspberry Pi 5 8GB",
        "modelNumber": "SC1112",
        "url": "https://akizukidenshi.com/catalog/g/g129326/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi 5 8GB"
        ],
        "expectedModels": [
          "SC1112"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9250",
        "name": "Raspberry Pi 5 / 8GB",
        "modelNumber": "SC1112",
        "url": "https://www.switch-science.com/products/9250",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi 5 / 8GB"
        ],
        "expectedModels": [
          "SC1112",
          "9250"
        ]
      }
    ],
    "evidence": "modelNumber=SC1112とRaspberry Pi 5 8GBの名称が一致する。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=SC1112とRaspberry Pi 5 8GBの名称が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a129377-s582",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "129377",
        "name": "A4988使用ステッピングモータードライバーモジュール",
        "modelNumber": "1182",
        "url": "https://akizukidenshi.com/catalog/g/g129377/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "A4988使用ステッピングモータードライバーモジュール"
        ],
        "expectedModels": [
          "1182"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "582",
        "name": "ステッピングモータードライバA4988",
        "modelNumber": "1182",
        "url": "https://www.switch-science.com/products/582",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "ステッピングモータードライバA4988"
        ],
        "expectedModels": [
          "1182",
          "582"
        ]
      }
    ],
    "evidence": "modelNumber 1182が一致し、A4988ステッピングモータードライバーという商品名・機能表記も一致するため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber 1182が一致し、A4988ステッピングモータードライバーという商品名・機能表記も一致するため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a129452-s9413",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "129452",
        "name": "温度調整機能付USBはんだこて T80",
        "modelNumber": "T80",
        "url": "https://akizukidenshi.com/catalog/g/g129452/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "温度調整機能付USBはんだこて T80"
        ],
        "expectedModels": [
          "T80"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9413",
        "name": "T80 USB-PD 100Wはんだごて",
        "modelNumber": "T80",
        "url": "https://www.switch-science.com/products/9413",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "T80 USB-PD 100Wはんだごて"
        ],
        "expectedModels": [
          "T80",
          "9413"
        ]
      }
    ],
    "evidence": "型番 T80、ALIENTEK製品名、USB給電の温度調整はんだごてという記述が一致する。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 T80、ALIENTEK製品名、USB給電の温度調整はんだごてという記述が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a129456-s9570",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "129456",
        "name": "M5Stack NanoC6",
        "modelNumber": "M5STACK-C125",
        "url": "https://akizukidenshi.com/catalog/g/g129456/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack NanoC6"
        ],
        "expectedModels": [
          "M5STACK-C125"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9570",
        "name": "M5Stack NanoC6",
        "modelNumber": "C125",
        "url": "https://www.switch-science.com/products/9570",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack NanoC6"
        ],
        "expectedModels": [
          "C125",
          "9570"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 C125 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a129520-s4971",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "129520",
        "name": "超音波センサー URM37 V5.0",
        "modelNumber": "SEN0001",
        "url": "https://akizukidenshi.com/catalog/g/g129520/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "超音波センサー URM37 V5.0"
        ],
        "expectedModels": [
          "SEN0001"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "4971",
        "name": "《お取り寄せ商品》URM37 V5.0 Ultrasonic Sensor For Arduino / Raspberry Pi",
        "modelNumber": "SEN0001",
        "url": "https://www.switch-science.com/products/4971",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "《お取り寄せ商品》URM37 V5.0 Ultrasonic Sensor For Arduino / Raspberry Pi"
        ],
        "expectedModels": [
          "SEN0001",
          "4971"
        ]
      }
    ],
    "evidence": "modelNumber SEN0001が一致し、両方の商品名がURM37 V5.0超音波センサを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber SEN0001が一致し、両方の商品名がURM37 V5.0超音波センサを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a130055-s2661",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "130055",
        "name": "G2ハイパワーモータードライバーモジュール 24v21",
        "modelNumber": "2995",
        "url": "https://akizukidenshi.com/catalog/g/g130055/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "G2ハイパワーモータードライバーモジュール 24v21"
        ],
        "expectedModels": [
          "2995"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "2661",
        "name": "G2ハイパワーモータードライバ 24v21",
        "modelNumber": "2995",
        "url": "https://www.switch-science.com/products/2661",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "G2ハイパワーモータードライバ 24v21"
        ],
        "expectedModels": [
          "2995",
          "2661"
        ]
      }
    ],
    "evidence": "modelNumber 2995が一致し、24v21のG2ハイパワーモータードライバーという商品名とPololuのメーカー情報が対応するため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber 2995が一致し、24v21のG2ハイパワーモータードライバーという商品名とPololuのメーカー情報が対応するため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a130098-s9751",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "130098",
        "name": "LIDARユニット T-mini Plus",
        "modelNumber": "T-mini Plus",
        "url": "https://akizukidenshi.com/catalog/g/g130098/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "LIDARユニット T-mini Plus"
        ],
        "expectedModels": [
          "T-mini Plus"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9751",
        "name": "YDLIDAR T-mini Plus",
        "modelNumber": "T-mini Plus",
        "url": "https://www.switch-science.com/products/9751",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "YDLIDAR T-mini Plus"
        ],
        "expectedModels": [
          "T-mini Plus",
          "9751"
        ]
      }
    ],
    "evidence": "modelNumber T-mini Plusが一致し、YDLIDAR T-mini Plusという名称・メーカー情報が対応するため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber T-mini Plusが一致し、YDLIDAR T-mini Plusという名称・メーカー情報が対応するため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a130328-s10259",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "130328",
        "name": "Raspberry Pi 公式ACアダプター(27W USB PD Type-C) 黒",
        "modelNumber": "SC1418",
        "url": "https://akizukidenshi.com/catalog/g/g130328/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi 公式ACアダプター(27W USB PD Type-C) 黒"
        ],
        "expectedModels": [
          "SC1418"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "10259",
        "name": "Raspberry Pi 公式ACアダプター [黒色]（27W USB PD Type-C）",
        "modelNumber": "SC1418",
        "url": "https://www.switch-science.com/products/10259",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi 公式ACアダプター [黒色]（27W USB PD Type-C）"
        ],
        "expectedModels": [
          "SC1418",
          "10259"
        ]
      }
    ],
    "evidence": "型番 SC1418、Raspberry Pi公式、27W USB PD Type-C、黒色が一致する。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 SC1418、Raspberry Pi公式、27W USB PD Type-C、黒色が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a130329-s9811",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "130329",
        "name": "Raspberry Pi 公式ACアダプター(27W USB PD Type-C) 白",
        "modelNumber": "SC1419",
        "url": "https://akizukidenshi.com/catalog/g/g130329/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi 公式ACアダプター(27W USB PD Type-C) 白"
        ],
        "expectedModels": [
          "SC1419"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9811",
        "name": "Raspberry Pi 公式ACアダプター [白色]（27W USB PD Type-C）",
        "modelNumber": "SC1419",
        "url": "https://www.switch-science.com/products/9811",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi 公式ACアダプター [白色]（27W USB PD Type-C）"
        ],
        "expectedModels": [
          "SC1419",
          "9811"
        ]
      }
    ],
    "evidence": "型番 SC1419、Raspberry Pi公式、27W USB PD Type-C、白色が一致する。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 SC1419、Raspberry Pi公式、27W USB PD Type-C、白色が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131074-s1122",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131074",
        "name": "GROVE 4ピンコネクター",
        "modelNumber": "110990030",
        "url": "https://akizukidenshi.com/catalog/g/g131074/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "GROVE 4ピンコネクター"
        ],
        "expectedModels": [
          "110990030"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1122",
        "name": "GROVE - ユニバーサル4ピンコネクタ(10個入りパック)",
        "modelNumber": "110990030",
        "url": "https://www.switch-science.com/products/1122",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "GROVE - ユニバーサル4ピンコネクタ(10個入りパック)"
        ],
        "expectedModels": [
          "110990030",
          "1122"
        ]
      }
    ],
    "evidence": "型番 110990030 が一致し、GROVE 4ピンコネクタかつ双方に10個パックの記述がある。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 110990030 が一致し、GROVE 4ピンコネクタかつ双方に10個パックの記述がある。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131172-s10783",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131172",
        "name": "イーサーネットコントローラー W6300",
        "modelNumber": "W6300",
        "url": "https://akizukidenshi.com/catalog/g/g131172/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "イーサーネットコントローラー W6300"
        ],
        "expectedModels": [
          "W6300"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "10783",
        "name": "TCP/IPハードウェア処理チップ「W6300」",
        "modelNumber": "W6300",
        "url": "https://www.switch-science.com/products/10783",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "TCP/IPハードウェア処理チップ「W6300」"
        ],
        "expectedModels": [
          "W6300",
          "10783"
        ]
      }
    ],
    "evidence": "型番 W6300 と WIZnet のTCP/IPハードウェア処理チップという記述が一致する。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 W6300 と WIZnet のTCP/IPハードウェア処理チップという記述が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131303-s11044",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131303",
        "name": "シングルポイントLiDAR TSD10",
        "modelNumber": "TSD10",
        "url": "https://akizukidenshi.com/catalog/g/g131303/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "シングルポイントLiDAR TSD10"
        ],
        "expectedModels": [
          "TSD10"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "11044",
        "name": "PONO TSD10 シングルポイントToF LiDARレーザー距離センサモジュール",
        "modelNumber": "TSD10",
        "url": "https://www.switch-science.com/products/11044",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "PONO TSD10 シングルポイントToF LiDARレーザー距離センサモジュール"
        ],
        "expectedModels": [
          "TSD10",
          "11044"
        ]
      }
    ],
    "evidence": "modelNumber TSD10が一致し、両方の商品名がTSD10シングルポイントToF LiDARセンサモジュールを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber TSD10が一致し、両方の商品名がTSD10シングルポイントToF LiDARセンサモジュールを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131304-s11045",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131304",
        "name": "シングルポイントLiDAR TSD20",
        "modelNumber": "TSD20",
        "url": "https://akizukidenshi.com/catalog/g/g131304/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "シングルポイントLiDAR TSD20"
        ],
        "expectedModels": [
          "TSD20"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "11045",
        "name": "PONO TSD20 シングルポイントToF LiDARレーザー距離センサモジュール",
        "modelNumber": "TSD20",
        "url": "https://www.switch-science.com/products/11045",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "PONO TSD20 シングルポイントToF LiDARレーザー距離センサモジュール"
        ],
        "expectedModels": [
          "TSD20",
          "11045"
        ]
      }
    ],
    "evidence": "modelNumber TSD20が一致し、両方の商品名がTSD20シングルポイントToF LiDARセンサモジュールを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber TSD20が一致し、両方の商品名がTSD20シングルポイントToF LiDARセンサモジュールを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131305-s11046",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131305",
        "name": "シングルポイントLiDAR TSD50",
        "modelNumber": "TSD50",
        "url": "https://akizukidenshi.com/catalog/g/g131305/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "シングルポイントLiDAR TSD50"
        ],
        "expectedModels": [
          "TSD50"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "11046",
        "name": "PONO TSD50 シングルポイントToF LiDARレーザー距離センサモジュール",
        "modelNumber": "TSD50",
        "url": "https://www.switch-science.com/products/11046",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "PONO TSD50 シングルポイントToF LiDARレーザー距離センサモジュール"
        ],
        "expectedModels": [
          "TSD50",
          "11046"
        ]
      }
    ],
    "evidence": "modelNumber TSD50が一致し、両方の商品名がTSD50シングルポイントLiDARセンサモジュールを示すため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber TSD50が一致し、両方の商品名がTSD50シングルポイントLiDARセンサモジュールを示すため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131393-s9648",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131393",
        "name": "Arduino Nano ESP32 (ピンヘッダー実装済)",
        "modelNumber": "ABX00083",
        "url": "https://akizukidenshi.com/catalog/g/g131393/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Arduino Nano ESP32 (ピンヘッダー実装済)"
        ],
        "expectedModels": [
          "ABX00083"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9648",
        "name": "Arduino Nano ESP32（ピンヘッダ実装済）",
        "modelNumber": "ABX00083",
        "url": "https://www.switch-science.com/products/9648",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Arduino Nano ESP32（ピンヘッダ実装済）"
        ],
        "expectedModels": [
          "ABX00083",
          "9648"
        ]
      }
    ],
    "evidence": "modelNumber=ABX00083が一致し、両方ともピンヘッダー実装済みArduino Nano ESP32と記載している。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=ABX00083が一致し、両方ともピンヘッダー実装済みArduino Nano ESP32と記載している。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131397-s10496",
    "kind": "similar_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131397",
        "name": "Raspberry Pi Compute Module 5 (RAM:8GB eMMC:32GB 無線機能搭載)",
        "modelNumber": "SC1601",
        "url": "https://akizukidenshi.com/catalog/g/g131397/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi Compute Module 5 (RAM:8GB eMMC:32GB 無線機能搭載)"
        ],
        "expectedModels": [
          "SC1601"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "10496",
        "name": "Raspberry Pi Compute Module 5 Wi-Fiなし / 8GB RAM / 32GB eMMC[CM5008032]",
        "modelNumber": "SC1571",
        "url": "https://www.switch-science.com/products/10496",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi Compute Module 5 Wi-Fiなし / 8GB RAM / 32GB eMMC[CM5008032]"
        ],
        "expectedModels": [
          "SC1571",
          "10496"
        ]
      }
    ],
    "evidence": "Compute Module 5、RAM 8GB、eMMC 32GBは共通するが、秋月は無線機能搭載、SSのSC1571はWi-Fiなしなので無線構成が異なる。",
    "differences": [
      "Compute Module 5、RAM 8GB、eMMC 32GBは共通するが、秋月は無線機能搭載、SSのSC1571はWi-Fiなしなので無線構成が異なる。"
    ],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "different_configuration",
      "originalReason": "Compute Module 5、RAM 8GB、eMMC 32GBは共通するが、秋月は無線機能搭載、SSのSC1571はWi-Fiなしなので無線構成が異なる。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131397-s10595",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131397",
        "name": "Raspberry Pi Compute Module 5 (RAM:8GB eMMC:32GB 無線機能搭載)",
        "modelNumber": "SC1601",
        "url": "https://akizukidenshi.com/catalog/g/g131397/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Raspberry Pi Compute Module 5 (RAM:8GB eMMC:32GB 無線機能搭載)"
        ],
        "expectedModels": [
          "SC1601"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "10595",
        "name": "Raspberry Pi Compute Module 5 Wi-Fiあり / 8GB RAM / 32GB eMMC[CM5108032]",
        "modelNumber": "SC1601",
        "url": "https://www.switch-science.com/products/10595",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Raspberry Pi Compute Module 5 Wi-Fiあり / 8GB RAM / 32GB eMMC[CM5108032]"
        ],
        "expectedModels": [
          "SC1601",
          "10595"
        ]
      }
    ],
    "evidence": "modelNumber=SC1601が一致し、RAM 8GB・eMMC 32GB・Wi-Fiありの構成が両方の名称に明記されている。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber=SC1601が一致し、RAM 8GB・eMMC 32GB・Wi-Fiありの構成が両方の名称に明記されている。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131552-s1590",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131552",
        "name": "VNH5019使用DCモータードライバーモジュール",
        "modelNumber": "1451",
        "url": "https://akizukidenshi.com/catalog/g/g131552/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "VNH5019使用DCモータードライバーモジュール"
        ],
        "expectedModels": [
          "1451"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "1590",
        "name": "VNH5019搭載モータードライバ",
        "modelNumber": "1451",
        "url": "https://www.switch-science.com/products/1590",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "VNH5019搭載モータードライバ"
        ],
        "expectedModels": [
          "1451",
          "1590"
        ]
      }
    ],
    "evidence": "modelNumber 1451が一致し、VNH5019搭載DCモータードライバーという商品名が対応するため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber 1451が一致し、VNH5019搭載DCモータードライバーという商品名が対応するため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131553-s8782",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131553",
        "name": "MP6550使用DCモータードライバーモジュール",
        "modelNumber": "4733",
        "url": "https://akizukidenshi.com/catalog/g/g131553/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "MP6550使用DCモータードライバーモジュール"
        ],
        "expectedModels": [
          "4733"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "8782",
        "name": "MP6550搭載 モータードライバ",
        "modelNumber": "4733",
        "url": "https://www.switch-science.com/products/8782",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "MP6550搭載 モータードライバ"
        ],
        "expectedModels": [
          "4733",
          "8782"
        ]
      }
    ],
    "evidence": "modelNumber 4733が一致し、MP6550搭載DCモータードライバーという商品名とPololuのメーカー情報が対応するため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber 4733が一致し、MP6550搭載DCモータードライバーという商品名とPololuのメーカー情報が対応するため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131758-s10377",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131758",
        "name": "M5Stamp S3A",
        "modelNumber": "M5STACK-S007-V033",
        "url": "https://akizukidenshi.com/catalog/g/g131758/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stamp S3A"
        ],
        "expectedModels": [
          "M5STACK-S007-V033"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "10377",
        "name": "M5StampS3A",
        "modelNumber": "M5STACK-S007-V033",
        "url": "https://www.switch-science.com/products/10377",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5StampS3A"
        ],
        "expectedModels": [
          "M5STACK-S007-V033",
          "10377"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 S007-V033 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a131815-s11170",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131815",
        "name": "Gravity:3Dレーザー測距センサー(64×8 Matrix DTOF 3D Laser Ranging Sensor)",
        "modelNumber": "SEN0682",
        "url": "https://akizukidenshi.com/catalog/g/g131815/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "Gravity:3Dレーザー測距センサー(64×8 Matrix DTOF 3D Laser Ranging Sensor)"
        ],
        "expectedModels": [
          "SEN0682"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "11170",
        "name": "Gravity - 64x8マトリックスDTOF 3Dレーザー距離センサ",
        "modelNumber": "SEN0682",
        "url": "https://www.switch-science.com/products/11170",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "Gravity - 64x8マトリックスDTOF 3Dレーザー距離センサ"
        ],
        "expectedModels": [
          "SEN0682",
          "11170"
        ]
      }
    ],
    "evidence": "modelNumber SEN0682が一致し、64x8マトリックスDTOF 3Dレーザー距離センサという名称・DFRobot情報が対応するため、同一商品候補。",
    "differences": [],
    "missingEvidence": [],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "modelNumber SEN0682が一致し、64x8マトリックスDTOF 3Dレーザー距離センサという名称・DFRobot情報が対応するため、同一商品候補。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131817-s4449",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131817",
        "name": "12V鉛蓄電池用ソーラーパワーマネージャー (CN3767 12V Lead-Acid Battery Solar Power Manager Module)",
        "modelNumber": "DFR0580",
        "url": "https://akizukidenshi.com/catalog/g/g131817/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "12V鉛蓄電池用ソーラーパワーマネージャー (CN3767 12V Lead-Acid Battery Solar Power Manager Module)"
        ],
        "expectedModels": [
          "DFR0580"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "4449",
        "name": "《お取り寄せ商品》Solar Power Manager For 12V Lead-Acid Battery",
        "modelNumber": "DFROBOT-DFR0580",
        "url": "https://www.switch-science.com/products/4449",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "《お取り寄せ商品》Solar Power Manager For 12V Lead-Acid Battery"
        ],
        "expectedModels": [
          "DFROBOT-DFR0580",
          "4449"
        ]
      }
    ],
    "evidence": "秋月の DFR0580 と SS の DFROBOT-DFR0580 が同じ DFR0580 系コードで、12V鉛蓄電池用ソーラーパワーマネージャーの名称・用途が一致する。",
    "differences": [],
    "missingEvidence": [
      "SS側にmanufacturerProductCodeがなく、販売数量単位も明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "秋月の DFR0580 と SS の DFROBOT-DFR0580 が同じ DFR0580 系コードで、12V鉛蓄電池用ソーラーパワーマネージャーの名称・用途が一致する。"
    },
    "pricePolicy": null
  },
  {
    "id": "a131822-s10921",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131822",
        "name": "M5StickS3",
        "modelNumber": "M5STACK-K150",
        "url": "https://akizukidenshi.com/catalog/g/g131822/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5StickS3"
        ],
        "expectedModels": [
          "M5STACK-K150"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "10921",
        "name": "M5StickS3 - ESP32S3 小型IoT開発キット",
        "modelNumber": "K150",
        "url": "https://www.switch-science.com/products/10921",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5StickS3 - ESP32S3 小型IoT開発キット"
        ],
        "expectedModels": [
          "K150",
          "10921"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 K150 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a131914-s9771",
    "kind": "same_product",
    "reviewStatus": "verified",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131914",
        "name": "M5Stack PoEカメラ Wi-Fi付き(OV3660)",
        "modelNumber": "M5STACK-U121-B-V11",
        "url": "https://akizukidenshi.com/catalog/g/g131914/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "M5Stack PoEカメラ Wi-Fi付き(OV3660)"
        ],
        "expectedModels": [
          "M5STACK-U121-B-V11"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "9771",
        "name": "M5Stack PoEカメラ Wi-Fi付き（OV3660）",
        "modelNumber": "U121-B-V11",
        "url": "https://www.switch-science.com/products/9771",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "M5Stack PoEカメラ Wi-Fi付き（OV3660）"
        ],
        "expectedModels": [
          "U121-B-V11",
          "9771"
        ]
      }
    ],
    "evidence": "M5Stack製品の型番 U121-B-V11 と名称が対応。店舗接頭辞のみ正規化し、リビジョン末尾を保持。",
    "differences": [],
    "missingEvidence": [
      "販売数量・付属品等の比較条件"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": null,
      "originalClassification": null,
      "originalReason": null
    },
    "pricePolicy": null
  },
  {
    "id": "a131977-s10086",
    "kind": "same_product",
    "reviewStatus": "candidate",
    "products": [
      {
        "storeId": "akizuki",
        "pageKey": "131977",
        "name": "はんだ付け用ミニホットプレート HP15",
        "modelNumber": "HP15",
        "url": "https://akizukidenshi.com/catalog/g/g131977/",
        "observedAt": "2026-09-06T09:54:15.029Z",
        "expectedNames": [
          "はんだ付け用ミニホットプレート HP15"
        ],
        "expectedModels": [
          "HP15"
        ]
      },
      {
        "storeId": "switch-science",
        "pageKey": "10086",
        "name": "HP15 USB-PD はんだづけ用プリヒーター",
        "modelNumber": "HP15",
        "url": "https://www.switch-science.com/products/10086",
        "observedAt": "2026-08-02T07:25:56.929Z",
        "expectedNames": [
          "HP15 USB-PD はんだづけ用プリヒーター"
        ],
        "expectedModels": [
          "HP15",
          "10086"
        ]
      }
    ],
    "evidence": "型番 HP15 と ALIENTEK のはんだ付け用プリヒーター／ミニホットプレートの名称が一致する。",
    "differences": [],
    "missingEvidence": [
      "SSの販売数量単位が一括データで明示されない"
    ],
    "reviewedAt": "2026-09-07",
    "provenance": {
      "method": "catalog",
      "model": "gpt-5.6-luna",
      "originalClassification": "same_product",
      "originalReason": "型番 HP15 と ALIENTEK のはんだ付け用プリヒーター／ミニホットプレートの名称が一致する。"
    },
    "pricePolicy": null
  }
];
