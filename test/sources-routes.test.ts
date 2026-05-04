import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import {
  handleSourceGalleryCompile,
  handleSourceGalleryCreate,
  handleSourceGalleryDelete,
  handleSourceGalleryDetail,
  handleSourceGalleryIngestQueue,
  handleSourceGalleryList,
  handleSourceGalleryMoveToInbox,
  handleSourceGallerySave,
} from "../web/server/routes/source-gallery.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("source gallery routes", () => {
  it("lists mixed raw and sources_full items", async () => {
    const cfg = makeConfig();
    write(cfg.sourceVaultRoot, "raw/剪藏/demo.md", "# Raw\n\nBody");
    write(cfg.runtimeRoot, "sources_full/archive.md", "# Source\n\nArchive");
    const response = createResponse();

    await handleSourceGalleryList(cfg)({ query: {} } as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.items.some((item: { layer: string }) => item.layer === "raw")).toBe(true);
    expect(response.body.data.items.some((item: { layer: string }) => item.layer === "source")).toBe(true);
  });

  it("filters source gallery items by bucket, tag, and layer and returns filter metadata", async () => {
    const cfg = makeConfig();
    write(cfg.sourceVaultRoot, "raw/剪藏/demo.md", "---\ntags: [AI, 收藏]\n---\n# Clip\n\nBody");
    write(cfg.sourceVaultRoot, "raw/闪念日记/day.md", "---\ntags: [复盘]\n---\n# Diary\n\nBody");
    write(cfg.runtimeRoot, "sources_full/archive.md", "---\ntags: [Archive]\n---\n# Source\n\nArchive");
    const response = createResponse();

    await handleSourceGalleryList(cfg)({
      query: {
        buckets: "剪藏,sources_full",
        tags: "Archive,AI",
        layers: "source",
      },
    } as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items.map((item: { path: string }) => item.path)).toEqual(["sources_full/archive.md"]);
    expect(response.body.data.filters.buckets).toEqual(["剪藏", "闪念日记", "sources_full"]);
    expect(response.body.data.filters.layers).toEqual(["raw", "source"]);
    expect(response.body.data.filters.tags).toEqual(["复盘", "收藏", "AI", "Archive"]);
  });

  it("creates clipping and flash diary entries from the composer endpoint", async () => {
    const cfg = makeConfig();
    const clipping = createResponse();
    await handleSourceGalleryCreate(cfg)({
      body: {
        type: "clipping",
        title: "Bookmark demo",
        body: "Body",
        url: "https://example.com",
        now: "2026-04-20T08:00:00.000Z",
      },
    } as unknown as Request, clipping as Response);

    expect(clipping.statusCode).toBe(200);
    expect(clipping.body.data.path).toMatch(/^raw\/剪藏\//);

    const flash = createResponse();
    await handleSourceGalleryCreate(cfg)({
      body: {
        type: "flash-diary",
        title: "Diary demo",
        body: "Body",
        now: "2026-04-20T08:00:00.000Z",
      },
    } as unknown as Request, flash as Response);

    expect(flash.statusCode).toBe(200);
    expect(flash.body.data.path).toMatch(/^raw\/闪念日记\//);
  });

  it("copies manually attached media into text-only clipping entries", async () => {
    const cfg = makeConfig();
    const imagePath = path.join(cfg.projectRoot, "manual.png");
    const videoPath = path.join(cfg.projectRoot, "manual.mp4");
    fs.writeFileSync(imagePath, "image", "utf8");
    fs.writeFileSync(videoPath, "video", "utf8");
    const response = createResponse();

    await handleSourceGalleryCreate(cfg)({
      body: {
        type: "clipping",
        title: "手动剪藏",
        body: "说明这个素材要怎么用",
        mediaPaths: [imagePath, videoPath],
        now: "2026-04-20T08:00:00.000Z",
      },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    const markdownPath = path.join(cfg.sourceVaultRoot, ...String(response.body.data.path).split("/"));
    const raw = fs.readFileSync(markdownPath, "utf8");
    expect(raw).toContain("说明这个素材要怎么用");
    expect(raw).toContain("## 手动附件");
    expect(raw).toContain("![](./assets/");
    expect(raw).toContain("[视频：manual.mp4](./assets/");
    expect(fs.existsSync(path.join(path.dirname(markdownPath), "assets", "2026-04-20-手动剪藏", "manual.png"))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(markdownPath), "assets", "2026-04-20-手动剪藏", "manual.mp4"))).toBe(true);
  });

  it("moves selected items into inbox copies", async () => {
    const cfg = makeConfig();
    write(cfg.sourceVaultRoot, "raw/剪藏/demo.md", "# Raw\n\nBody");
    const list = createResponse();
    await handleSourceGalleryList(cfg)({ query: {} } as Request, list as Response);
    const itemId = list.body.data.items[0].id;
    const response = createResponse();

    await handleSourceGalleryMoveToInbox(cfg)({
      body: { ids: [itemId] },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.moved).toHaveLength(1);
    expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "inbox", "source-gallery", "raw", "剪藏", "demo.md"))).toBe(true);
  });

  it("writes selected items into batch ingest queue", async () => {
    const cfg = makeConfig();
    write(cfg.runtimeRoot, "sources_full/archive.md", "# Source\n\nArchive");
    const list = createResponse();
    await handleSourceGalleryList(cfg)({ query: {} } as Request, list as Response);
    const itemId = list.body.data.items[0].id;
    const response = createResponse();

    await handleSourceGalleryIngestQueue(cfg)({
      body: { ids: [itemId] },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    const queueFile = path.join(cfg.runtimeRoot, ".llmwiki", "source-gallery-batch-ingest.json");
    expect(fs.existsSync(queueFile)).toBe(true);
    const queued = JSON.parse(fs.readFileSync(queueFile, "utf8"));
    expect(queued.items).toHaveLength(1);
  });

  it("returns source detail for the preview modal", async () => {
    const cfg = makeConfig();
    write(cfg.sourceVaultRoot, "raw/剪藏/demo.md", "# Demo\n\nBody");
    const list = createResponse();
    await handleSourceGalleryList(cfg)({ query: {} } as Request, list as Response);
    const itemId = list.body.data.items[0].id;
    const response = createResponse();

    await handleSourceGalleryDetail(cfg)({ params: { id: itemId } } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.raw).toContain("# Demo");
    expect(response.body.data.html).toContain("<h1");
    expect(response.body.data.media).toEqual([]);
  });

  it("saves edited source detail content back to the markdown file", async () => {
    const cfg = makeConfig();
    write(cfg.sourceVaultRoot, "raw/剪藏/demo.md", "# Demo\n\nBody");
    const list = createResponse();
    await handleSourceGalleryList(cfg)({ query: {} } as Request, list as Response);
    const itemId = list.body.data.items[0].id;
    const response = createResponse();

    await handleSourceGallerySave(cfg)({
      params: { id: itemId },
      body: { raw: "# Demo\n\nUpdated body" },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(cfg.sourceVaultRoot, "raw", "剪藏", "demo.md"), "utf8")).toContain("Updated body");
  });

  it("deletes selected gallery items from disk", async () => {
    const cfg = makeConfig();
    write(cfg.runtimeRoot, "sources_full/archive.md", "# Source\n\nArchive");
    const list = createResponse();
    await handleSourceGalleryList(cfg)({ query: {} } as Request, list as Response);
    const itemId = list.body.data.items[0].id;
    const response = createResponse();

    await handleSourceGalleryDelete(cfg)({
      body: { ids: [itemId] },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(fs.existsSync(path.join(cfg.runtimeRoot, "sources_full", "archive.md"))).toBe(false);
    expect(response.body.data.deleted).toHaveLength(1);
  });

  it("writes a guided-ingest compile input and starts a sync run", async () => {
    const cfg = makeConfig();
    write(cfg.runtimeRoot, "sources_full/archive.md", "# Source\n\nArchive body");
    const conversationId = "chat-source-1";
    fs.mkdirSync(path.join(cfg.sourceVaultRoot, ".chat"), { recursive: true });
    fs.writeFileSync(path.join(cfg.sourceVaultRoot, ".chat", `${conversationId}.json`), JSON.stringify({
      id: conversationId,
      title: "Source compile",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      agentId: null,
      articleRefs: ["sources_full/archive.md"],
      messages: [
        { id: "m1", role: "user", content: "请提炼成可编译输入", createdAt: "2026-04-24T00:00:00.000Z" },
        { id: "m2", role: "assistant", content: "已经整理出关键结构", createdAt: "2026-04-24T00:00:01.000Z" },
      ],
    }, null, 2));
    const list = createResponse();
    await handleSourceGalleryList(cfg)({ query: {} } as Request, list as Response);
    const itemId = list.body.data.items.find((item: { path: string }) => item.path === "sources_full/archive.md")?.id;
    const response = createResponse();
    let receivedContext: unknown;
    const manager = {
      start: (_kind: string, context: unknown) => {
        receivedContext = context;
        return { id: "run-sync-1" };
      },
    };

    await handleSourceGalleryCompile(cfg, manager as never)({
      params: { id: itemId },
      body: { conversationId, now: "2026-04-24T00:00:02.000Z" },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(202);
    expect(response.body.data.started).toBe(true);
    expect(response.body.data.runId).toBe("run-sync-1");
    expect(receivedContext).toEqual({
      sourceVaultRoot: cfg.sourceVaultRoot,
      runtimeRoot: cfg.runtimeRoot,
      projectRoot: cfg.projectRoot,
    });
    const compileFile = path.join(cfg.sourceVaultRoot, ...response.body.data.inputPath.split("/"));
    expect(fs.existsSync(compileFile)).toBe(true);
    const raw = fs.readFileSync(compileFile, "utf8");
    expect(raw).toContain("sources_full/archive.md");
    expect(raw).toContain("Archive body");
    expect(raw).toContain("请提炼成可编译输入");
    expect(raw).toContain("已经整理出关键结构");
  });
});

function makeConfig(): ServerConfig {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-gallery-routes-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-gallery-routes-runtime-"));
  roots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(sourceVaultRoot, "raw", "剪藏"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "raw", "闪念日记"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "sources_full"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
  return {
    sourceVaultRoot,
    runtimeRoot,
    port: 4175,
    host: "127.0.0.1",
    author: "test",
    projectRoot: sourceVaultRoot,
  };
}

function write(root: string, relativePath: string, content: string): void {
  const full = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
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
