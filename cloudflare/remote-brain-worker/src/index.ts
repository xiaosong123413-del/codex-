/**
 * Cloudflare Worker Remote Brain MVP.
 *
 * The worker stores published wiki Markdown in D1, mirrors page bodies to R2
 * when the binding exists, and exposes the smallest JSON-RPC MCP surface needed
 * by remote clients.
 */

import {
  extractWorkerText,
  keywordResultsFromRows,
  normalizeSearchLimit,
  vectorResultsFromMatches,
} from "./runtime-helpers.js";
import {
  buildMobileChatReply,
  handleMobileChatCompleteCodexDirect,
  handleMobileChatList,
  handleMobileChatPrepareCodexDirect,
  handleMobileChatSend,
  handleMobileChatSourceRemove,
} from "./mobile-chat-api.js";
import {
  handleMobileEntryCreate,
  handleMobileEntryDelete,
  handleMobileEntryList,
  handleMobileEntryPending,
  handleMobileEntryStatus,
  handleMobileWikiPage,
  handleMobileWikiList,
} from "./mobile-entry-api.js";
import {
  handleMobileTaskAiDone,
  handleMobileTaskList,
  handleMobileTaskReviewSettingSave,
  handleMobileTaskSave,
  writeDailyTaskReview,
} from "./mobile-task-api.js";
import {
  handleMobileDocumentGet,
  handleMobileDocumentSave,
} from "./mobile-document-api.js";
import { handleMobileLinkPreview } from "./mobile-link-preview-api.js";
import {
  handleMobileDiaryImageGenerate,
  handleMobileProviderSave,
  writeDailyDiaryImages,
} from "./mobile-diary-image-api.js";
import {
  handleMobileCodexQuotaRefresh,
  handleMobileCodexQuotaTokenSync,
} from "./mobile-codex-quota-api.js";
import {
  handleMobileCodexOAuthPoll,
  handleMobileCodexOAuthStart,
} from "./mobile-codex-oauth-api.js";
import { handleMobileCloudflareQuotaStatus } from "./mobile-cloudflare-quota-api.js";
import {
  handleAccountIdentityBind,
  handleAccountIdentitiesList,
  handleAccountIdentityUnbind,
  handleAccountWeChatBind,
  handleAuthLogin,
  handleAuthRegister,
  handleAuthSession,
  handleAuthWeChatAuthorizeUrl,
  handleAuthWeChatLogin,
} from "./account-auth-api.js";
import {
  handleAuthWeChatMiniLoginConfirm,
  handleAuthWeChatMiniLoginPoll,
  handleAuthWeChatMiniLoginStart,
} from "./account-wechat-mini-login-api.js";
import {
  handleAccountAiChatCompletions,
  handleAccountAiSettingsGet,
  handleAccountAiSettingsSave,
} from "./account-ai-api.js";
import {
  handleAccountSyncLocationGet,
  handleAccountSyncLocationSave,
  handleAccountWorkspaceBind,
  handleAccountWorkspaceList,
} from "./account-workspace-api.js";
import {
  handleUserMobileEntryCreate,
  handleUserMobileEntryDelete,
  handleUserMobileEntryList,
  handleUserMobileEntryPending,
  handleUserMobileEntryStatus,
  handleUserMobileWikiList,
  handleUserMobileWikiPage,
  handleUserPublish,
} from "./account-user-sync-api.js";
import {
  handleUserMediaUpload,
  handleUserMobileChatCompleteCodexDirect,
  handleUserMobileChatList,
  handleUserMobileChatPrepareCodexDirect,
  handleUserMobileChatSend,
  handleUserMobileChatSourceRemove,
  handleUserMobileCloudflareQuotaStatus,
  handleUserMobileCodexOAuthPoll,
  handleUserMobileCodexOAuthStart,
  handleUserMobileCodexQuotaRefresh,
  handleUserMobileCodexQuotaTokenSync,
  handleUserMobileDiaryImageGenerate,
  handleUserMobileDocumentGet,
  handleUserMobileDocumentSave,
  handleUserMobileLinkPreview,
  handleUserMobileProviderSave,
  handleUserMobileTaskAiDone,
  handleUserMobileTaskList,
  handleUserMobileTaskReviewSettingSave,
  handleUserMobileTaskSave,
} from "./account-user-mobile-api.js";
import {
  handleWikiPublishEvents,
  notifyWikiPublished,
  WikiPublishEvents,
} from "./wiki-publish-events.js";

interface Env {
  REMOTE_TOKEN: string;
  LLM_MODEL?: string;
  OCR_MODEL?: string;
  TRANSCRIBE_MODEL?: string;
  EMBEDDING_MODEL?: string;
  CLOUDFLARE_SEARCH_ENDPOINT?: string;
  CLOUDFLARE_SEARCH_TOKEN?: string;
  CLOUDFLARE_SEARCH_MODEL?: string;
  QUOTA_READER_URL?: string;
  QUOTA_READER_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
  WECHAT_WEB_APP_ID?: string;
  WECHAT_WEB_APP_SECRET?: string;
  WECHAT_MINI_PROGRAM_APP_ID?: string;
  WECHAT_MINI_PROGRAM_APP_SECRET?: string;
  DB?: D1Database;
  WIKI_BUCKET?: R2Bucket;
  MEDIA_BUCKET?: R2Bucket;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  WIKI_PUBLISH_EVENTS?: DurableObjectNamespace;
}

interface WikiFile {
  path: string;
  content: string;
  hash: string;
  modifiedAt: string;
}

interface PublishPayload {
  action: "publish";
  wikiRoot: string;
  publishVersion: string;
  publishedAt: string;
  files: WikiFile[];
  indexFiles?: WikiFile[];
}

interface PushPayload {
  action: "push";
  wikiRoot: string;
  pushedAt: string;
  manifest?: Array<Omit<WikiFile, "content">>;
  indexManifest?: Array<Omit<WikiFile, "content">>;
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

interface AiTextPayload {
  model?: string;
  messages?: unknown[];
  prompt?: string;
}

interface MediaAiPayload {
  sourceId?: string;
  filename?: string;
  contentBase64?: string;
  mimeType?: string;
}

interface EmbedPayload {
  text?: string;
  model?: string;
}

interface VectorQueryPayload {
  vector?: number[];
  topK?: number;
}

interface SearchPayload {
  query?: string;
  limit?: number;
}

interface MediaUploadPayload {
  key?: string;
  contentBase64?: string;
  mimeType?: string;
}

interface AndroidAppUpdateManifest {
  platform?: string;
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
  sizeBytes?: number;
  publishedAt?: string;
  notes?: string;
}

interface PullPayload {
  limit?: number;
  cursor?: string;
}

type WorkerRouteHandler = (request: Request, env: Env, url: URL) => Response | Promise<Response>;

interface WorkerRoute {
  matches(request: Request, url: URL): boolean;
  handle(request: Request, env: Env, url: URL): Response | Promise<Response>;
}

const PUBLIC_ROUTES: readonly WorkerRoute[] = [
  createExactRoute("GET", "/status", (_request, env) => json({ ok: true, bindings: bindingStatus(env) })),
  createExactRoute("GET", "/app/update/latest", (_request, env) => handleAppUpdateLatest(env)),
  createExactRoute("GET", "/wiki/events", (request, env) => handleWikiPublishEvents(request, env)),
  createPrefixRoute("GET", "/media/", (request, env, url) => handleMediaRead(request, url, env)),
    createExactRoute("POST", "/auth/register", (request, env) => handleAuthRegister(request, env)),
    createExactRoute("POST", "/auth/login", (request, env) => handleAuthLogin(request, env)),
    createExactRoute("POST", "/auth/wechat/authorize-url", (request, env) => handleAuthWeChatAuthorizeUrl(request, env)),
    createExactRoute("POST", "/auth/wechat/login", (request, env) => handleAuthWeChatLogin(request, env)),
    createExactRoute("POST", "/auth/wechat/mini-login/start", (request, env) => handleAuthWeChatMiniLoginStart(request, env)),
    createExactRoute("POST", "/auth/wechat/mini-login/confirm", (request, env) => handleAuthWeChatMiniLoginConfirm(request, env)),
    createExactRoute("POST", "/auth/wechat/mini-login/poll", (request, env) => handleAuthWeChatMiniLoginPoll(request, env)),
  createExactRoute("POST", "/auth/session", (request, env) => handleAuthSession(request, env)),
  createExactRoute("POST", "/account/identities/list", (request, env) => handleAccountIdentitiesList(request, env)),
  createExactRoute("POST", "/account/identities/bind", (request, env) => handleAccountIdentityBind(request, env)),
  createExactRoute("POST", "/account/identities/wechat/bind", (request, env) => handleAccountWeChatBind(request, env)),
  createExactRoute("POST", "/account/identities/unbind", (request, env) => handleAccountIdentityUnbind(request, env)),
  createExactRoute("POST", "/account/workspaces/bind", (request, env) => handleAccountWorkspaceBind(request, env)),
  createExactRoute("POST", "/account/workspaces/list", (request, env) => handleAccountWorkspaceList(request, env)),
  createExactRoute("POST", "/account/sync-location/save", (request, env) => handleAccountSyncLocationSave(request, env)),
  createExactRoute("POST", "/account/sync-location/get", (request, env) => handleAccountSyncLocationGet(request, env)),
  createExactRoute("POST", "/user/ai/settings/get", (request, env) => handleAccountAiSettingsGet(request, env)),
  createExactRoute("POST", "/user/ai/settings/save", (request, env) => handleAccountAiSettingsSave(request, env)),
  createExactRoute("POST", "/user/ai/chat/completions", (request, env) => handleAccountAiChatCompletions(request, env)),
  createExactRoute("POST", "/user/ai/codex-oauth/start", (request, env) => handleUserMobileCodexOAuthStart(request, env)),
  createExactRoute("POST", "/user/ai/codex-oauth/poll", (request, env) => handleUserMobileCodexOAuthPoll(request, env)),
  createExactRoute("POST", "/user/ai/codex-quota/refresh", (request, env) => handleUserMobileCodexQuotaRefresh(request, env)),
  createExactRoute("POST", "/user/publish", (request, env) => handleUserPublish(request, env)),
  createExactRoute("POST", "/user/mobile/entries", (request, env) => handleUserMobileEntryCreate(request, env)),
  createExactRoute("POST", "/user/mobile/entries/list", (request, env) => handleUserMobileEntryList(request, env)),
  createExactRoute("POST", "/user/mobile/entries/delete", (request, env) => handleUserMobileEntryDelete(request, env)),
  createExactRoute("POST", "/user/mobile/entries/pending", (request, env) => handleUserMobileEntryPending(request, env)),
  createExactRoute("POST", "/user/mobile/entries/status", (request, env) => handleUserMobileEntryStatus(request, env)),
  createExactRoute("POST", "/user/mobile/wiki/list", (request, env) => handleUserMobileWikiList(request, env)),
  createExactRoute("POST", "/user/mobile/wiki/page", (request, env) => handleUserMobileWikiPage(request, env)),
  createExactRoute("POST", "/user/media/upload", (request, env) => handleUserMediaUpload(request, env)),
  createExactRoute("POST", "/user/mobile/chat/list", (request, env) => handleUserMobileChatList(request, env)),
  createExactRoute("POST", "/user/mobile/chat/send", (request, env) => handleUserMobileChatSend(request, env)),
  createExactRoute("POST", "/user/mobile/chat/codex-direct/prepare", (request, env) => handleUserMobileChatPrepareCodexDirect(request, env)),
  createExactRoute("POST", "/user/mobile/chat/codex-direct/complete", (request, env) => handleUserMobileChatCompleteCodexDirect(request, env)),
  createExactRoute("POST", "/user/mobile/chat/source/remove", (request, env) => handleUserMobileChatSourceRemove(request, env)),
  createExactRoute("POST", "/user/mobile/link-preview", (request, env) => handleUserMobileLinkPreview(request, env)),
  createExactRoute("POST", "/user/mobile/provider/save", (request, env) => handleUserMobileProviderSave(request, env)),
  createExactRoute("POST", "/user/mobile/diary-image/generate", (request, env) => handleUserMobileDiaryImageGenerate(request, env)),
  createExactRoute("POST", "/user/mobile/codex-oauth/start", (request, env) => handleUserMobileCodexOAuthStart(request, env)),
  createExactRoute("POST", "/user/mobile/codex-oauth/poll", (request, env) => handleUserMobileCodexOAuthPoll(request, env)),
  createExactRoute("POST", "/user/mobile/codex-quota/sync-token", (request, env) => handleUserMobileCodexQuotaTokenSync(request, env)),
  createExactRoute("POST", "/user/mobile/codex-quota/refresh", (request, env) => handleUserMobileCodexQuotaRefresh(request, env)),
  createExactRoute("POST", "/user/mobile/cloudflare-quota/status", (request, env) => handleUserMobileCloudflareQuotaStatus(request, env)),
  createExactRoute("POST", "/user/mobile/tasks/list", (request, env) => handleUserMobileTaskList(request, env)),
  createExactRoute("POST", "/user/mobile/tasks/save", (request, env) => handleUserMobileTaskSave(request, env)),
  createExactRoute("POST", "/user/mobile/tasks/done-ai", (request, env) => handleUserMobileTaskAiDone(request, env)),
  createExactRoute("POST", "/user/mobile/tasks/review-setting", (request, env) => handleUserMobileTaskReviewSettingSave(request, env)),
  createExactRoute("POST", "/user/mobile/documents/get", (request, env) => handleUserMobileDocumentGet(request, env)),
  createExactRoute("POST", "/user/mobile/documents/save", (request, env) => handleUserMobileDocumentSave(request, env)),
];

const AUTHORIZED_ROUTES: readonly WorkerRoute[] = [
  createExactRoute("POST", "/publish", (request, env) => handlePublish(request, env)),
  createExactRoute("POST", "/push", (request, env) => handlePush(request, env)),
  createExactRoute("POST", "/pull", (request, env) => handlePull(request, env)),
  createExactRoute("POST", "/mcp", (request, env) => handleMcp(request, env)),
  createExactRoute("POST", "/llm", (request, env) => handleLlm(request, env)),
  createExactRoute("POST", "/ocr", (request, env) => handleOcr(request, env)),
  createExactRoute("POST", "/transcribe", (request, env) => handleTranscribe(request, env)),
  createExactRoute("POST", "/embed", (request, env) => handleEmbed(request, env)),
  createExactRoute("POST", "/vector/query", (request, env) => handleVectorQuery(request, env)),
  createExactRoute("POST", "/search", (request, env) => handleSearch(request, env)),
  createExactRoute("POST", "/media/upload", (request, env) => handleMediaUpload(request, env)),
  createExactRoute("POST", "/mobile/entries", (request, env) => handleMobileEntryCreate(request, env)),
  createExactRoute("POST", "/mobile/entries/list", (request, env) => handleMobileEntryList(request, env)),
  createExactRoute("POST", "/mobile/entries/delete", (request, env) => handleMobileEntryDelete(request, env)),
  createExactRoute("POST", "/mobile/entries/pending", (_request, env) => handleMobileEntryPending(env)),
  createExactRoute("POST", "/mobile/entries/status", (request, env) => handleMobileEntryStatus(request, env)),
  createExactRoute("POST", "/mobile/wiki/list", (_request, env) => handleMobileWikiList(env)),
  createExactRoute("POST", "/mobile/wiki/page", (request, env) => handleMobileWikiPage(request, env)),
  createExactRoute("POST", "/mobile/chat/list", (request, env) => handleMobileChatList(request, env)),
  createExactRoute("POST", "/mobile/chat/send", (request, env) => handleMobileChatSend(request, env)),
  createExactRoute("POST", "/mobile/chat/codex-direct/prepare", (request, env) => handleMobileChatPrepareCodexDirect(request, env)),
  createExactRoute("POST", "/mobile/chat/codex-direct/complete", (request, env) => handleMobileChatCompleteCodexDirect(request, env)),
  createExactRoute("POST", "/mobile/chat/source/remove", (request, env) => handleMobileChatSourceRemove(request, env)),
  createExactRoute("POST", "/mobile/link-preview", (request, env) => handleMobileLinkPreview(request, env)),
  createExactRoute("POST", "/mobile/provider/save", (request, env) => handleMobileProviderSave(request, env)),
  createExactRoute("POST", "/mobile/diary-image/generate", (request, env) => handleMobileDiaryImageGenerate(request, env)),
  createExactRoute("POST", "/mobile/codex-oauth/start", (request, env) => handleMobileCodexOAuthStart(request, env)),
  createExactRoute("POST", "/mobile/codex-oauth/poll", (request, env) => handleMobileCodexOAuthPoll(request, env)),
  createExactRoute("POST", "/mobile/codex-quota/sync-token", (request, env) => handleMobileCodexQuotaTokenSync(request, env)),
  createExactRoute("POST", "/mobile/codex-quota/refresh", (request, env) => handleMobileCodexQuotaRefresh(request, env)),
  createExactRoute("POST", "/mobile/cloudflare-quota/status", (_request, env) => handleMobileCloudflareQuotaStatus(env)),
  createExactRoute("POST", "/mobile/tasks/list", (request, env) => handleMobileTaskList(request, env)),
  createExactRoute("POST", "/mobile/tasks/save", (request, env) => handleMobileTaskSave(request, env)),
  createExactRoute("POST", "/mobile/tasks/done-ai", (request, env) => handleMobileTaskAiDone(request, env)),
  createExactRoute("POST", "/mobile/tasks/review-setting", (request, env) => handleMobileTaskReviewSettingSave(request, env)),
  createExactRoute("POST", "/mobile/documents/get", (request, env) => handleMobileDocumentGet(request, env)),
  createExactRoute("POST", "/mobile/documents/save", (request, env) => handleMobileDocumentSave(request, env)),
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return corsPreflight(request);
      }

      const url = new URL(request.url);
      const publicResponse = await dispatchRoute(PUBLIC_ROUTES, request, env, url);
      if (publicResponse) return webSocketSafeResponse(publicResponse, request);
      if (!(await authorize(request, env))) {
        return withCors(json({ ok: false, error: "unauthorized" }, 401), request);
      }
      const response = await dispatchRoute(AUTHORIZED_ROUTES, request, env, url) ?? json({ ok: false, error: "not_found" }, 404);
      return withCors(response, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "worker_unhandled_error";
      return withCors(json({ ok: false, error: message }, 500), request);
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await writeDailyTaskReview(env);
    await writeDailyDiaryImages(env);
  },
};

export { buildMobileChatReply, WikiPublishEvents };

async function dispatchRoute(
  routes: readonly WorkerRoute[],
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  for (const route of routes) {
    if (route.matches(request, url)) {
      return await route.handle(request, env, url);
    }
  }
  return null;
}

function createExactRoute(method: string, path: string, handler: WorkerRouteHandler): WorkerRoute {
  return {
    matches(request, url) {
      return request.method === method && url.pathname === path;
    },
    handle: handler,
  };
}

function createPrefixRoute(method: string, prefix: string, handler: WorkerRouteHandler): WorkerRoute {
  return {
    matches(request, url) {
      return request.method === method && url.pathname.startsWith(prefix);
    },
    handle: handler,
  };
}

async function handleLlm(request: Request, env: Env): Promise<Response> {
  const payload = await request.json() as AiTextPayload;
  const model = payload.model || env.LLM_MODEL;
  const missing = requireAi(env, model);
  if (missing) return missing;

  try {
    const result = await env.AI.run(model, payload.messages ? { messages: payload.messages } : { prompt: payload.prompt ?? "" });
    return json({ text: extractWorkerText(result) });
  } catch {
    return json({ ok: false, error: "workers_ai_run_failed" }, 502);
  }
}

async function handleOcr(request: Request, env: Env): Promise<Response> {
  const payload = await request.json() as MediaAiPayload;
  const missing = requireAi(env, env.OCR_MODEL);
  if (missing) return missing;
  if (!payload.contentBase64) return json({ ok: false, error: "missing_content_base64" }, 400);

  try {
    if (env.OCR_MODEL?.includes("llama-3.2-11b-vision-instruct")) {
      await env.AI.run(env.OCR_MODEL, { prompt: "agree" }).catch(() => null);
    }
    const result = await env.AI.run(env.OCR_MODEL, {
      ...mediaAiInput(payload, "image"),
      prompt: "Return only the verbatim OCR text visible in the image. Preserve Chinese and line breaks. Do not describe the image. If no readable text is visible, return an empty string.",
    });
    return json({ text: extractWorkerText(result) });
  } catch {
    return json({ ok: false, error: "workers_ai_ocr_failed" }, 502);
  }
}

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  const payload = await request.json() as MediaAiPayload;
  const missing = requireAi(env, env.TRANSCRIBE_MODEL);
  if (missing) return missing;
  if (!payload.contentBase64) return json({ ok: false, error: "missing_content_base64" }, 400);

  try {
    const result = await env.AI.run(env.TRANSCRIBE_MODEL, mediaAiInput(payload, "audio"));
    return json({ text: extractWorkerText(result) });
  } catch {
    return json({ ok: false, error: "workers_ai_transcribe_failed" }, 502);
  }
}

async function handleEmbed(request: Request, env: Env): Promise<Response> {
  const payload = await request.json() as EmbedPayload;
  const model = payload.model || env.EMBEDDING_MODEL;
  const missing = requireAi(env, model);
  if (missing) return missing;
  if (!payload.text) return json({ ok: false, error: "missing_text" }, 400);

  try {
    const result = await env.AI.run(model, { text: payload.text });
    return json({ vector: extractVector(result) });
  } catch {
    return json({ ok: false, error: "workers_ai_embed_failed" }, 502);
  }
}

async function handleVectorQuery(request: Request, env: Env): Promise<Response> {
  if (!env.VECTORIZE) return json({ ok: false, error: "missing_vectorize_binding" }, 500);
  const payload = await request.json() as VectorQueryPayload;
  if (!Array.isArray(payload.vector)) return json({ ok: false, error: "missing_vector" }, 400);

  const topK = Math.max(1, Math.min(Number(payload.topK ?? 10), 50));
  const result = await env.VECTORIZE.query(payload.vector, { topK, returnMetadata: true });
  return json({ matches: result.matches ?? [] });
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await request.json() as SearchPayload;
  const query = String(payload.query ?? "").trim();
  if (!query) return json({ results: [] });

  const limit = normalizeSearchLimit(payload.limit);
  const keywordResults = await queryKeywordSearchResults(env.DB, query, limit);
  const vectorResults = await queryVectorSearchResults(env, query, limit);
  return json({ results: rrfFuseResults(keywordResults, vectorResults).slice(0, limit) });
}

async function queryKeywordSearchResults(
  db: D1Database,
  query: string,
  limit: number,
): Promise<Array<{ title: string; url: string; snippet: string; rank: number; source: string }>> {
  const result = await db.prepare(
    "SELECT title, path AS url, substr(content, 1, 300) AS snippet FROM wiki_pages WHERE content LIKE ? OR title LIKE ? ORDER BY path LIMIT ?",
  ).bind(`%${query}%`, `%${query}%`, limit).all();
  return keywordResultsFromRows(result.results ?? []);
}

async function queryVectorSearchResults(
  env: Env,
  query: string,
  limit: number,
): Promise<Array<{ title: string; url: string; snippet: string; rank: number; source: string }>> {
  if (!env.AI || !env.VECTORIZE || !env.EMBEDDING_MODEL) {
    return [];
  }
  try {
    const vector = await embedText(env, query);
    const result = await env.VECTORIZE.query(vector, { topK: limit, returnMetadata: true });
    return vectorResultsFromMatches(result.matches ?? []);
  } catch {
    return [];
  }
}

async function handleMediaUpload(request: Request, env: Env): Promise<Response> {
  if (!env.MEDIA_BUCKET) return json({ ok: false, error: "missing_media_bucket_binding" }, 500);
  const payload = await request.json() as MediaUploadPayload;
  if (!payload.key || !payload.contentBase64) return json({ ok: false, error: "missing_media_upload_fields" }, 400);

  await env.MEDIA_BUCKET.put(payload.key, decodeBase64(payload.contentBase64), {
    httpMetadata: { contentType: payload.mimeType || "application/octet-stream" },
  });
  const url = new URL(request.url);
  return json({ key: payload.key, url: `${url.origin}/media/${encodeMediaKey(payload.key)}` });
}

async function handleAppUpdateLatest(env: Env): Promise<Response> {
  if (!env.MEDIA_BUCKET) return noStore(json({ ok: false, error: "missing_media_bucket_binding" }, 500));
  const object = await env.MEDIA_BUCKET.get("app/android/latest.json");
  if (!object) return noStore(json({ ok: true, update: null }));
  const text = await object.text();
  const manifest = normalizeAndroidAppUpdateManifest(JSON.parse(text) as AndroidAppUpdateManifest);
  return noStore(json({ ok: true, update: manifest }));
}

function normalizeAndroidAppUpdateManifest(value: AndroidAppUpdateManifest): AndroidAppUpdateManifest | null {
  const required = normalizeAndroidAppRequiredFields(value);
  if (!required) {
    return null;
  }
  return {
    platform: "android",
    ...required,
    sizeBytes: normalizeOptionalPositiveNumber(value.sizeBytes),
    notes: String(value.notes ?? "").trim(),
  };
}

function normalizeAndroidAppRequiredFields(
  value: AndroidAppUpdateManifest,
): Pick<AndroidAppUpdateManifest, "versionCode" | "versionName" | "apkUrl" | "publishedAt"> | null {
  const versionCode = Number(value.versionCode);
  const versionName = String(value.versionName ?? "").trim();
  const apkUrl = String(value.apkUrl ?? "").trim();
  const publishedAt = String(value.publishedAt ?? "").trim();
  if (!Number.isInteger(versionCode) || versionCode <= 0) return null;
  if (!versionName || !apkUrl || !publishedAt) return null;
  return { versionCode, versionName, apkUrl, publishedAt };
}

function normalizeOptionalPositiveNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

// fallow-ignore-next-line complexity
async function handleMediaRead(request: Request, url: URL, env: Env): Promise<Response> {
  if (!env.MEDIA_BUCKET) return json({ ok: false, error: "missing_media_bucket_binding" }, 500);
  const key = decodeURIComponent(url.pathname.replace(/^\/media\//, ""));
  if (!key) return json({ ok: false, error: "missing_media_key" }, 400);

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const head = await env.MEDIA_BUCKET.head(key);
    if (!head) return json({ ok: false, error: "media_not_found" }, 404);
    const range = parseSingleByteRange(rangeHeader, head.size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${head.size}`,
          "accept-ranges": "bytes",
        },
      });
    }
    const object = await env.MEDIA_BUCKET.get(key, {
      range: {
        offset: range.offset,
        length: range.length,
      },
    });
    if (!object) return json({ ok: false, error: "media_not_found" }, 404);
    return new Response(object.body, {
      status: 206,
      headers: {
        "content-type": object.httpMetadata?.contentType || head.httpMetadata?.contentType || "application/octet-stream",
        "content-range": `bytes ${range.offset}-${range.end}/${head.size}`,
        "content-length": String(range.length),
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return json({ ok: false, error: "media_not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "application/octet-stream",
      "content-length": String(object.size),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

// fallow-ignore-next-line complexity
function parseSingleByteRange(value: string, size: number): { offset: number; length: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || size <= 0) {
    return null;
  }
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) {
    return null;
  }
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, size);
    const offset = size - length;
    return { offset, length, end: size - 1 };
  }
  const offset = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isFinite(offset) || !Number.isFinite(requestedEnd) || offset < 0 || requestedEnd < offset || offset >= size) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  return {
    offset,
    length: end - offset + 1,
    end,
  };
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ ok: false, error: "missing_d1_binding" }, 500);
  }

  const publish = normalizePublishRequest(await safeJson<PublishPayload>(request));
  if (!publish) {
    return json({ ok: false, error: "missing_wiki_root" }, 400);
  }
  if (!publish.publishVersion) {
    return json({ ok: false, error: "missing_publish_version" }, 400);
  }

  await createPublishRun(env.DB, publish);

  try {
    const vectorStats = await publishWikiPages(env, publish.pages, publish.publishedAt);
    await markPublishRunPublished(env.DB, publish.runId);
    await notifyWikiPublished(env, {
      publishVersion: publish.publishVersion,
      publishedAt: publish.publishedAt,
      pageCount: publish.pages.length,
      scope: "global",
    });
    return json({
      ok: true,
      action: "publish",
      runId: publish.runId,
      publishVersion: publish.publishVersion,
      pageCount: publish.pages.length,
      indexFileCount: publish.indexFiles.length,
      vectorUpserted: vectorStats.vectorUpserted,
      vectorErrors: vectorStats.vectorErrors,
      vectorErrorSamples: vectorStats.vectorErrorSamples,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markPublishRunFailed(env.DB, publish.runId, message);
    return json({ ok: false, error: message, runId: publish.runId }, 500);
  }
}

interface PublishRequestContext {
  publishedAt: string;
  publishVersion: string;
  runId: string;
  pages: WikiFile[];
  indexFiles: WikiFile[];
  wikiRoot: string;
}

interface PublishVectorStats {
  vectorUpserted: number;
  vectorErrors: number;
  vectorErrorSamples: string[];
}

const MAX_D1_WIKI_CONTENT_BYTES = 180_000;
const D1_WIKI_TRUNCATION_NOTICE = "\n\n> [Full content available from Cloudflare R2]\n";
const TEXT_ENCODER = new TextEncoder();

function normalizePublishRequest(payload: PublishPayload): PublishRequestContext | null {
  const wikiRoot = String(payload.wikiRoot ?? "").trim();
  if (!wikiRoot) {
    return null;
  }
  return {
    publishedAt: payload.publishedAt || new Date().toISOString(),
    publishVersion: String(payload.publishVersion ?? "").trim(),
    runId: crypto.randomUUID(),
    pages: Array.isArray(payload.files) ? payload.files : [],
    indexFiles: Array.isArray(payload.indexFiles) ? payload.indexFiles : [],
    wikiRoot,
  };
}

async function createPublishRun(db: D1Database, publish: PublishRequestContext): Promise<void> {
  await db.prepare(
    "INSERT INTO publish_runs (id, action, wiki_root, publish_version, status, error, published_at, file_count, index_file_count, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    publish.runId,
    "publish",
    publish.wikiRoot,
    publish.publishVersion,
    "running",
    null,
    publish.publishedAt,
    publish.pages.length,
    publish.indexFiles.length,
    JSON.stringify({
      files: publish.pages.map(toManifestEntry),
      indexFiles: publish.indexFiles.map(toManifestEntry),
    }),
  ).run();
}

async function publishWikiPages(
  env: Env,
  pages: readonly WikiFile[],
  publishedAt: string,
): Promise<PublishVectorStats> {
  const stats: PublishVectorStats = {
    vectorUpserted: 0,
    vectorErrors: 0,
    vectorErrorSamples: [],
  };
  for (const page of pages) {
    await publishWikiPage(env, page, publishedAt, stats);
  }
  return stats;
}

async function publishWikiPage(
  env: Env,
  page: WikiFile,
  publishedAt: string,
  stats: PublishVectorStats,
): Promise<void> {
  const r2Key = await writePublishPageToBucket(env.WIKI_BUCKET, page);
  await upsertWikiPage(env.DB!, page, publishedAt, r2Key);
  await upsertPublishVector(env, page, publishedAt, stats);
}

async function writePublishPageToBucket(bucket: R2Bucket | undefined, page: WikiFile): Promise<string | null> {
  if (!bucket) {
    return null;
  }
  await bucket.put(page.path, page.content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
  return page.path;
}

async function upsertPublishVector(
  env: Env,
  page: WikiFile,
  publishedAt: string,
  stats: PublishVectorStats,
): Promise<void> {
  if (!env.AI || !env.VECTORIZE || !env.EMBEDDING_MODEL) {
    return;
  }
  try {
    await upsertWikiVector(env, page, publishedAt);
    stats.vectorUpserted += 1;
  } catch (error) {
    stats.vectorErrors += 1;
    if (stats.vectorErrorSamples.length < 5) {
      stats.vectorErrorSamples.push(error instanceof Error ? error.message : String(error));
    }
  }
}

async function markPublishRunPublished(db: D1Database, runId: string): Promise<void> {
  await db.prepare(
    "UPDATE publish_runs SET status = ?, error = NULL WHERE id = ?",
  ).bind("published", runId).run();
}

async function markPublishRunFailed(db: D1Database, runId: string, message: string): Promise<void> {
  await db.prepare(
    "UPDATE publish_runs SET status = ?, error = ? WHERE id = ?",
  ).bind("failed", message, runId).run();
}

async function handlePush(request: Request, env: Env): Promise<Response> {
  const payload = await request.json() as PushPayload;
  const manifest = Array.isArray(payload.manifest) ? payload.manifest : [];
  const indexManifest = Array.isArray(payload.indexManifest) ? payload.indexManifest : [];
  const runId = crypto.randomUUID();
  const publishVersion = payload.pushedAt || runId;

  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO publish_runs (id, action, wiki_root, publish_version, status, error, published_at, file_count, index_file_count, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(runId, "push", payload.wikiRoot, publishVersion, "published", null, payload.pushedAt, manifest.length, indexManifest.length, JSON.stringify({
      manifest,
      indexManifest,
    })).run();
  }

  return json({ ok: true, action: "push", runId, received: manifest.length, bindings: bindingStatus(env) });
}

async function handlePull(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return json({ ok: true, action: "pull", pages: [], bindings: bindingStatus(env) });
  }

  const payload = await safeJson<PullPayload>(request);
  const limit = Math.max(1, Math.min(Number(payload.limit ?? 200), 500));
  const cursor = typeof payload.cursor === "string" ? payload.cursor : "";
  const result = cursor
    ? await env.DB.prepare(
      "SELECT path, title, content_hash AS hash, modified_at AS modifiedAt, published_at AS publishedAt FROM wiki_pages WHERE path > ? ORDER BY path LIMIT ?",
    ).bind(cursor, limit).all()
    : await env.DB.prepare(
      "SELECT path, title, content_hash AS hash, modified_at AS modifiedAt, published_at AS publishedAt FROM wiki_pages ORDER BY path LIMIT ?",
    ).bind(limit).all();
  const pages = result.results ?? [];
  const nextCursor = pages.length === limit ? String(pages[pages.length - 1]?.path ?? "") : null;
  return json({ ok: true, action: "pull", pages, nextCursor, limit, bindings: bindingStatus(env) });
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const rpc = await request.json() as JsonRpcRequest;
  if (rpc.method === "tools/list") {
    return jsonRpc(rpc.id, { tools: [getPageTool(), searchWikiTool()] });
  }
  if (rpc.method === "tools/call") {
    return handleToolCall(rpc, env);
  }
  return jsonRpcError(rpc.id, -32601, "Method not found");
}

async function handleToolCall(rpc: JsonRpcRequest, env: Env): Promise<Response> {
  const name = rpc.params?.name;
  const args = rpc.params?.arguments ?? {};
  if (name === "get_page") {
    return jsonRpc(rpc.id, await getPage(env, String(args.path ?? "")));
  }
  if (name === "search_wiki") {
    return jsonRpc(rpc.id, await searchWiki(env, String(args.query ?? ""), Number(args.limit ?? 10)));
  }
  return jsonRpcError(rpc.id, -32602, "Unknown tool");
}

async function getPage(env: Env, pagePath: string): Promise<unknown> {
  if (!env.DB || !pagePath) {
    return { content: [{ type: "text", text: "" }], isError: true };
  }
  const page = await env.DB.prepare("SELECT path, title, content FROM wiki_pages WHERE path = ?").bind(pagePath).first();
  if (!page) {
    return { content: [{ type: "text", text: `Page not found: ${pagePath}` }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(page) }] };
}

async function searchWiki(env: Env, query: string, limit: number): Promise<unknown> {
  if (!env.DB || !query) {
    return { content: [{ type: "text", text: "[]" }] };
  }
  const cappedLimit = Math.max(1, Math.min(limit || 10, 20));
  const result = await env.DB.prepare(
    "SELECT path, title, substr(content, 1, 500) AS excerpt FROM wiki_pages WHERE content LIKE ? OR title LIKE ? ORDER BY path LIMIT ?",
  ).bind(`%${query}%`, `%${query}%`, cappedLimit).all();
  return { content: [{ type: "text", text: JSON.stringify(result.results ?? []) }] };
}

async function upsertWikiPage(db: D1Database, page: WikiFile, publishedAt: string, r2Key: string | null): Promise<void> {
  const d1Content = buildD1WikiContent(page.content);
  await db.prepare(
    "INSERT INTO wiki_pages (path, title, content_hash, modified_at, published_at, r2_key, content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(path) DO UPDATE SET title = excluded.title, content_hash = excluded.content_hash, modified_at = excluded.modified_at, published_at = excluded.published_at, r2_key = excluded.r2_key, content = excluded.content, updated_at = CURRENT_TIMESTAMP",
  ).bind(page.path, titleFromPath(page.path), page.hash, page.modifiedAt, publishedAt, r2Key, d1Content).run();
}

async function upsertWikiVector(env: Env, page: WikiFile, publishedAt: string): Promise<void> {
  if (!env.VECTORIZE) return;
  const vector = await embedText(env, `${titleFromPath(page.path)}\n${page.content.slice(0, 6000)}`);
  const vectorId = await vectorIdForPath(page.path);
  await env.VECTORIZE.upsert([{
    id: vectorId,
    values: vector,
    metadata: {
      path: page.path,
      title: titleFromPath(page.path),
      hash: page.hash,
      publishedAt,
      excerpt: page.content.replace(/\s+/g, " ").trim().slice(0, 300),
    },
  }]);
}

async function vectorIdForPath(pagePath: string): Promise<string> {
  const bytes = new TextEncoder().encode(pagePath);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildD1WikiContent(content: string): string {
  if (textByteLength(content) <= MAX_D1_WIKI_CONTENT_BYTES) {
    return content;
  }
  const allowedBytes = Math.max(0, MAX_D1_WIKI_CONTENT_BYTES - textByteLength(D1_WIKI_TRUNCATION_NOTICE));
  return `${trimTextToByteLimit(content, allowedBytes)}${D1_WIKI_TRUNCATION_NOTICE}`;
}

function trimTextToByteLimit(content: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  if (textByteLength(content) <= maxBytes) {
    return content;
  }

  let low = 0;
  let high = content.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (textByteLength(content.slice(0, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return content.slice(0, low);
}

function textByteLength(content: string): number {
  return TEXT_ENCODER.encode(content).length;
}

async function authorize(request: Request, env: Env): Promise<boolean> {
  const expected = env.REMOTE_TOKEN;
  const actual = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !actual) return false;
  return timingSafeEqual(actual, expected);
}

async function timingSafeEqual(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let diff = actual.length ^ expected.length;
  for (let index = 0; index < actualBytes.length; index += 1) {
    diff |= actualBytes[index] ^ expectedBytes[index];
  }
  return diff === 0;
}

function bindingStatus(env: Env): Record<string, boolean> {
  return {
    d1: Boolean(env.DB),
    r2: Boolean(env.WIKI_BUCKET),
    mediaR2: Boolean(env.MEDIA_BUCKET),
    vectorize: Boolean(env.VECTORIZE),
    ai: Boolean(env.AI),
    wikiEvents: Boolean(env.WIKI_PUBLISH_EVENTS),
  };
}

function requireAi(env: Env, model?: string): Response | null {
  if (!env.AI) return json({ ok: false, error: "missing_ai_binding" }, 500);
  if (!model) return json({ ok: false, error: "missing_ai_model" }, 500);
  return null;
}

function mediaAiInput(payload: MediaAiPayload, field: "image" | "audio"): Record<string, unknown> {
  return {
    [field]: [...decodeBase64(payload.contentBase64 ?? "")],
    sourceId: payload.sourceId,
    filename: payload.filename,
    mimeType: payload.mimeType,
  };
}

function decodeBase64(contentBase64: string): Uint8Array {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function extractVector(result: unknown): number[] {
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  const data = record.data;
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0] as number[];
  if (Array.isArray(record.vector)) return record.vector as number[];
  return [];
}

async function embedText(env: Env, text: string): Promise<number[]> {
  const model = env.EMBEDDING_MODEL;
  if (!env.AI || !model) throw new Error("missing embedding model");
  const result = await env.AI.run(model, { text });
  const vector = extractVector(result);
  if (!vector.length) throw new Error("empty embedding vector");
  return vector;
}

function rrfFuseResults(
  keywordResults: Array<{ title: string; url: string; snippet: string; rank: number; source: string }>,
  vectorResults: Array<{ title: string; url: string; snippet: string; rank: number; source: string }>,
): Array<{ title: string; url: string; snippet: string; score: number; sources: string[] }> {
  const merged = new Map<string, { title: string; url: string; snippet: string; score: number; sources: Set<string> }>();
  for (const list of [keywordResults, vectorResults]) {
    for (const item of list) {
      const key = item.url || item.title;
      const current = merged.get(key) ?? {
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        score: 0,
        sources: new Set<string>(),
      };
      current.score += 1 / (60 + item.rank + 1);
      current.sources.add(item.source);
      if (!current.snippet && item.snippet) current.snippet = item.snippet;
      merged.set(key, current);
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.score - left.score)
    .map((item) => ({ ...item, sources: [...item.sources] }));
}

function encodeMediaKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function safeJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    return {} as T;
  }
}

function toManifestEntry(file: WikiFile): Omit<WikiFile, "content"> {
  return { path: file.path, hash: file.hash, modifiedAt: file.modifiedAt };
}

function titleFromPath(pagePath: string): string {
  return pagePath.replace(/^wiki\//, "").replace(/\.md$/, "").split("/").pop() || pagePath;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function corsPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function webSocketSafeResponse(response: Response, request: Request): Response {
  return response.status === 101 ? response : withCors(response, request);
}

function corsHeaders(request: Request): Headers {
  const origin = request.headers.get("Origin") || "*";
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
}

function jsonRpc(id: JsonRpcRequest["id"], result: unknown): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function getPageTool(): unknown {
  return {
    name: "get_page",
    description: "Read one published wiki page by path.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  };
}

function searchWikiTool(): unknown {
  return {
    name: "search_wiki",
    description: "Search published wiki pages by title or Markdown content.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  };
}
