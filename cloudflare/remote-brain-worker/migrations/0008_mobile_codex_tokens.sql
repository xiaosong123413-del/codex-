CREATE TABLE IF NOT EXISTS mobile_codex_tokens (
  owner_uid TEXT NOT NULL,
  account_name TEXT NOT NULL,
  email TEXT,
  plan_type TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  account_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_uid, account_name)
);
