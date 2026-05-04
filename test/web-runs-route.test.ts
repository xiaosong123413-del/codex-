import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import { handleRunStart } from "../web/server/routes/runs.js";

const { searchAll } = vi.hoisted(() => ({
  searchAll: vi.fn(),
}));
const tempRoots: string[] = [];

vi.mock("../web/server/services/search-orchestrator.js", () => ({
  searchAll,
}));

describe("web runs route", () => {
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

  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("refreshes cached web suggestions after a check run finishes", async () => {
    const cfg = makeConfig();
    const response = createJsonResponse();
    const run = {
      id: "check-1",
      kind: "check" as const,
      status: "running" as const,
      startedAt: "2026-04-25T00:00:00.000Z",
      lines: [],
    };
    const manager = {
      getCurrent: vi.fn().mockReturnValue(null),
      start: vi.fn().mockReturnValue(run),
      waitForRun: vi.fn().mockResolvedValue({
        ...run,
        status: "succeeded" as const,
        endedAt: "2026-04-25T00:00:01.000Z",
      }),
    } as never;

    await handleRunStart(cfg, manager, "check")({} as never, response as never);
    await wait(0);

    expect(response.statusCode).toBe(202);
    expect(searchAll).toHaveBeenCalledWith(
      undefined,
      expect.stringContaining("引用缺失"),
      {
        scope: "web",
        mode: "keyword",
        webLimit: 3,
      },
    );

    const cachePath = path.join(cfg.runtimeRoot, ".llmwiki", "review-web-search-suggestions.json");
    expect(fs.existsSync(cachePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(cachePath, "utf8"))).toEqual({
      "deep-research-check-citation-gap": [
        { title: "External source", url: "https://example.com", snippet: "补证结果" },
      ],
    });
  });

  it("does not refresh web suggestions after a sync run finishes", async () => {
    const cfg = makeConfig();
    const response = createJsonResponse();
    const run = {
      id: "sync-1",
      kind: "sync" as const,
      status: "running" as const,
      startedAt: "2026-04-25T00:00:00.000Z",
      lines: [],
    };
    const manager = {
      getCurrent: vi.fn().mockReturnValue(null),
      start: vi.fn().mockReturnValue(run),
      waitForRun: vi.fn().mockResolvedValue({
        ...run,
        status: "succeeded" as const,
        endedAt: "2026-04-25T00:00:01.000Z",
      }),
    } as never;

    await handleRunStart(cfg, manager, "sync")({} as never, response as never);
    await wait(0);

    expect(response.statusCode).toBe(202);
    expect(searchAll).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(cfg.runtimeRoot, ".llmwiki", "review-web-search-suggestions.json"))).toBe(false);
  });

  it("returns the existing run when the same kind is already active", async () => {
    const cfg = makeConfig();
    const response = createJsonResponse();
    const run = {
      id: "sync-active",
      kind: "sync" as const,
      status: "running" as const,
      startedAt: "2026-04-25T00:00:00.000Z",
      lines: [],
    };
    const manager = {
      getCurrent: vi.fn().mockReturnValue(run),
      start: vi.fn(),
      waitForRun: vi.fn(),
    };

    await handleRunStart(cfg, manager as never, "sync")({} as never, response as never);

    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({ success: true, data: run });
    expect(manager.start).not.toHaveBeenCalled();
  });

  it("rejects a new run when another kind is already active", async () => {
    const cfg = makeConfig();
    const response = createJsonResponse();
    const manager = {
      getCurrent: vi.fn().mockReturnValue({
        id: "check-active",
        kind: "check" as const,
        status: "running" as const,
        startedAt: "2026-04-25T00:00:00.000Z",
        lines: [],
      }),
      start: vi.fn(),
      waitForRun: vi.fn(),
    };

    await handleRunStart(cfg, manager as never, "sync")({} as never, response as never);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: "系统检查已在后台运行，请等待结束后再启动同步编译。",
    });
    expect(manager.start).not.toHaveBeenCalled();
  });
});

function makeConfig(): ServerConfig {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-runs-route-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-runs-route-runtime-"));
  tempRoots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
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
        status: "pending",
        progress: 0,
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z",
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
    author: "tester",
  };
}

function createJsonResponse() {
  return {
    body: undefined as unknown,
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
