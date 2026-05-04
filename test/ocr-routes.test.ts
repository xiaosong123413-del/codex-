/**
 * Tests for shared OCR HTTP route handlers.
 *
 * The route is the mobile and desktop-safe entrypoint for image OCR because it
 * keeps Cloudflare credentials on the server and persists the shared sidecar.
 */
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import { handleSourceImageOcr } from "../web/server/routes/ocr.js";
import {
  jsonResponse,
  makeOcrRoots,
  removeTrackedRoots,
  restoreEnv,
  stubCloudflareOcrEnv,
  writeTextFile,
} from "./ocr-test-helpers.js";

const roots: string[] = [];
const envBackup = new Map<string, string | undefined>();

afterEach(() => {
  restoreEnv(envBackup);
  vi.unstubAllGlobals();
  removeTrackedRoots(roots);
});

describe("OCR routes", () => {
  it("runs source image OCR by source path for shared desktop and mobile callers", async () => {
    const cfg = makeConfig();
    writeTextFile(cfg.sourceVaultRoot, "raw/闪念日记/2026-04-29.md", [
      "# 2026-04-29",
      "",
      "![receipt](assets/receipt.png)",
    ].join("\n"));
    writeTextFile(cfg.sourceVaultRoot, "raw/闪念日记/assets/receipt.png", "image-bytes");
    stubCloudflareOcrEnv(envBackup);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ text: "移动端票据文字" })));
    const response = createResponse();

    await handleSourceImageOcr(cfg)({
      body: { path: "raw/闪念日记/2026-04-29.md" },
    } as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.sourcePath).toBe("raw/闪念日记/2026-04-29.md");
    expect(response.body.data.path).toMatch(/^\.llmwiki\/ocr\/.+\.txt$/);
    expect(response.body.data.text).toContain("移动端票据文字");
  });
});

function makeConfig(): ServerConfig {
  const { projectRoot, sourceVaultRoot, runtimeRoot } = makeOcrRoots(roots, "ocr-route", { includeProjectRoot: true });
  return {
    projectRoot,
    sourceVaultRoot,
    runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "tester",
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
