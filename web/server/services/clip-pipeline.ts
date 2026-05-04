import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { scanSourceMediaIndex } from "./source-media-index.js";
import { createYtDlpRunner } from "./yt-dlp.js";
import { detectClipPlatform } from "./clip-platform.js";

type ClipStatus = "completed" | "partial" | "failed";
export type ClipPlatform = "xhs" | "douyin" | "bilibili" | "generic";
type ClipContentType = "image_gallery" | "video" | "mixed" | "article";
type ClipMediaKind = "image" | "video";

export interface ClipMetadata {
  title: string;
  description?: string;
  author?: string;
  platform?: ClipPlatform;
  webpageUrl?: string;
  siteName?: string;
  contentType?: ClipContentType;
}

export interface ClipDownloadedMedia {
  kind: ClipMediaKind;
  path: string;
  title?: string;
}

export interface ClipCollectInput {
  url: string;
  outputDir: string;
  quality: "720";
  projectRoot: string;
}

export interface ClipCollection {
  metadata: ClipMetadata;
  media: ClipDownloadedMedia[];
  warnings?: string[];
}

export interface ClipRunner {
  collect(input: ClipCollectInput): Promise<ClipCollection>;
}

interface ClipTask {
  id: string;
  url: string;
  normalizedUrl: string;
  status: ClipStatus;
  createdAt: string;
  updatedAt: string;
  quality: "720";
  platform: ClipPlatform;
  title?: string;
  path?: string;
  error?: string;
  warnings: string[];
  mediaCount: number;
}

interface ClipTaskFile {
  version: 1;
  updatedAt: string;
  items: ClipTask[];
}

interface ClipInput {
  url: string;
  title?: string;
  body?: string;
  quality?: "720";
  now?: Date;
}

export interface ClipRunOptions {
  runner?: ClipRunner;
  projectRoot?: string;
  runtimeRoot?: string;
}

interface ClipRunResult {
  status: ClipStatus;
  task: ClipTask;
  path?: string;
  error?: string;
  warnings: string[];
}

const CLIP_TASK_FILE = ".llmwiki/clip-tasks.json";
const RAW_CLIPPING_SEGMENTS = ["raw", "剪藏"];

export async function runClipTask(
  wikiRoot: string,
  input: ClipInput,
  options: ClipRunOptions = {},
): Promise<ClipRunResult> {
  const normalized = normalizeUrl(input.url);
  if (!normalized) throw new Error("url required");
  const createdAt = (input.now ?? new Date()).toISOString();
  const baseTask = createBaseTask(normalized, createdAt, input.quality ?? "720");
  const runner = options.runner ?? createYtDlpRunner(options.projectRoot ?? process.cwd());
  const outputDir = path.join(wikiRoot, ...RAW_CLIPPING_SEGMENTS, "assets", baseTask.id);

  try {
    const collection = await runner.collect({
      url: normalized,
      outputDir,
      quality: baseTask.quality,
      projectRoot: options.projectRoot ?? wikiRoot,
    });
    const result = await writeCollectedClip(wikiRoot, input, baseTask, collection, createdAt);
    await upsertClipTask(wikiRoot, result.task);
    await scanSourceMediaIndex(wikiRoot, options.runtimeRoot ?? wikiRoot);
    return result;
  } catch (error) {
    if (isRecoverableClipExtractionError(error)) {
      const result = await writeCollectedClip(wikiRoot, input, baseTask, fallbackCollection(input, baseTask, error), createdAt);
      await upsertClipTask(wikiRoot, result.task);
      await scanSourceMediaIndex(wikiRoot, options.runtimeRoot ?? wikiRoot);
      return result;
    }
    const failedTask = finishTask(baseTask, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await upsertClipTask(wikiRoot, failedTask);
  return { status: "failed", task: failedTask, error: failedTask.error, warnings: [] };
  }
}

export function readClipTasks(wikiRoot: string): ClipTaskFile {
  const file = path.join(wikiRoot, ...CLIP_TASK_FILE.split("/"));
  if (!fs.existsSync(file)) return { version: 1, updatedAt: "", items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ClipTaskFile>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeTask).filter(Boolean) as ClipTask[] : [],
    };
  } catch {
    return { version: 1, updatedAt: "", items: [] };
  }
}

async function writeCollectedClip(
  wikiRoot: string,
  input: ClipInput,
  baseTask: ClipTask,
  collection: ClipCollection,
  createdAt: string,
): Promise<ClipRunResult> {
  const title = input.title?.trim() || collection.metadata.title.trim() || "未命名剪藏";
  const platform = collection.metadata.platform ?? detectClipPlatform(baseTask.normalizedUrl);
  const status: ClipStatus = collection.warnings?.length ? "partial" : "completed";
  const contentType = collection.metadata.contentType ?? inferContentType(collection.media);
  const markdownPath = uniqueMarkdownPath(wikiRoot, title);
  const raw = renderClipMarkdown({ title, input, baseTask, collection, platform, status, contentType, createdAt });
  await mkdir(path.dirname(path.join(wikiRoot, ...markdownPath.split("/"))), { recursive: true });
  await writeFile(path.join(wikiRoot, ...markdownPath.split("/")), raw, "utf8");
  const task = finishTask(baseTask, status, {
    title,
    path: markdownPath,
    platform,
    warnings: collection.warnings ?? [],
    mediaCount: collection.media.length,
  });
  return { status, task, path: markdownPath, warnings: task.warnings };
}

function renderClipMarkdown(input: {
  title: string;
  input: ClipInput;
  baseTask: ClipTask;
  collection: ClipCollection;
  platform: ClipPlatform;
  status: ClipStatus;
  contentType: ClipContentType;
  createdAt: string;
}): string {
  const lines = [
    "---",
    `title: ${yamlQuote(input.title)}`,
    "type: clipping",
    `platform: ${input.platform}`,
    `content_type: ${input.contentType}`,
    `clip_status: ${input.status}`,
    `source_url: ${yamlQuote(input.baseTask.url)}`,
    `normalized_url: ${yamlQuote(input.baseTask.normalizedUrl)}`,
    `created: ${yamlQuote(input.createdAt)}`,
    `video_quality: ${yamlQuote(input.baseTask.quality)}`,
    `media_count: ${input.collection.media.length}`,
  ];
  if (input.collection.metadata.author) lines.push(`author: ${yamlQuote(input.collection.metadata.author)}`);
  if (input.collection.metadata.siteName) lines.push(`site_name: ${yamlQuote(input.collection.metadata.siteName)}`);
  lines.push("tags: [剪藏, " + input.platform + "]", "---", "", `# ${input.title}`, "");
  lines.push(`原文: ${input.baseTask.url}`, "");
  appendOptionalSection(lines, "用户备注", input.input.body);
  appendOptionalSection(lines, "内容摘要", input.collection.metadata.description);
  appendOptionalSection(lines, "剪藏警告", input.collection.warnings?.join("\n\n"));
  appendMediaSection(lines, input.collection.media);
  return `${lines.join("\n").trim()}\n`;
}

function fallbackCollection(input: ClipInput, task: ClipTask, error: unknown): ClipCollection {
  return {
    metadata: {
      title: input.title?.trim() || titleFromBody(input.body) || fallbackTitle(task.platform),
      platform: task.platform,
      webpageUrl: task.normalizedUrl,
      contentType: "article",
    },
    media: [],
    warnings: [error instanceof Error ? error.message : String(error)],
  };
}

function titleFromBody(body?: string): string | undefined {
  for (const line of (body ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) continue;
    return trimmed.slice(0, 120);
  }
  return undefined;
}

function fallbackTitle(platform: ClipPlatform): string {
  switch (platform) {
    case "xhs":
      return "小红书剪藏";
    case "douyin":
      return "抖音剪藏";
    case "bilibili":
      return "B站剪藏";
    default:
      return "链接剪藏";
  }
}

function isRecoverableClipExtractionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no video formats found|unable to download json metadata|connection .*timed out|read timed out|api\.x\.com timed out/i.test(message);
}

function appendMediaSection(lines: string[], media: ClipDownloadedMedia[]): void {
  if (media.length === 0) return;
  lines.push("## 媒体", "");
  for (const item of media) {
    const relative = `./assets/${path.basename(path.dirname(item.path))}/${path.basename(item.path)}`.replace(/\\/g, "/");
    if (item.kind === "image") {
      lines.push(`![](${relative})`, "");
      continue;
    }
    lines.push(`[视频：${item.title || path.basename(item.path)}](${relative})`, "");
  }
}

function appendOptionalSection(lines: string[], title: string, value?: string): void {
  const body = value?.trim();
  if (!body) return;
  lines.push(`## ${title}`, "", body, "");
}

async function upsertClipTask(wikiRoot: string, task: ClipTask): Promise<void> {
  const taskFile = path.join(wikiRoot, ...CLIP_TASK_FILE.split("/"));
  const existing = readClipTasks(wikiRoot).items.filter((item) => item.id !== task.id);
  const payload: ClipTaskFile = {
    version: 1,
    updatedAt: task.updatedAt,
    items: [task, ...existing].slice(0, 200),
  };
  await mkdir(path.dirname(taskFile), { recursive: true });
  await writeFile(taskFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createBaseTask(url: string, createdAt: string, quality: "720"): ClipTask {
  return {
    id: crypto.createHash("sha1").update(`${url}:${createdAt}`).digest("hex").slice(0, 16),
    url,
    normalizedUrl: url,
    status: "failed",
    createdAt,
    updatedAt: createdAt,
    quality,
    platform: detectClipPlatform(url),
    warnings: [],
    mediaCount: 0,
  };
}

function finishTask(task: ClipTask, status: ClipStatus, patch: Partial<ClipTask>): ClipTask {
  return {
    ...task,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
    warnings: patch.warnings ?? task.warnings,
    mediaCount: patch.mediaCount ?? task.mediaCount,
  };
}

function uniqueMarkdownPath(wikiRoot: string, title: string): string {
  const base = sanitizeFileName(title).slice(0, 80) || "未命名剪藏";
  let name = `${base}.md`;
  let index = 1;
  while (fs.existsSync(path.join(wikiRoot, ...RAW_CLIPPING_SEGMENTS, name))) {
    name = `${base}-${index}.md`;
    index += 1;
  }
  return ["raw", "剪藏", name].join("/");
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value: string): string {
  return value.trim();
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function inferContentType(media: ClipDownloadedMedia[]): ClipContentType {
  const hasImage = media.some((item) => item.kind === "image");
  const hasVideo = media.some((item) => item.kind === "video");
  if (hasImage && hasVideo) return "mixed";
  if (hasVideo) return "video";
  if (hasImage) return "image_gallery";
  return "article";
}

// fallow-ignore-next-line complexity
function normalizeTask(value: Partial<ClipTask>): ClipTask | undefined {
  const id = readClipTaskString(value?.id);
  const url = readClipTaskString(value?.url);
  if (!id || !url) return undefined;
  return {
    id,
    url,
    normalizedUrl: readClipTaskString(value.normalizedUrl) || url,
    status: isClipStatus(value.status) ? value.status : "failed",
    createdAt: value.createdAt ?? "",
    updatedAt: value.updatedAt ?? "",
    quality: "720",
    platform: value.platform ?? detectClipPlatform(url),
    title: value.title,
    path: value.path,
    error: value.error,
    warnings: Array.isArray(value.warnings) ? value.warnings.map(String) : [],
    mediaCount: typeof value.mediaCount === "number" ? value.mediaCount : 0,
  };
}

function readClipTaskString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isClipStatus(value: unknown): value is ClipStatus {
  return value === "completed" || value === "partial" || value === "failed";
}
