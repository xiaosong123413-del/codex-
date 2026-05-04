/**
 * Regression tests for flash-diary Memory synchronization.
 *
 * The Memory page has two local copies with different responsibilities:
 * the source vault copy is the user-editable truth, while the runtime copy is
 * the file published by the Cloudflare sync workflow. These tests pin both
 * copies to the same content and ensure stale remote documents cannot win.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMMessage, LLMProvider } from "../src/utils/provider.js";
import type { ServerConfig } from "../web/server/config.js";
import { handleFlashDiaryMemory, handleFlashDiarySave } from "../web/server/routes/flash-diary.js";
import { readFlashDiaryMemoryPage } from "../web/server/services/flash-diary-memory.js";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LLMWIKI_REMOTE_PROVIDER;
  delete process.env.CLOUDFLARE_WORKER_URL;
  delete process.env.CLOUDFLARE_REMOTE_TOKEN;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("flash diary memory synchronization", () => {
  it("builds local memory instead of reading a stale Cloudflare document", async () => {
    const cfg = createConfig();
    writeDiary(cfg.sourceVaultRoot, "2026-04-29", "本地日记");
    enableCloudflare();
    const fetchMock = vi.fn().mockResolvedValue(cloudResponse("# Memory\n\n- 云端旧 Memory\n"));
    vi.stubGlobal("fetch", fetchMock);
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    await handleFlashDiaryMemory(cfg, {
      now: new Date(2026, 3, 30, 12, 0, 0),
      provider: createMemoryProvider("本地生成 Memory"),
    })({} as never, { json, status } as never);

    const payload = json.mock.calls[0]?.[0];
    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.success).toBe(true);
    expect(payload.data.raw).toContain("本地生成 Memory");
    expect(payload.data.raw).not.toContain("云端旧 Memory");
  });

  it("saves memory to the source vault and runtime mirror even when the remote mirror fails", async () => {
    const cfg = createConfig();
    enableCloudflare();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "remote unavailable",
    });
    vi.stubGlobal("fetch", fetchMock);
    const raw = "# Memory\n\n## 短期记忆（最近 7 天）\n- 本地编辑\n";
    const json = vi.fn();
    const statusJson = vi.fn();
    const status = vi.fn(() => ({ json: statusJson }));

    await handleFlashDiarySave(cfg)(
      { body: { path: "wiki/journal-memory.md", raw } } as never,
      { json, status } as never,
    );

    expect(json).toHaveBeenCalledWith({ success: true });
    expect(readMemory(cfg.sourceVaultRoot)).toBe(raw);
    expect(readMemory(cfg.runtimeRoot)).toBe(raw);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
    expect(statusJson).not.toHaveBeenCalled();
  });

  it("mirrors generated memory to the runtime wiki for Cloudflare publishing", async () => {
    const cfg = createConfig();
    writeDiary(cfg.sourceVaultRoot, "2026-04-29", "本地日记");

    const page = await readFlashDiaryMemoryPage({
      projectRoot: cfg.projectRoot,
      sourceVaultRoot: cfg.sourceVaultRoot,
      runtimeRoot: cfg.runtimeRoot,
      now: new Date(2026, 3, 30, 12, 0, 0),
      provider: createMemoryProvider("运行目录同步 Memory"),
    });

    expect(page.raw).toContain("运行目录同步 Memory");
    expect(readMemory(cfg.sourceVaultRoot)).toBe(readMemory(cfg.runtimeRoot));
    expect(readMemory(cfg.runtimeRoot)).toContain("运行目录同步 Memory");
  });
});

function createConfig(): ServerConfig {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-sync-project-"));
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-sync-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-sync-runtime-"));
  tempRoots.push(projectRoot, sourceVaultRoot, runtimeRoot);
  return {
    projectRoot,
    sourceVaultRoot,
    runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "tester",
  };
}

function writeDiary(sourceVaultRoot: string, date: string, body: string): void {
  const filePath = path.join(sourceVaultRoot, "raw", "闪念日记", `${date}.md`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `# ${date}\n\n## 08:00:00\n\n${body}\n`, "utf8");
}

function readMemory(root: string): string {
  return fs.readFileSync(path.join(root, "wiki", "journal-memory.md"), "utf8");
}

function enableCloudflare(): void {
  process.env.LLMWIKI_REMOTE_PROVIDER = "cloudflare";
  process.env.CLOUDFLARE_WORKER_URL = "https://example.workers.dev/";
  process.env.CLOUDFLARE_REMOTE_TOKEN = "token";
}

function cloudResponse(raw: string): { ok: boolean; status: number; statusText: string; text: () => Promise<string> } {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({
      ok: true,
      document: {
        path: "wiki/journal-memory.md",
        raw,
        updatedAt: "2026-04-26T06:20:00.000Z",
      },
    }),
  };
}

function createMemoryProvider(memoryLine: string): LLMProvider {
  return {
    complete: vi.fn(async (system: string, messages: LLMMessage[]) => {
      if (system.includes("最近 7 天短期记忆")) {
        return buildShortTermSummary(memoryLine);
      }
      const prompt = messages.map((message) => message.content).join("\n\n");
      expect(prompt).toContain("Diary Date: 2026-04-29");
      return buildLongTermMemory(memoryLine);
    }),
    stream: vi.fn(async () => ""),
    toolCall: vi.fn(async () => ""),
  };
}

function buildLongTermMemory(memoryLine: string): string {
  return [
    "# Memory",
    "",
    "## 短期记忆（最近 7 天）",
    "- 旧短期占位",
    "",
    "## 长期记忆",
    "",
    "### 人物与关系",
    `- ${memoryLine}`,
    "",
    "### 项目与系统",
    "- 暂无",
    "",
    "### 方法论与偏好",
    "- 暂无",
    "",
    "### 长期问题与矛盾",
    "- 暂无",
    "",
    "### 近期变化",
    "- 暂无",
    "",
    "### 来源范围",
    "- 2026-04-29",
    "",
  ].join("\n");
}

function buildShortTermSummary(memoryLine: string): string {
  return [
    "### 健康状态",
    "- 暂无明显信息",
    "",
    "### 学习状态",
    `- ${memoryLine}`,
    "",
    "### 人际关系",
    "- 暂无明显信息",
    "",
    "### 爱情状态",
    "- 暂无明显信息",
    "",
    "### 财富状态",
    "- 暂无明显信息",
    "",
    "### 情绪与能量",
    "- 暂无明显信息",
    "",
    "### 近期重点与风险",
    "- 本地日记",
  ].join("\n");
}
