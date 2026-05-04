/**
 * Shared account storage helpers for authentication and workspace routes.
 *
 * The Worker creates these tables defensively for local tests and first-run
 * development deployments. Production D1 deployments still use migrations as
 * the authoritative schema history.
 */
import { json } from "./worker-support.js";

export interface AccountAuthEnv {
  DB?: D1Database;
}

export async function ensureAccountSchema(db: D1Database): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS account_identities (type TEXT NOT NULL, identifier TEXT NOT NULL, account_id TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (type, identifier))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_account_identities_account ON account_identities(account_id)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS account_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions(account_id)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS account_wechat_login_challenges (id TEXT PRIMARY KEY, poll_token_hash TEXT NOT NULL, status TEXT NOT NULL, account_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, confirmed_at TEXT, consumed_at TEXT)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_account_wechat_login_challenges_expires ON account_wechat_login_challenges(expires_at)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS account_workspaces (workspace_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', sync_backend_type TEXT NOT NULL DEFAULT 'local_directory', sync_backend_config_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_account_workspaces_account ON account_workspaces(account_id, updated_at DESC)").run();
}

export function requireDb(env: AccountAuthEnv): D1Database | null {
  return env.DB ?? null;
}

export function missingDb(): Response {
  return json({ ok: false, error: "missing_d1_binding" }, 500);
}
