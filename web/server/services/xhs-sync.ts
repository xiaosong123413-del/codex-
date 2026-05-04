import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { readAgentConfig, type AgentDefinition } from "./agent-config.js";
import { resolveAgentRuntimeProvider } from "./llm-chat.js";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";
import { CloudflareProvider } from "../../../src/providers/cloudflare.js";
import type { LLMProvider } from "../../../src/utils/provider.js";
import {
  scanSourceMediaIndex,
  sourceMediaId,
  writeSourceMediaIndex,
} from "./source-media-index.js";
import { runCloudflareOcr } from "./ocr-service.js";
import {
  runCloudflareTranscription,
  transcribeFileWithCloudflare,
  writeSourceTranscriptSidecar,
} from "./transcript-service.js";

type XhsCommand = "xhs" | "xhs-batch";
type XhsSyncStatus = "completed" | "partial" | "failed";

interface XhsProgress {
  current: number;
  total: number;
  percent: number;
}

interface XhsSyncTask {
  id: string;
  command: XhsCommand;
  status: XhsSyncStatus;
  createdAt: string;
  updatedAt: string;
  urls: string[];
  keyword?: string;
  path?: string;
  error?: string;
  total: number;
  completed: number;
  failed: number;
}

interface XhsSyncTaskFile {
  version: 1;
  updatedAt: string;
  items: XhsSyncTask[];
}

interface XhsSyncFailure {
  id: string;
  command: XhsCommand;
  url?: string;
  keyword?: string;
  error: string;
  createdAt: string;
}

interface XhsSingleInput {
  url: string;
  body?: string;
  now?: Date;
}

interface XhsBatchInput {
  urls: string[];
  now?: Date;
}

export interface XhsRunOptions {
  fetcher?: XhsFetcher;
  cookiesPath?: string;
  delayMs?: number;
  tempDir?: string;
  whisperModel?: string;
  videoTranscriber?: XhsVideoTranscriber;
  transcriptFormatter?: XhsTranscriptFormatter;
  outputRoot?: string;
  projectRoot?: string;
  runtimeRoot?: string;
  postFormatter?: XhsPostFormatter;
}

interface XhsSingleResult {
  status: XhsSyncStatus;
  task: XhsSyncTask;
  path?: string;
  error?: string;
  warnings: string[];
}

interface XhsBatchResult {
  status: XhsSyncStatus;
  task: XhsSyncTask;
  progress: XhsProgress;
  results: XhsSingleResult[];
  warnings: string[];
}

interface XhsFavoritesSyncResult {
  status: XhsSyncStatus;
  scanned: number;
  skipped: number;
  queued: number;
  urls: string[];
  skippedUrls: string[];
  progress: XhsProgress;
  results: XhsSingleResult[];
  warnings: string[];
  message: string;
  task?: XhsSyncTask;
}

interface XhsSyncStatusSnapshot {
  latestExtraction: XhsTaskProgress | null;
  failures: XhsSyncFailure[];
}

interface XhsTaskProgress {
  task: XhsSyncTask;
  progress: XhsProgress;
}

export type XhsFetcher = (url: string, init: RequestInit) => Promise<Response>;
type XhsVideoTranscriber = (post: XhsPost, options: XhsRunOptions) => Promise<string>;
type XhsTranscriptFormatter = (input: XhsTranscriptFormatterInput) => Promise<string>;
type XhsPostFormatter = (input: XhsPostFormatterInput) => Promise<XhsDecisionNoteDraft>;

interface XhsTranscriptFormatterInput {
  transcript: string;
  post: XhsPost;
}

interface XhsPostFormatterInput {
  agent: {
    id: string;
    name: string;
    purpose: string;
    workflow: string;
    prompt: string;
  } | null;
  projectContext: string;
  sourceUrl: string;
  post: {
    id: string;
    title: string;
    desc: string;
    type: string;
    date: string;
    author: string;
    tags: string[];
    likes: string;
    collects: string;
    comments: string;
    ipLocation?: string;
  };
  userBody: string;
  transcript: string;
}

export interface XhsDecisionNoteDraft {
  insightTitle: string;
  shortTitle: string;
  summaryLines: string[];
  decisionNote: string;
}

interface ResolveExecutablePathOptions {
  platform?: NodeJS.Platform;
  pathValue?: string;
  localAppData?: string;
  pathExt?: string;
}

interface XhsPost {
  id: string;
  title: string;
  desc: string;
  type: string;
  date: string;
  author: string;
  images: string[];
  videoUrl?: string;
  tags: string[];
  likes: string;
  collects: string;
  comments: string;
  ipLocation?: string;
}

interface XhsLocalMedia {
  sourceUrl: string;
  storedPath: string;
}

interface XhsPostArtifacts {
  warnings: string[];
  transcript?: string;
  images: XhsLocalMedia[];
  video?: XhsLocalMedia;
}

interface JsonObjectScanState {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

interface JsonNormalizationState {
  normalized: string;
  inString: boolean;
  escaped: boolean;
}

const XHS_TASK_FILE = ".llmwiki/xhs-sync-tasks.json";
const XHS_FAILURE_FILE = ".llmwiki/xhs-sync-failures.json";
const XHS_OUTPUT_SEGMENTS = ["raw", "剪藏", "小红书"];
const XHS_DECISION_AGENT_ID = "xhs-decision-note";
const XHS_USER_ME_ENDPOINT = "https://edith.xiaohongshu.com/api/sns/web/v2/user/me";
const XHS_COLLECT_PAGE_ENDPOINT = "https://edith.xiaohongshu.com/api/sns/web/v2/note/collect/page";
const XHS_COLLECT_PAGE_SIZE = 30;
const XHS_COLLECT_MAX_PAGES = 50;
const XHS_PROJECT_CONTEXT_FILES = [
  "docs/current-task.md",
  "docs/project-log.md",
  "docs/project-pending.json",
  "progress.json",
];
const execFileAsync = promisify(execFile);

export async function runXhsSingle(
  wikiRoot: string,
  input: XhsSingleInput,
  options: XhsRunOptions = {},
): Promise<XhsSingleResult> {
  const url = input.url.trim();
  if (!url) throw new Error("xhs url required");
  const createdAt = (input.now ?? new Date()).toISOString();
  const task = createTask("xhs", [url], createdAt, 1);
  try {
    const post = await fetchXhsPost(url, options);
    const outputDir = resolveXhsOutputDir(wikiRoot, options.outputRoot);
    const artifacts = await collectPostArtifacts(wikiRoot, outputDir, post, options);
    const decision = await formatXhsDecisionNote(wikiRoot, url, post, input.body, artifacts, options);
    artifacts.warnings.push(...decision.warnings);
    const markdownPath = uniqueMarkdownPath(wikiRoot, outputDir, decision.note.shortTitle);
    await writeXhsPostMarkdown(wikiRoot, markdownPath, url, post, input.body, artifacts, decision.note);
    artifacts.warnings.push(...await syncXhsSourceArtifacts(wikiRoot, markdownPath, post, artifacts, options));
    const resultStatus: XhsSyncStatus = artifacts.warnings.length > 0 ? "partial" : "completed";
    await writeXhsPostMarkdown(wikiRoot, markdownPath, url, post, input.body, artifacts, decision.note);
    const finished = finishTask(task, resultStatus, {
      path: markdownPath,
      completed: 1,
      failed: resultStatus === "failed" ? 1 : 0,
    });
    await upsertXhsTask(wikiRoot, finished);
    if (artifacts.warnings.length > 0) {
      await recordXhsSyncFailure(wikiRoot, {
        command: "xhs",
        url,
        error: artifacts.warnings.join("\n"),
        createdAt,
      });
    }
    return { status: resultStatus, task: finished, path: markdownPath, warnings: artifacts.warnings };
  } catch (error) {
    const message = errorMessage(error);
    const failed = finishTask(task, "failed", { error: message, failed: 1 });
    await upsertXhsTask(wikiRoot, failed);
    await recordXhsSyncFailure(wikiRoot, {
      command: "xhs",
      url,
      error: message,
      createdAt,
    });
    return { status: "failed", task: failed, error: message, warnings: [] };
  }
}

export async function runXhsBatch(
  wikiRoot: string,
  input: XhsBatchInput,
  options: XhsRunOptions = {},
): Promise<XhsBatchResult> {
  const urls = uniqueUrls(input.urls);
  if (urls.length === 0) throw new Error("xhs url list required");
  const createdAt = (input.now ?? new Date()).toISOString();
  let task = createTask("xhs-batch", urls, createdAt, urls.length);
  await upsertXhsTask(wikiRoot, task);
  const results: XhsSingleResult[] = [];

  for (const url of urls) {
    const result = await runXhsSingle(wikiRoot, { url, now: input.now }, options);
    results.push(result);
    task = finishTask(task, "partial", {
      completed: results.filter((item) => item.status !== "failed").length,
      failed: results.filter((item) => item.status === "failed").length,
    });
    await upsertXhsTask(wikiRoot, task);
    if ((options.delayMs ?? 3000) > 0 && results.length < urls.length) {
      await sleep(options.delayMs ?? 3000);
    }
  }

  const failed = results.filter((item) => item.status === "failed").length;
  const warnings = results.flatMap((item) => item.warnings);
  const status: XhsSyncStatus = failed === urls.length ? "failed" : failed > 0 || warnings.length > 0 ? "partial" : "completed";
  const finished = finishTask(task, status, {
    completed: results.filter((item) => item.status !== "failed").length,
    failed,
  });
  await upsertXhsTask(wikiRoot, finished);
  return {
    status,
    task: finished,
    progress: taskProgress(finished),
    results,
    warnings,
  };
}

export async function runXhsFavoritesSync(
  wikiRoot: string,
  input: { now?: Date } = {},
  options: XhsRunOptions = {},
): Promise<XhsFavoritesSyncResult> {
  const urls = await fetchXhsFavoriteUrls(options);
  const outputDir = resolveXhsOutputDir(wikiRoot, options.outputRoot);
  const synced = readSyncedXhsRefs(outputDir);
  const pending = urls.filter((item) => !isSyncedXhsUrl(item, synced));
  const skippedUrls = urls.filter((item) => !pending.includes(item));
  if (pending.length === 0) {
    return {
      status: "completed",
      scanned: urls.length,
      skipped: skippedUrls.length,
      queued: 0,
      urls: [],
      skippedUrls,
      progress: { current: urls.length, total: urls.length, percent: 100 },
      results: [],
      warnings: [],
      message: urls.length === 0
        ? "小红书收藏列表为空，未检测到可同步的帖子。"
        : `已读取 ${urls.length} 条小红书收藏，全部已经同步，已跳过。`,
    };
  }
  const batch = await runXhsBatch(wikiRoot, { urls: pending, now: input.now }, options);
  return {
    status: batch.status,
    scanned: urls.length,
    skipped: skippedUrls.length,
    queued: pending.length,
    urls: pending,
    skippedUrls,
    progress: batch.progress,
    results: batch.results,
    warnings: batch.warnings,
    task: batch.task,
    message: `已读取 ${urls.length} 条小红书收藏，跳过 ${skippedUrls.length} 条已同步，已同步 ${batch.progress.current} / ${batch.progress.total} 条。`,
  };
}

export function getXhsSyncStatus(wikiRoot: string): XhsSyncStatusSnapshot {
  const tasks = readXhsSyncTasks(wikiRoot).items;
  const latestExtraction = tasks.find((task) => task.command === "xhs" || task.command === "xhs-batch") ?? null;
  return {
    latestExtraction: latestExtraction ? { task: latestExtraction, progress: taskProgress(latestExtraction) } : null,
    failures: readXhsSyncFailures(wikiRoot).slice(0, 20),
  };
}

export function readXhsSyncTasks(wikiRoot: string): XhsSyncTaskFile {
  const file = path.join(wikiRoot, ...XHS_TASK_FILE.split("/"));
  if (!fs.existsSync(file)) return { version: 1, updatedAt: "", items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<XhsSyncTaskFile>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeTask).filter((item): item is XhsSyncTask => Boolean(item)) : [],
    };
  } catch {
    return { version: 1, updatedAt: "", items: [] };
  }
}

export function readXhsSyncFailures(wikiRoot: string): XhsSyncFailure[] {
  const file = path.join(wikiRoot, ...XHS_FAILURE_FILE.split("/"));
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(normalizeFailure).filter((item): item is XhsSyncFailure => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

export async function deleteXhsSyncFailures(
  wikiRoot: string,
  ids: readonly string[],
): Promise<{ deleted: string[]; remaining: number }> {
  const requested = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const failures = readXhsSyncFailures(wikiRoot);
  if (requested.length === 0 || failures.length === 0) {
    return { deleted: [], remaining: failures.length };
  }
  const requestedSet = new Set(requested);
  const deleted = failures.filter((item) => requestedSet.has(item.id)).map((item) => item.id);
  if (deleted.length === 0) {
    return { deleted: [], remaining: failures.length };
  }
  const remainingFailures = failures.filter((item) => !requestedSet.has(item.id));
  await writeXhsSyncFailures(wikiRoot, remainingFailures);
  return { deleted, remaining: remainingFailures.length };
}

async function fetchXhsPost(url: string, options: XhsRunOptions): Promise<XhsPost> {
  const cookies = readCookies(resolveXhsCookiesPath(options));
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      Cookie: cookies,
      Referer: "https://www.xiaohongshu.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`小红书页面请求失败：${response.status}`);
  const html = await response.text();
  const state = parseInitialState(html);
  return extractPost(state, readPostId(url));
}

function readCookies(cookiesPath: string): string {
  if (!fs.existsSync(cookiesPath)) {
    throw new Error(`小红书 cookies 不存在：${cookiesPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(cookiesPath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`小红书 cookies 格式不是数组：${cookiesPath}`);
  return parsed
    .map((item) => {
      if (!isRecord(item)) return "";
      const name = stringField(item.name);
      const value = stringField(item.value);
      return name && value ? `${name}=${value}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

function parseInitialState(html: string): unknown {
  const match = /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) throw new Error("小红书页面中没有找到 window.__INITIAL_STATE__，cookies 可能过期");
  const raw = match[1].trim().replace(/;$/, "").replace(/\bundefined\b/g, "null");
  return JSON.parse(raw) as unknown;
}

// fallow-ignore-next-line complexity
function extractPost(state: unknown, preferredId: string | null): XhsPost {
  const root = isRecord(state) ? state : {};
  const note = isRecord(root.note) ? root.note : {};
  const map = isRecord(note.noteDetailMap) ? note.noteDetailMap : {};
  const entry = preferredId && isRecord(map[preferredId])
    ? map[preferredId]
    : Object.values(map).find(isRecord);
  const rawPost = isRecord(entry) && isRecord(entry.note) ? entry.note : null;
  if (!rawPost) throw new Error("小红书 __INITIAL_STATE__ 中没有找到帖子详情");

  const id = stringField(rawPost.noteId) || preferredId || "unknown";
  const user = isRecord(rawPost.user) ? rawPost.user : {};
  const interactInfo = isRecord(rawPost.interactInfo) ? rawPost.interactInfo : {};
  return {
    id,
    title: stringField(rawPost.title) || "未命名小红书",
    desc: stringField(rawPost.desc),
    type: stringField(rawPost.type) || "normal",
    date: formatPostDate(rawPost.time),
    author: stringField(user.nickname) || "未知作者",
    images: readImageUrls(rawPost.imageList),
    videoUrl: readVideoUrl(rawPost.video),
    tags: readTags(rawPost.tagList),
    likes: stringField(interactInfo.likedCount) || "0",
    collects: stringField(interactInfo.collectedCount) || "0",
    comments: stringField(interactInfo.commentCount) || "0",
    ipLocation: stringField(rawPost.ipLocation),
  };
}

// fallow-ignore-next-line complexity
async function writeXhsPostMarkdown(
  wikiRoot: string,
  markdownPath: string,
  url: string,
  post: XhsPost,
  userBody: string | undefined,
  artifacts: XhsPostArtifacts,
  decision: XhsDecisionNoteDraft,
): Promise<string> {
  const insightTitle = decision.insightTitle;
  const fileTitle = decision.shortTitle;
  const summary = decision.summaryLines.slice(0, 6);
  const lines = [
    "---",
    `title: ${yamlQuote(insightTitle)}`,
    `short_title: ${yamlQuote(fileTitle)}`,
    `original_title: ${yamlQuote(post.title)}`,
    "type: xhs-clipping",
    "platform: xhs",
    `source_url: ${yamlQuote(url)}`,
    `post_id: ${yamlQuote(post.id)}`,
    `created: ${yamlQuote(new Date().toISOString())}`,
    `post_date: ${yamlQuote(post.date)}`,
    `author: ${yamlQuote(post.author)}`,
    `clip_status: ${artifacts.warnings.length > 0 ? "partial" : "completed"}`,
    `media_count: ${artifacts.images.length + (artifacts.video ? 1 : 0)}`,
    "tags: [剪藏, 小红书]",
    "---",
    "",
    `# ${insightTitle}`,
    "",
    ...summary,
    "",
    "> [!tip]- 详情",
    ...quoteBlockLines([
      `原文链接: ${url}`,
      `原始标题: ${post.title}`,
      "",
      "决策笔记:",
      decision.decisionNote,
      "",
      post.desc || "原帖没有正文。",
      "",
      ...artifacts.images.flatMap((image, index) => [`![图${index + 1}](${image.storedPath})`, ""]),
    ]),
  ];
  if (artifacts.video) {
    lines.push(...quoteBlockLines(["视频:", `![](${artifacts.video.storedPath})`, ""]));
    if (artifacts.transcript?.trim()) {
      lines.push(...quoteBlockLines(["视频转录:", artifacts.transcript.trim(), ""]));
    }
  }
  if (userBody?.trim()) {
    lines.push(...quoteBlockLines(["用户备注:", userBody.trim(), ""]));
  }
  if (artifacts.warnings.length > 0) {
    lines.push(...quoteBlockLines(["同步警告:", artifacts.warnings.join("\n\n"), ""]));
  }
  lines.push(
    "> [!info]- 笔记属性",
    ...quoteBlockLines([
      `- 来源: 小红书 · ${post.author}`,
      `- 帖子ID: ${post.id}`,
      `- 日期: ${post.date}`,
      `- 类型: ${post.type}`,
      `- 互动: ${post.likes}赞 / ${post.collects}收藏 / ${post.comments}评论`,
      `- 标签: ${post.tags.join(", ") || "无"}`,
      `- IP属地: ${post.ipLocation || "未知"}`,
    ]),
  );
  const outputFile = resolveStoredPath(wikiRoot, markdownPath);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${lines.join("\n").trim()}\n`, "utf8");
  return markdownPath;
}

// fallow-ignore-next-line complexity
async function syncXhsSourceArtifacts(
  wikiRoot: string,
  markdownPath: string,
  post: XhsPost,
  artifacts: XhsPostArtifacts,
  options: XhsRunOptions,
): Promise<string[]> {
  const runtimeRoot = options.runtimeRoot ?? wikiRoot;
  const relativeMarkdownPath = toSourceGalleryPath(wikiRoot, markdownPath);
  if (!relativeMarkdownPath) {
    return [];
  }

  const warnings: string[] = [];
  const sourceId = sourceMediaId(relativeMarkdownPath);
  const markdownFile = resolveStoredPath(wikiRoot, markdownPath);

  let transcriptPath: string | undefined;
  if (artifacts.transcript?.trim()) {
    transcriptPath = (await writeSourceTranscriptSidecar(runtimeRoot, sourceId, artifacts.transcript)).path;
  } else {
    const localVideo = resolveLocalArtifactPath(wikiRoot, markdownFile, artifacts.video?.storedPath);
    if (localVideo) {
      const transcriptResult = await runCloudflareTranscription({
        runtimeRoot,
        sourceId,
        filePath: localVideo,
      });
      if (transcriptResult.ok) {
        artifacts.transcript = await formatXhsTranscript(transcriptResult.text, post, options);
        transcriptPath = (await writeSourceTranscriptSidecar(runtimeRoot, sourceId, artifacts.transcript)).path;
        artifacts.warnings = artifacts.warnings.filter((warning) => !isTranscriptFailureWarning(warning));
      } else if (transcriptResult.error.type !== "cloudflare-unconfigured") {
        warnings.push(`音视频转写失败：${transcriptResult.error.message}`);
      }
    }
  }

  let ocrTextPath: string | undefined;
  const localImage = resolveLocalArtifactPath(wikiRoot, markdownFile, artifacts.images[0]?.storedPath);
  if (localImage) {
    const ocrResult = await runCloudflareOcr({
      runtimeRoot,
      sourceId,
      filePath: localImage,
    });
    if (ocrResult.ok) {
      ocrTextPath = ocrResult.path;
      artifacts.warnings = artifacts.warnings.filter((warning) => !isOcrFailureWarning(warning));
    } else if (ocrResult.error.type !== "cloudflare-unconfigured") {
      warnings.push(`图片 OCR 失败：${ocrResult.error.message}`);
    }
  }

  const mediaIndex = await scanSourceMediaIndex(wikiRoot, runtimeRoot);
  const record = mediaIndex.records[sourceId];
  if (record) {
    mediaIndex.records[sourceId] = {
      ...record,
      ocrTextPath: ocrTextPath ?? record.ocrTextPath,
      transcriptPath: transcriptPath ?? record.transcriptPath,
    };
    mediaIndex.generatedAt = new Date().toISOString();
    await writeSourceMediaIndex(runtimeRoot, mediaIndex);
  }

  return warnings;
}

function toSourceGalleryPath(wikiRoot: string, markdownPath: string): string | null {
  if (!path.isAbsolute(markdownPath)) {
    return markdownPath.replace(/\\/g, "/");
  }
  const relativePath = path.relative(wikiRoot, markdownPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return relativePath.replace(/\\/g, "/");
}

function resolveLocalArtifactPath(wikiRoot: string, markdownFile: string, storedPath?: string): string | null {
  if (!storedPath || /^https?:\/\//i.test(storedPath) || /^data:/i.test(storedPath)) {
    return null;
  }
  const candidate = path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(path.dirname(markdownFile), storedPath);
  const resolved = path.resolve(candidate);
  const root = path.resolve(wikiRoot);
  if (!resolved.startsWith(root) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return null;
  }
  return resolved;
}

function isTranscriptFailureWarning(warning: string): boolean {
  return warning.includes("ffmpeg")
    || warning.includes("转写失败")
    || warning.includes("转录失败")
    || warning.toLowerCase().includes("transcrib");
}

function isOcrFailureWarning(warning: string): boolean {
  return warning.includes("OCR")
    || warning.includes("ocr");
}

async function upsertXhsTask(wikiRoot: string, task: XhsSyncTask): Promise<void> {
  const file = path.join(wikiRoot, ...XHS_TASK_FILE.split("/"));
  const existing = readXhsSyncTasks(wikiRoot).items.filter((item) => item.id !== task.id);
  const payload: XhsSyncTaskFile = {
    version: 1,
    updatedAt: task.updatedAt,
    items: [task, ...existing].slice(0, 100),
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function recordXhsSyncFailure(
  wikiRoot: string,
  input: Omit<XhsSyncFailure, "id"> & { id?: string },
): Promise<XhsSyncFailure> {
  const failures = readXhsSyncFailures(wikiRoot);
  const record: XhsSyncFailure = {
    id: input.id ?? crypto.createHash("sha1").update(`${input.command}:${input.url ?? input.keyword ?? ""}:${input.createdAt}`).digest("hex").slice(0, 16),
    command: input.command,
    url: input.url,
    keyword: input.keyword,
    error: input.error,
    createdAt: input.createdAt,
  };
  await writeXhsSyncFailures(wikiRoot, [record, ...failures]);
  return record;
}

async function writeXhsSyncFailures(wikiRoot: string, failures: readonly XhsSyncFailure[]): Promise<void> {
  const file = path.join(wikiRoot, ...XHS_FAILURE_FILE.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(failures.slice(0, 100), null, 2)}\n`, "utf8");
}

function createTask(command: XhsCommand, urls: string[], createdAt: string, total: number): XhsSyncTask {
  return {
    id: crypto.createHash("sha1").update(`${command}:${urls.join("|")}:${createdAt}`).digest("hex").slice(0, 16),
    command,
    status: "partial",
    createdAt,
    updatedAt: createdAt,
    urls,
    total,
    completed: 0,
    failed: 0,
  };
}

function finishTask(task: XhsSyncTask, status: XhsSyncStatus, patch: Partial<XhsSyncTask>): XhsSyncTask {
  return {
    ...task,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
  };
}

function taskProgress(task: XhsSyncTask): XhsProgress {
  const current = task.completed + task.failed;
  const total = task.total;
  return {
    current,
    total,
    percent: total <= 0 ? 0 : Math.round((current / total) * 100),
  };
}

// fallow-ignore-next-line complexity
async function collectPostArtifacts(
  wikiRoot: string,
  outputDir: string,
  post: XhsPost,
  options: XhsRunOptions,
): Promise<XhsPostArtifacts> {
  let warnings: string[] = [];
  const images: XhsLocalMedia[] = [];
  let video: XhsLocalMedia | undefined;
  let transcript: string | undefined;
  const fetcher = options.fetcher ?? fetch;

  for (const [index, imageUrl] of post.images.entries()) {
    try {
      const storedPath = await downloadXhsMedia(wikiRoot, outputDir, "img", imageUrl, post.id, index + 1, fetcher);
      images.push({ sourceUrl: imageUrl, storedPath });
    } catch (error) {
      warnings.push(`图片${index + 1}本地化失败：${errorMessage(error)}；已保留原图地址。`);
      images.push({ sourceUrl: imageUrl, storedPath: imageUrl });
    }
  }

  if (!post.videoUrl) {
    return { warnings, images };
  }
  try {
    const storedPath = await downloadXhsMedia(wikiRoot, outputDir, "video", post.videoUrl, post.id, 1, fetcher);
    video = { sourceUrl: post.videoUrl, storedPath };
  } catch (error) {
    warnings.push(`视频本地化失败：${errorMessage(error)}；已保留原视频地址。`);
    video = { sourceUrl: post.videoUrl, storedPath: post.videoUrl };
  }
  try {
    if (options.videoTranscriber) {
      transcript = await options.videoTranscriber(post, options);
      if (video && isRemoteStoredPath(video.storedPath)) {
        video = await ensureLocalXhsVideo(wikiRoot, outputDir, post, video, fetcher);
      }
    } else {
      const transcribed = await transcribeDownloadedXhsVideo(wikiRoot, outputDir, post, video, options);
      transcript = transcribed.text;
      video = transcribed.video;
    }
    if (video && !isRemoteStoredPath(video.storedPath)) {
      warnings = warnings.filter((warning) => !isVideoLocalizationFailureWarning(warning));
    }
    transcript = await formatXhsTranscript(transcript, post, options);
    if (!transcript.trim()) {
      warnings.push("视频转录已执行，但没有得到有效文本；已保存视频链接。");
    }
  } catch (error) {
    warnings.push(`视频转录失败：${errorMessage(error)}；已保存视频链接。`);
  }
  return { warnings, transcript, images, video };
}

async function formatXhsDecisionNote(
  wikiRoot: string,
  sourceUrl: string,
  post: XhsPost,
  userBody: string | undefined,
  artifacts: XhsPostArtifacts,
  options: XhsRunOptions,
): Promise<{ note: XhsDecisionNoteDraft; warnings: string[] }> {
  const fallback = buildFallbackDecisionNote(post, userBody, artifacts.transcript);
  if (!options.projectRoot && !options.postFormatter) {
    return { note: fallback, warnings: [] };
  }
  const projectRoot = options.projectRoot ?? wikiRoot;
  const agent = options.projectRoot ? readXhsDecisionAgent(projectRoot) : null;
  const input = buildXhsPostFormatterInput(projectRoot, sourceUrl, post, userBody, artifacts.transcript, agent);
  try {
    const draft = options.postFormatter
      ? await options.postFormatter(input)
      : await formatXhsPostWithAgent(projectRoot, input, agent);
    return { note: normalizeDecisionNoteDraft(draft, fallback), warnings: [] };
  } catch (error) {
    return {
      note: fallback,
      warnings: [`LLM 决策笔记生成失败：${errorMessage(error)}；已使用规则化模板生成 partial 笔记。`],
    };
  }
}

async function formatXhsPostWithAgent(
  projectRoot: string,
  input: XhsPostFormatterInput,
  agent: AgentDefinition | null,
): Promise<XhsDecisionNoteDraft> {
  if (!agent) {
    throw new Error(`未找到 ${XHS_DECISION_AGENT_ID} Agent`);
  }
  const provider = resolveXhsDecisionProvider(projectRoot, agent, input.post.id);
  const system = [
    "你是 LLM Wiki 的小红书决策笔记格式化器。",
    "必须先阅读 agent workflow 和 prompt，再执行任务。",
    "只返回 JSON，不返回 Markdown，不返回解释。",
    "<agent_config>",
    `name: ${agent.name}`,
    agent.purpose ? `purpose: ${agent.purpose}` : "",
    agent.workflow ? `workflow:\n${agent.workflow}` : "",
    agent.prompt ? `prompt:\n${agent.prompt}` : "",
    "</agent_config>",
  ].filter(Boolean).join("\n\n");
  const raw = await provider.complete(system, [{ role: "user", content: buildXhsDecisionPrompt(input) }], 900);
  return parseDecisionNoteDraft(raw);
}

function resolveXhsDecisionProvider(projectRoot: string, agent: AgentDefinition, postId: string): LLMProvider {
  if (agent.provider.trim().toLowerCase() === "cloudflare") {
    return new CloudflareProvider(agent.model.trim() || null);
  }
  return resolveAgentRuntimeProvider(projectRoot, agent, `xhs:${postId}`);
}

function readXhsDecisionAgent(projectRoot: string): AgentDefinition | null {
  const config = readAgentConfig(projectRoot);
  return config.agents.find((agent) => agent.id === XHS_DECISION_AGENT_ID && agent.enabled) ?? null;
}

function buildXhsPostFormatterInput(
  projectRoot: string,
  sourceUrl: string,
  post: XhsPost,
  userBody: string | undefined,
  transcript: string | undefined,
  agent: AgentDefinition | null,
): XhsPostFormatterInput {
  return {
    agent: agent ? {
      id: agent.id,
      name: agent.name,
      purpose: agent.purpose,
      workflow: agent.workflow,
      prompt: agent.prompt,
    } : null,
    projectContext: loadXhsProjectContext(projectRoot),
    sourceUrl,
    post: {
      id: post.id,
      title: post.title,
      desc: post.desc,
      type: post.type,
      date: post.date,
      author: post.author,
      tags: post.tags,
      likes: post.likes,
      collects: post.collects,
      comments: post.comments,
      ipLocation: post.ipLocation,
    },
    userBody: userBody?.trim() ?? "",
    transcript: transcript?.trim() ?? "",
  };
}

function buildXhsDecisionPrompt(input: XhsPostFormatterInput): string {
  return [
    "请把下面小红书内容重写成决策笔记 JSON。",
    "",
    "<project_context>",
    input.projectContext || "当前没有项目上下文文件。",
    "</project_context>",
    "",
    "<xhs_post>",
    JSON.stringify({
      sourceUrl: input.sourceUrl,
      post: input.post,
      userBody: input.userBody,
      transcript: input.transcript,
    }, null, 2),
    "</xhs_post>",
    "",
    "JSON 字段必须是：insightTitle, shortTitle, summaryLines, decisionNote。",
    "shortTitle 必须适合作为文件名，15 字以内。",
    "summaryLines 必须是数组，最多 6 行。",
  ].join("\n");
}

export function parseDecisionNoteDraft(raw: string): XhsDecisionNoteDraft {
  const jsonText = extractJsonObject(raw);
  if (jsonText) {
    const parsedDraft = parseJsonLikeDecisionNoteDraft(jsonText);
    if (parsedDraft) {
      return parsedDraft;
    }
  }
  const labeledDraft = parseLabeledDecisionNoteDraft(raw);
  if (labeledDraft) {
    return labeledDraft;
  }
  throw new Error("LLM 返回中没有 JSON object");
}

function parseLabeledDecisionNoteDraft(raw: string): XhsDecisionNoteDraft | null {
  const sections: Record<keyof XhsDecisionNoteDraft, string[]> = {
    insightTitle: [],
    shortTitle: [],
    summaryLines: [],
    decisionNote: [],
  };
  let current: keyof XhsDecisionNoteDraft | null = null;
  for (const line of listDecisionDraftLines(raw)) {
    const labeled = matchDecisionDraftLabel(line);
    if (labeled) {
      current = labeled.key;
      appendDecisionDraftValue(sections, labeled.key, labeled.value);
      continue;
    }
    if (!current) {
      continue;
    }
    appendDecisionDraftValue(sections, current, line);
  }
  if (isEmptyDecisionDraft(sections)) {
    return null;
  }
  return {
    insightTitle: sections.insightTitle.join("\n").trim(),
    shortTitle: sections.shortTitle.join("\n").trim(),
    summaryLines: sections.summaryLines.map((line) => line.trim()).filter(Boolean),
    decisionNote: sections.decisionNote.join("\n").trim(),
  };
}

function listDecisionDraftLines(raw: string): string[] {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "```" && !/^```(?:json|markdown|md|text)?$/i.test(line));
}

function isEmptyDecisionDraft(sections: Record<keyof XhsDecisionNoteDraft, string[]>): boolean {
  return Object.values(sections).every((lines) => lines.length === 0);
}

function matchDecisionDraftLabel(line: string): { key: keyof XhsDecisionNoteDraft; value: string } | null {
  const patterns: Array<{ key: keyof XhsDecisionNoteDraft; regex: RegExp }> = [
    { key: "insightTitle", regex: /^(?:[-*]\s*)?(?:\*\*)?"?insightTitle"?(?:\*\*)?\s*[:：]\s*(.*)$/i },
    { key: "shortTitle", regex: /^(?:[-*]\s*)?(?:\*\*)?"?shortTitle"?(?:\*\*)?\s*[:：]\s*(.*)$/i },
    { key: "summaryLines", regex: /^(?:[-*]\s*)?(?:\*\*)?"?summaryLines"?(?:\*\*)?\s*[:：]\s*(.*)$/i },
    { key: "decisionNote", regex: /^(?:[-*]\s*)?(?:\*\*)?"?decisionNote"?(?:\*\*)?\s*[:：]\s*(.*)$/i },
  ];
  for (const pattern of patterns) {
    const match = pattern.regex.exec(line);
    if (match) {
      return { key: pattern.key, value: match[1]?.trim() ?? "" };
    }
  }
  return null;
}

function appendDecisionDraftValue(
  sections: Record<keyof XhsDecisionNoteDraft, string[]>,
  key: keyof XhsDecisionNoteDraft,
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  if (key === "summaryLines") {
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          sections.summaryLines.push(...parsed.map((item) => String(item).trim()).filter(Boolean));
          return;
        }
      } catch {
        // Fall through to line-based parsing.
      }
    }
    const bulletMatch = /^(?:[-*•]|\d+\.)\s*(.+)$/.exec(trimmed);
    sections.summaryLines.push((bulletMatch?.[1] ?? trimmed).trim());
    return;
  }
  sections[key].push(trimmed);
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) {
    return null;
  }
  const state: JsonObjectScanState = { depth: 1, inString: false, escaped: false };
  for (let index = start + 1; index < trimmed.length; index += 1) {
    advanceJsonObjectScanState(state, trimmed[index]);
    if (state.depth === 0) {
      return trimmed.slice(start, index + 1);
    }
  }
  return null;
}

function advanceJsonObjectScanState(state: JsonObjectScanState, char: string): void {
  if (state.escaped) {
    state.escaped = false;
    return;
  }
  if (char === "\\") {
    state.escaped = true;
    return;
  }
  if (char === "\"") {
    state.inString = !state.inString;
    return;
  }
  if (state.inString) {
    return;
  }
  if (char === "{") {
    state.depth += 1;
    return;
  }
  if (char === "}") {
    state.depth -= 1;
  }
}

function parseJsonLikeDecisionNoteDraft(raw: string): XhsDecisionNoteDraft | null {
  try {
    const parsed = JSON.parse(normalizeJsonLikeObject(raw)) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("LLM 返回不是 JSON object");
    }
    return {
      insightTitle: stringField(parsed.insightTitle),
      shortTitle: stringField(parsed.shortTitle),
      summaryLines: Array.isArray(parsed.summaryLines) ? parsed.summaryLines.map(String) : [],
      decisionNote: stringField(parsed.decisionNote),
    };
  } catch {
    return null;
  }
}

function normalizeJsonLikeObject(raw: string): string {
  const state: JsonNormalizationState = { normalized: "", inString: false, escaped: false };
  for (let index = 0; index < raw.length; index += 1) {
    index = appendNormalizedJsonChar(state, raw, index);
  }
  return state.normalized.replace(/,\s*([}\]])/g, "$1");
}

function appendNormalizedJsonChar(
  state: JsonNormalizationState,
  raw: string,
  index: number,
): number {
  const char = raw[index];
  if (state.escaped) {
    state.normalized += char;
    state.escaped = false;
    return index;
  }
  if (char === "\\") {
    state.normalized += char;
    state.escaped = true;
    return index;
  }
  if (char === "\"") {
    state.normalized += char;
    state.inString = !state.inString;
    return index;
  }
  if (state.inString && (char === "\n" || char === "\r")) {
    if (char === "\r" && raw[index + 1] === "\n") {
      index += 1;
    }
    state.normalized += "\\n";
    return index;
  }
  state.normalized += char;
  return index;
}

function normalizeDecisionNoteDraft(draft: XhsDecisionNoteDraft, fallback: XhsDecisionNoteDraft): XhsDecisionNoteDraft {
  const insightTitle = draft.insightTitle.trim() || fallback.insightTitle;
  const shortTitle = sliceChars(sanitizeFileName(draft.shortTitle.trim() || fallback.shortTitle), 15) || fallback.shortTitle;
  const summaryLines = draft.summaryLines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    insightTitle,
    shortTitle,
    summaryLines: summaryLines.length > 0 ? summaryLines : fallback.summaryLines,
    decisionNote: draft.decisionNote.trim() || fallback.decisionNote,
  };
}

async function downloadXhsMedia(
  wikiRoot: string,
  outputDir: string,
  folder: "img" | "video",
  mediaUrl: string,
  postId: string,
  index: number,
  fetcher: XhsFetcher,
): Promise<string> {
  const target = resolveXhsMediaTarget(outputDir, folder, mediaUrl, postId, index);
  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await downloadRemoteFile(mediaUrl, target.absolutePath, fetcher);
  return target.storedPath;
}

async function downloadRemoteFile(mediaUrl: string, outputPath: string, fetcher: XhsFetcher): Promise<void> {
  const response = await fetcher(mediaUrl, {
    headers: {
      Referer: "https://www.xiaohongshu.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`媒体下载失败：${response.status}`);
  }
  if (!response.body) {
    throw new Error("媒体下载失败：响应体为空");
  }
  await pipeline(Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>), createWriteStream(outputPath));
}

async function transcribeXhsVideoWithWhisper(post: XhsPost, options: XhsRunOptions): Promise<string> {
  if (!post.videoUrl) return "";
  const tempRoot = await mkdirTempDir(options.tempDir ?? os.tmpdir(), `xhs-${post.id}-`);
  const videoPath = path.join(tempRoot, `${post.id}.mp4`);
  try {
    await downloadXhsVideo(post.videoUrl, videoPath, options.fetcher ?? fetch);
    return await transcribeVideoFileWithWhisper(videoPath, post.id, options);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function transcribeDownloadedXhsVideo(
  wikiRoot: string,
  outputDir: string,
  post: XhsPost,
  video: XhsLocalMedia,
  options: XhsRunOptions,
) : Promise<{ text: string; video: XhsLocalMedia }> {
  let resolvedVideo = video;
  let localVideoPath = resolveDownloadedMediaPath(outputDir, resolvedVideo.storedPath);
  if (!localVideoPath) {
    try {
      resolvedVideo = await ensureLocalXhsVideo(wikiRoot, outputDir, post, resolvedVideo, options.fetcher ?? fetch);
      localVideoPath = resolveDownloadedMediaPath(outputDir, resolvedVideo.storedPath);
    } catch {
      return {
        text: await transcribeXhsVideoWithWhisper(post, options),
        video: resolvedVideo,
      };
    }
  }
  if (!localVideoPath) {
    return {
      text: await transcribeXhsVideoWithWhisper(post, options),
      video: resolvedVideo,
    };
  }
  const cloudflareResult = await transcribeFileWithCloudflare({ filePath: localVideoPath });
  if (cloudflareResult.ok) {
    return { text: cloudflareResult.text, video: resolvedVideo };
  }
  if (cloudflareResult.error.type !== "cloudflare-unconfigured") {
    try {
      return {
        text: await transcribeVideoFileWithWhisper(localVideoPath, post.id, options),
        video: resolvedVideo,
      };
    } catch (fallbackError) {
      throw new Error([
        `Cloudflare: ${cloudflareResult.error.message}`,
        `Whisper: ${errorMessage(fallbackError)}`,
      ].join(" | "));
    }
  }
  return {
    text: await transcribeVideoFileWithWhisper(localVideoPath, post.id, options),
    video: resolvedVideo,
  };
}

async function ensureLocalXhsVideo(
  wikiRoot: string,
  outputDir: string,
  post: XhsPost,
  video: XhsLocalMedia,
  fetcher: XhsFetcher,
): Promise<XhsLocalMedia> {
  if (!post.videoUrl || !isRemoteStoredPath(video.storedPath)) {
    return video;
  }
  const target = resolveXhsMediaTarget(outputDir, "video", post.videoUrl, post.id, 1);
  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await downloadRemoteFile(post.videoUrl, target.absolutePath, fetcher);
  return {
    sourceUrl: video.sourceUrl,
    storedPath: target.storedPath,
  };
}

async function formatXhsTranscript(
  transcript: string,
  post: XhsPost,
  options: XhsRunOptions,
): Promise<string> {
  const raw = transcript.replace(/\r/g, "").trim();
  if (!raw) {
    return "";
  }
  if (options.transcriptFormatter) {
    const formatted = (await options.transcriptFormatter({ transcript: raw, post })).replace(/\r/g, "").trim();
    return formatted || raw;
  }
  return applyTranscriptLayout(raw);
}

function applyTranscriptLayout(transcript: string): string {
  const normalized = transcript
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  let formatted = normalized.replace(/([。！？!?；;])(?=[^\n])/g, "$1\n\n");
  for (const marker of ["第一个部分", "第二个部分", "第三个部分", "第四个部分", "第五个部分", "首先", "其次", "然后", "最后", "另外", "同时", "但是", "所以", "因为", "例如", "比如"]) {
    formatted = formatted.replace(new RegExp(marker, "g"), (match, offset) => (offset === 0 ? match : `\n\n${match}`));
  }
  return formatted
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function isVideoLocalizationFailureWarning(warning: string): boolean {
  return warning.startsWith("视频本地化失败：");
}

async function mkdirTempDir(baseDir: string, prefix: string): Promise<string> {
  await mkdir(baseDir, { recursive: true });
  return await fs.promises.mkdtemp(path.join(baseDir, prefix));
}

async function downloadXhsVideo(videoUrl: string, outputPath: string, fetcher: XhsFetcher): Promise<void> {
  await downloadRemoteFile(videoUrl, outputPath, fetcher);
}

async function extractAudioTrack(videoPath: string, audioPath: string): Promise<void> {
  await execFileAsync(resolveExecutablePath("ffmpeg"), [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    audioPath,
  ], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function transcribeVideoFileWithWhisper(
  videoPath: string,
  postId: string,
  options: XhsRunOptions,
): Promise<string> {
  const tempRoot = await mkdirTempDir(options.tempDir ?? os.tmpdir(), `xhs-audio-${postId}-`);
  const audioPath = path.join(tempRoot, `${postId}.wav`);
  try {
    await extractAudioTrack(videoPath, audioPath);
    return await runWhisperTranscription(
      audioPath,
      options.whisperModel ?? process.env.LLM_WIKI_XHS_WHISPER_MODEL ?? "base",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runWhisperTranscription(audioPath: string, model: string): Promise<string> {
  const ffmpegPath = resolveExecutablePath("ffmpeg");
  const script = [
    "import json, sys, whisper",
    "audio_path = sys.argv[1]",
    "model_name = sys.argv[2]",
    "loaded = whisper.load_model(model_name)",
    "result = loaded.transcribe(audio_path, language='zh', fp16=False, verbose=False)",
    "print(json.dumps({'text': result.get('text', '')}, ensure_ascii=False))",
  ].join("; ");
  const { stdout } = await execFileAsync(resolveExecutablePath("py"), [
    "-X",
    "utf8",
    "-c",
    script,
    audioPath,
    model,
  ], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: buildExecutableEnv(ffmpegPath, {
      ...process.env,
      PYTHONUTF8: "1",
    }),
  });
  const parsed = JSON.parse(stdout.trim()) as { text?: string };
  return typeof parsed.text === "string" ? parsed.text.trim() : "";
}

export function buildExecutableEnv(
  executablePath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (!path.isAbsolute(executablePath)) {
    return { ...env };
  }
  const executableDir = path.dirname(executablePath);
  const nextEnv: NodeJS.ProcessEnv = { ...env };
  const pathKey = resolveEnvPathKey(nextEnv, platform);
  const currentPath = nextEnv[pathKey] ?? "";
  const pathParts = currentPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const normalizedExecutableDir = normalizeEnvPathEntry(executableDir, platform);
  const hasDir = pathParts.some((entry) => normalizeEnvPathEntry(entry, platform) === normalizedExecutableDir);
  const nextPath = hasDir
    ? currentPath
    : [executableDir, ...pathParts].join(path.delimiter);
  for (const key of Object.keys(nextEnv)) {
    if (key !== pathKey && key.toLowerCase() === "path") {
      delete nextEnv[key];
    }
  }
  nextEnv[pathKey] = nextPath;
  return nextEnv;
}

// fallow-ignore-next-line complexity
export function resolveExecutablePath(command: string, options: ResolveExecutablePathOptions = {}): string {
  const trimmed = command.trim();
  if (!trimmed || path.isAbsolute(trimmed) || /[\\/]/.test(trimmed)) {
    return command;
  }
  const platform = options.platform ?? process.platform;
  const searchDirs = (options.pathValue ?? process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (platform === "win32") {
    const localAppData = (options.localAppData ?? process.env.LOCALAPPDATA ?? "").trim();
    if (localAppData) {
      searchDirs.push(path.join(localAppData, "Microsoft", "WinGet", "Links"));
    }
  }
  const candidateNames = resolveExecutableCandidateNames(trimmed, platform, options.pathExt ?? process.env.PATHEXT ?? "");
  for (const dir of new Set(searchDirs)) {
    for (const candidate of candidateNames) {
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    }
  }
  return command;
}

function resolveExecutableCandidateNames(command: string, platform: NodeJS.Platform, pathExt: string): string[] {
  if (platform !== "win32") {
    return [command];
  }
  const extension = path.extname(command);
  if (extension) {
    return [command];
  }
  const suffixes = pathExt
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const normalizedSuffixes = suffixes.length > 0 ? suffixes : [".exe", ".cmd", ".bat", ".com"];
  return [command, ...normalizedSuffixes.map((suffix) => `${command}${suffix.toLowerCase()}`)];
}

function resolveEnvPathKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const existing = Object.keys(env).find((key) => key.toLowerCase() === "path");
  if (existing) {
    return existing;
  }
  return platform === "win32" ? "Path" : "PATH";
}

function normalizeEnvPathEntry(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? value.toLowerCase() : value;
}

function readImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => isRecord(item) ? stringField(item.urlDefault) || stringField(item.urlPre) || stringField(item.url) : "")
    .filter(Boolean);
}

function readVideoUrl(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const media = isRecord(value.media) ? value.media : {};
  const stream = isRecord(media.stream) ? media.stream : {};
  for (const key of ["h264", "h265", "av1"]) {
    const url = readVideoStreamUrl(stream[key]);
    if (url) return url;
  }
  return undefined;
}

function readVideoStreamUrl(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const url = stringField(item.masterUrl) || stringField(item.backupUrls);
    if (url) {
      return url;
    }
  }
  return undefined;
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => isRecord(item) ? stringField(item.name) : "").filter(Boolean);
}

function uniqueMarkdownPath(wikiRoot: string, outputDir: string, title: string): string {
  const base = sanitizeFileName(title).slice(0, 90) || "小红书剪藏";
  let name = `${base}.md`;
  let index = 1;
  while (fs.existsSync(path.join(outputDir, name))) {
    name = `${base}-${index}.md`;
    index += 1;
  }
  const absolute = path.join(outputDir, name);
  return toStoredPath(wikiRoot, absolute);
}

function buildFallbackDecisionNote(post: XhsPost, userBody?: string, transcript?: string): XhsDecisionNoteDraft {
  const insightTitle = buildInsightTitle(post, userBody);
  return {
    insightTitle,
    shortTitle: buildFileTitle(insightTitle, post, userBody),
    summaryLines: buildThielSummary(post, userBody, transcript),
    decisionNote: [
      `原帖提供的变量是：${firstSentence(post.desc) || post.title}`,
      "先把它当作一个待验证假设，而不是直接当作结论收藏。",
      post.tags.length > 0 ? `可归入这些观察方向：${post.tags.join(" / ")}。` : "暂时没有明确标签，需要后续人工归类。",
      "下一步只做一件事：判断它是否能改变当前项目、工具库或工作流里的一个具体动作。",
    ].join("\n"),
  };
}

function buildInsightTitle(post: XhsPost, userBody?: string): string {
  const source = firstSentence(userBody) || firstSentence(post.desc) || post.title || "小红书剪藏";
  const compact = source
    .replace(/[#【】\[\]（）()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const subject = compact.slice(0, 32) || "这条小红书笔记";
  return `把${subject}转成可验证行动`;
}

function buildFileTitle(insightTitle: string, post: XhsPost, userBody?: string): string {
  const source = post.title || titleFromBody(userBody) || insightTitle || "小红书剪藏";
  const compact = source
    .replace(/[#【】\[\]（）()]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return compact.slice(0, 15) || "小红书剪藏";
}

function buildThielSummary(post: XhsPost, userBody: string | undefined, transcript?: string): string[] {
  const core = firstSentence(post.desc) || firstSentence(userBody) || firstSentence(transcript) || post.title;
  const decision = post.tags.length > 0
    ? `它指向一个可验证判断：${post.tags.slice(0, 3).join(" / ")} 是否真的能改变行动结果。`
    : "它指向一个可验证判断：不要收集更多素材，先找能改变行动结果的变量。";
  const leverage = transcript?.trim()
    ? "视频信息已转写，后续应优先抽取可复用步骤，而不是保存情绪化描述。"
    : "后续应优先抽取可复用步骤，而不是保存情绪化描述。";
  return [
    `这条笔记的核心不是“${post.title}”，而是：${core}`,
    decision,
    leverage,
    `决策用途：${post.type === "video" ? "把视频经验转成流程" : "把图文经验转成清单"}，再判断是否进入项目或工具库。`,
  ].slice(0, 6);
}

function loadXhsProjectContext(projectRoot: string): string {
  const chunks: string[] = [];
  for (const relativePath of XHS_PROJECT_CONTEXT_FILES) {
    const filePath = path.join(projectRoot, ...relativePath.split("/"));
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) continue;
    chunks.push(`## ${relativePath}\n${truncateChars(raw, 1800)}`);
  }
  return truncateChars(chunks.join("\n\n---\n\n"), 5000);
}

function quoteBlockLines(lines: string[]): string[] {
  return lines.map((line) => (line ? `> ${line}` : ">"));
}

function mediaExtension(mediaUrl: string, folder: "img" | "video"): string {
  try {
    const ext = path.extname(new URL(mediaUrl).pathname).toLowerCase();
    if (folder === "img" && [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return ext;
    if (folder === "video" && [".mp4", ".mov", ".m4v", ".webm"].includes(ext)) return ext;
  } catch {
    // Fall through to deterministic defaults for signed or malformed media URLs.
  }
  return folder === "img" ? ".jpg" : ".mp4";
}

function uniqueUrls(urls: string[]): string[] {
  return [...new Set(urls.map((url) => url.trim()).filter((url) => /xiaohongshu\.com|xhslink\.com/i.test(url)))];
}

async function fetchXhsFavoriteUrls(options: XhsRunOptions): Promise<string[]> {
  const cookies = readCookies(resolveXhsCookiesPath(options));
  const userId = await fetchXhsCurrentUserId(cookies, options);
  const urls: string[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";
  let page = 0;

  while (page < XHS_COLLECT_MAX_PAGES) {
    const pageData = await fetchXhsFavoritePage(cookies, userId, cursor, options);
    urls.push(...pageData.urls);
    page += 1;
    if (!pageData.hasMore || !pageData.cursor || seenCursors.has(pageData.cursor)) {
      break;
    }
    seenCursors.add(pageData.cursor);
    cursor = pageData.cursor;
  }

  return uniqueUrls(urls);
}

async function fetchXhsCurrentUserId(cookies: string, options: XhsRunOptions): Promise<string> {
  const payload = await requestXhsJson(XHS_USER_ME_ENDPOINT, cookies, options);
  const userId = findFirstStringByKey(payload, ["user_id", "userId", "userid"]);
  if (!userId) {
    throw new Error("未能从小红书账号信息中读取用户 ID，请重新导入 Cookie 后再同步收藏。");
  }
  return userId;
}

async function fetchXhsFavoritePage(
  cookies: string,
  userId: string,
  cursor: string,
  options: XhsRunOptions,
): Promise<{ urls: string[]; cursor: string; hasMore: boolean }> {
  const url = new URL(XHS_COLLECT_PAGE_ENDPOINT);
  url.searchParams.set("num", String(XHS_COLLECT_PAGE_SIZE));
  url.searchParams.set("user_id", userId);
  url.searchParams.set("image_formats", "jpg,webp,avif");
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  const payload = await requestXhsJson(url.toString(), cookies, options);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  const nextCursor = isRecord(data) ? stringField(data.cursor) : "";
  const hasMore = isRecord(data) ? booleanField(data.has_more) ?? booleanField(data.hasMore) ?? false : false;
  return {
    urls: extractFavoritePostUrls(data),
    cursor: nextCursor,
    hasMore,
  };
}

async function requestXhsJson(url: string, cookies: string, options: XhsRunOptions): Promise<unknown> {
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: cookies,
      Referer: "https://www.xiaohongshu.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`小红书收藏接口请求失败：${response.status}`);
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error("小红书收藏接口返回的不是 JSON，请重新导入 Cookie 后再同步收藏。");
  }
  if (isRecord(payload) && payload.success === false) {
    throw new Error(stringField(payload.msg) || stringField(payload.message) || "小红书收藏接口返回失败");
  }
  return payload;
}

function extractFavoritePostUrls(value: unknown): string[] {
  const urls: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    const noteId = stringField(node.note_id) || stringField(node.noteId) || readHexId(stringField(node.id));
    if (noteId) {
      urls.push(buildXhsPostUrl(noteId, node));
    }
    for (const child of Object.values(node)) {
      visit(child);
    }
  };
  visit(value);
  return uniqueUrls(urls);
}

function buildXhsPostUrl(noteId: string, source: Record<string, unknown>): string {
  const url = new URL(`https://www.xiaohongshu.com/explore/${noteId}`);
  const token = stringField(source.xsec_token) || stringField(source.xsecToken);
  if (token) {
    url.searchParams.set("xsec_token", token);
    url.searchParams.set("xsec_source", stringField(source.xsec_source) || stringField(source.xsecSource) || "pc_collect");
  }
  return url.toString();
}

function findFirstStringByKey(value: unknown, keys: readonly string[]): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKey(item, keys);
      if (found) return found;
    }
    return "";
  }
  if (!isRecord(value)) return "";
  for (const key of keys) {
    const found = stringField(value[key]);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = findFirstStringByKey(child, keys);
    if (found) return found;
  }
  return "";
}

function booleanField(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function readHexId(value: string): string {
  return /^[0-9a-f]{24}$/i.test(value) ? value : "";
}

function resolveXhsCookiesPath(options: XhsRunOptions): string {
  const configured = options.cookiesPath?.trim() || process.env.LLM_WIKI_XHS_COOKIE_PATH?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), "cookies.json");
}

function cleanUrl(value: string): string {
  return value.replace(/[，。、“”‘’；;,.!?！？）)】\]]+$/u, "");
}

interface SyncedXhsRefs {
  urls: Set<string>;
  postIds: Set<string>;
}

function readSyncedXhsRefs(outputDir: string): SyncedXhsRefs {
  const refs: SyncedXhsRefs = { urls: new Set(), postIds: new Set() };
  if (!fs.existsSync(outputDir)) return refs;
  const markdownFiles = listMarkdownFilesRecursive(outputDir, { relative: true });
  for (const file of markdownFiles) {
    const raw = fs.readFileSync(path.join(outputDir, file), "utf8");
    for (const sourceUrl of raw.matchAll(/source_url:\s*["']?([^"'\r\n]+)["']?/gi)) {
      const value = sourceUrl[1]?.trim();
      if (value) refs.urls.add(normalizeXhsUrl(cleanUrl(value)));
    }
    for (const postId of raw.matchAll(/post_id:\s*["']?([0-9a-f]{24})["']?/gi)) {
      refs.postIds.add(postId[1]!.toLowerCase());
    }
  }
  return refs;
}

function isSyncedXhsUrl(url: string, synced: SyncedXhsRefs): boolean {
  const postId = readPostId(url);
  return Boolean(postId && synced.postIds.has(postId.toLowerCase())) || synced.urls.has(normalizeXhsUrl(url));
}

function normalizeXhsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function readPostId(url: string): string | null {
  return /[0-9a-f]{24}/i.exec(url)?.[0] ?? null;
}

function resolveXhsOutputDir(wikiRoot: string, outputRoot?: string): string {
  return outputRoot?.trim() ? path.resolve(outputRoot.trim()) : path.join(wikiRoot, ...XHS_OUTPUT_SEGMENTS);
}

function resolveXhsMediaTarget(
  outputDir: string,
  folder: "img" | "video",
  mediaUrl: string,
  postId: string,
  index: number,
): { absolutePath: string; storedPath: string } {
  const mediaDir = path.join(outputDir, folder);
  const extension = mediaExtension(mediaUrl, folder);
  const fileName = `${sanitizeFileName(postId) || "xhs"}-${index}${extension}`;
  const absolutePath = path.join(mediaDir, fileName);
  return {
    absolutePath,
    storedPath: path.posix.join(folder, fileName),
  };
}

function resolveDownloadedMediaPath(outputDir: string, storedPath: string): string | null {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(storedPath)) {
    return null;
  }
  const filePath = path.join(outputDir, ...storedPath.split("/"));
  return fs.existsSync(filePath) ? filePath : null;
}

function isRemoteStoredPath(storedPath: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(storedPath);
}

function toStoredPath(wikiRoot: string, absolutePath: string): string {
  const relative = path.relative(wikiRoot, absolutePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return path.normalize(absolutePath);
}

function resolveStoredPath(wikiRoot: string, storedPath: string): string {
  return path.isAbsolute(storedPath) ? storedPath : path.join(wikiRoot, ...storedPath.split("/"));
}

function titleFromBody(body?: string): string | undefined {
  return body?.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/^https?:\/\//i.test(line))?.slice(0, 80);
}

function firstSentence(value?: string): string {
  if (!value?.trim()) return "";
  return value
    .replace(/#([^#\s]+)\[话题\]#/g, "$1")
    .split(/[。！？!?]\s*/)
    .map((item) => item.trim())
    .find(Boolean)
    ?.slice(0, 80) ?? "";
}

function sliceChars(value: string, maxChars: number): string {
  return [...value].slice(0, maxChars).join("");
}

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, maxChars).join("")}...`;
}

function normalizeTask(value: Partial<XhsSyncTask>): XhsSyncTask | null {
  if (!value || typeof value.id !== "string" || !isXhsCommand(value.command)) return null;
  return {
    id: value.id,
    command: value.command,
    status: isXhsStatus(value.status) ? value.status : "partial",
    createdAt: value.createdAt ?? "",
    updatedAt: value.updatedAt ?? "",
    urls: Array.isArray(value.urls) ? value.urls.map(String) : [],
    keyword: value.keyword,
    path: value.path,
    error: value.error,
    total: numberField(value.total),
    completed: numberField(value.completed),
    failed: numberField(value.failed),
  };
}

function normalizeFailure(value: unknown): XhsSyncFailure | null {
  if (!isRecord(value) || !isXhsCommand(value.command)) return null;
  const id = stringField(value.id);
  const error = stringField(value.error);
  const createdAt = stringField(value.createdAt);
  if (!id || !error || !createdAt) return null;
  return {
    id,
    command: value.command,
    url: stringField(value.url),
    keyword: stringField(value.keyword),
    error,
    createdAt,
  };
}

function isXhsCommand(value: unknown): value is XhsCommand {
  return value === "xhs" || value === "xhs-batch";
}

function isXhsStatus(value: unknown): value is XhsSyncStatus {
  return value === "completed" || value === "partial" || value === "failed";
}

function stringField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatPostDate(value: unknown): string {
  const raw = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(raw) ? new Date(raw > 10_000_000_000 ? raw : raw * 1000) : new Date();
  return formatDate(date);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
