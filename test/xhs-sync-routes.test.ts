import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import { handleClipCreate } from "../web/server/routes/clips.js";
import { saveXiaohongshuImportConfig } from "../web/server/services/xiaohongshu-import.js";
import {
  handleXhsBatch,
  handleXhsExtract,
  handleXhsFailureDelete,
  handleXhsFavoritesSync,
  handleXhsStatus,
} from "../web/server/routes/xhs-sync.js";
import type { XhsFetcher } from "../web/server/services/xhs-sync.js";

const roots: string[] = [];
const previousCookiePath = process.env.LLM_WIKI_XHS_COOKIE_PATH;

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
  if (previousCookiePath === undefined) {
    delete process.env.LLM_WIKI_XHS_COOKIE_PATH;
  } else {
    process.env.LLM_WIKI_XHS_COOKIE_PATH = previousCookiePath;
  }
});

describe("xhs sync routes", () => {
  it("extracts one xhs post through POST /api/xhs-sync/extract", async () => {
    const cfg = makeConfig();
    const response = createResponse();

    await handleXhsExtract(cfg, { fetcher: async () => sampleResponse(sampleHtml()), postFormatter: sampleFormatter })({
      body: { url: "https://www.xiaohongshu.com/explore/64f000000000000001234567" },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe("completed");
    expect(response.body.data.path).toMatch(/^raw\/剪藏\/小红书\//);
  });

  it("appends manually attached media to xhs clipping markdown", async () => {
    const cfg = makeConfig();
    const imagePath = path.join(cfg.projectRoot, "xhs-extra.png");
    fs.writeFileSync(imagePath, "image", "utf8");
    const response = createResponse();

    await handleXhsExtract(cfg, { fetcher: async () => sampleResponse(sampleHtml()), postFormatter: sampleFormatter })({
      body: {
        url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
        body: "补充说明这条笔记怎么使用",
        mediaPaths: [imagePath],
      },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    const markdownPath = path.join(cfg.sourceVaultRoot, ...String(response.body.data.path).split("/"));
    const raw = fs.readFileSync(markdownPath, "utf8");
    expect(raw).toContain("## 手动附件");
    expect(raw).toContain("![](./assets/");
    expect(fs.existsSync(path.join(path.dirname(markdownPath), "assets", "小红书路由测试", "xhs-extra.png"))).toBe(true);
  });

  it("runs batch extraction and status route reports latest progress", async () => {
    const cfg = makeConfig();
    const batch = createResponse();

    await handleXhsBatch(cfg, { fetcher: async () => sampleResponse(sampleHtml()), delayMs: 0, postFormatter: sampleFormatter })({
      body: {
        urls: [
          "https://www.xiaohongshu.com/explore/64f000000000000001234567",
          "https://www.xiaohongshu.com/explore/64f000000000000007654321",
        ],
      },
    } as unknown as Request, batch as Response);

    const status = createResponse();
    await handleXhsStatus(cfg)({} as Request, status as Response);

    expect(batch.statusCode).toBe(200);
    expect(batch.body.data.progress.percent).toBe(100);
    expect(status.body.data.latestExtraction.progress.percent).toBe(100);
  });

  it("deletes selected xiaohongshu sync failures", async () => {
    const cfg = makeConfig();
    const failureFile = path.join(cfg.sourceVaultRoot, ".llmwiki", "xhs-sync-failures.json");
    fs.mkdirSync(path.dirname(failureFile), { recursive: true });
    fs.writeFileSync(failureFile, JSON.stringify([
      {
        id: "failure-1",
        command: "xhs",
        url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
        error: "cookie expired",
        createdAt: "2026-04-24T01:00:00.000Z",
      },
      {
        id: "failure-2",
        command: "xhs",
        url: "https://www.xiaohongshu.com/explore/64f000000000000007654321",
        error: "transcribe failed",
        createdAt: "2026-04-24T01:01:00.000Z",
      },
    ], null, 2), "utf8");
    const response = createResponse();

    await handleXhsFailureDelete(cfg)({
      body: { ids: ["failure-1"] },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual({ deleted: ["failure-1"], remaining: 1 });
    const remaining = JSON.parse(fs.readFileSync(failureFile, "utf8")) as Array<{ id: string }>;
    expect(remaining.map((item) => item.id)).toEqual(["failure-2"]);
  });

  it("routes xiaohongshu links from generic clipping endpoint into xhs sync", async () => {
    const cfg = makeConfig();
    const outputRoot = path.join(cfg.projectRoot, "imports", "xiaohongshu");
    await saveXiaohongshuImportConfig(cfg.projectRoot, outputRoot);
    const response = createResponse();
    const fetcher: XhsFetcher = async () => sampleResponse(sampleHtml());

    await handleClipCreate(cfg, { xhs: { fetcher, postFormatter: sampleFormatter } })({
      body: { url: "https://www.xiaohongshu.com/explore/64f000000000000001234567" },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe("completed");
    expect(response.body.data.path).toBe("imports/xiaohongshu/小红书路由测试.md");
    expect(fs.existsSync(path.join(cfg.sourceVaultRoot, ...String(response.body.data.path).split("/")))).toBe(true);
  });

  it("one-click sync reads xiaohongshu favorites with cookie and skips already synced posts", async () => {
    const cfg = makeConfig();
    const outputRoot = path.join(cfg.projectRoot, "imports", "xiaohongshu");
    fs.mkdirSync(outputRoot, { recursive: true });
    await saveXiaohongshuImportConfig(cfg.projectRoot, outputRoot);
    process.env.LLM_WIKI_XHS_COOKIE_PATH = path.join(cfg.projectRoot, "cookies.json");
    fs.writeFileSync(
      path.join(outputRoot, "already.md"),
      [
        "---",
        "platform: xhs",
        "source_url: \"https://www.xiaohongshu.com/explore/64f000000000000001234567\"",
        "post_id: \"64f000000000000001234567\"",
        "---",
      ].join("\n"),
      "utf8",
    );
    const response = createResponse();
    const requestedUrls: string[] = [];

    await handleXhsFavoritesSync(cfg, {
      fetcher: async (requestUrl) => {
        const url = String(requestUrl);
        requestedUrls.push(url);
        if (url.includes("/api/sns/web/v2/user/me")) {
          return jsonResponse({ success: true, data: { user_id: "user-1" } });
        }
        if (url.includes("/api/sns/web/v2/note/collect/page")) {
          return jsonResponse({
            success: true,
            data: {
              notes: [
                { note_id: "64f000000000000001234567", xsec_token: "token-a" },
                { note_id: "64f000000000000007654321", xsec_token: "token-b" },
              ],
              cursor: "",
              has_more: false,
            },
          });
        }
        return sampleResponse(sampleHtml(readPostId(url) ?? "64f000000000000007654321"));
      },
      delayMs: 0,
      postFormatter: sampleFormatter,
    })({ body: {} } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.scanned).toBe(2);
    expect(response.body.data.skipped).toBe(1);
    expect(response.body.data.queued).toBe(1);
    expect(response.body.data.progress.percent).toBe(100);
    expect(requestedUrls.some((url) => url.includes("/api/sns/web/v2/user/me"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/api/sns/web/v2/note/collect/page"))).toBe(true);
  });
});

function makeConfig(): ServerConfig {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-routes-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-routes-runtime-"));
  const cookiePath = path.join(sourceVaultRoot, "cookies.json");
  roots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(sourceVaultRoot, "raw", "剪藏", "小红书"), { recursive: true });
  fs.writeFileSync(cookiePath, JSON.stringify([{ name: "a", value: "b" }]), "utf8");
  process.env.LLM_WIKI_XHS_COOKIE_PATH = cookiePath;
  return {
    projectRoot: sourceVaultRoot,
    sourceVaultRoot,
    runtimeRoot,
    port: 4175,
    host: "127.0.0.1",
    author: "test",
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

function sampleResponse(html: string): Response {
  return new Response(html, { status: 200 });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sampleHtml(postId = "64f000000000000001234567"): string {
  const state = {
    note: {
      noteDetailMap: {
        [postId]: {
          note: {
            noteId: postId,
            title: "小红书路由测试",
            desc: "路由正文",
            type: "normal",
            time: 1776902400000,
            user: { nickname: "作者A" },
            imageList: [{ urlDefault: "https://img.example.com/1.jpg" }],
            interactInfo: {},
            tagList: [],
          },
        },
      },
    },
  };
  return `<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`;
}

function readPostId(value: string): string | null {
  return /[0-9a-f]{24}/i.exec(value)?.[0] ?? null;
}

async function sampleFormatter() {
  return {
    insightTitle: "把路由测试转成行动",
    shortTitle: "小红书路由测试",
    summaryLines: ["路由测试摘要"],
    decisionNote: "路由测试决策笔记",
  };
}
