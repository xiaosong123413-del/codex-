import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import { handleIntakeScan } from "../web/server/routes/intake.js";

const tempRoots: string[] = [];

describe("web intake scan route", () => {
  afterEach(() => {
    vi.useRealTimers();
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("pulls mobile entries before scanning local intake folders", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T08:00:00+08:00"));
    const sourceVaultRoot = makeRoot();
    const runtimeRoot = makeRoot();
    const cfg: ServerConfig = {
      sourceVaultRoot,
      runtimeRoot,
      port: 4175,
      host: "127.0.0.1",
      author: "tester",
      projectRoot: sourceVaultRoot,
    };
    const handler = handleIntakeScan(cfg, async () => {
      const diaryDir = path.join(sourceVaultRoot, "raw", "\u95ea\u5ff5\u65e5\u8bb0");
      fs.mkdirSync(diaryDir, { recursive: true });
      fs.writeFileSync(path.join(diaryDir, "2026-04-20.md"), "# 2026-04-20 \u95ea\u5ff5\u65e5\u8bb0\n\n## 10:00\n\n\u4f60\u597d\u4f60\u597d", "utf8");
      return { pulledCount: 1, failedCount: 0, skipped: false };
    });
    const response = createJsonResponse();

    await handler({} as never, response as never);

    expect(response.body.success).toBe(true);
    expect(response.body.data.mobilePull).toEqual({ pulledCount: 1, failedCount: 0, skipped: false });
    expect(response.body.data.items).toContainEqual(
      expect.objectContaining({
        kind: "flash",
        title: "2026-04-20 \u95ea\u5ff5\u65e5\u8bb0",
      }),
    );
  });

  it("uses configured source folders during intake scan", async () => {
    const projectRoot = makeRoot();
    const sourceVaultRoot = makeRoot();
    const runtimeRoot = makeRoot();
    const sourceRoot = path.join(sourceVaultRoot, "raw", "\u4e2a\u4eba\u4fe1\u606f");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "about.md"), "# About Me\n\nprofile", "utf8");
    fs.writeFileSync(
      path.join(projectRoot, "sync-compile-config.json"),
      `${JSON.stringify({
        source_vault_root: sourceVaultRoot,
        runtime_output_root: runtimeRoot,
        source_folders: [sourceRoot],
      }, null, 2)}\n`,
      "utf8",
    );
    const cfg: ServerConfig = {
      sourceVaultRoot,
      runtimeRoot,
      port: 4175,
      host: "127.0.0.1",
      author: "tester",
      projectRoot,
    };
    const handler = handleIntakeScan(cfg, async () => ({ pulledCount: 0, failedCount: 0, skipped: false }));
    const response = createJsonResponse();

    await handler({} as never, response as never);

    expect(response.body.data.items).toContainEqual(
      expect.objectContaining({
        kind: "source",
        channel: "\u4e2a\u4eba\u4fe1\u606f",
        title: "About Me",
      }),
    );
    expect(response.body.data.plan).toContainEqual(
      expect.objectContaining({
        file: "\u4e2a\u4eba\u4fe1\u606f/about.md",
      }),
    );
  });

});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-intake-route-"));
  tempRoots.push(root);
  return root;
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
