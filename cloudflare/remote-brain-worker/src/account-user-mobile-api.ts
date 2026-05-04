/**
 * Account-session wrappers for mobile routes that used to require the shared
 * admin Remote Token.
 *
 * These handlers keep the existing mobile implementation but replace any
 * client-supplied owner id with the authenticated account id before the old
 * route code can touch D1, R2, OAuth token storage, or provider settings.
 */
import {
  readAccountSessionFromRequest,
  type AccountSession,
} from "./account-auth-api.js";
import {
  handleMobileChatCompleteCodexDirect,
  handleMobileChatList,
  handleMobileChatPrepareCodexDirect,
  handleMobileChatSend,
  handleMobileChatSourceRemove,
} from "./mobile-chat-api.js";
import { handleMobileCloudflareQuotaStatus } from "./mobile-cloudflare-quota-api.js";
import {
  handleMobileCodexOAuthPoll,
  handleMobileCodexOAuthStart,
} from "./mobile-codex-oauth-api.js";
import {
  handleMobileCodexQuotaRefresh,
  handleMobileCodexQuotaTokenSync,
} from "./mobile-codex-quota-api.js";
import {
  handleMobileDiaryImageGenerate,
  handleMobileProviderSave,
} from "./mobile-diary-image-api.js";
import {
  handleMobileDocumentGet,
  handleMobileDocumentSave,
} from "./mobile-document-api.js";
import { handleMobileLinkPreview } from "./mobile-link-preview-api.js";
import {
  handleMobileTaskAiDone,
  handleMobileTaskList,
  handleMobileTaskReviewSettingSave,
  handleMobileTaskSave,
} from "./mobile-task-api.js";
import { json, safeJson } from "./worker-support.js";

interface AccountUserMobileEnv {
  DB?: D1Database;
  WIKI_BUCKET?: R2Bucket;
  MEDIA_BUCKET?: R2Bucket;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  REMOTE_TOKEN?: string;
  LLM_MODEL?: string;
  CLOUDFLARE_SEARCH_ENDPOINT?: string;
  CLOUDFLARE_SEARCH_TOKEN?: string;
  CLOUDFLARE_SEARCH_MODEL?: string;
  QUOTA_READER_URL?: string;
  QUOTA_READER_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  PUBLIC_MEDIA_BASE_URL?: string;
}

type AccountMobileHandler = (request: Request, env: AccountUserMobileEnv) => Promise<Response>;

interface MediaUploadPayload {
  key?: unknown;
  contentBase64?: unknown;
  mimeType?: unknown;
}

export async function handleUserMobileChatList(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileChatList);
}

export async function handleUserMobileChatSend(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerWorkspacePayload(request, env, handleMobileChatSend);
}

export async function handleUserMobileChatPrepareCodexDirect(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerWorkspacePayload(request, env, handleMobileChatPrepareCodexDirect);
}

export async function handleUserMobileChatCompleteCodexDirect(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileChatCompleteCodexDirect);
}

export async function handleUserMobileChatSourceRemove(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileChatSourceRemove);
}

export async function handleUserMobileLinkPreview(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  return handleMobileLinkPreview(request, env);
}

export async function handleUserMobileProviderSave(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileProviderSave);
}

export async function handleUserMobileDiaryImageGenerate(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileDiaryImageGenerate);
}

export async function handleUserMobileCodexOAuthStart(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileCodexOAuthStart);
}

export async function handleUserMobileCodexOAuthPoll(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileCodexOAuthPoll);
}

export async function handleUserMobileCodexQuotaTokenSync(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileCodexQuotaTokenSync);
}

export async function handleUserMobileCodexQuotaRefresh(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileCodexQuotaRefresh);
}

export async function handleUserMobileCloudflareQuotaStatus(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  return handleMobileCloudflareQuotaStatus(env);
}

export async function handleUserMobileTaskList(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileTaskList);
}

export async function handleUserMobileTaskSave(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileTaskSave);
}

export async function handleUserMobileTaskAiDone(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileTaskAiDone);
}

export async function handleUserMobileTaskReviewSettingSave(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileTaskReviewSettingSave);
}

export async function handleUserMobileDocumentGet(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileDocumentGet);
}

export async function handleUserMobileDocumentSave(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileDocumentSave);
}

export async function handleUserMediaUpload(request: Request, env: AccountUserMobileEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  if (!env.MEDIA_BUCKET) return json({ ok: false, error: "missing_media_bucket_binding" }, 500);

  const payload = await safeJson<MediaUploadPayload>(request);
  const key = normalizeMediaKey(payload.key);
  const contentBase64 = readText(payload.contentBase64);
  if (!key || !contentBase64) return json({ ok: false, error: "missing_media_upload_fields" }, 400);

  const scopedKey = `accounts/${session.accountId}/media/${key}`;
  await env.MEDIA_BUCKET.put(scopedKey, decodeBase64(contentBase64), {
    httpMetadata: { contentType: readText(payload.mimeType) || "application/octet-stream" },
  });
  const url = new URL(request.url);
  return json({ ok: true, key: scopedKey, url: `${url.origin}/media/${encodeMediaKey(scopedKey)}` });
}

async function withAccountOwnerPayload(
  request: Request,
  env: AccountUserMobileEnv,
  handler: AccountMobileHandler,
): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  const payload = await safeJson<Record<string, unknown>>(request);
  return handler(rebuildJsonRequest(request, { ...payload, ownerUid: session.accountId }), env);
}

async function withAccountOwnerWorkspacePayload(
  request: Request,
  env: AccountUserMobileEnv,
  handler: AccountMobileHandler,
): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  const payload = await safeJson<Record<string, unknown>>(request);
  const workspaceId = readWorkspaceId(payload.workspaceId);
  if (!workspaceId) return json({ ok: false, error: "missing_workspace_id" }, 400);
  return handler(rebuildJsonRequest(request, {
    ...payload,
    ownerUid: session.accountId,
    workspaceId,
  }), env);
}

async function requireAccountSession(
  request: Request,
  env: AccountUserMobileEnv,
): Promise<AccountSession | Response> {
  const session = await readAccountSessionFromRequest(request, env);
  return session ?? json({ ok: false, error: "unauthorized" }, 401);
}

function rebuildJsonRequest(request: Request, body: Record<string, unknown>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readWorkspaceId(value: unknown): string {
  const text = readText(value);
  return /^[a-zA-Z0-9._:-]{3,120}$/.test(text) ? text : "";
}

function normalizeMediaKey(value: unknown): string {
  const key = readText(value).replace(/\\/g, "/").replace(/^\/+/, "");
  return key && !key.includes("..") ? key : "";
}

function decodeBase64(contentBase64: string): Uint8Array {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeMediaKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
