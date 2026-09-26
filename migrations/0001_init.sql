-- Markt- und Trend-Analyse — Grundschema (M1)
-- SQLite/D1. IDs sind TEXT (UUIDv7), Zeitstempel ISO-8601 in UTC, zusammengesetzte Werte als JSON-Text.

PRAGMA foreign_keys = ON;

-- ---------- Nutzer, Protokoll, Oberflaechenzustand ----------
CREATE TABLE IF NOT EXISTS radar_user_role (
  username   TEXT PRIMARY KEY,
  role       TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  username     TEXT,
  action       TEXT NOT NULL,
  subject_type TEXT,
  subject_id   TEXT,
  detail       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);

-- Ersetzt den localStorage des Prototyps: Ansichtszustand je Nutzer.
CREATE TABLE IF NOT EXISTS app_state (
  username   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (username, key)
);

-- ---------- Stammdaten ----------
CREATE TABLE IF NOT EXISTS country (
  code         TEXT PRIMARY KEY CHECK (code IN ('DE','SE','IT','FR','PL','GB-ENG','NO')),
  name_de      TEXT NOT NULL,
  languages    TEXT NOT NULL,          -- JSON-Array
  active_since TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS concept (
  id         TEXT PRIMARY KEY,         -- z. B. moment.baptism
  dimension  TEXT NOT NULL CHECK (dimension IN ('A','B','C','D','E','F')),
  parent_id  TEXT,
  label_de   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','candidate','retired')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concept_dim ON concept (dimension, status);

CREATE TABLE IF NOT EXISTS lexeme (
  id           TEXT PRIMARY KEY,
  concept_id   TEXT NOT NULL REFERENCES concept(id) ON DELETE CASCADE,
  lang         TEXT NOT NULL,
  country_code TEXT,
  term         TEXT NOT NULL,
  is_commercial_modifier INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lexeme_concept ON lexeme (concept_id, lang);

CREATE TABLE IF NOT EXISTS catalog_item (
  id          TEXT PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  product_type TEXT NOT NULL,
  materials   TEXT,                    -- JSON-Array
  surfaces    TEXT,                    -- JSON-Array
  moments     TEXT,                    -- JSON-Array von concept.id
  vectorize_id TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS technique_compatibility (
  surface    TEXT NOT NULL,
  technique  TEXT NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3),
  notes      TEXT,
  tested_at  TEXT,
  PRIMARY KEY (surface, technique)
);

-- ---------- Signale und Zeitreihen ----------
CREATE TABLE IF NOT EXISTS source (
  key               TEXT PRIMARY KEY,
  sensor            TEXT NOT NULL CHECK (sensor IN ('A','B','C','D','E','F')),
  tier              INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
  legal_basis       TEXT,
  tos_status        TEXT NOT NULL DEFAULT 'review_pending' CHECK (tos_status IN ('ok','review_pending','blocked')),
  reliability_weight REAL NOT NULL DEFAULT 1.0,
  geo_granularity   TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  last_success_at   TEXT,
  last_error        TEXT
);

CREATE TABLE IF NOT EXISTS raw_signal (
  id           TEXT PRIMARY KEY,
  source_key   TEXT NOT NULL,
  sensor       TEXT NOT NULL,
  country_code TEXT NOT NULL,
  geo_level    TEXT NOT NULL DEFAULT 'country' CHECK (geo_level IN ('country','subregion','uk_proxy')),
  lang         TEXT,
  signal_type  TEXT NOT NULL,
  url          TEXT,
  observed_at  TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  payload      TEXT,                   -- JSON, nur erlaubte Felder
  license_status TEXT,
  dedupe_hash  TEXT NOT NULL,
  run_id       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_dedupe ON raw_signal (source_key, dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_raw_country_time ON raw_signal (country_code, observed_at);

-- raw_signal und audit_log sind append-only.
CREATE TRIGGER IF NOT EXISTS raw_signal_no_update BEFORE UPDATE ON raw_signal
BEGIN SELECT RAISE(ABORT, 'raw_signal ist append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log ist append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log ist append-only'); END;

CREATE TABLE IF NOT EXISTS ts_point (
  country_code TEXT NOT NULL,
  source_key   TEXT NOT NULL,
  concept_id   TEXT NOT NULL,
  iso_week     TEXT NOT NULL,
  value_raw    REAL,
  value_scaled REAL,
  deseasonalized REAL,
  seasonality_method TEXT,
  PRIMARY KEY (country_code, source_key, concept_id, iso_week)
);
CREATE INDEX IF NOT EXISTS idx_ts_lookup ON ts_point (country_code, concept_id, iso_week);

-- ---------- Zyklen, Trends ----------
CREATE TABLE IF NOT EXISTS cycle (
  id         TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'computed',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trend (
  id           TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  label_de     TEXT NOT NULL,
  label_local  TEXT,
  concept_ids  TEXT NOT NULL,          -- JSON-Array (Anzeige)
  origin       TEXT NOT NULL DEFAULT 'timeseries',
  first_flagged_at TEXT,
  first_noticed_internally_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trend_country ON trend (country_code);

CREATE TABLE IF NOT EXISTS trend_concept (
  trend_id   TEXT NOT NULL REFERENCES trend(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL,
  PRIMARY KEY (trend_id, concept_id)
);

CREATE TABLE IF NOT EXISTS trend_snapshot (
  id            TEXT PRIMARY KEY,
  trend_id      TEXT NOT NULL REFERENCES trend(id) ON DELETE CASCADE,
  cycle_id      TEXT NOT NULL,
  country_code  TEXT NOT NULL,
  velocity      REAL, acceleration REAL, novelty REAL, persistence REAL,
  cross_source  REAL, cli_level REAL, cli_delta REAL, commercial REAL,
  tms           REAL, sdi REAL, divergence_pattern TEXT,
  lifecycle_class TEXT, lifecycle_posterior TEXT, confidence REAL,
  mrs           REAL, mrs_components TEXT,
  priority      REAL,
  coverage      REAL,
  weak_signal   INTEGER NOT NULL DEFAULT 0,
  is_exploration INTEGER NOT NULL DEFAULT 0,
  geo_confidence TEXT NOT NULL DEFAULT 'high',
  opportunity_window TEXT,
  explanations  TEXT,
  config_version TEXT,
  run_id        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshot_cycle ON trend_snapshot (country_code, cycle_id, priority DESC);

CREATE TABLE IF NOT EXISTS review_decision (
  id           TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,          -- trend | creator | company
  subject_id   TEXT NOT NULL,
  decision     TEXT NOT NULL,
  reason_code  TEXT,
  note         TEXT,
  username     TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_subject ON review_decision (subject_type, subject_id, created_at);

-- ---------- Creator Radar (Discovery Layer) ----------
CREATE TABLE IF NOT EXISTS creator_candidate (
  id            TEXT PRIMARY KEY,
  country_code  TEXT NOT NULL,
  platform      TEXT NOT NULL,
  handle        TEXT NOT NULL,
  public_url    TEXT,
  display_name  TEXT,
  region        TEXT,                  -- max. Stadt/Region
  creative_categories TEXT,            -- JSON-Array
  follower_count INTEGER,
  discovered_via TEXT,
  discovered_at TEXT NOT NULL,
  purge_after   TEXT,
  status        TEXT NOT NULL DEFAULT 'discovered'
                CHECK (status IN ('discovered','scout_check_pending','shortlisted','interview_planned','promoted_to_crm','rejected','suppressed','purged')),
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_handle ON creator_candidate (platform, handle);
CREATE INDEX IF NOT EXISTS idx_creator_country_status ON creator_candidate (country_code, status);

CREATE TABLE IF NOT EXISTS evidence_item (
  id           TEXT PRIMARY KEY,
  creator_candidate_id TEXT NOT NULL REFERENCES creator_candidate(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  url          TEXT,
  excerpt      TEXT,                   -- max. 280 Zeichen
  observed_at  TEXT NOT NULL,
  captured_by  TEXT NOT NULL,          -- scout:<user> | connector:<key>
  public_professional INTEGER NOT NULL DEFAULT 1,
  creative_work_related INTEGER NOT NULL DEFAULT 1,
  counterpart_hash TEXT,
  confidence   REAL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_creator ON evidence_item (creator_candidate_id, observed_at);

CREATE TABLE IF NOT EXISTS creator_project (
  id           TEXT PRIMARY KEY,
  creator_candidate_id TEXT NOT NULL REFERENCES creator_candidate(id) ON DELETE CASCADE,
  url          TEXT,
  state        TEXT NOT NULL CHECK (state IN ('started','in_progress','finished')),
  concept_ids  TEXT,
  techniques   TEXT,
  observed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_score_snapshot (
  id           TEXT PRIMARY KEY,
  creator_candidate_id TEXT NOT NULL REFERENCES creator_candidate(id) ON DELETE CASCADE,
  cycle_id     TEXT,
  sei REAL, cci REAL, mmf REAL,
  components   TEXT,                   -- JSON
  coverage     REAL,
  exclusion_flags TEXT,                -- JSON-Array
  explanations TEXT,                   -- JSON-Array
  config_version TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cscore_creator ON creator_score_snapshot (creator_candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS human_scorecard (
  creator_candidate_id TEXT PRIMARY KEY REFERENCES creator_candidate(id) ON DELETE CASCADE,
  makes INTEGER, shows INTEGER, tries INTEGER, helps INTEGER, connects INTEGER,
  encourages INTEGER, initiates INTEGER, relationship INTEGER, sales_open INTEGER, learning_open INTEGER,
  raw_total INTEGER, weighted_total INTEGER,
  table_test INTEGER,
  notes TEXT,
  scout_username TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------- Neukundenradar (Pipeline A) ----------
CREATE TABLE IF NOT EXISTS company_candidate (
  id           TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  name         TEXT NOT NULL,
  website      TEXT,
  category     TEXT,
  region       TEXT,
  is_sole_trader INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'identified',
  discovered_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_company_country ON company_candidate (country_code, status);

CREATE TABLE IF NOT EXISTS company_score_snapshot (
  id           TEXT PRIMARY KEY,
  company_candidate_id TEXT NOT NULL REFERENCES company_candidate(id) ON DELETE CASCADE,
  cycle_id     TEXT,
  cos          REAL,
  components   TEXT,
  gap_hypothesis TEXT,
  recommended_skus TEXT,
  reasons      TEXT,                   -- JSON-Array mit Belegen
  created_at   TEXT NOT NULL
);

-- ---------- Radar-CRM ----------
CREATE TABLE IF NOT EXISTS crm_contact (
  id           TEXT PRIMARY KEY,
  creator_candidate_id TEXT REFERENCES creator_candidate(id) ON DELETE SET NULL,
  country_code TEXT NOT NULL,
  name         TEXT NOT NULL,
  brand_label  TEXT,
  contact_channel TEXT,
  legal_basis  TEXT,
  art14_notice_sent_at TEXT,
  roles_chosen TEXT,
  owner_username TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_company (
  id           TEXT PRIMARY KEY,
  company_candidate_id TEXT REFERENCES company_candidate(id) ON DELETE SET NULL,
  country_code TEXT NOT NULL,
  name         TEXT NOT NULL,
  website      TEXT,
  category     TEXT,
  stage        TEXT NOT NULL DEFAULT 'qualified'
               CHECK (stage IN ('qualified','contacted','in_conversation','samples_sent','first_order','active_partner','creator_hub','paused','lost')),
  lost_reason  TEXT,
  owner_username TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_company_contact (
  id             TEXT PRIMARY KEY,
  crm_company_id TEXT NOT NULL REFERENCES crm_company(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  role           TEXT,
  business_email TEXT,
  business_phone TEXT,
  legal_basis    TEXT,
  art14_notice_sent_at TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_interaction (
  id           TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('contact','company')),
  subject_id   TEXT NOT NULL,
  channel      TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('out','in')),
  occurred_at  TEXT NOT NULL,
  summary      TEXT,
  recorded_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interaction_subject ON crm_interaction (subject_type, subject_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS crm_task (
  id           TEXT PRIMARY KEY,
  subject_type TEXT,
  subject_id   TEXT,
  title        TEXT NOT NULL,
  due_at       TEXT,
  assignee_username TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  origin       TEXT NOT NULL DEFAULT 'manual',
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_open ON crm_task (assignee_username, status, due_at);

CREATE TABLE IF NOT EXISTS activation_event (
  id             TEXT PRIMARY KEY,
  crm_contact_id TEXT NOT NULL REFERENCES crm_contact(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  occurred_at    TEXT NOT NULL,
  count          INTEGER,
  notes          TEXT,
  recorded_by    TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activation_contact ON activation_event (crm_contact_id, occurred_at);

CREATE TABLE IF NOT EXISTS suppression_entry (
  id          TEXT PRIMARY KEY,
  platform    TEXT,
  handle_hash TEXT NOT NULL,
  reason_code TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppression ON suppression_entry (platform, handle_hash);
