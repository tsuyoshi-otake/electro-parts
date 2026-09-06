/**
 * Schema v1. All timestamps are UTC epoch milliseconds (INTEGER) unless the
 * column name ends in `_iso`. Event tables are change-point series: a row
 * exists only where the state differs from the previous row of the same
 * entity, and the state is in effect until the next row.
 */
export const MIGRATION_0001_INITIAL = `
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at TEXT    NOT NULL
);

CREATE TABLE stores (
  store_id          TEXT PRIMARY KEY,
  capabilities_json TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

-- One row per imported complete snapshot. observed_at comes from the snapshot
-- payload, never from a file name.
CREATE TABLE crawl_runs (
  run_id                INTEGER PRIMARY KEY,
  store_id              TEXT    NOT NULL REFERENCES stores(store_id),
  observed_at           INTEGER NOT NULL,
  observed_at_iso       TEXT    NOT NULL,
  source_schema_version TEXT    NOT NULL,
  coverage_id           TEXT    NOT NULL,
  raw_sha256            TEXT    NOT NULL,
  normalized_hash       TEXT    NOT NULL,
  item_count            INTEGER NOT NULL,
  validation_json       TEXT    NOT NULL,
  imported_at           TEXT    NOT NULL,
  UNIQUE (store_id, observed_at)
);
CREATE INDEX crawl_runs_store_raw ON crawl_runs(store_id, raw_sha256);

-- Snapshots that were rejected (validation / sanity). Kept for observability;
-- they never influence history.
CREATE TABLE rejected_runs (
  rejected_id     INTEGER PRIMARY KEY,
  store_id        TEXT    NOT NULL,
  observed_at     INTEGER,
  raw_sha256      TEXT,
  reason_json     TEXT    NOT NULL,
  rejected_at     TEXT    NOT NULL
);

CREATE TABLE products (
  product_id          INTEGER PRIMARY KEY,
  store_id            TEXT    NOT NULL REFERENCES stores(store_id),
  external_product_id TEXT    NOT NULL,
  page_key            TEXT    NOT NULL,
  first_seen_at       INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  UNIQUE (store_id, external_product_id)
);
CREATE INDEX products_page_key ON products(store_id, page_key);

CREATE TABLE product_aliases (
  product_id    INTEGER NOT NULL REFERENCES products(product_id),
  store_id      TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  value         TEXT    NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  PRIMARY KEY (product_id, kind, value)
) WITHOUT ROWID;
CREATE INDEX product_aliases_lookup ON product_aliases(store_id, kind, value);

CREATE TABLE offers (
  offer_id          INTEGER PRIMARY KEY,
  product_id        INTEGER NOT NULL REFERENCES products(product_id),
  external_offer_id TEXT    NOT NULL,
  offer_kind        TEXT    NOT NULL,
  sku               TEXT,
  variant_name      TEXT,
  UNIQUE (product_id, external_offer_id)
);

-- One row per (offer, comparable pricing basis). Prices of different bases
-- form separate segments and are never compared.
CREATE TABLE price_bases (
  price_basis_id INTEGER PRIMARY KEY,
  offer_id       INTEGER NOT NULL REFERENCES offers(offer_id),
  basis_key      TEXT    NOT NULL,
  quote_kind     TEXT    NOT NULL,
  tax_treatment  TEXT    NOT NULL,
  currency       TEXT    NOT NULL,
  unit_label     TEXT,
  UNIQUE (offer_id, basis_key)
);

-- Presence hierarchy: product presence is observed in every run of the store,
-- offer presence in runs where the product was present, price-basis presence
-- in runs where the offer was present.
CREATE TABLE presence_events (
  entity_kind TEXT    NOT NULL CHECK (entity_kind IN ('product', 'offer', 'price_basis')),
  entity_id   INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  present     INTEGER NOT NULL CHECK (present IN (0, 1)),
  PRIMARY KEY (entity_kind, entity_id, observed_at)
) WITHOUT ROWID;

CREATE TABLE price_events (
  price_basis_id   INTEGER NOT NULL REFERENCES price_bases(price_basis_id),
  observed_at      INTEGER NOT NULL,
  state            TEXT    NOT NULL CHECK (state IN ('exact', 'range', 'unavailable')),
  min_amount_minor INTEGER,
  max_amount_minor INTEGER,
  PRIMARY KEY (price_basis_id, observed_at)
) WITHOUT ROWID;

CREATE TABLE availability_events (
  offer_id           INTEGER NOT NULL REFERENCES offers(offer_id),
  observed_at        INTEGER NOT NULL,
  state              TEXT    NOT NULL,
  purchasable        INTEGER,
  quantity_semantics TEXT    NOT NULL,
  raw_status         TEXT,
  PRIMARY KEY (offer_id, observed_at)
) WITHOUT ROWID;

-- Site-reported quantity change points. Subject to retention (see
-- inventory_rollups); NULL quantity means "not exposed", never zero.
CREATE TABLE inventory_samples (
  offer_id    INTEGER NOT NULL REFERENCES offers(offer_id),
  observed_at INTEGER NOT NULL,
  quantity    INTEGER,
  PRIMARY KEY (offer_id, observed_at)
) WITHOUT ROWID;

-- Daily rollups produced when raw samples age out of the retention window.
CREATE TABLE inventory_rollups (
  offer_id     INTEGER NOT NULL REFERENCES offers(offer_id),
  day          TEXT    NOT NULL,
  min_quantity INTEGER,
  max_quantity INTEGER,
  last_quantity INTEGER,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (offer_id, day)
) WITHOUT ROWID;

CREATE TABLE metadata_events (
  product_id    INTEGER NOT NULL REFERENCES products(product_id),
  observed_at   INTEGER NOT NULL,
  name          TEXT    NOT NULL,
  model_number  TEXT,
  category      TEXT,
  canonical_url TEXT    NOT NULL,
  -- "suspicious identity reuse" (name and model number changed together) is
  -- derived at read time from consecutive change points, so it stays exact
  -- under out-of-order imports.
  PRIMARY KEY (product_id, observed_at)
) WITHOUT ROWID;
`;
