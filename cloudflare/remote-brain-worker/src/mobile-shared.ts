/**
 * Shared mobile payload contracts and coercion helpers for the remote-brain
 * Worker.
 *
 * The mobile entry and chat route modules both normalize loosely typed D1 rows
 * and request payloads. Centralizing the shapes here keeps that coercion logic
 * consistent without re-implementing it in each route file.
 */

import type {
  MobileChatMode,
  MobileChatSource,
  MobileWebSearchResult,
} from "./mobile-chat.js";

type MobileEntryType = "flash_diary" | "clipping";
type MobileEntryStatus = "new" | "synced" | "failed";

interface MobileEntryBase {
  id: string;
  ownerUid: string;
  type: MobileEntryType;
  title: string;
  text: string;
  mediaFiles: string[];
  createdAt: string;
  targetDate: string;
  status: MobileEntryStatus;
  channel: string;
}

export interface MobileDbEnv {
  DB?: D1Database;
  WIKI_BUCKET?: R2Bucket;
}

export interface MobileChatEnv extends MobileDbEnv {
  REMOTE_TOKEN?: string;
  LLM_MODEL?: string;
  CLOUDFLARE_SEARCH_ENDPOINT?: string;
  CLOUDFLARE_SEARCH_TOKEN?: string;
  CLOUDFLARE_SEARCH_MODEL?: string;
  AI?: Ai;
}

export interface MobileEntryPayload {
  id?: string;
  ownerUid?: string;
  type?: string;
  title?: string;
  text?: string;
  mediaFiles?: unknown;
  createdAt?: string;
  targetDate?: string;
  status?: string;
  channel?: string;
  sourceName?: string;
  sourceUrl?: string;
  desktopPath?: string;
  syncedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface MobileNormalizedEntry extends MobileEntryBase {
  sourceName: string | null;
  sourceUrl: string | null;
  desktopPath: string | null;
  syncedAt: string | null;
  failedAt: string | null;
  error: string | null;
}

export interface MobileEntryResponseRecord extends MobileEntryBase {
  sourceName?: string;
  sourceUrl?: string;
  desktopPath?: string;
  syncedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface MobileOwnerPayload {
  ownerUid?: string;
}

export interface MobileAiProviderRequest {
  mode?: unknown;
  apiName?: unknown;
  apiBaseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
}

export interface MobileWebSearchRequest {
  enabled?: unknown;
  mode?: unknown;
  endpoint?: unknown;
  token?: unknown;
  model?: unknown;
}

export interface MobileWikiPagePayload {
  path?: string;
}

export interface MobileEntryDeletePayload extends MobileOwnerPayload {
  ids?: unknown;
}

export interface MobileEntryStatusPayload {
  id?: string;
  status?: string;
  desktopPath?: string;
  syncedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface MobileChatPayload extends MobileOwnerPayload {
  chatId?: string;
  message?: string;
  mode?: unknown;
  workspaceId?: unknown;
  selectedWikiPaths?: unknown;
  aiProvider?: MobileAiProviderRequest;
  webSearch?: MobileWebSearchRequest | null;
}

export interface MobileChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface MobileChatRecord {
  id: string;
  ownerUid: string;
  title: string;
  mode: MobileChatMode;
  messages: MobileChatMessage[];
  sources: MobileChatSource[];
  createdAt: string;
  updatedAt: string;
}

export interface MobileWikiContextItem {
  path: string;
  title: string;
  content: string;
}

export type MobileWebSearchOutcome =
  | { ok: true; results: MobileWebSearchResult[] }
  | { ok: false; error: string };

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
