import { fetchWithOptionalProxy } from "../../../src/utils/proxy-fetch.js";
import { assignEnvValue, updateEnvFile } from "./env-file.js";
import { readCLIProxyConfig } from "./cliproxy-config.js";
import { readLlmApiAccount } from "./llm-accounts.js";
import {
  readCloudflareProviderKey,
  readCloudflareProviderUrl,
  resolveCloudflareLlmAccountRef,
  testCloudflareLlmProvider,
} from "./llm-config-cloudflare.js";
import {
  ACCOUNT_CODEX_OAUTH_REF,
  accountAiOpenAiBaseUrl,
  readAccountAiSyncConfig,
} from "./account-ai-env.js";
import {
  defaultBaseUrlForProvider,
  defaultModelForProvider,
  isSupportedLlmProvider,
  normalizeOpenAICompatibleBaseUrl,
} from "./llm-provider-defaults.js";

const PROVIDER_ENV = "LLMWIKI_PROVIDER";
const OPENAI_COMPAT_PROVIDER_ENV = "LLMWIKI_OPENAI_COMPAT_PROVIDER";
const OPENAI_BASE_URL_ENV = "LLMWIKI_OPENAI_BASE_URL";
const OPENAI_KEY_ENV = "OPENAI_API_KEY";
const ANTHROPIC_BASE_URL_ENV = "ANTHROPIC_BASE_URL";
const ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY";
const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
const MINIMAX_KEY_ENV = "MINIMAX_API_KEY";
const MINIMAX_BASE_URL_ENV = "MINIMAX_BASE_URL";
const OLLAMA_HOST_ENV = "OLLAMA_HOST";
const MODEL_ENV = "LLMWIKI_MODEL";
const DEFAULT_ACCOUNT_REF_ENV = "LLMWIKI_DEFAULT_ACCOUNT_REF";
const LLM_PROVIDER_TEST_TIMEOUT_MS = 15_000;

interface LlmProviderConfig {
  accountRef?: string;
  provider: string;
  url: string;
  keyConfigured: boolean;
  model: string;
}

interface LlmProviderConfigInput {
  accountRef?: unknown;
  provider?: unknown;
  url?: unknown;
  key?: unknown;
  model?: unknown;
}

interface LlmProviderTestResult {
  ok: boolean;
  provider: string;
  endpoint: string;
  message: string;
}

type LlmProviderTestFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ResolvedLlmProviderTestConfig {
  provider: string;
  url: string;
  key: string | null;
  model: string;
}

export function readLlmProviderConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): LlmProviderConfig {
  const provider = normalizeText(env[PROVIDER_ENV]) ?? "anthropic";
  const compatProvider = provider === "openai" ? normalizeText(env[OPENAI_COMPAT_PROVIDER_ENV]) : null;
  const accountRef = normalizeText(env[DEFAULT_ACCOUNT_REF_ENV]);
  return {
    ...(accountRef ? { accountRef } : {}),
    provider: compatProvider ?? provider,
    url: readProviderUrl(provider, env),
    keyConfigured: readProviderKeyConfigured(provider, env),
    model: normalizeText(env[MODEL_ENV]) ?? "",
  };
}

export function saveLlmProviderConfig(
  projectRoot: string,
  input: LlmProviderConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): LlmProviderConfig {
  const resolvedAccount = resolveAccountRefConfig(projectRoot, input.accountRef, env);
  const provider = resolvedAccount?.provider ?? normalizeSavedProvider(input.provider);
  const runtimeProvider = toRuntimeProvider(provider);
  const url = resolvedAccount?.url ?? normalizeUrl(input.url);
  const key = resolvedAccount?.key ?? normalizeText(input.key);
  const model = resolvedAccount?.model ?? normalizeText(input.model);
  const updates = buildProviderEnvUpdates(
    provider,
    runtimeProvider,
    url,
    key,
    model,
    resolvedAccount?.accountRef ?? null,
  );
  updateEnvFile(projectRoot, updates);
  for (const [envKey, value] of Object.entries(updates)) {
    assignEnvValue(env, envKey, value);
  }
  return readLlmProviderConfig(projectRoot, env);
}

export async function testLlmProviderConfig(
  projectRoot: string,
  input: LlmProviderConfigInput,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: LlmProviderTestFetcher = (request, init) => fetchWithOptionalProxy(request, init, env),
): Promise<LlmProviderTestResult> {
  const config = resolveLlmProviderTestConfig(projectRoot, input, env);
  const validation = validateLlmProviderTestConfig(config);
  if (validation) return validation;
  if (config.provider === "cloudflare") {
    return testCloudflareLlmProvider(config.model, config.url);
  }
  return testHttpLlmProviderConfig(config, fetcher);
}

function resolveLlmProviderTestConfig(
  projectRoot: string,
  input: LlmProviderConfigInput,
  env: NodeJS.ProcessEnv,
): ResolvedLlmProviderTestConfig {
  const resolvedAccount = resolveAccountRefConfig(projectRoot, input.accountRef, env);
  const provider = resolvedAccount?.provider ?? normalizeSavedProvider(input.provider);
  return {
    provider,
    model: resolveLlmProviderTestModel(provider, input, env, resolvedAccount),
    url: resolveLlmProviderTestUrl(provider, input, env, resolvedAccount),
    key: resolveLlmProviderTestKey(provider, input, env, resolvedAccount),
  };
}

function resolveLlmProviderTestModel(
  provider: string,
  input: LlmProviderConfigInput,
  env: NodeJS.ProcessEnv,
  resolvedAccount: ResolvedLlmAccountRef | null,
): string {
  return resolvedAccount?.model
    ?? normalizeText(input.model)
    ?? normalizeText(env[MODEL_ENV])
    ?? defaultModelForProvider(provider);
}

function resolveLlmProviderTestUrl(
  provider: string,
  input: LlmProviderConfigInput,
  env: NodeJS.ProcessEnv,
  resolvedAccount: ResolvedLlmAccountRef | null,
): string {
  return resolvedAccount?.url
    ?? normalizeUrl(input.url)
    ?? readProviderUrl(toRuntimeProvider(provider), env);
}

function resolveLlmProviderTestKey(
  provider: string,
  input: LlmProviderConfigInput,
  env: NodeJS.ProcessEnv,
  resolvedAccount: ResolvedLlmAccountRef | null,
): string | null {
  return resolvedAccount?.key ?? normalizeText(input.key) ?? readProviderKey(provider, env);
}

function validateLlmProviderTestConfig(config: ResolvedLlmProviderTestConfig): LlmProviderTestResult | null {
  if (!config.model && config.provider !== "ollama") {
    return { ok: false, provider: config.provider, endpoint: config.url, message: "需要填写模型名。" };
  }
  if (!config.key && config.provider !== "cloudflare" && config.provider !== "ollama") {
    return { ok: false, provider: config.provider, endpoint: config.url, message: "需要填写 API Key，或先保存已有密钥。" };
  }
  return null;
}

async function testHttpLlmProviderConfig(
  config: ResolvedLlmProviderTestConfig,
  fetcher: LlmProviderTestFetcher,
): Promise<LlmProviderTestResult> {
  const request = buildTestRequest(config.provider, config.url, config.key, config.model);
  const response = await fetchProviderTestRequest(fetcher, request.endpoint, request.init);
  if (response instanceof Error) {
    return {
      ok: false,
      provider: config.provider,
      endpoint: request.endpoint,
      message: response.message,
    };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      provider: config.provider,
      endpoint: request.endpoint,
      message: buildProviderTestErrorMessage(config.provider, response.status, text, config.model),
    };
  }
  return {
    ok: true,
    provider: config.provider,
    endpoint: request.endpoint,
    message: "验证成功，API 可以连通。",
  };
}

async function fetchProviderTestRequest(
  fetcher: LlmProviderTestFetcher,
  endpoint: string,
  init: RequestInit,
): Promise<Response | Error> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_PROVIDER_TEST_TIMEOUT_MS);
  try {
    return await fetcher(endpoint, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      return new Error("验证失败：请求超时，请检查网络、代理、Base URL 或服务商状态。");
    }
    return new Error(`验证失败：${readUnknownErrorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function readUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error || "unknown error");
}

function buildProviderTestErrorMessage(provider: string, status: number, text: string, model: string): string {
  const error = parseProviderError(text);
  if (
    provider === "relay"
    && (
      error?.code === "model_not_found"
      || error?.message?.toLowerCase().includes("no available channel for model")
    )
  ) {
    return `验证失败：当前中转站账号不支持模型 ${model}，请改成该中转实际支持的模型名后再试。`;
  }
  return `验证失败：HTTP ${status}${text ? ` ${text.slice(0, 160)}` : ""}`;
}

function parseProviderError(text: string): { code: string | null; message: string | null } | null {
  const raw = text.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown } };
    return {
      code: normalizeText(parsed.error?.code) ?? null,
      message: normalizeText(parsed.error?.message) ?? null,
    };
  } catch {
    return null;
  }
}

function normalizeSavedProvider(value: unknown): string {
  const provider = normalizeText(value);
  if (!provider) return "openai";
  if (!isSupportedLlmProvider(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
  return provider;
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeUrl(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    new URL(withProtocol);
    return withProtocol;
  } catch {
    throw new Error("LLM API 地址必须是完整 URL。");
  }
}

function toRuntimeProvider(provider: string): string {
  if (provider === "cloudflare") return provider;
  if (provider === "anthropic" || provider === "minimax" || provider === "ollama") return provider;
  return "openai";
}

function buildProviderEnvUpdates(
  provider: string,
  runtimeProvider: string,
  url: string | null,
  key: string | null,
  model: string | null,
  accountRef: string | null,
): Record<string, string | null> {
  const updates: Record<string, string | null> = {
    [DEFAULT_ACCOUNT_REF_ENV]: accountRef,
    [PROVIDER_ENV]: runtimeProvider,
    [OPENAI_COMPAT_PROVIDER_ENV]: runtimeProvider === "openai" ? provider : null,
    [OPENAI_BASE_URL_ENV]: null,
    [OPENAI_KEY_ENV]: null,
    [ANTHROPIC_BASE_URL_ENV]: null,
    [ANTHROPIC_KEY_ENV]: null,
    [ANTHROPIC_AUTH_TOKEN_ENV]: null,
    [MINIMAX_BASE_URL_ENV]: null,
    [MINIMAX_KEY_ENV]: null,
    [OLLAMA_HOST_ENV]: null,
    [MODEL_ENV]: model,
  };
  if (runtimeProvider === "anthropic") {
    updates[ANTHROPIC_BASE_URL_ENV] = url;
    updates[ANTHROPIC_KEY_ENV] = key;
    return updates;
  }
  if (runtimeProvider === "minimax") {
    updates[MINIMAX_BASE_URL_ENV] = url;
    updates[MINIMAX_KEY_ENV] = key;
    return updates;
  }
  if (runtimeProvider === "ollama") {
    updates[OLLAMA_HOST_ENV] = url;
    return updates;
  }
  if (runtimeProvider === "cloudflare") return updates;
  updates[OPENAI_BASE_URL_ENV] = normalizeOpenAIBaseUrl(url, provider);
  updates[OPENAI_KEY_ENV] = key;
  return updates;
}

interface ResolvedLlmAccountRef {
  accountRef: string;
  provider: string;
  url: string;
  key: string;
  model: string;
}

interface ParsedAccountRef {
  kind: "api" | "oauth" | "cloudflare";
  provider: string;
  key: string;
}

function resolveAccountRefConfig(
  projectRoot: string,
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlmAccountRef | null {
  const accountRef = normalizeText(input);
  if (!accountRef) return null;
  const route = parseAccountRef(accountRef);
  if (!route) throw new Error("默认模型账号来源无效。");
  switch (route.kind) {
    case "api":
      return resolveApiAccountRefConfig(projectRoot, accountRef, route.key);
    case "cloudflare":
      return resolveCloudflareLlmAccountRef(accountRef, env, normalizeText(env[MODEL_ENV]));
    case "oauth":
      return resolveOAuthAccountRefConfig(projectRoot, accountRef, route, env);
  }
}

function resolveApiAccountRefConfig(projectRoot: string, accountRef: string, key: string): ResolvedLlmAccountRef {
  const account = readLlmApiAccount(projectRoot, key);
  if (!account || account.enabled === false) {
    throw new Error("默认模型引用的 API 账号不存在，或已被停用。");
  }
  return {
    accountRef,
    provider: account.provider,
    url: account.url,
    key: account.key,
    model: account.model,
  };
}

function resolveOAuthAccountRefConfig(
  projectRoot: string,
  accountRef: string,
  route: ParsedAccountRef,
  env: NodeJS.ProcessEnv,
): ResolvedLlmAccountRef {
  if (accountRef === ACCOUNT_CODEX_OAUTH_REF) {
    return resolveWorkerCodexOAuthAccountRef(accountRef, env);
  }
  const config = readCLIProxyConfig(projectRoot);
  return {
    accountRef,
    provider: providerFromOAuthAccount(route.provider),
    url: `http://127.0.0.1:${config.port}/v1`,
    key: config.clientKey,
    model: config.model,
  };
}

function resolveWorkerCodexOAuthAccountRef(
  accountRef: string,
  env: NodeJS.ProcessEnv,
): ResolvedLlmAccountRef {
  const config = readAccountAiSyncConfig(env);
  if (!config) throw new Error("请先登录桌面账号，才能使用 Worker Codex OAuth。");
  return {
    accountRef,
    provider: "codex-cli",
    url: accountAiOpenAiBaseUrl(config.workerUrl),
    key: config.sessionToken,
    model: normalizeText(env[MODEL_ENV]) ?? "gpt-5.5",
  };
}

function parseAccountRef(value: string): ParsedAccountRef | null {
  if (value === "cloudflare:workers-ai") {
    return { kind: "cloudflare", provider: "cloudflare", key: "workers-ai" };
  }
  if (value.startsWith("api:")) {
    const key = value.slice(4).trim();
    if (!key) return null;
    return { kind: "api", provider: "api", key };
  }
  if (value.startsWith("oauth:")) {
    const parts = value.split(":");
    const provider = parts[1]?.trim();
    const key = parts.slice(2).join(":").trim();
    if (!provider || !key) return null;
    return { kind: "oauth", provider, key };
  }
  return null;
}

function providerFromOAuthAccount(provider: string): string {
  switch (provider) {
    case "gemini-cli":
    case "gemini":
      return "gemini";
    case "anthropic":
      return "anthropic";
    case "codex":
      return "codex-cli";
    case "kimi":
      return "kimi-global";
    default:
      return "custom";
  }
}

function readProviderUrl(provider: string, env: NodeJS.ProcessEnv): string {
  return providerUrlReaders[provider]?.(env) ?? openAiBaseUrl(env);
}

function readProviderKeyConfigured(provider: string, env: NodeJS.ProcessEnv): boolean {
  return Boolean(readProviderKey(provider, env));
}

function readProviderKey(provider: string, env: NodeJS.ProcessEnv): string | null {
  if (provider === "anthropic") {
    return normalizeText(env[ANTHROPIC_KEY_ENV]) ?? normalizeText(env[ANTHROPIC_AUTH_TOKEN_ENV]);
  }
  if (provider === "cloudflare") return readCloudflareProviderKey(env);
  if (provider === "minimax") return normalizeText(env[MINIMAX_KEY_ENV]);
  if (provider === "ollama") return null;
  return normalizeText(env[OPENAI_KEY_ENV]);
}

function normalizeOpenAIBaseUrl(url: string | null, provider: string): string | null {
  if (!url) return null;
  return normalizeOpenAICompatibleBaseUrl(url, provider);
}

// fallow-ignore-next-line complexity
function buildTestRequest(
  provider: string,
  url: string,
  key: string | null,
  model: string,
): { endpoint: string; init: RequestInit } {
  if (provider === "minimax") {
    return buildMiniMaxTestRequest(url, key, model);
  }
  if (provider === "anthropic") {
    return buildAnthropicTestRequest(url, key, model);
  }
  if (provider === "gemini") {
    return buildGeminiTestRequest(url, key, model);
  }
  const endpoint = openAIChatCompletionsEndpoint(url, provider);
  return {
    endpoint,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    },
  };
}

const providerUrlReaders: Readonly<Record<string, (env: NodeJS.ProcessEnv) => string>> = {
  anthropic: (env) => normalizeText(env[ANTHROPIC_BASE_URL_ENV]) ?? "",
  minimax: (env) => normalizeText(env[MINIMAX_BASE_URL_ENV]) ?? openAiBaseUrl(env),
  cloudflare: readCloudflareProviderUrl,
  ollama: (env) => normalizeText(env[OLLAMA_HOST_ENV]) ?? "",
};

function openAiBaseUrl(env: NodeJS.ProcessEnv): string {
  return normalizeText(env[OPENAI_BASE_URL_ENV]) ?? "";
}

function buildMiniMaxTestRequest(
  url: string,
  key: string | null,
  model: string,
): { endpoint: string; init: RequestInit } {
  return buildMessagesTestRequest(
    anthropicMessagesEndpoint(url || defaultBaseUrlForProvider("minimax")),
    { Authorization: `Bearer ${key ?? ""}` },
    model,
  );
}

function buildAnthropicTestRequest(
  url: string,
  key: string | null,
  model: string,
): { endpoint: string; init: RequestInit } {
  return buildMessagesTestRequest(
    anthropicMessagesEndpoint(url || "https://api.anthropic.com"),
    { "anthropic-version": "2023-06-01", "x-api-key": key ?? "" },
    model,
  );
}

function buildMessagesTestRequest(
  endpoint: string,
  authHeaders: Record<string, string>,
  model: string,
): { endpoint: string; init: RequestInit } {
  return {
    endpoint,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    },
  };
}

function buildGeminiTestRequest(
  url: string,
  key: string | null,
  model: string,
): { endpoint: string; init: RequestInit } {
  const endpoint = new URL(
    `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key ?? "")}`,
    url || "https://generativelanguage.googleapis.com",
  ).toString();
  return {
    endpoint,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
    },
  };
}

function anthropicMessagesEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (/\/v\d+\/messages$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

function openAIChatCompletionsEndpoint(url: string, provider: string): string {
  const normalized = normalizeOpenAIBaseUrl(url || defaultBaseUrlForProvider(provider), provider) ?? defaultBaseUrlForProvider(provider);
  const parsed = new URL(normalized);
  if (!parsed.pathname.replace(/\/+$/, "").endsWith("/chat/completions")) {
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/chat/completions`;
  }
  return parsed.toString();
}
