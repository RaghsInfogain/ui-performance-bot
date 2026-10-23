-- UI Performance Bot — PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('static', 'scripted')),
  source TEXT NOT NULL DEFAULT 'studio',
  crawl_run_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  step_count INTEGER NOT NULL DEFAULT 0,
  script_number SERIAL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scripts ADD COLUMN IF NOT EXISTS script_number SERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scripts_script_number ON scripts (script_number);

CREATE TABLE IF NOT EXISTS script_rows (
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (script_id, row_index)
);

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_url TEXT NOT NULL DEFAULT '',
  steps JSONB NOT NULL DEFAULT '[]',
  step_count INTEGER NOT NULL DEFAULT 0,
  url_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_updated ON recordings (updated_at DESC);

CREATE TABLE IF NOT EXISTS crawls (
  id TEXT PRIMARY KEY,
  start_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  urls_found INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS crawl_urls (
  crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  transaction_name TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL,
  element_identifier TEXT NOT NULL DEFAULT 'NA',
  element_selector TEXT NOT NULL DEFAULT 'NA',
  PRIMARY KEY (crawl_id, row_index)
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'static',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  hostname TEXT NOT NULL DEFAULT '',
  config_snapshot JSONB NOT NULL DEFAULT '{}',
  test_duration_seconds INTEGER,
  multi_threading INTEGER NOT NULL DEFAULT 1,
  urls_total INTEGER NOT NULL DEFAULT 0,
  script_id TEXT,
  crawl_run_id TEXT,
  exit_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS run_results (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,
  transaction TEXT NOT NULL DEFAULT '',
  timestamp TEXT,
  hostname TEXT,
  fcp DOUBLE PRECISION DEFAULT 0,
  lcp DOUBLE PRECISION DEFAULT 0,
  tbt DOUBLE PRECISION DEFAULT 0,
  cls DOUBLE PRECISION DEFAULT 0,
  speed_index DOUBLE PRECISION DEFAULT 0,
  performance_score DOUBLE PRECISION DEFAULT 0,
  page_load_time DOUBLE PRECISION DEFAULT 0,
  network_time DOUBLE PRECISION DEFAULT 0,
  dns_lookup_time DOUBLE PRECISION DEFAULT 0,
  connection_time DOUBLE PRECISION DEFAULT 0,
  server_processing_time DOUBLE PRECISION DEFAULT 0,
  response_time DOUBLE PRECISION DEFAULT 0,
  browser_time DOUBLE PRECISION DEFAULT 0,
  dom_interaction_time DOUBLE PRECISION DEFAULT 0,
  dom_complete_time DOUBLE PRECISION DEFAULT 0,
  playwright_page_load_time DOUBLE PRECISION DEFAULT 0,
  element_load_time TEXT DEFAULT 'N/A',
  test_status TEXT DEFAULT 'PASS',
  failure_reason TEXT DEFAULT '',
  raw JSONB,
  UNIQUE (run_id, page_url)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_script_rows_script ON script_rows(script_id);
CREATE INDEX IF NOT EXISTS idx_crawl_urls_crawl ON crawl_urls(crawl_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_results_run ON run_results(run_id);

CREATE TABLE IF NOT EXISTS run_reports (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generator TEXT NOT NULL DEFAULT 'auto'
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  frequency TEXT NOT NULL CHECK (frequency IN ('hourly', 'daily', 'weekly')),
  cron_minute INTEGER NOT NULL DEFAULT 0,
  cron_hour INTEGER NOT NULL DEFAULT 9,
  cron_weekday INTEGER,
  mode TEXT NOT NULL DEFAULT 'static',
  script_id TEXT,
  crawl_run_id TEXT,
  test_suite TEXT,
  config_snapshot JSONB NOT NULL DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  last_run_id TEXT,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules (enabled, next_run_at);
