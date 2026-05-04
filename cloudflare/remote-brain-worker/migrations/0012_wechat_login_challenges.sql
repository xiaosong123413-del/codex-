CREATE TABLE IF NOT EXISTS account_wechat_login_challenges (
  id TEXT PRIMARY KEY,
  poll_token_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  account_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_wechat_login_challenges_expires
  ON account_wechat_login_challenges(expires_at);
