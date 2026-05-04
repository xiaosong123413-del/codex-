/**
 * Page, raw markdown, and workspace-document routes for the WebUI.
 *
 * This module also decorates rendered wiki pages with chat evidence links and
 * updates claim retention metadata when concept/procedure pages are viewed.
 */

import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { createRenderer, findPage } from "../render/markdown.js";
import { buildAndSaveSearchIndex } from "../services/search-index-builder.js";
import {
  resolveContentPath,
  resolveEditableSourceMarkdownPath,
  resolveRuntimeWikiLogicalPath,
  runtimePath,
  sourcePath,
  toLogicalPath,
} from "../runtime-paths.js";
import { deleteWorkspaceEntry, listPendingWorkItems, listWorkspaceEntries } from "../services/project-workspace.js";
import {
  readTaskPlanState,
  writeTaskPlanState,
  type TaskPlanPoolItem,
  type TaskPlanPriority,
  type TaskPlanState,
} from "../services/task-plan-store.js";
import {
  readToolboxPageData,
  updateToolboxAssetBadge,
  updateToolboxAssetFromWorkspace,
  updateToolboxWorkflowFromWorkspace,
  type ToolboxAssetRecord,
} from "./toolbox.js";

interface ClaimRecord {
  id: string;
  conceptSlug: string;
  status: "active" | "contested" | "superseded" | "stale";
  retention: number;
  lastAccessedAt?: string;
}

interface ProcedureRecord {
  id: string;
  supportingClaimIds: string[];
}

type WorkspaceDocKind = "root" | "domain" | "project" | "work-log";

const EXECUTION_SECTION = "00-执行现场";
const PROJECT_WORKSPACE_SECTION = "01-项目工作区";
const DEPOSIT_LIBRARY_SECTION = "02-沉淀库";
const ARCHIVE_SECTION = "03-归档";
const CASE_LIBRARY_SECTION = "01-案例库";
const METHOD_LIBRARY_SECTION = "02-方法库";
const TOOLBOX_LIBRARY_SECTION = "03-工具箱";
const ARCHIVE_FAILED_METHODS_PROJECT = "失败的方法";
const ARCHIVE_COMPLETED_PROJECT = "已完成领域、项目、任务";
const EXECUTION_PAGES = ["今日行动", "待绑定任务", "待归档记录", "已归档记录", "Workflow Event"] as const;
const LIBRARY_STATUS_PAGES = ["已验证但成功", "待验证", "已验证但失败"] as const;
type LibraryStatus = typeof LIBRARY_STATUS_PAGES[number];
type WorkspaceGalleryType = "case" | "method" | "tool";

interface WorkspaceDocGalleryMeta {
  type: WorkspaceGalleryType;
  status: LibraryStatus | null;
}

export interface WorkspaceDocRecord {
  id: string;
  kind: WorkspaceDocKind;
  label: string;
  path: string;
  title: string | null;
  frontmatter: Record<string, unknown> | null;
  aliases: string[];
  html: string;
  raw: string;
  sizeBytes: number;
  modifiedAt: string | null;
  sourceEditable: boolean;
  domain: string | null;
  project: string | null;
  contentLoaded?: boolean;
  treeHidden?: boolean;
  gallery?: WorkspaceDocGalleryMeta;
}

interface WorkspaceDocInput {
  id: string;
  kind: WorkspaceDocKind;
  label: string;
  relPath: string;
  domain: string | null;
  project: string | null;
  virtualRaw?: string;
  treeHidden?: boolean;
  gallery?: WorkspaceDocGalleryMeta;
}

interface WorkspaceGalleryStatusMoveResult {
  previousPath: string;
  path: string;
  status: LibraryStatus;
}

interface CachedPagePayload {
  sourceSizeBytes: number;
  sourceMtimeMs: number;
    response: {
      path: string;
      title: string | null;
      frontmatter: Record<string, unknown> | null;
      html: string;
      raw: string;
      sizeBytes: number;
      modifiedAt: string;
      aliases: string[];
      sourceEditable: boolean;
    };
}

interface ChatMessageEntry {
  timestamp: string;
  speaker: string;
  text: string;
  occurrence: number;
  anchor: string;
}

const PAGE_RENDER_CACHE_LIMIT = 24;
const pageRenderCache = new Map<string, CachedPagePayload>();

export function clearPageRenderCacheForPath(fullPath: string): void {
  pageRenderCache.delete(fullPath);
}

interface PagePayload {
  path: string;
  title: string | null;
  frontmatter: Record<string, unknown> | null;
  html: string;
  raw: string;
  sizeBytes: number;
  modifiedAt: string;
  aliases: string[];
  sourceEditable: boolean;
}

type PageResponsePayload = Omit<PagePayload, "raw"> & {
  raw?: string;
};

export function handlePage(cfg: ServerConfig) {
  const renderer = createRenderer({
    wikilinkResolver: (target) => {
      const resolved = resolveTargetPath(cfg, target);
      if (resolved) {
        return {
          href: `/?page=${encodeURIComponent(resolved.logicalPath)}`,
          exists: true,
        };
      }
      return {
        href: `/?page=${encodeURIComponent(target)}`,
        exists: false,
      };
    },
  });

  return (req: Request, res: Response) => {
    const relRaw = (req.query.path as string | undefined) ?? "";
    const rel = safeRel(relRaw);
    if (!rel) {
      res.status(400).json({ error: "missing or invalid `path` query" });
      return;
    }
    const payload = readPagePayload(cfg, rel, renderer);
    if (!payload) {
      res.status(404).json({ error: "file not found", path: rel });
      return;
    }
    const logicalPath = payload.path;
    res.json(toPageResponsePayload(payload, shouldIncludeRaw(req)));
    scheduleClaimTouch(cfg.runtimeRoot, logicalPath);
  };
}

function shouldIncludeRaw(req: Request): boolean {
  const raw = req.query.raw;
  return raw !== "0" && raw !== "false";
}

function toPageResponsePayload(payload: PagePayload, includeRaw: boolean): PageResponsePayload {
  if (includeRaw) {
    return payload;
  }
  const { raw: _raw, ...withoutRaw } = payload;
  return withoutRaw;
}

function scheduleClaimTouch(wikiRoot: string, relPath: string): void {
  const timeout = setTimeout(() => {
    touchClaimsForPage(wikiRoot, relPath);
  }, 0);
  if (typeof timeout === "object" && "unref" in timeout) {
    timeout.unref();
  }
}

export function readPagePayload(
  cfg: ServerConfig,
  logicalPath: string,
  renderer = createRenderer({
    wikilinkResolver: (target) => {
      const resolved = resolveTargetPath(cfg, target);
      if (resolved) {
        return {
          href: `/?page=${encodeURIComponent(resolved.logicalPath)}`,
          exists: true,
        };
      }
      return {
        href: `/?page=${encodeURIComponent(target)}`,
        exists: false,
      };
    },
  }),
): PagePayload | null {
  const rel = safeRel(logicalPath);
  if (!rel) {
    return null;
  }

  let full = resolveContentPath(cfg, rel);
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    full = path.join(full, "index.md");
  }

  if (!/\.(md|markdown|txt)$/i.test(full)) {
    full += ".md";
  }

  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return null;
  }

  const normalizedPath = toLogicalPath(cfg, full);
  if (!normalizedPath) {
    return null;
  }

  const stat = fs.statSync(full);
  return readOrRenderPage(cfg, normalizedPath, full, stat, renderer);
}

function readOrRenderPage(
  cfg: ServerConfig,
  normalizedPath: string,
  fullPath: string,
  stat: fs.Stats,
  renderer: ReturnType<typeof createRenderer>,
): PagePayload {
  const cached = pageRenderCache.get(fullPath);
  if (cached && cached.sourceMtimeMs === stat.mtimeMs && cached.sourceSizeBytes === stat.size) {
    return cached.response;
  }

  const rawMarkdown = fs.readFileSync(fullPath, "utf-8");
  const rendered = renderer.render(rawMarkdown);
  const response = {
    path: normalizedPath,
    title: rendered.title,
    frontmatter: rendered.frontmatter,
    html: decorateWikiHtml(cfg, normalizedPath, rawMarkdown, rendered.html),
    raw: rendered.rawMarkdown,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    aliases: normalizeAliases(rendered.frontmatter),
    sourceEditable: Boolean(resolveEditableSourceMarkdownPath(cfg, normalizedPath)),
  };
  writePageRenderCache(fullPath, {
    sourceMtimeMs: stat.mtimeMs,
    sourceSizeBytes: stat.size,
    response,
  });
  return response;
}

function writePageRenderCache(fullPath: string, payload: CachedPagePayload): void {
  pageRenderCache.delete(fullPath);
  pageRenderCache.set(fullPath, payload);
  while (pageRenderCache.size > PAGE_RENDER_CACHE_LIMIT) {
    const oldestKey = pageRenderCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    pageRenderCache.delete(oldestKey);
  }
}

const CHAT_RECORD_WIKILINK_RE = /\[\[([^\]|#\n]*聊天记录\/[^\]|#\n]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/u;
const EVIDENCE_TIMESTAMP_RE = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]/g;
const CHAT_MESSAGE_ITEM_RE = /<li([^>]*)>\s*<code>(\d{4}-\d{2}-\d{2} \d{2}:\d{2})<\/code>/g;
const CHAT_MESSAGE_ITEM_BRACKET_RE = /<li([^>]*)>\s*\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]/g;
const CHAT_MESSAGE_MARKDOWN_RE = /^\s*[-*+]\s+`(\d{4}-\d{2}-\d{2} \d{2}:\d{2})`\s+\*\*(.+?)\*\*[：:]\s*(.+)$/gmu;
const CHAT_MESSAGE_MARKDOWN_BRACKET_RE = /^\s*[-*+]\s+\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s+(?:\*\*(.+?)\*\*[：:]|([^：:\n]+)[：:])\s*(.+)$/gmu;
const EVIDENCE_LINE_TIMESTAMP_RE = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]/g;

function decorateWikiHtml(cfg: ServerConfig, relPath: string, rawMarkdown: string, html: string): string {
  let nextHtml = html;

  if (relPath.startsWith("wiki/聊天记录/")) {
    const timestampOccurrences = new Map<string, number>();
    nextHtml = nextHtml.replace(CHAT_MESSAGE_ITEM_RE, (match, attrs: string, timestamp: string) => {
      if (/\sid=/.test(attrs)) {
        return match;
      }
      const occurrence = (timestampOccurrences.get(timestamp) ?? 0) + 1;
      timestampOccurrences.set(timestamp, occurrence);
      return `<li${attrs} id="${buildChatMessageAnchor(timestamp, occurrence)}"><code>${timestamp}</code>`;
    });
    nextHtml = nextHtml.replace(CHAT_MESSAGE_ITEM_BRACKET_RE, (match, attrs: string, timestamp: string) => {
      if (/\sid=/.test(attrs)) {
        return match;
      }
      const occurrence = (timestampOccurrences.get(timestamp) ?? 0) + 1;
      timestampOccurrences.set(timestamp, occurrence);
      return `<li${attrs} id="${buildChatMessageAnchor(timestamp, occurrence)}">[${timestamp}]`;
    });
  }

  const chatRecord = resolveTargetPath(cfg, extractChatRecordTarget(rawMarkdown));
  if (!chatRecord) {
    return nextHtml;
  }

  const chatEntries = readChatMessageEntries(chatRecord.fullPath);
  const evidenceAnchors = collectEvidenceAnchors(rawMarkdown, chatEntries);
  let evidenceIndex = 0;
  return nextHtml.replace(EVIDENCE_TIMESTAMP_RE, (_match, timestamp: string) => {
    const anchor = evidenceAnchors[evidenceIndex] ?? buildChatMessageAnchor(timestamp, 1);
    evidenceIndex += 1;
    return `<a href="${buildWikiHashHref(chatRecord.logicalPath, anchor)}" class="wiki-evidence-timestamp" data-chat-message-anchor="${anchor}">[${timestamp}]</a>`;
  });
}

function extractChatRecordTarget(rawMarkdown: string): string {
  const match = CHAT_RECORD_WIKILINK_RE.exec(rawMarkdown);
  return match?.[1]?.trim() ?? "";
}

function readChatMessageEntries(chatFullPath: string): ChatMessageEntry[] {
  if (!fs.existsSync(chatFullPath) || !fs.statSync(chatFullPath).isFile()) {
    return [];
  }
  const chatRawMarkdown = fs.readFileSync(chatFullPath, "utf-8");
  const entries: ChatMessageEntry[] = [];
  const occurrences = new Map<string, number>();
  appendChatMessageEntries(entries, occurrences, chatRawMarkdown.matchAll(CHAT_MESSAGE_MARKDOWN_RE), (match) => ({
    timestamp: match[1] ?? "",
    speaker: match[2] ?? "",
    text: match[3] ?? "",
  }));
  appendChatMessageEntries(entries, occurrences, chatRawMarkdown.matchAll(CHAT_MESSAGE_MARKDOWN_BRACKET_RE), (match) => ({
    timestamp: match[1] ?? "",
    speaker: (match[2] ?? match[3]) ?? "",
    text: match[4] ?? "",
  }));
  entries.sort((a, b) => {
    const cmp = a.timestamp.localeCompare(b.timestamp);
    return cmp !== 0 ? cmp : a.occurrence - b.occurrence;
  });
  return entries;
}

function collectEvidenceAnchors(rawMarkdown: string, chatEntries: readonly ChatMessageEntry[]): string[] {
  const anchors: string[] = [];
  const lines = rawMarkdown.split(/\r?\n/);
  for (const line of lines) {
    for (const match of collectEvidenceTimestampMatches(line)) {
      anchors.push(resolveEvidenceAnchor(chatEntries, match.timestamp, match.snippet));
    }
  }
  return anchors;
}

function resolveEvidenceAnchor(
  chatEntries: readonly ChatMessageEntry[],
  timestamp: string,
  snippet: string,
): string {
  const matches = chatEntries.filter((entry) => entry.timestamp === timestamp);
  if (matches.length === 0) {
    return buildChatMessageAnchor(timestamp, 1);
  }
  const parsedSnippet = parseEvidenceSnippet(snippet);
  if (!parsedSnippet) {
    return matches[0].anchor;
  }

  const exactSpeakerAndText = matches.find((entry) =>
    parsedSnippet.speaker !== null
      && normalizeComparable(entry.speaker) === parsedSnippet.speaker
      && normalizeComparable(entry.text).startsWith(parsedSnippet.text),
  );
  if (exactSpeakerAndText) {
    return exactSpeakerAndText.anchor;
  }

  const exactText = matches.find((entry) => normalizeComparable(entry.text).startsWith(parsedSnippet.text));
  if (exactText) {
    return exactText.anchor;
  }

  return matches[0].anchor;
}

function parseEvidenceSnippet(snippet: string): { speaker: string | null; text: string } | null {
  const normalizedSnippet = snippet
    .replace(/^[：:;；，,\s-]+/u, "")
    .trim();
  if (!normalizedSnippet) {
    return null;
  }
  const speakerMatch = /^([^:：]+)[:：]\s*(.+)$/u.exec(normalizedSnippet);
  if (speakerMatch) {
    return {
      speaker: normalizeComparable(speakerMatch[1] ?? ""),
      text: normalizeComparable(speakerMatch[2] ?? ""),
    };
  }
  return {
    speaker: null,
    text: normalizeComparable(normalizedSnippet),
  };
}

function normalizeComparable(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[：]/g, ":")
    .trim()
    .toLowerCase();
}

function buildChatMessageAnchor(timestamp: string, occurrence: number): string {
  const base = `msg-${timestamp.replace(/[:\s]/g, "-")}`;
  return occurrence > 1 ? `${base}-${occurrence}` : base;
}

function buildWikiHashHref(pagePath: string, anchor: string): string {
  return `#/wiki/${encodeURIComponent(pagePath)}#${encodeURIComponent(anchor)}`;
}

function touchClaimsForPage(wikiRoot: string, relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/");
  const claimsPath = path.join(wikiRoot, ".llmwiki", "claims.json");
  if (!fs.existsSync(claimsPath)) return;

  const touchedClaimIds = resolveTouchedClaimIds(wikiRoot, normalized);
  if (touchedClaimIds.size === 0) return;

  let claims: ClaimRecord[];
  try {
    claims = JSON.parse(fs.readFileSync(claimsPath, "utf-8")) as ClaimRecord[];
  } catch {
    return;
  }

  const now = new Date().toISOString();
  let changed = false;
  for (const claim of claims) {
    if (!touchedClaimIds.has(claim.id)) continue;
    claim.lastAccessedAt = now;
    claim.retention = 1;
    if (claim.status === "stale") {
      claim.status = "active";
    }
    changed = true;
  }

  if (!changed) return;
  fs.writeFileSync(claimsPath, `${JSON.stringify(claims, null, 2)}\n`, "utf-8");
}

function resolveTouchedClaimIds(wikiRoot: string, relPath: string): Set<string> {
  if (isConceptPagePath(relPath)) {
    return readConceptClaimIds(wikiRoot, relPath);
  }
  if (isProcedurePagePath(relPath)) {
    return readProcedureClaimIds(wikiRoot, relPath);
  }
  return new Set<string>();
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function appendChatMessageEntries(
  entries: ChatMessageEntry[],
  occurrences: Map<string, number>,
  matches: Iterable<RegExpMatchArray>,
  readEntry: (match: RegExpMatchArray) => { timestamp: string; speaker: string; text: string },
): void {
  for (const match of matches) {
    const parsed = readEntry(match);
    const timestamp = parsed.timestamp.trim();
    if (!timestamp) {
      continue;
    }
    const occurrence = (occurrences.get(timestamp) ?? 0) + 1;
    occurrences.set(timestamp, occurrence);
    entries.push({
      timestamp,
      speaker: parsed.speaker.trim(),
      text: parsed.text.trim(),
      occurrence,
      anchor: buildChatMessageAnchor(timestamp, occurrence),
    });
  }
}

function collectEvidenceTimestampMatches(
  line: string,
): Array<{ timestamp: string; snippet: string }> {
  const matches = Array.from(line.matchAll(EVIDENCE_LINE_TIMESTAMP_RE));
  const results: Array<{ timestamp: string; snippet: string }> = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const timestamp = match[1]?.trim() ?? "";
    if (!timestamp) {
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length
      ? matches[index + 1]?.index ?? line.length
      : line.length;
    results.push({
      timestamp,
      snippet: line.slice(start, end).trim(),
    });
  }
  return results;
}

function isConceptPagePath(relPath: string): boolean {
  return relPath.startsWith("wiki/concepts/");
}

function isProcedurePagePath(relPath: string): boolean {
  return relPath.startsWith("wiki/procedures/");
}

function readConceptClaimIds(wikiRoot: string, relPath: string): Set<string> {
  const slug = relPath.replace(/^wiki\/concepts\//, "").replace(/\.md$/i, "");
  const claims = readJsonFile<ClaimRecord[]>(path.join(wikiRoot, ".llmwiki", "claims.json"), []);
  return new Set(claims.filter((claim) => claim.conceptSlug === slug).map((claim) => claim.id));
}

function readProcedureClaimIds(wikiRoot: string, relPath: string): Set<string> {
  const procedureId = relPath.replace(/^wiki\/procedures\//, "").replace(/\.md$/i, "");
  const procedures = readJsonFile<ProcedureRecord[]>(path.join(wikiRoot, ".llmwiki", "procedures.json"), []);
  const procedure = procedures.find((item) => item.id === procedureId);
  return new Set(procedure?.supportingClaimIds ?? []);
}

export function handleRaw(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const relRaw = (req.query.path as string | undefined) ?? "";
    const rel = safeRel(relRaw);
    if (!rel) {
      res.status(400).send("bad path");
      return;
    }
    const full = resolveContentPath(cfg, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.status(404).send("not found");
      return;
    }
    res.type("text/markdown").send(fs.readFileSync(full));
  };
}

export function handleActivityLog(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    const preferred = sourcePath(cfg, "log.md");
    const fallback = path.join(cfg.projectRoot, "log.md");
    const selected = fs.existsSync(preferred) ? preferred : fallback;

    if (!fs.existsSync(selected) || !fs.statSync(selected).isFile()) {
      res.json({
        path: selected,
        content: "",
      });
      return;
    }

    res.json({
      path: selected,
      content: fs.readFileSync(selected, "utf-8"),
    });
  };
}

export function handleProjectLog(cfg: ServerConfig) {
  const renderer = createRenderer({
    pageLookupRoot: cfg.projectRoot,
    headingPermalinks: false,
  });

  return (_req: Request, res: Response) => {
    const full = path.join(cfg.projectRoot, "docs", "project-log.md");
    const relFromRoot = path.relative(cfg.projectRoot, full);

    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.json({
        success: true,
        data: {
          path: relFromRoot.split(path.sep).join("/"),
          html: "<p>Project log has not been created yet.</p>",
          raw: "",
          modifiedAt: null,
        },
      });
      return;
    }

    const raw = fs.readFileSync(full, "utf-8");
    const rendered = renderer.render(raw);
    const stat = fs.statSync(full);
    res.json({
      success: true,
      data: {
        path: relFromRoot.split(path.sep).join("/"),
        html: rendered.html,
        raw,
        modifiedAt: stat.mtime.toISOString(),
      },
    });
  };
}

export function handleProjectWorkspace(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: {
          groups: listWorkspaceEntries(cfg.projectRoot),
          pending: listPendingWorkItems(cfg.projectRoot),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export function handleProjectWorkspaceDelete(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const relPath = typeof req.body?.path === "string" ? req.body.path : "";
    if (!relPath) {
      res.status(400).json({ success: false, error: "missing workspace path" });
      return;
    }

    try {
      deleteWorkspaceEntry(cfg.projectRoot, relPath);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export function handleWorkspaceDocs(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      ensureWorkspaceDocScaffold(cfg.sourceVaultRoot);
      const requestedPath = readWorkspaceDocPathQuery(req);
      if (requestedPath) {
        const document = await readWorkspaceDocByPath(cfg, requestedPath);
        if (!document) {
          res.status(404).json({ success: false, error: "workspace document not found" });
          return;
        }
        res.json({ success: true, data: { document } });
        return;
      }

      const treeOnly = req.query?.mode === "tree";
      if (!treeOnly) {
        buildAndSaveSearchIndex(cfg);
      }
      const documents = treeOnly ? await listWorkspaceDocSummaries(cfg) : await listWorkspaceDocs(cfg);
      res.json({
        success: true,
        data: {
          documents,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function readWorkspaceDocPathQuery(req: Request): string | null {
  const rawPath = typeof req.query?.path === "string" ? req.query.path.trim() : "";
  if (!rawPath) {
    return null;
  }
  return safeWorkspaceDocPath(rawPath);
}

export function handleWorkspaceDocsSave(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    return saveWorkspaceDocsRequest(cfg, req, res).catch((error: unknown) => {
      sendWorkspaceDocsSaveError(res, error);
    });
  };
}

export function handleWorkspaceDocsStatusMove(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    try {
      const relativePath = safeWorkspaceDocPath(String(req.body?.path ?? "").trim());
      const status = readLibraryStatus(String(req.body?.status ?? "").trim());
      if (!relativePath || !status) {
        res.status(400).json({ success: false, error: "invalid workspace gallery status move" });
        return;
      }
      res.json({ success: true, data: moveWorkspaceGalleryStatus(cfg, relativePath, status) });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

async function saveWorkspaceDocsRequest(cfg: ServerConfig, req: Request, res: Response): Promise<void> {
  const rawPath = String(req.body?.path ?? "").trim();
  const raw = String(req.body?.raw ?? "");
  const relativePath = safeWorkspaceDocPath(rawPath);
  if (!relativePath) {
    res.status(400).json({ success: false, error: "invalid workspace document path" });
    return;
  }

  await saveWorkspaceDocumentRaw(cfg, relativePath, raw);
  res.json({ success: true });
}

async function saveWorkspaceDocumentRaw(cfg: ServerConfig, relativePath: string, raw: string): Promise<void> {
  if (await saveVirtualWorkspaceDocument(cfg, relativePath, raw)) {
    return;
  }
  saveSourceWorkspaceDocument(cfg, relativePath, raw);
}

function saveSourceWorkspaceDocument(cfg: ServerConfig, relativePath: string, raw: string): void {
  const fullPath = sourcePath(cfg, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, raw.endsWith("\n") ? raw : `${raw}\n`, "utf-8");
  clearPageRenderCacheForPath(fullPath);
  buildAndSaveSearchIndex(cfg);
}

function moveWorkspaceGalleryStatus(
  cfg: ServerConfig,
  relativePath: string,
  status: LibraryStatus,
): WorkspaceGalleryStatusMoveResult {
  return moveMethodLibraryStatus(cfg, relativePath, status)
    ?? moveToolboxLibraryStatus(cfg, relativePath, status)
    ?? throwUnsupportedWorkspaceGalleryMove();
}

function moveMethodLibraryStatus(
  cfg: ServerConfig,
  relativePath: string,
  status: LibraryStatus,
): WorkspaceGalleryStatusMoveResult | null {
  const methodPath = readMethodLibraryPath(relativePath);
  if (!methodPath) return null;
  const nextPath = `wiki/专题/${METHOD_LIBRARY_SECTION}/${status}/${methodPath.fileName}`;
  if (nextPath === relativePath) return { previousPath: relativePath, path: nextPath, status };
  renameWorkspaceSourceFile(cfg, relativePath, nextPath);
  buildAndSaveSearchIndex(cfg);
  return { previousPath: relativePath, path: nextPath, status };
}

function moveToolboxLibraryStatus(
  cfg: ServerConfig,
  relativePath: string,
  status: LibraryStatus,
): WorkspaceGalleryStatusMoveResult | null {
  const assetId = readVirtualToolboxAssetId(relativePath);
  if (!assetId) return null;
  const decodedId = decodeURIComponent(assetId);
  if (!updateToolboxAssetBadge(cfg.projectRoot, decodedId, status)) {
    throw new Error("workspace toolbox asset not found");
  }
  return {
    previousPath: relativePath,
    path: `wiki/专题/${TOOLBOX_LIBRARY_SECTION}/${status}/${assetId}.md`,
    status,
  };
}

function sendWorkspaceDocsSaveError(res: Response, error: unknown): void {
  res.status(400).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function handleWorkspaceDocsDelete(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    try {
      const paths = readWorkspaceDeletePaths(req.body);
      if (paths.length === 0) {
        res.status(400).json({ success: false, error: "invalid workspace document path" });
        return;
      }

      for (const relativePath of paths) {
        const fullPath = sourcePath(cfg, relativePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          clearPageRenderCacheForPath(fullPath);
        }
      }
      buildAndSaveSearchIndex(cfg);
      res.json({ success: true, data: { paths } });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function readWorkspaceDeletePaths(body: unknown): string[] {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const values = Array.isArray(record.paths) ? record.paths : [record.path];
  const paths = values
    .map((value) => safeWorkspaceDocPath(String(value ?? "").trim()))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(paths));
}

function safeRel(input: string): string | null {
  if (!input) return "wiki/index.md";
  // Reject absolute and ..
  if (path.isAbsolute(input)) return null;
  const normalized = path.posix.normalize(input);
  if (normalized.startsWith("..")) return null;
  return normalized;
}

function resolveTargetPath(
  cfg: ServerConfig,
  target: string,
): { logicalPath: string; fullPath: string } | null {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    return null;
  }

  const runtimeWikiPath = resolveRuntimeWikiLogicalPath(normalizedTarget);
  if (runtimeWikiPath) {
    const fullPath = runtimePath(cfg, runtimeWikiPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return { logicalPath: runtimeWikiPath, fullPath };
    }
  }

  const directTarget = resolveDirectTargetPath(cfg, normalizedTarget);
  if (directTarget) {
    return directTarget;
  }

  for (const root of [cfg.sourceVaultRoot, cfg.runtimeRoot]) {
    const fullPath = findPage(root, normalizedTarget);
    if (!fullPath) {
      continue;
    }
    const logicalPath = toLogicalPath(cfg, fullPath);
    if (logicalPath) {
      return { logicalPath, fullPath };
    }
  }

  return null;
}

function resolveDirectTargetPath(
  cfg: ServerConfig,
  target: string,
): { logicalPath: string; fullPath: string } | null {
  const rel = safeRel(target);
  if (!rel) {
    return null;
  }
  const candidates = hasMarkdownExtension(rel) ? [rel] : [rel, `${rel}.md`];
  for (const candidate of candidates) {
    const fullPath = resolveContentPath(cfg, candidate);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    if (!hasMarkdownExtension(fullPath)) {
      continue;
    }
    const logicalPath = toLogicalPath(cfg, fullPath);
    if (logicalPath) {
      return { logicalPath, fullPath };
    }
  }
  return null;
}

function hasMarkdownExtension(filePath: string): boolean {
  return /\.(md|markdown|txt)$/i.test(filePath);
}

function normalizeAliases(frontmatter: Record<string, unknown> | null): string[] {
  const aliases = frontmatter?.aliases;
  if (typeof aliases === "string" && aliases.trim()) {
    return [aliases.trim()];
  }
  if (Array.isArray(aliases)) {
    return aliases.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  }
  return [];
}

function safeWorkspaceDocPath(input: string): string | null {
  if (!input) return null;
  if (path.isAbsolute(input)) return null;
  const normalized = path.posix.normalize(input);
  if (normalized.startsWith("..")) return null;
  const allowed = normalized === "领域.md"
    || normalized.startsWith("领域/")
    || normalized === "wiki/专题/index.md"
    || normalized.startsWith("wiki/专题/");
  if (!allowed || !normalized.endsWith(".md")) {
    return null;
  }
  return normalized;
}

async function saveVirtualWorkspaceDocument(cfg: ServerConfig, relativePath: string, raw: string): Promise<boolean> {
  const taskId = readVirtualTaskId(relativePath);
  if (taskId) return saveTaskPoolItemFromWorkspace(cfg, taskId, raw);
  const workflowId = readVirtualToolboxId(relativePath, "workflows");
  if (workflowId) return updateToolboxWorkflowFromWorkspace(cfg.projectRoot, workflowId, raw);
  const assetId = readVirtualToolboxAssetId(relativePath) ?? readVirtualToolboxId(relativePath, "assets");
  if (assetId) return updateToolboxAssetFromWorkspace(cfg.projectRoot, decodeURIComponent(assetId), raw);
  return false;
}

function readVirtualTaskId(relativePath: string): string | null {
  return /^wiki\/专题\/01-项目工作区\/tasks\/([^/]+)\.md$/u.exec(relativePath)?.[1] ?? null;
}

function readVirtualToolboxId(relativePath: string, section: "workflows" | "assets"): string | null {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^wiki/专题/03-工具箱/${escaped}/([^/]+)\\.md$`, "u").exec(relativePath)?.[1] ?? null;
}

function readVirtualToolboxAssetId(relativePath: string): string | null {
  const statusAlternatives = LIBRARY_STATUS_PAGES.map(escapeRegex).join("|");
  return new RegExp(`^wiki/专题/03-工具箱/(?:${statusAlternatives})/([^/]+)\\.md$`, "u")
    .exec(relativePath)?.[1] ?? null;
}

function readMethodLibraryPath(relativePath: string): { status: LibraryStatus; fileName: string } | null {
  const statusAlternatives = LIBRARY_STATUS_PAGES.map(escapeRegex).join("|");
  const match = new RegExp(`^wiki/专题/${METHOD_LIBRARY_SECTION}/(${statusAlternatives})/([^/]+\\.md)$`, "u")
    .exec(relativePath);
  if (!match) return null;
  return { status: match[1] as LibraryStatus, fileName: match[2] };
}

function renameWorkspaceSourceFile(cfg: ServerConfig, previousPath: string, nextPath: string): void {
  const previousFullPath = sourcePath(cfg, previousPath);
  const nextFullPath = sourcePath(cfg, nextPath);
  if (!fs.existsSync(previousFullPath) || !fs.statSync(previousFullPath).isFile()) {
    throw new Error("workspace source document not found");
  }
  if (fs.existsSync(nextFullPath)) {
    throw new Error("workspace target document already exists");
  }
  fs.mkdirSync(path.dirname(nextFullPath), { recursive: true });
  fs.renameSync(previousFullPath, nextFullPath);
  clearPageRenderCacheForPath(previousFullPath);
  clearPageRenderCacheForPath(nextFullPath);
}

function throwUnsupportedWorkspaceGalleryMove(): never {
  throw new Error("unsupported workspace gallery status move");
}

async function saveTaskPoolItemFromWorkspace(cfg: ServerConfig, taskId: string, raw: string): Promise<boolean> {
  const state = await readTaskPlanState(taskPlanStoreOptions(cfg));
  const index = state.pool.items.findIndex((item) => item.id === taskId);
  if (index < 0) return false;
  const current = state.pool.items[index];
  const patch = parseTaskPoolItemMarkdown(raw);
  state.pool.items[index] = {
    ...current,
    title: patch.title ?? current.title,
    project: patch.project ?? current.project,
    domain: patch.domain ?? current.domain,
    priority: patch.priority ?? current.priority,
  };
  await writeTaskPlanState(state, taskPlanStoreOptions(cfg));
  return true;
}

function parseTaskPoolItemMarkdown(raw: string): {
  title?: string;
  project?: string;
  domain?: string;
  priority?: TaskPlanPriority;
} {
  return {
    title: readMarkdownTitle(raw),
    project: readLineValue(raw, "项目"),
    domain: readLineValue(raw, "领域"),
    priority: normalizeTaskPlanPriority(readLineValue(raw, "优先级")),
  };
}

function normalizeTaskPlanPriority(value: string | undefined): TaskPlanPriority | undefined {
  if (value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral") {
    return value;
  }
  if (value === "高") return "high";
  if (value === "中") return "mid";
  if (value === "低") return "low";
  return undefined;
}

function readMarkdownTitle(raw: string): string | undefined {
  const title = /^#\s+(.+)$/mu.exec(raw)?.[1]?.trim();
  return title || undefined;
}

function readLineValue(raw: string, label: string): string | undefined {
  const escaped = escapeRegex(label);
  const value = new RegExp(`^${escaped}[:：]\\s*(.+)$`, "mu").exec(raw)?.[1]?.trim();
  return value || undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function taskPlanStoreOptions(cfg: ServerConfig): { storageRoot: string } {
  return { storageRoot: path.join(cfg.sourceVaultRoot, "task plan") };
}

export function ensureWorkspaceDocScaffold(projectRoot: string): void {
  const rootDoc = path.join(projectRoot, "领域.md");
  const domainDir = path.join(projectRoot, "领域");
  const domainDoc = path.join(domainDir, "产品.md");
  const projectDir = path.join(domainDir, "产品");
  const projectDoc = path.join(projectDir, "LLM Wiki WebUI.md");
  const workLogDir = path.join(projectDir, "LLM Wiki WebUI");
  const workLogDoc = path.join(workLogDir, "工作日志.md");

  ensureFile(rootDoc, `# 领域

- 产品：沉淀当前产品线与项目推进脉络。
`);
  fs.mkdirSync(domainDir, { recursive: true });
  ensureFile(domainDoc, `# 产品

## 当前关注

- LLM Wiki WebUI

## 说明

这个领域用来沉淀产品方向下的项目文档和工作日志。
`);
  fs.mkdirSync(projectDir, { recursive: true });
  ensureFile(projectDoc, `# LLM Wiki WebUI

## 项目定位

持续迭代个人知识 Wiki 的 WebUI、工作台和剪藏能力。

## 当前主线

- 工作台结构收口
- 多层文档组织方式
- 项目内工作日志沉淀
`);
  fs.mkdirSync(workLogDir, { recursive: true });
  ensureFile(workLogDoc, `# 工作日志

## 2026-04-23

- 初始化领域 / 项目 / 工作日志四层文档结构
- 准备把工作台里的工作日志切换成真实文档视图
`);
  ensureWorkspaceTopicScaffold(projectRoot);
}

function ensureWorkspaceTopicScaffold(projectRoot: string): void {
  const topicDir = path.join(projectRoot, "wiki", "专题");
  ensureWorkspaceRootGuide(topicDir);
  ensureFile(path.join(topicDir, PROJECT_WORKSPACE_SECTION, "index.md"), projectWorkspaceIndex());
  ensureFile(path.join(topicDir, DEPOSIT_LIBRARY_SECTION, "index.md"), depositLibraryIndex());
  ensureExecutionSiteScaffold(topicDir);
  ensureCaseLibraryScaffold(topicDir);
  ensureMethodLibraryScaffold(topicDir);
  ensureToolboxLibraryScaffold(topicDir);
  ensureArchiveScaffold(topicDir);
}

function ensureWorkspaceRootGuide(topicDir: string): void {
  const filePath = path.join(topicDir, "index.md");
  const guide = workspaceMaintenanceGuide();
  if (!fs.existsSync(filePath)) {
    ensureFile(filePath, guide);
    return;
  }
  const current = fs.readFileSync(filePath, "utf-8");
  if (isOldWorkspaceRootPlaceholder(current)) {
    fs.writeFileSync(filePath, guide, "utf-8");
  }
}

function isOldWorkspaceRootPlaceholder(content: string): boolean {
  const normalized = content.trim();
  return normalized === "# 专题"
    || normalized === "# 工作日志"
    || normalized.includes("这些页面只在工作日志页展示")
    || normalized.includes("这里按执行现场、项目工作区和沉淀库组织行动记录");
}

function workspaceMaintenanceGuide(): string {
  return `# 工作日志维护指南

这页是 AI 维护工作日志的操作规范。用户只需要通过执行记录器写“刚刚做了什么”；AI 负责维护领域、项目、任务、行动、案例、方法、工具和双链。

## 主事实源

- 任务事实源：工作台任务池的 \`pool.items\`。工作日志项目工作区展示同一批任务；改任务标题、领域、项目、优先级时必须同步回任务池。
- 行动事实源：执行记录器提交的记录。行动必须先绑定任务，不能直接散落到案例库或方法库。
- 工具事实源：工作日志沉淀库里的 \`工具箱\`。工作台不再维护独立工具箱页。
- 双链事实源：工作日志 Graphy 和 \`.llmwiki/workspace-relations.json\`。一条关系必须从两端都能看到。

## AI 处理顺序

1. 先判断行动属于哪个任务；有 \`taskId\` 时优先使用任务池原任务，不新建重复任务。
2. 找不到任务时，放入 \`执行现场 / 待绑定任务\`，等待选择已有任务或新建任务。
3. 绑定任务后，把行动追加到对应任务卡和项目工作日志。
4. 只有行动产生了可复用经验，才沉淀到案例、方法或工具。
5. 每次沉淀后补双链：任务 ↔ 行动，任务 ↔ 案例，案例 ↔ 方法，方法 ↔ 工具，记录 ↔ Workflow Event。

## 页面维护规则

- \`执行现场\`：处理今天行动、待绑定任务、待归档记录、已归档记录和 Workflow Event；这里是队列，不是长期知识库。
- \`项目工作区\`：按领域、项目、任务展示正在推进的工作；这里承接任务池，不另造一套任务。
- \`案例库\`：单独维护具体问题、尝试和结果，下面可以持续追加多个案例。
- \`沉淀库\`：只放能复用的方法和工具。方法回答“以后怎么做”，工具回答“用什么做”。
- \`归档\`：自动汇总失败的方法，以及已完成的领域、项目、任务；这里会写入真实归档页。

## 状态迁移

- \`待验证\`：AI 候选、刚写入、尚未被真实任务验证。
- \`已验证但成功\`：至少在一个案例或任务里使用成功，并能说明有效条件。
- \`已验证但失败\`：真实尝试失败，并记录失败条件、限制或替代方案。

## 禁止事项

- 不要凭空创建领域、项目、任务、案例、方法或工具。
- 不要把同一行动同时写成多个重复任务。
- 不要把纯过程记录沉淀成方法；方法必须能被下一次复用。
- 不要手写 Workflow Event；它是机器凭证层，只能引用和追溯。
- 不要把工作日志内容送入 compile 抽取；工作日志是任务记录页，不是公开知识来源。

## AI 每次维护前检查

- 这条行动是否已绑定任务？
- 这个任务是否已经在任务池存在？
- 是否需要追加项目工作日志？
- 是否真的产生了案例、方法或工具？
- 新增沉淀是否已经补齐双链？
- 状态是待验证、已验证但成功，还是已验证但失败？
`;
}

function ensureExecutionSiteScaffold(topicDir: string): void {
  const sectionDir = path.join(topicDir, EXECUTION_SECTION);
  ensureFile(path.join(sectionDir, "index.md"), executionSiteIndex());
  for (const page of EXECUTION_PAGES) {
    ensureFile(path.join(sectionDir, `${page}.md`), executionPageTemplate(page));
  }
}

function ensureCaseLibraryScaffold(topicDir: string): void {
  const sectionDir = path.join(topicDir, CASE_LIBRARY_SECTION);
  ensureFile(path.join(sectionDir, "index.md"), caseLibraryIndex());
  ensureFile(path.join(sectionDir, "示例-信息消费失控案例.md"), topicCaseExample());
}

function ensureMethodLibraryScaffold(topicDir: string): void {
  const sectionDir = path.join(topicDir, METHOD_LIBRARY_SECTION);
  ensureFile(path.join(sectionDir, "index.md"), methodLibraryIndex());
  for (const status of LIBRARY_STATUS_PAGES) {
    ensureFile(path.join(sectionDir, status, "index.md"), validationStatusPage("方法", status));
  }
}

function ensureToolboxLibraryScaffold(topicDir: string): void {
  const sectionDir = path.join(topicDir, TOOLBOX_LIBRARY_SECTION);
  ensureFile(path.join(sectionDir, "index.md"), toolboxLibraryIndex());
  for (const status of LIBRARY_STATUS_PAGES) {
    ensureFile(path.join(sectionDir, status, "index.md"), validationStatusPage("工具", status));
  }
}

function ensureArchiveScaffold(topicDir: string): void {
  ensureFile(path.join(topicDir, ARCHIVE_SECTION, "index.md"), archiveIndex());
  ensureFile(path.join(topicDir, ARCHIVE_SECTION, ARCHIVE_FAILED_METHODS_PROJECT, "index.md"), archiveFailedMethodsIndex([]));
  ensureFile(path.join(topicDir, ARCHIVE_SECTION, ARCHIVE_COMPLETED_PROJECT, "index.md"), archiveCompletedIndex([]));
}

function projectWorkspaceIndex(): string {
  return `# 项目工作区

这里按领域和项目展示已归档行动。执行记录器确认后的任务进展会写入对应项目工作日志。
`;
}

function depositLibraryIndex(): string {
  return `# 沉淀库

这里查看从行动记录沉淀出来的方法和工具。案例库单独维护，方法和工具按验证状态分组。
`;
}

function archiveIndex(): string {
  return `# 归档

这里自动收纳失败的方法，以及已完成的领域、项目、任务。
`;
}

function executionSiteIndex(): string {
  return `# 执行现场

这里是行动记录的处理队列。平时只需要用执行记录器写行动，系统会按状态放入今日行动、待绑定任务、待归档记录或已归档记录。
`;
}

function executionPageTemplate(title: (typeof EXECUTION_PAGES)[number]): string {
  return `# ${title}

## 使用说明

${executionPageDescription(title)}
`;
}

function executionPageDescription(title: (typeof EXECUTION_PAGES)[number]): string {
  const descriptions: Record<(typeof EXECUTION_PAGES)[number], string> = {
    今日行动: "当天通过执行记录器提交的行动会汇总到这里，用来复盘今天真实发生了什么。",
    待绑定任务: "系统无法确定任务归属的行动会进入这里。处理方式是选择已有任务、新建任务或标记为不属于任务。",
    待归档记录: "任务大致明确但沉淀方式不确定的记录会进入这里。处理方式是确认保存到任务进展、项目日志、案例、方法、工具、失败经验或只保留事件。",
    已归档记录: "已经写入任务卡、项目工作日志或沉淀库的记录会进入这里，用于追溯。",
    "Workflow Event": "这里是系统事件凭证层，平时不手写，只用于追溯、纠错和审计。",
  };
  return descriptions[title];
}

function caseLibraryIndex(): string {
  return `# 案例库

这里收纳一次具体问题、尝试、结果完整的行动复盘。案例需要双链到任务、方法、工具和 Workflow Event。
`;
}

function topicCaseExample(): string {
  return `# 示例：信息消费失控案例

## 事实

- 小红书、X、抖音反复出现，说明娱乐入口不是偶发
- Bing 搜索和相似关键词重复出现，说明搜索经常替代执行
- OpenAI、Google 登录链路反复出现，说明工具链摩擦持续消耗注意力

## 问题

把“找方法、找工具、刷信息”误当成推进。

## 根因假设

- 开始任务前没有写清楚本轮产出
- 遇到不确定就搜索，而不是先限定问题
- 社媒入口缺少阻断和时间盒

## 修正原则

先定义产出，再允许搜索；搜索必须有时间盒。

## 下次验证

7 天后重新统计社媒访问、重复关键词和搜索次数是否下降。
`;
}

function methodLibraryIndex(): string {
  return `# 方法库

这里保存可复用做法。每个方法都应关联案例和工具，并标记为已验证但成功、待验证或已验证但失败。
`;
}

function toolboxLibraryIndex(): string {
  return `# 工具箱

这里保存工具记录。工具需要关联使用它的方法、案例和验证状态。
`;
}

function validationStatusPage(assetName: string, status: string): string {
  return `# ${status}

这里放${status}的${assetName}记录。条目需要说明来源行动、关联案例、使用方法和当前结论。
`;
}

function renderTaskProjectMarkdown(project: string, items: readonly TaskPlanPoolItem[]): string {
  const rows = items
    .map((item) => `| [[${PROJECT_WORKSPACE_SECTION}/tasks/${item.id}|${escapeMarkdownTable(item.title)}]] | ${escapeMarkdownTable(item.domain ?? "未标注")} | ${escapeMarkdownTable(item.priority)} | ${item.completedAt ? "已完成" : "进行中"} |`)
    .join("\n");
  return `# ${project}

这里直接读取任务池中项目为“${project}”的任务。改任务名、项目或领域，请打开下面具体任务页编辑。

| 任务 | 领域 | 优先级 | 状态 |
|---|---|---|---|
${rows || "| 暂无任务 | - | - | - |"}
`;
}

function renderTaskPoolItemMarkdown(item: TaskPlanPoolItem): string {
  return `# ${item.title}

${renderTaskPoolItemDetails(item)}

## 当前进展

${readTaskParagraph(item.currentProgress)}

## 最近卡点

${readTaskParagraph(item.lastStop)}

## 下一步

${readTaskParagraph(item.nextStep)}

## 行动记录

${renderWorkflowLogLines(item)}
`;
}

function renderTaskActionMarkdown(
  item: TaskPlanPoolItem,
  action: NonNullable<TaskPlanPoolItem["actions"]>[number],
): string {
  return `# ${action.title}

任务：${item.title}
任务ID：${item.id}
行动ID：${action.id}
领域：${readTaskField(item.domain)}
项目：${readTaskField(item.project)}
状态：${action.completedAt?.trim() ? "已完成" : "进行中"}

## 下往上维护

这条行动可向上维护任务、项目和领域，也可双链到案例、方法或工具。
`;
}

function renderTaskPoolItemDetails(item: TaskPlanPoolItem): string {
  return [
    `任务ID：${item.id}`,
    `项目：${readTaskField(item.project)}`,
    `领域：${readTaskField(item.domain)}`,
    `优先级：${item.priority}`,
    `负责人：${readTaskField(item.owner)}`,
    `来源：${item.source}`,
    `状态：${readTaskStatus(item)}`,
  ].join("\n");
}

function readTaskField(value: string | undefined): string {
  return value?.trim() || "";
}

function readTaskParagraph(value: string | undefined): string {
  return value?.trim() || "待补充。";
}

function readTaskStatus(item: TaskPlanPoolItem): string {
  return item.completedAt ? "已完成" : "进行中";
}

function renderWorkflowLogLines(item: TaskPlanPoolItem): string {
  const logs = (item.workflowLog ?? [])
    .map((log) => `- ${log.recordedAt}：${log.input}`)
    .join("\n");
  return logs || "- 暂无行动记录。";
}

function renderToolboxAssetMarkdown(asset: ToolboxAssetRecord, status: LibraryStatus): string {
  return `# ${asset.title}

类型：工具资产
分类：${asset.category}
摘要：${asset.summary}
链接：${asset.href}
标记：${status}
工具箱ID：${asset.id}
来源：${asset.source.type}${asset.source.path ? ` / ${asset.source.path}` : ""}
`;
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function normalizeLibraryStatus(value: string): LibraryStatus {
  return readLibraryStatus(value) ?? "待验证";
}

function readLibraryStatus(value: string): LibraryStatus | null {
  return (LIBRARY_STATUS_PAGES as readonly string[]).includes(value) ? value as LibraryStatus : null;
}

function toolboxAssetVirtualPath(
  status: LibraryStatus,
  asset: ToolboxAssetRecord,
): string {
  return `wiki/专题/${TOOLBOX_LIBRARY_SECTION}/${status}/${encodeURIComponent(asset.id)}.md`;
}

function safeWorkspaceSlug(value: string): string {
  return encodeURIComponent(value.trim() || "untitled").replace(/%/gu, "~");
}

function ensureFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

async function listWorkspaceDocInputs(cfg: ServerConfig): Promise<WorkspaceDocInput[]> {
  const documents: WorkspaceDocInput[] = [];
  const taskState = await readTaskPlanState(taskPlanStoreOptions(cfg));
  const toolbox = readToolboxPageData(cfg.projectRoot);
  syncArchiveDocuments(cfg.sourceVaultRoot, taskState);
  documents.push({
    id: "root",
    kind: "root",
    label: "工作日志",
    relPath: "wiki/专题/index.md",
    domain: null,
    project: null,
  });
  pushExecutionSiteInputs(documents);
  pushProjectWorkspaceInputs(documents, cfg.sourceVaultRoot, taskState);
  pushCaseLibraryInputs(documents, cfg.sourceVaultRoot);
  pushDepositLibraryInputs(documents, cfg.sourceVaultRoot, toolbox.assets);
  pushArchiveInputs(documents, cfg.sourceVaultRoot, taskState);
  return documents;
}

function pushProjectWorkspaceInputs(
  documents: WorkspaceDocInput[],
  sourceVaultRoot: string,
  taskState: TaskPlanState,
): void {
  pushSectionDomain(documents, PROJECT_WORKSPACE_SECTION, `wiki/专题/${PROJECT_WORKSPACE_SECTION}/index.md`);
  for (const group of groupTaskPoolItemsByProject(taskState.pool.items)) {
    pushTaskProject(documents, group.project, group.items);
  }
  pushPhysicalProjectWorkLogs(documents, sourceVaultRoot);
}

function pushExecutionSiteInputs(documents: WorkspaceDocInput[]): void {
  pushSectionDomain(documents, EXECUTION_SECTION, `wiki/专题/${EXECUTION_SECTION}/index.md`);
}

function pushDepositLibraryInputs(
  documents: WorkspaceDocInput[],
  projectRoot: string,
  assets: readonly ToolboxAssetRecord[],
): void {
  pushSectionDomain(documents, DEPOSIT_LIBRARY_SECTION, `wiki/专题/${DEPOSIT_LIBRARY_SECTION}/index.md`);
  pushMethodLibraryInputs(documents, projectRoot);
  pushToolboxLibraryInputs(documents, assets);
}

function pushArchiveInputs(
  documents: WorkspaceDocInput[],
  projectRoot: string,
  taskState: TaskPlanState,
): void {
  const completedItems = taskState.pool.items.filter((item) => Boolean(item.completedAt?.trim()));
  pushSectionDomain(documents, ARCHIVE_SECTION, `wiki/专题/${ARCHIVE_SECTION}/index.md`);
  pushArchiveProject(documents, ARCHIVE_FAILED_METHODS_PROJECT);
  pushArchiveFailedMethodItems(documents, projectRoot);
  pushArchiveProject(documents, ARCHIVE_COMPLETED_PROJECT);
  pushArchiveCompletedTaskItems(documents, completedItems);
}

function pushSectionDomain(documents: WorkspaceDocInput[], label: string, relPath: string): void {
  documents.push({
    id: `domain:${label}`,
    kind: "domain",
    label,
    relPath,
    domain: label,
    project: null,
  });
}

function pushArchiveProject(documents: WorkspaceDocInput[], label: string): void {
  documents.push({
    id: `project:${ARCHIVE_SECTION}/${label}`,
    kind: "project",
    label,
    relPath: `wiki/专题/${ARCHIVE_SECTION}/${label}/index.md`,
    domain: ARCHIVE_SECTION,
    project: label,
  });
}

function groupTaskPoolItemsByProject(items: readonly TaskPlanPoolItem[]): Array<{ project: string; items: TaskPlanPoolItem[] }> {
  const groups = new Map<string, TaskPlanPoolItem[]>();
  for (const item of items) {
    const project = normalizeTaskProject(item.project);
    groups.set(project, [...(groups.get(project) ?? []), item]);
  }
  return Array.from(groups.entries())
    .map(([project, groupItems]) => ({ project, items: groupItems }))
    .sort((left, right) => left.project.localeCompare(right.project, "zh-Hans-CN"));
}

function normalizeTaskProject(project: string | undefined): string {
  const value = project?.trim();
  return value || "未归类项目";
}

function pushTaskProject(documents: WorkspaceDocInput[], project: string, items: readonly TaskPlanPoolItem[]): void {
  const slug = safeWorkspaceSlug(project);
  documents.push({
    id: `project:${PROJECT_WORKSPACE_SECTION}/${slug}`,
    kind: "project",
    label: project,
    relPath: `wiki/专题/${PROJECT_WORKSPACE_SECTION}/projects/${slug}/index.md`,
    domain: PROJECT_WORKSPACE_SECTION,
    project,
    virtualRaw: renderTaskProjectMarkdown(project, items),
  });
  for (const item of items) {
    documents.push({
      id: `work-log:${PROJECT_WORKSPACE_SECTION}/task/${item.id}`,
      kind: "work-log",
      label: item.title,
      relPath: `wiki/专题/${PROJECT_WORKSPACE_SECTION}/tasks/${item.id}.md`,
      domain: PROJECT_WORKSPACE_SECTION,
      project,
      virtualRaw: renderTaskPoolItemMarkdown(item),
    });
    pushTaskActionInputs(documents, project, item);
  }
}

function pushTaskActionInputs(
  documents: WorkspaceDocInput[],
  project: string,
  item: TaskPlanPoolItem,
): void {
  for (const action of item.actions ?? []) {
    documents.push({
      id: `work-log:${PROJECT_WORKSPACE_SECTION}/action/${item.id}/${action.id}`,
      kind: "work-log",
      label: action.title,
      relPath: `wiki/专题/${PROJECT_WORKSPACE_SECTION}/actions/${item.id}/${action.id}.md`,
      domain: PROJECT_WORKSPACE_SECTION,
      project,
      virtualRaw: renderTaskActionMarkdown(item, action),
      treeHidden: true,
    });
  }
}

function pushPhysicalProjectWorkLogs(documents: WorkspaceDocInput[], projectRoot: string): void {
  const domainRoot = path.join(projectRoot, "领域");
  if (!fs.existsSync(domainRoot) || !fs.statSync(domainRoot).isDirectory()) return;
  for (const domain of collectNames(domainRoot)) {
    pushPhysicalProjectWorkspaceDomain(documents, domainRoot, domain);
  }
}

function pushPhysicalProjectWorkspaceDomain(documents: WorkspaceDocInput[], domainRoot: string, domain: string): void {
  pushProjectWorkspaceProject(documents, domain);
  const projectDir = path.join(domainRoot, domain);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) return;
  for (const project of collectNames(projectDir)) {
    pushProjectWorkspaceDocument(documents, domain, project);
  }
}

function pushProjectWorkspaceProject(documents: WorkspaceDocInput[], domain: string): void {
  documents.push({
    id: `project:${PROJECT_WORKSPACE_SECTION}/${domain}`,
    kind: "project",
    label: domain,
    relPath: `领域/${domain}.md`,
    domain: PROJECT_WORKSPACE_SECTION,
    project: domain,
  });
}

function pushProjectWorkspaceDocument(documents: WorkspaceDocInput[], domain: string, project: string): void {
  pushProjectWorkspaceWorkLog(documents, domain, project, project, "项目概览", `领域/${domain}/${project}.md`);
  pushProjectWorkspaceWorkLog(
    documents,
    domain,
    `${project} / 工作日志`,
    project,
    "工作日志",
    `领域/${domain}/${project}/工作日志.md`,
  );
}

function pushProjectWorkspaceWorkLog(
  documents: WorkspaceDocInput[],
  domain: string,
  label: string,
  project: string,
  idSuffix: string,
  relPath: string,
): void {
  documents.push({
    id: `work-log:${PROJECT_WORKSPACE_SECTION}/${domain}/${project}/${idSuffix}`,
    kind: "work-log",
    label,
    relPath,
    domain: PROJECT_WORKSPACE_SECTION,
    project: domain,
  });
}

function pushCaseLibraryInputs(documents: WorkspaceDocInput[], projectRoot: string): void {
  pushSectionDomain(documents, CASE_LIBRARY_SECTION, `wiki/专题/${CASE_LIBRARY_SECTION}/index.md`);
  const caseDir = path.join(projectRoot, "wiki", "专题", CASE_LIBRARY_SECTION);
  if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) return;
  for (const example of collectTopicExamples(caseDir)) {
    documents.push({
      id: `work-log:${CASE_LIBRARY_SECTION}/${example.replace(/\.md$/i, "")}`,
      kind: "work-log",
      label: example.replace(/\.md$/i, ""),
      relPath: `wiki/专题/${CASE_LIBRARY_SECTION}/${example}`,
      domain: CASE_LIBRARY_SECTION,
      project: null,
      gallery: { type: "case", status: null },
    });
  }
}

function pushMethodLibraryInputs(documents: WorkspaceDocInput[], projectRoot: string): void {
  pushMethodGalleryItems(documents, projectRoot);
}

function pushToolboxLibraryInputs(
  documents: WorkspaceDocInput[],
  assets: readonly ToolboxAssetRecord[],
): void {
  for (const asset of assets) {
    const status = normalizeLibraryStatus(asset.badge);
    pushLibraryWorkLog(
      documents,
      "工具箱",
      asset.title,
      toolboxAssetVirtualPath(status, asset),
      renderToolboxAssetMarkdown(asset, status),
      true,
      { type: "tool", status },
    );
  }
}

function pushMethodGalleryItems(documents: WorkspaceDocInput[], projectRoot: string): void {
  for (const status of LIBRARY_STATUS_PAGES) {
    const directory = path.join(projectRoot, "wiki", "专题", METHOD_LIBRARY_SECTION, status);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
    for (const entry of collectTopicExamples(directory)) {
      const relPath = `wiki/专题/${METHOD_LIBRARY_SECTION}/${status}/${entry}`;
      documents.push({
        id: `work-log:${DEPOSIT_LIBRARY_SECTION}/方法库/${status}/${entry}`,
        kind: "work-log",
        label: entry.replace(/\.md$/i, ""),
        relPath,
        domain: DEPOSIT_LIBRARY_SECTION,
        project: "方法库",
        treeHidden: true,
        gallery: { type: "method", status },
      });
    }
  }
}

function pushArchiveFailedMethodItems(documents: WorkspaceDocInput[], projectRoot: string): void {
  const directory = path.join(projectRoot, "wiki", "专题", ARCHIVE_SECTION, ARCHIVE_FAILED_METHODS_PROJECT);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return;
  for (const entry of collectTopicExamples(directory)) {
    documents.push({
      id: `work-log:${ARCHIVE_SECTION}/失败的方法/${entry}`,
      kind: "work-log",
      label: entry.replace(/\.md$/i, ""),
      relPath: `wiki/专题/${ARCHIVE_SECTION}/${ARCHIVE_FAILED_METHODS_PROJECT}/${entry}`,
      domain: ARCHIVE_SECTION,
      project: ARCHIVE_FAILED_METHODS_PROJECT,
      gallery: { type: "method", status: "已验证但失败" },
    });
  }
}

function pushArchiveCompletedTaskItems(
  documents: WorkspaceDocInput[],
  items: readonly TaskPlanPoolItem[],
): void {
  for (const item of items) {
    documents.push({
      id: `work-log:${ARCHIVE_SECTION}/completed/task/${item.id}`,
      kind: "work-log",
      label: item.title,
      relPath: `wiki/专题/${ARCHIVE_SECTION}/${ARCHIVE_COMPLETED_PROJECT}/${safeWorkspaceSlug(item.id)}.md`,
      domain: ARCHIVE_SECTION,
      project: ARCHIVE_COMPLETED_PROJECT,
    });
  }
}

function pushLibraryWorkLog(
  documents: WorkspaceDocInput[],
  project: string,
  label: string,
  relPath: string,
  virtualRaw?: string,
  treeHidden?: boolean,
  gallery?: WorkspaceDocGalleryMeta,
): void {
  documents.push({
    id: `work-log:${DEPOSIT_LIBRARY_SECTION}/${project}/${relPath}`,
    kind: "work-log",
    label,
    relPath,
    domain: DEPOSIT_LIBRARY_SECTION,
    project,
    virtualRaw,
    treeHidden,
    gallery,
  });
}

function syncArchiveDocuments(projectRoot: string, taskState: TaskPlanState): void {
  const completedItems = taskState.pool.items.filter((item) => Boolean(item.completedAt?.trim()));
  writeGeneratedFile(path.join(projectRoot, "wiki", "专题", ARCHIVE_SECTION, "index.md"), archiveIndex());
  syncFailedMethodArchive(projectRoot);
  syncCompletedArchive(projectRoot, completedItems);
}

function syncFailedMethodArchive(projectRoot: string): void {
  const sourceDir = path.join(projectRoot, "wiki", "专题", METHOD_LIBRARY_SECTION, "已验证但失败");
  const archiveDir = path.join(projectRoot, "wiki", "专题", ARCHIVE_SECTION, ARCHIVE_FAILED_METHODS_PROJECT);
  const entries = fs.existsSync(sourceDir) && fs.statSync(sourceDir).isDirectory() ? collectTopicExamples(sourceDir) : [];
  writeGeneratedFile(path.join(archiveDir, "index.md"), archiveFailedMethodsIndex(entries));
  for (const entry of entries) {
    const source = fs.readFileSync(path.join(sourceDir, entry), "utf-8");
    writeGeneratedFile(path.join(archiveDir, entry), source);
  }
}

function syncCompletedArchive(projectRoot: string, items: readonly TaskPlanPoolItem[]): void {
  const archiveDir = path.join(projectRoot, "wiki", "专题", ARCHIVE_SECTION, ARCHIVE_COMPLETED_PROJECT);
  writeGeneratedFile(path.join(archiveDir, "index.md"), archiveCompletedIndex(items));
  for (const item of items) {
    writeGeneratedFile(path.join(archiveDir, `${safeWorkspaceSlug(item.id)}.md`), renderTaskPoolItemMarkdown(item));
  }
}

function writeGeneratedFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf-8") !== content) {
    fs.writeFileSync(filePath, content, "utf-8");
  }
}

function archiveFailedMethodsIndex(entries: readonly string[]): string {
  const names = entries.map((entry) => entry.replace(/\.md$/i, ""));
  return `# ${ARCHIVE_FAILED_METHODS_PROJECT}\n\n${renderArchiveList(names)}\n`;
}

function archiveCompletedIndex(items: readonly TaskPlanPoolItem[]): string {
  const domains = uniqueNonEmpty(items.map((item) => item.domain));
  const projects = uniqueNonEmpty(items.map((item) => item.project));
  return [
    `# ${ARCHIVE_COMPLETED_PROJECT}`,
    "",
    "## 已完成领域",
    renderArchiveList(domains),
    "",
    "## 已完成项目",
    renderArchiveList(projects),
    "",
    "## 已完成任务",
    renderArchiveList(items.map((item) => item.title)),
    "",
  ].join("\n");
}

function uniqueNonEmpty(values: readonly (string | undefined)[]): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function renderArchiveList(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- 暂无";
}

async function listWorkspaceDocs(cfg: ServerConfig): Promise<WorkspaceDocRecord[]> {
  const documents: WorkspaceDocRecord[] = [];
  for (const input of await listWorkspaceDocInputs(cfg)) {
    pushWorkspaceDoc(documents, cfg, input);
  }
  return documents;
}

export async function listWorkspaceDocSummaries(cfg: ServerConfig): Promise<WorkspaceDocRecord[]> {
  return (await listWorkspaceDocInputs(cfg))
    .map((input) => readWorkspaceDocSummary(cfg, input))
    .filter((item): item is WorkspaceDocRecord => Boolean(item));
}

async function readWorkspaceDocByPath(cfg: ServerConfig, relativePath: string): Promise<WorkspaceDocRecord | null> {
  if (relativePath === "wiki/专题/index.md") {
    return readWorkspaceDocRecord(cfg, {
      id: "root",
      kind: "root",
      label: "工作日志",
      relPath: relativePath,
      domain: null,
      project: null,
    });
  }
  const input = (await listWorkspaceDocInputs(cfg)).find((item) => item.relPath === relativePath);
  return input ? readWorkspaceDocRecord(cfg, input) : null;
}

function readWorkspaceDocSummary(cfg: ServerConfig, input: WorkspaceDocInput): WorkspaceDocRecord | null {
  if (input.virtualRaw !== undefined) {
    return renderVirtualWorkspaceDocSummary(input);
  }
  const fullPath = resolveContentPath(cfg, input.relPath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return null;
  }
  const stat = fs.statSync(fullPath);
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    path: input.relPath,
    title: readMarkdownTitlePreview(fullPath) ?? input.label,
    frontmatter: null,
    aliases: [],
    html: "",
    raw: "",
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sourceEditable: Boolean(resolveEditableSourceMarkdownPath(cfg, input.relPath)),
    domain: input.domain,
    project: input.project,
    treeHidden: input.treeHidden,
    gallery: input.gallery,
  };
}

function renderVirtualWorkspaceDocSummary(input: WorkspaceDocInput): WorkspaceDocRecord {
  const raw = input.virtualRaw ?? "";
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    path: input.relPath,
    title: readMarkdownTitle(raw) ?? input.label,
    frontmatter: null,
    aliases: [],
    html: "",
    raw,
    sizeBytes: Buffer.byteLength(raw, "utf8"),
    modifiedAt: null,
    sourceEditable: true,
    domain: input.domain,
    project: input.project,
    treeHidden: input.treeHidden,
    gallery: input.gallery,
  };
}

function renderVirtualWorkspaceDoc(input: WorkspaceDocInput, cfg: ServerConfig): WorkspaceDocRecord {
  const raw = input.virtualRaw ?? "";
  const rendered = createRenderer({
    wikilinkResolver: (target) => {
      const resolved = resolveTargetPath(cfg, target);
      return {
        href: `/?page=${encodeURIComponent(resolved?.logicalPath ?? target)}`,
        exists: Boolean(resolved),
      };
    },
  }).render(raw);
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    path: input.relPath,
    title: rendered.title ?? input.label,
    frontmatter: rendered.frontmatter,
    aliases: normalizeAliases(rendered.frontmatter),
    html: decorateWikiHtml(cfg, input.relPath, raw, rendered.html),
    raw: rendered.rawMarkdown,
    sizeBytes: Buffer.byteLength(raw, "utf8"),
    modifiedAt: null,
    sourceEditable: true,
    domain: input.domain,
    project: input.project,
    contentLoaded: true,
    treeHidden: input.treeHidden,
    gallery: input.gallery,
  };
}

function readMarkdownTitlePreview(filePath: string): string | null {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const preview = buffer.subarray(0, bytesRead).toString("utf-8");
    const heading = /^#\s+(.+)$/mu.exec(preview)?.[1]?.trim();
    return heading || null;
  } finally {
    fs.closeSync(fd);
  }
}

function collectTopicExamples(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name.toLowerCase() !== "index.md")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function collectNames(dir: string): string[] {
  const names = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      names.add(entry.name.replace(/\.md$/i, ""));
    }
    if (entry.isDirectory()) {
      names.add(entry.name);
    }
  }
  return Array.from(names).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function pushWorkspaceDoc(
  documents: WorkspaceDocRecord[],
  cfg: ServerConfig,
  input: WorkspaceDocInput,
): void {
  const document = readWorkspaceDocRecord(cfg, input);
  if (document) {
    documents.push(document);
  }
}

function readWorkspaceDocRecord(cfg: ServerConfig, input: WorkspaceDocInput): WorkspaceDocRecord | null {
  if (input.virtualRaw !== undefined) {
    return renderVirtualWorkspaceDoc(input, cfg);
  }
  const page = readPagePayload(cfg, input.relPath);
  if (!page) {
    return null;
  }

  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    path: page.path,
    title: page.title,
    frontmatter: page.frontmatter,
    aliases: page.aliases,
    html: page.html,
    raw: page.raw,
    sizeBytes: page.sizeBytes,
    modifiedAt: page.modifiedAt,
    sourceEditable: page.sourceEditable,
    domain: input.domain,
    project: input.project,
    treeHidden: input.treeHidden,
    gallery: input.gallery,
  };
}
