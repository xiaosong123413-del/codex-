import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "../../../src/utils/provider.js";
import { resolveEditableSourceMarkdownPath } from "../runtime-paths.js";
import { type ServerConfig } from "../config.js";
import { resolveAgentRuntimeProvider } from "./llm-chat.js";
import { findWikiCommentById, updateWikiComment } from "./wiki-comments.js";

interface WikiCommentAiDraftRecord {
  id: string;
  commentId: string;
  pagePath: string;
  sourceFile: string;
  baseVersion: string;
  status: "done-await-confirm";
  promptSummary: string;
  proposedContent: string;
  diffText: string;
  createdAt: string;
  updatedAt: string;
}

interface WikiCommentAiDraftStore {
  draftsByCommentId: Record<string, WikiCommentAiDraftRecord>;
}

interface GenerateWikiCommentAiDraftInput {
  projectRoot: string;
  sourceVaultRoot: string;
  runtimeRoot: string;
  commentId: string;
  provider?: LLMProvider;
}

interface ConfirmWikiCommentAiDraftInput {
  projectRoot: string;
  sourceVaultRoot: string;
  runtimeRoot: string;
  commentId: string;
  draftId: string;
}

interface ConfirmWikiCommentAiDraftResult {
  id: string;
  pagePath: string;
}

const STORE_DIR = ".llmwiki";
const STORE_FILE = "wiki-comment-ai-drafts.json";

export async function generateWikiCommentAiDraft(
  input: GenerateWikiCommentAiDraftInput,
): Promise<WikiCommentAiDraftRecord> {
  const comment = requireSolvableComment(input.runtimeRoot, input.commentId);

  const cfg = toServerConfig(input);
  const sourceFile = resolveEditableSourceMarkdownPath(cfg, comment.path);
  if (!sourceFile) {
    throw new Error("source file not editable");
  }

  const currentSource = fs.readFileSync(sourceFile, "utf8");
  const provider = input.provider ?? resolveAgentRuntimeProvider(input.projectRoot, null, `wiki-comment-ai-draft:${comment.id}`);
  const promptSummary = buildPromptSummary(comment, currentSource);
  const proposedContent = normalizeWrittenMarkdown(await provider.complete(
    "You rewrite the source markdown to address the comment. Return only the full updated markdown.",
    [{ role: "user", content: promptSummary }],
    1600,
  ));

  const now = new Date().toISOString();
  const draft: WikiCommentAiDraftRecord = {
    id: `draft-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    commentId: comment.id,
    pagePath: comment.path,
    sourceFile,
    baseVersion: hashContent(currentSource),
    status: "done-await-confirm",
    promptSummary,
    proposedContent,
    diffText: buildDiffText(currentSource, proposedContent),
    createdAt: now,
    updatedAt: now,
  };

  const store = readStore(input.runtimeRoot);
  store.draftsByCommentId[comment.id] = draft;
  writeStore(input.runtimeRoot, store);
  return draft;
}

export function getWikiCommentAiDraft(runtimeRoot: string, commentId: string): WikiCommentAiDraftRecord | null {
  const store = readStore(runtimeRoot);
  return store.draftsByCommentId[commentId] ?? null;
}

export async function confirmWikiCommentAiDraft(
  input: ConfirmWikiCommentAiDraftInput,
): Promise<ConfirmWikiCommentAiDraftResult> {
  const draft = getWikiCommentAiDraft(input.runtimeRoot, input.commentId);
  if (!draft || draft.id !== input.draftId) {
    throw new Error("draft not found");
  }

  const comment = findWikiCommentById(input.runtimeRoot, input.commentId);
  if (!comment) {
    throw new Error("comment not found");
  }

  const currentSource = fs.readFileSync(draft.sourceFile, "utf8");
  if (hashContent(currentSource) !== draft.baseVersion) {
    throw new Error("source file changed");
  }

  fs.mkdirSync(path.dirname(draft.sourceFile), { recursive: true });
  fs.writeFileSync(draft.sourceFile, normalizeWrittenMarkdown(draft.proposedContent), "utf8");
  updateWikiComment(input.runtimeRoot, comment.path, comment.id, { resolved: true });

  const store = readStore(input.runtimeRoot);
  delete store.draftsByCommentId[input.commentId];
  writeStore(input.runtimeRoot, store);

  return {
    id: draft.id,
    pagePath: draft.pagePath,
  };
}

export function discardWikiCommentAiDraft(runtimeRoot: string, commentId: string, draftId: string): boolean {
  const store = readStore(runtimeRoot);
  const draft = store.draftsByCommentId[commentId];
  if (!draft || draft.id !== draftId) {
    return false;
  }
  delete store.draftsByCommentId[commentId];
  writeStore(runtimeRoot, store);
  return true;
}

function toServerConfig(input: GenerateWikiCommentAiDraftInput): ServerConfig {
  return {
    projectRoot: input.projectRoot,
    sourceVaultRoot: input.sourceVaultRoot,
    runtimeRoot: input.runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "me",
  };
}

function buildPromptSummary(
  comment: { path: string; quote: string; text: string },
  sourceMarkdown: string,
): string {
  return [
    `page: ${comment.path}`,
    `quote: ${comment.quote}`,
    `comment: ${comment.text}`,
    "",
    sourceMarkdown,
  ].join("\n");
}

function requireSolvableComment(
  runtimeRoot: string,
  commentId: string,
): { id: string; path: string; quote: string; text: string } {
  const comment = findWikiCommentById(runtimeRoot, commentId);
  if (!comment) {
    throw new Error("comment not found");
  }
  if (comment.resolved) {
    throw new Error("comment already resolved");
  }
  if (!comment.text.trim()) {
    throw new Error("comment text is required");
  }
  return comment;
}

function buildDiffText(currentContent: string, proposedContent: string): string {
  return [
    "--- current",
    "+++ proposed",
    "@@",
    `-${trimTrailingNewline(currentContent)}`,
    `+${trimTrailingNewline(proposedContent)}`,
  ].join("\n");
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\n$/, "");
}

function normalizeWrittenMarkdown(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function hashContent(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readStore(runtimeRoot: string): WikiCommentAiDraftStore {
  const file = storePath(runtimeRoot);
  if (!fs.existsSync(file)) {
    return { draftsByCommentId: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WikiCommentAiDraftStore>;
    if (!parsed || typeof parsed !== "object" || !parsed.draftsByCommentId || typeof parsed.draftsByCommentId !== "object") {
      return { draftsByCommentId: {} };
    }
    const draftsByCommentId: Record<string, WikiCommentAiDraftRecord> = {};
    for (const [commentId, draft] of Object.entries(parsed.draftsByCommentId as Record<string, unknown>)) {
      const normalized = normalizeDraft(draft);
      if (normalized) {
        draftsByCommentId[commentId] = normalized;
      }
    }
    return { draftsByCommentId };
  } catch {
    return { draftsByCommentId: {} };
  }
}

// fallow-ignore-next-line complexity
function normalizeDraft(value: unknown): WikiCommentAiDraftRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<WikiCommentAiDraftRecord>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.commentId !== "string"
    || typeof candidate.pagePath !== "string"
    || typeof candidate.sourceFile !== "string"
    || typeof candidate.baseVersion !== "string"
    || candidate.status !== "done-await-confirm"
    || typeof candidate.promptSummary !== "string"
    || typeof candidate.proposedContent !== "string"
    || typeof candidate.diffText !== "string"
    || typeof candidate.createdAt !== "string"
    || typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }
  return candidate as WikiCommentAiDraftRecord;
}

function writeStore(runtimeRoot: string, store: WikiCommentAiDraftStore): void {
  const file = storePath(runtimeRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

function storePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, STORE_DIR, STORE_FILE);
}
