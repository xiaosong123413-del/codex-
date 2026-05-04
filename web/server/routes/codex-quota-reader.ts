import type { Request, Response } from "express";
import { ProxyAgent } from "undici";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

interface CodexQuotaReaderPayload {
  accessToken?: unknown;
  refreshToken?: unknown;
  accountId?: unknown;
}

interface CodexQuota {
  fetchedAt: string;
  primaryWindow?: CodexQuotaWindow;
  secondaryWindow?: CodexQuotaWindow;
}

interface CodexQuotaWindow {
  usedPercent: number | null;
  resetsAt: string | null;
}

interface RefreshTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
}

interface CodexToken {
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
  email: string | null;
}

type QuotaReaderFetchInit = RequestInit & { dispatcher?: unknown };

export function handleCodexQuotaReaderRead() {
  return async (req: Request, res: Response): Promise<void> => {
    if (!isAuthorized(req)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const payload = readRecord(req.body) as CodexQuotaReaderPayload;
    const token: CodexToken = {
      accessToken: readText(payload.accessToken),
      refreshToken: readNullableText(payload.refreshToken),
      accountId: readNullableText(payload.accountId),
      email: null,
    };
    if (!token.accessToken) {
      res.status(400).json({ ok: false, error: "missing_access_token" });
      return;
    }

    try {
      const result = await fetchQuotaWithRefresh(token);
      res.json({
        ok: true,
        quota: result.quota,
        accessToken: result.token.accessToken,
        refreshToken: result.token.refreshToken,
        accountId: result.token.accountId,
        email: result.token.email,
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

async function fetchQuotaWithRefresh(token: CodexToken): Promise<{ quota: CodexQuota; token: CodexToken }> {
  const first = await requestCodexUsage(token);
  if (first.response.ok) {
    return { quota: readCodexQuota(first.payload), token };
  }
  if (!isRefreshableUsageStatus(first.response.status) || !token.refreshToken) {
    throw new Error(readQuotaError(first.payload) || `Codex quota HTTP ${first.response.status}`);
  }

  const refreshed = await refreshCodexToken(token.refreshToken);
  const second = await requestCodexUsage(refreshed);
  if (!second.response.ok) {
    throw new Error(readQuotaError(second.payload) || `Codex quota HTTP ${second.response.status}`);
  }
  return { quota: readCodexQuota(second.payload), token: refreshed };
}

async function requestCodexUsage(token: CodexToken): Promise<{ response: globalThis.Response; payload: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.accessToken}`,
    Accept: "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Origin: "https://chatgpt.com",
    Referer: "https://chatgpt.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  };
  if (token.accountId) headers["chatgpt-account-id"] = token.accountId;
  const response = await quotaReaderFetch(CODEX_USAGE_URL, { headers });
  return { response, payload: await readJsonPayload(response) };
}

async function refreshCodexToken(refreshToken: string): Promise<CodexToken> {
  const body = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "openid profile email",
  });
  const response = await quotaReaderFetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await readJsonPayload(response);
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Codex token refresh HTTP ${response.status}`);
  }
  const tokenPayload = payload as RefreshTokenResponse;
  const accessToken = readText(tokenPayload.access_token);
  if (!accessToken) {
    throw new Error("Codex token refresh missing access token");
  }
  const idClaims = readJwtPayload(readText(tokenPayload.id_token));
  const authClaims = readRecord(idClaims["https://api.openai.com/auth"]);
  return {
    accessToken,
    refreshToken: readNullableText(tokenPayload.refresh_token) ?? refreshToken,
    accountId: readNullableText(authClaims.chatgpt_account_id),
    email: readNullableText(idClaims.email),
  };
}

function quotaReaderFetch(url: string, init: RequestInit): Promise<globalThis.Response> {
  const requestInit: QuotaReaderFetchInit = { ...init };
  const proxyUrl = readText(process.env.CODEX_QUOTA_READER_PROXY_URL);
  if (proxyUrl) requestInit.dispatcher = new ProxyAgent(proxyUrl);
  return fetch(url, requestInit);
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

async function readJsonPayload(response: globalThis.Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function isAuthorized(req: Request): boolean {
  const expected = readText(process.env.CODEX_QUOTA_READER_TOKEN);
  const actual = readText(req.header("authorization")).replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && expected === actual);
}

function isRefreshableUsageStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function readJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    return readRecord(JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown);
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
