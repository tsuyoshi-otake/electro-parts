import type { StoreCapabilities } from '../core/capabilities.ts';
import type { AvailabilityState, PriceState, QuantitySemantics } from '../core/domain.ts';
import type { PriceBasis } from '../core/price.ts';

/**
 * Static data contract v1 — the ONLY thing the userscript and the publisher
 * share. Dependency free (no node built-ins) so it bundles into the
 * userscript unchanged.
 *
 * Versioning: `CONTRACT_VERSION` is semver. The major is part of every cache
 * key; a new major is published under a new `data/v<major>/` root so old and
 * new userscripts never read each other's files. Minor bumps only add
 * optional fields.
 */
export const CONTRACT_VERSION = '1.0.0';
export const CONTRACT_MAJOR = 1;

export const DATA_ROOT = `data/v${CONTRACT_MAJOR}`;
export const PRODUCT_PATH_TEMPLATE = 'products/{pageKey}.json';

export function storeDir(storeId: string): string {
  return `${DATA_ROOT}/stores/${storeId}`;
}

export function manifestPath(storeId: string): string {
  return `${storeDir(storeId)}/manifest.json`;
}

export function productPath(storeId: string, pageKey: string): string {
  return `${storeDir(storeId)}/${PRODUCT_PATH_TEMPLATE.replace('{pageKey}', pageKey)}`;
}

/** Compact tuples: times are UTC epoch milliseconds. */
export type PresencePointV1 = [t: number, present: 0 | 1];
export type PricePointV1 = [t: number, state: PriceState, minAmountMinor: number | null, maxAmountMinor: number | null];
export type AvailabilityPointV1 = [
  t: number,
  state: AvailabilityState,
  purchasable: boolean | null,
  quantitySemantics: QuantitySemantics,
  rawStatus: string | null,
];
export type InventoryPointV1 = [t: number, quantity: number | null];

export interface MetadataPointV1 {
  t: number;
  name: string;
  modelNumber: string | null;
  category: string | null;
  canonicalUrl: string;
  /** Name and model number changed together: possible identity reuse. */
  suspicious: boolean;
}

export interface PriceValueV1 {
  state: PriceState;
  minAmountMinor: number | null;
  maxAmountMinor: number | null;
}

export interface PriceWindowStatsV1 {
  /** Lowest price in effect while the basis was listed during the window. */
  minMinor: number;
  maxMinor: number;
}

export interface SegmentStatsV1 {
  current: PriceValueV1;
  currentSinceAt: number;
  previousDistinct: PriceValueV1 | null;
  change: { differenceMinor: number | null; percent: number | null; direction: 'up' | 'down' | 'flat' | 'unknown' };
  /** Over the whole observation window — never a claim about all-time prices. */
  observedMinMinor: number | null;
  observedMaxMinor: number | null;
  segmentStartAt: number;
  changePointCount: number;
  /** Trailing windows ending at the dataset's latest observation. `null` = nothing listed in the window. */
  windows: { d30: PriceWindowStatsV1 | null; d90: PriceWindowStatsV1 | null; d365: PriceWindowStatsV1 | null };
}

export interface SegmentV1 {
  basis: PriceBasis;
  /** The segment the UI shows first: matches the store's primary quote and is the most recently listed one. */
  primary: boolean;
  presence: PresencePointV1[];
  points: PricePointV1[];
  stats: SegmentStatsV1;
}

export interface InventoryV1 {
  semantics: QuantitySemantics;
  points: InventoryPointV1[];
  /** Only the most recent `points` are published when the series is long. */
  truncated: boolean;
  totalPoints: number;
}

export interface OfferV1 {
  externalOfferId: string;
  offerKind: string;
  sku: string | null;
  variantName: string | null;
  presence: PresencePointV1[];
  segments: SegmentV1[];
  availability: AvailabilityPointV1[];
  inventory: InventoryV1;
}

export const CAVEAT_KEYS = [
  'observation_window',
  'sampling_interval',
  'absence_not_discontinued',
  'site_reported_quantity',
  'quantity_semantics_unknown',
  'suspicious_identity',
] as const;
export type CaveatKey = (typeof CAVEAT_KEYS)[number];

export interface ObservationWindowV1 {
  runCount: number;
  firstObservedAt: number | null;
  latestObservedAt: number | null;
}

export interface ManifestV1 {
  contractVersion: string;
  storeId: string;
  /** Identical in every file of one publication. Changes whenever any run is added. */
  datasetVersion: string;
  generatedAt: string;
  capabilities: StoreCapabilities;
  observation: ObservationWindowV1 & { latestCoverageId: string | null };
  productCount: number;
  productPathTemplate: string;
  versions: { contract: string; sqliteSchema: number; sourceSchema: string | null };
  caveats: CaveatKey[];
}

export interface ProductFileV1 {
  contractVersion: string;
  datasetVersion: string;
  storeId: string;
  pageKey: string;
  externalProductId: string;
  generatedAt: string;
  observation: ObservationWindowV1;
  product: {
    firstSeenAt: number;
    lastSeenAt: number;
    /** Present in the latest run of the store. */
    listed: boolean;
    aliases: { kind: string; value: string }[];
    presence: PresencePointV1[];
    metadata: MetadataPointV1[];
    current: { name: string; modelNumber: string | null; category: string | null; canonicalUrl: string };
  };
  offers: OfferV1[];
  /** Product-specific caveats only; store-wide ones live in the manifest. */
  caveats: CaveatKey[];
}

// ---------------------------------------------------------------------------
// Structural validation (shared by publisher verification and the userscript)
// ---------------------------------------------------------------------------

const PRICE_STATES = new Set<string>(['exact', 'range', 'unavailable']);
const AVAILABILITY = new Set<string>([
  'in_stock',
  'low_stock',
  'out_of_stock',
  'restocking',
  'preparing',
  'checking',
  'discontinued',
  'unknown',
  'not_displayed',
]);
const SEMANTICS = new Set<string>(['site_reported', 'reference', 'not_exposed', 'unknown']);
const CAVEATS = new Set<string>(CAVEAT_KEYS);

type Rec = Record<string, unknown>;

class Checker {
  readonly issues: string[] = [];
  private readonly limit = 50;

  fail(path: string, message: string): false {
    if (this.issues.length < this.limit) this.issues.push(`${path}: ${message}`);
    return false;
  }

  obj(v: unknown, path: string): v is Rec {
    return (typeof v === 'object' && v !== null && !Array.isArray(v)) || this.fail(path, 'expected object');
  }

  arr(v: unknown, path: string): v is unknown[] {
    return Array.isArray(v) || this.fail(path, 'expected array');
  }

  str(v: unknown, path: string): v is string {
    return typeof v === 'string' || this.fail(path, 'expected string');
  }

  strOrNull(v: unknown, path: string): v is string | null {
    return v === null || typeof v === 'string' || this.fail(path, 'expected string or null');
  }

  bool(v: unknown, path: string): v is boolean {
    return typeof v === 'boolean' || this.fail(path, 'expected boolean');
  }

  boolOrNull(v: unknown, path: string): v is boolean | null {
    return v === null || typeof v === 'boolean' || this.fail(path, 'expected boolean or null');
  }

  int(v: unknown, path: string): v is number {
    return Number.isSafeInteger(v) || this.fail(path, 'expected integer');
  }

  intOrNull(v: unknown, path: string): v is number | null {
    return v === null || Number.isSafeInteger(v) || this.fail(path, 'expected integer or null');
  }

  time(v: unknown, path: string): v is number {
    return (Number.isSafeInteger(v) && (v as number) > 0) || this.fail(path, 'expected epoch ms');
  }

  oneOf(v: unknown, set: Set<string>, path: string): v is string {
    return (typeof v === 'string' && set.has(v)) || this.fail(path, `unexpected value ${JSON.stringify(v)}`);
  }
}

function sameMajor(version: unknown): boolean {
  return typeof version === 'string' && version.startsWith(`${CONTRACT_MAJOR}.`);
}

function checkPresence(c: Checker, v: unknown, path: string): void {
  if (!c.arr(v, path)) return;
  let last = -1;
  v.forEach((p, i) => {
    const at = `${path}[${i}]`;
    if (!c.arr(p, at) || p.length !== 2) {
      c.fail(at, 'expected [t, 0|1]');
      return;
    }
    if (c.time(p[0], `${at}[0]`)) {
      if ((p[0] as number) <= last) c.fail(at, 'times must be strictly ascending');
      last = p[0] as number;
    }
    if (p[1] !== 0 && p[1] !== 1) c.fail(`${at}[1]`, 'expected 0 or 1');
  });
}

function checkAscending(c: Checker, v: unknown[], path: string): void {
  let last = -1;
  v.forEach((p, i) => {
    if (Array.isArray(p) && Number.isSafeInteger(p[0])) {
      if ((p[0] as number) <= last) c.fail(`${path}[${i}]`, 'times must be strictly ascending');
      last = p[0] as number;
    }
  });
}

function checkPriceValue(c: Checker, v: unknown, path: string): void {
  if (!c.obj(v, path)) return;
  c.oneOf(v['state'], PRICE_STATES, `${path}.state`);
  c.intOrNull(v['minAmountMinor'], `${path}.minAmountMinor`);
  c.intOrNull(v['maxAmountMinor'], `${path}.maxAmountMinor`);
  if (v['state'] === 'unavailable' && (v['minAmountMinor'] !== null || v['maxAmountMinor'] !== null)) {
    c.fail(path, 'unavailable price must have null amounts');
  }
  if (v['state'] !== 'unavailable' && (v['minAmountMinor'] === null || v['maxAmountMinor'] === null)) {
    c.fail(path, 'priced state needs amounts');
  }
}

function checkWindow(c: Checker, v: unknown, path: string): void {
  if (v === null) return;
  if (!c.obj(v, path)) return;
  c.int(v['minMinor'], `${path}.minMinor`);
  c.int(v['maxMinor'], `${path}.maxMinor`);
}

function checkStats(c: Checker, v: unknown, path: string): void {
  if (!c.obj(v, path)) return;
  checkPriceValue(c, v['current'], `${path}.current`);
  c.time(v['currentSinceAt'], `${path}.currentSinceAt`);
  if (v['previousDistinct'] !== null) checkPriceValue(c, v['previousDistinct'], `${path}.previousDistinct`);
  if (c.obj(v['change'], `${path}.change`)) {
    c.intOrNull(v['change']['differenceMinor'], `${path}.change.differenceMinor`);
    const pct = v['change']['percent'];
    if (pct !== null && typeof pct !== 'number') c.fail(`${path}.change.percent`, 'expected number or null');
    c.oneOf(v['change']['direction'], new Set(['up', 'down', 'flat', 'unknown']), `${path}.change.direction`);
  }
  c.intOrNull(v['observedMinMinor'], `${path}.observedMinMinor`);
  c.intOrNull(v['observedMaxMinor'], `${path}.observedMaxMinor`);
  c.time(v['segmentStartAt'], `${path}.segmentStartAt`);
  c.int(v['changePointCount'], `${path}.changePointCount`);
  if (c.obj(v['windows'], `${path}.windows`)) {
    for (const w of ['d30', 'd90', 'd365']) checkWindow(c, v['windows'][w], `${path}.windows.${w}`);
  }
}

function checkBasis(c: Checker, v: unknown, path: string): void {
  if (!c.obj(v, path)) return;
  c.oneOf(v['quoteKind'], new Set(['selling', 'compare_at']), `${path}.quoteKind`);
  c.oneOf(v['taxTreatment'], new Set(['tax_included', 'tax_excluded', 'unknown']), `${path}.taxTreatment`);
  c.str(v['currency'], `${path}.currency`);
  c.strOrNull(v['unitLabel'], `${path}.unitLabel`);
}

function checkSegment(c: Checker, v: unknown, path: string): void {
  if (!c.obj(v, path)) return;
  checkBasis(c, v['basis'], `${path}.basis`);
  c.bool(v['primary'], `${path}.primary`);
  checkPresence(c, v['presence'], `${path}.presence`);
  if (c.arr(v['points'], `${path}.points`)) {
    if (v['points'].length === 0) c.fail(`${path}.points`, 'a segment has at least one point');
    v['points'].forEach((p, i) => {
      const at = `${path}.points[${i}]`;
      if (!c.arr(p, at) || p.length !== 4) {
        c.fail(at, 'expected [t, state, min, max]');
        return;
      }
      c.time(p[0], `${at}[0]`);
      c.oneOf(p[1], PRICE_STATES, `${at}[1]`);
      c.intOrNull(p[2], `${at}[2]`);
      c.intOrNull(p[3], `${at}[3]`);
    });
    checkAscending(c, v['points'], `${path}.points`);
  }
  checkStats(c, v['stats'], `${path}.stats`);
}

function checkOffer(c: Checker, v: unknown, path: string): void {
  if (!c.obj(v, path)) return;
  c.str(v['externalOfferId'], `${path}.externalOfferId`);
  c.str(v['offerKind'], `${path}.offerKind`);
  c.strOrNull(v['sku'], `${path}.sku`);
  c.strOrNull(v['variantName'], `${path}.variantName`);
  checkPresence(c, v['presence'], `${path}.presence`);
  if (c.arr(v['segments'], `${path}.segments`)) {
    v['segments'].forEach((s, i) => checkSegment(c, s, `${path}.segments[${i}]`));
    if (v['segments'].filter((s) => (s as Rec)['primary'] === true).length > 1) c.fail(`${path}.segments`, 'more than one primary segment');
  }
  if (c.arr(v['availability'], `${path}.availability`)) {
    v['availability'].forEach((p, i) => {
      const at = `${path}.availability[${i}]`;
      if (!c.arr(p, at) || p.length !== 5) {
        c.fail(at, 'expected [t, state, purchasable, semantics, rawStatus]');
        return;
      }
      c.time(p[0], `${at}[0]`);
      c.oneOf(p[1], AVAILABILITY, `${at}[1]`);
      c.boolOrNull(p[2], `${at}[2]`);
      c.oneOf(p[3], SEMANTICS, `${at}[3]`);
      c.strOrNull(p[4], `${at}[4]`);
    });
    checkAscending(c, v['availability'], `${path}.availability`);
  }
  if (c.obj(v['inventory'], `${path}.inventory`)) {
    const inv = v['inventory'];
    c.oneOf(inv['semantics'], SEMANTICS, `${path}.inventory.semantics`);
    c.bool(inv['truncated'], `${path}.inventory.truncated`);
    c.int(inv['totalPoints'], `${path}.inventory.totalPoints`);
    if (c.arr(inv['points'], `${path}.inventory.points`)) {
      inv['points'].forEach((p, i) => {
        const at = `${path}.inventory.points[${i}]`;
        if (!c.arr(p, at) || p.length !== 2) {
          c.fail(at, 'expected [t, quantity]');
          return;
        }
        c.time(p[0], `${at}[0]`);
        c.intOrNull(p[1], `${at}[1]`);
      });
      checkAscending(c, inv['points'], `${path}.inventory.points`);
    }
  }
}

function checkObservation(c: Checker, v: unknown, path: string): void {
  if (!c.obj(v, path)) return;
  c.int(v['runCount'], `${path}.runCount`);
  if (v['firstObservedAt'] !== null) c.time(v['firstObservedAt'], `${path}.firstObservedAt`);
  if (v['latestObservedAt'] !== null) c.time(v['latestObservedAt'], `${path}.latestObservedAt`);
}

function checkCaveats(c: Checker, v: unknown, path: string): void {
  if (!c.arr(v, path)) return;
  v.forEach((k, i) => c.oneOf(k, CAVEATS, `${path}[${i}]`));
}

function checkCapabilities(c: Checker, v: unknown, path: string): void {
  if (!c.obj(v, path)) return;
  for (const k of [
    'supportsExactPrice',
    'supportsPriceRange',
    'supportsVariants',
    'supportsCompareAtPrice',
    'supportsTaxIncluded',
    'supportsTaxExcluded',
    'supportsAvailability',
    'supportsInventoryQuantity',
  ]) {
    c.bool(v[k], `${path}.${k}`);
  }
  c.oneOf(v['inventoryQuantitySemantics'], SEMANTICS, `${path}.inventoryQuantitySemantics`);
  if (c.obj(v['primaryQuote'], `${path}.primaryQuote`)) {
    c.oneOf(v['primaryQuote']['quoteKind'], new Set(['selling', 'compare_at']), `${path}.primaryQuote.quoteKind`);
    c.oneOf(v['primaryQuote']['taxTreatment'], new Set(['tax_included', 'tax_excluded', 'unknown']), `${path}.primaryQuote.taxTreatment`);
  }
}

/** Returns a list of problems; empty means `value` is a `ManifestV1` of this contract major. */
export function validateManifestV1(value: unknown): string[] {
  const c = new Checker();
  if (!c.obj(value, '$')) return c.issues;
  if (!sameMajor(value['contractVersion'])) c.fail('$.contractVersion', `expected major ${CONTRACT_MAJOR}`);
  c.str(value['storeId'], '$.storeId');
  c.str(value['datasetVersion'], '$.datasetVersion');
  c.str(value['generatedAt'], '$.generatedAt');
  checkCapabilities(c, value['capabilities'], '$.capabilities');
  checkObservation(c, value['observation'], '$.observation');
  if (c.obj(value['observation'], '$.observation')) c.strOrNull(value['observation']['latestCoverageId'], '$.observation.latestCoverageId');
  c.int(value['productCount'], '$.productCount');
  if (value['productPathTemplate'] !== PRODUCT_PATH_TEMPLATE) c.fail('$.productPathTemplate', 'unexpected template');
  if (c.obj(value['versions'], '$.versions')) {
    c.str(value['versions']['contract'], '$.versions.contract');
    c.int(value['versions']['sqliteSchema'], '$.versions.sqliteSchema');
    c.strOrNull(value['versions']['sourceSchema'], '$.versions.sourceSchema');
  }
  checkCaveats(c, value['caveats'], '$.caveats');
  return c.issues;
}

/** Returns a list of problems; empty means `value` is a `ProductFileV1` of this contract major. */
export function validateProductFileV1(value: unknown): string[] {
  const c = new Checker();
  if (!c.obj(value, '$')) return c.issues;
  if (!sameMajor(value['contractVersion'])) c.fail('$.contractVersion', `expected major ${CONTRACT_MAJOR}`);
  c.str(value['datasetVersion'], '$.datasetVersion');
  c.str(value['storeId'], '$.storeId');
  c.str(value['pageKey'], '$.pageKey');
  c.str(value['externalProductId'], '$.externalProductId');
  c.str(value['generatedAt'], '$.generatedAt');
  checkObservation(c, value['observation'], '$.observation');
  if (c.obj(value['product'], '$.product')) {
    const p = value['product'];
    c.time(p['firstSeenAt'], '$.product.firstSeenAt');
    c.time(p['lastSeenAt'], '$.product.lastSeenAt');
    c.bool(p['listed'], '$.product.listed');
    if (c.arr(p['aliases'], '$.product.aliases')) {
      p['aliases'].forEach((a, i) => {
        if (c.obj(a, `$.product.aliases[${i}]`)) {
          c.str(a['kind'], `$.product.aliases[${i}].kind`);
          c.str(a['value'], `$.product.aliases[${i}].value`);
        }
      });
    }
    checkPresence(c, p['presence'], '$.product.presence');
    if (c.arr(p['metadata'], '$.product.metadata')) {
      if (p['metadata'].length === 0) c.fail('$.product.metadata', 'at least one metadata point');
      p['metadata'].forEach((m, i) => {
        const at = `$.product.metadata[${i}]`;
        if (!c.obj(m, at)) return;
        c.time(m['t'], `${at}.t`);
        c.str(m['name'], `${at}.name`);
        c.strOrNull(m['modelNumber'], `${at}.modelNumber`);
        c.strOrNull(m['category'], `${at}.category`);
        c.str(m['canonicalUrl'], `${at}.canonicalUrl`);
        c.bool(m['suspicious'], `${at}.suspicious`);
      });
    }
    if (c.obj(p['current'], '$.product.current')) {
      c.str(p['current']['name'], '$.product.current.name');
      c.strOrNull(p['current']['modelNumber'], '$.product.current.modelNumber');
      c.strOrNull(p['current']['category'], '$.product.current.category');
      c.str(p['current']['canonicalUrl'], '$.product.current.canonicalUrl');
    }
  }
  if (c.arr(value['offers'], '$.offers')) {
    if (value['offers'].length === 0) c.fail('$.offers', 'at least one offer');
    value['offers'].forEach((o, i) => checkOffer(c, o, `$.offers[${i}]`));
  }
  checkCaveats(c, value['caveats'], '$.caveats');
  return c.issues;
}

export function isManifestV1(value: unknown): value is ManifestV1 {
  return validateManifestV1(value).length === 0;
}

export function isProductFileV1(value: unknown): value is ProductFileV1 {
  return validateProductFileV1(value).length === 0;
}
