import type { MobileOwnerPayload } from "./mobile-shared.js";
import { json, safeJson } from "./worker-support.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

interface MobileCodexQuotaEnv {
  DB?: D1Database;
  QUOTA_READER_URL?: string;
  QUOTA_READER_TOKEN?: string;
}

interface CodexTokenSyncPayload extends MobileOwnerPayload {
  account?: {
    name?: unknown;
    email?: unknown;
    planType?: unknown;
    accessToken?: unknown;
    refreshToken?: unknown;
    accountId?: unknown;
  };
}

interface StoredCodexToken {
  ownerUid: string;
  accountName: string;
  email: string | null;
  planType: string | null;
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
}

interface CodexQuota {
  fetchedAt: string;
  primaryWindow?: CodexQuotaWindow;
  secondaryWindow?: CodexQuotaWindow;
  error?: string;
}

interface CodexQuotaWindow {
  usedPercent: number | null;
  resetsAt: string | null;
}

interface CodexQuotaAccount {
  name: string;
  provider: "codex";
  email?: string;
  enabled: true;
  planType?: string;
  quota: CodexQuota;
}

interface RefreshTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
}

interface QuotaReaderResponse {
  ok?: unknown;
  quota?: unknown;
  error?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  accountId?: unknown;
  email?: unknown;
}

export async function handleMobileCodexQuotaTokenSync(
  request: Request,
  env: MobileCodexQuotaEnv,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<CodexTokenSyncPayload>(request);
  const ownerUid = readText(payload.ownerUid);
  const account = payload.account;
  const accountName = readText(account?.name);
  const accessToken = readText(account?.accessToken);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!accountName) return json({ ok: false, error: "missing_account_name" }, 400);
  if (!accessToken) return json({ ok: false, error: "missing_access_token" }, 400);

  await env.DB.prepare(
    "INSERT INTO mobile_codex_tokens (owner_uid, account_name, email, plan_type, access_token, refresh_token, account_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(owner_uid, account_name) DO UPDATE SET email = excluded.email, plan_type = excluded.plan_type, access_token = excluded.access_token, refresh_token = excluded.refresh_token, account_id = excluded.account_id, updated_at = CURRENT_TIMESTAMP",
  ).bind(
    ownerUid,
    accountName,
    readText(account?.email),
    readText(account?.planType),
    accessToken,
    readText(account?.refreshToken),
    readText(account?.accountId),
  ).run();

  return json({ ok: true, synced: true });
}

export async function handleMobileCodexQuotaRefresh(
  request: Request,
  env: MobileCodexQuotaEnv,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileOwnerPayload>(request);
  const ownerUid = readText(payload.ownerUid);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);

  const tokens = await readStoredCodexTokens(env.DB, ownerUid);
  const accounts: CodexQuotaAccount[] = [];
  for (const token of tokens) {
    accounts.push(await quotaAccountFromToken(env, token));
  }
  return json({ ok: true, accounts });
}

async function readStoredCodexTokens(db: D1Database, ownerUid: string): Promise<StoredCodexToken[]> {
  const response = await db.prepare(
    "SELECT owner_uid AS ownerUid, account_name AS accountName, email, plan_type AS planType, access_token AS accessToken, refresh_token AS refreshToken, account_id AS accountId FROM mobile_codex_tokens WHERE owner_uid = ? ORDER BY updated_at DESC",
  ).bind(ownerUid).all();
  return (response.results ?? []).map((row) => ({
    ownerUid: readText(row.ownerUid),
    accountName: readText(row.accountName),
    email: readNullableText(row.email),
    planType: readNullableText(row.planType),
    accessToken: readText(row.accessToken),
    refreshToken: readNullableText(row.refreshToken),
    accountId: readNullableText(row.accountId),
  })).filter((token) => token.ownerUid && token.accountName && token.accessToken);
}

async function quotaAccountFromToken(env: MobileCodexQuotaEnv, token: StoredCodexToken): Promise<CodexQuotaAccount> {
  const readerResult = await fetchQuotaFromReader(env, token);
  if (readerResult) {
    if (readerResult.tokenPatch && env.DB) {
      await updateStoredToken(env.DB, token, readerResult.tokenPatch);
    }
    const nextToken = { ...token, ...readerResult.tokenPatch };
    return {
      name: nextToken.accountName,
      provider: "codex",
      ...(nextToken.email ? { email: nextToken.email } : {}),
      ...(nextToken.planType ? { planType: nextToken.planType } : {}),
      enabled: true,
      quota: readerResult.quota,
    };
  }
  const refreshedToken = await ensureUsableCodexToken(env.DB!, token);
  const quota = await fetchCodexQuota(refreshedToken);
  return {
    name: refreshedToken.accountName,
    provider: "codex",
    ...(refreshedToken.email ? { email: refreshedToken.email } : {}),
    ...(refreshedToken.planType ? { planType: refreshedToken.planType } : {}),
    enabled: true,
    quota,
  };
}

async function ensureUsableCodexToken(db: D1Database, token: StoredCodexToken): Promise<StoredCodexToken> {
  const first = await requestCodexUsage(token);
  if (first.response.ok) {
    return token;
  }
  if (!isRefreshableUsageStatus(first.response.status) || !token.refreshToken) {
    return token;
  }
  const refreshed = await refreshCodexToken(token);
  if (!refreshed) {
    return token;
  }
  await updateStoredToken(db, token, refreshed);
  return { ...token, ...refreshed };
}

async function updateStoredToken(
  db: D1Database,
  token: StoredCodexToken,
  patch: Partial<StoredCodexToken>,
): Promise<void> {
  await db.prepare(
    "UPDATE mobile_codex_tokens SET access_token = COALESCE(?, access_token), refresh_token = COALESCE(?, refresh_token), account_id = COALESCE(?, account_id), email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP WHERE owner_uid = ? AND account_name = ?",
  ).bind(
    patch.accessToken ?? null,
    patch.refreshToken ?? null,
    patch.accountId ?? null,
    patch.email ?? null,
    token.ownerUid,
    token.accountName,
  ).run();
}

function isRefreshableUsageStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function fetchCodexQuota(token: StoredCodexToken): Promise<CodexQuota> {
  try {
    const { response, payload } = await requestCodexUsage(token);
    if (!response.ok) {
      throw new Error(readQuotaError(payload) || `Codex quota HTTP ${response.status}`);
    }
    return readCodexQuota(payload);
  } catch (error) {
    return {
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// fallow-ignore-next-line complexity
async function fetchQuotaFromReader(
  env: MobileCodexQuotaEnv,
  token: StoredCodexToken,
): Promise<{ quota: CodexQuota; tokenPatch?: Partial<StoredCodexToken> } | null> {
  const readerUrl = readText(env.QUOTA_READER_URL).replace(/\/+$/, "");
  const readerToken = readText(env.QUOTA_READER_TOKEN);
  if (!readerUrl || !readerToken) {
    return null;
  }
  try {
    const response = await fetch(`${readerUrl}/api/codex-quota-reader/read`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        accountId: token.accountId,
      }),
    });
    const payload = await readJsonPayload(response);
    if (!response.ok || !isRecord(payload)) {
      const errorMessage = isRecord(payload) ? readText(payload.error) : "";
      throw new Error(errorMessage || `Quota reader HTTP ${response.status}`);
    }
    const readerPayload = payload as QuotaReaderResponse;
    if (readerPayload.ok === false) {
      throw new Error(readText(readerPayload.error) || `Quota reader HTTP ${response.status}`);
    }
    return {
      quota: readCodexQuota(readerPayload.quota),
      tokenPatch: {
        accessToken: readNullableText(readerPayload.accessToken) ?? undefined,
        refreshToken: readNullableText(readerPayload.refreshToken) ?? undefined,
        accountId: readNullableText(readerPayload.accountId) ?? undefined,
        email: readNullableText(readerPayload.email) ?? undefined,
      },
    };
  } catch (error) {
    return {
      quota: {
        fetchedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function requestCodexUsage(token: StoredCodexToken): Promise<{ response: Response; payload: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.accessToken}`,
    Accept: "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Origin: "https://chatgpt.com",
    Referer: "https://chatgpt.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  };
  if (token.accountId) headers["chatgpt-account-id"] = token.accountId;
  const response = await fetch(CODEX_USAGE_URL, { headers });
  return { response, payload: await readJsonPayload(response) };
}

async function refreshCodexToken(token: StoredCodexToken): Promise<Partial<StoredCodexToken> | null> {
  if (!token.refreshToken) return null;
  const body = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
    scope: "openid profile email",
  });
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await readJsonPayload(response);
  if (!response.ok || !isRecord(payload)) {
    return null;
  }
  const tokenPayload = payload as RefreshTokenResponse;
  const accessToken = readText(tokenPayload.access_token);
  if (!accessToken) {
    return null;
  }
  const idClaims = readJwtPayload(readText(tokenPayload.id_token));
  const email = readText(idClaims.email);
  const authClaims = readRecord(idClaims["https://api.openai.com/auth"]);
  return {
    accessToken,
    refreshToken: readNullableText(tokenPayload.refresh_token) ?? token.refreshToken,
    accountId: readNullableText(authClaims.chatgpt_account_id) ?? token.accountId,
    email: email || token.email,
  };
}

function readCodexQuota(payload: unknown): CodexQuota {
  const record = isRecord(payload) ? payload : {};
  const rateLimit = isRecord(record.rate_limit) ? record.rate_limit : record;
  return {
    fetchedAt: new Date().toISOString(),
    primaryWindow: readQuotaWindow(rateLimit.primary_window),
    secondaryWindow: readQuotaWindow(rateLimit.secondary_window),
  };
}

function readQuotaWindow(value: unknown): CodexQuotaWindow | undefined {
  if (!isRecord(value)) return undefined;
  return {
    usedPercent: readNumber(value.used_percent),
    resetsAt: readResetTime(value),
  };
}

function readResetTime(value: Record<string, unknown>): string | null {
  const direct = readNullableText(value.resets_at);
  if (direct) return direct;
  const resetAt = readNumber(value.reset_at);
  if (resetAt !== null) return new Date(resetAt * 1000).toISOString();
  const resetAfter = readNumber(value.reset_after_seconds);
  if (resetAfter !== null) return new Date(Date.now() + resetAfter * 1000).toISOString();
  return null;
}

function readQuotaError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return readNullableText(payload.error)
    ?? readNullableText(readRecord(payload.error).message)
    ?? readNullableText(payload.message);
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function readJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    return readRecord(JSON.parse(atob(padded)) as unknown);
  } catch {
    return {};
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableText(value: unknown): string | null {
  const text = readText(value);
  return text || null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
