/**
 * Account-owned workspace and sync-location routes.
 *
 * Public clients save only the sync location metadata here. User data remains
 * in the location configured by the desktop or mobile client, and worker data
 * is scoped by account session plus workspace id.
 */
import { readAccountSessionFromRequest } from "./account-auth-api.js";
import { AccountAuthEnv, ensureAccountSchema, missingDb, requireDb } from "./account-storage.js";
import { json, safeJson } from "./worker-support.js";

interface WorkspaceBindPayload {
  workspaceId?: unknown;
  displayName?: unknown;
  syncBackend?: unknown;
}

const DEFAULT_SYNC_BACKEND_TYPE = "local_directory";

export async function handleAccountWorkspaceBind(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);

  const payload = await safeJson<WorkspaceBindPayload>(request);
  const workspaceId = readWorkspaceId(payload.workspaceId);
  if (!workspaceId) return json({ ok: false, error: "invalid_workspace_id" }, 400);

  const now = new Date().toISOString();
  const displayName = readDisplayName(payload.displayName);
  const syncBackend = normalizeSyncBackend(payload.syncBackend);
  await upsertWorkspace(db, {
    accountId: account.accountId,
    workspaceId,
    displayName,
    syncBackend,
    now,
  });
  return json({
    ok: true,
    workspace: buildWorkspaceResponse({
      workspaceId,
      ownerUserId: account.accountId,
      displayName,
      syncBackendType: syncBackend.type,
      syncBackendConfigJson: syncBackend.configJson,
      createdAt: now,
      updatedAt: now,
    }),
  });
}

export async function handleAccountWorkspaceList(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);

  const result = await db.prepare(
    "SELECT workspace_id AS workspaceId, owner_user_id AS ownerUserId, display_name AS displayName, sync_backend_type AS syncBackendType, sync_backend_config_json AS syncBackendConfigJson, created_at AS createdAt, updated_at AS updatedAt FROM account_workspaces WHERE account_id = ? ORDER BY updated_at DESC",
  ).bind(account.accountId).all();
  return json({ ok: true, workspaces: (result.results ?? []).map(buildWorkspaceResponse) });
}

export async function handleAccountSyncLocationSave(request: Request, env: AccountAuthEnv): Promise<Response> {
  return handleAccountWorkspaceBind(request, env);
}

export async function handleAccountSyncLocationGet(request: Request, env: AccountAuthEnv): Promise<Response> {
  const db = requireDb(env);
  if (!db) return missingDb();
  await ensureAccountSchema(db);

  const account = await readAccountSessionFromRequest(request, env);
  if (!account) return json({ ok: false, error: "unauthorized" }, 401);

  const payload = await safeJson<WorkspaceBindPayload>(request);
  const workspaceId = readWorkspaceId(payload.workspaceId);
  if (!workspaceId) return json({ ok: false, error: "invalid_workspace_id" }, 400);

  const row = await db.prepare(
    "SELECT workspace_id AS workspaceId, owner_user_id AS ownerUserId, display_name AS displayName, sync_backend_type AS syncBackendType, sync_backend_config_json AS syncBackendConfigJson, created_at AS createdAt, updated_at AS updatedAt FROM account_workspaces WHERE account_id = ? AND workspace_id = ?",
  ).bind(account.accountId, workspaceId).first();
  if (!row) return json({ ok: false, error: "workspace_not_found" }, 404);
  return json({ ok: true, workspace: buildWorkspaceResponse(row) });
}

function readWorkspaceId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9._:-]{3,120}$/.test(text) ? text : "";
}

function readDisplayName(value: unknown): string {
  return String(value ?? "").trim().slice(0, 120);
}

function normalizeSyncBackend(value: unknown): { type: string; configJson: string } {
  if (!value || typeof value !== "object") {
    return { type: DEFAULT_SYNC_BACKEND_TYPE, configJson: "{}" };
  }
  const record = value as Record<string, unknown>;
  const type = record.type === DEFAULT_SYNC_BACKEND_TYPE ? DEFAULT_SYNC_BACKEND_TYPE : "";
  if (!type) return { type: DEFAULT_SYNC_BACKEND_TYPE, configJson: "{}" };
  const config = record.config && typeof record.config === "object"
    ? normalizeLocalDirectoryConfig(record.config as Record<string, unknown>)
    : {};
  return { type, configJson: JSON.stringify(config) };
}

function normalizeLocalDirectoryConfig(config: Record<string, unknown>): Record<string, string> {
  const localPath = String(config.localPath ?? "").trim();
  return localPath ? { localPath: localPath.slice(0, 1024) } : {};
}

async function upsertWorkspace(db: D1Database, input: {
  accountId: string;
  workspaceId: string;
  displayName: string;
  syncBackend: { type: string; configJson: string };
  now: string;
}): Promise<void> {
  await db.prepare(
    "INSERT INTO account_workspaces (account_id, workspace_id, owner_user_id, created_at, updated_at, display_name, sync_backend_type, sync_backend_config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET account_id = excluded.account_id, owner_user_id = excluded.owner_user_id, updated_at = excluded.updated_at, display_name = excluded.display_name, sync_backend_type = excluded.sync_backend_type, sync_backend_config_json = excluded.sync_backend_config_json",
  ).bind(
    input.accountId,
    input.workspaceId,
    input.accountId,
    input.now,
    input.now,
    input.displayName,
    input.syncBackend.type,
    input.syncBackend.configJson,
  ).run();
}

function buildWorkspaceResponse(row: Record<string, unknown>): {
  workspaceId: string;
  ownerUserId: string;
  displayName: string;
  syncBackend: { type: string; config: Record<string, unknown> };
  createdAt: string;
  updatedAt: string;
} {
  return {
    workspaceId: String(row.workspaceId ?? ""),
    ownerUserId: String(row.ownerUserId ?? ""),
    displayName: String(row.displayName ?? ""),
    syncBackend: {
      type: String(row.syncBackendType ?? DEFAULT_SYNC_BACKEND_TYPE),
      config: parseSyncBackendConfig(row.syncBackendConfigJson),
    },
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function parseSyncBackendConfig(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
