/**
 * Runtime stores for automation workspace comments, layout preferences, and
 * historical run logs.
 *
 * These stores live under `.llmwiki/` because they are runtime/editor state,
 * not source-of-truth automation definitions. The workspace pages read and
 * write these files without mutating `automations/automations.json`.
 */

import fs from "node:fs";
import path from "node:path";

const STORE_DIR = ".llmwiki";
const COMMENTS_FILE = "automation-comments.json";
const LAYOUTS_FILE = "automation-layouts.json";
const LOGS_FILE = "automation-logs.json";

export interface AutomationWorkspaceComment {
  id: string;
  automationId: string;
  targetType: "node" | "edge" | "canvas";
  targetId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  pinnedX: number;
  pinnedY: number;
  manualX?: number;
  manualY?: number;
}

type AutomationWorkspaceCommentPatch = Partial<Pick<
  AutomationWorkspaceComment,
  "text" | "targetType" | "targetId" | "pinnedX" | "pinnedY"
>> & {
  manualX?: number | null;
  manualY?: number | null;
};

export interface AutomationWorkspaceLayout {
  automationId: string;
  branchOffsets: Record<string, { x: number; y: number }>;
}

export interface AutomationWorkspaceLog {
  id: string;
  automationId: string;
  status: string;
  summary: string;
  startedAt: string;
  endedAt?: string;
}

interface CommentsStore {
  commentsByAutomationId: Record<string, AutomationWorkspaceComment[]>;
}

interface LayoutsStore {
  layoutsByAutomationId: Record<string, AutomationWorkspaceLayout["branchOffsets"]>;
}

interface LogsStore {
  logsByAutomationId: Record<string, AutomationWorkspaceLog[]>;
}

export function listAutomationWorkspaceComments(runtimeRoot: string, automationId: string): AutomationWorkspaceComment[] {
  const store = readCommentsStore(runtimeRoot);
  return [...(store.commentsByAutomationId[automationId] ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function createAutomationWorkspaceComment(
  runtimeRoot: string,
  automationId: string,
  input: Pick<AutomationWorkspaceComment, "targetType" | "targetId" | "text" | "pinnedX" | "pinnedY">
    & Partial<Pick<AutomationWorkspaceComment, "manualX" | "manualY">>,
  now: Date = new Date(),
): AutomationWorkspaceComment {
  const timestamp = now.toISOString();
  const store = readCommentsStore(runtimeRoot);
  const next: AutomationWorkspaceComment = {
    id: `automation-comment-${now.getTime()}-${Math.random().toString(16).slice(2, 10)}`,
    automationId,
    targetType: input.targetType,
    targetId: input.targetId,
    text: input.text,
    createdAt: timestamp,
    updatedAt: timestamp,
    pinnedX: input.pinnedX,
    pinnedY: input.pinnedY,
    ...(typeof input.manualX === "number" ? { manualX: input.manualX } : {}),
    ...(typeof input.manualY === "number" ? { manualY: input.manualY } : {}),
  };
  const list = store.commentsByAutomationId[automationId] ?? [];
  list.push(next);
  store.commentsByAutomationId[automationId] = list;
  writeJson(storePath(runtimeRoot, COMMENTS_FILE), store);
  return next;
}

export function updateAutomationWorkspaceComment(
  runtimeRoot: string,
  automationId: string,
  commentId: string,
  input: AutomationWorkspaceCommentPatch,
  now: Date = new Date(),
): AutomationWorkspaceComment | null {
  const store = readCommentsStore(runtimeRoot);
  const comments = store.commentsByAutomationId[automationId] ?? [];
  const index = comments.findIndex((comment) => comment.id === commentId);
  if (index < 0) {
    return null;
  }
  const current = comments[index];
  const updated: AutomationWorkspaceComment = {
    ...current,
    ...input,
    updatedAt: now.toISOString(),
  };
  if (input.manualX === null) {
    delete updated.manualX;
  }
  if (input.manualY === null) {
    delete updated.manualY;
  }
  comments[index] = updated;
  writeJson(storePath(runtimeRoot, COMMENTS_FILE), store);
  return updated;
}

export function deleteAutomationWorkspaceComment(runtimeRoot: string, automationId: string, commentId: string): boolean {
  const store = readCommentsStore(runtimeRoot);
  const current = store.commentsByAutomationId[automationId] ?? [];
  const next = current.filter((comment) => comment.id !== commentId);
  if (next.length === current.length) {
    return false;
  }
  if (next.length === 0) {
    delete store.commentsByAutomationId[automationId];
  } else {
    store.commentsByAutomationId[automationId] = next;
  }
  writeJson(storePath(runtimeRoot, COMMENTS_FILE), store);
  return true;
}

export function readAutomationWorkspaceLayout(runtimeRoot: string, automationId: string): AutomationWorkspaceLayout {
  const store = readLayoutsStore(runtimeRoot);
  return {
    automationId,
    branchOffsets: store.layoutsByAutomationId[automationId] ?? {},
  };
}

export function saveAutomationWorkspaceLayout(
  runtimeRoot: string,
  automationId: string,
  branchOffsets: AutomationWorkspaceLayout["branchOffsets"],
): AutomationWorkspaceLayout {
  const store = readLayoutsStore(runtimeRoot);
  store.layoutsByAutomationId[automationId] = normalizeBranchOffsets(branchOffsets);
  writeJson(storePath(runtimeRoot, LAYOUTS_FILE), store);
  return {
    automationId,
    branchOffsets: store.layoutsByAutomationId[automationId] ?? {},
  };
}

export function listAutomationWorkspaceLogs(runtimeRoot: string, automationId: string): AutomationWorkspaceLog[] {
  const store = readLogsStore(runtimeRoot);
  return [...(store.logsByAutomationId[automationId] ?? [])].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function readCommentsStore(runtimeRoot: string): CommentsStore {
  const parsed = readJson(storePath(runtimeRoot, COMMENTS_FILE));
  if (!isRecord(parsed) || !isRecord(parsed.commentsByAutomationId)) {
    return { commentsByAutomationId: {} };
  }
  const normalized: Record<string, AutomationWorkspaceComment[]> = {};
  for (const [automationId, comments] of Object.entries(parsed.commentsByAutomationId)) {
    if (!Array.isArray(comments)) continue;
    normalized[automationId] = comments.flatMap(normalizeComment);
  }
  return { commentsByAutomationId: normalized };
}

function readLayoutsStore(runtimeRoot: string): LayoutsStore {
  const parsed = readJson(storePath(runtimeRoot, LAYOUTS_FILE));
  if (!isRecord(parsed) || !isRecord(parsed.layoutsByAutomationId)) {
    return { layoutsByAutomationId: {} };
  }
  const normalized: Record<string, AutomationWorkspaceLayout["branchOffsets"]> = {};
  for (const [automationId, offsets] of Object.entries(parsed.layoutsByAutomationId)) {
    normalized[automationId] = normalizeBranchOffsets(offsets);
  }
  return { layoutsByAutomationId: normalized };
}

function readLogsStore(runtimeRoot: string): LogsStore {
  const parsed = readJson(storePath(runtimeRoot, LOGS_FILE));
  if (!isRecord(parsed) || !isRecord(parsed.logsByAutomationId)) {
    return { logsByAutomationId: {} };
  }
  const normalized: Record<string, AutomationWorkspaceLog[]> = {};
  for (const [automationId, logs] of Object.entries(parsed.logsByAutomationId)) {
    if (!Array.isArray(logs)) continue;
    normalized[automationId] = logs.flatMap(normalizeLog);
  }
  return { logsByAutomationId: normalized };
}

// fallow-ignore-next-line complexity
function normalizeComment(input: unknown): AutomationWorkspaceComment[] {
  if (!isRecord(input)) return [];
  const targetType = normalizeTargetType(input.targetType);
  const targetId = typeof input.targetId === "string" ? input.targetId : "";
  const text = typeof input.text === "string" ? input.text : "";
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : "";
  const pinnedX = typeof input.pinnedX === "number" ? input.pinnedX : null;
  const pinnedY = typeof input.pinnedY === "number" ? input.pinnedY : null;
  if (
    typeof input.id !== "string"
    || typeof input.automationId !== "string"
    || !targetType
    || !targetId
    || !text
    || !createdAt
    || pinnedX === null
    || pinnedY === null
  ) {
    return [];
  }
  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : createdAt;
  return [{
    id: input.id,
    automationId: input.automationId,
    targetType,
    targetId,
    text,
    createdAt,
    updatedAt,
    pinnedX,
    pinnedY,
    ...(typeof input.manualX === "number" ? { manualX: input.manualX } : {}),
    ...(typeof input.manualY === "number" ? { manualY: input.manualY } : {}),
  }];
}

function normalizeLog(input: unknown): AutomationWorkspaceLog[] {
  if (!isRecord(input)) return [];
  if (
    typeof input.id !== "string"
    || typeof input.automationId !== "string"
    || typeof input.status !== "string"
    || typeof input.summary !== "string"
    || typeof input.startedAt !== "string"
  ) {
    return [];
  }
  return [input as AutomationWorkspaceLog];
}

function normalizeBranchOffsets(input: unknown): AutomationWorkspaceLayout["branchOffsets"] {
  if (!isRecord(input)) return {};
  const normalized: AutomationWorkspaceLayout["branchOffsets"] = {};
  for (const [branchId, offset] of Object.entries(input)) {
    if (!isRecord(offset) || typeof offset.x !== "number" || typeof offset.y !== "number") {
      continue;
    }
    normalized[branchId] = { x: offset.x, y: offset.y };
  }
  return normalized;
}

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function storePath(runtimeRoot: string, fileName: string): string {
  return path.join(runtimeRoot, STORE_DIR, fileName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTargetType(value: unknown): AutomationWorkspaceComment["targetType"] | null {
  return value === "node" || value === "edge" || value === "canvas" ? value : null;
}
