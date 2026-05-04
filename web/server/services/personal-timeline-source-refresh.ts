/**
 * Tracks personal-timeline source refreshes by hashing source file contents.
 *
 * The personal timeline needs to know whether a source channel has new facts
 * without relying on file counts or names. This service resolves configured
 * source entries, hashes every Markdown file's content, persists the last
 * handled digest, and records refresh failures for the review page.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { ServerConfig } from "../config.js";
import { extractMarkdownHeadingAnchors, type MarkdownHeadingAnchor } from "../render/heading-anchors.js";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";
import { appendPendingTimelineFacts } from "./personal-timeline-pending-facts.js";

const STATE_FILE_NAME = "personal-timeline-source-state.json";
const FAILURE_FILE_NAME = "personal-timeline-source-failures.json";
const INCREMENT_FILE_NAME = "personal-timeline-source-increments.json";

interface PersonalTimelineSourceFailureRecord {
  id: string;
  label: string;
  entries: string[];
  error: string;
  createdAt: string;
  status: "failed";
}

interface RefreshPersonalTimelineSourceInput {
  label: string;
  entries: string[];
}

interface RefreshPersonalTimelineSourceResult {
  status: "missing-entry" | "no-increment" | "written";
  message: string;
  changedFiles: number;
  digest?: string;
  changedRows?: number;
}

interface SourceState {
  sources?: Record<string, string>;
}

interface SourceSnapshot {
  digest: string;
  files: string[];
  headingAnchors: MarkdownHeadingAnchor[];
}

export async function refreshPersonalTimelineSource(
  cfg: ServerConfig,
  input: RefreshPersonalTimelineSourceInput,
): Promise<RefreshPersonalTimelineSourceResult> {
  const entries = input.entries.map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return missingEntryResult();
  const snapshot = readSourceSnapshot(cfg, entries);
  const key = sourceStateKey(input.label, entries);
  const state = readSourceState(cfg.runtimeRoot);
  if (state.sources?.[key] === snapshot.digest) {
    const changedRows = await appendPendingTimelineFacts(cfg, input.label, snapshot);
    return changedRows > 0 ? timelineBackfillResult(snapshot, changedRows) : noIncrementResult(snapshot);
  }
  await writeSourceState(cfg.runtimeRoot, { ...state.sources, [key]: snapshot.digest });
  await appendIncrementRecord(cfg.runtimeRoot, input.label, entries, snapshot);
  const changedRows = await appendPendingTimelineFacts(cfg, input.label, snapshot);
  return changedRows > 0 ? timelineWrittenResult(snapshot, changedRows) : writtenResult(snapshot);
}

export function readPersonalTimelineSourceFailures(runtimeRoot: string): PersonalTimelineSourceFailureRecord[] {
  const failurePath = sourceFailurePath(runtimeRoot);
  if (!fs.existsSync(failurePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(failurePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isFailureRecord) : [];
  } catch {
    return [];
  }
}

export async function recordPersonalTimelineSourceFailure(
  runtimeRoot: string,
  input: Omit<PersonalTimelineSourceFailureRecord, "id" | "status">,
): Promise<PersonalTimelineSourceFailureRecord> {
  const failurePath = sourceFailurePath(runtimeRoot);
  await mkdir(path.dirname(failurePath), { recursive: true });
  const record: PersonalTimelineSourceFailureRecord = { ...input, id: randomUUID(), status: "failed" };
  const failures = [record, ...readPersonalTimelineSourceFailures(runtimeRoot)];
  await writeFile(failurePath, `${JSON.stringify(failures, null, 2)}\n`, "utf8");
  return record;
}

function readSourceSnapshot(cfg: ServerConfig, entries: string[]): SourceSnapshot {
  const files = entries.flatMap((entry) => resolveEntryFiles(cfg, entry)).sort();
  if (files.length === 0) throw new Error("输入来源路径下没有可读取的 Markdown 文件。");
  return {
    files: files.map((file) => displayPath(cfg, file)),
    digest: hashFiles(files),
    headingAnchors: collectHeadingAnchors(cfg, files),
  };
}

function resolveEntryFiles(cfg: ServerConfig, entry: string): string[] {
  const fullPath = resolveEntryPath(cfg, entry);
  if (!fs.existsSync(fullPath)) throw new Error(`输入来源路径不存在：${entry}`);
  if (fs.statSync(fullPath).isFile()) return [fullPath];
  return listMarkdownFilesRecursive(fullPath, { ignoreMissing: false, skipHidden: true });
}

function resolveEntryPath(cfg: ServerConfig, entry: string): string {
  if (entry === "#/flash-diary") return path.join(cfg.sourceVaultRoot, "raw", "闪念日记");
  const cleanEntry = entry.replace(/^#\/wiki\//, "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (path.isAbsolute(cleanEntry)) return assertInsideKnownRoot(cfg, cleanEntry);
  return assertInsideKnownRoot(cfg, path.join(cfg.sourceVaultRoot, cleanEntry));
}

function assertInsideKnownRoot(cfg: ServerConfig, target: string): string {
  const resolved = path.resolve(target);
  const roots = [cfg.sourceVaultRoot, cfg.runtimeRoot, cfg.projectRoot].map((root) => path.resolve(root));
  if (!roots.some((root) => isPathInside(resolved, root))) throw new Error(`输入来源路径不在允许目录内：${target}`);
  return resolved;
}

function isPathInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashFiles(files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readSourceState(runtimeRoot: string): SourceState {
  const statePath = sourceStatePath(runtimeRoot);
  if (!fs.existsSync(statePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as SourceState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSourceState(runtimeRoot: string, sources: Record<string, string>): Promise<void> {
  const statePath = sourceStatePath(runtimeRoot);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify({ sources }, null, 2)}\n`, "utf8");
}

async function appendIncrementRecord(
  runtimeRoot: string,
  label: string,
  entries: string[],
  snapshot: SourceSnapshot,
): Promise<void> {
  const incrementPath = path.join(runtimeRoot, ".llmwiki", INCREMENT_FILE_NAME);
  await mkdir(path.dirname(incrementPath), { recursive: true });
  const records = readJsonArray(incrementPath);
  records.unshift({
    label,
    entries,
    digest: snapshot.digest,
    files: snapshot.files,
    headingAnchors: snapshot.headingAnchors,
    writtenAt: new Date().toISOString(),
  });
  await writeFile(incrementPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function collectHeadingAnchors(cfg: ServerConfig, files: string[]): MarkdownHeadingAnchor[] {
  return files.flatMap((file) => extractMarkdownHeadingAnchors(displayPath(cfg, file), fs.readFileSync(file, "utf8")));
}

function findPendingTimelineSeparator(lines: string[]): number {
  const headingIndex = lines.findIndex((line) => line.trim() === PENDING_TIMELINE_HEADING);
  if (headingIndex === -1) return -1;
  return lines.findIndex((line, index) => index > headingIndex && isMarkdownTableSeparator(line));
}

function findNextMarkdownHeading(lines: string[], start: number): number {
  const index = lines.findIndex((line, lineIndex) => lineIndex > start && /^##\s+/u.test(line.trim()));
  return index === -1 ? lines.length : index;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line.trim());
}

function shouldRemovePendingTimelineRow(line: string): boolean {
  return isPendingTimelinePlaceholder(line) || isAttachmentTimelineRow(line);
}

function readJsonArray(filePath: string): unknown[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sourceStateKey(label: string, entries: string[]): string {
  return `${label}::${entries.join("|")}`;
}

function displayPath(cfg: ServerConfig, file: string): string {
  const relative = path.relative(cfg.sourceVaultRoot, file);
  return relative.startsWith("..") ? file.replace(/\\/g, "/") : relative.replace(/\\/g, "/");
}

function sourceStatePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, ".llmwiki", STATE_FILE_NAME);
}

function sourceFailurePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, ".llmwiki", FAILURE_FILE_NAME);
}

function missingEntryResult(): RefreshPersonalTimelineSourceResult {
  return { status: "missing-entry", message: "没有对应路径", changedFiles: 0 };
}

function noIncrementResult(snapshot: SourceSnapshot): RefreshPersonalTimelineSourceResult {
  return { status: "no-increment", message: "暂无更多增量", changedFiles: 0, digest: snapshot.digest };
}

function writtenResult(snapshot: SourceSnapshot): RefreshPersonalTimelineSourceResult {
  return { status: "written", message: "已记录新增内容，等待写入时间线事实", changedFiles: snapshot.files.length, digest: snapshot.digest };
}

function timelineWrittenResult(snapshot: SourceSnapshot, changedRows: number): RefreshPersonalTimelineSourceResult {
  return {
    status: "written",
    message: "已写入待确认时间线事实",
    changedFiles: snapshot.files.length,
    digest: snapshot.digest,
    changedRows,
  };
}

function timelineBackfillResult(snapshot: SourceSnapshot, changedRows: number): RefreshPersonalTimelineSourceResult {
  return {
    status: "written",
    message: "已补写待确认时间线事实",
    changedFiles: 0,
    digest: snapshot.digest,
    changedRows,
  };
}

function isFailureRecord(value: unknown): value is PersonalTimelineSourceFailureRecord {
  return Boolean(value && typeof value === "object" && "id" in value && "error" in value && "createdAt" in value);
}
