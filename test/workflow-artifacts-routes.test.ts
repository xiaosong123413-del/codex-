import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import type { ServerConfig } from "../web/server/config.js";
import { handleWorkflowArtifacts } from "../web/server/routes/workflow-artifacts.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("workflow artifacts routes", () => {
  it("creates wiki folders separately from runtime queue files", async () => {
    const cfg = makeConfig();
    const json = viResponse();

    await handleWorkflowArtifacts(cfg)({} as Request, json as unknown as Response);

    const body = json.body as {
      success: boolean;
      data: { folders: unknown[]; runtimeFiles: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "00-执行现场", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "01-案例库", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "02-方法库", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "03-工具箱", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(cfg.runtimeRoot, ".llmwiki", "workflow-events.json"))).toBe(true);
    expect(body.data.folders).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "folder", title: "00-执行现场" }),
      expect.objectContaining({ kind: "folder", title: "01-案例库" }),
      expect.objectContaining({ kind: "folder", title: "02-方法库" }),
      expect.objectContaining({ kind: "folder", title: "03-工具箱" }),
    ]));
    expect(body.data.runtimeFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "runtime-file", title: "Workflow Event 事件池" }),
    ]));
  });
});

function makeConfig(): ServerConfig {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-artifacts-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-artifacts-runtime-"));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-artifacts-project-"));
  roots.push(sourceVaultRoot, runtimeRoot, projectRoot);
  return { sourceVaultRoot, runtimeRoot, projectRoot, author: "test", host: "127.0.0.1", port: 4175 };
}

function viResponse(): { statusCode: number; body: unknown; json: (body: unknown) => void; status: (code: number) => unknown } {
  return {
    statusCode: 200,
    body: null,
    json(body: unknown): void {
      this.body = body;
    },
    status(code: number): unknown {
      this.statusCode = code;
      return this;
    },
  };
}
