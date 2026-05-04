/**
 * Runtime search-index loader.
 *
 * The compiler writes a JSON snapshot under `.llmwiki/search-index.json`. This
 * module keeps the server-side reader strict by normalizing unknown JSON into
 * the exact entry shape used by search routes.
 */

import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { runtimePath } from "../runtime-paths.js";
import { readSourceOcrSidecar } from "./ocr-service.js";
import { readSourceMediaIndex } from "./source-media-index.js";
import type { MarkdownImageRef } from "./markdown-images.js";

export interface SearchIndexEntry {
  id: string;
  title: string;
  path: string;
  layer: "wiki" | "raw" | "source" | "unknown";
  excerpt: string;
  tags: string[];
  modifiedAt: string | null;
  searchText?: string;
  images?: MarkdownImageRef[];
}

interface RawSearchIndexEntry {
  id?: unknown;
  title?: unknown;
  path?: unknown;
  layer?: unknown;
  excerpt?: unknown;
  tags?: unknown;
  modifiedAt?: unknown;
  images?: unknown;
}

export function loadSearchIndex(cfg?: ServerConfig): SearchIndexEntry[] {
  if (!cfg?.runtimeRoot) return [];
  const indexPath = runtimePath(cfg, ".llmwiki", "search-index.json");
  if (!fs.existsSync(indexPath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];

    return enrichEntriesWithOcrText(cfg.runtimeRoot, items.flatMap((item) => normalizeEntry(item)));
  } catch {
    return [];
  }
}

function enrichEntriesWithOcrText(runtimeRoot: string, entries: SearchIndexEntry[]): SearchIndexEntry[] {
  const ocrRecordIds = buildOcrRecordIdsByPath(runtimeRoot);
  if (ocrRecordIds.size === 0) {
    return entries;
  }
  return entries.map((entry) => enrichEntryWithOcrText(runtimeRoot, entry, ocrRecordIds));
}

function enrichEntryWithOcrText(
  runtimeRoot: string,
  entry: SearchIndexEntry,
  ocrRecordIds: ReadonlyMap<string, string>,
): SearchIndexEntry {
  const sourceId = ocrRecordIds.get(normalizeIndexPath(entry.path));
  if (!sourceId) {
    return entry;
  }
  const ocrText = readSourceOcrSidecar(runtimeRoot, sourceId).trim();
  if (!ocrText) {
    return entry;
  }
  return {
    ...entry,
    searchText: [entry.searchText, ocrText].filter(Boolean).join("\n"),
  };
}

function buildOcrRecordIdsByPath(runtimeRoot: string): Map<string, string> {
  const index = readSourceMediaIndex(runtimeRoot);
  const entries = Object.values(index.records)
    .filter((record) => record.ocrTextPath)
    .map((record) => [normalizeIndexPath(record.path), record.id] as const);
  return new Map(entries);
}

function normalizeEntry(item: unknown): SearchIndexEntry[] {
  if (!item || typeof item !== "object") {
    return [];
  }
  const raw = item as RawSearchIndexEntry;
  const required = readRequiredSearchEntry(raw);
  if (!required) {
    return [];
  }
  const entry: SearchIndexEntry = {
    ...required,
    layer: normalizeSearchLayer(raw.layer),
    excerpt: readOptionalSearchText(raw.excerpt) ?? "",
    tags: normalizeSearchTags(raw.tags),
    modifiedAt: readOptionalSearchText(raw.modifiedAt),
  };
  const images = normalizeImages(raw.images);
  if (images.length > 0) {
    entry.images = images;
  }
  return [entry];
}

function normalizeImages(value: unknown): MarkdownImageRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<MarkdownImageRef>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url) return [];
    return [{
      url,
      alt: typeof record.alt === "string" ? record.alt.trim() : "",
    }];
  });
}

function readRequiredSearchEntry(
  raw: RawSearchIndexEntry,
): Pick<SearchIndexEntry, "id" | "title" | "path"> | null {
  const id = readOptionalSearchText(raw.id);
  const title = readOptionalSearchText(raw.title);
  const pathValue = readOptionalSearchText(raw.path);
  if (!hasSearchText(id) || !hasSearchText(title) || !hasSearchText(pathValue)) {
    return null;
  }
  return {
    id,
    title,
    path: pathValue,
  };
}

function normalizeSearchLayer(value: unknown): SearchIndexEntry["layer"] {
  return value === "wiki" || value === "raw" || value === "source"
    ? value
    : "unknown";
}

function normalizeSearchTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
}

function readOptionalSearchText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function hasSearchText(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeIndexPath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}
