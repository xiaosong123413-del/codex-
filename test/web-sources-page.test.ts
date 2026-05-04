// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  applySourceGalleryRowHeight,
  computeSourceGalleryRowHeight,
  renderSourcesPage,
} from "../web/client/src/pages/sources/index.js";

interface DisposableSourcesPage extends HTMLElement {
  __dispose?: () => void;
}

const renderedPages: DisposableSourcesPage[] = [];

describe("sources gallery page", () => {
  it("keeps the mode switch left and the filter controls right aligned in one row", () => {
    const css = readFileSync("web/client/styles.css", "utf8");

    expect(css).toMatch(/\.source-gallery-page__filters\s*\{[^}]*display:\s*flex;/s);
    expect(css).toMatch(/\.source-gallery-page__filters\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(css).toMatch(/\.source-gallery-filters\s*\{[^}]*justify-content:\s*flex-end;/s);
    expect(css).toMatch(/\.source-gallery-filters\s*\{[^}]*margin-left:\s*auto;/s);
    expect(css).toMatch(/\.source-gallery-filters\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(css).toMatch(/\.source-gallery-mode-switch\s*\{/);
    expect(css).toMatch(/\.source-gallery-mode-switch button\[aria-pressed="true"\]\s*\{/);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    window.localStorage.clear();
    // fallow-ignore-next-line complexity
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/source-gallery?")) {
        return ok({
          filters: {
            buckets: ["sources_full", "剪藏", "闪念日记"],
            tags: ["AI", "Archive", "收藏"],
            layers: ["raw", "source"],
          },
          items: [
            {
              id: "raw-1",
              path: "raw/剪藏/demo.md",
              title: "Raw clipping item",
              layer: "raw",
              bucket: "剪藏",
              tags: ["AI", "收藏"],
              modifiedAt: "2026-04-20T06:00:00.000Z",
              excerpt: "raw excerpt",
              previewImageUrl: "",
              mediaCount: 1,
              mediaKinds: ["audio"],
            },
            {
              id: "source-1",
              path: "sources_full/demo.md",
              title: "Compiled source item",
              layer: "source",
              bucket: "sources_full",
              tags: ["Archive"],
              modifiedAt: "2026-04-19T10:00:00.000Z",
              excerpt: "source excerpt",
              previewImageUrl: "/api/source-gallery/media?path=sources_full%2Fdemo.png",
              mediaCount: 2,
              mediaKinds: ["image", "audio"],
              ocrTextPath: ".llmwiki/ocr/source-1.txt",
            },
          ],
        });
      }
      if (url.endsWith("/api/source-gallery/raw-1")) {
        return ok({
          id: "raw-1",
          title: "Raw clipping item",
          path: "raw/剪藏/demo.md",
          raw: "# Demo\n\nBody",
          html: "<h1>Demo</h1><p>Body</p>",
          media: [],
          mediaCount: 1,
          mediaKinds: ["audio"],
        });
      }
      if (url.endsWith("/api/source-gallery/source-1")) {
        return ok({
          id: "source-1",
          title: "Compiled source item",
          path: "sources_full/demo.md",
          raw: "# Source\n\nArchive",
          html: "<h1>Source</h1><p><a href=\"/api/source-gallery/media?path=raw%2F%E5%89%AA%E8%97%8F%2Fvideo%2Fdemo.mp4\">本地视频</a></p><p>Archive</p>",
          media: [
            { kind: "image", path: "raw/剪藏/img/demo.jpg", url: "/api/source-gallery/media?path=raw%2F%E5%89%AA%E8%97%8F%2Fimg%2Fdemo.jpg" },
            { kind: "video", path: "raw/剪藏/video/demo.mp4", url: "/api/source-gallery/media?path=raw%2F%E5%89%AA%E8%97%8F%2Fvideo%2Fdemo.mp4" },
          ],
          mediaCount: 2,
          mediaKinds: ["image", "audio"],
          ocrTextPath: ".llmwiki/ocr/source-1.txt",
        });
      }
      if (url.endsWith("/api/source-gallery/source-1/ocr")) {
        return ok({ id: "source-1", path: ".llmwiki/ocr/source-1.txt", text: "OCR text" });
      }
      if (url.endsWith("/api/source-gallery/source-1/transcribe")) {
        return ok({ id: "source-1", path: ".llmwiki/transcripts/source-1.txt", text: "Transcript text" });
      }
      if (url.endsWith("/api/chat") && url !== "/api/chat/source-1/messages") {
        return ok({
          id: "chat-source-1",
          title: "源料录入：Compiled source item",
          articleRefs: ["sources_full/demo.md"],
          messages: [],
        });
      }
      if (url.endsWith("/api/chat/chat-source-1")) {
        return ok({
          id: "chat-source-1",
          title: "源料录入：Compiled source item",
          articleRefs: ["sources_full/demo.md"],
          messages: [],
        });
      }
      if (url.endsWith("/api/chat/chat-source-1/messages")) {
        return ok({
          id: "chat-source-1",
          title: "源料录入：Compiled source item",
          articleRefs: ["sources_full/demo.md"],
          messages: [
            { id: "m1", role: "user", content: "请整理成决策笔记", createdAt: "2026-04-24T00:00:00.000Z" },
            { id: "m2", role: "assistant", content: "已按当前源料生成整理建议。", createdAt: "2026-04-24T00:00:01.000Z" },
          ],
        });
      }
      if (url.endsWith("/api/source-gallery/source-1/compile")) {
        return accepted({
          inputPath: "inbox/source-gallery-guided-ingest/compiled-source-item.md",
          started: true,
          runId: "run-sync-1",
        });
      }
      return ok({});
    }));
  });

  afterEach(() => {
    for (const page of renderedPages.splice(0)) {
      page.__dispose?.();
    }
    document.body.innerHTML = "";
  });

  // fallow-ignore-next-line complexity
  it("renders filter-only chrome with a pure three-column gallery grid", async () => {
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    expect(page.querySelector(".source-gallery-page")).toBeTruthy();
    expect(page.querySelector(".source-gallery-page__filters")).toBeTruthy();
    expect(page.querySelector(".source-gallery-page__filters-head")).toBeNull();
    expect(page.querySelector(".source-gallery-grid")?.getAttribute("data-layout")).toBe("gallery-3col");
    expect(page.querySelector(".source-gallery-composer")).toBeNull();
    expect(page.querySelectorAll(".source-gallery-card").length).toBe(2);
    expect(page.querySelectorAll(".source-gallery-grid > .source-gallery-grid__cell").length).toBe(2);
    expect(page.textContent).not.toContain("SOURCES GALLERY");
    expect(page.textContent).not.toContain("新增剪藏 / 日记");
    expect(page.textContent).toContain("raw");
    expect(page.textContent).toContain("source");
    expect(page.querySelector("[data-source-gallery-view='raw-1']")?.getAttribute("aria-label")).toBe("查看原文");
    expect(page.querySelector("[data-source-gallery-card-inbox='raw-1']")?.getAttribute("aria-label")).toBe("加入 inbox");
    expect(page.querySelector(".source-gallery-selectionbar")?.classList.contains("hidden")).toBe(true);
  });

  it("focuses the source gallery search for visible cards when Ctrl+F is pressed", async () => {
    const page = renderTestSourcesPage();
    document.body.appendChild(page);
    await flush();
    await flush();

    const globalQuery = page.querySelector<HTMLInputElement>("[data-source-gallery-query]");
    expect(globalQuery).toBeTruthy();

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(document.dispatchEvent(event)).toBe(false);
    expect(page.querySelector<HTMLInputElement>("[data-page-text-search-input]")).toBeNull();
    expect(document.activeElement).toBe(globalQuery);
    expect(vi.mocked(fetch).mock.calls.some(([call]) => String(call).includes("/api/search?"))).toBe(false);
  });

  it("computes strict two-row gallery heights from the viewport height", () => {
    expect(computeSourceGalleryRowHeight(680, 16)).toBe(332);
    expect(computeSourceGalleryRowHeight(640, 16)).toBe(312);
  });

  it("applies the computed gallery row height to the root css variable", () => {
    const page = document.createElement("section");

    applySourceGalleryRowHeight(page, 680, 16);

    expect(page.style.getPropertyValue("--source-gallery-row-height")).toBe("332px");
  });

  it("applies the computed gallery row height to the real gallery page node", () => {
    const page = renderTestSourcesPage();

    applySourceGalleryRowHeight(page, 680, 16);

    expect(page.style.getPropertyValue("--source-gallery-row-height")).toBe("332px");
    expect(page.querySelector<HTMLElement>(".source-gallery-page")?.style.getPropertyValue("--source-gallery-row-height"))
      .toBe("332px");
  });

  it("keeps the five-filter chrome and internal viewport wrapper around the gallery grid", async () => {
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const chrome = page.querySelector(".source-gallery-page__chrome");
    const viewport = page.querySelector(".source-gallery-page__viewport");
    const grid = page.querySelector(".source-gallery-grid");

    expect(chrome).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(viewport?.contains(grid as Node)).toBe(true);
    expect(chrome?.textContent).toContain("搜索");
    expect(chrome?.textContent).toContain("排序");
    expect(chrome?.textContent).toContain("来源");
    expect(chrome?.textContent).toContain("标签");
    expect(chrome?.textContent).toContain("状态");
    expect(page.querySelector(".source-gallery-page__filters-head")).toBeNull();
    expect(page.querySelector(".source-gallery-composer")).toBeNull();

    const cells = page.querySelectorAll(".source-gallery-grid > .source-gallery-grid__cell");
    expect(cells.length).toBe(2);
  });

  it("places the source mode switch on the left and keeps search at the far right", async () => {
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const switcher = page.querySelector<HTMLElement>("[data-source-gallery-mode-switch]");
    const filters = page.querySelector<HTMLElement>("[data-source-gallery-controls]");
    const search = page.querySelector<HTMLElement>(".source-gallery-filter-pill--search");
    const subscriptionButton = page.querySelector<HTMLButtonElement>("[data-source-gallery-mode='subscriptions']");

    expect(switcher?.textContent).toContain("源料");
    expect(switcher?.textContent).toContain("订阅页");
    expect(filters?.lastElementChild).toBe(search);
    expect(subscriptionButton?.getAttribute("aria-pressed")).toBe("false");

    subscriptionButton?.click();
    await flush();
    await flush();

    expect(subscriptionButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps subscription items out of the source view and shows them in subscriptions", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/source-gallery?")) {
        return ok({
          filters: {
            buckets: ["剪藏", "RSS订阅"],
            tags: ["AI", "RSS"],
            layers: ["raw"],
          },
          items: [
            {
              id: "raw-1",
              path: "raw/剪藏/demo.md",
              title: "普通剪藏",
              layer: "raw",
              bucket: "剪藏",
              tags: ["AI"],
              modifiedAt: "2026-04-20T06:00:00.000Z",
              excerpt: "raw excerpt",
              previewImageUrl: "",
              mediaCount: 0,
              mediaKinds: [],
            },
            {
              id: "rss-1",
              path: "raw/RSS订阅/demo.md",
              title: "RSS 订阅文章",
              layer: "raw",
              bucket: "RSS订阅",
              tags: ["RSS"],
              modifiedAt: "2026-04-20T07:00:00.000Z",
              excerpt: "rss excerpt",
              previewImageUrl: "",
              mediaCount: 0,
              mediaKinds: [],
            },
          ],
        });
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    expect(page.textContent).toContain("普通剪藏");
    expect(page.textContent).not.toContain("RSS 订阅文章");

    page.querySelector<HTMLButtonElement>("[data-source-gallery-mode='subscriptions']")?.click();
    await flush();
    await flush();

    expect(page.textContent).not.toContain("普通剪藏");
    expect(page.textContent).toContain("RSS 订阅文章");
  });

  it("renders live source, tag, and status filters from the source gallery payload", async () => {
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    expect(page.querySelector("[data-source-gallery-filter='bucket']")).toBeTruthy();
    expect(page.querySelector("[data-source-gallery-filter='bucket'] option[value='剪藏']")).toBeTruthy();
    expect(page.querySelector("[data-source-gallery-filter='tag'] option[value='Archive']")).toBeTruthy();
    expect(page.querySelector("[data-source-gallery-filter='layer'] option[value='source']")).toBeTruthy();
  });

  it("defaults the source gallery status filter to raw", async () => {
    const fetchMock = vi.mocked(fetch);
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const layer = page.querySelector<HTMLSelectElement>("[data-source-gallery-filter='layer']");
    const firstGalleryRequest = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/source-gallery?"));

    expect(layer?.value).toBe("raw");
    expect(String(firstGalleryRequest?.[0])).toContain("layers=raw");
  });

  it("shows the selection toolbar after choosing cards", async () => {
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const checkbox = page.querySelector<HTMLInputElement>("[data-source-gallery-select='raw-1']");
    checkbox?.click();

    const toolbar = page.querySelector(".source-gallery-selectionbar");
    expect(toolbar?.classList.contains("hidden")).toBe(false);
    expect(toolbar?.textContent).toContain("导入对话");
    expect(toolbar?.textContent).toContain("批量 ingest");
    expect(toolbar?.textContent).toContain("加入 inbox");
    expect(toolbar?.textContent).toContain("批量删除");
  });

  it("uses the unified local search endpoint to filter gallery cards", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/search?")) {
        return ok({
          scope: "local",
          mode: "hybrid",
          local: {
            mode: "hybrid",
            results: [
              {
                id: "source-1",
                path: "sources_full/demo.md",
                title: "Compiled source item",
                layer: "source",
                excerpt: "source excerpt",
                tags: ["Archive"],
                modifiedAt: "2026-04-19T10:00:00.000Z",
              },
            ],
          },
          web: { configured: false, results: [] },
        });
      }
      if (url.includes("/api/source-gallery")) {
        return ok({
          filters: {
            buckets: ["sources_full", "剪藏", "闪念日记"],
            tags: ["AI", "Archive", "收藏"],
            layers: ["raw", "source"],
          },
          items: [
            {
              id: "raw-1",
              path: "raw/剪藏/demo.md",
              title: "Raw clipping item",
              layer: "raw",
              bucket: "剪藏",
              tags: ["AI", "收藏"],
              modifiedAt: "2026-04-20T06:00:00.000Z",
              excerpt: "raw excerpt",
              previewImageUrl: "",
            },
            {
              id: "source-1",
              path: "sources_full/demo.md",
              title: "Compiled source item",
              layer: "source",
              bucket: "sources_full",
              tags: ["Archive"],
              modifiedAt: "2026-04-19T10:00:00.000Z",
              excerpt: "source excerpt",
              previewImageUrl: "",
            },
          ],
        });
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const query = page.querySelector<HTMLInputElement>("[data-source-gallery-query]");
    expect(query).toBeTruthy();
    query!.value = "Archive";
    query!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
    await flush();
    await flush();

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/search?"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("scope=local"))).toBe(true);
    expect(page.textContent).toContain("Compiled source item");
    expect(page.textContent).not.toContain("Raw clipping item");
  });

  it("filters cards by local gallery text when the search index returns no results", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/search?")) {
        return ok({
          scope: "local",
          mode: "hybrid",
          local: { mode: "hybrid", results: [] },
          web: { configured: false, results: [] },
        });
      }
      if (url.includes("/api/source-gallery")) {
        return ok({
          filters: {
            buckets: ["剪藏"],
            tags: ["AI"],
            layers: ["raw"],
          },
          items: [
            {
              id: "raw-1",
              path: "raw/剪藏/match.md",
              title: "我们认真评估了你的申请",
              layer: "raw",
              bucket: "剪藏",
              tags: ["AI"],
              modifiedAt: "2026-04-20T06:00:00.000Z",
              createdAt: "2026-04-20T06:00:00.000Z",
              excerpt: "命中的卡片",
              previewImageUrl: "",
              mediaCount: 0,
              mediaKinds: [],
            },
            {
              id: "raw-2",
              path: "raw/剪藏/other.md",
              title: "无关内容",
              layer: "raw",
              bucket: "剪藏",
              tags: ["AI"],
              modifiedAt: "2026-04-19T06:00:00.000Z",
              createdAt: "2026-04-19T06:00:00.000Z",
              excerpt: "不应该出现",
              previewImageUrl: "",
              mediaCount: 0,
              mediaKinds: [],
            },
          ],
        });
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const query = page.querySelector<HTMLInputElement>("[data-source-gallery-query]");
    query!.value = "我们";
    query!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
    await flush();
    await flush();

    expect(page.textContent).toContain("我们认真评估了你的申请");
    expect(page.textContent).not.toContain("无关内容");
  });

  it("keeps server-filtered OCR source results when unified search only returns wiki paths", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/search?")) {
        return ok({
          scope: "local",
          mode: "hybrid",
          local: {
            mode: "hybrid",
            results: [
              {
                id: "wiki-about",
                path: "wiki/about-me.md",
                title: "About Me",
                layer: "wiki",
                excerpt: "wiki result",
                tags: [],
                modifiedAt: "2026-04-29T00:00:00.000Z",
              },
            ],
          },
          web: { configured: false, results: [] },
        });
      }
      if (url.includes("/api/source-gallery?")) {
        return ok({
          filters: {
            buckets: ["剪藏"],
            tags: [],
            layers: ["raw"],
          },
          items: [
            {
              id: "ocr-1",
              path: "raw/剪藏/ocr-image.md",
              title: "OCR 图片源料",
              layer: "raw",
              bucket: "剪藏",
              tags: [],
              modifiedAt: "2026-04-29T00:00:00.000Z",
              excerpt: "图片里包含我们",
              previewImageUrl: "",
              mediaCount: 1,
              mediaKinds: ["image"],
              ocrTextPath: ".llmwiki/ocr/ocr-1.txt",
            },
          ],
        });
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const query = page.querySelector<HTMLInputElement>("[data-source-gallery-query]");
    query!.value = "我们";
    query!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
    await flush();
    await flush();

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/search?"))).toBe(true);
    expect(page.textContent).toContain("OCR 图片源料");
  });

  it("sends selected bucket, tag, and layer filters back to the source gallery API", async () => {
    const fetchMock = vi.mocked(fetch);
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    const bucket = page.querySelector<HTMLSelectElement>("[data-source-gallery-filter='bucket']");
    const tag = page.querySelector<HTMLSelectElement>("[data-source-gallery-filter='tag']");
    const layer = page.querySelector<HTMLSelectElement>("[data-source-gallery-filter='layer']");

    bucket!.value = "sources_full";
    bucket!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();

    tag!.value = "Archive";
    tag!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();

    layer!.value = "source";
    layer!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("buckets=sources_full"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("tags=Archive"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("layers=source"))).toBe(true);
  });

  it("keeps selected article refs for chat even after filtering hides the selected card", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/search?")) {
        return ok({
          scope: "local",
          mode: "hybrid",
          local: {
            mode: "hybrid",
            results: [
              {
                id: "source-1",
                path: "sources_full/demo.md",
                title: "Compiled source item",
                layer: "source",
                excerpt: "source excerpt",
                tags: ["Archive"],
                modifiedAt: "2026-04-19T10:00:00.000Z",
              },
            ],
          },
          web: { configured: false, results: [] },
        });
      }
      if (url.includes("/api/source-gallery?")) {
        return ok({
          filters: {
            buckets: ["sources_full", "剪藏", "闪念日记"],
            tags: ["AI", "Archive", "收藏"],
            layers: ["raw", "source"],
          },
          items: [
            {
              id: "raw-1",
              path: "raw/剪藏/demo.md",
              title: "Raw clipping item",
              layer: "raw",
              bucket: "剪藏",
              tags: ["AI", "收藏"],
              modifiedAt: "2026-04-20T06:00:00.000Z",
              excerpt: "raw excerpt",
              previewImageUrl: "",
              mediaCount: 1,
              mediaKinds: ["audio"],
            },
            {
              id: "source-1",
              path: "sources_full/demo.md",
              title: "Compiled source item",
              layer: "source",
              bucket: "sources_full",
              tags: ["Archive"],
              modifiedAt: "2026-04-19T10:00:00.000Z",
              excerpt: "source excerpt",
              previewImageUrl: "",
              mediaCount: 2,
              mediaKinds: ["image", "audio"],
            },
          ],
        });
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLInputElement>("[data-source-gallery-select='raw-1']")?.click();

    const query = page.querySelector<HTMLInputElement>("[data-source-gallery-query]");
    query!.value = "Archive";
    query!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
    await flush();
    await flush();

    page.querySelector<HTMLButtonElement>("[data-source-gallery-batch='chat']")?.click();

    expect(window.localStorage.getItem("llmWiki.pendingChatArticleRefs")).toBe(JSON.stringify(["raw/剪藏/demo.md"]));
    expect(window.location.hash).toBe("#/chat");
  });

  it("opens a fullscreen workspace with rendered content and chat panel", async () => {
    const fetchMock = vi.mocked(fetch);
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view='source-1']")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    const workspace = document.querySelector("[data-source-gallery-workspace='true']");
    expect(workspace).toBeTruthy();
    expect(workspace?.querySelector("[data-source-workspace-close]")?.textContent).toContain("关闭");
    expect(workspace?.querySelector("[data-source-workspace-delete='source-1']")?.textContent).toContain("删除");
    expect(workspace?.querySelector("[data-source-workspace-swap]")?.textContent).toContain("对调位置");
    expect(workspace?.querySelector(".source-gallery-workspace__rendered h1")?.textContent).toContain("Source");
    expect(workspace?.querySelector(".source-gallery-media-embed video")?.getAttribute("src")).toContain("/api/source-gallery/media?");
    expect(workspace?.querySelector(".source-gallery-media-embed img")?.getAttribute("src")).toContain("/api/source-gallery/media?");
    expect(workspace?.querySelector(".source-gallery-workspace__rendered a")?.getAttribute("href")).toContain("/api/source-gallery/media?");
    expect(workspace?.querySelector("[data-source-workspace-messages]")).toBeTruthy();
    expect(workspace?.querySelector("[data-source-workspace-input='source-1']")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"agentId\":\"wiki-general\""),
      }),
    );
  });

  it("opens current-page find inside the fullscreen source preview", async () => {
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view='source-1']")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    const workspace = document.querySelector<HTMLElement>("[data-source-gallery-workspace='true']");
    expect(workspace).toBeTruthy();

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(document.dispatchEvent(event)).toBe(false);

    const previewFindInput = workspace?.querySelector<HTMLInputElement>("[data-page-text-search-input]");
    expect(previewFindInput).toBeTruthy();
    expect(document.activeElement).toBe(previewFindInput);

    previewFindInput!.value = "Archive";
    previewFindInput!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(workspace?.querySelector("[data-page-text-search-status]")?.textContent).toBe("1 个结果");
    expect(workspace?.querySelectorAll(".source-gallery-workspace__pane--content [data-page-text-search-mark]").length)
      .toBeGreaterThan(0);
    const pageFindInput = page.querySelector<HTMLInputElement>("[data-page-text-search-input]");
    expect(pageFindInput).not.toBe(previewFindInput);
    expect(document.activeElement).not.toBe(pageFindInput);
  });

  it("positions the page text find bar at the top right when it is used", () => {
    const css = readFileSync("web/client/styles.css", "utf8");

    expect(css).toMatch(/\.page-text-search\s*\{[^}]*position:\s*fixed;/s);
    expect(css).toMatch(/\.page-text-search\s*\{[^}]*top:\s*[^;]+;/s);
    expect(css).toMatch(/\.page-text-search\s*\{[^}]*right:\s*[^;]+;/s);
  });

  it("removes the fullscreen workspace overlay when the page is disposed", async () => {
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view='source-1']")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    expect(document.querySelector("[data-source-gallery-workspace='true']")).toBeTruthy();

    page.__dispose?.();

    expect(document.querySelector("[data-source-gallery-workspace='true']")).toBeNull();
  });

  it("reports workspace open failures through page status instead of leaving an unhandled action", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/source-gallery?")) {
        return ok({
          filters: {
            buckets: ["sources_full"],
            tags: ["Archive"],
            layers: ["source"],
          },
          items: [
            {
              id: "source-1",
              path: "sources_full/demo.md",
              title: "Compiled source item",
              layer: "source",
              bucket: "sources_full",
              tags: ["Archive"],
              modifiedAt: "2026-04-19T10:00:00.000Z",
              createdAt: "2026-04-19T10:00:00.000Z",
              excerpt: "source excerpt",
              previewImageUrl: "",
              mediaCount: 2,
              mediaKinds: ["image", "audio"],
            },
          ],
        });
      }
      if (url.endsWith("/api/source-gallery/source-1")) {
        return fail("workspace unavailable");
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view='source-1']")?.click();
    await flush();
    await flush();

    expect(page.querySelector("[data-source-gallery-status]")?.textContent).toContain("workspace unavailable");
    expect(document.querySelector("[data-source-gallery-workspace='true']")).toBeNull();
  });

  it("sends guided-ingest chat messages from the fullscreen workspace", async () => {
    const fetchMock = vi.mocked(fetch);
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view='source-1']")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    const input = document.querySelector<HTMLTextAreaElement>("[data-source-workspace-input='source-1']");
    input!.value = "请整理成决策笔记";
    document.querySelector<HTMLButtonElement>("[data-source-workspace-send='source-1']")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/chat-source-1/messages",
      expect.objectContaining({ method: "POST" }),
    );
    expect(document.querySelector("[data-source-workspace-messages]")?.textContent).toContain("已按当前源料生成整理建议。");
  });

  it("binds workspace controls without interpolating raw ids into internal selectors", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/source-gallery?")) {
        return ok({
          filters: {
            buckets: ["sources_full"],
            tags: ["Archive"],
            layers: ["source"],
          },
          items: [
            {
              id: "source-1'boom",
              path: "sources_full/special.md",
              title: "Special source item",
              layer: "source",
              bucket: "sources_full",
              tags: ["Archive"],
              modifiedAt: "2026-04-19T10:00:00.000Z",
              createdAt: "2026-04-19T10:00:00.000Z",
              excerpt: "source excerpt",
              previewImageUrl: "",
              mediaCount: 0,
              mediaKinds: [],
            },
          ],
        });
      }
      if (url.endsWith("/api/source-gallery/source-1'boom") || url.endsWith("/api/source-gallery/source-1%27boom")) {
        return ok({
          id: "source-1'boom",
          title: "Special source item",
          path: "sources_full/special.md",
          raw: "# Special\n\nArchive",
          html: "<h1>Special</h1><p>Archive</p>",
          media: [],
          mediaCount: 0,
          mediaKinds: [],
        });
      }
      if (url.endsWith("/api/chat") && url !== "/api/chat/chat-special/messages") {
        return ok({
          id: "chat-special",
          title: "源料录入：Special source item",
          articleRefs: ["sources_full/special.md"],
          messages: [],
        });
      }
      if (url.endsWith("/api/chat/chat-special")) {
        return ok({
          id: "chat-special",
          title: "源料录入：Special source item",
          articleRefs: ["sources_full/special.md"],
          messages: [],
        });
      }
      if (url.endsWith("/api/chat/chat-special/messages")) {
        return ok({
          id: "chat-special",
          title: "源料录入：Special source item",
          articleRefs: ["sources_full/special.md"],
          messages: [
            { id: "m1", role: "assistant", content: "特殊源料也能发送消息。", createdAt: "2026-04-24T00:00:01.000Z" },
          ],
        });
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view]")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    const workspace = document.querySelector<HTMLElement>("[data-source-gallery-workspace='true']");
    expect(workspace).toBeTruthy();

    const input = workspace?.querySelector<HTMLTextAreaElement>("[data-source-workspace-input]");
    input!.value = "特殊 ID 测试";
    workspace?.querySelector<HTMLButtonElement>("[data-source-workspace-send]")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/chat-special/messages",
      expect.objectContaining({ method: "POST" }),
    );
    expect(workspace?.querySelector("[data-source-workspace-messages]")?.textContent).toContain("特殊源料也能发送消息。");
  });

  it("queues compile from the source workspace using the source and guided-ingest conversation", async () => {
    const fetchMock = vi.mocked(fetch);
    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view='source-1']")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    document.querySelector<HTMLButtonElement>("[data-source-workspace-compile='source-1']")?.click();
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/source-gallery/source-1/compile",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"conversationId\":\"chat-source-1\""),
      }),
    );
    expect(page.querySelector("[data-source-gallery-status]")?.textContent?.toLowerCase()).toContain("compile");
  });

  it("reports workspace delete failures through page status", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE" && url === "/api/source-gallery") {
        return fail("delete failed");
      }
      if (url.includes("/api/source-gallery?")) {
        return ok({
          filters: {
            buckets: ["sources_full"],
            tags: ["Archive"],
            layers: ["source"],
          },
          items: [
            {
              id: "source-1",
              path: "sources_full/demo.md",
              title: "Compiled source item",
              layer: "source",
              bucket: "sources_full",
              tags: ["Archive"],
              modifiedAt: "2026-04-19T10:00:00.000Z",
              createdAt: "2026-04-19T10:00:00.000Z",
              excerpt: "source excerpt",
              previewImageUrl: "",
              mediaCount: 2,
              mediaKinds: ["image", "audio"],
            },
          ],
        });
      }
      if (url.endsWith("/api/source-gallery/source-1")) {
        return ok({
          id: "source-1",
          title: "Compiled source item",
          path: "sources_full/demo.md",
          raw: "# Source\n\nArchive",
          html: "<h1>Source</h1><p>Archive</p>",
          media: [],
          mediaCount: 2,
          mediaKinds: ["image", "audio"],
        });
      }
      if (url.endsWith("/api/chat") && url !== "/api/chat/chat-source-1/messages") {
        return ok({
          id: "chat-source-1",
          title: "源料录入：Compiled source item",
          articleRefs: ["sources_full/demo.md"],
          messages: [],
        });
      }
      if (url.endsWith("/api/chat/chat-source-1")) {
        return ok({
          id: "chat-source-1",
          title: "源料录入：Compiled source item",
          articleRefs: ["sources_full/demo.md"],
          messages: [],
        });
      }
      return ok({});
    });

    const page = renderTestSourcesPage();
    await flush();
    await flush();

    page.querySelector<HTMLElement>("[data-source-gallery-view='source-1']")?.click();
    await flush();
    await flush();
    await flush();
    await flush();

    document.querySelector<HTMLButtonElement>("[data-source-workspace-delete='source-1']")?.click();
    await flush();
    await flush();

    expect(page.querySelector("[data-source-gallery-status]")?.textContent).toContain("delete failed");
    expect(document.querySelector("[data-source-gallery-workspace='true']")).toBeTruthy();
  });
});

function ok(data: unknown) {
  return {
    ok: true,
    json: async () => ({ success: true, data }),
  };
}

function accepted(data: unknown) {
  return {
    ok: true,
    status: 202,
    json: async () => ({ success: true, data }),
  };
}

function fail(error: string) {
  return {
    ok: false,
    status: 500,
    json: async () => ({ success: false, error }),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
}

function renderTestSourcesPage(): DisposableSourcesPage {
  const page = renderSourcesPage() as DisposableSourcesPage;
  renderedPages.push(page);
  return page;
}
