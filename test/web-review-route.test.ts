import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkStaleClaims } from "../src/linter/lifecycle-rules.js";
import { aggregateReviewItems } from "../web/server/services/review-aggregator.js";
import {
  handleDeepResearchAction,
  handleDeepResearchBulkAdvance,
  handleDeepResearchBulkConfirm,
  handleDeepResearchChat,
  handleDeepResearchConfirm,
  handleReviewInboxBatchIngest,
  handleReviewSummary,
} from "../web/server/routes/review.js";

const { searchAll } = vi.hoisted(() => ({
  searchAll: vi.fn(),
}));
const tempRoots: string[] = [];

vi.mock("../web/server/services/search-orchestrator.js", () => ({
  searchAll,
}));

describe("review route web search suggestions", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    searchAll.mockReset();
    searchAll.mockResolvedValue({
      scope: "web",
      mode: "keyword",
      local: {
        mode: "keyword",
        results: [],
      },
      web: {
        results: [{ title: "External source", url: "https://example.com", snippet: "补证结果" }],
      },
    });
  });

  it("reads cached web suggestions without running network search on review load", async () => {
    const json = vi.fn();
    const cfg = makeConfig();
    fs.writeFileSync(
      path.join(cfg.runtimeRoot, ".llmwiki", "review-web-search-suggestions.json"),
      JSON.stringify({
        "deep-research-check-citation-gap": [
          { title: "External source", url: "https://example.com", snippet: "补证结果" },
        ],
      }, null, 2),
      "utf8",
    );
    const handler = handleReviewSummary(
      {
        sourceVaultRoot: cfg.sourceVaultRoot,
        runtimeRoot: cfg.runtimeRoot,
        projectRoot: cfg.projectRoot,
        port: cfg.port,
        host: cfg.host,
        author: cfg.author,
      },
      {
        getCurrent() {
          return null;
        },
      } as never,
    );

    await handler({} as never, { json } as never);

    expect(searchAll).not.toHaveBeenCalled();
    const payload = json.mock.calls[0]?.[0] as {
      success: boolean;
      data: {
        items: Array<{ id: string; webSearchSuggestions?: unknown[] }>;
      };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.items.find((item) => item.id === "deep-research-check-citation-gap")?.webSearchSuggestions).toEqual([
      { title: "External source", url: "https://example.com", snippet: "补证结果" },
    ]);
  });

  it("starts a deep-research background task and persists running state", async () => {
    const cfg = makeCitationRewriteConfig();
    const response = createResponse();

    await handleDeepResearchAction(cfg)(
      { params: { id: "deep-research-check-citation-gap" }, body: { action: "add-citation" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.deepResearch.status).toBe("running");

    await wait(120);

    const stored = JSON.parse(
      fs.readFileSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ status: string; draftResult?: { mode: string; summary: string; preview: string } }>;
    expect(stored[0]?.status).toBe("done-await-confirm");
    expect(stored[0]?.draftResult?.summary).toContain("补引用");
    expect(stored[0]?.draftResult?.mode).toBe("rewrite-citations");
    expect(stored[0]?.draftResult?.preview).toContain("legacy__AI知识库构建__deadbeef12.md");
  });

  it("resumes persisted running deep-research items when review summary loads after a restart", async () => {
    const cfg = makeCitationRewriteConfig({
      status: "running",
      progress: 68,
      selectedAction: "add-citation",
    });
    const json = vi.fn();

    await handleReviewSummary(
      cfg,
      {
        getCurrent() {
          return null;
        },
      } as never,
    )({} as never, { json } as never);

    expect(json).toHaveBeenCalled();

    await wait(120);

    const stored = JSON.parse(
      fs.readFileSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ status: string; draftResult?: { summary: string } }>;
    expect(stored[0]?.status).toBe("done-await-confirm");
    expect(stored[0]?.draftResult?.summary).toContain("补引用");
  });

  it("confirms a deep-research draft by appending it to the target page", async () => {
    const cfg = makeConfig({
      status: "done-await-confirm",
      progress: 100,
      selectedAction: "add-citation",
      draftResult: {
        mode: "append",
        pagePath: "wiki/concepts/example.md",
        summary: "补引用草案",
        preview: "建议补上稳定来源。",
        content: "<!-- deep-research:deep-research-check-citation-gap -->\n## 补引用草案\n- 建议补上稳定来源。",
      },
    });
    const response = createResponse();

    await handleDeepResearchConfirm(cfg)(
      { params: { id: "deep-research-check-citation-gap" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.deepResearch.status).toBe("completed");
    const pageContent = fs.readFileSync(path.join(cfg.sourceVaultRoot, "wiki", "concepts", "example.md"), "utf8");
    expect(pageContent).toContain("## 补引用草案");
  });

  it("refreshes the matching stale claim record when an outdated-source rewrite is confirmed", async () => {
    const cfg = makeOutdatedSourceConfig({
      status: "done-await-confirm",
      progress: 100,
      selectedAction: "start-rewrite",
      draftResult: {
        mode: "append",
        pagePath: "wiki/concepts/example.md",
        summary: "发起改写草案",
        preview: "需要用新来源替换旧表述。",
        content: "<!-- deep-research:deep-research-check-stale-claim -->\n## 发起改写草案\n- 建议用新来源替换旧表述。",
      },
    });
    const response = createResponse();

    await handleDeepResearchConfirm(cfg)(
      { params: { id: "deep-research-check-stale-claim" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.deepResearch.status).toBe("completed");

    const claims = JSON.parse(
      fs.readFileSync(path.join(cfg.sourceVaultRoot, ".llmwiki", "claims.json"), "utf8"),
    ) as Array<{
      claimText: string;
      status: string;
      retention: number;
      lastConfirmedAt: string;
    }>;
    const updatedClaim = claims.find((claim) => claim.claimText.includes("付费成功但 Antigravity 仍识别为受限状态"));
    expect(updatedClaim?.status).toBe("active");
    expect(updatedClaim?.retention).toBe(1);
    expect(updatedClaim?.lastConfirmedAt).toMatch(/^20\d\d-\d\d-\d\dT/);

    const staleResults = await checkStaleClaims(cfg.sourceVaultRoot);
    expect(staleResults).toHaveLength(0);
  });

  it("backfills legacy outdated-source confirmations and clears duplicate stale review cards", async () => {
    const cfg = makeOutdatedSourceConfig({
      pageContent: [
        "# Example",
        "",
        "## 置信度概览",
        "",
        "- 付费成功与桌面端识别成功并非同一件事，Google AI Developers Forum 在 2025 年 12 月已出现过付费成功但 Antigravity 仍识别为受限状态的反馈。（confidence 0.22 / retention 0.05 / last confirmed 2025-12）",
        "",
        "<!-- deep-research:deep-research-check-stale-claim -->",
        "## 发起改写草案",
        "- 问题类型：新来源已取代的过时表述",
        "- 页面：wiki/concepts/example.md",
        "- 处理动作：发起改写",
        "- 对象：付费成功与桌面端识别成功并非同一件事，Google AI Developers Forum 在 2025 年 12 月已出现过付费成功但 Antigravity 仍识别为受限状态的反馈。",
        "- 触发依据：这条结论保留度只有 0.05，最近确认时间是 2025-12，需要用新来源替换旧表述。",
      ].join("\n"),
    });
    const json = vi.fn();

    await handleReviewSummary(
      cfg,
      {
        getCurrent() {
          return null;
        },
      } as never,
    )({} as never, { json } as never);

    const payload = json.mock.calls[0]?.[0] as {
      success: boolean;
      data: {
        items: Array<{ id: string }>;
      };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.items.some((item) => item.id === "deep-research-check-stale-claim")).toBe(false);

    const claims = JSON.parse(
      fs.readFileSync(path.join(cfg.sourceVaultRoot, ".llmwiki", "claims.json"), "utf8"),
    ) as Array<{
      claimText: string;
      status: string;
      retention: number;
      lastConfirmedAt: string;
    }>;
    const updatedClaim = claims.find((claim) => claim.claimText.includes("付费成功但 Antigravity 仍识别为受限状态"));
    expect(updatedClaim?.status).toBe("active");
    expect(updatedClaim?.retention).toBe(1);
    expect(updatedClaim?.lastConfirmedAt).toMatch(/^20\d\d-\d\d-\d\dT/);

    const stored = JSON.parse(
      fs.readFileSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ id: string; status: string; progress: number }>;
    expect(stored.find((item) => item.id === "deep-research-check-stale-claim")).toMatchObject({
      status: "completed",
      progress: 100,
    });
  });

  it("confirms a citation rewrite draft by replacing broken citations, stripping legacy repair blocks, and clearing resolved cards", async () => {
    const cfg = makeCitationRewriteConfig({
      status: "done-await-confirm",
      progress: 100,
      selectedAction: "add-citation",
      draftResult: {
        mode: "rewrite-citations",
        pagePath: "wiki/concepts/example.md",
        summary: "补引用修改草案",
        preview: "把 legacy__AI知识库构建__deadbeef12.md 替换为 sources/clip__AI知识库构建__12345678.md。",
        content: "把整页的失效引用替换成现存来源，并清理旧补引用草案。",
        citationTarget: "legacy__AI知识库构建__deadbeef12.md",
        replacementCitation: "clip__AI知识库构建__12345678.md",
      },
    });
    const response = createResponse();

    await handleDeepResearchConfirm(cfg)(
      { params: { id: "deep-research-check-citation-gap" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.deepResearch.status).toBe("completed");

    const pageContent = fs.readFileSync(path.join(cfg.sourceVaultRoot, "wiki", "concepts", "example.md"), "utf8");
    expect(pageContent).toContain("^[clip__AI知识库构建__12345678.md]");
    expect(pageContent).toContain("^[keep.md, clip__AI知识库构建__12345678.md]");
    expect(pageContent).not.toContain("legacy__AI知识库构建__deadbeef12.md");
    expect(pageContent).not.toContain("## 补引用草案");

    const summary = aggregateReviewItems({
      sourceVaultRoot: cfg.sourceVaultRoot,
      runtimeRoot: cfg.runtimeRoot,
      projectRoot: cfg.projectRoot,
    });
    expect(summary.items.some((item) => item.kind === "deep-research" && item.target === "wiki/concepts/example.md")).toBe(false);
  });

  it("drops a broken citation entirely when no replacement source exists", async () => {
    const cfg = makeCitationRewriteConfig({
      withReplacementSource: false,
      status: "done-await-confirm",
      progress: 100,
      selectedAction: "add-citation",
      draftResult: {
        mode: "rewrite-citations",
        pagePath: "wiki/concepts/example.md",
        summary: "补引用修改草案",
        preview: "删除 legacy__AI知识库构建__deadbeef12.md 的失效引用。",
        content: "删除整页失效引用，并清理旧补引用草案。",
        citationTarget: "legacy__AI知识库构建__deadbeef12.md",
      },
    });
    const response = createResponse();

    await handleDeepResearchConfirm(cfg)(
      { params: { id: "deep-research-check-citation-gap" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    const pageContent = fs.readFileSync(path.join(cfg.sourceVaultRoot, "wiki", "concepts", "example.md"), "utf8");
    expect(pageContent).not.toContain("^[legacy__AI知识库构建__deadbeef12.md]");
    expect(pageContent).toContain("^[keep.md]");
    expect(pageContent).not.toContain("## 补引用草案");
  });

  it("creates a seeded chat thread for a deep-research item", async () => {
    const cfg = makeConfig();
    const response = createResponse();

    await handleDeepResearchChat(cfg)(
      { params: { id: "deep-research-check-citation-gap" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    const chatId = response.body.data.id as string;
    const messages = JSON.parse(
      fs.readFileSync(path.join(cfg.sourceVaultRoot, ".llm-wiki", "chats", `${chatId}.json`), "utf8"),
    ) as Array<{ content: string }>;
    expect(messages[0]?.content).toContain("页面：wiki/concepts/example.md");
    expect(messages[0]?.content).toContain("触发依据");
  });

  it("bulk-advances pending items without auto-confirming ready drafts", async () => {
    const cfg = makeConfigWithBulkItems();
    const response = createResponse();

    await handleDeepResearchBulkAdvance(cfg)(
      {} as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.started).toBe(2);
    expect(response.body.data.confirmed).toBe(0);
    expect(response.body.data.skipped).toBe(2);

    await waitFor(() => {
      const stored = JSON.parse(
        fs.readFileSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
      ) as Array<{ id: string; status: string }>;
      return stored.find((item) => item.id === "bulk-pending-citation")?.status === "done-await-confirm"
        && stored.find((item) => item.id === "bulk-pending-research")?.status === "done-await-confirm";
    });

    const stored = JSON.parse(
      fs.readFileSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ id: string; status: string }>;
    expect(stored.find((item) => item.id === "bulk-pending-citation")?.status).toBe("done-await-confirm");
    expect(stored.find((item) => item.id === "bulk-pending-research")?.status).toBe("done-await-confirm");
    expect(stored.find((item) => item.id === "bulk-confirm")?.status).toBe("done-await-confirm");
    expect(stored.find((item) => item.id === "bulk-failed")?.status).toBe("failed");
    const pageContent = fs.readFileSync(path.join(cfg.sourceVaultRoot, "wiki", "concepts", "confirm.md"), "utf8");
    expect(pageContent).not.toContain("## 已确认草案");
  });

  it("bulk-confirms ready drafts from the toolbar write-all action", async () => {
    const cfg = makeConfigWithBulkItems();
    const response = createResponse();

    await handleDeepResearchBulkConfirm(cfg)(
      {} as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.confirmed).toBe(1);
    expect(response.body.data.failed).toBe(0);
    expect(response.body.data.skipped).toBe(3);

    const stored = JSON.parse(
      fs.readFileSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ id: string; status: string }>;
    expect(stored.find((item) => item.id === "bulk-confirm")?.status).toBe("completed");
    const pageContent = fs.readFileSync(path.join(cfg.sourceVaultRoot, "wiki", "concepts", "confirm.md"), "utf8");
    expect(pageContent).toContain("## 已确认草案");
  });

  it("queues review inbox items for priority batch ingest", async () => {
    const cfg = makeConfig();
    fs.mkdirSync(path.join(cfg.sourceVaultRoot, "inbox"), { recursive: true });
    fs.writeFileSync(path.join(cfg.sourceVaultRoot, "inbox", "source.md"), "# Source\n\nBody\n", "utf8");
    const response = createResponse();

    await handleReviewInboxBatchIngest(cfg)(
      {
        body: {
          targets: ["inbox/source.md"],
        },
      } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.queued).toBe(1);
    expect(response.body.data.skipped).toBe(0);

    const queueFile = path.join(cfg.runtimeRoot, ".llmwiki", "review-inbox-batch-ingest.json");
    expect(fs.existsSync(queueFile)).toBe(true);
    const queued = JSON.parse(fs.readFileSync(queueFile, "utf8")) as {
      items: Array<{ target: string }>;
    };
    expect(queued.items).toEqual([{ target: "inbox/source.md", queuedAt: expect.any(String) }]);
  });

  it("keeps deep-research state in runtime root while writing confirmed drafts into the source vault", async () => {
    const cfg = makeConfig({
      status: "done-await-confirm",
      progress: 100,
      selectedAction: "add-citation",
      draftResult: {
        mode: "append",
        pagePath: "wiki/concepts/example.md",
        summary: "补引用草案",
        preview: "建议补上稳定来源。",
        content: "<!-- deep-research:deep-research-check-citation-gap -->\n## 补引用草案\n- 建议补上稳定来源。",
      },
    });
    const response = createResponse();

    await handleDeepResearchConfirm(cfg)(
      { params: { id: "deep-research-check-citation-gap" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "wiki", "concepts", "example.md"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.runtimeRoot, "wiki", "concepts", "example.md"))).toBe(false);
  });
});

function makeConfig(
  overrides: Partial<{
    status: string;
    progress: number;
    selectedAction: string;
    draftResult: {
      mode: "append";
      pagePath: string;
      summary: string;
      preview: string;
      content: string;
    };
  }> = {},
) {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-runtime-"));
  tempRoots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
  fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "example.md"), "# Example\n\nOld content.\n", "utf8");
  fs.writeFileSync(
    path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"),
    JSON.stringify([
      {
        id: "deep-research-check-citation-gap",
        kind: "check",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        category: "missing-citation",
        scope: "claim",
        pagePath: "wiki/concepts/example.md",
        line: 22,
        factText: "这段结论缺少来源文件支撑。",
        gapText: "Broken citation ^[clip.md] - source file not found",
        triggerReason: "原文引用指向的来源文件不存在。",
        sourceExcerpt: "x error wiki/concepts/example.md:22 Broken citation ^[clip.md] - source file not found",
        status: overrides.status ?? "pending",
        progress: overrides.progress ?? 0,
        selectedAction: overrides.selectedAction,
        draftResult: overrides.draftResult,
        createdAt: "2026-04-17T01:00:00.000Z",
        updatedAt: "2026-04-17T01:00:00.000Z",
      },
    ], null, 2),
    "utf8",
  );
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot: sourceVaultRoot,
    port: 4175,
    host: "127.0.0.1",
    author: "me",
  };
}

function makeCitationRewriteConfig(
  overrides: Partial<{
    status: string;
    progress: number;
    selectedAction: string;
    withReplacementSource: boolean;
    draftResult: {
      mode: "rewrite-citations";
      pagePath: string;
      summary: string;
      preview: string;
      content: string;
      citationTarget: string;
      replacementCitation?: string;
    };
  }> = {},
) {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-citation-rewrite-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-citation-rewrite-runtime-"));
  tempRoots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "sources"), { recursive: true });
  fs.writeFileSync(path.join(sourceVaultRoot, "sources", "keep.md"), "# Keep\n", "utf8");
  if (overrides.withReplacementSource !== false) {
    fs.writeFileSync(path.join(sourceVaultRoot, "sources", "clip__AI知识库构建__12345678.md"), "# Replacement\n", "utf8");
  }
  fs.writeFileSync(
    path.join(sourceVaultRoot, "wiki", "concepts", "example.md"),
    [
      "---",
      "title: Example",
      "sources:",
      "  - legacy__AI知识库构建__deadbeef12.md",
      "  - keep.md",
      "---",
      "",
      "# Example",
      "",
      "第一段。^[legacy__AI知识库构建__deadbeef12.md]",
      "第二段。^[keep.md, legacy__AI知识库构建__deadbeef12.md]",
      "",
      "## 来源",
      "",
      "- legacy__AI知识库构建__deadbeef12.md",
      "- keep.md",
      "",
      "<!-- deep-research:legacy-citation-block -->",
      "## 补引用草案",
      "- 原始诊断：x error wiki/concepts/example.md:10 Broken citation ^[legacy__AI知识库构建__deadbeef12.md] - source file not found",
      "- 建议写入：补上一条稳定来源。",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"),
    JSON.stringify([
      {
        id: "deep-research-check-citation-gap",
        kind: "check",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        category: "missing-citation",
        scope: "claim",
        pagePath: "wiki/concepts/example.md",
        line: 10,
        factText: "第 10 行引用无法追溯到现有来源文件。",
        gapText: "Broken citation ^[legacy__AI知识库构建__deadbeef12.md] - source file not found",
        triggerReason: "原文引用指向的来源文件不存在。",
        sourceExcerpt: "x error wiki/concepts/example.md:10 Broken citation ^[legacy__AI知识库构建__deadbeef12.md] - source file not found",
        status: overrides.status ?? "pending",
        progress: overrides.progress ?? 0,
        selectedAction: overrides.selectedAction,
        draftResult: overrides.draftResult,
        createdAt: "2026-04-17T01:00:00.000Z",
        updatedAt: "2026-04-17T01:00:00.000Z",
      },
      {
        id: "deep-research-check-citation-gap-sibling",
        kind: "check",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        category: "missing-citation",
        scope: "claim",
        pagePath: "wiki/concepts/example.md",
        line: 11,
        factText: "第 11 行引用无法追溯到现有来源文件。",
        gapText: "Broken citation ^[legacy__AI知识库构建__deadbeef12.md] - source file not found",
        triggerReason: "原文引用指向的来源文件不存在。",
        sourceExcerpt: "x error wiki/concepts/example.md:11 Broken citation ^[legacy__AI知识库构建__deadbeef12.md] - source file not found",
        status: overrides.status ?? "pending",
        progress: overrides.progress ?? 0,
        selectedAction: overrides.selectedAction,
        draftResult: overrides.draftResult,
        createdAt: "2026-04-17T01:00:01.000Z",
        updatedAt: "2026-04-17T01:00:01.000Z",
      },
    ], null, 2),
    "utf8",
  );
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot: sourceVaultRoot,
    port: 4175,
    host: "127.0.0.1",
    author: "me",
  };
}

function makeOutdatedSourceConfig(
  overrides: Partial<{
    status: string;
    progress: number;
    selectedAction: string;
    pageContent: string;
    draftResult: {
      mode: "append";
      pagePath: string;
      summary: string;
      preview: string;
      content: string;
    };
  }> = {},
) {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-outdated-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-outdated-runtime-"));
  tempRoots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, ".llmwiki"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceVaultRoot, "wiki", "concepts", "example.md"),
    overrides.pageContent ?? "# Example\n\nOld content.\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(sourceVaultRoot, ".llmwiki", "claims.json"),
    JSON.stringify([
      {
        id: "claim-stale-example",
        conceptSlug: "example",
        claimKey: "google-ai-paid-vs-recognized",
        claimText: "付费成功与桌面端识别成功并非同一件事，Google AI Developers Forum 在 2025 年 12 月已出现过付费成功但 Antigravity 仍识别为受限状态的反馈。",
        claimType: "incident",
        sourceFiles: ["source.md"],
        sources: [{
          file: "source.md",
          title: "source.md",
          kind: "external",
          channel: "外部源",
          observedAt: "2025-12",
        }],
        firstSeenAt: "2025-12",
        lastConfirmedAt: "2025-12",
        supportCount: 1,
        contradictionCount: 0,
        confidence: 0.22,
        retention: 0.05,
        status: "stale",
        supersedes: [],
        halfLifeDays: 30,
      },
    ], null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"),
    JSON.stringify([
      {
        id: "deep-research-check-stale-claim",
        kind: "check",
        title: "新来源已取代的过时表述",
        detail: "这条结论已经过时，需要确认新来源是否已经取代旧表述。",
        category: "outdated-source",
        scope: "claim",
        pagePath: "wiki/concepts/example.md",
        line: 12,
        factText: "付费成功与桌面端识别成功并非同一件事，Google AI Developers Forum 在 2025 年 12 月已出现过付费成功但 Antigravity 仍识别为受限状态的反馈。",
        gapText: "Stale claim: 付费成功与桌面端识别成功并非同一件事，Google AI Developers Forum 在 2025 年 12 月已出现过付费成功但 Antigravity 仍识别为受限状态的反馈。",
        triggerReason: "这条结论保留度只有 0.05，最近确认时间是 2025-12，需要用新来源替换旧表述。",
        sourceExcerpt: "! warning wiki/concepts/example.md Stale claim: 付费成功与桌面端识别成功并非同一件事，Google AI Developers Forum 在 2025 年 12 月已出现过付费成功但 Antigravity 仍识别为受限状态的反馈。 (retention 0.05, last confirmed 2025-12)",
        status: overrides.status ?? "pending",
        progress: overrides.progress ?? 0,
        selectedAction: overrides.selectedAction,
        draftResult: overrides.draftResult,
        createdAt: "2026-04-17T01:00:00.000Z",
        updatedAt: "2026-04-17T01:00:00.000Z",
      },
    ], null, 2),
    "utf8",
  );
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot: sourceVaultRoot,
    port: 4175,
    host: "127.0.0.1",
    author: "me",
  };
}

function makeConfigWithBulkItems() {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-bulk-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-bulk-runtime-"));
  tempRoots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "sources"), { recursive: true });
  fs.writeFileSync(path.join(sourceVaultRoot, "sources", "keep.md"), "# Keep\n", "utf8");
  fs.writeFileSync(path.join(sourceVaultRoot, "sources", "clip__AI知识库构建__12345678.md"), "# Replacement\n", "utf8");
  fs.writeFileSync(
    path.join(sourceVaultRoot, "wiki", "concepts", "citation.md"),
    "# Citation\n\n正文。^[legacy__AI知识库构建__deadbeef12.md]\n",
    "utf8",
  );
  fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "research.md"), "# Research\n", "utf8");
  fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "confirm.md"), "# Confirm\n", "utf8");
  fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "failed.md"), "# Failed\n", "utf8");
  fs.writeFileSync(
    path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"),
    JSON.stringify([
      {
        id: "bulk-pending-citation",
        kind: "check",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        category: "missing-citation",
        scope: "claim",
        pagePath: "wiki/concepts/citation.md",
        line: 22,
        factText: "事实 1",
        gapText: "Broken citation ^[legacy__AI知识库构建__deadbeef12.md] - source file not found",
        triggerReason: "需要补引用。",
        sourceExcerpt: "x error wiki/concepts/citation.md:22 Broken citation ^[legacy__AI知识库构建__deadbeef12.md] - source file not found",
        status: "pending",
        progress: 0,
        createdAt: "2026-04-17T01:00:00.000Z",
        updatedAt: "2026-04-17T01:00:00.000Z",
      },
      {
        id: "bulk-pending-research",
        kind: "check",
        title: "需要网络搜索补证的数据空白",
        detail: "需要 deep research。",
        category: "needs-deep-research",
        scope: "claim",
        pagePath: "wiki/concepts/research.md",
        line: 10,
        factText: "事实 2",
        gapText: "Low-confidence claim",
        triggerReason: "需要 research。",
        status: "pending",
        progress: 0,
        createdAt: "2026-04-17T01:01:00.000Z",
        updatedAt: "2026-04-17T01:01:00.000Z",
      },
      {
        id: "bulk-confirm",
        kind: "check",
        title: "引用缺失",
        detail: "待确认写入。",
        category: "missing-citation",
        scope: "claim",
        pagePath: "wiki/concepts/confirm.md",
        line: 4,
        factText: "事实 3",
        gapText: "Broken citation",
        triggerReason: "待确认。",
        status: "done-await-confirm",
        progress: 100,
        selectedAction: "add-citation",
        draftResult: {
          mode: "append",
          pagePath: "wiki/concepts/confirm.md",
          summary: "已确认草案",
          preview: "预览",
          content: "## 已确认草案\n- 内容",
        },
        createdAt: "2026-04-17T01:02:00.000Z",
        updatedAt: "2026-04-17T01:02:00.000Z",
      },
      {
        id: "bulk-failed",
        kind: "check",
        title: "引用缺失",
        detail: "失败项。",
        category: "missing-citation",
        scope: "claim",
        pagePath: "wiki/concepts/failed.md",
        line: 9,
        factText: "事实 4",
        gapText: "Broken citation",
        triggerReason: "失败项。",
        status: "failed",
        progress: 0,
        errorMessage: "source missing",
        createdAt: "2026-04-17T01:03:00.000Z",
        updatedAt: "2026-04-17T01:03:00.000Z",
      },
    ], null, 2),
    "utf8",
  );
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot: sourceVaultRoot,
    port: 4175,
    host: "127.0.0.1",
    author: "me",
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await wait(intervalMs);
  }
  throw new Error("timed out waiting for review route background work");
}
