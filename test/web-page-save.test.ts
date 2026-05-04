import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePageDelete, handlePageSave } from "../web/server/routes/page-save.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("handlePageSave", () => {
  it("writes source-backed wiki pages back to the source vault", () => {
    const sourceVaultRoot = makeDir("llmwiki-page-save-source-");
    const runtimeRoot = makeDir("llmwiki-page-save-runtime-");
    const pagePath = path.join(sourceVaultRoot, "wiki", "个人信息档案", "about-me.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, "# Old\n", "utf8");

    const handler = handlePageSave(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const json = vi.fn();

    handler(
      { body: { path: "wiki/个人信息档案/about-me.md", raw: "# New Title\n\n![头像](https://example.com/avatar.png)\n" } } as never,
      { json, status: vi.fn() } as never,
    );

    expect(fs.readFileSync(pagePath, "utf8")).toContain("# New Title");
    expect(fs.readFileSync(pagePath, "utf8")).toContain("https://example.com/avatar.png");
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ path: "wiki/个人信息档案/about-me.md" }),
    }));
  });

  it("writes source-backed workspace log pages through the same page save API", () => {
    const sourceVaultRoot = makeDir("llmwiki-page-save-work-log-source-");
    const runtimeRoot = makeDir("llmwiki-page-save-work-log-runtime-");
    const pagePath = path.join(sourceVaultRoot, "领域", "产品", "LLM Wiki WebUI", "工作日志.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, "# 工作日志\n\n旧内容\n", "utf8");

    const handler = handlePageSave(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const json = vi.fn();

    handler(
      { body: { path: "领域/产品/LLM Wiki WebUI/工作日志.md", raw: "# 工作日志\n\n新内容\n" } } as never,
      { json, status: vi.fn() } as never,
    );

    expect(fs.readFileSync(pagePath, "utf8")).toContain("新内容");
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ path: "领域/产品/LLM Wiki WebUI/工作日志.md" }),
    }));
  });

  it("rejects runtime-only wiki pages", () => {
    const sourceVaultRoot = makeDir("llmwiki-page-save-runtime-source-");
    const runtimeRoot = makeDir("llmwiki-page-save-runtime-root-");
    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Runtime\n", "utf8");

    const handler = handlePageSave(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const statusJson = vi.fn();
    const status = vi.fn(() => ({ json: statusJson }));

    handler(
      { body: { path: "wiki/index.md", raw: "# Edited\n" } } as never,
      { json: vi.fn(), status } as never,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(statusJson).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: "page is not editable",
    }));
  });
});

describe("handlePageDelete", () => {
  it("deletes one or more source-backed wiki pages", () => {
    const sourceVaultRoot = makeDir("llmwiki-page-delete-source-");
    const runtimeRoot = makeDir("llmwiki-page-delete-runtime-");
    const firstPath = path.join(sourceVaultRoot, "wiki", "案例库", "a.md");
    const secondPath = path.join(sourceVaultRoot, "wiki", "案例库", "b.md");
    fs.mkdirSync(path.dirname(firstPath), { recursive: true });
    fs.writeFileSync(firstPath, "# A\n", "utf8");
    fs.writeFileSync(secondPath, "# B\n", "utf8");

    const handler = handlePageDelete(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const json = vi.fn();

    handler(
      { body: { paths: ["wiki/案例库/a.md", "wiki/案例库/b.md"] } } as never,
      { json, status: vi.fn() } as never,
    );

    expect(fs.existsSync(firstPath)).toBe(false);
    expect(fs.existsSync(secondPath)).toBe(false);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: { paths: ["wiki/案例库/a.md", "wiki/案例库/b.md"] },
    }));
  });

  it("rejects a batch without deleting any editable page when one path is not editable", () => {
    const sourceVaultRoot = makeDir("llmwiki-page-delete-reject-source-");
    const runtimeRoot = makeDir("llmwiki-page-delete-reject-runtime-");
    const editablePath = path.join(sourceVaultRoot, "wiki", "案例库", "a.md");
    fs.mkdirSync(path.dirname(editablePath), { recursive: true });
    fs.writeFileSync(editablePath, "# A\n", "utf8");
    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Runtime\n", "utf8");

    const handler = handlePageDelete(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const statusJson = vi.fn();
    const status = vi.fn(() => ({ json: statusJson }));

    handler(
      { body: { paths: ["wiki/案例库/a.md", "wiki/index.md"] } } as never,
      { json: vi.fn(), status } as never,
    );

    expect(fs.existsSync(editablePath)).toBe(true);
    expect(status).toHaveBeenCalledWith(400);
    expect(statusJson).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: "page is not editable",
      path: "wiki/index.md",
    }));
  });
});

function makeDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeServerConfig(sourceVaultRoot: string, runtimeRoot: string) {
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot: runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "me",
  };
}
