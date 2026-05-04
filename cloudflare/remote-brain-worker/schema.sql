CREATE TABLE IF NOT EXISTS publish_runs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  wiki_root TEXT NOT NULL,
  publish_version TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  published_at TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  index_file_count INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  r2_key TEXT,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mobile_entries (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  media_files_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  target_date TEXT NOT NULL,
  status TEXT NOT NULL,
  channel TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  desktop_path TEXT,
  synced_at TEXT,
  failed_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mobile_entries_owner_created
  ON mobile_entries(owner_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_ai_providers (
  owner_uid TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  api_name TEXT,
  api_base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  image_model TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_identities (
  type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  account_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (type, identifier)
);

CREATE INDEX IF NOT EXISTS idx_account_identities_account
  ON account_identities(account_id);

CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_sessions_account
  ON account_sessions(account_id);

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

CREATE TABLE IF NOT EXISTS account_workspaces (
  workspace_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  sync_backend_type TEXT NOT NULL DEFAULT 'local_directory',
  sync_backend_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_workspaces_account
  ON account_workspaces(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS account_ai_settings (
  account_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mobile_chats (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'wiki',
  messages_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_chats_owner_updated
  ON mobile_chats(owner_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS web_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  web_search_enabled INTEGER NOT NULL DEFAULT 0,
  search_scope TEXT NOT NULL DEFAULT 'local',
  agent_id TEXT,
  article_refs_json TEXT NOT NULL DEFAULT '[]',
  messages_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_web_conversations_updated
  ON web_conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS wiki_comments (
  id TEXT PRIMARY KEY,
  page_path TEXT NOT NULL,
  quote TEXT NOT NULL,
  comment TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_comments_page_updated
  ON wiki_comments(page_path, updated_at DESC);
