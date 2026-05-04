/**
 * Mobile chat routes and reply synthesis for the remote-brain Worker.
 *
 * Pulling the mobile assistant flow out of the main Worker entrypoint keeps the
 * route table thin while preserving the current chat behavior and test hooks.
 */

import {
  buildMobileSearchRequest,
  mergeMobileChatSources,
  normalizeMobileWebSearchResults,
  resolveMobileChatMode,
  toWebChatSource,
  toWikiChatSource,
  type MobileChatMode,
  type MobileChatSource,
  type MobileWebSearchResult,
} from "./mobile-chat.js";
import {
  createMobileCodexDirectRequest,
  isExternalMobileAiProvider,
  runMobileAiText,
  type MobileAiMessage,
  type MobileCodexDirectRequest,
} from "./mobile-ai-provider.js";
import { normalizeMobileChatRecord } from "./mobile-runtime-helpers.js";
import {
  parseStringArray,
  type MobileAiProviderRequest,
  type MobileChatEnv,
  type MobileChatMessage,
  type MobileChatPayload,
  type MobileChatRecord,
  type MobileWebSearchRequest,
  type MobileOwnerPayload,
  type MobileWebSearchOutcome,
  type MobileWikiContextItem,
} from "./mobile-shared.js";
import {
  json,
  requireAi,
  safeJson,
} from "./worker-support.js";

let mobileChatSchemaReady = false;

interface NormalizedMobileWebSearchRequest {
  enabled: boolean;
  mode: "professional" | "model";
  endpoint: string;
  token: string;
  model: string;
}

interface MobileWikiScope {
  prefix: string;
}

interface MobileCodexDirectPreparePayload extends MobileChatPayload {}

interface MobileCodexDirectCompletePayload extends MobileOwnerPayload {
  chatId?: string;
  message?: string;
  mode?: unknown;
  answer?: string;
  sources?: unknown;
}

interface MobileCodexDirectPreparation {
  chatId: string;
  message: string;
  mode: MobileChatMode;
  sources: MobileChatSource[];
  request: MobileCodexDirectRequest;
}

export async function handleMobileChatList(request: Request, env: MobileChatEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const ownerUid = String((await safeJson<MobileOwnerPayload>(request)).ownerUid ?? "").trim();
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  await ensureMobileChatSchema(db);
  const result = await db.prepare("SELECT id, owner_uid AS ownerUid, title, mode, messages_json AS messagesJson, sources_json AS sourcesJson, created_at AS createdAt, updated_at AS updatedAt FROM mobile_chats WHERE owner_uid = ? ORDER BY updated_at DESC LIMIT 100").bind(ownerUid).all();
  return json({ ok: true, chats: (result.results ?? []).map(normalizeMobileChatRecord) });
}

// fallow-ignore-next-line complexity
export async function handleMobileChatSend(request: Request, env: MobileChatEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileChatPayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  const message = String(payload.message ?? "").trim();
  const mode = resolveMobileChatMode(payload.mode);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!message) return json({ ok: false, error: "missing_message" }, 400);
  await ensureMobileChatSchema(db);
  const currentChat = await readMobileChat(db, ownerUid, payload.chatId);
  const webSearchConfig = normalizeMobileWebSearchRequest(payload.webSearch);
  const selectedWikiPaths = parseStringArray(payload.selectedWikiPaths).slice(0, 20);
  const wikiScope = resolveMobileWikiScope(ownerUid, payload.workspaceId);
  const wikiContext = mode === "web" ? [] : await buildMobileWikiContext(env, message, selectedWikiPaths, wikiScope);
  const webSearch = mode === "wiki" ? emptyMobileWebSearchOutcome() : await searchMobileWebContext(env, message, 5, webSearchConfig);
  const needsModelWebSearch = mode !== "wiki" && webSearchConfig.enabled && webSearchConfig.mode === "model";
  if ((needsModelWebSearch || mobileChatNeedsModel(mode, wikiContext, webSearch)) && !isExternalMobileAiProvider(payload.aiProvider)) {
    const missing = requireAi(env, env.LLM_MODEL);
    if (missing) return missing;
  }
  let reply: { text: string; sources: MobileChatSource[] };
  try {
    reply = await buildMobileChatReply(env, mode, message, currentChat?.messages ?? [], wikiContext, webSearch, payload.aiProvider, webSearchConfig, ownerUid);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "mobile_chat_failed" }, 500);
  }
  const chat = createMobileChatRecord(payload.chatId, ownerUid, message, mode, currentChat, reply);
  await saveMobileChat(db, chat);
  return json({ ok: true, chat });
}

export async function handleMobileChatPrepareCodexDirect(request: Request, env: MobileChatEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileCodexDirectPreparePayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  const message = String(payload.message ?? "").trim();
  const mode = resolveMobileChatMode(payload.mode);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!message) return json({ ok: false, error: "missing_message" }, 400);

  await ensureMobileChatSchema(db);
  const currentChat = await readMobileChat(db, ownerUid, payload.chatId);
  const webSearchConfig = normalizeMobileWebSearchRequest(payload.webSearch);
  const selectedWikiPaths = parseStringArray(payload.selectedWikiPaths).slice(0, 20);
  const wikiScope = resolveMobileWikiScope(ownerUid, payload.workspaceId);
  const wikiContext = mode === "web" ? [] : await buildMobileWikiContext(env, message, selectedWikiPaths, wikiScope);
  const webSearch = mode === "wiki" ? emptyMobileWebSearchOutcome() : await searchMobileWebContext(env, message, 5, webSearchConfig);
  const needsModelWebSearch = mode !== "wiki" && webSearchConfig.enabled && webSearchConfig.mode === "model";
  const needsModel = needsModelWebSearch || mobileChatNeedsModel(mode, wikiContext, webSearch);

  try {
    if (!needsModel) {
      const reply = await buildMobileChatReply(env, mode, message, currentChat?.messages ?? [], wikiContext, webSearch, payload.aiProvider, webSearchConfig, ownerUid);
      const chat = createMobileChatRecord(payload.chatId, ownerUid, message, mode, currentChat, reply);
      await saveMobileChat(db, chat);
      return json({ ok: true, chat });
    }

    const direct = await buildMobileCodexDirectPreparation(env, mode, message, currentChat?.messages ?? [], wikiContext, webSearch, payload.aiProvider, webSearchConfig, ownerUid, payload.chatId);
    return json({ ok: true, direct });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "mobile_chat_codex_direct_prepare_failed" }, 500);
  }
}

export async function handleMobileChatCompleteCodexDirect(request: Request, env: MobileChatEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileCodexDirectCompletePayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  const chatId = String(payload.chatId ?? "").trim();
  const message = String(payload.message ?? "").trim();
  const answer = String(payload.answer ?? "").trim();
  const mode = resolveMobileChatMode(payload.mode);
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!chatId) return json({ ok: false, error: "missing_chat_id" }, 400);
  if (!message) return json({ ok: false, error: "missing_message" }, 400);
  if (!answer) return json({ ok: false, error: "missing_answer" }, 400);

  await ensureMobileChatSchema(db);
  const currentChat = await readMobileChat(db, ownerUid, chatId);
  const reply = { text: answer, sources: normalizeMobileChatSources(payload.sources) };
  const chat = createMobileChatRecord(chatId, ownerUid, message, mode, currentChat, reply);
  await saveMobileChat(db, chat);
  return json({ ok: true, chat });
}

export async function handleMobileChatSourceRemove(request: Request, env: MobileChatEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileOwnerPayload & { chatId?: unknown; sourceId?: unknown }>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  const chatId = String(payload.chatId ?? "").trim();
  const sourceId = String(payload.sourceId ?? "").trim();
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!chatId) return json({ ok: false, error: "missing_chat_id" }, 400);
  if (!sourceId) return json({ ok: false, error: "missing_source_id" }, 400);

  await ensureMobileChatSchema(db);
  const currentChat = await readMobileChat(db, ownerUid, chatId);
  if (!currentChat) return json({ ok: false, error: "chat_not_found" }, 404);

  const nextChat: MobileChatRecord = {
    ...currentChat,
    sources: currentChat.sources.filter((source) => source.id !== sourceId),
    updatedAt: new Date().toISOString(),
  };
  await saveMobileChat(db, nextChat);
  return json({ ok: true, chat: nextChat });
}

// fallow-ignore-next-line complexity
export async function buildMobileChatReply(
  env: MobileChatEnv,
  mode: MobileChatMode,
  message: string,
  history: readonly MobileChatMessage[],
  wikiContext: readonly MobileWikiContextItem[],
  webSearch: MobileWebSearchOutcome,
  aiProvider?: MobileAiProviderRequest,
  webSearchConfig?: NormalizedMobileWebSearchRequest,
  ownerUid?: string,
): Promise<{ text: string; sources: MobileChatSource[] }> {
  const wikiSources = wikiContext.map((item) => toWikiChatSource({ title: item.title, path: item.path }));
  const webSources = webSearch.ok ? webSearch.results.map((item, index) => toWebChatSource(item, index)) : [];
  const usesModelWebSearch = webSearchConfig?.mode === "model";
  if (mode === "wiki" && wikiSources.length === 0) return { text: "未找到相关 wiki 来源。", sources: [] };
  if (usesModelWebSearch && mode !== "wiki") {
    const scopeNote = buildMobileChatScopeNote(mode, wikiSources.length > 0, true, webSources.length > 0, true);
    const sources = mode === "web" ? webSources : mergeMobileChatSources(wikiSources, webSources);
    const text = await generateMobileChatAnswer(env, scopeNote, message, history, wikiContext, webSearch.ok ? webSearch.results : [], aiProvider, true, ownerUid);
    return { text, sources };
  }
  if (mode === "web" && !webSearch.ok) return { text: "网络搜索不可用。", sources: [] };
  if (mode === "web" && webSources.length === 0) return { text: "未找到相关网络结果。", sources: [] };
  if (mode === "hybrid" && wikiSources.length === 0 && !webSearch.ok) return { text: "未找到相关 wiki 来源，且网络搜索不可用。", sources: [] };
  if (mode === "hybrid" && wikiSources.length === 0 && webSources.length === 0) return { text: "未找到相关 wiki 来源，也未找到相关网络结果。", sources: [] };
  const scopeNote = buildMobileChatScopeNote(mode, wikiSources.length > 0, webSearch.ok, webSources.length > 0, false);
  const sources = mode === "wiki" ? wikiSources : mode === "web" ? webSources : mergeMobileChatSources(wikiSources, webSources);
  const text = await generateMobileChatAnswer(env, scopeNote, message, history, wikiContext, webSearch.ok ? webSearch.results : [], aiProvider, false, ownerUid);
  return { text, sources };
}

async function buildMobileCodexDirectPreparation(
  env: MobileChatEnv,
  mode: MobileChatMode,
  message: string,
  history: readonly MobileChatMessage[],
  wikiContext: readonly MobileWikiContextItem[],
  webSearch: MobileWebSearchOutcome,
  aiProvider: MobileAiProviderRequest | undefined,
  webSearchConfig: NormalizedMobileWebSearchRequest,
  ownerUid: string,
  chatId: string | undefined,
): Promise<MobileCodexDirectPreparation> {
  const wikiSources = wikiContext.map((item) => toWikiChatSource({ title: item.title, path: item.path }));
  const webSources = webSearch.ok ? webSearch.results.map((item, index) => toWebChatSource(item, index)) : [];
  const usesModelWebSearch = webSearchConfig.mode === "model";
  const usesModelWebSearchPrompt = usesModelWebSearch && mode !== "wiki";
  const scopeNote = usesModelWebSearchPrompt
    ? buildMobileChatScopeNote(mode, wikiSources.length > 0, true, webSources.length > 0, true)
    : buildMobileChatScopeNote(mode, wikiSources.length > 0, webSearch.ok, webSources.length > 0, false);
  const sources = mode === "wiki"
    ? wikiSources
    : mode === "web"
      ? webSources
      : mergeMobileChatSources(wikiSources, webSources);
  const messages: MobileAiMessage[] = [
    { role: "system", content: "你是 LLM Wiki 手机端助手。回答必须简洁、可执行、可追溯。" },
    { role: "user", content: buildMobileChatPrompt(scopeNote, message, history, wikiContext, webSearch.ok ? webSearch.results : []) },
  ];
  return {
    chatId: chatId || crypto.randomUUID(),
    message,
    mode,
    sources,
    request: await createMobileCodexDirectRequest(env, aiProvider, messages, ownerUid),
  };
}

async function ensureMobileChatSchema(db: D1Database): Promise<void> {
  if (mobileChatSchemaReady) return;
  try {
    await db.prepare("ALTER TABLE mobile_chats ADD COLUMN mode TEXT NOT NULL DEFAULT 'wiki'").run();
  } catch {
    // Ignore when the column already exists.
  }
  mobileChatSchemaReady = true;
}

async function readMobileChat(
  db: D1Database,
  ownerUid: string,
  chatId: string | undefined,
): Promise<MobileChatRecord | null> {
  if (!chatId) return null;
  const row = await db.prepare("SELECT id, owner_uid AS ownerUid, title, mode, messages_json AS messagesJson, sources_json AS sourcesJson, created_at AS createdAt, updated_at AS updatedAt FROM mobile_chats WHERE id = ? AND owner_uid = ?")
    .bind(chatId, ownerUid)
    .first();
  return row ? normalizeMobileChatRecord(row) : null;
}

function mobileChatNeedsModel(
  mode: MobileChatMode,
  wikiContext: readonly MobileWikiContextItem[],
  webSearch: MobileWebSearchOutcome,
): boolean {
  if (mode === "wiki") return wikiContext.length > 0;
  if (mode === "web") return webSearch.ok && webSearch.results.length > 0;
  return wikiContext.length > 0 || (webSearch.ok && webSearch.results.length > 0);
}

function createMobileChatRecord(
  chatId: string | undefined,
  ownerUid: string,
  message: string,
  mode: MobileChatMode,
  currentChat: MobileChatRecord | null,
  reply: { text: string; sources: MobileChatSource[] },
): MobileChatRecord {
  const now = new Date().toISOString();
  return {
    id: chatId || crypto.randomUUID(),
    ownerUid,
    title: currentChat?.title || message.slice(0, 32) || "新对话",
    mode,
    messages: buildMobileChatMessages(currentChat?.messages ?? [], message, reply.text, now),
    sources: reply.sources,
    createdAt: currentChat?.createdAt || now,
    updatedAt: new Date().toISOString(),
  };
}

async function saveMobileChat(db: D1Database, chat: MobileChatRecord): Promise<void> {
  await db.prepare(
    "INSERT INTO mobile_chats (id, owner_uid, title, mode, messages_json, sources_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, mode = excluded.mode, messages_json = excluded.messages_json, sources_json = excluded.sources_json, updated_at = excluded.updated_at",
  ).bind(chat.id, chat.ownerUid, chat.title, chat.mode, JSON.stringify(chat.messages), JSON.stringify(chat.sources), chat.createdAt, chat.updatedAt).run();
}

// fallow-ignore-next-line complexity
function buildMobileChatScopeNote(
  mode: MobileChatMode,
  hasWiki: boolean,
  webAvailable: boolean,
  hasWeb: boolean,
  usesModelWebSearch: boolean,
): string {
  if (mode === "wiki") return "只根据 wiki 来源回答，不要补充联网信息。";
  if (usesModelWebSearch && mode === "web") return "使用当前模型自己的网络搜索能力回答。回答中说明信息来自模型联网搜索。";
  if (usesModelWebSearch && !hasWiki) return "使用当前模型自己的网络搜索能力回答。回答中说明没有找到相关 wiki 来源。";
  if (usesModelWebSearch) return "综合 wiki 来源与当前模型自己的网络搜索能力回答，并区分 wiki 信息和联网信息。";
  if (mode === "web") return "只根据网络搜索结果回答，并在回答中保持来源可追溯。";
  if (!webAvailable) return "当前网络搜索不可用，只根据 wiki 来源回答，并明确说明这一点。";
  if (!hasWiki) return "本次没有找到相关 wiki 来源，只根据网络搜索结果回答，并明确说明这一点。";
  if (!hasWeb) return "本次没有找到相关网络结果，只根据 wiki 来源回答，并明确说明这一点。";
  return "同时综合 wiki 与网络搜索结果回答，并明确区分哪些信息来自 wiki，哪些来自网络。";
}

async function generateMobileChatAnswer(
  env: MobileChatEnv,
  scopeNote: string,
  message: string,
  history: readonly MobileChatMessage[],
  wikiContext: readonly MobileWikiContextItem[],
  webResults: readonly MobileWebSearchResult[],
  aiProvider?: MobileAiProviderRequest,
  usesModelWebSearch = false,
  ownerUid?: string,
): Promise<string> {
  const text = await runMobileAiText(env, aiProvider, [
    { role: "system", content: "你是 LLM Wiki 手机端助手。回答必须简洁、可执行、可追溯。" },
    { role: "user", content: buildMobileChatPrompt(scopeNote, message, history, wikiContext, webResults) },
  ], { webSearch: usesModelWebSearch, ownerUid });
  return text.trim() || "没有生成可用回答。";
}

function buildMobileChatPrompt(
  scopeNote: string,
  message: string,
  history: readonly MobileChatMessage[],
  wikiContext: readonly MobileWikiContextItem[],
  webResults: readonly MobileWebSearchResult[],
): string {
  return [
    scopeNote,
    history.length > 0 ? `最近对话：\n${history.slice(-12).map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`).join("\n")}` : "",
    wikiContext.length > 0 ? `Wiki 来源：\n${wikiContext.map((item, index) => `#${index + 1} ${item.title}\n路径：${item.path}\n${item.content}`).join("\n\n")}` : "",
    webResults.length > 0 ? `网络来源：\n${webResults.map((item, index) => `#${index + 1} ${item.title}\n链接：${item.url}\n摘要：${item.snippet}`).join("\n\n")}` : "",
    `当前问题：${message}`,
  ].filter(Boolean).join("\n\n");
}

function buildMobileChatMessages(
  history: readonly MobileChatMessage[],
  question: string,
  answer: string,
  createdAt: string,
): MobileChatMessage[] {
  return [
    ...history,
    { id: crypto.randomUUID(), role: "user", content: question, createdAt },
    { id: crypto.randomUUID(), role: "assistant", content: answer, createdAt: new Date().toISOString() },
  ].slice(-40);
}

// fallow-ignore-next-line complexity
async function searchMobileWebContext(
  env: MobileChatEnv,
  query: string,
  limit: number,
  config: NormalizedMobileWebSearchRequest,
): Promise<MobileWebSearchOutcome> {
  if (!config.enabled) return { ok: false, error: "search_disabled" };
  if (config.mode === "model") return { ok: false, error: "model_web_search" };
  const endpoint = config.endpoint || env.CLOUDFLARE_SEARCH_ENDPOINT;
  if (!endpoint) return { ok: false, error: "missing_search_endpoint" };
  const request = buildMobileSearchRequest(endpoint, query, limit, config.model || env.CLOUDFLARE_SEARCH_MODEL || null);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = config.token || env.CLOUDFLARE_SEARCH_TOKEN || env.REMOTE_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(request.endpoint, { method: "POST", headers, body: JSON.stringify(request.payload) });
    if (!response.ok) return { ok: false, error: `search_http_${response.status}` };
    return { ok: true, results: normalizeMobileWebSearchResults(await response.json().catch(() => ({}))) };
  } catch {
    return { ok: false, error: "search_network_error" };
  }
}

function normalizeMobileWebSearchRequest(input: MobileWebSearchRequest | null | undefined): NormalizedMobileWebSearchRequest {
  if (!input || input.enabled !== true) {
    return {
      enabled: false,
      mode: "professional",
      endpoint: "",
      token: "",
      model: "",
    };
  }
  const mode = input.mode === "model" ? "model" : "professional";
  return {
    enabled: true,
    mode,
    endpoint: readText(input.endpoint),
    token: readText(input.token),
    model: readText(input.model),
  };
}

async function searchMobileWikiContext(
  env: MobileChatEnv,
  query: string,
  wikiScope: MobileWikiScope | null,
): Promise<MobileWikiContextItem[]> {
  const db = env.DB;
  if (!db) return [];
  const keyword = `%${query}%`;
  const result = wikiScope
    ? await db.prepare("SELECT path, title, substr(content, 1, 1200) AS content FROM wiki_pages WHERE path >= ? AND path < ? AND (content LIKE ? OR title LIKE ?) ORDER BY updated_at DESC LIMIT 5")
      .bind(wikiScope.prefix, upperBoundForPrefix(wikiScope.prefix), keyword, keyword)
      .all()
    : await db.prepare("SELECT path, title, substr(content, 1, 1200) AS content FROM wiki_pages WHERE content LIKE ? OR title LIKE ? ORDER BY updated_at DESC LIMIT 5")
      .bind(keyword, keyword)
      .all();
  return (result.results ?? []).map((item) => ({
    path: stripMobileWikiScope(String(item.path ?? ""), wikiScope),
    title: String(item.title ?? ""),
    content: String(item.content ?? ""),
  }));
}

async function buildMobileWikiContext(
  env: MobileChatEnv,
  query: string,
  selectedWikiPaths: readonly string[],
  wikiScope: MobileWikiScope | null,
): Promise<MobileWikiContextItem[]> {
  const selectedContext = await readSelectedMobileWikiContext(env, selectedWikiPaths, wikiScope);
  const searchedContext = await searchMobileWikiContext(env, query, wikiScope);
  return mergeMobileWikiContext(selectedContext, searchedContext);
}

async function readSelectedMobileWikiContext(
  env: MobileChatEnv,
  selectedWikiPaths: readonly string[],
  wikiScope: MobileWikiScope | null,
): Promise<MobileWikiContextItem[]> {
  const db = env.DB;
  const paths = [...new Set(selectedWikiPaths.map((path) => path.trim()).filter(Boolean))];
  if (!db || paths.length === 0) return [];
  const storedPaths = wikiScope ? paths.map((path) => scopedMobileWikiPath(path, wikiScope)) : paths;
  const placeholders = storedPaths.map(() => "?").join(", ");
  const result = await db.prepare(`SELECT path, title, substr(content, 1, 1600) AS content FROM wiki_pages WHERE path IN (${placeholders})`)
    .bind(...storedPaths)
    .all();
  const rowsByPath = new Map((result.results ?? []).map((item) => [String(item.path ?? ""), item]));
  return storedPaths
    .map((path) => rowsByPath.get(path))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      path: stripMobileWikiScope(String(item.path ?? ""), wikiScope),
      title: String(item.title ?? ""),
      content: String(item.content ?? ""),
    }));
}

function resolveMobileWikiScope(ownerUid: string, workspaceId: unknown): MobileWikiScope | null {
  const workspace = readWorkspaceId(workspaceId);
  return ownerUid && workspace ? { prefix: `accounts/${ownerUid}/${workspace}/` } : null;
}

function scopedMobileWikiPath(path: string, wikiScope: MobileWikiScope): string {
  return `${wikiScope.prefix}${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

function stripMobileWikiScope(path: string, wikiScope: MobileWikiScope | null): string {
  return wikiScope && path.startsWith(wikiScope.prefix) ? path.slice(wikiScope.prefix.length) : path;
}

function upperBoundForPrefix(prefix: string): string {
  return `${prefix}\uffff`;
}

function readWorkspaceId(value: unknown): string {
  const text = readText(value);
  return /^[a-zA-Z0-9._:-]{3,120}$/.test(text) ? text : "";
}

function mergeMobileWikiContext(
  selectedContext: readonly MobileWikiContextItem[],
  searchedContext: readonly MobileWikiContextItem[],
): MobileWikiContextItem[] {
  const seenPaths = new Set<string>();
  return [...selectedContext, ...searchedContext].filter((item) => {
    if (!item.path || seenPaths.has(item.path)) return false;
    seenPaths.add(item.path);
    return true;
  });
}

function emptyMobileWebSearchOutcome(): MobileWebSearchOutcome {
  return { ok: true, results: [] };
}

function normalizeMobileChatSources(value: unknown): MobileChatSource[] {
  const items = Array.isArray(value) ? value : [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      id: readText(item.id) || crypto.randomUUID(),
      type: item.type === "web" ? "web" : "wiki",
      title: readText(item.title),
      path: readOptionalText(item.path),
      url: readOptionalText(item.url),
      domain: readOptionalText(item.domain),
    }));
}

function readOptionalText(value: unknown): string | undefined {
  return readText(value) || undefined;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
