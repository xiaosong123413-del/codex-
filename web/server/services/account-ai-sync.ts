/**
 * Desktop account AI sync service.
 *
 * The WebUI still keeps a local copy of API credentials for desktop runtime
 * use, but this service mirrors that copy to the account Worker so another
 * desktop or the Android app can read the same provider/OAuth selection.
 */
import { readLlmProviderConfig, saveLlmProviderConfig } from "./llm-config.js";
import {
  mergeLlmApiAccountsFromSync,
  readLlmApiAccountsForSync,
  type LlmApiAccount,
} from "./llm-accounts.js";
import {
  ACCOUNT_CODEX_OAUTH_REF,
  readAccountAiSyncConfig,
  type AccountAiSyncConfig,
} from "./account-ai-env.js";
import { fetchWithOptionalProxy } from "../../../src/utils/proxy-fetch.js";

interface AccountAiSettings {
  defaultAccountRef?: string;
  apiAccounts?: LlmApiAccount[];
  mobileConfig?: unknown;
  codexOAuth?: Record<string, unknown>;
  updatedAt?: string;
}

interface WorkerSettingsResponse {
  ok?: boolean;
  settings?: unknown;
  updatedAt?: unknown;
  error?: unknown;
}

type AccountAiFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const ACCOUNT_AI_SYNC_TIMEOUT_MS = 10_000;

export async function pullAccountAiSettingsToLocal(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: AccountAiFetcher = defaultAccountAiFetcher(env),
): Promise<AccountAiSettings | null> {
  const settings = await fetchAccountAiSettings(env, fetcher);
  if (!settings) return null;
  if (Array.isArray(settings.apiAccounts)) {
    mergeLlmApiAccountsFromSync(projectRoot, settings.apiAccounts);
  }
  const accountRef = readText(settings.defaultAccountRef);
  if (accountRef) saveLlmProviderConfig(projectRoot, { accountRef }, env);
  return settings;
}

export async function pushLocalAiSettingsToAccount(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: AccountAiFetcher = defaultAccountAiFetcher(env),
): Promise<AccountAiSettings | null> {
  const config = readAccountAiSyncConfig(env);
  if (!config) return null;
  const existing = await fetchAccountAiSettings(env, fetcher).catch(() => null);
  const localConfig = readLlmProviderConfig(projectRoot, env);
  const settings: AccountAiSettings = {
    ...(existing ?? {}),
    defaultAccountRef: localConfig.accountRef,
    apiAccounts: readLlmApiAccountsForSync(projectRoot).accounts,
    codexOAuth: buildCodexOAuthSettings(localConfig.accountRef, localConfig.model, existing),
    updatedAt: new Date().toISOString(),
  };
  await saveAccountAiSettings(settings, env, fetcher, config);
  return settings;
}

export async function fetchAccountAiSettings(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: AccountAiFetcher = defaultAccountAiFetcher(env),
): Promise<AccountAiSettings | null> {
  const config = requireAccountAiSyncConfig(env);
  const payload = await postWorker<WorkerSettingsResponse>(config, "/user/ai/settings/get", {}, fetcher);
  return normalizeSettings(payload.settings, payload.updatedAt);
}

export async function saveAccountAiSettings(
  settings: AccountAiSettings,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: AccountAiFetcher = fetch,
  config = requireAccountAiSyncConfig(env),
): Promise<AccountAiSettings> {
  const payload = await postWorker<WorkerSettingsResponse>(config, "/user/ai/settings/save", { settings }, fetcher);
  const saved = normalizeSettings(payload.settings, payload.updatedAt);
  if (!saved) throw new Error("Worker 没有返回已保存的 AI 设置。");
  return saved;
}

export async function startAccountCodexOAuth(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: AccountAiFetcher = defaultAccountAiFetcher(env),
): Promise<{ url: string; userCode: string; state: string; pollIntervalSeconds: number }> {
  return postWorker(requireAccountAiSyncConfig(env), "/user/ai/codex-oauth/start", {}, fetcher);
}

export async function pollAccountCodexOAuth(
  state: unknown,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: AccountAiFetcher = defaultAccountAiFetcher(env),
): Promise<{ status: "ok" | "wait" | "error"; error?: string; account?: unknown }> {
  const normalizedState = readText(state);
  if (!normalizedState) throw new Error("OAuth state is required.");
  return postWorker(requireAccountAiSyncConfig(env), "/user/ai/codex-oauth/poll", { state: normalizedState }, fetcher);
}

export async function refreshAccountCodexQuota(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: AccountAiFetcher = defaultAccountAiFetcher(env),
): Promise<{ accounts: unknown[] }> {
  const payload = await postWorker<{ accounts?: unknown[] }>(
    requireAccountAiSyncConfig(env),
    "/user/ai/codex-quota/refresh",
    {},
    fetcher,
  );
  return { accounts: Array.isArray(payload.accounts) ? payload.accounts : [] };
}

function requireAccountAiSyncConfig(env: NodeJS.ProcessEnv): AccountAiSyncConfig {
  const config = readAccountAiSyncConfig(env);
  if (!config) throw new Error("请先登录桌面账号，才能同步 API/OAuth 设置。");
  return config;
}

function defaultAccountAiFetcher(env: NodeJS.ProcessEnv): AccountAiFetcher {
  return (input, init) => fetchWithOptionalProxy(input, init, env);
}

async function postWorker<T>(
  config: AccountAiSyncConfig,
  path: string,
  body: unknown,
  fetcher: AccountAiFetcher,
): Promise<T> {
  const response = await fetchAccountWorker(config, path, body, fetcher);
  const payload = await response.json().catch(() => ({})) as { ok?: unknown; error?: unknown };
  if (!response.ok || payload.ok === false) {
    throw new Error(readText(payload.error) || `Worker AI sync failed: HTTP ${response.status}`);
  }
  return payload as T;
}

async function fetchAccountWorker(
  config: AccountAiSyncConfig,
  path: string,
  body: unknown,
  fetcher: AccountAiFetcher,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ACCOUNT_AI_SYNC_TIMEOUT_MS);
  try {
    return await fetcher(`${config.workerUrl}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`账号 Worker 请求失败：${readUnknownErrorMessage(error)}。请检查网络和账号登录状态。`);
  } finally {
    clearTimeout(timeout);
  }
}

function buildCodexOAuthSettings(
  accountRef: string | undefined,
  model: string,
  existing: AccountAiSettings | null,
): Record<string, unknown> {
  const current = isRecord(existing?.codexOAuth) ? existing.codexOAuth : {};
  return {
    ...current,
    enabled: accountRef === ACCOUNT_CODEX_OAUTH_REF || current.enabled === true,
    accountRef: ACCOUNT_CODEX_OAUTH_REF,
    model: model || readText(current.model) || "gpt-5.5",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSettings(settings: unknown, updatedAt: unknown): AccountAiSettings | null {
  if (!isRecord(settings)) return null;
  return {
    ...settings,
    ...(readText(updatedAt) ? { updatedAt: readText(updatedAt) } : {}),
  } as AccountAiSettings;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error || "unknown error");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
