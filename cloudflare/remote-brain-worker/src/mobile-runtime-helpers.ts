/**
 * Mobile row normalization helpers for the Remote Brain Worker.
 *
 * These helpers are shared by the mobile entry and chat route modules so they
 * can normalize D1 rows consistently without depending on the main Worker
 * entrypoint.
 */

import {
  resolveMobileChatMode,
  type MobileChatMode,
  type MobileChatSource,
} from "./mobile-chat.js";

interface MobileChatMessageLike {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface MobileChatRecordLike {
  id: string;
  ownerUid: string;
  title: string;
  mode: MobileChatMode;
  messages: MobileChatMessageLike[];
  sources: MobileChatSource[];
  createdAt: string;
  updatedAt: string;
}

interface MobileWikiSyncStateArgs {
  pageCount: unknown;
  lastWikiPublishAt: unknown;
  currentWikiVersion: unknown;
  lastCompileStatus: unknown;
}

// fallow-ignore-next-line complexity
export function mobileEntryFromDbRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id ?? ""),
    ownerUid: String(row.ownerUid ?? row.owner_uid ?? ""),
    type: row.type === "clipping" ? "clipping" : "flash_diary",
    title: String(row.title ?? ""),
    text: String(row.text ?? ""),
    mediaFiles: parseStringArray(row.mediaFilesJson ?? row.media_files_json),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    targetDate: String(row.targetDate ?? row.target_date ?? ""),
    status: row.status === "synced" || row.status === "failed" ? row.status : "new",
    channel: String(row.channel ?? "mobile-app"),
    sourceName: stringOrUndefined(row.sourceName ?? row.source_name),
    sourceUrl: stringOrUndefined(row.sourceUrl ?? row.source_url),
    desktopPath: stringOrUndefined(row.desktopPath ?? row.desktop_path),
    syncedAt: stringOrUndefined(row.syncedAt ?? row.synced_at),
    failedAt: stringOrUndefined(row.failedAt ?? row.failed_at),
    error: stringOrUndefined(row.error),
  };
}

export function normalizeMobileChatRecord(row: Record<string, unknown>): MobileChatRecordLike {
  return {
    id: String(row.id ?? ""),
    ownerUid: String(row.ownerUid ?? row.owner_uid ?? ""),
    title: String(row.title ?? "新对话"),
    mode: resolveMobileChatMode(row.mode),
    messages: normalizeMobileChatMessages(row.messagesJson ?? row.messages_json),
    sources: normalizeMobileChatSources(row.sourcesJson ?? row.sources_json),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? ""),
  };
}

export function buildMobileWikiSyncState(args: MobileWikiSyncStateArgs): {
  id: "desktop";
  lastWikiPublishAt: string;
  currentWikiVersion: string;
  lastCompileStatus: string;
  pageCount: number;
} {
  return {
    id: "desktop",
    lastWikiPublishAt: String(args.lastWikiPublishAt ?? ""),
    currentWikiVersion: String(args.currentWikiVersion ?? ""),
    lastCompileStatus: String(args.lastCompileStatus ?? ""),
    pageCount: Number(args.pageCount ?? 0),
  };
}

function normalizeMobileChatMessages(value: unknown): MobileChatMessageLike[] {
  return parseObjectArray(value)
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      id: String(item.id ?? ""),
      role: item.role as "user" | "assistant",
      content: String(item.content ?? ""),
      createdAt: String(item.createdAt ?? ""),
    }));
}

function normalizeMobileChatSources(value: unknown): MobileChatSource[] {
  return parseObjectArray(value).map((item) => ({
    id: String(item.id ?? ""),
    type: (item.type === "web" ? "web" : "wiki") as MobileChatSource["type"],
    title: String(item.title ?? ""),
    path: stringOrUndefined(item.path),
    url: stringOrUndefined(item.url),
    domain: stringOrUndefined(item.domain),
  }));
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isObjectRecord);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isObjectRecord) : [];
  } catch {
    return [];
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}
