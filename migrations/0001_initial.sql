-- Initial schema for customs-agent.
-- See CLAUDE.md for the source of truth on entities.
-- All monetary values are stored as INTEGER cents. All timestamps as TEXT UTC ISO 8601.

PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  importer_number TEXT,
  email           TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL
);

CREATE TABLE shipments (
  id                 TEXT PRIMARY KEY,
  customer_id        TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status             TEXT NOT NULL,
  country_of_origin  TEXT NOT NULL,
  port_of_entry      TEXT,
  estimated_arrival  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX idx_shipments_customer ON shipments(customer_id);
CREATE INDEX idx_shipments_status ON shipments(status);

CREATE TABLE line_items (
  id                    TEXT PRIMARY KEY,
  shipment_id           TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  description           TEXT NOT NULL,
  quantity              REAL NOT NULL,
  unit_value_cents      INTEGER NOT NULL,
  country_of_origin     TEXT NOT NULL,
  manufacturer          TEXT,
  material_composition  TEXT,
  intended_use          TEXT
);

CREATE INDEX idx_line_items_shipment ON line_items(shipment_id);

CREATE TABLE classifications (
  id                       TEXT PRIMARY KEY,
  line_item_id             TEXT NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  hts_code                 TEXT NOT NULL,
  description              TEXT NOT NULL,
  gri_rule_applied         INTEGER NOT NULL,
  citations_json           TEXT NOT NULL, -- JSON array of Citation
  alternatives_json        TEXT NOT NULL, -- JSON array
  confidence               REAL NOT NULL,
  reasoning_trace          TEXT NOT NULL,
  model_version            TEXT NOT NULL,
  reviewed_by              TEXT,
  reviewed_at              TEXT,
  created_at               TEXT NOT NULL
);

CREATE INDEX idx_classifications_line_item ON classifications(line_item_id);
CREATE INDEX idx_classifications_hts ON classifications(hts_code);

-- Per-customer SKU master (CLAUDE.md §9 — long-term moat).
-- A "SKU" is identified by (customer_id, sku) where sku is whatever the
-- importer uses internally. Same SKU should classify the same way every time.
CREATE TABLE sku_master (
  customer_id          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sku                  TEXT NOT NULL,
  canonical_description TEXT NOT NULL,
  current_hts_code     TEXT NOT NULL,
  current_classification_id TEXT REFERENCES classifications(id),
  last_classified_at   TEXT NOT NULL,
  PRIMARY KEY (customer_id, sku)
);

-- Append-only audit log (CLAUDE.md §10 — reasonable-care documentation).
-- Every write to classifications / shipments / sku_master adds a row here.
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  occurred_at   TEXT NOT NULL,
  actor         TEXT NOT NULL,         -- "system:classifier@<modelVersion>" or "broker:<userId>"
  entity_kind   TEXT NOT NULL,         -- "shipment" | "line_item" | "classification" | "sku_master"
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,         -- "create" | "update" | "approve" | "correct" | "file"
  payload_json  TEXT NOT NULL          -- full before/after snapshot
);

CREATE INDEX idx_audit_entity ON audit_log(entity_kind, entity_id);
CREATE INDEX idx_audit_occurred_at ON audit_log(occurred_at);
