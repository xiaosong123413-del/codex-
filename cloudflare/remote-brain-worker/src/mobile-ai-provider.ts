/**
 * Mobile AI provider dispatch.
 *
 * The mobile app can either use the Worker AI binding or an OpenAI-compatible
 * provider supplied from settings. Keeping this logic here prevents the chat
 * and task routes from silently ignoring the selected provider.
 */

import { extractWorkerText } from "./runtime-helpers.js";
import type {
  MobileAiProviderRequest,
  MobileChatEnv,
} from "./mobile-shared.js";

export interface MobileAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAiCompatibleResponse {
  choices?: Array<{
    message?: { content?: unknown };
    text?: unknown;
  }>;
  error?: unknown;
}

interface StoredCodexToken {
  ownerUid: string;
  accountName: string;
  email: string | null;
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
}

export interface MobileCodexDirectRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

interface CodexRefreshTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
}

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_ORIGINATOR = "codex-tui";
const CODEX_USER_AGENT = "codex-tui/0.118.0 (Mac OS 26.3.1; arm64) iTerm.app/3.6.9 (codex-tui; 0.118.0)";
const CHATGPT_CODEX_MODEL = "gpt-5.5";
const LEGACY_CHATGPT_CODEX_MODELS = new Set(["gpt-5-codex"]);

export function isExternalMobileAiProvider(provider: MobileAiProviderRequest | undefined): boolean {
  const mode = normalizeMode(provider?.mode);
  return mode === "api" || mode === "codex_oauth";
}

export async function runMobileAiText(
  env: MobileChatEnv,
  provider: MobileAiProviderRequest | undefined,
  messages: readonly MobileAiMessage[],
  options: { webSearch?: boolean; ownerUid?: string } = {},
): Promise<string> {
  if (shouldUseWorkerCodexOAuth(provider)) {
    return runWorkerCodexOAuthText(env, provider, messages, options.ownerUid);
  }
  if (isExternalMobileAiProvider(provider)) {
    return runOpenAiCompatibleText(provider, messages, shouldSendWebSearchOptions(provider, options.webSearch === true));
  }
  const result = await env.AI!.run(env.LLM_MODEL!, { messages });
  return extractWorkerText(result);
}

async function runWorkerCodexOAuthText(
  env: MobileChatEnv,
  provider: MobileAiProviderRequest | undefined,
  messages: readonly MobileAiMessage[],
  ownerUid: string | undefined,
): Promise<string> {
  const db = env.DB;
  const normalizedOwnerUid = readText(ownerUid);
  if (!db) throw new Error("缺少 Cloudflare D1，无法读取 Codex OAuth。");
  if (!normalizedOwnerUid) throw new Error("缺少用户 ID，无法读取 Codex OAuth。");
  const storedToken = await readPreferredStoredCodexToken(db, normalizedOwnerUid);
  if (!storedToken) {
    throw new Error("Codex OAuth 还没有同步到 Cloudflare Worker，请先在电脑端完成一次 Codex OAuth 并刷新账号。");
  }

  const body = JSON.stringify(createCodexResponsesBody(provider, messages));

  let token = storedToken;
  let response = await requestCodexResponses(token, body);
  if (isRefreshableCodexStatus(response.status) && token.refreshToken) {
    const patch = await refreshCodexOAuthToken(token);
    if (patch) {
      await updateStoredCodexToken(db, token, patch);
      token = { ...token, ...patch };
      response = await requestCodexResponses(token, body);
    }
  }
  if (!response.ok) {
    throw new Error(`Codex OAuth 请求失败：${await readCodexError(response)}`);
  }
  return parseCodexResponsesText(await response.text());
}

export async function createMobileCodexDirectRequest(
  env: MobileChatEnv,
  provider: MobileAiProviderRequest | undefined,
  messages: readonly MobileAiMessage[],
  ownerUid: string | undefined,
): Promise<MobileCodexDirectRequest> {
  const db = env.DB;
  const normalizedOwnerUid = readText(ownerUid);
  if (!db) throw new Error("缺少 Cloudflare D1，无法读取 Codex OAuth。");
  if (!normalizedOwnerUid) throw new Error("缺少用户 ID，无法读取 Codex OAuth。");
  const storedToken = await readPreferredStoredCodexToken(db, normalizedOwnerUid);
  if (!storedToken) {
    throw new Error("Codex OAuth 还没有同步到 Cloudflare Worker，请先在手机端完成 Codex OAuth 登录。");
  }

  let token = storedToken;
  if (token.refreshToken) {
    const patch = await refreshCodexOAuthToken(token);
    if (patch) {
      await updateStoredCodexToken(db, token, patch);
      token = { ...token, ...patch };
    }
  }

  return {
    url: CODEX_RESPONSES_URL,
    method: "POST",
    headers: createCodexResponsesHeaders(token),
    body: JSON.stringify(createCodexResponsesBody(provider, messages)),
  };
}

async function readPreferredStoredCodexToken(db: D1Database, ownerUid: string): Promise<StoredCodexToken | null> {
  const row = await db.prepare(
    "SELECT owner_uid AS ownerUid, account_name AS accountName, email, access_token AS accessToken, refresh_token AS refreshToken, account_id AS accountId FROM mobile_codex_tokens WHERE owner_uid = ? ORDER BY updated_at DESC LIMIT 1",
  ).bind(ownerUid).first();
  if (!row) return null;
  const token: StoredCodexToken = {
    ownerUid: readText(row.ownerUid),
    accountName: readText(row.accountName),
    email: readNullableText(row.email),
    accessToken: readText(row.accessToken),
    refreshToken: readNullableText(row.refreshToken),
    accountId: readNullableText(row.accountId),
  };
  return token.ownerUid && token.accountName && token.accessToken ? token : null;
}

async function requestCodexResponses(token: StoredCodexToken, body: string): Promise<Response> {
  return fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: createCodexResponsesHeaders(token),
    body,
  });
}

function createCodexResponsesHeaders(token: StoredCodexToken): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.accessToken}`,
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    Originator: CODEX_ORIGINATOR,
    Session_id: crypto.randomUUID(),
    "User-Agent": CODEX_USER_AGENT,
  };
  if (token.accountId) headers["Chatgpt-Account-Id"] = token.accountId;
  return headers;
}

function createCodexResponsesBody(
  provider: MobileAiProviderRequest | undefined,
  messages: readonly MobileAiMessage[],
): Record<string, unknown> {
  return {
    model: normalizeChatGptCodexModel(provider?.model),
    instructions: "",
    stream: true,
    parallel_tool_calls: true,
    reasoning: {
      effort: "medium",
      summary: "auto",
    },
    include: ["reasoning.encrypted_content"],
    store: false,
    input: messages.map(toCodexInputMessage),
  };
}

function toCodexInputMessage(message: MobileAiMessage): Record<string, unknown> {
  const role = message.role === "system" ? "developer" : message.role;
  return {
    type: "message",
    role,
    content: [{
      type: role === "assistant" ? "output_text" : "input_text",
      text: message.content,
    }],
  };
}

// fallow-ignore-next-line complexity
function parseCodexResponsesText(text: string): string {
  const completedOutputs: unknown[] = [];
  const doneOutputs = new Map<number, unknown>();
  const fallbackDoneOutputs: unknown[] = [];
  let deltaText = "";

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const event = parseJsonRecord(data);
    const eventType = readText(event.type);
    if (eventType === "response.output_text.delta") {
      deltaText += readText(event.delta);
      continue;
    }
    if (eventType === "response.output_item.done") {
      const index = readNumber(event.output_index);
      if (index !== null) {
        doneOutputs.set(index, event.item);
      } else {
        fallbackDoneOutputs.push(event.item);
      }
      continue;
    }
    if (eventType === "response.completed") {
      completedOutputs.splice(0, completedOutputs.length, ...readCodexOutputItems(event.response));
    }
  }

  const outputItems = completedOutputs.length > 0
    ? completedOutputs
    : [...[...doneOutputs.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]), ...fallbackDoneOutputs];
  const outputText = outputItems.flatMap(readCodexMessageText).join("").trim();
  if (outputText) return outputText;
  if (deltaText.trim()) return deltaText.trim();

  const directPayload = parseJsonRecord(text);
  const directText = readCodexOutputItems(directPayload).flatMap(readCodexMessageText).join("").trim();
  if (directText) return directText;
  throw new Error("Codex OAuth 响应没有生成可用回答。");
}

function readCodexOutputItems(value: unknown): unknown[] {
  const record = readRecord(value);
  return Array.isArray(record.output) ? record.output : [];
}

function readCodexMessageText(value: unknown): string[] {
  const record = readRecord(value);
  if (readText(record.type) !== "message") return [];
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((item) => {
      const contentItem = readRecord(item);
      return readText(contentItem.type) === "output_text" ? readText(contentItem.text) : "";
    })
    .filter(Boolean);
}

async function updateStoredCodexToken(
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

async function refreshCodexOAuthToken(token: StoredCodexToken): Promise<Partial<StoredCodexToken> | null> {
  if (!token.refreshToken) return null;
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      scope: "openid profile email",
    }),
  });
  const payload = parseJsonRecord(await response.text());
  if (!response.ok) return null;
  const tokenPayload = payload as CodexRefreshTokenResponse;
  const accessToken = readText(tokenPayload.access_token);
  if (!accessToken) return null;
  const idClaims = readJwtPayload(readText(tokenPayload.id_token));
  const authClaims = readRecord(idClaims["https://api.openai.com/auth"]);
  return {
    accessToken,
    refreshToken: readNullableText(tokenPayload.refresh_token) ?? token.refreshToken,
    accountId: readNullableText(authClaims.chatgpt_account_id) ?? token.accountId,
    email: readNullableText(idClaims.email) ?? token.email,
  };
}

async function readCodexError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  const payload = parseJsonRecord(text);
  return readText(payload.error)
    || readText(readRecord(payload.error).message)
    || readText(payload.message)
    || `HTTP ${response.status}`;
}

// fallow-ignore-next-line complexity
async function runOpenAiCompatibleText(
  provider: MobileAiProviderRequest | undefined,
  messages: readonly MobileAiMessage[],
  sendWebSearchOptions: boolean,
): Promise<string> {
  const apiBaseUrl = readText(provider?.apiBaseUrl);
  const apiKey = normalizeProviderApiKey(readText(provider?.apiKey));
  const rawModel = normalizeMode(provider?.mode) === "codex_oauth"
    ? normalizeChatGptCodexModel(provider?.model)
    : readText(provider?.model);
  const model = normalizeProviderModel(apiBaseUrl, rawModel);
  if (!apiBaseUrl) throw new Error("缺少 Provider API 地址。");
  if (!apiKey) throw new Error("缺少 Provider API Key。");
  if (!model) throw new Error("缺少 Provider Model。");

  const response = await fetch(createChatCompletionsUrl(apiBaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(sendWebSearchOptions ? { web_search_options: {} } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({})) as OpenAiCompatibleResponse;
  if (!response.ok) {
    throw new Error(`Provider 请求失败：${readProviderError(payload) || response.status}`);
  }
  return readProviderText(payload);
}

function createChatCompletionsUrl(apiBaseUrl: string): string {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  return baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

function readProviderText(payload: OpenAiCompatibleResponse): string {
  const firstChoice = payload.choices?.[0];
  const messageContent = firstChoice?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (typeof firstChoice?.text === "string") return firstChoice.text;
  return "";
}

function readProviderError(payload: OpenAiCompatibleResponse): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function normalizeMode(value: unknown): "cloudflare" | "api" | "codex_oauth" {
  return value === "api" || value === "codex_oauth" || value === "cloudflare" ? value : "cloudflare";
}

function shouldSendWebSearchOptions(provider: MobileAiProviderRequest | undefined, requested: boolean): boolean {
  if (!requested) return false;
  const baseUrl = readText(provider?.apiBaseUrl).toLowerCase();
  const model = readText(provider?.model).toLowerCase();
  return baseUrl.includes("api.openai.com") && (model.startsWith("gpt-4o-search") || model.startsWith("gpt-4.1"));
}

function shouldUseWorkerCodexOAuth(provider: MobileAiProviderRequest | undefined): boolean {
  if (normalizeMode(provider?.mode) !== "codex_oauth") return false;
  const baseUrl = readText(provider?.apiBaseUrl).toLowerCase();
  return !baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
}

function isRefreshableCodexStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function normalizeProviderModel(apiBaseUrl: string, model: string): string {
  const normalizedBaseUrl = apiBaseUrl.toLowerCase();
  const normalizedModel = model.trim();
  if (!normalizedBaseUrl.includes("mimo") && !normalizedBaseUrl.includes("xiaomi")) {
    return normalizedModel;
  }
  return normalizedModel.replace(/^xiaomi\//i, "").toLowerCase();
}

function normalizeChatGptCodexModel(model: unknown): string {
  const normalized = readText(model);
  return !normalized || LEGACY_CHATGPT_CODEX_MODELS.has(normalized.toLowerCase())
    ? CHATGPT_CODEX_MODEL
    : normalized;
}

function normalizeProviderApiKey(apiKey: string): string {
  return apiKey
    .replace(/^Authorization\s*:\s*/i, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
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

function parseJsonRecord(text: string): Record<string, unknown> {
  try {
    return readRecord(JSON.parse(text) as unknown);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
