import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createRenderer } from "../render/markdown.js";
import { getConversation } from "./chat-store.js";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";
import { createSourceBookmark, createSourceNote } from "./sources-full.js";
import { readSourceMediaIndex, writeSourceMediaIndex } from "./source-media-index.js";
import { readSourceOcrSidecar } from "./ocr-service.js";
import { ensureSourceImageOcr, runSourcePathImageOcr } from "./source-ocr.js";
import { runCloudflareTranscription } from "./transcript-service.js";

export type SourceGallerySort = "modified-desc" | "modified-asc" | "created-desc" | "created-asc";
export type SourceGalleryLayer = "raw" | "source";

interface SourceGalleryFilters {
  buckets?: string[];
  tags?: string[];
  layers?: SourceGalleryLayer[];
}

interface SourceGalleryFilterOptions {
  buckets: string[];
  tags: string[];
  layers: SourceGalleryLayer[];
}

interface SourceGalleryItem {
  id: string;
  path: string;
  title: string;
  layer: SourceGalleryLayer;
  bucket: string;
  tags: string[];
  modifiedAt: string;
  createdAt: string;
  excerpt: string;
  previewImageUrl?: string;
  sourceUrl?: string;
  mediaCount: number;
  mediaKinds: Array<"image" | "pdf" | "video" | "audio">;
  ocrTextPath?: string;
  transcriptPath?: string;
}

interface SourceGalleryDetail {
  id: string;
  path: string;
  title: string;
  raw: string;
  html: string;
  previewImageUrl?: string;
  media: Array<{
    kind: "image" | "pdf" | "video" | "audio";
    path: string;
    url?: string;
  }>;
  mediaCount: number;
  mediaKinds: Array<"image" | "pdf" | "video" | "audio">;
  ocrTextPath?: string;
  transcriptPath?: string;
}

interface SourceGalleryCompileInput {
  inputPath: string;
}

interface SourceGalleryRecord extends SourceGalleryItem {
  previewImagePath?: string;
}

interface QueueFile {
  updatedAt: string;
  items: Array<{ id: string; path: string; layer: SourceGalleryLayer; queuedAt: string }>;
}

const RAW_CLIPPING_DIR = "raw/\u526a\u85cf";
const RAW_FLASH_DIR = "raw/\u95ea\u5ff5\u65e5\u8bb0";
const SOURCES_FULL_DIR = "sources_full";
const GUIDED_INGEST_COMPILE_DIR = "inbox/source-gallery-guided-ingest";
const NON_MARKDOWN_ATTACHMENT_DIR = "\u9644\u4ef6\u526f\u672c\uff08\u975eMarkdown\uff09";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

export async function listSourceGalleryItems(
  sourceVaultRoot: string,
  runtimeRoot: string,
  query?: string,
  sort: SourceGallerySort = "modified-desc",
  filters: SourceGalleryFilters = {},
): Promise<{ items: SourceGalleryItem[]; filters: SourceGalleryFilterOptions }> {
  const mediaIndex = query?.trim()
    ? (await ensureSourceImageOcr({ sourceVaultRoot, runtimeRoot, rescan: true })).index
    : readSourceMediaIndex(runtimeRoot);
  const records = scanGallery(sourceVaultRoot, runtimeRoot, mediaIndex);
  const filterOptions = buildSourceGalleryFilterOptions(records);
  const filteredRecords = records
    .filter((item) => matchesSourceGalleryFilters(item, filters))
    .filter((item) => matchesQuery(sourceVaultRoot, runtimeRoot, item, query))
    .sort(compareGalleryRecords(sort));
  return {
    items: filteredRecords.map((item) => ({
      id: item.id,
      path: item.path,
      title: item.title,
      layer: item.layer,
      bucket: item.bucket,
      tags: item.tags,
      modifiedAt: item.modifiedAt,
      createdAt: item.createdAt,
      excerpt: item.excerpt,
      previewImageUrl: item.previewImagePath
        ? `/api/source-gallery/media?path=${encodeURIComponent(item.previewImagePath)}`
        : undefined,
      sourceUrl: item.sourceUrl,
      mediaCount: item.mediaCount,
      mediaKinds: item.mediaKinds,
      ocrTextPath: item.ocrTextPath,
      transcriptPath: item.transcriptPath,
    })),
    filters: filterOptions,
  };
}

export async function getSourceGalleryDetail(sourceVaultRoot: string, runtimeRoot: string, id: string): Promise<SourceGalleryDetail> {
  const mediaIndex = readSourceMediaIndex(runtimeRoot);
  const record = findRecord(sourceVaultRoot, runtimeRoot, id, mediaIndex);
  if (!record) throw new Error("source gallery item not found");
  const media = mediaIndex.records[record.id]?.media ?? [];
  const raw = fs.readFileSync(resolveGalleryPath(sourceVaultRoot, runtimeRoot, record.path), "utf8");
  const renderer = createRenderer({ pageLookupRoot: sourceVaultRoot });
  const renderedHtml = rewriteRenderedMediaPaths(
    renderer.render(raw).html,
    sourceVaultRoot,
    runtimeRoot,
    record.path,
  );
  return {
    id: record.id,
    path: record.path,
    title: record.title,
    raw,
    html: renderedHtml,
    previewImageUrl: record.previewImagePath
      ? `/api/source-gallery/media?path=${encodeURIComponent(record.previewImagePath)}`
      : undefined,
    media: media.map((item) => ({
      kind: item.kind,
      path: item.path,
      url: item.exists ? `/api/source-gallery/media?path=${encodeURIComponent(item.path)}` : undefined,
    })),
    mediaCount: record.mediaCount,
    mediaKinds: record.mediaKinds,
    ocrTextPath: record.ocrTextPath,
    transcriptPath: record.transcriptPath,
  };
}

export async function createSourceGalleryEntry(
  sourceVaultRoot: string,
  input: { type: "clipping" | "flash-diary"; title?: string; body?: string; url?: string; now?: string },
): Promise<{ path: string }> {
  const now = input.now ? new Date(input.now) : new Date();
  if (input.type === "flash-diary") {
    return createSourceNote(sourceVaultRoot, {
      title: input.title?.trim() || "\u95ea\u5ff5\u8bb0\u5f55",
      body: input.body?.trim() || input.url?.trim() || "",
      target: "flash-diary",
      now,
    });
  }
  if (input.url?.trim()) {
    return createSourceBookmark(sourceVaultRoot, {
      url: input.url.trim(),
      title: input.title?.trim(),
      description: input.body?.trim(),
      now,
    });
  }
  return createSourceNote(sourceVaultRoot, {
    title: input.title?.trim() || "\u672a\u547d\u540d\u526a\u85cf",
    body: input.body?.trim() || "",
    target: "clipping",
    now,
  });
}

export async function saveSourceGalleryDetail(
  sourceVaultRoot: string,
  runtimeRoot: string,
  id: string,
  raw: string,
): Promise<{ id: string; path: string }> {
  const mediaIndex = readSourceMediaIndex(runtimeRoot);
  const record = findRecord(sourceVaultRoot, runtimeRoot, id, mediaIndex);
  if (!record) throw new Error("source gallery item not found");
  const nextRaw = raw.trim();
  if (!nextRaw) throw new Error("raw content required");
  const fullPath = resolveGalleryPath(sourceVaultRoot, runtimeRoot, record.path);
  await writeFile(fullPath, `${nextRaw}\n`, "utf8");
  return { id: record.id, path: record.path };
}

export async function deleteSourceGalleryItems(
  sourceVaultRoot: string,
  runtimeRoot: string,
  ids: string[],
): Promise<{ deleted: string[]; missing: string[] }> {
  const mediaIndex = readSourceMediaIndex(runtimeRoot);
  const deleted: string[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const record = findRecord(sourceVaultRoot, runtimeRoot, id, mediaIndex);
    if (!record) {
      missing.push(id);
      continue;
    }
    const fullPath = resolveGalleryPath(sourceVaultRoot, runtimeRoot, record.path);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      missing.push(id);
      continue;
    }
    fs.unlinkSync(fullPath);
    deleted.push(record.path);
  }
  if (ids.length > 0 && deleted.length === 0) {
    throw new Error("no source gallery item was deleted");
  }
  return { deleted, missing };
}

export async function moveSourceGalleryItemsToInbox(
  sourceVaultRoot: string,
  runtimeRoot: string,
  ids: string[],
): Promise<{ moved: string[] }> {
  const moved: string[] = [];
  for (const id of ids) {
    const record = findRecord(sourceVaultRoot, runtimeRoot, id, readSourceMediaIndex(runtimeRoot));
    if (!record) continue;
    const sourceFile = resolveGalleryPath(sourceVaultRoot, runtimeRoot, record.path);
    const targetRelative = uniqueTargetPath(
      sourceVaultRoot,
      path.posix.join("inbox", "source-gallery", record.layer, record.bucket, path.posix.basename(record.path)),
    );
    const targetFile = path.join(sourceVaultRoot, ...targetRelative.split("/"));
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
    moved.push(targetRelative);
  }
  return { moved };
}

export async function queueSourceGalleryBatchIngest(
  sourceVaultRoot: string,
  runtimeRoot: string,
  ids: string[],
): Promise<{ path: string; queued: number }> {
  const queuePath = path.join(runtimeRoot, ".llmwiki", "source-gallery-batch-ingest.json");
  const existing = readQueue(queuePath);
  const now = new Date().toISOString();
  const next = new Map(existing.items.map((item) => [item.id, item]));
  for (const id of ids) {
    const record = findRecord(sourceVaultRoot, runtimeRoot, id, readSourceMediaIndex(runtimeRoot));
    if (!record) continue;
    next.set(record.id, {
      id: record.id,
      path: record.path,
      layer: record.layer,
      queuedAt: now,
    });
  }
  const payload: QueueFile = {
    updatedAt: now,
    items: [...next.values()].sort((left, right) => right.queuedAt.localeCompare(left.queuedAt)),
  };
  await mkdir(path.dirname(queuePath), { recursive: true });
  await writeFile(queuePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { path: ".llmwiki/source-gallery-batch-ingest.json", queued: ids.length };
}

export async function createSourceGalleryCompileInput(
  sourceVaultRoot: string,
  runtimeRoot: string,
  id: string,
  conversationId: string,
  now = new Date(),
): Promise<SourceGalleryCompileInput> {
  const detail = await getSourceGalleryDetail(sourceVaultRoot, runtimeRoot, id);
  const conversation = getConversation(sourceVaultRoot, conversationId);
  if (!conversation) {
    throw new Error("conversation not found");
  }
  const messages = conversation.messages.filter((message) => message.role === "user" || message.role === "assistant");
  if (messages.length === 0) {
    throw new Error("guided-ingest conversation has no user or assistant messages");
  }
  const targetRelative = uniqueTargetPath(
    sourceVaultRoot,
    path.posix.join(GUIDED_INGEST_COMPILE_DIR, `${sanitizeCompileFileStem(detail.title)}-${formatFileTimestamp(now)}.md`),
  );
  const targetFile = path.join(sourceVaultRoot, ...targetRelative.split("/"));
  await mkdir(path.dirname(targetFile), { recursive: true });
  await writeFile(targetFile, `${buildGuidedCompileMarkdown(detail, conversationId, messages, now.toISOString()).trim()}\n`, "utf8");
  return { inputPath: targetRelative };
}

export async function runSourceGalleryOcr(
  sourceVaultRoot: string,
  runtimeRoot: string,
  id: string,
): Promise<{ id: string; path: string; text: string }> {
  const mediaIndex = readSourceMediaIndex(runtimeRoot);
  const record = findRecord(sourceVaultRoot, runtimeRoot, id, mediaIndex);
  if (!record) throw new Error("source gallery item not found");
  const result = await runSourcePathImageOcr({ sourceVaultRoot, runtimeRoot, sourcePath: record.path });
  return { id: result.id, path: result.path, text: result.text };
}

export async function runSourceGalleryTranscription(
  sourceVaultRoot: string,
  runtimeRoot: string,
  id: string,
): Promise<{ id: string; path: string; text: string }> {
  const mediaIndex = readSourceMediaIndex(runtimeRoot);
  const record = findRecord(sourceVaultRoot, runtimeRoot, id, mediaIndex);
  if (!record) throw new Error("source gallery item not found");
  const mediaPath = mediaIndex.records[id]?.media.find((item) =>
    (item.kind === "audio" || item.kind === "video") && item.exists
  )?.path;
  if (!mediaPath) throw new Error("no audio or video media found");
  const result = await runCloudflareTranscription({
    runtimeRoot,
    sourceId: id,
    filePath: resolveExistingMediaFile(sourceVaultRoot, runtimeRoot, mediaPath),
  });
  if (!result.ok) throw new Error(result.error.message);
  await updateMediaSidecarPath(runtimeRoot, id, { transcriptPath: result.path });
  return { id, path: result.path, text: result.text };
}

export function resolveSourceGalleryMediaPath(sourceVaultRoot: string, runtimeRoot: string, relativePath: string): string {
  const full = resolveGalleryPath(sourceVaultRoot, runtimeRoot, relativePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("media not found");
  return full;
}

function scanGallery(
  sourceVaultRoot: string,
  runtimeRoot: string,
  mediaIndex: ReturnType<typeof readSourceMediaIndex>,
): SourceGalleryRecord[] {
  return [
    ...scanMarkdownBucket(sourceVaultRoot, runtimeRoot, RAW_CLIPPING_DIR, "raw", "\u526a\u85cf", mediaIndex),
    ...scanMarkdownBucket(sourceVaultRoot, runtimeRoot, RAW_FLASH_DIR, "raw", "\u95ea\u5ff5\u65e5\u8bb0", mediaIndex),
    ...scanMarkdownBucket(sourceVaultRoot, runtimeRoot, SOURCES_FULL_DIR, "source", "sources_full", mediaIndex)
      .filter((item) => !item.path.includes(NON_MARKDOWN_ATTACHMENT_DIR)),
  ];
}

function scanMarkdownBucket(
  sourceVaultRoot: string,
  runtimeRoot: string,
  relativeDir: string,
  layer: SourceGalleryLayer,
  bucket: string,
  mediaIndex: ReturnType<typeof readSourceMediaIndex>,
): SourceGalleryRecord[] {
  const baseRoot = layer === "raw" ? sourceVaultRoot : runtimeRoot;
  const root = path.join(baseRoot, ...relativeDir.split("/"));
  if (!fs.existsSync(root)) return [];
  const files = listMarkdownFilesRecursive(root);
  // fallow-ignore-next-line complexity
  return files.map((fullPath) => {
    const relativePath = toPosix(path.relative(baseRoot, fullPath));
    const raw = fs.readFileSync(fullPath, "utf8");
    const frontmatter = parseFrontmatter(raw);
    const stat = fs.statSync(fullPath);
    const mediaRecord = mediaIndex.records[sourceId(relativePath)];
    const previewImagePath = mediaRecord?.coverImagePath ?? resolvePreviewImagePath(sourceVaultRoot, runtimeRoot, relativePath, raw);
    return {
      id: sourceId(relativePath),
      path: relativePath,
      title: frontmatter.title || firstHeading(raw) || path.basename(fullPath, path.extname(fullPath)),
      layer,
      bucket,
      tags: splitFrontmatterList(frontmatter.tags),
      modifiedAt: stat.mtime.toISOString(),
      createdAt: (stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.ctime).toISOString(),
      excerpt: makeExcerpt(raw),
      previewImagePath,
      sourceUrl: frontmatter.source_url || frontmatter.url,
      mediaCount: mediaRecord?.mediaCount ?? 0,
      mediaKinds: mediaRecord?.mediaKinds ?? [],
      ocrTextPath: mediaRecord?.ocrTextPath,
      transcriptPath: mediaRecord?.transcriptPath,
    };
  });
}

function compareGalleryRecords(sort: SourceGallerySort): (a: SourceGalleryRecord, b: SourceGalleryRecord) => number {
  return (left, right) => {
    switch (sort) {
      case "modified-asc": return left.modifiedAt.localeCompare(right.modifiedAt);
      case "created-desc": return right.createdAt.localeCompare(left.createdAt);
      case "created-asc": return left.createdAt.localeCompare(right.createdAt);
      case "modified-desc":
      default: return right.modifiedAt.localeCompare(left.modifiedAt);
    }
  };
}

function buildSourceGalleryFilterOptions(records: SourceGalleryRecord[]): SourceGalleryFilterOptions {
  return {
    buckets: uniqueSortedValues(records.map((item) => item.bucket)),
    tags: uniqueSortedValues(records.flatMap((item) => item.tags)),
    layers: ["raw", "source"].filter((layer) => records.some((item) => item.layer === layer)),
  };
}

function matchesQuery(sourceVaultRoot: string, runtimeRoot: string, item: SourceGalleryRecord, query?: string): boolean {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return true;
  const raw = fs.readFileSync(resolveGalleryPath(sourceVaultRoot, runtimeRoot, item.path), "utf8");
  const ocrText = readSourceOcrSidecar(runtimeRoot, item.id);
  return [item.title, item.excerpt, item.sourceUrl, item.tags.join(" "), raw, ocrText]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
    .includes(normalized);
}

function matchesSourceGalleryFilters(item: SourceGalleryRecord, filters: SourceGalleryFilters): boolean {
  return (
    matchesActiveSourceGalleryValue(filters.buckets, item.bucket)
    && matchesActiveSourceGalleryValue(filters.layers, item.layer)
    && matchesActiveSourceGalleryTags(filters.tags, item.tags)
  );
}

function matchesActiveSourceGalleryValue<T extends string>(activeValues: readonly T[] | undefined, value: T): boolean {
  return !activeValues?.length || activeValues.includes(value);
}

function matchesActiveSourceGalleryTags(activeTags: readonly string[] | undefined, tags: readonly string[]): boolean {
  return !activeTags?.length || tags.some((tag) => activeTags.includes(tag));
}

function findRecord(
  sourceVaultRoot: string,
  runtimeRoot: string,
  id: string,
  mediaIndex: ReturnType<typeof readSourceMediaIndex>,
): SourceGalleryRecord | undefined {
  return scanGallery(sourceVaultRoot, runtimeRoot, mediaIndex).find((item) => item.id === id);
}

function resolveExistingMediaFile(sourceVaultRoot: string, runtimeRoot: string, relativePath: string): string {
  const full = resolveGalleryPath(sourceVaultRoot, runtimeRoot, relativePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("media not found");
  return full;
}

async function updateMediaSidecarPath(
  runtimeRoot: string,
  id: string,
  patch: { ocrTextPath?: string; transcriptPath?: string },
): Promise<void> {
  const mediaIndex = readSourceMediaIndex(runtimeRoot);
  const record = mediaIndex.records[id];
  if (!record) return;
  mediaIndex.records[id] = { ...record, ...patch };
  mediaIndex.generatedAt = new Date().toISOString();
  await writeSourceMediaIndex(runtimeRoot, mediaIndex);
}

function resolvePreviewImagePath(sourceVaultRoot: string, runtimeRoot: string, markdownPath: string, raw: string): string | undefined {
  const matches = [...raw.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)];
  for (const match of matches) {
    const link = match[1]?.trim();
    if (!link || /^https?:\/\//i.test(link)) continue;
    const resolved = resolveLocalMediaPath(sourceVaultRoot, runtimeRoot, markdownPath, link);
    if (!resolved) continue;
    const extension = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension) || !fs.existsSync(resolved)) continue;
    return toLogicalPath(sourceVaultRoot, runtimeRoot, resolved);
  }
  return undefined;
}

function uniqueTargetPath(wikiRoot: string, relativePath: string): string {
  let candidate = relativePath;
  let index = 1;
  while (fs.existsSync(path.join(wikiRoot, ...candidate.split("/")))) {
    const parsed = path.posix.parse(relativePath);
    candidate = path.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function buildGuidedCompileMarkdown(
  detail: SourceGalleryDetail,
  conversationId: string,
  messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>,
  createdAt: string,
): string {
  const transcript = messages.flatMap((message) => {
    const content = message.content.trim();
    if (!content) {
      return [];
    }
    return [
      `### ${message.role === "user" ? "User" : "Assistant"} · ${message.createdAt}`,
      "",
      content,
      "",
    ];
  });
  return [
    "---",
    `title: "${escapeFrontmatterText(`Guided Compile - ${detail.title}`)}"`,
    'type: "guided-ingest-compile"',
    `source_path: "${escapeFrontmatterText(detail.path)}"`,
    `conversation_id: "${escapeFrontmatterText(conversationId)}"`,
    `created: "${escapeFrontmatterText(createdAt)}"`,
    "---",
    "",
    `# Guided Compile - ${detail.title}`,
    "",
    "## Source Metadata",
    "",
    `- Source path: ${detail.path}`,
    `- Source title: ${detail.title}`,
    "",
    "## Source Content",
    "",
    "```markdown",
    detail.raw.trim(),
    "```",
    "",
    "## Guided Ingest Conversation",
    "",
    ...transcript,
  ].join("\n");
}

function sanitizeCompileFileStem(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "guided-ingest-compile";
}

function formatFileTimestamp(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function escapeFrontmatterText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function readQueue(file: string): QueueFile {
  if (!fs.existsSync(file)) {
    return { updatedAt: "", items: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as QueueFile;
    return {
      updatedAt: parsed.updatedAt || "",
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { updatedAt: "", items: [] };
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (parts) out[parts[1]] = parts[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function splitFrontmatterList(value?: string): string[] {
  if (!value) return [];
  return value.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim()).filter(Boolean);
}

function firstHeading(raw: string): string | undefined {
  return raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function makeExcerpt(raw: string): string {
  return raw
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/^#+\s+/gm, "")
    .replace(/!\[[^\]]*]\(([^)]+)\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function sourceId(relativePath: string): string {
  return crypto.createHash("sha1").update(relativePath.toLowerCase()).digest("hex").slice(0, 20);
}

function uniqueSortedValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function rewriteRenderedMediaPaths(html: string, sourceVaultRoot: string, runtimeRoot: string, markdownPath: string): string {
  return html.replace(/<(img|a)\b([^>]*?)\s(src|href)="([^"]+)"([^>]*)>/gi, (_match, tag, before, attr, value, after) => {
    const target = rewriteMediaTarget(sourceVaultRoot, runtimeRoot, markdownPath, value);
    return `<${tag}${before} ${attr}="${escapeAttribute(target)}"${after}>`;
  });
}

function rewriteMediaTarget(sourceVaultRoot: string, runtimeRoot: string, markdownPath: string, target: string): string {
  if (!target || /^https?:\/\//i.test(target) || /^data:/i.test(target) || target.startsWith("/api/")) {
    return target;
  }
  const resolved = resolveLocalMediaPath(sourceVaultRoot, runtimeRoot, markdownPath, target);
  if (!resolved) return target;
  const relativePath = toLogicalPath(sourceVaultRoot, runtimeRoot, resolved);
  return `/api/source-gallery/media?path=${encodeURIComponent(relativePath)}`;
}

function resolveLocalMediaPath(sourceVaultRoot: string, runtimeRoot: string, markdownPath: string, reference: string): string | undefined {
  if (isRemoteMediaReference(reference)) return undefined;
  const cleaned = normalizeMediaReference(reference);
  if (!cleaned) return undefined;
  const markdownFile = resolveGalleryPath(sourceVaultRoot, runtimeRoot, markdownPath);
  const ownerRoot = markdownPath.startsWith(`${SOURCES_FULL_DIR}/`) ? runtimeRoot : sourceVaultRoot;
  const candidate = resolveLocalMediaCandidate(sourceVaultRoot, runtimeRoot, markdownFile, cleaned);
  if (!isAllowedLocalMediaCandidate(candidate, cleaned, sourceVaultRoot, runtimeRoot, ownerRoot)) return undefined;
  return candidate;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function resolveGalleryPath(sourceVaultRoot: string, runtimeRoot: string, relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const posix = normalized.replace(/\\/g, "/");
  const root = posix.startsWith("sources_full/") || posix.startsWith("wiki/") ? runtimeRoot : sourceVaultRoot;
  const full = path.resolve(root, normalized);
  if (!isInsideRoot(full, root)) throw new Error("invalid media path");
  return full;
}

function toLogicalPath(sourceVaultRoot: string, runtimeRoot: string, fullPath: string): string {
  if (isInsideRoot(fullPath, sourceVaultRoot)) {
    return toPosix(path.relative(sourceVaultRoot, fullPath));
  }
  return toPosix(path.relative(runtimeRoot, fullPath));
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRemoteMediaReference(reference: string): boolean {
  return !reference || /^https?:\/\//i.test(reference) || /^data:/i.test(reference);
}

function normalizeMediaReference(reference: string): string {
  return reference.split("#")[0]?.split("?")[0]?.trim() ?? "";
}

function resolveLocalMediaCandidate(
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownFile: string,
  cleanedReference: string,
): string {
  if (path.isAbsolute(cleanedReference)) {
    return path.resolve(cleanedReference);
  }
  if (isGalleryRootReference(cleanedReference)) {
    return resolveGalleryPath(sourceVaultRoot, runtimeRoot, cleanedReference);
  }
  return path.resolve(path.dirname(markdownFile), cleanedReference);
}

function isGalleryRootReference(reference: string): boolean {
  return reference.startsWith("raw/") || reference.startsWith("sources_full/");
}

function isAllowedLocalMediaCandidate(
  candidate: string,
  cleanedReference: string,
  sourceVaultRoot: string,
  runtimeRoot: string,
  ownerRoot: string,
): boolean {
  if (!isInsideRoot(candidate, sourceVaultRoot) && !isInsideRoot(candidate, runtimeRoot)) {
    return false;
  }
  if (!isGalleryRootReference(cleanedReference) && !isInsideRoot(candidate, ownerRoot)) {
    return false;
  }
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}
