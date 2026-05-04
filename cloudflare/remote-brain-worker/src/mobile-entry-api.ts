/**
 * Mobile entry and wiki-list routes for the remote-brain Worker.
 *
 * This module isolates mobile D1 entry CRUD and wiki page listing so the main
 * Worker entrypoint stays focused on route dispatch.
 */

import type {
  MobileDbEnv,
  MobileEntryDeletePayload,
  MobileEntryPayload,
  MobileEntryResponseRecord,
  MobileEntryStatusPayload,
  MobileNormalizedEntry,
  MobileOwnerPayload,
  MobileWikiPagePayload,
} from "./mobile-shared.js";
import {
  parseStringArray,
  stringOrNull,
} from "./mobile-shared.js";
import {
  buildMobileWikiSyncState,
  mobileEntryFromDbRow,
} from "./mobile-runtime-helpers.js";
import { json, safeJson, titleFromPath } from "./worker-support.js";

const MOBILE_ENTRY_SELECT =
  "SELECT id, owner_uid AS ownerUid, type, title, text, media_files_json AS mediaFilesJson, created_at AS createdAt, target_date AS targetDate, status, channel, source_name AS sourceName, source_url AS sourceUrl, desktop_path AS desktopPath, synced_at AS syncedAt, failed_at AS failedAt, error FROM mobile_entries";
const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export async function handleMobileEntryCreate(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const entry = normalizeMobileEntry(await safeJson<MobileEntryPayload>(request));
  if (!entry.ownerUid && entry.channel !== "desktop-flash-diary") return json({ ok: false, error: "missing_owner_uid" }, 400);
  await upsertMobileEntry(db, entry);
  return json({ ok: true, entry });
}

export async function handleMobileEntryList(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const ownerUid = String((await safeJson<MobileOwnerPayload>(request)).ownerUid ?? "").trim();
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  const result = await db.prepare(`${MOBILE_ENTRY_SELECT} WHERE owner_uid = ? OR owner_uid = '' ORDER BY created_at DESC LIMIT 1000`).bind(ownerUid).all();
  const entries = dedupeMobileEntryList((result.results ?? []).map(mobileEntryFromRow));
  return json({ ok: true, entries });
}

export async function handleMobileEntryDelete(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileEntryDeletePayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  const ids = Array.isArray(payload.ids) ? payload.ids.map(String).filter(Boolean).slice(0, 100) : [];
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  if (!ids.length) return json({ ok: true, deleted: 0 });
  await db.batch(ids.map((id) => db.prepare("DELETE FROM mobile_entries WHERE owner_uid = ? AND id = ?").bind(ownerUid, id)));
  return json({ ok: true, deleted: ids.length });
}

export async function handleMobileEntryPending(env: MobileDbEnv, ownerUid?: string): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const result = ownerUid
    ? await db.prepare(`${MOBILE_ENTRY_SELECT} WHERE status = 'new' AND owner_uid = ? ORDER BY created_at ASC LIMIT 300`).bind(ownerUid).all()
    : await db.prepare(`${MOBILE_ENTRY_SELECT} WHERE status = 'new' ORDER BY created_at ASC LIMIT 300`).all();
  return json({ ok: true, entries: (result.results ?? []).map(mobileEntryFromRow) });
}

export async function handleMobileEntryStatus(request: Request, env: MobileDbEnv, ownerUid?: string): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileEntryStatusPayload>(request);
  const id = String(payload.id ?? "").trim();
  const status = payload.status === "synced" || payload.status === "failed" ? payload.status : "";
  if (!id) return json({ ok: false, error: "missing_entry_id" }, 400);
  if (!status) return json({ ok: false, error: "invalid_status" }, 400);
  const statement = ownerUid
    ? db.prepare("UPDATE mobile_entries SET status = ?, desktop_path = ?, synced_at = ?, failed_at = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_uid = ?")
      .bind(status, stringOrNull(payload.desktopPath), stringOrNull(payload.syncedAt), stringOrNull(payload.failedAt), stringOrNull(payload.error), id, ownerUid)
    : db.prepare("UPDATE mobile_entries SET status = ?, desktop_path = ?, synced_at = ?, failed_at = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(status, stringOrNull(payload.desktopPath), stringOrNull(payload.syncedAt), stringOrNull(payload.failedAt), stringOrNull(payload.error), id);
  await statement.run();
  return json({ ok: true, id, status });
}

export async function handleMobileWikiList(env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const pages = await readMobileWikiPages(db);
  const syncState = await readMobileWikiSyncState(db);
  return json({ ok: true, pages, syncState });
}

export async function handleMobileWikiPage(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  const payload = await safeJson<MobileWikiPagePayload>(request);
  const pagePath = String(payload.path ?? "").trim();
  if (!pagePath) return json({ ok: false, error: "missing_page_path" }, 400);

  const row = await db.prepare(
    "SELECT path, title, content_hash AS version, published_at AS publishedAt, updated_at AS updatedAt, content, r2_key AS r2Key FROM wiki_pages WHERE path = ?",
  ).bind(pagePath).first();
  if (!row) return json({ ok: false, error: "page_not_found" }, 404);

  const contentMarkdown = await readFullWikiPageContent(env, row);
  return json({
    ok: true,
    page: mobileWikiPageFromRow({ ...row, content: contentMarkdown }),
  });
}

export function normalizeMobileEntry(payload: MobileEntryPayload): MobileNormalizedEntry {
  const createdAt = String(payload.createdAt || new Date().toISOString());
  const type = payload.type === "clipping" ? "clipping" : "flash_diary";
  const status = payload.status === "synced" || payload.status === "failed" ? payload.status : "new";
  return {
    id: String(payload.id || crypto.randomUUID()),
    ownerUid: String(payload.ownerUid ?? "").trim(),
    type,
    title: String(payload.title || (type === "clipping" ? "剪藏" : "闪念日记")),
    text: String(payload.text || ""),
    mediaFiles: parseStringArray(payload.mediaFiles),
    createdAt,
    targetDate: String(payload.targetDate || formatChinaDate(createdAt)),
    status,
    channel: String(payload.channel || "mobile-app"),
    sourceName: stringOrNull(payload.sourceName),
    sourceUrl: stringOrNull(payload.sourceUrl),
    desktopPath: stringOrNull(payload.desktopPath),
    syncedAt: stringOrNull(payload.syncedAt),
    failedAt: stringOrNull(payload.failedAt),
    error: stringOrNull(payload.error),
  };
}

function formatChinaDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const parts = Object.fromEntries(
    CHINA_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function mobileEntryFromRow(row: Record<string, unknown>): MobileEntryResponseRecord {
  return mobileEntryFromDbRow(row) as MobileEntryResponseRecord;
}

function dedupeMobileEntryList(entries: MobileEntryResponseRecord[]): MobileEntryResponseRecord[] {
  const out: MobileEntryResponseRecord[] = [];
  const indexByKey = new Map<string, number>();

  for (const entry of entries) {
    const key = mobileEntryListDedupeKey(entry);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, out.length);
      out.push(entry);
      continue;
    }

    const existing = out[existingIndex];
    if (!existing.ownerUid && entry.ownerUid) {
      out[existingIndex] = entry;
    }
  }

  return out;
}

function mobileEntryListDedupeKey(entry: MobileEntryResponseRecord): string {
  return [
    entry.type,
    entry.targetDate,
    entry.createdAt.slice(11, 16),
    entry.text.trim().replace(/\s+/g, " "),
  ].join("\u0001");
}

async function upsertMobileEntry(db: D1Database, entry: MobileNormalizedEntry): Promise<void> {
  await db.prepare(
    "INSERT INTO mobile_entries (id, owner_uid, type, title, text, media_files_json, created_at, target_date, status, channel, source_name, source_url, desktop_path, synced_at, failed_at, error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET owner_uid = excluded.owner_uid, type = excluded.type, title = excluded.title, text = excluded.text, media_files_json = excluded.media_files_json, created_at = excluded.created_at, target_date = excluded.target_date, status = excluded.status, channel = excluded.channel, source_name = excluded.source_name, source_url = excluded.source_url, desktop_path = excluded.desktop_path, synced_at = excluded.synced_at, failed_at = excluded.failed_at, error = excluded.error, updated_at = CURRENT_TIMESTAMP",
  ).bind(
    entry.id,
    entry.ownerUid,
    entry.type,
    entry.title,
    entry.text,
    JSON.stringify(entry.mediaFiles),
    entry.createdAt,
    entry.targetDate,
    entry.status,
    entry.channel,
    entry.sourceName,
    entry.sourceUrl,
    entry.desktopPath,
    entry.syncedAt,
    entry.failedAt,
    entry.error,
  ).run();
}

function mobileWikiPageFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const path = String(row.path ?? "");
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

async function readMobileWikiPages(envDb: D1Database): Promise<Record<string, unknown>[]> {
  const result = await envDb.prepare(
    "SELECT path, title, content_hash AS version, published_at AS publishedAt, updated_at AS updatedAt, content FROM wiki_pages ORDER BY path LIMIT 500",
  ).all();
  return (result.results ?? []).map(mobileWikiPageFromRow);
}

async function readMobileWikiSyncState(envDb: D1Database): Promise<ReturnType<typeof buildMobileWikiSyncState>> {
  const pageCountRow = await envDb.prepare("SELECT COUNT(*) AS pageCount FROM wiki_pages").first();
  const latestPublishedRunRow = await envDb.prepare(
    "SELECT published_at AS lastWikiPublishAt, publish_version AS currentWikiVersion, status FROM publish_runs WHERE action = 'publish' AND status = 'published' ORDER BY published_at DESC, created_at DESC LIMIT 1",
  ).first();
  const latestRunRow = await envDb.prepare(
    "SELECT status FROM publish_runs WHERE action = 'publish' ORDER BY published_at DESC, created_at DESC LIMIT 1",
  ).first();
  return buildMobileWikiSyncState({
    pageCount: pageCountRow?.pageCount,
    lastWikiPublishAt: latestPublishedRunRow?.lastWikiPublishAt,
    currentWikiVersion: latestPublishedRunRow?.currentWikiVersion,
    lastCompileStatus: latestRunRow?.status,
  });
}

async function readFullWikiPageContent(env: MobileDbEnv, row: Record<string, unknown>): Promise<string> {
  const fallbackContent = String(row.content ?? "");
  const r2Key = String(row.r2Key ?? "").trim();
  if (!r2Key || !env.WIKI_BUCKET) {
    return fallbackContent;
  }
  const object = await env.WIKI_BUCKET.get(r2Key);
  if (!object) {
    return fallbackContent;
  }
  return await object.text();
}
