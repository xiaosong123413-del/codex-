import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import {
  handleClipCreate,
  handleYtDlpInstall,
  handleYtDlpStatus,
} from "../web/server/routes/clips.js";
import type { ClipRunner } from "../web/server/services/clip-pipeline.js";
import type { DouyinCollector } from "../web/server/services/douyin-sync.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("clip routes", () => {
  it("creates a clipping task through POST /api/clips", async () => {
    const cfg = makeConfig();
    const runner: ClipRunner = {
      async collect(input) {
        fs.mkdirSync(input.outputDir, { recursive: true });
        fs.writeFileSync(path.join(input.outputDir, "bili.mp4"), "video", "utf8");
        return {
          metadata: {
            title: "B站视频",
            platform: "bilibili",
            webpageUrl: input.url,
            contentType: "video",
          },
          media: [{ kind: "video", path: path.join(input.outputDir, "bili.mp4"), title: "bili" }],
        };
      },
    };
    const response = createResponse();

    await handleClipCreate(cfg, { runner })({
      body: { url: "https://www.bilibili.com/video/BV123", quality: "720" },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe("completed");
    expect(response.body.data.path).toMatch(/^raw\/剪藏\//);
  });

  it("appends manually attached clipping media after link parsing succeeds", async () => {
    const cfg = makeConfig();
    const imagePath = path.join(cfg.projectRoot, "manual-frame.png");
    const videoPath = path.join(cfg.projectRoot, "manual-demo.mp4");
    fs.writeFileSync(imagePath, "image", "utf8");
    fs.writeFileSync(videoPath, "video", "utf8");
    const runner: ClipRunner = {
      async collect(input) {
        fs.mkdirSync(input.outputDir, { recursive: true });
        return {
          metadata: {
            title: "带附件剪藏",
            platform: "generic",
            webpageUrl: input.url,
            contentType: "article",
          },
          media: [],
        };
      },
    };
    const response = createResponse();

    await handleClipCreate(cfg, { runner })({
      body: {
        url: "https://example.com/video",
        body: "用来补充自己的使用目的",
        quality: "720",
        mediaPaths: [imagePath, videoPath],
      },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    const markdownPath = path.join(cfg.sourceVaultRoot, ...String(response.body.data.path).split("/"));
    const raw = fs.readFileSync(markdownPath, "utf8");
    expect(raw).toContain("## 手动附件");
    expect(raw).toContain("![](./assets/");
    expect(raw).toContain("[视频：manual-demo.mp4](./assets/");
    expect(fs.existsSync(path.join(path.dirname(markdownPath), "assets", "带附件剪藏", "manual-frame.png"))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(markdownPath), "assets", "带附件剪藏", "manual-demo.mp4"))).toBe(true);
  });

  it("routes douyin links through the dedicated douyin sync service", async () => {
    const cfg = makeConfig();
    const collector: DouyinCollector = {
      async collect(input) {
        const videoDir = path.join(input.outputDir, "video");
        fs.mkdirSync(videoDir, { recursive: true });
        fs.writeFileSync(path.join(videoDir, "douyin.mp4"), "video", "utf8");
        return {
          post: {
            id: "7528906304966249771",
            title: "抖音路由测试",
            desc: "抖音正文",
            date: "2026-04-24",
            author: "作者A",
            tags: ["测试"],
            sourceUrl: input.url,
            videoUrl: input.url,
          },
          video: {
            sourceUrl: input.url,
            storedPath: "video/douyin.mp4",
          },
        };
      },
    };
    const response = createResponse();

    await handleClipCreate(cfg, {
      douyin: {
        collector,
        projectRoot: cfg.projectRoot,
        videoTranscriber: async () => "第一句。第二句。",
        postFormatter: async () => ({
          insightTitle: "把抖音路由测试转成行动",
          shortTitle: "抖音路由测试",
          summaryLines: ["路由摘要"],
          decisionNote: "路由决策笔记",
        }),
      },
    })({
      body: { url: "https://www.douyin.com/video/7528906304966249771" },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe("completed");
    expect(response.body.data.path).toMatch(/^raw\/剪藏\/抖音\//);
  });

  it("routes douyin short share links through the dedicated douyin sync service", async () => {
    const cfg = makeConfig();
    let collectedUrl = "";
    const collector: DouyinCollector = {
      async collect(input) {
        collectedUrl = input.url;
        const videoDir = path.join(input.outputDir, "video");
        fs.mkdirSync(videoDir, { recursive: true });
        fs.writeFileSync(path.join(videoDir, "short-link.mp4"), "video", "utf8");
        return {
          post: {
            id: "WN-2CwOCEg0",
            title: "文化传承演讲",
            desc: "我没想到居然有评委和观众哭了",
            date: "2026-03-27",
            author: "作者A",
            tags: ["文化传承"],
            sourceUrl: input.url,
            videoUrl: input.url,
          },
          video: {
            sourceUrl: input.url,
            storedPath: "video/short-link.mp4",
          },
        };
      },
    };
    const response = createResponse();

    await handleClipCreate(cfg, {
      douyin: {
        collector,
        projectRoot: cfg.projectRoot,
        videoTranscriber: async () => "第一句。第二句。",
        postFormatter: async () => ({
          insightTitle: "把文化传承演讲转成行动",
          shortTitle: "文化传承演讲",
          summaryLines: ["短链摘要"],
          decisionNote: "短链决策笔记",
        }),
      },
    })({
      body: {
        url: "https://v.douyin.com/WN-2CwOCEg0/",
        body: "我没想到居然有评委和观众哭了",
      },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe("completed");
    expect(response.body.data.path).toMatch(/^raw\/剪藏\/抖音\//);
    expect(collectedUrl).toBe("https://v.douyin.com/WN-2CwOCEg0/");
  });

  it("accepts desktop-captured douyin videos and continues the douyin sync pipeline", async () => {
    const cfg = makeConfig();
    const desktopVideo = path.join(cfg.projectRoot, "desktop-douyin.mp4");
    fs.writeFileSync(desktopVideo, "video", "utf8");
    const response = createResponse();

    await handleClipCreate(cfg, {
      douyin: {
        projectRoot: cfg.projectRoot,
        videoTranscriber: async () => "第一句。第二句。",
        postFormatter: async () => ({
          insightTitle: "把桌面抖音采集转成行动",
          shortTitle: "桌面抖音采集",
          summaryLines: ["桌面采集摘要"],
          decisionNote: "桌面采集决策笔记",
        }),
      },
    })({
      body: {
        url: "https://www.douyin.com/video/7632167323461307688",
        body: "抖音分享文案",
        desktopCapture: {
          localVideoPath: desktopVideo,
          title: "桌面采集抖音视频",
          desc: "桌面端已抓到视频文件",
          author: "桌面作者",
          date: "2026-04-24",
          durationSeconds: 18,
          videoSourceUrl: "https://www.douyin.com/video/7632167323461307688",
        },
      },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe("completed");
    expect(response.body.data.path).toMatch(/^raw\/剪藏\/抖音\//);
    const markdownPath = path.join(cfg.sourceVaultRoot, ...String(response.body.data.path).split("/"));
    const markdown = fs.readFileSync(markdownPath, "utf8");
    expect(markdown).toContain("![](video/");
    expect(markdown).toContain("桌面端已抓到视频文件");
    expect(markdown).toContain("桌面采集决策笔记");
  });

  it("reports yt-dlp detection and install guidance", async () => {
    const cfg = makeConfig();
    const status = createResponse();
    await handleYtDlpStatus(cfg, { detector: async () => ({ installed: false, source: "missing" }) })(
      {} as Request,
      status as Response,
    );

    expect(status.statusCode).toBe(200);
    expect(status.body.data.installed).toBe(false);
    expect(status.body.data.source).toBe("missing");

    const install = createResponse();
    await handleYtDlpInstall(cfg, {
      detector: async () => ({ installed: false, source: "missing" }),
      installer: async () => ({ installed: false, source: "missing", message: "yt-dlp install unavailable in test" }),
    })(
      {} as Request,
      install as Response,
    );
    expect(install.statusCode).toBe(200);
    expect(install.body.data.message).toContain("yt-dlp");
  });
});

function makeConfig(): ServerConfig {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clip-routes-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clip-routes-runtime-"));
  roots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(sourceVaultRoot, "raw", "剪藏"), { recursive: true });
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
