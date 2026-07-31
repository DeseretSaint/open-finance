-- 001_init.sql — Open Finance initial schema (SQLite)
-- Money = INTEGER cents. Timestamps = ISO-8601 UTC TEXT. APR = basis points.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT,
  recovery_code_hash TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  idle_timeout_h INTEGER,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE device_lock (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash TEXT,
  pin_salt TEXT,
  biometric_enabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE plaid_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id_enc TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, environment)
);

CREATE TABLE plaid_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plaid_item_id TEXT UNIQUE,
  institution_id TEXT,
  institution_name TEXT,
  access_token_enc TEXT,
  cursor TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_sync_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT,
  plaid_account_id TEXT UNIQUE,
  name TEXT NOT NULL,
  official_name TEXT,
  type TEXT,
  subtype TEXT,
  mask TEXT,
  current_balance_cents INTEGER,
  available_balance_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_accounts_user ON accounts(user_id);

CREATE TABLE balance_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  UNIQUE (account_id, date)
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  plaid_transaction_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  date TEXT NOT NULL,
  authorized_date TEXT,
  name TEXT NOT NULL,
  merchant_name TEXT,
  category_path TEXT,
  personal_finance_category TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  user_category_id TEXT,
  user_note TEXT,
  exclude_from_budgets INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_txn_account_date ON transactions(account_id, date DESC);
CREATE INDEX idx_txn_date ON transactions(date DESC);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  plaid_paths TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  created_at TEXT NOT NULL
);

CREATE TABLE budget_categories (
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (budget_id, category_id)
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sync_interval_h INTEGER NOT NULL DEFAULT 12,
  hub_mode INTEGER NOT NULL DEFAULT 0,
  hub_url TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  due_day INTEGER,
  next_due_date TEXT,
  last_paid_amount_cents INTEGER,
  category_id TEXT,
  account_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_bills_next_due ON bills(user_id, next_due_date);

CREATE TABLE debts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  principal_cents INTEGER NOT NULL,
  apr_bps INTEGER NOT NULL DEFAULT 0,
  min_payment_cents INTEGER NOT NULL DEFAULT 0,
  term_months INTEGER,
  start_date TEXT NOT NULL,
  next_due_date TEXT,
  account_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'savings',
  category TEXT NOT NULL DEFAULT 'general',
  target_cents INTEGER NOT NULL,
  target_date TEXT,
  current_cents INTEGER NOT NULL DEFAULT 0,
  monthly_contribution_cents INTEGER,
  account_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  preset TEXT NOT NULL DEFAULT 'read-only',
  scopes TEXT NOT NULL,
  account_ids TEXT,
  ui_tabs TEXT,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  last_user_agent TEXT
);

CREATE TABLE agent_access_log (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  scope_used TEXT NOT NULL,
  tool TEXT NOT NULL,
  method TEXT,
  params_json TEXT,
  status INTEGER NOT NULL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_access_log_token ON agent_access_log(token_id, created_at DESC);

CREATE TABLE agent_permission_requests (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX idx_perm_req_pending ON agent_permission_requests(token_id, scope)
  WHERE status = 'pending';

CREATE TABLE custom_views (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_id TEXT,
  tab TEXT NOT NULL CHECK (tab IN ('dashboard','budgets','reports')),
  name TEXT NOT NULL,
  widget_def TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, tab, name)
);

CREATE TABLE pairing_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
