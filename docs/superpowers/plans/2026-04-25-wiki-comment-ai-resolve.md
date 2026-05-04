# Wiki Comment AI Resolve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `AI自动解决` action to Peiweipedia wiki comments that generates a diff-only page edit proposal, confirms it back to the Obsidian source markdown, auto-resolves the comment, and refreshes the current wiki page.

**Architecture:** Keep the current manual comment CRUD flow intact and layer a separate single-draft-per-comment AI workflow on top. Backend work is split into three focused pieces: source-editability detection in the page/read path, a runtime-backed AI draft service that reads source markdown and writes confirmed edits, and dedicated comment-AI routes. Frontend work stays inside the existing wiki comment drawer, adding per-card AI state and a diff review sub-state without changing the page shell.

**Tech Stack:** TypeScript, Express routes, Node fs/path/crypto, existing LLM provider abstraction, DOM rendering, CSS, Vitest with jsdom

---

## File Structure

### Create

- `D:\Desktop\llm-wiki-compiler-main\web\server\services\wiki-comment-ai-drafts.ts`
  - Own runtime draft storage, source-file validation, provider prompt building, diff generation, confirm/discard behavior.
- `D:\Desktop\llm-wiki-compiler-main\test\wiki-comment-ai-drafts.test.ts`
  - Lock service behavior for generate/confirm/discard, stale source rejection, and comment resolution after confirm.
- `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comment-ai-routes.test.ts`
  - Lock route behavior for AI draft create/confirm/discard with mocked service boundaries.

### Modify

- `D:\Desktop\llm-wiki-compiler-main\web\server\runtime-paths.ts`
  - Add a helper that resolves whether a logical wiki page has a writable source-vault markdown target.
- `D:\Desktop\llm-wiki-compiler-main\web\server\routes\pages.ts`
  - Expose `sourceEditable` in the page payload returned to the client.
- `D:\Desktop\llm-wiki-compiler-main\web\server\services\wiki-comments.ts`
  - Add a focused comment lookup helper by `id` so the AI draft service can resolve a comment without forcing the client to resend page path.
- `D:\Desktop\llm-wiki-compiler-main\web\server\routes\wiki-comments.ts`
  - Add handlers for `POST /api/wiki-comments/:id/ai-draft`, `POST /api/wiki-comments/:id/ai-draft/:draftId/confirm`, and `DELETE /api/wiki-comments/:id/ai-draft/:draftId`.
- `D:\Desktop\llm-wiki-compiler-main\web\server\index.ts`
  - Register the new wiki comment AI routes.
- `D:\Desktop\llm-wiki-compiler-main\web\client\src\components\wiki-comments.ts`
  - Add per-comment AI action state, diff review rendering, confirm/discard actions, and the `AI自动解决` button.
- `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\index.ts`
  - Pass `sourceEditable` from page payload into the comment surface and refresh the current page after confirmed source writes.
- `D:\Desktop\llm-wiki-compiler-main\web\client\assets\styles\wiki-launch.css`
  - Style the AI draft review block and action row without changing the rest of the wiki layout.
- `D:\Desktop\llm-wiki-compiler-main\test\web-page-cache.test.ts`
  - Add a page payload test for `sourceEditable`.
- `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`
  - Lock AI button visibility, diff review state, confirm flow, discard flow, and runtime-only page behavior.

### Keep Untouched Unless a Test Forces It

- `D:\Desktop\llm-wiki-compiler-main\web\client\src\shell\*`
- `D:\Desktop\llm-wiki-compiler-main\web\server\services\deep-research.ts`
- `D:\Desktop\llm-wiki-compiler-main\web\client\src\router.ts`

This feature is local to the wiki comment flow. Do not widen the change into review, shell, or routing code unless a failing test proves it is necessary.

---

### Task 1: Lock the Source-Editable Page Contract

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-page-cache.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-page-cache.test.ts`

- [ ] **Step 1: Add the failing test for source-backed vs runtime-only wiki pages**

Append a second test to `test/web-page-cache.test.ts` that proves `handlePage` exposes `sourceEditable` correctly.

```ts
it("marks source-backed wiki pages editable and runtime-only wiki index pages non-editable", () => {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-source-editable-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-source-editable-runtime-"));
  tempDirs.push(sourceVaultRoot, runtimeRoot);

  fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
  fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "test.md"), "# Test\n\nSource page.\n", "utf8");
  fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Index\n\nRuntime page.\n", "utf8");

  const handler = handlePage({
    projectRoot: runtimeRoot,
    sourceVaultRoot,
    runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "me",
  });

  const sourceJson = vi.fn();
  const runtimeJson = vi.fn();

  handler({ query: { path: "wiki/concepts/test.md" } } as never, { json: sourceJson, status: vi.fn() } as never);
  handler({ query: { path: "wiki/index.md" } } as never, { json: runtimeJson, status: vi.fn() } as never);

  expect(sourceJson).toHaveBeenCalledWith(expect.objectContaining({
    path: "wiki/concepts/test.md",
    sourceEditable: true,
  }));
  expect(runtimeJson).toHaveBeenCalledWith(expect.objectContaining({
    path: "wiki/index.md",
    sourceEditable: false,
  }));
});
```

- [ ] **Step 2: Run the focused page route test to verify it fails**

Run: `rtk npm test -- test\web-page-cache.test.ts`

Expected: FAIL because the current page payload does not include `sourceEditable`.

- [ ] **Step 3: Commit the page contract test**

```bash
git add test/web-page-cache.test.ts
git commit -m "test: lock wiki source editable page payload"
```

---

### Task 2: Lock the AI Draft Service Contract

**Files:**
- Create: `D:\Desktop\llm-wiki-compiler-main\test\wiki-comment-ai-drafts.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\wiki-comment-ai-drafts.test.ts`

- [ ] **Step 1: Add the failing generate-and-confirm service test**

Create `test/wiki-comment-ai-drafts.test.ts` with a temp-vault service test that uses a fake provider and the real comment store.

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWikiComment, findWikiCommentById } from "../web/server/services/wiki-comments.js";
import {
  confirmWikiCommentAiDraft,
  discardWikiCommentAiDraft,
  generateWikiCommentAiDraft,
  getWikiCommentAiDraft,
} from "../web/server/services/wiki-comment-ai-drafts.js";
import type { LLMProvider } from "../src/utils/provider.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createFakeProvider(content: string): LLMProvider {
  return {
    complete: vi.fn(async () => content),
    stream: vi.fn(async () => content),
    toolCall: vi.fn(async () => content),
  };
}

describe("wiki comment ai drafts", () => {
  it("generates a diff draft and confirms it back to the source vault", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-comment-ai-project-"));
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-comment-ai-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-comment-ai-runtime-"));
    tempDirs.push(projectRoot, sourceVaultRoot, runtimeRoot);

    const sourceFile = path.join(sourceVaultRoot, "wiki", "crm", "赵宇馨.md");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "# 赵宇馨\n\n- 当前最需要关注的事：待补充\n", "utf8");

    const comment = createWikiComment(runtimeRoot, {
      path: "wiki/crm/赵宇馨.md",
      quote: "当前最需要关注的事",
      text: "把这里改成更明确的近期行动，不要写待补充。",
      start: 9,
      end: 18,
    });

    const provider = createFakeProvider("# 赵宇馨\n\n- 当前最需要关注的事：本周末前整理纪念日清单并确认见面安排\n");

    const draft = await generateWikiCommentAiDraft({
      projectRoot,
      sourceVaultRoot,
      runtimeRoot,
      commentId: comment.id,
      provider,
    });

    expect(draft.commentId).toBe(comment.id);
    expect(draft.pagePath).toBe("wiki/crm/赵宇馨.md");
    expect(draft.diffText).toContain("--- current");
    expect(draft.diffText).toContain("+++ proposed");
    expect(draft.diffText).toContain("当前最需要关注的事");
    expect(getWikiCommentAiDraft(runtimeRoot, comment.id)?.id).toBe(draft.id);

    const confirmed = await confirmWikiCommentAiDraft({
      projectRoot,
      sourceVaultRoot,
      runtimeRoot,
      commentId: comment.id,
      draftId: draft.id,
    });

    expect(confirmed.pagePath).toBe("wiki/crm/赵宇馨.md");
    expect(fs.readFileSync(sourceFile, "utf8")).toContain("本周末前整理纪念日清单并确认见面安排");
    expect(findWikiCommentById(runtimeRoot, comment.id)?.resolved).toBe(true);
    expect(getWikiCommentAiDraft(runtimeRoot, comment.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Add the failing stale-source rejection and discard test**

Keep the same file and add a second test that proves confirm rejects when the source file changes after draft generation, and a third assertion that discard removes only the draft.

```ts
it("rejects confirm when the source file changed after draft generation and preserves the unresolved comment", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-comment-ai-project-"));
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-comment-ai-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-comment-ai-runtime-"));
  tempDirs.push(projectRoot, sourceVaultRoot, runtimeRoot);

  const sourceFile = path.join(sourceVaultRoot, "wiki", "concepts", "test.md");
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, "# Test\n\nAlpha Beta Gamma\n", "utf8");

  const comment = createWikiComment(runtimeRoot, {
    path: "wiki/concepts/test.md",
    quote: "Beta",
    text: "把 Beta 改成更具体的表述。",
    start: 8,
    end: 12,
  });

  const draft = await generateWikiCommentAiDraft({
    projectRoot,
    sourceVaultRoot,
    runtimeRoot,
    commentId: comment.id,
    provider: createFakeProvider("# Test\n\nAlpha Better Gamma\n"),
  });

  fs.writeFileSync(sourceFile, "# Test\n\nAlpha Beta Gamma\n\nManual change.\n", "utf8");

  await expect(confirmWikiCommentAiDraft({
    projectRoot,
    sourceVaultRoot,
    runtimeRoot,
    commentId: comment.id,
    draftId: draft.id,
  })).rejects.toThrow("source file changed");

  expect(findWikiCommentById(runtimeRoot, comment.id)?.resolved).toBe(false);
  expect(getWikiCommentAiDraft(runtimeRoot, comment.id)?.id).toBe(draft.id);

  expect(discardWikiCommentAiDraft(runtimeRoot, comment.id, draft.id)).toBe(true);
  expect(getWikiCommentAiDraft(runtimeRoot, comment.id)).toBeNull();
  expect(findWikiCommentById(runtimeRoot, comment.id)?.resolved).toBe(false);
});
```

- [ ] **Step 3: Run the focused service test to verify it fails**

Run: `rtk npm test -- test\wiki-comment-ai-drafts.test.ts`

Expected: FAIL because the new AI draft service module and `findWikiCommentById()` helper do not exist yet.

- [ ] **Step 4: Commit the service contract test**

```bash
git add test/wiki-comment-ai-drafts.test.ts
git commit -m "test: lock wiki comment ai draft service"
```

---

### Task 3: Lock the Comment AI Routes

**Files:**
- Create: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comment-ai-routes.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comment-ai-routes.test.ts`

- [ ] **Step 1: Add the failing route test with mocked service boundaries**

Create `test/web-wiki-comment-ai-routes.test.ts` and mock the new draft service so route behavior stays focused on request/response contracts.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateWikiCommentAiDraft = vi.fn();
const confirmWikiCommentAiDraft = vi.fn();
const discardWikiCommentAiDraft = vi.fn();

vi.mock("../web/server/services/wiki-comment-ai-drafts.js", () => ({
  generateWikiCommentAiDraft,
  confirmWikiCommentAiDraft,
  discardWikiCommentAiDraft,
}));

const { handleWikiCommentAiDraftCreate, handleWikiCommentAiDraftConfirm, handleWikiCommentAiDraftDiscard } =
  await import("../web/server/routes/wiki-comments.js");

const cfg = {
  projectRoot: "D:/Desktop/llm-wiki-compiler-main",
  sourceVaultRoot: "D:/Desktop/ai的仓库",
  runtimeRoot: "D:/Desktop/llm-wiki-compiler-main/.runtime/ai-vault",
  host: "127.0.0.1",
  port: 4175,
  author: "me",
};

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("wiki comment ai routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an ai draft for a comment id", async () => {
    generateWikiCommentAiDraft.mockResolvedValue({
      id: "draft-1",
      commentId: "comment-1",
      pagePath: "wiki/concepts/test.md",
      diffText: "--- current\n+++ proposed\n@@\n-Alpha\n+Better Alpha",
    });

    const handler = handleWikiCommentAiDraftCreate(cfg);
    const response = createResponse();
    await handler({ params: { id: "comment-1" } } as never, response as never);

    expect(generateWikiCommentAiDraft).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: cfg.projectRoot,
      sourceVaultRoot: cfg.sourceVaultRoot,
      runtimeRoot: cfg.runtimeRoot,
      commentId: "comment-1",
    }));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ id: "draft-1" }),
    }));
  });

  it("confirms an ai draft for a comment id", async () => {
    confirmWikiCommentAiDraft.mockResolvedValue({
      id: "draft-1",
      pagePath: "wiki/concepts/test.md",
    });

    const handler = handleWikiCommentAiDraftConfirm(cfg);
    const response = createResponse();
    await handler({ params: { id: "comment-1", draftId: "draft-1" } } as never, response as never);

    expect(confirmWikiCommentAiDraft).toHaveBeenCalledWith(expect.objectContaining({
      commentId: "comment-1",
      draftId: "draft-1",
    }));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ pagePath: "wiki/concepts/test.md" }),
    }));
  });

  it("discards an ai draft for a comment id", async () => {
    discardWikiCommentAiDraft.mockReturnValue(true);

    const handler = handleWikiCommentAiDraftDiscard(cfg);
    const response = createResponse();
    await handler({ params: { id: "comment-1", draftId: "draft-1" } } as never, response as never);

    expect(discardWikiCommentAiDraft).toHaveBeenCalledWith(cfg.runtimeRoot, "comment-1", "draft-1");
    expect(response.json).toHaveBeenCalledWith({ success: true });
  });
});
```

- [ ] **Step 2: Run the focused route test to verify it fails**

Run: `rtk npm test -- test\web-wiki-comment-ai-routes.test.ts`

Expected: FAIL because the new route handlers do not exist in `web/server/routes/wiki-comments.ts`.

- [ ] **Step 3: Commit the route contract test**

```bash
git add test/web-wiki-comment-ai-routes.test.ts
git commit -m "test: lock wiki comment ai routes"
```

---

### Task 4: Implement the Server-Side AI Draft Flow

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\server\runtime-paths.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\server\routes\pages.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\server\services\wiki-comments.ts`
- Create: `D:\Desktop\llm-wiki-compiler-main\web\server\services\wiki-comment-ai-drafts.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\server\routes\wiki-comments.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\server\index.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-page-cache.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\wiki-comment-ai-drafts.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comment-ai-routes.test.ts`

- [ ] **Step 1: Add a focused helper for editable source wiki paths**

In `web/server/runtime-paths.ts`, add a helper that returns the writable source markdown file or `null`.

```ts
export function resolveEditableSourceMarkdownPath(cfg: ServerConfig, logicalPath: string): string | null {
  const normalized = normalizeLogicalPath(logicalPath);
  if (!(normalized === "wiki" || normalized.startsWith("wiki/"))) {
    return null;
  }
  if (resolveRuntimeWikiLogicalPath(normalized)) {
    return null;
  }
  const sourceCandidate = sourcePath(cfg, normalized);
  if (!pathExists(sourceCandidate)) {
    return null;
  }
  try {
    return fs.statSync(sourceCandidate).isFile() ? sourceCandidate : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Expose `sourceEditable` in the page payload**

In `web/server/routes/pages.ts`, add the new flag where the response object is built.

```ts
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
```

- [ ] **Step 3: Add lookup-by-id support to the comment store**

In `web/server/services/wiki-comments.ts`, add an exported helper without disturbing the existing CRUD signatures.

```ts
export function findWikiCommentById(runtimeRoot: string, id: string): WikiCommentRecord | null {
  const store = readStore(runtimeRoot);
  for (const entries of Object.values(store.commentsByPath)) {
    const match = entries.find((item) => item.id === id);
    if (match) {
      return match;
    }
  }
  return null;
}
```

- [ ] **Step 4: Create the AI draft service with runtime-backed storage and source writes**

Create `web/server/services/wiki-comment-ai-drafts.ts` with a single-draft-per-comment store and explicit public types.

```ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "../../../src/utils/provider.js";
import { resolveAgentRuntimeProvider } from "./llm-chat.js";
import { findWikiCommentById, updateWikiComment, type WikiCommentRecord } from "./wiki-comments.js";

export interface WikiCommentAiDraftRecord {
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
  errorMessage?: string;
}

interface WikiCommentAiDraftStore {
  draftsByCommentId: Record<string, WikiCommentAiDraftRecord>;
}

export interface GenerateWikiCommentAiDraftInput {
  projectRoot: string;
  sourceVaultRoot: string;
  runtimeRoot: string;
  commentId: string;
  provider?: LLMProvider;
}

export interface ConfirmWikiCommentAiDraftInput {
  projectRoot: string;
  sourceVaultRoot: string;
  runtimeRoot: string;
  commentId: string;
  draftId: string;
}

const STORE_DIR = ".llmwiki";
const STORE_FILE = "wiki-comment-ai-drafts.json";

export async function generateWikiCommentAiDraft(input: GenerateWikiCommentAiDraftInput): Promise<WikiCommentAiDraftRecord> {
  const comment = requireSolvableComment(input.runtimeRoot, input.commentId);
  const sourceFile = resolveSourceFile(input.sourceVaultRoot, comment.path);
  const currentSource = fs.readFileSync(sourceFile, "utf8");
  const provider = input.provider ?? resolveAgentRuntimeProvider(input.projectRoot, null, `wiki-comment-ai:${comment.id}`);
  const proposedContent = normalizeDraftMarkdown(await provider.complete(
    buildSystemPrompt(),
    [{ role: "user", content: buildUserPrompt(comment, currentSource) }],
    1400,
  ));
  const now = new Date().toISOString();
  const store = readStore(input.runtimeRoot);
  const draft: WikiCommentAiDraftRecord = {
    id: `draft-${Date.now()}`,
    commentId: comment.id,
    pagePath: comment.path,
    sourceFile,
    baseVersion: createContentVersion(currentSource),
    status: "done-await-confirm",
    promptSummary: comment.text.trim(),
    proposedContent,
    diffText: buildUnifiedLineDiff(currentSource, proposedContent),
    createdAt: now,
    updatedAt: now,
  };
  store.draftsByCommentId[comment.id] = draft;
  writeStore(input.runtimeRoot, store);
  return draft;
}

export async function confirmWikiCommentAiDraft(input: ConfirmWikiCommentAiDraftInput): Promise<{ id: string; pagePath: string }> {
  const draft = requireDraft(input.runtimeRoot, input.commentId, input.draftId);
  const currentSource = fs.readFileSync(draft.sourceFile, "utf8");
  if (createContentVersion(currentSource) !== draft.baseVersion) {
    throw new Error("source file changed after draft generation");
  }
  fs.writeFileSync(draft.sourceFile, ensureTrailingNewline(draft.proposedContent), "utf8");
  const comment = findWikiCommentById(input.runtimeRoot, input.commentId);
  if (!comment) {
    throw new Error("comment not found");
  }
  updateWikiComment(input.runtimeRoot, comment.path, comment.id, { resolved: true });
  discardWikiCommentAiDraft(input.runtimeRoot, input.commentId, input.draftId);
  return { id: draft.id, pagePath: draft.pagePath };
}

export function getWikiCommentAiDraft(runtimeRoot: string, commentId: string): WikiCommentAiDraftRecord | null {
  return readStore(runtimeRoot).draftsByCommentId[commentId] ?? null;
}

export function discardWikiCommentAiDraft(runtimeRoot: string, commentId: string, draftId: string): boolean {
  const store = readStore(runtimeRoot);
  const current = store.draftsByCommentId[commentId];
  if (!current || current.id !== draftId) {
    return false;
  }
  delete store.draftsByCommentId[commentId];
  writeStore(runtimeRoot, store);
  return true;
}
```

Add the tiny focused helpers in the same file:

```ts
function readStore(runtimeRoot: string): WikiCommentAiDraftStore {
  const file = storePath(runtimeRoot);
  if (!fs.existsSync(file)) {
    return { draftsByCommentId: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WikiCommentAiDraftStore>;
    return {
      draftsByCommentId: parsed.draftsByCommentId ?? {},
    };
  } catch {
    return { draftsByCommentId: {} };
  }
}

function writeStore(runtimeRoot: string, store: WikiCommentAiDraftStore): void {
  const file = storePath(runtimeRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

function storePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, STORE_DIR, STORE_FILE);
}

function requireSolvableComment(runtimeRoot: string, commentId: string): WikiCommentRecord {
  const comment = findWikiCommentById(runtimeRoot, commentId);
  if (!comment) throw new Error("comment not found");
  if (comment.resolved) throw new Error("resolved comment cannot start ai solve");
  if (!comment.text.trim()) throw new Error("comment text is required");
  return comment;
}

function requireDraft(runtimeRoot: string, commentId: string, draftId: string): WikiCommentAiDraftRecord {
  const draft = getWikiCommentAiDraft(runtimeRoot, commentId);
  if (!draft || draft.id !== draftId) {
    throw new Error("draft not found");
  }
  return draft;
}

function resolveSourceFile(sourceVaultRoot: string, pagePath: string): string {
  const full = path.join(sourceVaultRoot, ...pagePath.split("/"));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error("page is not source-editable");
  }
  return full;
}

function buildSystemPrompt(): string {
  return [
    "你是 LLM Wiki 的页面修订助手。",
    "你会收到整页 Markdown、评论文本和评论引用。",
    "请直接返回修改后的完整 Markdown 页面内容。",
    "不要解释，不要返回 JSON，不要返回 diff。",
  ].join("\n");
}

function buildUserPrompt(comment: WikiCommentRecord, currentSource: string): string {
  return [
    `页面路径: ${comment.path}`,
    `评论引用: ${comment.quote}`,
    `评论内容: ${comment.text}`,
    "",
    "<current_markdown>",
    currentSource,
    "</current_markdown>",
  ].join("\n");
}

function normalizeDraftMarkdown(raw: string): string {
  const cleaned = raw.trim().replace(/^```(?:markdown)?\s*/u, "").replace(/```$/u, "").trim();
  if (!cleaned) {
    throw new Error("AI 自动解决返回空白草案");
  }
  return cleaned;
}

function createContentVersion(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

function buildUnifiedLineDiff(before: string, after: string): string {
  const beforeLines = before.replace(/\r\n/g, "\n").split("\n");
  const afterLines = after.replace(/\r\n/g, "\n").split("\n");
  const diffLines = ["--- current", "+++ proposed", "@@"];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const left = beforeLines[index];
    const right = afterLines[index];
    if (left === right) {
      if (typeof left === "string") diffLines.push(` ${left}`);
      continue;
    }
    if (typeof left === "string") diffLines.push(`-${left}`);
    if (typeof right === "string") diffLines.push(`+${right}`);
  }
  return diffLines.join("\n");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
```

- [ ] **Step 5: Add the new route handlers and route registration**

In `web/server/routes/wiki-comments.ts`, add three handlers that map cleanly onto the new service.

```ts
import {
  confirmWikiCommentAiDraft,
  discardWikiCommentAiDraft,
  generateWikiCommentAiDraft,
} from "../services/wiki-comment-ai-drafts.js";

export function handleWikiCommentAiDraftCreate(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ success: false, error: "id is required" });
      return;
    }
    try {
      const draft = await generateWikiCommentAiDraft({
        projectRoot: cfg.projectRoot,
        sourceVaultRoot: cfg.sourceVaultRoot,
        runtimeRoot: cfg.runtimeRoot,
        commentId: id,
      });
      res.json({ success: true, data: draft });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleWikiCommentAiDraftConfirm(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").trim();
    const draftId = String(req.params.draftId ?? "").trim();
    if (!id || !draftId) {
      res.status(400).json({ success: false, error: "id and draftId are required" });
      return;
    }
    try {
      const data = await confirmWikiCommentAiDraft({
        projectRoot: cfg.projectRoot,
        sourceVaultRoot: cfg.sourceVaultRoot,
        runtimeRoot: cfg.runtimeRoot,
        commentId: id,
        draftId,
      });
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export function handleWikiCommentAiDraftDiscard(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").trim();
    const draftId = String(req.params.draftId ?? "").trim();
    if (!id || !draftId) {
      res.status(400).json({ success: false, error: "id and draftId are required" });
      return;
    }
    if (!discardWikiCommentAiDraft(cfg.runtimeRoot, id, draftId)) {
      res.status(404).json({ success: false, error: "draft not found" });
      return;
    }
    res.json({ success: true });
  };
}
```

Then register them in `web/server/index.ts`:

```ts
app.post("/api/wiki-comments/:id/ai-draft", handleWikiCommentAiDraftCreate(cfg));
app.post("/api/wiki-comments/:id/ai-draft/:draftId/confirm", handleWikiCommentAiDraftConfirm(cfg));
app.delete("/api/wiki-comments/:id/ai-draft/:draftId", handleWikiCommentAiDraftDiscard(cfg));
```

- [ ] **Step 6: Run the server-side test set to verify it passes**

Run: `rtk npm test -- test\web-page-cache.test.ts test\wiki-comment-ai-drafts.test.ts test\web-wiki-comment-ai-routes.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the server-side AI draft flow**

```bash
git add web/server/runtime-paths.ts web/server/routes/pages.ts web/server/services/wiki-comments.ts web/server/services/wiki-comment-ai-drafts.ts web/server/routes/wiki-comments.ts web/server/index.ts test/web-page-cache.test.ts test/wiki-comment-ai-drafts.test.ts test/web-wiki-comment-ai-routes.test.ts
git commit -m "feat: add wiki comment ai draft backend"
```

---

### Task 5: Lock the Client-Side AI Comment Card Behavior

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`

- [ ] **Step 1: Add the failing visibility test for editable comments only**

In `test/web-wiki-comments.test.ts`, extend the existing editable-page fixture to return `sourceEditable: true`, then assert the new button appears only when the comment has non-empty text.

```ts
it("shows AI自动解决 only for editable unresolved comments with non-empty text", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/tree?")) {
      return ok({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [{
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [{ name: "editable.md", path: "wiki/concepts/editable.md", kind: "file" }],
        }],
      });
    }
    if (url.includes("/api/page?")) {
      return rawOk({
        path: "wiki/concepts/editable.md",
        title: "Editable",
        html: "<h1>Editable</h1><p>Alpha Beta Gamma</p>",
        raw: "# Editable\n\nAlpha Beta Gamma",
        frontmatter: null,
        sourceEditable: true,
        modifiedAt: "2026-04-25T00:00:00.000Z",
      });
    }
    if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Feditable.md") {
      return ok([
        {
          id: "comment-1",
          path: "wiki/concepts/editable.md",
          quote: "Beta",
          text: "把这里改得更明确。",
          start: 6,
          end: 10,
          resolved: false,
          createdAt: "2026-04-25T00:00:00.000Z",
        },
        {
          id: "comment-2",
          path: "wiki/concepts/editable.md",
          quote: "Gamma",
          text: "",
          start: 11,
          end: 16,
          resolved: false,
          createdAt: "2026-04-25T00:01:00.000Z",
        },
      ]);
    }
    throw new Error(`unexpected fetch ${url}`);
  }));

  const page = renderWikiPage("wiki/concepts/editable.md");
  document.body.appendChild(page);
  await waitForText(page, "把这里改得更明确");

  page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
  await flush();

  expect(page.querySelector("[data-wiki-comments-ai=\"comment-1\"]")?.textContent).toContain("AI自动解决");
  expect(page.querySelector("[data-wiki-comments-ai=\"comment-2\"]")).toBeNull();
});
```

- [ ] **Step 2: Add the failing review-state test for generate/confirm/discard**

In the same file, add a second test that covers the diff-only review state and page refresh after confirm.

```ts
it("renders diff review state, confirms the source write, and refreshes the wiki page", async () => {
  let pageHtml = "<h1>Editable</h1><p>Alpha Beta Gamma</p>";

  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/tree?")) {
      return ok({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [{
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [{ name: "editable.md", path: "wiki/concepts/editable.md", kind: "file" }],
        }],
      });
    }
    if (url.includes("/api/page?")) {
      return rawOk({
        path: "wiki/concepts/editable.md",
        title: "Editable",
        html: pageHtml,
        raw: "# Editable\n\nAlpha Beta Gamma",
        frontmatter: null,
        sourceEditable: true,
        modifiedAt: "2026-04-25T00:00:00.000Z",
      });
    }
    if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Feditable.md") {
      return ok([{
        id: "comment-1",
        path: "wiki/concepts/editable.md",
        quote: "Beta",
        text: "把 Beta 改成更具体的动作描述。",
        start: 6,
        end: 10,
        resolved: false,
        createdAt: "2026-04-25T00:00:00.000Z",
      }]);
    }
    if (url === "/api/wiki-comments/comment-1/ai-draft" && init?.method === "POST") {
      return ok({
        id: "draft-1",
        commentId: "comment-1",
        pagePath: "wiki/concepts/editable.md",
        diffText: "--- current\n+++ proposed\n@@\n-Alpha Beta Gamma\n+Alpha Better Gamma",
      });
    }
    if (url === "/api/wiki-comments/comment-1/ai-draft/draft-1/confirm" && init?.method === "POST") {
      pageHtml = "<h1>Editable</h1><p>Alpha Better Gamma</p>";
      return ok({ id: "draft-1", pagePath: "wiki/concepts/editable.md" });
    }
    if (url === "/api/wiki-comments/comment-1/ai-draft/draft-1" && init?.method === "DELETE") {
      return ok(null);
    }
    throw new Error(`unexpected fetch ${url}`);
  }));

  const page = renderWikiPage("wiki/concepts/editable.md");
  document.body.appendChild(page);
  await waitForText(page, "把 Beta 改成更具体的动作描述");

  page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
  await flush();

  page.querySelector<HTMLButtonElement>("[data-wiki-comments-ai=\"comment-1\"]")?.click();
  await waitForText(page, "+++ proposed");

  expect(page.querySelector("[data-wiki-comments-diff=\"comment-1\"]")?.textContent).toContain("Alpha Better Gamma");

  page.querySelector<HTMLButtonElement>("[data-wiki-comments-ai-confirm=\"comment-1\"]")?.click();
  await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Better Gamma");

  expect(page.textContent).toContain("评论已解决");
});
```

- [ ] **Step 3: Add the failing runtime-only page guard test**

Use the runtime wiki index fixture so the test proves the button is absent on non-editable pages.

```ts
it("does not render AI自动解决 for runtime-only wiki pages", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/tree?")) {
      return ok({
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [{ name: "wiki", path: "wiki", kind: "dir", children: [] }],
      });
    }
    if (url.includes("/api/page?")) {
      return rawOk({
        path: "wiki/index.md",
        title: "Index",
        html: "<h1>Index</h1><p>Runtime wiki page.</p>",
        raw: "# Index\n\nRuntime wiki page.",
        frontmatter: null,
        sourceEditable: false,
        modifiedAt: "2026-04-25T00:00:00.000Z",
      });
    }
    if (url === "/api/wiki-comments?path=wiki%2Findex.md") {
      return ok([{
        id: "comment-1",
        path: "wiki/index.md",
        quote: "Runtime",
        text: "这里不能写回真源。",
        start: 0,
        end: 7,
        resolved: false,
        createdAt: "2026-04-25T00:00:00.000Z",
      }]);
    }
    throw new Error(`unexpected fetch ${url}`);
  }));

  const page = renderWikiPage("wiki/index.md");
  document.body.appendChild(page);
  await waitForText(page, "这里不能写回真源");

  page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
  await flush();

  expect(page.querySelector("[data-wiki-comments-ai=\"comment-1\"]")).toBeNull();
});
```

- [ ] **Step 4: Run the focused client comment test to verify it fails**

Run: `rtk npm test -- test\web-wiki-comments.test.ts`

Expected: FAIL because the current comment UI has no `AI自动解决` button, no diff review state, and no `sourceEditable` handling.

- [ ] **Step 5: Commit the client contract tests**

```bash
git add test/web-wiki-comments.test.ts
git commit -m "test: lock wiki comment ai resolve ui"
```

---

### Task 6: Implement the Comment Card AI Resolve UI

**Files:**
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\src\components\wiki-comments.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\src\pages\wiki\index.ts`
- Modify: `D:\Desktop\llm-wiki-compiler-main\web\client\assets\styles\wiki-launch.css`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`

- [ ] **Step 1: Extend the page payload and comment surface contracts**

In `web/client/src/pages/wiki/index.ts`, add `sourceEditable` to the page response interface and pass it into the comment surface.

```ts
interface WikiPageResponse {
  path: string;
  title: string | null;
  html: string;
  raw: string;
  frontmatter: Record<string, unknown> | null;
  aliases?: string[];
  sizeBytes?: number;
  modifiedAt?: string;
  sourceEditable?: boolean;
}
```

Then update the call site:

```ts
await comments.setDocument(page.path, page.html || "", {
  sourceEditable: page.sourceEditable === true,
  refreshPage: async () => {
    await loadWikiPage(root, refs, controller.signal, comments, selectionToolbar, root.dataset.wikiCurrentAnchor ?? "");
  },
});
```

- [ ] **Step 2: Add explicit AI draft state to the comment surface**

In `web/client/src/components/wiki-comments.ts`, add strict local types and an options bag instead of leaking booleans around.

```ts
export interface WikiCommentAiDraft {
  id: string;
  commentId: string;
  pagePath: string;
  diffText: string;
}

interface WikiCommentSurfaceDocumentOptions {
  sourceEditable: boolean;
  refreshPage?: () => Promise<void>;
}

interface WikiCommentCardState {
  busy: "idle" | "generating" | "confirming" | "discarding";
  error: string | null;
  draft: WikiCommentAiDraft | null;
}
```

Track a `Map<string, WikiCommentCardState>` inside the surface controller, and make the document options explicit at the controller boundary.

```ts
let documentOptions: WikiCommentSurfaceDocumentOptions = { sourceEditable: false };
const cardStates = new Map<string, WikiCommentCardState>();

function ensureCardState(id: string): WikiCommentCardState {
  const existing = cardStates.get(id);
  if (existing) {
    return existing;
  }
  const created: WikiCommentCardState = {
    busy: "idle",
    error: null,
    draft: null,
  };
  cardStates.set(id, created);
  return created;
}

function clearCardState(id: string): void {
  cardStates.delete(id);
}
```

Update the controller contract and setter body at the same time:

```ts
export interface WikiCommentSurfaceController {
  setDocument(path: string, html: string, options?: WikiCommentSurfaceDocumentOptions): Promise<void>;
  clear(message: string): void;
  toggle(): void;
  createFromSelection(selection: WikiCommentSelection | null): Promise<void>;
}

async setDocument(path: string, html: string, options: WikiCommentSurfaceDocumentOptions = { sourceEditable: false }): Promise<void> {
  currentPath = path;
  baseHtml = html;
  documentOptions = options;
  cardStates.clear();
  content.innerHTML = html;
  if (!path) {
    comments = [];
    renderComments();
    return;
  }
  await refreshComments();
},
```

- [ ] **Step 3: Render the new AI button only when allowed**

Update `renderComments()` so unresolved comments with non-empty text and `sourceEditable === true` get the new action button.

```ts
list.innerHTML = comments.map((comment) => {
  const canAiResolve = documentOptions.sourceEditable && !comment.resolved && comment.text.trim().length > 0;
  const cardState = ensureCardState(comment.id);
  if (cardState.draft) {
    return `
      <article class="wiki-comments-panel__card" data-wiki-comments-card="${escapeHtml(comment.id)}">
        <blockquote>${escapeHtml(comment.quote)}</blockquote>
        <pre class="wiki-comments-panel__diff" data-wiki-comments-diff="${escapeHtml(comment.id)}">${escapeHtml(cardState.draft.diffText)}</pre>
        <div class="wiki-comments-panel__actions">
          <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-ai-confirm="${escapeHtml(comment.id)}">确认写回</button>
          <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-ai-discard="${escapeHtml(comment.id)}">放弃草案</button>
        </div>
      </article>
    `;
  }
  return `
    <article class="wiki-comments-panel__card" data-wiki-comments-card="${escapeHtml(comment.id)}">
      <blockquote>${escapeHtml(comment.quote)}</blockquote>
      <textarea class="wiki-comments-panel__input" data-wiki-comments-input="${escapeHtml(comment.id)}">${escapeHtml(comment.text)}</textarea>
      ${cardState.error ? `<p class="wiki-comments-panel__error">${escapeHtml(cardState.error)}</p>` : ""}
      <div class="wiki-comments-panel__actions">
        <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-save>保存</button>
        <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-resolve>${comment.resolved ? "重新打开" : "解决"}</button>
        ${canAiResolve ? `<button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-ai="${escapeHtml(comment.id)}" ${cardState.busy !== "idle" ? "disabled" : ""}>${cardState.busy === "generating" ? "生成中..." : "AI自动解决"}</button>` : ""}
        <button type="button" class="btn btn-secondary btn-inline" data-wiki-comments-delete>删除</button>
      </div>
    </article>
  `;
}).join("");
```

- [ ] **Step 4: Add generate/confirm/discard click handling**

Still in `wiki-comments.ts`, add three focused async helpers and wire them through the existing delegated click listener.

```ts
if (target.closest("[data-wiki-comments-ai-confirm]")) {
  void confirmAiDraft(id);
  return;
}
if (target.closest("[data-wiki-comments-ai-discard]")) {
  void discardAiDraft(id);
  return;
}
if (target.closest("[data-wiki-comments-ai]")) {
  void generateAiDraft(id);
  return;
}
```

Then implement the helpers:

```ts
async function generateAiDraft(id: string): Promise<void> {
  const state = ensureCardState(id);
  state.busy = "generating";
  state.error = null;
  renderComments();
  try {
    const response = await fetch(`/api/wiki-comments/${encodeURIComponent(id)}/ai-draft`, { method: "POST" });
    const payload = await readApiResponse<WikiCommentAiDraft>(response, "生成 AI 草案失败。");
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "failed to generate ai draft");
    }
    state.draft = payload.data;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = "idle";
    renderComments();
  }
}

async function confirmAiDraft(id: string): Promise<void> {
  const state = ensureCardState(id);
  if (!state.draft || !documentOptions.refreshPage) {
    return;
  }
  state.busy = "confirming";
  renderComments();
  try {
    const response = await fetch(`/api/wiki-comments/${encodeURIComponent(id)}/ai-draft/${encodeURIComponent(state.draft.id)}/confirm`, { method: "POST" });
    const payload = await readApiResponse<{ pagePath: string }>(response, "写回真源失败。");
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? "failed to confirm ai draft");
    }
    clearCardState(id);
    await documentOptions.refreshPage();
    status.textContent = "评论已解决。";
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.busy = "idle";
    renderComments();
  }
}

async function discardAiDraft(id: string): Promise<void> {
  const state = ensureCardState(id);
  if (!state.draft) {
    return;
  }
  state.busy = "discarding";
  renderComments();
  try {
    const response = await fetch(`/api/wiki-comments/${encodeURIComponent(id)}/ai-draft/${encodeURIComponent(state.draft.id)}`, { method: "DELETE" });
    const payload = await readApiResponse<null>(response, "放弃 AI 草案失败。");
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? "failed to discard ai draft");
    }
    clearCardState(id);
    renderComments();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.busy = "idle";
    renderComments();
  }
}
```

- [ ] **Step 5: Add minimal styling for diff review**

In `web/client/assets/styles/wiki-launch.css`, add only the review-state styles needed for the new comment card content.

```css
.wiki-comments-panel__diff {
  margin: 0;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: #fbfbfd;
  color: #1f2937;
  white-space: pre-wrap;
  word-break: break-word;
  font: 13px/1.6 "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.wiki-comments-panel__error {
  margin: 10px 0 0;
  color: #9a3412;
  font-size: 13px;
}
```

- [ ] **Step 6: Run the focused client test to verify it passes**

Run: `rtk npm test -- test\web-wiki-comments.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the client-side AI resolve flow**

```bash
git add web/client/src/components/wiki-comments.ts web/client/src/pages/wiki/index.ts web/client/assets/styles/wiki-launch.css test/web-wiki-comments.test.ts
git commit -m "feat: add ai resolve flow to wiki comment cards"
```

---

### Task 7: Run Regression and Build Verification

**Files:**
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-page-cache.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\wiki-comment-ai-drafts.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comment-ai-routes.test.ts`
- Test: `D:\Desktop\llm-wiki-compiler-main\test\web-wiki-comments.test.ts`

- [ ] **Step 1: Run the targeted feature test pack**

Run: `rtk npm test -- test\web-page-cache.test.ts test\wiki-comment-ai-drafts.test.ts test\web-wiki-comment-ai-routes.test.ts test\web-wiki-comments.test.ts`

Expected: PASS

- [ ] **Step 2: Run the adjacent wiki regression pack**

Run: `rtk npm test -- test\web-wiki-page.test.ts test\web-router.test.ts test\web-page-access-retention.test.ts`

Expected: PASS

- [ ] **Step 3: Run the web build**

Run: `rtk npm run web:build`

Expected: build succeeds

- [ ] **Step 4: Run the desktop WebUI build**

Run: `rtk npm run desktop:webui:build`

Expected: build succeeds

- [ ] **Step 5: Run the launcher build**

Run: `rtk npm run desktop:webui:launcher:build`

Expected: build succeeds and the launcher remains the desktop entry point.

- [ ] **Step 6: Commit the verified end-to-end feature**

```bash
git add web/server/runtime-paths.ts web/server/routes/pages.ts web/server/services/wiki-comments.ts web/server/services/wiki-comment-ai-drafts.ts web/server/routes/wiki-comments.ts web/server/index.ts web/client/src/components/wiki-comments.ts web/client/src/pages/wiki/index.ts web/client/assets/styles/wiki-launch.css test/web-page-cache.test.ts test/wiki-comment-ai-drafts.test.ts test/web-wiki-comment-ai-routes.test.ts test/web-wiki-comments.test.ts
git commit -m "feat: add ai resolve workflow for wiki comments"
```

---

## Spec Coverage Check

- add `AI自动解决` button on comment cards: covered by Task 5 and Task 6
- only unresolved, non-empty, source-editable comments can use it: covered by Task 1, Task 4, and Task 5
- generate diff-only draft from comment text + quote + whole source page: covered by Task 2 and Task 4
- write confirmed edits back to Obsidian source vault: covered by Task 2 and Task 4
- auto-resolve comment after confirmed write: covered by Task 2 and Task 4
- refresh current wiki page after confirmed write: covered by Task 5 and Task 6
- reject runtime-only pages and stale source writes: covered by Task 1, Task 2, Task 3, and Task 4

## Placeholder Scan

- no TODO/TBD markers
- every task names exact files
- every verification step includes exact commands
- code steps use concrete function names, route names, and payload shapes

## Type Consistency Check

- page payload uses `sourceEditable` consistently in server and client
- AI route names consistently use `ai-draft`
- service function names consistently use `generateWikiCommentAiDraft`, `confirmWikiCommentAiDraft`, and `discardWikiCommentAiDraft`
- frontend review actions consistently use `data-wiki-comments-ai`, `data-wiki-comments-ai-confirm`, and `data-wiki-comments-ai-discard`
