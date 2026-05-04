/**
 * Account-session sync routes for public desktop and mobile clients.
 *
 * These routes are the user-authorized replacement for sharing one global
 * `REMOTE_TOKEN` across every installation. The first supported backend is the
 * user's configured local directory; Cloudflare only stores account-scoped
 * metadata and published read models.
 */
import {
  readAccountSessionFromRequest,
  type AccountSession,
} from "./account-auth-api.js";
import {
  handleMobileEntryCreate,
  handleMobileEntryDelete,
  handleMobileEntryList,
  handleMobileEntryPending,
  handleMobileEntryStatus,
} from "./mobile-entry-api.js";
import { json, safeJson, titleFromPath } from "./worker-support.js";
import { notifyWikiPublished } from "./wiki-publish-events.js";

interface UserSyncEnv {
  DB?: D1Database;
  WIKI_BUCKET?: R2Bucket;
  WIKI_PUBLISH_EVENTS?: DurableObjectNamespace;
}

interface WikiFile {
  path: string;
  content: string;
  hash: string;
  modifiedAt: string;
}

interface UserPublishPayload {
  wikiRoot?: unknown;
  workspaceId?: unknown;
  publishVersion?: unknown;
  publishedAt?: unknown;
  files?: unknown;
  indexFiles?: unknown;
}

interface UserWikiPagePayload {
  workspaceId?: unknown;
  path?: unknown;
}

export async function handleUserPublish(request: Request, env: UserSyncEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);

  const payload = await safeJson<UserPublishPayload>(request);
  const workspaceId = readWorkspaceId(payload.workspaceId);
  const publishVersion = String(payload.publishVersion ?? "").trim();
  const wikiRoot = String(payload.wikiRoot ?? "").trim();
  if (!workspaceId) return json({ ok: false, error: "invalid_workspace_id" }, 400);
  if (!wikiRoot) return json({ ok: false, error: "missing_wiki_root" }, 400);
  if (!publishVersion) return json({ ok: false, error: "missing_publish_version" }, 400);

  const files = readWikiFiles(payload.files);
  const indexFiles = readWikiFiles(payload.indexFiles);
  const publishedAt = String(payload.publishedAt ?? new Date().toISOString());
  const runId = crypto.randomUUID();
  await createUserPublishRun(env.DB, {
    runId,
    accountId: session.accountId,
    workspaceId,
    wikiRoot,
    publishVersion,
    publishedAt,
    files,
    indexFiles,
  });

  for (const file of files) {
    await upsertUserWikiPage(env, session.accountId, workspaceId, file, publishedAt);
  }
  await env.DB.prepare("UPDATE publish_runs SET status = ?, error = NULL WHERE id = ?")
    .bind("published", runId)
    .run();
  await notifyWikiPublished(env, {
    publishVersion,
    publishedAt,
    pageCount: files.length,
    scope: "account",
    workspaceId,
  });

  return json({
    ok: true,
    action: "publish",
    runId,
    workspaceId,
    publishVersion,
    pageCount: files.length,
    indexFileCount: indexFiles.length,
  });
}

export async function handleUserMobileEntryCreate(request: Request, env: UserSyncEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileEntryCreate);
}

export async function handleUserMobileEntryList(request: Request, env: UserSyncEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileEntryList);
}

export async function handleUserMobileEntryDelete(request: Request, env: UserSyncEnv): Promise<Response> {
  return withAccountOwnerPayload(request, env, handleMobileEntryDelete);
}

export async function handleUserMobileEntryPending(request: Request, env: UserSyncEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  return handleMobileEntryPending(env, session.accountId);
}

export async function handleUserMobileEntryStatus(request: Request, env: UserSyncEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  return handleMobileEntryStatus(request, env, session.accountId);
}

export async function handleUserMobileWikiList(request: Request, env: UserSyncEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<UserWikiPagePayload>(request);
  const workspaceId = readWorkspaceId(payload.workspaceId);
  if (!workspaceId) return json({ ok: false, error: "invalid_workspace_id" }, 400);

  const prefix = scopedPrefix(session.accountId, workspaceId, "");
  const result = await env.DB.prepare(
    "SELECT path, title, content_hash AS version, published_at AS publishedAt, updated_at AS updatedAt, content FROM wiki_pages WHERE path >= ? AND path < ? ORDER BY path LIMIT 500",
  ).bind(prefix, upperBoundForPrefix(prefix)).all();
  return json({
    ok: true,
    pages: (result.results ?? []).map((row) => userWikiPageFromRow(row, prefix)),
  });
}

export async function handleUserMobileWikiPage(request: Request, env: UserSyncEnv): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  if (!env.DB) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<UserWikiPagePayload>(request);
  const workspaceId = readWorkspaceId(payload.workspaceId);
  const pagePath = normalizeWikiPath(payload.path);
  if (!workspaceId) return json({ ok: false, error: "invalid_workspace_id" }, 400);
  if (!pagePath) return json({ ok: false, error: "missing_page_path" }, 400);

  const prefix = scopedPrefix(session.accountId, workspaceId, "");
  const row = await env.DB.prepare(
    "SELECT path, title, content_hash AS version, published_at AS publishedAt, updated_at AS updatedAt, content, r2_key AS r2Key FROM wiki_pages WHERE path = ?",
  ).bind(`${prefix}${pagePath}`).first();
  if (!row) return json({ ok: false, error: "page_not_found" }, 404);
  const content = await readUserWikiPageContent(env, row);
  return json({ ok: true, page: userWikiPageFromRow({ ...row, content }, prefix) });
}

async function withAccountOwnerPayload(
  request: Request,
  env: UserSyncEnv,
  handler: (request: Request, env: UserSyncEnv) => Promise<Response>,
): Promise<Response> {
  const session = await requireAccountSession(request, env);
  if (session instanceof Response) return session;
  const payload = await safeJson<Record<string, unknown>>(request);
  return handler(rebuildJsonRequest(request, { ...payload, ownerUid: session.accountId }), env);
}

async function requireAccountSession(
  request: Request,
  env: UserSyncEnv,
): Promise<AccountSession | Response> {
  const session = await readAccountSessionFromRequest(request, env);
  return session ?? json({ ok: false, error: "unauthorized" }, 401);
}

function readWorkspaceId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9._:-]{3,120}$/.test(text) ? text : "";
}

function readWikiFiles(value: unknown): WikiFile[] {
  if (!Array.isArray(value)) return [];
  return value.map(readWikiFile).filter((file): file is WikiFile => Boolean(file));
}

function readWikiFile(value: unknown): WikiFile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const path = normalizeWikiPath(record.path);
  if (!path) return null;
  return {
    path,
    content: String(record.content ?? ""),
    hash: String(record.hash ?? ""),
    modifiedAt: String(record.modifiedAt ?? ""),
  };
}

function normalizeWikiPath(value: unknown): string {
  const text = String(value ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return text && !text.includes("..") ? text : "";
}

function rebuildJsonRequest(request: Request, body: Record<string, unknown>): Request {
  return new Request(request.url, {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createUserPublishRun(db: D1Database, input: {
  runId: string;
  accountId: string;
  workspaceId: string;
  wikiRoot: string;
  publishVersion: string;
  publishedAt: string;
  files: WikiFile[];
  indexFiles: WikiFile[];
}): Promise<void> {
  await db.prepare(
    "INSERT INTO publish_runs (id, action, wiki_root, publish_version, status, error, published_at, file_count, index_file_count, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    input.runId,
    "publish",
    scopedPrefix(input.accountId, input.workspaceId, input.wikiRoot),
    input.publishVersion,
    "running",
    null,
    input.publishedAt,
    input.files.length,
    input.indexFiles.length,
    JSON.stringify({
      files: input.files.map(toManifestEntry),
      indexFiles: input.indexFiles.map(toManifestEntry),
    }),
  ).run();
}

async function upsertUserWikiPage(
  env: UserSyncEnv,
  accountId: string,
  workspaceId: string,
  file: WikiFile,
  publishedAt: string,
): Promise<void> {
  const path = scopedPrefix(accountId, workspaceId, file.path);
  const r2Key = await writeUserPageToBucket(env.WIKI_BUCKET, path, file.content);
  await env.DB!.prepare(
    "INSERT INTO wiki_pages (path, title, content_hash, modified_at, published_at, r2_key, content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(path) DO UPDATE SET title = excluded.title, content_hash = excluded.content_hash, modified_at = excluded.modified_at, published_at = excluded.published_at, r2_key = excluded.r2_key, content = excluded.content, updated_at = CURRENT_TIMESTAMP",
  ).bind(path, titleFromPath(file.path), file.hash, file.modifiedAt, publishedAt, r2Key, file.content).run();
}

async function writeUserPageToBucket(
  bucket: R2Bucket | undefined,
  key: string,
  content: string,
): Promise<string | null> {
  if (!bucket) return null;
  await bucket.put(key, content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
  return key;
}

function scopedPrefix(accountId: string, workspaceId: string, value: string): string {
  return `accounts/${accountId}/${workspaceId}/${value.replace(/^\/+/, "")}`;
}

function upperBoundForPrefix(prefix: string): string {
  return `${prefix}\uffff`;
}

function toManifestEntry(file: WikiFile): Omit<WikiFile, "content"> {
  return { path: file.path, hash: file.hash, modifiedAt: file.modifiedAt };
}

function userWikiPageFromRow(row: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const storedPath = String(row.path ?? "");
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  return {
    id: path,
    path,
    slug: path.replace(/\.md$/i, ""),
    title: String(row.title ?? titleFromPath(path)),
    contentMarkdown: String(row.content ?? ""),
    pageType: "page",
    aliases: [],
    links: [],
    backlinks: [],
    updatedAt: String(row.updatedAt ?? row.publishedAt ?? ""),
    version: String(row.version ?? ""),
  };
}

async function readUserWikiPageContent(env: UserSyncEnv, row: Record<string, unknown>): Promise<string> {
  const fallbackContent = String(row.content ?? "");
  const r2Key = String(row.r2Key ?? "").trim();
  if (!r2Key || !env.WIKI_BUCKET) return fallbackContent;
  const object = await env.WIKI_BUCKET.get(r2Key);
  return object ? await object.text() : fallbackContent;
}
