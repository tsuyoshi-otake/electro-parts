import { describe, expect, it } from 'vitest';
import { cleanName, codeStems, NAME_DISCOVERY, nameTokens, proposeByName, proposeSimilar, SIMILAR_DISCOVERY } from '../../scripts/matching/names.ts';
import { normalizeCode, pairId, type Catalog, type Listing } from '../../scripts/matching/model.ts';

const row = (storeId: string, pageKey: string, name: string, modelNumber = '', manufacturer = ''): Listing => ({
  storeId, pageKey, name, modelNumber, manufacturer, manufacturerProductName: '', manufacturerProductCode: '', productCode: '', sku: '',
  codes: modelNumber ? [normalizeCode(modelNumber)] : [], expectedModels: [modelNumber], observedAt: '2026-11-02', url: `https://${storeId}.test/${pageKey}`,
});
/** Stores in the order of their first listing, as the catalogue's sources order them. */
const catalogOf = (...listings: Listing[]): Catalog => ({ schemaVersion: 1, listings,
  sources: [...new Set(listings.map(p => p.storeId))].map(storeId => ({ storeId, file: `${storeId}.json`, sha256: '0'.repeat(64), observedAt: '2026-11-02', count: listings.filter(p => p.storeId === storeId).length })) });
const storedCodes = (p: Listing): readonly string[] => p.codes;
const propose = (listings: Listing[], known: string[] = [], options = NAME_DISCOVERY) => proposeByName(catalogOf(...listings), new Set(known), storedCodes, options);

describe('name-based proposals (0.6.5)', () => {
  it('reads model-like words and leaves measurements and shop notes out', () => {
    expect(nameTokens({ name: 'タイマーIC NJM555D' })).toEqual(['NJM555D']);
    expect(nameTokens({ name: '【取寄せ品】超高効率DCDCコンバーター 5V3A 12mm 2x20 4-pin AWG22 V2.1 M78AR05-0.5' })).toEqual(['M78AR05-0.5']);
    expect(nameTokens({ name: 'ロジックIC 74HC595N トランジスタ 2N3904 10kΩ 0.5A' })).toEqual(['74HC595N', '2N3904']);
    expect(nameTokens({ name: 'M5StickC ENV Hat（DHT12/BMP280/BMM150搭載）' })).toEqual(['M5STICKC', 'DHT12/BMP280/BMM150', 'DHT12', 'BMP280', 'BMM150']);
    expect(nameTokens({ name: '[EOL] ADC I2C Unit (ADS1100)' })).toEqual(['ADS1100']);
    expect(cleanName({ name: 'シリアル版Arduinoのプリント基板(基板のみ)--販売終了' })).toBe('シリアル版ARDUINOのプリント基板(基板のみ)');
    expect(cleanName({ name: '《お取り寄せ商品》Raspberryシリコン - RP2350A' })).toBe('RASPBERRYシリコン - RP2350A');
  });

  it('proposes a listing without codes of its own whose name carries the same part number', () => {
    const akizuki = row('akizuki', '114531', 'タイマーIC NJM555D', 'NJM555D');
    const sengoku = row('sengoku', 'EEHD-6WWU', 'タイマーIC NJM555D');
    expect(propose([akizuki, sengoku])).toEqual([{ id: pairId(akizuki, sengoku), products: ['akizuki/114531', 'sengoku/EEHD-6WWU'], tokens: ['NJM555D'], similarity: 1 }]);
    // The pair keeps the catalogue's store order whichever listing comes first in a block.
    expect(proposeByName({ ...catalogOf(akizuki, sengoku), listings: [sengoku, akizuki] }, new Set(), storedCodes)[0]!.products).toEqual(['akizuki/114531', 'sengoku/EEHD-6WWU']);
    // The other listing's code in the name is enough: one of them has no code, and the name carries the other's.
    expect(propose([row('akizuki', '111948', 'トロイダルコア T-50-10', 'T-50-10'), row('sengoku', '1AD1-0037', 'ダストコア　T-50-10')])).toHaveLength(1);
  });

  it('leaves listings that both have codes of their own to the code keys', () => {
    const ksy = row('ksy', '1019', 'CSIケーブル カメラ用 FPC 15-22pin 200mm SC1128', 'SC1128');
    const sengoku = row('sengoku', 'EEHD-6A7D', 'Pi 5用 CSIケーブル カメラ用 FPC 15-22pin 500mm SC1130', 'SC1130');
    expect(propose([ksy, sengoku])).toEqual([]);
    expect(propose([ksy, { ...sengoku, codes: [] }])).toHaveLength(1);
    // Codes come from the caller, so a derived form counts as the listing's own code.
    expect(proposeByName(catalogOf(ksy, { ...sengoku, codes: [] }), new Set(), p => p.storeId === 'sengoku' ? ['SC1130'] : p.codes)).toEqual([]);
  });

  it('keeps contradictory makers apart and does not block on a token in too many listings', () => {
    const jrc = row('akizuki', '1', 'オペアンプ NJM4580DD', 'NJM4580DD', 'JRC');
    const other = row('sengoku', '2', 'オペアンプ NJM4580DD', '', 'Other');
    expect(propose([jrc, other])).toEqual([]);
    expect(propose([jrc, { ...other, manufacturer: '' }])).toHaveLength(1);
    const many = Array.from({ length: 21 }, (_, i) => row(i % 2 ? 'sengoku' : 'akizuki', String(i), `マイコン ABC123 ${i}`));
    expect(propose(many)).toEqual([]);
    expect(propose(many, [], { ...NAME_DISCOVERY, maxListings: 21 }).length).toBeGreaterThan(0);
  });

  it('keeps the pairs either listing ranks first, and ranks known pairs too so reviewing does not promote the next', () => {
    const driver = row('akizuki', 'A', 'デュアルモータードライバ TB6612FNG', 'AE-TB6612');
    const robot = row('akizuki', 'C', 'TB6612FNG搭載ロボットキット', 'ROBOT-1');
    const x = row('sengoku', 'X', 'デュアルモータードライバ TB6612FNG');
    const y = row('sengoku', 'Y', 'TB6612FNG搭載ロボットキット');
    const listings = [driver, robot, x, y];
    const loose = { ...NAME_DISCOVERY, minSimilarity: 0 };
    const pairs = (known: string[], options = loose) => propose(listings, known, options).map(p => p.products.join(' '));
    expect(pairs([], { ...loose, perListing: 1 })).toEqual(['akizuki/A sengoku/X', 'akizuki/C sengoku/Y']);
    expect(pairs([], { ...loose, perListing: 2 })).toHaveLength(4);
    // A reviewed pair leaves the queue; the pairs no listing ranked first stay out.
    expect(pairs([pairId(driver, x)], { ...loose, perListing: 1 })).toEqual(['akizuki/C sengoku/Y']);
    // The similarity floor applies after ranking: less similar names in one block are not proposed.
    expect(pairs([], { ...loose, perListing: 2, minSimilarity: 0.99 })).toEqual(['akizuki/A sengoku/X', 'akizuki/C sengoku/Y']);
  });

  it('pairs only inside token blocks, never across the whole catalogue', () => {
    const left = Array.from({ length: 20_000 }, (_, i) => row('akizuki', String(i), `部品 PARTA${i}`, `PARTA${i}`));
    const right = Array.from({ length: 20_000 }, (_, i) => row('sengoku', String(i), `部品 PARTB${i}`));
    const started = performance.now();
    expect(propose([...left, ...right])).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('similar-product leads (0.6.6)', () => {
  const similar = (listings: Listing[], known: string[] = []) => proposeSimilar(catalogOf(...listings), new Set(known), storedCodes);

  it('reads a code and its model-like prefixes at hyphens', () => {
    expect(codeStems(['AI-003-PRO'])).toEqual(['AI-003', 'AI-003-PRO']);
    expect(codeStems(['U078-M12', 'SC'])).toEqual(['U078', 'U078-M12']);
    // An ISBN prefix has no letter and names a publisher, not a product line.
    expect(codeStems(['978-4-8222-3609-0'])).toEqual([]);
  });

  it('proposes two coded listings whose names share a rare word and whose codes share a stem', () => {
    const ss = row('switch-science', '7536', 'M5Stack UnitV2 M12版', 'U078-M12');
    const m5 = row('m5stack', 'unitv2-usb', 'M5Stack UnitV2 USB Version without Camera', 'U078-USB');
    expect(similar([ss, m5])).toEqual([{ id: pairId(ss, m5), products: ['switch-science/7536', 'm5stack/unitv2-usb'], tokens: ['M5STACK', 'UNITV2'], stems: ['U078'] }]);
    expect(similar([ss, m5], [pairId(ss, m5)])).toEqual([]);
    // The identity queue leaves such pairs to this one.
    expect(proposeByName(catalogOf(ss, m5), new Set(), storedCodes, { ...NAME_DISCOVERY, minSimilarity: 0 })).toEqual([]);
  });

  it('leaves name pairs without a shared stem, codeless listings and contradictory makers out', () => {
    const adafruit = row('akizuki', '1083', 'ADS1015搭載 12BitADC 4CH', '1083');
    const sparkfun = row('switch-science', '15334', 'SparkFun Qwiic 12 Bit ADC - 4 Channel (ADS1015)', 'DEV-15334');
    expect(similar([adafruit, sparkfun])).toEqual([]);
    const lite = row('m5stack', 'roller485-lite', 'Roller485 Lite Unit', 'U182-LITE');
    expect(similar([lite, row('sengoku', 'X', 'Roller485ユニット スリップリング付き', 'U182')])).toHaveLength(1);
    expect(similar([lite, row('sengoku', 'X', 'Roller485ユニット スリップリング付き')])).toEqual([]);
    expect(similar([{ ...lite, manufacturer: 'M5Stack' }, row('sengoku', 'X', 'Roller485ユニット', 'U182', 'Other')])).toEqual([]);
  });

  it('pairs only inside token blocks, never across the whole catalogue', () => {
    const left = Array.from({ length: 20_000 }, (_, i) => row('akizuki', String(i), `部品 PARTA${i}`, `STEM${i}-A`));
    const right = Array.from({ length: 20_000 }, (_, i) => row('sengoku', String(i), `部品 PARTB${i}`, `STEM${i}-B`));
    const started = performance.now();
    expect(similar([...left, ...right])).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('base-code leads (0.6.7)', () => {
  const similar = (listings: Listing[], known: string[] = [], options = SIMILAR_DISCOVERY) => proposeSimilar(catalogOf(...listings), new Set(known), storedCodes, options);

  it('proposes a listing whose own code is the stem the other code extends, even when the names share no word', () => {
    const ss = row('switch-science', '5221', 'M5Stack用ADCユニット', 'U013');
    const m5 = row('m5stack', 'adc-v11', 'ADC I2C Unit v1.1 (ADS1110)', 'U013-V11');
    expect(similar([ss, m5])).toEqual([{ id: pairId(ss, m5), products: ['switch-science/5221', 'm5stack/adc-v11'], tokens: [], stems: ['U013'] }]);
    expect(similar([ss, m5], [pairId(ss, m5)])).toEqual([]);
    // Two codes that both extend the stem still need a shared name token.
    expect(similar([row('akizuki', '1', 'タクトスイッチ 黒', 'MK-617-5'), row('sengoku', '2', '押しボタン 白', 'MK-617-6')])).toEqual([]);
  });

  it('leaves a base code in more than maxStemListings listings, one-shop pairs and contradictory makers out', () => {
    const base = row('akizuki', 'base', 'ATOM Lite', 'C008');
    const variants = Array.from({ length: 10 }, (_, i) => row('switch-science', String(i), `部品 ${i}`, `C008-V${i}`));
    expect(similar([base, ...variants.slice(0, 9)])).toHaveLength(9);
    expect(similar([base, ...variants])).toEqual([]);
    expect(similar([base, ...variants], [], { ...SIMILAR_DISCOVERY, maxStemListings: 11 })).toHaveLength(10);
    expect(similar([base, row('akizuki', 'b', 'ATOM Lite B', 'C008-B')])).toEqual([]);
    expect(similar([{ ...base, manufacturer: 'M5Stack' }, row('sengoku', 'X', 'ATOM', 'C008-B', 'Other')])).toEqual([]);
  });

  it('pairs only inside stem blocks, never across the whole catalogue', () => {
    const left = Array.from({ length: 20_000 }, (_, i) => row('akizuki', String(i), `部品 PARTA${i}`, `BASE${i}`));
    const right = Array.from({ length: 20_000 }, (_, i) => row('sengoku', String(i), `部品 PARTB${i}`, `BASE${i}-B`));
    const started = performance.now();
    const leads = similar([...left, ...right]);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(leads).toHaveLength(20_000);
    expect(leads.every(lead => lead.tokens.length === 0 && lead.stems.length === 1)).toBe(true);
  });
});
