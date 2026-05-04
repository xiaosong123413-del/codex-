/**
 * Account-scoped AI settings and Codex OAuth chat endpoints.
 *
 * Public desktop and mobile clients use these routes after account login. The
 * settings record stores shared API/OAuth configuration by account, while the
 * chat route exposes a small OpenAI-compatible surface backed by the user's
 * Worker-stored Codex OAuth token.
 */
import {
  readAccountSessionFromRequest,
  type AccountSession,
} from "./account-auth-api.js";
import {
  runMobileAiText,
  type MobileAiMessage,
} from "./mobile-ai-provider.js";
import { json, safeJson } from "./worker-support.js";

interface AccountAiEnv {
  DB?: D1Database;
  REMOTE_TOKEN?: string;
  LLM_MODEL?: string;
  AI?: Ai;
}

interface AccountAiSettingsRow {
  settings: Record<string, unknown>;
  updatedAt: string;
}

interface ChatCompletionsPayload {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
}

const MAX_SETTINGS_BYTES = 200_000;
const DEFAULT_CODEX_MODEL = "gpt-5.5";

export async function handleAccountAiSettingsGet(
  request: Request,
  env: AccountAiEnv,
): Promise<Response> {
  const context = await requireAccountAiContext(request, env);
  if (context instanceof Response) return context;
  const record = await readAccountAiSettings(context.db, context.session.accountId);
  return json({ ok: true, settings: record?.settings ?? null, updatedAt: record?.updatedAt ?? null });
}

export async function handleAccountAiSettingsSave(
  request: Request,
  env: AccountAiEnv,
): Promise<Response> {
  const context = await requireAccountAiContext(request, env);
  if (context instanceof Response) return context;
  const payload = await safeJson<Record<string, unknown>>(request);
  const settings = normalizeSettingsPayload(payload);
  if (!settings) return json({ ok: false, error: "invalid_ai_settings" }, 400);
  const updatedAt = new Date().toISOString();
  await context.db.prepare(
    "INSERT INTO account_ai_settings (account_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
  ).bind(context.session.accountId, JSON.stringify(settings), updatedAt).run();
  return json({ ok: true, settings, updatedAt });
}

export async function handleAccountAiChatCompletions(
  request: Request,
  env: AccountAiEnv,
): Promise<Response> {
  const context = await requireAccountAiContext(request, env);
  if (context instanceof Response) return context;
  const payload = await safeJson<ChatCompletionsPayload>(request);
  const messages = normalizeOpenAiMessages(payload.messages);
  if (messages.length === 0) return json({ error: { message: "messages is required" } }, 400);

  const model = readText(payload.model) || DEFAULT_CODEX_MODEL;
  try {
    const text = await runMobileAiText(
      env,
      { mode: "codex_oauth", model },
      messages,
      { ownerUid: context.session.accountId },
    );
    return payload.stream === true
      ? sseChatCompletion(model, text)
      : json(chatCompletion(model, text));
  } catch (error) {
    return json({ error: { message: readError(error), type: "codex_oauth_error" } }, 502);
  }
}

async function requireAccountAiContext(
  request: Request,
  env: AccountAiEnv,
): Promise<{ db: D1Database; session: AccountSession } | Response> {
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const session = await readAccountSessionFromRequest(request, env);
  if (!session) return json({ ok: false, error: "unauthorized" }, 401);
  await ensureAccountAiSchema(env.DB);
  return { db: env.DB, session };
}

async function ensureAccountAiSchema(db: D1Database): Promise<void> {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS account_ai_settings (account_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ).run();
}

async function readAccountAiSettings(
  db: D1Database,
  accountId: string,
): Promise<AccountAiSettingsRow | null> {
  const row = await db.prepare(
    "SELECT settings_json AS settingsJson, updated_at AS updatedAt FROM account_ai_settings WHERE account_id = ?",
  ).bind(accountId).first();
  if (!row) return null;
  return {
    settings: parseStoredSettings(row.settingsJson),
    updatedAt: readText(row.updatedAt),
  };
}

function normalizeSettingsPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  const settings = Object.prototype.hasOwnProperty.call(payload, "settings") ? payload.settings : payload;
  if (!isRecord(settings)) return null;
  const serialized = JSON.stringify(settings);
  if (new TextEncoder().encode(serialized).length > MAX_SETTINGS_BYTES) {
    return null;
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function normalizeOpenAiMessages(value: unknown): MobileAiMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeOpenAiMessage)
    .filter((message): message is MobileAiMessage => message !== null);
}

function normalizeOpenAiMessage(value: unknown): MobileAiMessage | null {
  if (!isRecord(value)) return null;
  const role = normalizeMessageRole(value.role);
  const content = readMessageContent(value.content);
  return role && content ? { role, content } : null;
}

function normalizeMessageRole(value: unknown): MobileAiMessage["role"] | null {
  if (value === "user" || value === "assistant") return value;
  if (value === "system" || value === "developer") return "system";
  return null;
}

function readMessageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map(readContentPartText).filter(Boolean).join("\n");
}

function readContentPartText(value: unknown): string {
  if (!isRecord(value)) return "";
  return readText(value.text);
}

function chatCompletion(model: string, content: string): Record<string, unknown> {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

function sseChatCompletion(model: string, content: string): Response {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunks = [
    chunkLine({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content } }] }),
    chunkLine({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(chunks, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function chunkLine(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function parseStoredSettings(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readText(value)) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
