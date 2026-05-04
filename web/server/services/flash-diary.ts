/**
 * Flash-diary storage helpers.
 *
 * Owns raw diary file listing, diary page read/write, append operations,
 * failure persistence, and the small set of flash-diary-adjacent markdown
 * documents that live beside Memory in the wiki tree.
 */
import fs from "node:fs";
import path from "node:path";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { postJson } from "../../../src/utils/cloudflare-http.js";
import { readCloudflareRemoteBrainConfig } from "./cloudflare-remote-brain-config.js";
import { cleanupRemovedFlashDiaryMedia, findFirstFlashDiaryImageUrl } from "./flash-diary-media.js";

const DIARY_ROOT_SEGMENTS = ["raw", "\u95ea\u5ff5\u65e5\u8bb0"];
const FAILURE_FILE_NAME = "flash-diary-failures.json";
export const TWELVE_QUESTIONS_PATH = "wiki/journal-twelve-questions.md";
const TWELVE_QUESTIONS_TITLE = "十二个问题";
const TWELVE_QUESTIONS_DESCRIPTION = "你的固定追问清单";

interface FlashDiaryFileSummary {
  path: string;
  title: string;
  date: string;
  entryCount: number;
  modifiedAt: string;
  thumbnailUrl: string | null;
}

interface FlashDiaryDocumentSummary {
  kind: "document";
  title: string;
  path: string;
  description: string;
  exists: boolean;
  modifiedAt: string | null;
}

interface FlashDiaryFailureRecord {
  id: string;
  createdAt: string;
  targetDate: string;
  text: string;
  mediaFiles: string[];
  error: string;
  status: "failed";
}

interface AppendFlashDiaryEntryInput {
  text: string;
  mediaPaths: string[];
  now?: Date;
}

interface AppendFlashDiaryEntryResult {
  path: string;
  mediaFiles: string[];
  modifiedAt: string;
}

export async function listFlashDiaryFiles(wikiRoot: string): Promise<FlashDiaryFileSummary[]> {
  const diaryRoot = getDiaryRoot(wikiRoot);
  await mkdir(diaryRoot, { recursive: true });
  const entries = fs.readdirSync(diaryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => {
      const full = path.join(diaryRoot, entry.name);
      const raw = fs.readFileSync(full, "utf8");
      const stat = fs.statSync(full);
      return {
        path: toRelativeDiaryPath(entry.name),
        title: entry.name.replace(/\.md$/i, ""),
        date: entry.name.replace(/\.md$/i, ""),
        entryCount: countEntries(raw),
        modifiedAt: stat.mtime.toISOString(),
        thumbnailUrl: findFirstFlashDiaryImageUrl(toRelativeDiaryPath(entry.name), raw),
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));

  return entries;
}

export async function readFlashDiaryPage(wikiRoot: string, relativePath: string): Promise<{
  path: string;
  title: string;
  raw: string;
  modifiedAt: string;
  entryCount: number;
}> {
  const full = resolveDiaryPath(wikiRoot, relativePath);
  const raw = await readFile(full, "utf8");
  const stat = fs.statSync(full);
  return {
    path: normalizeRelativeDiaryPath(relativePath),
    title: path.basename(full, path.extname(full)),
    raw,
    modifiedAt: stat.mtime.toISOString(),
    entryCount: countEntries(raw),
  };
}

export async function readTwelveQuestionsSummary(wikiRoot: string): Promise<FlashDiaryDocumentSummary> {
  const cloud = await readCloudDocument(TWELVE_QUESTIONS_PATH);
  if (cloud) {
    return {
      kind: "document",
      title: TWELVE_QUESTIONS_TITLE,
      path: TWELVE_QUESTIONS_PATH,
      description: TWELVE_QUESTIONS_DESCRIPTION,
      exists: true,
      modifiedAt: cloud.updatedAt || null,
    };
  }
  const filePath = resolveTwelveQuestionsFilePath(wikiRoot);
  const exists = fs.existsSync(filePath);
  return {
    kind: "document",
    title: TWELVE_QUESTIONS_TITLE,
    path: TWELVE_QUESTIONS_PATH,
    description: TWELVE_QUESTIONS_DESCRIPTION,
    exists,
    modifiedAt: exists ? fs.statSync(filePath).mtime.toISOString() : null,
  };
}

export async function readTwelveQuestionsPage(wikiRoot: string): Promise<{
  path: string;
  title: string;
  raw: string;
  modifiedAt: string;
  entryCount: number;
}> {
  const cloud = await readCloudDocument(TWELVE_QUESTIONS_PATH);
  if (cloud) {
    return {
      path: TWELVE_QUESTIONS_PATH,
      title: TWELVE_QUESTIONS_TITLE,
      raw: cloud.raw,
      modifiedAt: cloud.updatedAt || new Date().toISOString(),
      entryCount: 0,
    };
  }
  const filePath = resolveTwelveQuestionsFilePath(wikiRoot);
  if (!fs.existsSync(filePath)) {
    throw new Error("twelve questions document not found");
  }
  const raw = await readFile(filePath, "utf8");
  const modifiedAt = fs.statSync(filePath).mtime.toISOString();
  return {
    path: TWELVE_QUESTIONS_PATH,
    title: TWELVE_QUESTIONS_TITLE,
    raw,
    modifiedAt,
    entryCount: 0,
  };
}

export async function saveFlashDiaryPage(wikiRoot: string, relativePath: string, raw: string): Promise<void> {
  if (normalizeWikiPath(relativePath) === TWELVE_QUESTIONS_PATH) {
    void wikiRoot;
    void raw;
    throw new Error("twelve questions document is read-only");
  }
  const full = resolveDiaryPath(wikiRoot, relativePath);
  const previousRaw = fs.existsSync(full)
    ? await readFile(full, "utf8")
    : "";
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, raw, "utf8");
  cleanupRemovedFlashDiaryMedia(wikiRoot, normalizeRelativeDiaryPath(relativePath), previousRaw, raw);
}

export async function saveTwelveQuestionsPage(wikiRoot: string, raw: string): Promise<void> {
  await saveCloudDocumentOrThrow(TWELVE_QUESTIONS_PATH, TWELVE_QUESTIONS_TITLE, raw);
  const filePath = resolveTwelveQuestionsFilePath(wikiRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, raw, "utf8");
}

interface CloudDocumentResponse {
  ok?: boolean;
  document?: {
    path?: string;
    title?: string;
    raw?: string;
    updatedAt?: string;
  };
}

async function readCloudDocument(documentPath: string): Promise<{ raw: string; updatedAt: string } | null> {
  const cfg = readCloudflareRemoteBrainConfig();
  if (!cfg.enabled || !cfg.workerUrl || !cfg.remoteToken) return null;
  const result = await postJson<CloudDocumentResponse>(
    new URL("mobile/documents/get", cfg.workerUrl).toString(),
    { path: documentPath },
    { Authorization: `Bearer ${cfg.remoteToken}` },
  );
  if (!result.ok || result.data.ok === false || !result.data.document) return null;
  return {
    raw: String(result.data.document.raw ?? ""),
    updatedAt: String(result.data.document.updatedAt ?? ""),
  };
}

export async function saveCloudDocument(documentPath: string, title: string, raw: string): Promise<void> {
  const cfg = readCloudflareRemoteBrainConfig();
  if (!cfg.enabled || !cfg.workerUrl || !cfg.remoteToken) return;
  await postJson<CloudDocumentResponse>(
    new URL("mobile/documents/save", cfg.workerUrl).toString(),
    { path: documentPath, title, raw },
    { Authorization: `Bearer ${cfg.remoteToken}` },
  );
}

async function saveCloudDocumentOrThrow(documentPath: string, title: string, raw: string): Promise<void> {
  const cfg = readCloudflareRemoteBrainConfig();
  if (!cfg.enabled || !cfg.workerUrl || !cfg.remoteToken) {
    throw new Error("cloud save failed: cloud document sync is not configured");
  }
  const result = await postJson<CloudDocumentResponse>(
    new URL("mobile/documents/save", cfg.workerUrl).toString(),
    { path: documentPath, title, raw },
    { Authorization: `Bearer ${cfg.remoteToken}` },
  );
  if (!result.ok || result.data.ok === false) {
    throw new Error(`cloud save failed: ${result.ok ? "save rejected" : result.error.message}`);
  }
}

export async function appendFlashDiaryEntry(
  wikiRoot: string,
  input: AppendFlashDiaryEntryInput,
): Promise<AppendFlashDiaryEntryResult> {
  const now = input.now ?? new Date();
  const date = formatDate(now);
  const time = formatTime(now);
  const diaryRoot = getDiaryRoot(wikiRoot);
  const diaryPath = path.join(diaryRoot, `${date}.md`);
  await mkdir(diaryRoot, { recursive: true });

  const mediaFiles = await copyDiaryMedia(wikiRoot, date, input.mediaPaths);
  const markdownBlock = renderDiaryEntryBlock(time, input.text, mediaFiles);

  const current = fs.existsSync(diaryPath)
    ? await readFile(diaryPath, "utf8")
    : `# ${date}\n\n`;
  const next = prependDiaryBlock(current, markdownBlock);
  await writeFile(diaryPath, next, "utf8");
  const stat = fs.statSync(diaryPath);

  return {
    path: toRelativeDiaryPath(`${date}.md`),
    mediaFiles,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function readFlashDiaryFailures(wikiRoot: string): FlashDiaryFailureRecord[] {
  const failurePath = getFailurePath(wikiRoot);
  if (!fs.existsSync(failurePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(failurePath, "utf8")) as FlashDiaryFailureRecord[];
  } catch {
    return [];
  }
}

export async function recordFlashDiaryFailure(
  wikiRoot: string,
  input: Omit<FlashDiaryFailureRecord, "id"> & { id?: string },
): Promise<FlashDiaryFailureRecord> {
  const failurePath = getFailurePath(wikiRoot);
  await mkdir(path.dirname(failurePath), { recursive: true });
  const failures = readFlashDiaryFailures(wikiRoot);
  const record: FlashDiaryFailureRecord = {
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt,
    targetDate: input.targetDate,
    text: input.text,
    mediaFiles: [...input.mediaFiles],
    error: input.error,
    status: "failed",
  };
  failures.unshift(record);
  await writeFile(failurePath, `${JSON.stringify(failures, null, 2)}\n`, "utf8");
  return record;
}

export async function removeFlashDiaryFailure(wikiRoot: string, id: string): Promise<void> {
  const failurePath = getFailurePath(wikiRoot);
  if (!fs.existsSync(failurePath)) return;
  const failures = readFlashDiaryFailures(wikiRoot).filter((item) => item.id !== id);
  await writeFile(failurePath, `${JSON.stringify(failures, null, 2)}\n`, "utf8");
}

function getDiaryRoot(wikiRoot: string): string {
  return path.join(wikiRoot, ...DIARY_ROOT_SEGMENTS);
}

function getFailurePath(wikiRoot: string): string {
  return path.join(wikiRoot, ".llmwiki", FAILURE_FILE_NAME);
}

function resolveDiaryPath(wikiRoot: string, relativePath: string): string {
  const normalized = normalizeRelativeDiaryPath(relativePath);
  const full = path.join(wikiRoot, normalized);
  const rel = path.relative(getDiaryRoot(wikiRoot), full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("flash diary path escapes diary root");
  }
  return full;
}

function normalizeRelativeDiaryPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.startsWith("raw/\u95ea\u5ff5\u65e5\u8bb0/")) return normalized;
  return `raw/\u95ea\u5ff5\u65e5\u8bb0/${normalized.replace(/^raw\/+/, "")}`;
}

function normalizeWikiPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function toRelativeDiaryPath(fileName: string): string {
  return `raw/\u95ea\u5ff5\u65e5\u8bb0/${fileName.replace(/\\/g, "/")}`;
}

function resolveTwelveQuestionsFilePath(wikiRoot: string): string {
  return path.join(wikiRoot, ...TWELVE_QUESTIONS_PATH.split("/"));
}

function countEntries(raw: string): number {
  return [...raw.matchAll(/^##\s+\d{2}:\d{2}:\d{2}$/gm)].length;
}

function renderDiaryEntryBlock(time: string, text: string, mediaFiles: string[]): string {
  const body = text.trim();
  const lines = [`## ${time}`, "", body];
  for (const media of mediaFiles) {
    const relative = media.replace(/^raw\/\u95ea\u5ff5\u65e5\u8bb0\//, "./");
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(media)) {
      lines.push("", `![](${relative})`);
      continue;
    }
    lines.push("", `[\u9644\u4ef6\uff1a${path.basename(media)}](${relative})`);
  }
  lines.push("", "---", "");
  return lines.join("\n");
}

function prependDiaryBlock(current: string, block: string): string {
  const headingMatch = current.match(/^# .+\r?\n\r?\n/);
  if (!headingMatch) {
    return `${block}${current}`;
  }
  const heading = headingMatch[0];
  const rest = current.slice(heading.length).trimStart();
  return `${heading}${block}${rest ? `${rest}\n` : ""}`;
}

async function copyDiaryMedia(wikiRoot: string, date: string, mediaPaths: string[]): Promise<string[]> {
  const copied: string[] = [];
  if (mediaPaths.length === 0) return copied;
  const assetDir = path.join(getDiaryRoot(wikiRoot), "assets", date);
  await mkdir(assetDir, { recursive: true });
  for (const source of mediaPaths) {
    const fileName = await allocateMediaName(assetDir, path.basename(source));
    const target = path.join(assetDir, fileName);
    await copyFile(source, target);
    copied.push(`raw/\u95ea\u5ff5\u65e5\u8bb0/assets/${date}/${fileName}`);
  }
  return copied;
}

async function allocateMediaName(dir: string, preferredName: string): Promise<string> {
  const parsed = path.parse(preferredName);
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = `${parsed.name}${suffix}${parsed.ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
    index += 1;
  }
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
