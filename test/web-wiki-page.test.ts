// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderWikiPage } from "../web/client/src/pages/wiki/index.js";

describe("wiki page search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.llmWikiDesktop;
    installWikiStyles();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return rawOk({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              kind: "dir",
              children: [
                { name: "index.md", path: "wiki/index.md", kind: "file" },
              ],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/index.md",
          title: "Index",
          html: "<h1>Index</h1><h2>Overview</h2><h3>Details</h3>",
          raw: "# Index\n\n## Overview\n\n### Details",
          frontmatter: null,
          modifiedAt: "2026-04-21T00:00:00.000Z",
        });
      }
      if (url.includes("/api/search?")) {
        return ok({
          scope: "local",
          mode: "hybrid",
          local: {
            mode: "hybrid",
            results: [
              {
                id: "concept-ai",
                path: "wiki/concepts/ai.md",
                title: "AI",
                layer: "wiki",
                excerpt: "人工智能相关页面",
                tags: ["AI"],
                modifiedAt: "2026-04-21T00:00:00.000Z",
              },
            ],
          },
          web: { configured: false, results: [] },
        });
      }
      return ok({});
    }));
  });

  it("submits wiki search through the unified local search endpoint", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const input = page.querySelector<HTMLInputElement>("[data-wiki-search-input]");
    const form = page.querySelector<HTMLFormElement>("[data-wiki-search]");
    expect(input).toBeTruthy();
    expect(form).toBeTruthy();
    input!.value = "人工智能";
    form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "人工智能相关页面");

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([call]) => String(call).includes("/api/search?"))).toBe(true);
    expect(fetchMock.mock.calls.some(([call]) => String(call).includes("scope=local"))).toBe(true);
    expect(page.textContent).toContain("搜索：人工智能");
    expect(page.textContent).toContain("AI");
    expect(page.textContent).toContain("人工智能相关页面");
  });

  it("opens current-page find for the loaded wiki article when Ctrl+F is pressed", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const globalInput = page.querySelector<HTMLInputElement>("[data-wiki-search-input]");
    expect(globalInput).toBeTruthy();

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(document.dispatchEvent(event)).toBe(false);
    const findInput = page.querySelector<HTMLInputElement>("[data-page-text-search-input]");
    expect(findInput).toBeTruthy();
    expect(document.activeElement).toBe(findInput);
    expect(document.activeElement).not.toBe(globalInput);

    findInput!.value = "Overview";
    findInput!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(window.getSelection()?.toString()).toBe("");
    expect(page.querySelectorAll("[data-page-text-search-mark]").length).toBeGreaterThan(0);

    page.querySelector<HTMLButtonElement>("[data-page-text-search-next]")?.click();

    expect(window.getSelection()?.toString()).toBe("Overview");
    expect(vi.mocked(fetch).mock.calls.some(([call]) => String(call).includes("/api/search?"))).toBe(false);
  });

  it("renders a collapsible article toc from headings", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const tocToggle = page.querySelector<HTMLButtonElement>("[data-wiki-toc-toggle]");
    const tocPanel = page.querySelector<HTMLElement>("[data-wiki-toc-panel]");
    const tocList = page.querySelector<HTMLElement>("[data-wiki-toc-list]");

    expect(tocToggle?.disabled).toBe(false);
    expect(tocPanel?.hidden).toBe(true);

    tocToggle?.click();

    expect(tocPanel?.hidden).toBe(false);
    expect(tocList?.textContent).toContain("Index");
    expect(tocList?.textContent).toContain("Overview");
    expect(tocList?.textContent).toContain("Details");
  });

  it("mounts a page-local Graphy panel above ordinary wiki articles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/index.md",
          title: "Concept Index",
          html: "<h1>Concept Index</h1><p>Overview</p>",
          raw: "# Concept Index",
          frontmatter: null,
          modifiedAt: "2026-05-02T00:00:00.000Z",
        });
      }
      if (url.includes("/api/wiki/graph?")) {
        return ok({ nodes: [], edges: [] });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");
    await waitForText(page, "当前条目还没有可展示的相关连接");

    const graph = page.querySelector<HTMLElement>("[data-wiki-page-graph]");
    const article = page.querySelector<HTMLElement>("[data-wiki-article]");
    expect(graph?.hidden).toBe(false);
    expect(graph?.nextElementSibling).toBe(article);
    expect(vi.mocked(fetch).mock.calls.some(([call]) => (
      String(call).includes("/api/wiki/graph?path=wiki%2Fconcepts%2Findex.md")
    ))).toBe(true);
  });

  it("renders separate page mode and reading tool groups in the top tool row", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const pageModeGroup = page.querySelector<HTMLElement>("[data-wiki-page-mode-group]");
    const readingToolsGroup = page.querySelector<HTMLElement>("[data-wiki-reading-tools-group]");
    const articleTab = pageModeGroup?.querySelector("a[aria-current='page']");
    const talkAction = pageModeGroup?.querySelector<HTMLButtonElement>("[data-wiki-action='talk']");
    const readTab = readingToolsGroup?.querySelector("a[aria-current='page']");
    const tocToggle = readingToolsGroup?.querySelector<HTMLButtonElement>("[data-wiki-toc-toggle]");
    const commentAction = readingToolsGroup?.querySelector<HTMLButtonElement>("[data-wiki-comment-action]");

    expect(pageModeGroup).toBeTruthy();
    expect(readingToolsGroup).toBeTruthy();
    expect(articleTab?.textContent).toBe("Article");
    expect(talkAction?.textContent).toBe("Talk");
    expect(readTab?.textContent).toBe("Read");
    expect(tocToggle?.textContent).toBe("目录");
    expect(commentAction?.textContent).toBe("Comment");
    expect(pageModeGroup?.querySelector("[data-wiki-toc-toggle]")).toBeNull();
    expect(pageModeGroup?.querySelector("[data-wiki-comment-action]")).toBeNull();
    expect(readingToolsGroup?.querySelector("[data-wiki-action='talk']")).toBeNull();
  });

  it("renders the wiki brand as a link to the about-me page", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const brandLink = page.querySelector<HTMLAnchorElement>("[data-wiki-brand-link]");
    expect(brandLink).toBeTruthy();
    expect(brandLink?.getAttribute("href")).toBe("#/wiki/wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md");
  });

  it("renders the wiki sidebar as a relative path tree and copies relative or absolute paths", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    window.llmWikiDesktop = {
      getDesktopConfig: vi.fn().mockResolvedValue({ targetVault: "D:\\Desktop\\ai的仓库" }),
    } as typeof window.llmWikiDesktop;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return rawOk({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [{
            name: "wiki",
            path: "wiki",
            kind: "dir",
            children: [{
              name: "个人信息档案",
              path: "wiki/个人信息档案",
              kind: "dir",
              children: [
                { name: "个人时间线.md", path: "wiki/个人信息档案/个人时间线.md", kind: "file" },
                { name: "个人信息和事实.md", path: "wiki/个人信息档案/个人信息和事实.md", kind: "file" },
              ],
            }, {
              name: "聊天记录",
              path: "wiki/聊天记录",
              kind: "dir",
              children: [{ name: "index.md", path: "wiki/聊天记录/index.md", kind: "file" }],
            }, {
              name: "concepts",
              path: "wiki/concepts",
              kind: "dir",
              children: [{ name: "index.md", path: "wiki/concepts/index.md", kind: "file" }],
            }],
          }],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/个人信息档案/个人时间线.md",
          title: "个人时间线",
          html: "<h1>个人时间线</h1><p>Overview</p>",
          raw: "# 个人时间线",
          frontmatter: null,
          modifiedAt: "2026-04-29T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/个人时间线.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-navigation]")!, "个人信息档案");

    const folderNode = page.querySelector<HTMLElement>("[data-wiki-path-node='wiki/个人信息档案']");
    const chatFolderNode = page.querySelector<HTMLElement>("[data-wiki-path-node='wiki/聊天记录']");
    const conceptsFolderNode = page.querySelector<HTMLElement>("[data-wiki-path-node='wiki/concepts']");
    const fileNode = page.querySelector<HTMLElement>("[data-wiki-path-node='wiki/个人信息档案/个人时间线.md']");
    const factsNode = page.querySelector<HTMLElement>("[data-wiki-path-node='wiki/个人信息档案/个人信息和事实.md']");
    const sidebarCategories = page.querySelector<HTMLElement>("[data-wiki-sidebar-categories]");
    expect(folderNode).toBeTruthy();
    expect(chatFolderNode).toBeNull();
    expect(conceptsFolderNode).toBeTruthy();
    expect(fileNode).toBeTruthy();
    expect(factsNode).toBeTruthy();
    expect(page.querySelector("[data-wiki-copy-path]")).toBeNull();
    expect(sidebarCategories?.closest("section")?.hidden).toBe(true);

    folderNode?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".wiki-path-copy-menu")?.textContent).toContain("复制路径");
    document.querySelector<HTMLButtonElement>("[data-wiki-copy-mode='relative']")?.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith("wiki/个人信息档案");

    fileNode?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".wiki-path-copy-menu")?.textContent).toContain("基于库的相对路径");
    document.querySelector<HTMLButtonElement>("[data-wiki-copy-mode='relative']")?.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith("wiki/个人信息档案/个人时间线.md");

    fileNode?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".wiki-path-copy-menu")?.textContent).toContain("绝对路径");
    document.querySelector<HTMLButtonElement>("[data-wiki-copy-mode='absolute']")?.click();
    await flush();
    await flush();
    expect(writeText).toHaveBeenCalledWith("D:\\Desktop\\ai的仓库\\wiki\\个人信息档案\\个人时间线.md");

    fileNode?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".wiki-path-copy-menu")).toBeTruthy();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector(".wiki-path-copy-menu")).toBeNull();

    const conceptsItem = conceptsFolderNode?.closest<HTMLElement>("[data-wiki-path-item]");
    const folderItem = folderNode?.closest<HTMLElement>("[data-wiki-path-item]");
    dispatchSidebarDrag(conceptsFolderNode!, "dragstart", { dataTransferPath: "wiki/concepts" });
    dispatchSidebarDrag(folderNode!, "drop", { clientY: 0 });
    expect(folderItem?.parentElement?.firstElementChild).toBe(conceptsItem);
    expect(localStorage.getItem("llmWiki.sidebarPathOrder.v1")).toContain("wiki/concepts");

    const factsItem = factsNode?.closest<HTMLElement>("[data-wiki-path-item]");
    const fileItem = fileNode?.closest<HTMLElement>("[data-wiki-path-item]");
    dispatchSidebarDrag(factsNode!, "dragstart", { dataTransferPath: "wiki/个人信息档案/个人信息和事实.md" });
    dispatchSidebarDrag(fileNode!, "drop", { clientY: 0 });
    expect(fileItem?.parentElement?.firstElementChild).toBe(factsItem);
  });

  it("deletes single and selected pages from the wiki sidebar", async () => {
    const deletedBodies: Array<{ paths?: string[] }> = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return rawOk({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [{
            name: "wiki",
            path: "wiki",
            kind: "dir",
            children: [{
              name: "案例库",
              path: "wiki/案例库",
              kind: "dir",
              children: [
                { name: "A.md", path: "wiki/案例库/A.md", kind: "file" },
                { name: "B.md", path: "wiki/案例库/B.md", kind: "file" },
              ],
            }],
          }],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/案例库/A.md",
          title: "A",
          html: "<h1>A</h1><p>Overview</p>",
          raw: "# A",
          frontmatter: null,
          modifiedAt: "2026-04-29T00:00:00.000Z",
        });
      }
      if (url.endsWith("/api/page") && init?.method === "DELETE") {
        deletedBodies.push(JSON.parse(String(init.body ?? "{}")) as { paths?: string[] });
        return ok({ paths: deletedBodies.at(-1)?.paths ?? [] });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/案例库/A.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-navigation]")!, "案例库");

    page.querySelector<HTMLButtonElement>("[data-wiki-delete-path='wiki/案例库/A.md']")?.click();
    await waitForCondition(() => deletedBodies.length === 1);
    expect(deletedBodies[0]).toEqual({ paths: ["wiki/案例库/A.md"] });

    page.querySelector<HTMLButtonElement>("[data-wiki-delete-select]")?.click();
    page.querySelector<HTMLInputElement>("[data-wiki-delete-check='wiki/案例库/A.md']")?.click();
    page.querySelector<HTMLInputElement>("[data-wiki-delete-check='wiki/案例库/B.md']")?.click();
    page.querySelector<HTMLButtonElement>("[data-wiki-delete-selected]")?.click();
    await waitForCondition(() => deletedBodies.length === 2);
    await waitForCondition(() => page.querySelector<HTMLButtonElement>("[data-wiki-delete-selected]")?.hidden === true);

    expect(deletedBodies[1]).toEqual({ paths: ["wiki/案例库/A.md", "wiki/案例库/B.md"] });
    expect(page.querySelector<HTMLButtonElement>("[data-wiki-delete-selected]")?.hidden).toBe(true);
  });

  it("shows a linked wiki page preview after hovering a wikilink for one second", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("path=wiki%2Fconcepts%2Fpreview.md")) {
        return rawOk({
          path: "wiki/concepts/preview.md",
          title: "Preview Page",
          html: "<h1>Preview Page</h1><p>这是一段页面开头的预览文字，会被放进悬停小窗口。</p>",
          frontmatter: { side_image: "wiki/.page-media/preview.png" },
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/index.md",
          title: "Index",
          html: '<p>打开 <a class="wikilink wikilink-alive" href="/?page=wiki%2Fconcepts%2Fpreview.md" data-wikilink-target="Preview Page">Preview Page</a></p>',
          frontmatter: null,
          modifiedAt: "2026-04-21T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/concepts/index.md");
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Preview Page");

    const link = page.querySelector<HTMLAnchorElement>("a.wikilink");
    expect(link).toBeTruthy();
    link!.getBoundingClientRect = () => createDomRect({ left: 120, top: 80, width: 90, height: 24 });

    vi.useFakeTimers();
    try {
      link!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(999);
      expect(page.querySelector<HTMLElement>(".wiki-link-preview")?.hidden).toBe(true);
      expect(vi.mocked(fetch).mock.calls.some(([call]) => (
        String(call).includes("path=wiki%2Fconcepts%2Fpreview.md")
      ))).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      await flush();

      const preview = page.querySelector<HTMLElement>(".wiki-link-preview");
      const image = preview?.querySelector<HTMLImageElement>(".wiki-link-preview__image img");
      expect(preview?.hidden).toBe(false);
      expect(preview?.textContent).toContain("这是一段页面开头的预览文字");
      expect(image?.getAttribute("src")).toBe("/api/page-side-image?path=wiki%2F.page-media%2Fpreview.png");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals the selection comment toolbar only for article text selections", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
    expect(toolbar?.hidden).toBe(true);

    const headingText = page.querySelector("[data-wiki-article] h2")?.firstChild;
    const range = document.createRange();
    range.setStart(headingText!, 0);
    range.setEnd(headingText!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    expect(toolbar?.hidden).toBe(false);

    selection.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    expect(toolbar?.hidden).toBe(true);
  });

  it("renders comment copy and cancel actions in the selection toolbar", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const headingText = page.querySelector("[data-wiki-article] h2")?.firstChild;
    const range = document.createRange();
    range.setStart(headingText!, 0);
    range.setEnd(headingText!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
    expect(toolbar?.hidden).toBe(false);
    expect(toolbar?.textContent).toContain("评论");
    expect(toolbar?.textContent).toContain("复制");
    expect(toolbar?.textContent).toContain("取消");
  });

  it("copies the current selection from the toolbar and dismisses it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const headingText = page.querySelector("[data-wiki-article] h2")?.firstChild;
    const range = document.createRange();
    range.setStart(headingText!, 0);
    range.setEnd(headingText!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
    page.querySelector<HTMLButtonElement>("[data-wiki-selection-copy]")?.click();
    await waitForCondition(() => writeText.mock.calls.length > 0);

    expect(writeText).toHaveBeenCalledWith("Over");
    expect(toolbar?.hidden).toBe(true);
    expect(selection.rangeCount).toBe(0);
  });

  it("cancels the current selection from the toolbar", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const headingText = page.querySelector("[data-wiki-article] h2")?.firstChild;
    const range = document.createRange();
    range.setStart(headingText!, 0);
    range.setEnd(headingText!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
    page.querySelector<HTMLButtonElement>("[data-wiki-selection-cancel]")?.click();

    expect(toolbar?.hidden).toBe(true);
    expect(selection.rangeCount).toBe(0);
  });

  it("anchors the selection comment toolbar to the live range rect", async () => {
    const rangeRect = createDomRect({ left: 120, top: 160, width: 80, height: 24 });
    const originalDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => rangeRect,
    });

    try {
      const page = renderWikiPage("wiki/concepts/index.md");
      document.body.appendChild(page);
      await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

      const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
      const headingText = page.querySelector("[data-wiki-article] h2")?.firstChild;
      const range = document.createRange();
      range.setStart(headingText!, 0);
      range.setEnd(headingText!, 4);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await flush();

      expect(toolbar?.hidden).toBe(false);
      expect(toolbar?.style.left).toBe("160px");
      expect(toolbar?.style.top).toBe("148px");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Range.prototype, "getBoundingClientRect", originalDescriptor);
      } else {
        delete (Range.prototype as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
      }
    }
  });

  it("keeps the selection toolbar on-screen near viewport edges", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 300,
    });

    const originalRangeDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

    try {
      const page = renderWikiPage("wiki/concepts/index.md");
      document.body.appendChild(page);
      await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

      const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]")!;
      vi.spyOn(toolbar, "getBoundingClientRect").mockImplementation(() =>
        toolbar.hidden
          ? createDomRect({ left: 0, top: 0, width: 0, height: 36 })
          : createDomRect({ left: 0, top: 0, width: 220, height: 36 }),
      );

      const headingText = page.querySelector("[data-wiki-article] h2")?.firstChild;
      const range = document.createRange();
      range.setStart(headingText!, 0);
      range.setEnd(headingText!, 4);
      const selection = window.getSelection()!;

      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => createDomRect({ left: 2, top: 160, width: 24, height: 24 }),
      });

      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await flush();

      expect(Number.parseFloat(toolbar.style.left)).toBeGreaterThanOrEqual(122);

      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => createDomRect({ left: 282, top: 160, width: 24, height: 24 }),
      });

      document.dispatchEvent(new Event("selectionchange"));
      await flush();

      expect(Number.parseFloat(toolbar.style.left)).toBeLessThanOrEqual(178);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
      if (originalRangeDescriptor) {
        Object.defineProperty(Range.prototype, "getBoundingClientRect", originalRangeDescriptor);
      } else {
        delete (Range.prototype as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
      }
    }
  });

  it("does not reveal the selection comment toolbar for selections outside the article", async () => {
    const page = renderWikiPage("wiki/concepts/index.md");
    const outsideBoundary = document.createElement("div");
    outsideBoundary.dataset.testOutsideArticleBoundary = "true";
    outsideBoundary.textContent = "outside article boundary";
    document.body.appendChild(page);
    document.body.appendChild(outsideBoundary);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
    const outsideText = outsideBoundary.firstChild;
    const range = document.createRange();
    range.setStart(outsideText!, 0);
    range.setEnd(outsideText!, outsideText!.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    expect(toolbar?.hidden).toBe(true);
  });

  it("clears preserved selection when a new document replaces the article", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              kind: "dir",
              children: [
                { name: "first.md", path: "wiki/concepts/first.md", kind: "file" },
                { name: "second.md", path: "wiki/concepts/second.md", kind: "file" },
              ],
            },
          ],
        });
      }
      if (url.includes("/api/page?path=wiki%2Fconcepts%2Ffirst.md")) {
        return rawOk({
          path: "wiki/concepts/first.md",
          title: "First",
          html: "<h1>First</h1><p id=\"first-target\">Alpha Beta Gamma</p>",
          raw: "# First",
          frontmatter: null,
          modifiedAt: "2026-04-21T00:00:00.000Z",
        });
      }
      if (url.includes("/api/page?path=wiki%2Fconcepts%2Fsecond.md")) {
        return rawOk({
          path: "wiki/concepts/second.md",
          title: "Second",
          html: "<h1>Second</h1><p>Fresh document</p>",
          raw: "# Second",
          frontmatter: null,
          modifiedAt: "2026-04-22T00:00:00.000Z",
        });
      }
      if (url.startsWith("/api/wiki-comments?path=")) {
        return ok([]);
      }
      if (url === "/api/wiki-comments" && init?.method === "POST") {
        return ok({
          id: "comment-1",
          path: "wiki/concepts/second.md",
          quote: "stale",
          text: "",
          start: 0,
          end: 5,
          resolved: false,
          createdAt: "2026-04-24T00:05:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/concepts/first.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");

    const textNode = page.querySelector("#first-target")?.lastChild;
    const range = document.createRange();
    range.setStart(textNode!, 6);
    range.setEnd(textNode!, 10);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
    const toolbarAction = page.querySelector<HTMLButtonElement>("[data-wiki-selection-comment]");
    expect(toolbar?.hidden).toBe(false);

    window.location.hash = "#/wiki/wiki%2Fconcepts%2Fsecond.md";
    page.dataset.wikiCurrentPath = "wiki/concepts/second.md";
    const searchInput = page.querySelector<HTMLInputElement>("[data-wiki-search-input]");
    searchInput!.value = "";
    page.querySelector<HTMLFormElement>("[data-wiki-search]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Fresh document");

    expect(toolbar?.hidden).toBe(true);

    toolbarAction?.click();
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-comments-status]")!, "先选中文本，再点击浮动“评论”。");

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([call, options]) =>
      String(call) === "/api/wiki-comments" && options?.method === "POST",
    )).toBe(false);
  });

  it("clears preserved selection when search results replace the article", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              kind: "dir",
              children: [{ name: "index.md", path: "wiki/index.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/index.md",
          title: "Index",
          html: "<h1>Index</h1><p id=\"search-target\">Alpha Beta Gamma</p>",
          raw: "# Index",
          frontmatter: null,
          modifiedAt: "2026-04-21T00:00:00.000Z",
        });
      }
      if (url.startsWith("/api/wiki-comments?path=")) {
        return ok([]);
      }
      if (url.includes("/api/search?")) {
        return ok({
          local: {
            results: [
              {
                path: "wiki/concepts/ai.md",
                title: "AI",
                excerpt: "人工智能相关页面",
                tags: ["AI"],
                modifiedAt: "2026-04-21T00:00:00.000Z",
              },
            ],
          },
        });
      }
      if (url === "/api/wiki-comments" && init?.method === "POST") {
        return ok({
          id: "comment-1",
          path: "wiki/index.md",
          quote: "stale",
          text: "",
          start: 0,
          end: 5,
          resolved: false,
          createdAt: "2026-04-24T00:05:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");

    const textNode = page.querySelector("#search-target")?.lastChild;
    const range = document.createRange();
    range.setStart(textNode!, 6);
    range.setEnd(textNode!, 10);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]");
    const toolbarAction = page.querySelector<HTMLButtonElement>("[data-wiki-selection-comment]");
    expect(toolbar?.hidden).toBe(false);

    const input = page.querySelector<HTMLInputElement>("[data-wiki-search-input]");
    input!.value = "人工智能";
    page.querySelector<HTMLFormElement>("[data-wiki-search]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "人工智能相关页面");

    expect(toolbar?.hidden).toBe(true);

    toolbarAction?.click();
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-comments-status]")!, "当前页面不支持评论。");

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([call, options]) =>
      String(call) === "/api/wiki-comments" && options?.method === "POST",
    )).toBe(false);
  });

  it("scrolls to a requested chat message anchor after loading the article", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              kind: "dir",
              children: [
                { name: "test-chat.md", path: "wiki/聊天记录/test-chat.md", kind: "file" },
              ],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/聊天记录/test-chat.md",
          title: "Test Chat",
          html: "<h1>Test Chat</h1><ul><li id=\"msg-2026-04-02-00-44\"><code>2026-04-02 00:44</code> <strong>oiii</strong>：我看完了</li></ul>",
          raw: "# Test Chat",
          frontmatter: null,
          modifiedAt: "2026-04-21T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/聊天记录/test-chat.md", "msg-2026-04-02-00-44");
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "我看完了");
    await waitForCondition(() => scrollIntoView.mock.calls.length > 0);

    expect(page.querySelector("#msg-2026-04-02-00-44")).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalled();
    (page as HTMLElement & { __dispose?: () => void }).__dispose?.();
  });

  it("renders the article before the wiki tree finishes loading", async () => {
    const deferredTree = createDeferred<ReturnType<typeof rawOk>>();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return deferredTree.promise;
      }
      if (url.includes("/api/page?path=wiki%2Fconcepts%2Findex.md")) {
        return rawOk({
          path: "wiki/concepts/index.md",
          title: "Index",
          html: "<h1>Index</h1><p>Visible before tree resolves</p>",
          raw: "# Index\n\nVisible before tree resolves",
          frontmatter: null,
          modifiedAt: "2026-04-21T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Visible before tree resolves");

    expect(page.textContent).toContain("Visible before tree resolves");
    expect(page.querySelector("[data-wiki-recent]")?.textContent).not.toContain("Second");

    deferredTree.resolve(rawOk({
      name: "wiki",
      path: "wiki",
      kind: "dir",
      children: [
        {
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            { name: "index.md", path: "wiki/index.md", kind: "file", modifiedAt: "2026-04-21T00:00:00.000Z" },
            { name: "second.md", path: "wiki/concepts/second.md", kind: "file", modifiedAt: "2026-04-22T00:00:00.000Z" },
          ],
        },
      ],
    }));
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-recent]")!, "Second");
  });
});

describe("wiki about-me profile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installWikiStyles();
  });

  it("links the wiki home sidebar brand to the about-me profile", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({})));

    const page = renderWikiPage("wiki/index.md");

    const brandLink = page.querySelector<HTMLAnchorElement>(".wiki-home-cover__brand");
    expect(brandLink).toBeTruthy();
    expect(brandLink?.getAttribute("href")).toBe("#/wiki/wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md");
  });

  it("places Graphy between recent updates and about on the wiki home cover", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({})));

    const page = renderWikiPage("wiki/index.md");
    const headings = Array.from(page.querySelectorAll(".wiki-home-cover__grid > section h2"))
      .map((heading) => heading.textContent?.trim());

    expect(headings).toEqual(["精选条目", "最近更新", "Graphy", "按分类浏览", "关于"]);
    expect(page.querySelector<HTMLAnchorElement>(".wiki-home-cover__panel-title-link")?.getAttribute("href"))
      .toBe("#/graph");
    expect(page.querySelector("[data-wiki-home-graph]")?.textContent).toContain("Graphy");
  });

  it("renders wiki/个人信息档案/about-me.md with the dedicated profile layout instead of the normal article layout", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md")) {
        return rawOk({
          path: "wiki/个人信息档案/about-me.md",
          title: "小松 Xiaosong",
          html: "<h1>小松 Xiaosong</h1>",
          raw: [
            "# 小松 Xiaosong",
            "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
            "> 用时间线记录成长，用成果库展示能力。",
            "",
            "## 首页",
            "### 标签",
            "- 学习成长",
            "- 项目实践",
            "",
            "### 统计卡片",
            "- 知识笔记: 320+",
            "",
            "## 时间线",
            "### 2023",
            "构建个人知识系统",
            "搭建第二大脑，沉淀方法与思考",
            "",
            "## 简历",
            "### 联系方式",
            "- Email: xiaosong@example.com",
          ].join("\n"),
          frontmatter: null,
          modifiedAt: "2026-04-26T08:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/about-me.md");
    document.body.appendChild(page);

    await waitForText(page, "小松 Xiaosong");

    expect(page.querySelector("[data-about-me-profile]")).toBeTruthy();
    expect(page.querySelector("[data-about-me-tab='首页']")).toBeTruthy();
    expect(page.querySelector("[data-about-me-tab='简历']")).toBeTruthy();
    expect(page.querySelector("[data-wiki-article]")).toBeNull();
  });

  // fallow-ignore-next-line complexity
  it("renders the identity archive as a one-screen information center", async () => {
    interface SavedIdentityWidget {
      title?: string;
      type?: string;
      layout?: { x?: number; y?: number; w: number; h: number };
      data?: Record<string, unknown>;
    }
    let savedDashboard: { config?: { widgets?: SavedIdentityWidget[] } } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/wiki/identity-dashboard") && init?.method === "PUT") {
        savedDashboard = JSON.parse(String(init.body ?? "{}")) as typeof savedDashboard;
        return ok({ config: savedDashboard?.config });
      }
      if (url.includes("/api/wiki/identity-dashboard")) {
        return ok({ config: null });
      }
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2F%E4%B8%AA%E4%BA%BA%E8%BA%AB%E4%BB%BD%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88.md")) {
        return rawOk({
          path: "wiki/个人信息档案/个人身份信息档案.md",
          title: "个人身份信息档案",
          html: "<h1>个人身份信息档案</h1>",
          frontmatter: { avatar_image: "wiki/.page-media/个人信息档案/identity-avatar.jpg" },
          raw: [
            "# 个人身份信息档案",
            "这个页面是个人身份信息的主事实源。",
            "",
            "## 基本信息",
            "- 中文名: 林远",
            "- 当前身份: 计算机专业学生",
            "- 所在城市: 杭州",
            "",
            "## 教育信息",
            "- 学校: 第二大脑大学",
            "- 专业: 计算机科学",
            "- 学历阶段: 大三",
            "",
            "## 联系方式",
            "- Email: test@example.com",
            "",
            "## 公开身份",
            "- 作品集入口: https://example.com",
            "",
            "## 长期标签",
            "- 第二大脑",
            "- AI自动化",
            "",
            "## 身份时间线",
            "| 时间 | 事实 |",
            "|------|------|",
            "| 2025-05-12 | 参与讨论毕业设计方向 |",
            "| 2025-05-19 | 完成数据结构课程设计 |",
            "",
            "## 维护规则",
            "- 身份事实以本页为准。",
          ].join("\n"),
          modifiedAt: "2026-04-28T12:00:00.000Z",
        });
      }
      if (url.includes("/api/page?path=wiki%2Fcrm%2F%E4%BA%BA%E9%99%85%E5%85%B3%E7%B3%BB%E6%80%BB%E8%A7%88.md")) {
        return rawOk({
          path: "wiki/crm/人际关系总览.md",
          title: "人际关系总览",
          html: "<h1>人际关系总览</h1>",
          raw: [
            "# 人际关系总览",
            "```mermaid",
            "graph LR",
            "Me[我]",
            "Me -- 女朋友 --> ZYX[赵宇馨]",
            "Me -- 父亲 --> Father[父亲]",
            "```",
          ].join("\n"),
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/个人身份信息档案.md");
    document.body.appendChild(page);

    await waitForText(page, "计算机专业学生");
    await waitForText(page, "关系网络图谱");

    expect(page.className).toBe("identity-info-page");
    expect(page.textContent).toContain("计算机专业学生");
    expect(page.textContent).toContain("完成数据结构课程设计");
    expect(page.querySelector(".identity-info-page__timeline-list")?.textContent?.indexOf("完成数据结构课程设计"))
      .toBeLessThan(page.querySelector(".identity-info-page__timeline-list")?.textContent?.indexOf("参与讨论毕业设计方向") ?? 0);
    expect(page.querySelector("[data-identity-relation-graph] .wiki-relation-graph")).toBeTruthy();
    expect(page.querySelector("[data-edge-from='Me'][data-edge-to='ZYX']")?.textContent).toContain("女朋友");
    expect(page.querySelector<HTMLImageElement>(".identity-info-page__avatar img")?.getAttribute("src"))
      .toBe("/api/page-side-image?path=wiki%2F.page-media%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fidentity-avatar.jpg");
    page.querySelector<HTMLButtonElement>("[data-identity-avatar-open]")?.click();
    expect(page.querySelector<HTMLElement>("[data-identity-avatar-modal]")?.hidden).toBe(false);
    expect(page.querySelector<HTMLImageElement>("[data-identity-avatar-preview]")?.getAttribute("src"))
      .toBe("/api/page-side-image?path=wiki%2F.page-media%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fidentity-avatar.jpg");
    expect(page.querySelector("[data-identity-avatar-close]")?.textContent).toBe("关闭");
    expect(page.querySelector("[data-identity-avatar-change]")?.textContent).toBe("更换图片");
    page.querySelector<HTMLButtonElement>("[data-identity-avatar-close]")?.click();
    expect(page.querySelector<HTMLElement>("[data-identity-avatar-modal]")?.hidden).toBe(true);
    expect(page.textContent).toContain("梦境");
    expect(page.textContent).not.toContain("梦想档案库");
    expect(page.textContent).not.toContain("个人画像摘要");
    expect(page.querySelector(".identity-info-page__nav")?.textContent).not.toContain("个人画像");
    expect(page.querySelector(".identity-info-page__nav")?.textContent).not.toContain("人际关系图谱");
    expect(page.querySelector<HTMLAnchorElement>(".identity-info-page__relations h2 a")?.getAttribute("href"))
      .toBe("#/wiki/wiki%2Fcrm%2F%E4%BA%BA%E9%99%85%E5%85%B3%E7%B3%BB%E6%80%BB%E8%A7%88.md");
    expect(page.textContent).not.toContain("个人信息中心");
    expect(page.textContent).not.toContain("铃");
    expect(page.textContent).not.toContain("光");
    const healthLink = page.querySelector<HTMLAnchorElement>(".identity-info-page__widget--health .identity-info-page__panel-link");
    expect(healthLink?.getAttribute("href")).toBe("#/workspace/task-pool/domain/health");
    expect(page.querySelector(".identity-info-page__hero-copy h2")).toBeNull();
    expect(page.querySelector("[data-about-me-profile]")).toBeNull();
    expect(page.querySelector("[data-wiki-article]")).toBeNull();

    page.querySelector<HTMLButtonElement>("[data-identity-dashboard-edit]")?.click();
    await waitForText(page, "组件库");
    expect(page.querySelector("[data-identity-dashboard-editor]")).toBeTruthy();
    expect(page.querySelector("[data-identity-add-widget='text']")).toBeTruthy();

    const titleInput = page.querySelector<HTMLInputElement>("[data-identity-widget-title]");
    expect(titleInput).toBeTruthy();
    titleInput!.value = "基础信息组件";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    const heroBefore = page.querySelector<HTMLElement>("[data-identity-widget-type='hero']");
    const timelineBefore = page.querySelector<HTMLElement>("[data-identity-widget-type='timeline']");
    const heroStyleBefore = heroBefore?.getAttribute("style");
    const timelineStyleBefore = timelineBefore?.getAttribute("style");
    const timelineField = page.querySelector<HTMLElement>("[data-identity-widget-type='timeline'] [data-identity-field='items.0.fact']");
    expect(timelineField).toBeTruthy();
    timelineField!.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    timelineField!.textContent = "修改后的时间线事实";
    timelineField!.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    const timelineResize = page.querySelector<HTMLButtonElement>("[data-identity-widget-type='timeline'] [data-identity-widget-resize]");
    expect(timelineResize).toBeTruthy();
    timelineResize!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 260, clientY: 180 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const heroStyleAfter = page.querySelector<HTMLElement>("[data-identity-widget-type='hero']")?.getAttribute("style");
    const timelineStyleAfter = page.querySelector<HTMLElement>("[data-identity-widget-type='timeline']")?.getAttribute("style");
    expect(heroStyleAfter).toBe(heroStyleBefore);
    expect(timelineStyleAfter).not.toBe(timelineStyleBefore);
    const navField = page.querySelector<HTMLElement>("[data-identity-widget-type='nav'] [data-identity-field='items.0.0']");
    expect(navField).toBeTruthy();
    navField!.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    navField!.textContent = "可编辑导航卡片";
    navField!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    stubDashboardRect(page.querySelector<HTMLElement>("[data-identity-dashboard-canvas]")!, 0, 0, 1200, 800);
    stubDashboardRect(page.querySelector<HTMLElement>("[data-identity-widget-type='hero']")!, 0, 0, 400, 200);
    dispatchDashboardDrag(page.querySelector<HTMLElement>("[data-identity-widget-type='hero']")!, "dragstart", {
      clientX: 200,
      clientY: 100,
      dataTransferPath: page.querySelector<HTMLElement>("[data-identity-widget-type='hero']")!.dataset.identityWidget,
    });
    dispatchDashboardDrag(page.querySelector<HTMLElement>("[data-identity-dashboard-canvas]")!, "drop", {
      clientX: 800,
      clientY: 300,
      dataTransferPath: page.querySelector<HTMLElement>("[data-identity-widget-type='hero']")!.dataset.identityWidget,
    });
    page.querySelector<HTMLButtonElement>("[data-identity-dashboard-save]")?.click();
    await waitForCondition(() => Boolean(savedDashboard));
    expect(savedDashboard?.config?.widgets?.[0]?.title).toBe("基础信息组件");
    const savedTimeline = savedDashboard?.config?.widgets?.find((widget) => widget.type === "timeline");
    const savedHero = savedDashboard?.config?.widgets?.find((widget) => widget.type === "hero");
    const savedNav = savedDashboard?.config?.widgets?.find((widget) => widget.type === "nav");
    expect(readFirstTimelineFact(savedTimeline?.data)).toBe("修改后的时间线事实");
    expect(readFirstNavTitle(savedNav?.data)).toBe("可编辑导航卡片");
    expect(savedTimeline?.layout).not.toEqual({ w: 3, h: 7 });
    expect(savedHero?.layout).toMatchObject({ x: 6, y: 2, w: 4, h: 2 });
  });

  it("switches profile panels in place without changing the wiki route", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md")) {
        return rawOk({
          path: "wiki/个人信息档案/about-me.md",
          title: "小松 Xiaosong",
          html: "<h1>小松 Xiaosong</h1>",
          raw: [
            "# 小松 Xiaosong",
            "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
            "> 用时间线记录成长，用成果库展示能力。",
            "",
            "## 首页",
            "### 总结",
            "首页文案",
            "",
            "## 时间线",
            "### 2023",
            "构建个人知识系统",
            "搭建第二大脑，沉淀方法与思考",
          ].join("\n"),
          frontmatter: null,
          modifiedAt: "2026-04-26T08:00:00.000Z",
        });
      }
      return ok({});
    }));

    window.location.hash = "#/wiki/wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md";
    const page = renderWikiPage("wiki/个人信息档案/about-me.md");
    document.body.appendChild(page);

    await waitForText(page, "首页文案");
    page.querySelector<HTMLButtonElement>("[data-about-me-tab='时间线']")?.click();

    expect(page.querySelector("[data-about-me-panel='首页']")?.hasAttribute("hidden")).toBe(true);
    expect(page.querySelector("[data-about-me-panel='时间线']")?.hasAttribute("hidden")).toBe(false);
    expect(page.textContent).toContain("构建个人知识系统");
    expect(window.location.hash).toBe("#/wiki/wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md");
  });

  it("renders the parsed stat, timeline, and resume content from about-me markdown", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md")) {
        return rawOk({
          path: "wiki/个人信息档案/about-me.md",
          title: "小松 Xiaosong",
          html: "<h1>小松 Xiaosong</h1>",
          raw: [
            "# 小松 Xiaosong",
            "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
            "> 用时间线记录成长，用成果库展示能力。",
            "",
            "## 首页",
            "### 统计卡片",
            "- 知识笔记: 320+",
            "",
            "## 时间线",
            "### 2023",
            "构建个人知识系统",
            "搭建第二大脑，沉淀方法与思考",
            "",
            "## 简历",
            "### 联系方式",
            "- Email: xiaosong@example.com",
          ].join("\n"),
          frontmatter: null,
          modifiedAt: "2026-04-26T08:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/about-me.md");
    document.body.appendChild(page);

    await waitForText(page, "320+");

    expect(page.querySelector("[data-about-me-stat='知识笔记']")?.textContent).toContain("320+");
    expect(page.querySelector("[data-about-me-resume-contact]")?.textContent).toContain("xiaosong@example.com");
    expect(page.querySelector("[data-about-me-timeline]")?.textContent).toContain("构建个人知识系统");
  });

  it("renders the dedicated hero, achievement board, switchable side card, and strengths row", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md")) {
        return rawOk({
          path: "wiki/个人信息档案/about-me.md",
          title: "小松 Xiaosong",
          html: "<h1>小松 Xiaosong</h1>",
          raw: [
            "# 小松 Xiaosong",
            "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
            "> 用时间线记录成长，用成果库展示能力。",
            "",
            "## 首页",
            "### 代表能力",
            "- 结构化表达",
            "- 项目推进",
            "",
            "## 成果库",
            "### 项目作品",
            "#### 飞书记录系统",
            "协同记录与自动化",
            "",
            "## 时间线",
            "### 2023",
            "构建个人知识系统",
            "搭建第二大脑，沉淀方法与思考",
            "",
            "## 简历",
            "### 身份",
            "- 学生 / 个人知识库搭建者",
          ].join("\n"),
          frontmatter: null,
          modifiedAt: "2026-04-26T08:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/about-me.md");
    document.body.appendChild(page);

    await waitForText(page, "飞书记录系统");

    expect(page.querySelector("[data-about-me-hero]")).toBeTruthy();
    expect(page.querySelector("[data-about-me-stats-card]")).toBeTruthy();
    expect(page.querySelector("[data-about-me-achievement-board]")).toBeTruthy();
    expect(page.querySelector("[data-about-me-home-side-card='时间线']")).toBeTruthy();
    expect(page.querySelector("[data-about-me-home-panel-switch='时间线']")?.getAttribute("aria-pressed")).toBe("true");
    expect(page.querySelector("[data-about-me-home-panel-switch='简历']")?.getAttribute("aria-pressed")).toBe("false");
    expect(page.querySelector("[data-about-me-strength-grid]")).toBeTruthy();
  });

  it("switches the home side card between timeline and resume", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md")) {
        return rawOk({
          path: "wiki/个人信息档案/about-me.md",
          title: "小松 Xiaosong",
          html: "<h1>小松 Xiaosong</h1>",
          raw: [
            "# 小松 Xiaosong",
            "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
            "> 用时间线记录成长，用成果库展示能力。",
            "",
            "## 首页",
            "### 代表能力",
            "- 结构化表达",
            "",
            "## 时间线",
            "### 2023",
            "构建个人知识系统",
            "搭建第二大脑，沉淀方法与思考",
            "",
            "## 简历",
            "### 联系方式",
            "- Email: xiaosong@example.com",
          ].join("\n"),
          frontmatter: null,
          modifiedAt: "2026-04-26T08:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/about-me.md");
    document.body.appendChild(page);

    await waitForText(page, "构建个人知识系统");

    page.querySelector<HTMLButtonElement>("[data-about-me-home-panel-switch='简历']")?.click();

    expect(page.querySelector("[data-about-me-home-side-card='简历']")).toBeTruthy();
    expect(page.querySelector("[data-about-me-home-resume]")?.textContent).toContain("xiaosong@example.com");
    expect(page.querySelector("[data-about-me-home-panel-switch='简历']")?.getAttribute("aria-pressed")).toBe("true");
    expect(page.querySelector("[data-about-me-home-panel-switch='时间线']")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches the about-me profile into markdown edit mode and saves the updated raw document", async () => {
    let currentRaw = [
      "# 小松 Xiaosong",
      "> 学生 / 个人知识库搭建者 / 自动化系统爱好者",
      "> 用时间线记录成长，用成果库展示能力。",
      "",
      "## 首页",
      "![头像](https://example.com/old-avatar.png)",
      "### 标签",
      "- 学习成长",
      "",
      "## 简历",
      "### 联系方式",
      "- Email: xiaosong@example.com",
    ].join("\n");
    let saveCount = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2Fabout-me.md")) {
        return rawOk({
          path: "wiki/个人信息档案/about-me.md",
          title: "小松 Xiaosong",
          html: "<h1>小松 Xiaosong</h1>",
          raw: currentRaw,
          sourceEditable: true,
          frontmatter: null,
          modifiedAt: "2026-04-26T08:00:00.000Z",
        });
      }
      if (url === "/api/page" && init?.method === "PUT") {
        saveCount += 1;
        const body = JSON.parse(String(init.body ?? "{}")) as { raw: string };
        currentRaw = body.raw;
        return ok({
          path: "wiki/个人信息档案/about-me.md",
          modifiedAt: "2026-04-26T08:05:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/about-me.md");
    document.body.appendChild(page);

    await waitForText(page, "小松 Xiaosong");

    page.querySelector<HTMLButtonElement>("[data-about-me-edit]")?.click();

    const editor = page.querySelector<HTMLTextAreaElement>("[data-about-me-editor]");
    expect(editor).toBeTruthy();
    expect(editor?.value).toContain("old-avatar");

    editor!.value = currentRaw
      .replace("小松 Xiaosong", "Farza")
      .replace("https://example.com/old-avatar.png", "https://example.com/new-avatar.png");
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-about-me-save]")?.click();

    await waitForCondition(() => page.querySelector("[data-about-me-editor-shell]") === null);

    const avatar = page.querySelector<HTMLImageElement>(".about-me-profile__avatar img");
    expect(page.textContent).toContain("Farza");
    expect(avatar?.getAttribute("src")).toBe("https://example.com/new-avatar.png");
    expect(page.querySelector("[data-about-me-editor-shell]")).toBeNull();
    expect(saveCount).toBe(1);
  });

  it("keeps ordinary wiki pages on the existing article layout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              kind: "dir",
              children: [{ name: "index.md", path: "wiki/index.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/index.md",
          title: "Index",
          html: "<h1>Index</h1><p>Overview</p>",
          raw: "# Index\n\nOverview",
          frontmatter: null,
          modifiedAt: "2026-04-21T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/concepts/index.md");
    document.body.appendChild(page);

    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    expect(page.querySelector("[data-about-me-profile]")).toBeNull();
    expect(page.querySelector("[data-wiki-article]")).toBeTruthy();
  });

  it("uses the featured wiki page side image on the home cover", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return rawOk({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              kind: "dir",
              children: [
                { name: "index.md", path: "wiki/index.md", kind: "file", modifiedAt: "2026-04-20T00:00:00.000Z" },
                { name: "memory.md", path: "wiki/memory.md", kind: "file", modifiedAt: "2026-04-28T00:00:00.000Z" },
              ],
            },
          ],
        });
      }
      if (url.includes("path=wiki%2Fmemory.md")) {
        return rawOk({
          path: "wiki/memory.md",
          title: "Memory",
          html: "<h1>Memory</h1><p>Memory summary</p>",
          raw: "# Memory\n\nMemory summary",
          frontmatter: { side_image: "wiki/.page-media/memory-cover.png" },
          modifiedAt: "2026-04-28T00:00:00.000Z",
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/index.md",
          title: "Index",
          html: "<h1>Index</h1><p>Home</p>",
          raw: "# Index\n\nHome",
          frontmatter: null,
          modifiedAt: "2026-04-20T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/index.md");
    document.body.appendChild(page);

    await waitForCondition(() => page.querySelector(".wiki-home-cover__featured-media img") !== null);

    const image = page.querySelector<HTMLImageElement>(".wiki-home-cover__featured-media img");
    expect(image?.getAttribute("src")).toBe("/api/page-side-image?path=wiki%2F.page-media%2Fmemory-cover.png");
    expect(page.querySelector(".wiki-home-cover__featured-fallback")).toBeNull();
  });

  it("renders the CRM relationship mermaid block as a colored graph", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("path=wiki%2Fcrm%2F%E8%B5%B5%E5%AE%87%E9%A6%A8.md")) {
        return rawOk({
          path: "wiki/crm/赵宇馨.md",
          title: "赵宇馨",
          html: "<h1>赵宇馨</h1>",
          frontmatter: { side_image: "wiki/.page-media/crm/赵宇馨-side.jpg" },
        });
      }
      if (url.includes("path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E5%92%8C%E4%BA%8B%E5%AE%9E.md")) {
        return rawOk({
          path: "wiki/个人信息档案/个人信息和事实.md",
          title: "个人信息和事实",
          html: "<h1>个人信息和事实</h1>",
          frontmatter: { side_image: "wiki/.page-media/个人信息档案/个人信息和事实-side.jpg" },
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/crm/人际关系总览.md",
          title: "人际关系总览",
          html: [
            "<h1>人际关系总览</h1>",
            "<h2>关系网络图</h2>",
            "<pre><code class=\"language-mermaid\">graph LR\nMe[我]\nMe -- 女朋友 --> ZYX[赵宇馨]\nMe -- 父亲 --> Father[父亲]\nMe -- 项目队友 --> PartnerA[项目队友 A]\nMe -- 大学同学 --> Example[陈雨]\nZYX -- 闺蜜 --> Example\nPartnerA -- 项目合作 --> Me</code></pre>",
          ].join(""),
          raw: "# 人际关系总览",
          frontmatter: null,
          modifiedAt: "2026-04-28T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/crm/人际关系总览.md");
    document.body.appendChild(page);

    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "关系网络图谱");

    const graph = page.querySelector<HTMLElement>(".wiki-relation-graph");
    const svg = graph?.querySelector<SVGSVGElement>(".wiki-relation-graph__svg");
    expect(graph).toBeTruthy();
    expect(graph?.textContent).toContain("赵宇馨");
    expect(graph?.textContent).toContain("父亲");
    expect(graph?.textContent).toContain("项目队友 A");
    expect(graph?.textContent).toContain("陈雨");
    expect(graph?.querySelector("[data-relation-type='intimate']")).toBeTruthy();
    expect(graph?.querySelector("[data-relation-type='family']")).toBeTruthy();
    expect(graph?.querySelector("[data-relation-type='collaboration']")).toBeTruthy();
    expect(page.querySelector("pre code.language-mermaid")).toBeNull();

    const meNode = graph?.querySelector<SVGGElement>("[data-relation-node-id='Me']");
    const meLabel = graph?.querySelector<SVGGElement>("[data-relation-label-id='Me']");
    const girlfriendEdge = graph?.querySelector<SVGGElement>("[data-edge-from='Me'][data-edge-to='ZYX']");
    expect(girlfriendEdge?.classList.contains("is-relation-visible")).toBe(true);
    expect(meNode?.classList.contains("is-selected")).toBe(true);
    expect(meLabel?.classList.contains("is-selected")).toBe(true);
    expect(girlfriendEdge?.textContent).toContain("女朋友");

    const zyxLabel = graph?.querySelector<SVGGElement>("[data-relation-label-id='ZYX']");
    const friendEdge = graph?.querySelector<SVGGElement>("[data-edge-from='ZYX'][data-edge-to='Example']");
    zyxLabel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(zyxLabel?.classList.contains("is-selected")).toBe(true);
    expect(friendEdge?.classList.contains("is-relation-visible")).toBe(true);
    expect(friendEdge?.textContent).toContain("闺蜜");

    await waitForCondition(() => (
      graph?.querySelector<SVGImageElement>("[data-relation-node-image='赵宇馨']")?.classList.contains("is-loaded") === true
    ));
    await waitForCondition(() => (
      graph?.querySelector<SVGImageElement>("[data-relation-node-image='我']")?.classList.contains("is-loaded") === true
    ));

    const image = graph?.querySelector<SVGImageElement>("[data-relation-node-image='赵宇馨']");
    const meImage = graph?.querySelector<SVGImageElement>("[data-relation-node-image='我']");
    expect(image?.getAttribute("href")).toBe("/api/page-side-image?path=wiki%2F.page-media%2Fcrm%2F%E8%B5%B5%E5%AE%87%E9%A6%A8-side.jpg");
    expect(meImage?.getAttribute("href")).toBe("/api/page-side-image?path=wiki%2F.page-media%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%E6%A1%88%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E5%92%8C%E4%BA%8B%E5%AE%9E-side.jpg");

    svg!.getBoundingClientRect = () => createDomRect({ left: 0, top: 0, width: 540, height: 320 });
    svg!.dispatchEvent(new WheelEvent("wheel", { clientX: 270, clientY: 160, deltaY: -100, bubbles: true, cancelable: true }));
    expect(svg?.getAttribute("viewBox")).not.toBe("0 0 1080 640");

    const zoomedViewBox = svg!.getAttribute("viewBox");
    svg!.dispatchEvent(new MouseEvent("mousedown", { clientX: 270, clientY: 160, button: 0, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 220, clientY: 120, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(svg?.getAttribute("viewBox")).not.toBe(zoomedViewBox);
    expect(svg?.classList.contains("is-dragging")).toBe(false);
  });

  // fallow-ignore-next-line complexity
  it("renders the personal timeline with date and theme filters after record principles", async () => {
    const sourceRefresh = createDeferred<unknown>();
    // fallow-ignore-next-line complexity
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/wiki/personal-timeline/source-refresh")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { label?: string; entries?: string[] };
        expect(body.entries).toContain("wiki/个人信息档案/历史回忆.md");
        await sourceRefresh.promise;
        return ok({ status: "written", message: "已记录新增内容，等待写入时间线事实", changedFiles: 1 });
      }
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("/api/page?path=wiki%2F%E4%B8%AA%E4%BA%BA%E4%BF%A1%E6%81%AF%E6%A1%A3%2F%E5%8E%86%E5%8F%B2%E5%9B%9E%E5%BF%86.md")) {
        return rawOk({
          path: "wiki/个人信息档案/历史回忆.md",
          title: "历史回忆",
          html: "<h1>历史回忆</h1>",
          raw: "# 历史回忆\n\n<!-- timeline-manual-entries -->\n",
          frontmatter: null,
          sourceEditable: true,
          modifiedAt: "2026-04-29T00:00:00.000Z",
        });
      }
      if (url === "/api/page" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}")) as { path?: string; raw?: string };
        expect(body.path).toBe("wiki/个人信息档案/历史回忆.md");
        expect(body.raw).toContain("补录一条过去的重要事实");
        return ok({ path: body.path, modifiedAt: "2026-04-29T00:00:00.000Z" });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/个人信息档案/个人时间线.md",
          title: "个人时间线",
          html: [
            "<h1>个人时间线</h1>",
            "<p>本页用于从我的日记和日常记录中沉淀时间线事实。</p>",
            "<h2><a href=\"#record\">§</a> 记录原则</h2>",
            "<ol><li>按时间倒序记录。</li></ol>",
            "<h2><a href=\"#overview\">§</a> 总览</h2>",
            "<table><tbody><tr><td>本月</td><td>阶段事实</td><td>学习</td><td>[[日记]]</td></tr></tbody></table>",
            "<h2><a href=\"#day\">§</a> 按日</h2>",
            "<p>用于记录具体某一天发生的事实。</p>",
            "<table><tbody><tr><td>2026-04-29</td><td>写入个人时间线</td><td>学习</td><td>完成</td><td>[[日记]]</td></tr></tbody></table>",
            "<h2><a href=\"#month\">§</a> 按月</h2>",
            "<table><tbody><tr><td>2026-04</td><td>整理个人档案</td><td>项目</td><td>形成入口</td><td>[[聊天记录]]</td></tr></tbody></table>",
            "<h2><a href=\"#domain\">§</a> 按领域</h2>",
            "<h3>学习</h3>",
            "<table><tbody><tr><td>2026-04-29</td><td>补充时间线视图</td><td>页面结构</td><td>[[日记]]</td></tr></tbody></table>",
            "<h3>运动</h3>",
            "<table><tbody><tr><td>2026-04-28</td><td>完成跑步记录</td><td>健康</td><td>[[运动记录]]</td></tr></tbody></table>",
            "<h2>待确认时间线事实</h2>",
            "<p>待确认</p>",
          ].join(""),
          raw: "# 个人时间线",
          frontmatter: null,
          modifiedAt: "2026-04-29T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/个人时间线.md");
    document.body.appendChild(page);

    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "时间粒度");

    const article = page.querySelector<HTMLElement>("[data-wiki-article]")!;
    const monthButton = article.querySelector<HTMLButtonElement>("[data-personal-timeline-grain='month']");
    const learningButton = article.querySelector<HTMLButtonElement>("[data-personal-timeline-theme='学习']");
    const diarySourceButton = article.querySelector<HTMLButtonElement>("[data-personal-timeline-source='日记']");
    const memorySourceButton = article.querySelector<HTMLButtonElement>("[data-personal-timeline-source='历史回忆']");
    const chatSourceButton = article.querySelector<HTMLButtonElement>("[data-personal-timeline-source='聊天记录']");
    const sourceRefreshButton = article.querySelector<HTMLButtonElement>("[data-personal-timeline-source-refresh]");
    const runningFact = article.querySelector<HTMLElement>("[data-personal-timeline-fact-theme='运动']");
    const dayFact = article.querySelector<HTMLElement>("[data-personal-timeline-fact-grain='day']");
    const monthFact = article.querySelector<HTMLElement>("[data-personal-timeline-fact-grain='month']");
    const timeline = article.querySelector<HTMLElement>(".personal-timeline__rail-list");
    const dashboard = article.querySelector<HTMLElement>(".personal-timeline");
    const overviewHeading = Array.from(article.querySelectorAll("h2"))
      .find((heading) => heading.textContent?.includes("总览"));

    expect(monthButton).toBeTruthy();
    expect(learningButton).toBeTruthy();
    expect(diarySourceButton).toBeTruthy();
    expect(memorySourceButton).toBeTruthy();
    expect(chatSourceButton).toBeTruthy();
    expect(sourceRefreshButton).toBeTruthy();
    expect(article.querySelector("[data-personal-timeline-search]")).toBeTruthy();
    expect(article.querySelector("[data-personal-timeline-source='外部记录']")).toBeNull();
    expect(article.querySelector("[data-personal-timeline-source='待确认来源']")).toBeNull();
    expect(article.querySelector("[data-personal-timeline-source='手动补录']")).toBeNull();
    expect(diarySourceButton?.classList.contains("has-entry")).toBe(true);
    expect(diarySourceButton?.title).toContain("#/flash-diary");
    expect(memorySourceButton?.classList.contains("has-entry")).toBe(true);
    expect(memorySourceButton?.title).toContain("wiki/个人信息档案/历史回忆.md");
    expect(article.textContent).not.toContain("只看重要事件");
    expect(article.textContent).toContain("写入个人时间线");
    expect(article.textContent).toContain("补充时间线视图");
    expect(timeline?.textContent).toContain("2026-04-29");
    expect(dashboard?.compareDocumentPosition(overviewHeading!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    monthButton?.click();

    expect(monthButton?.classList.contains("is-active")).toBe(true);
    expect(monthFact?.hidden).toBe(false);
    expect(dayFact?.hidden).toBe(true);
    expect(runningFact?.hidden).toBe(true);

    monthButton?.click();
    learningButton?.click();

    expect(monthButton?.classList.contains("is-active")).toBe(false);
    expect(learningButton?.classList.contains("is-active")).toBe(true);
    expect(dayFact?.hidden).toBe(true);
    expect(runningFact?.hidden).toBe(true);
    expect(article.querySelector<HTMLElement>("[data-personal-timeline-fact-theme='学习']")?.hidden).toBe(false);

    learningButton?.click();
    memorySourceButton?.click();

    expect(memorySourceButton?.classList.contains("is-active")).toBe(true);
    expect(monthFact?.hidden).toBe(true);
    expect(dayFact?.hidden).toBe(true);

    sourceRefreshButton?.click();
    await flush();
    expect(article.querySelector<HTMLElement>("[data-personal-timeline-source-status]")?.textContent).toContain("正在写入");
    sourceRefresh.resolve({});
    await waitForText(article, "已记录新增内容");

    chatSourceButton?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = article.querySelector<HTMLElement>("[data-personal-timeline-source-editor]");
    const sourceScroll = article.querySelector<HTMLElement>(".personal-timeline__source-scroll");
    const input = editor?.querySelector<HTMLInputElement>("[data-personal-timeline-source-input]");
    expect(editor?.hidden).toBe(false);
    expect(editor?.classList.contains("personal-timeline__source-modal")).toBe(true);
    expect(sourceScroll?.querySelector("[data-personal-timeline-source-editor]")).toBeNull();
    expect(editor?.textContent).toContain("聊天记录入口");
    expect(editor?.textContent).toContain("没有");

    editor?.querySelector<HTMLButtonElement>("[data-personal-timeline-source-add]")?.click();
    expect(editor?.textContent).toContain("先输入或选择一个路径");
    editor?.querySelector<HTMLButtonElement>("[data-personal-timeline-source-pick]")?.click();
    await flush();
    expect(editor?.textContent).toContain("当前窗口没有桌面路径选择能力");

    window.llmWikiDesktop = {
      getDesktopConfig: vi.fn().mockResolvedValue({ targetVault: "D:\\Desktop\\ai的仓库" }),
      choosePersonalTimelineSourceEntry: vi.fn().mockResolvedValue("C:\\Users\\Administrator\\Desktop\\timeline"),
    } as typeof window.llmWikiDesktop;
    editor?.querySelector<HTMLButtonElement>("[data-personal-timeline-source-pick]")?.click();
    await flush();
    expect(input?.value).toBe("C:\\Users\\Administrator\\Desktop\\timeline");

    input!.value = "wiki/个人信息档案/历史回忆.md";
    editor?.querySelector<HTMLButtonElement>("[data-personal-timeline-source-add]")?.click();

    expect(chatSourceButton?.classList.contains("has-entry")).toBe(true);
    expect(chatSourceButton?.title).toContain("wiki/个人信息档案/历史回忆.md");
    editor?.querySelector<HTMLButtonElement>("[data-personal-timeline-source-remove='0']")?.click();
    expect(chatSourceButton?.classList.contains("has-no-entry")).toBe(true);
    expect(chatSourceButton?.title).toBe("没有");

    memorySourceButton?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(editor?.hidden).toBe(false);
    expect(editor?.textContent).toContain("历史回忆");
    expect(editor?.querySelector("[data-personal-timeline-source-input]")).toBeNull();
    const manualInput = editor?.querySelector<HTMLTextAreaElement>("[data-personal-timeline-manual-input]");
    manualInput!.value = "补录一条过去的重要事实";
    editor?.querySelector<HTMLButtonElement>("[data-personal-timeline-manual-save]")?.click();
    await waitForText(article, "已追记到历史回忆");
  });

  it("refreshes the diary source by default when no timeline source is selected", async () => {
    let refreshBody: { label?: string; entries?: string[] } | null = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/wiki/personal-timeline/source-refresh")) {
        refreshBody = JSON.parse(String(init?.body ?? "{}")) as { label?: string; entries?: string[] };
        return ok({ status: "written", message: "已记录新增内容，等待写入时间线事实", changedFiles: 1 });
      }
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/个人信息档案/个人时间线.md",
          title: "个人时间线",
          html: [
            "<h1>个人时间线</h1>",
            "<h2><a href=\"#record\">§</a> 记录原则</h2>",
            "<p>按来源整理事实。</p>",
            "<h2><a href=\"#day\">§</a> 按日</h2>",
            "<table><tbody><tr><td>2026-04-29</td><td>让 ChatGPT 看手相</td><td>自我理解</td><td>[[日记]]</td></tr></tbody></table>",
          ].join(""),
          raw: "# 个人时间线",
          frontmatter: null,
          modifiedAt: "2026-04-29T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/个人时间线.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "时间粒度");

    const article = page.querySelector<HTMLElement>("[data-wiki-article]")!;
    article.querySelector<HTMLButtonElement>("[data-personal-timeline-source-refresh]")?.click();

    await waitForCondition(() => refreshBody !== null);
    expect(refreshBody).toEqual({ label: "日记", entries: ["#/flash-diary"] });
    expect(article.querySelector<HTMLButtonElement>("[data-personal-timeline-source='日记']")
      ?.classList.contains("is-active")).toBe(true);
    await waitForText(article, "已记录新增内容");
    const progress = article.querySelector<HTMLElement>("[data-personal-timeline-source-progress]");
    expect(progress).not.toBeNull();
    expect(progress?.getAttribute("aria-valuenow")).toBe("100");
    expect(article.textContent).not.toContain("先选择输入来源");
  });

  it("adds review actions to pending personal timeline facts", async () => {
    let pendingAction: { action?: string; sourceTarget?: string; note?: string } | null = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/wiki/personal-timeline/pending-fact")) {
        pendingAction = JSON.parse(String(init?.body ?? "{}")) as typeof pendingAction;
        return ok({ status: "written", message: "已写入补充说明" });
      }
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/个人信息档案/个人时间线.md",
          title: "个人时间线",
          html: [
            "<h1>个人时间线</h1>",
            "<h2><a href=\"#record\">§</a> 记录原则</h2>",
            "<p>按来源整理事实。</p>",
            "<h2><a href=\"#day\">§</a> 按日</h2>",
            "<table><tbody><tr><td>2026-04-29</td><td>写入个人时间线</td><td>学习</td><td>完成</td><td>[[日记]]</td></tr></tbody></table>",
            "<h2>待确认时间线事实</h2>",
            "<table><thead><tr><th>事件时间</th><th>记录时间</th><th>候选片段</th><th>领域</th><th>项目</th><th>来源</th></tr></thead>",
            "<tbody><tr><td>待确认</td><td>2026-04-29</td><td>待整理：完成了记录。</td><td>产品功能</td><td>个人App开发</td><td><a href=\"/?page=raw%2F%E9%97%AA%E5%BF%B5%E6%97%A5%E8%AE%B0%2F2026-04-29.md#13%3A00\" class=\"wikilink wikilink-alive\" data-wikilink-target=\"raw/闪念日记/2026-04-29.md#13:00\">raw/闪念日记/2026-04-29.md#13:00</a></td></tr></tbody></table>",
          ].join(""),
          raw: "# 个人时间线",
          frontmatter: null,
          modifiedAt: "2026-04-29T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/个人时间线.md");
    document.body.appendChild(page);
    const article = page.querySelector<HTMLElement>("[data-wiki-article]")!;
    await waitForText(article, "候选片段");

    expect(article.textContent).toContain("领域");
    expect(article.textContent).toContain("个人App开发");
    expect(article.textContent).not.toContain("影响");
    expect(article.textContent).not.toContain("验证保存功能可用");
    expect(article.textContent).not.toContain("需要确认什么");
    expect(article.textContent).not.toContain("状态");
    expect(article.querySelector<HTMLAnchorElement>("a[data-wikilink-target='raw/闪念日记/2026-04-29.md#13:00']")).toBeTruthy();
    expect(article.querySelector<HTMLButtonElement>("[data-pending-timeline-action='confirm']")).toBeTruthy();
    expect(article.querySelector<HTMLButtonElement>("[data-pending-timeline-action='delete']")).toBeTruthy();
    article.querySelector<HTMLButtonElement>("[data-pending-timeline-action='supplement']")?.click();

    const modal = article.querySelector<HTMLElement>("[data-pending-timeline-supplement-modal]");
    expect(modal?.hidden).toBe(false);
    modal!.querySelector<HTMLTextAreaElement>("[data-pending-timeline-supplement-input]")!.value = "请判断这是不是项目进展。";
    modal!.querySelector<HTMLButtonElement>("[data-pending-timeline-supplement-save]")?.click();

    await waitForCondition(() => pendingAction !== null);
    expect(pendingAction).toEqual({
      action: "supplement",
      sourceTarget: "raw/闪念日记/2026-04-29.md#13:00",
      note: "请判断这是不是项目进展。",
    });
  });

  it("clears the stale source prompt after choosing a timeline source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/个人信息档案/个人时间线.md",
          title: "个人时间线",
          html: [
            "<h1>个人时间线</h1>",
            "<h2><a href=\"#record\">§</a> 记录原则</h2>",
            "<p>按来源整理事实。</p>",
            "<h2><a href=\"#day\">§</a> 按日</h2>",
            "<table><tbody><tr><td>2026-04-29</td><td>让 ChatGPT 看手相</td><td>自我理解</td><td>[[日记]]</td></tr></tbody></table>",
          ].join(""),
          raw: "# 个人时间线",
          frontmatter: null,
          modifiedAt: "2026-04-29T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/个人信息档案/个人时间线.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "时间粒度");

    const article = page.querySelector<HTMLElement>("[data-wiki-article]")!;
    const status = article.querySelector<HTMLElement>("[data-personal-timeline-source-status]")!;
    status.hidden = false;
    status.textContent = "先选择输入来源";

    article.querySelector<HTMLButtonElement>("[data-personal-timeline-source='日记']")?.click();

    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(article.querySelector<HTMLButtonElement>("[data-personal-timeline-source='日记']")
      ?.classList.contains("is-active")).toBe(true);
  });

  it("renders a floated side-image box inside editable ordinary wiki articles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({
          name: "wiki",
          path: "wiki",
          kind: "dir",
          children: [
            {
              name: "wiki",
              path: "wiki",
              kind: "dir",
              children: [{ name: "sample.md", path: "wiki/concepts/sample.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/sample.md",
          title: "Sample",
          html: "<h1>Sample</h1><p>Overview</p>",
          raw: "# Sample\n\nOverview",
          frontmatter: {
            side_image: "wiki/.page-media/concepts/sample-side.png",
            side_image_caption: "这是一张右侧说明图。",
          },
          sourceEditable: true,
          modifiedAt: "2026-04-27T08:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/concepts/sample.md");
    document.body.appendChild(page);

    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const article = page.querySelector<HTMLElement>("[data-wiki-article]");
    const box = article?.querySelector<HTMLElement>("[data-wiki-side-image-box]");
    const preview = page.querySelector<HTMLImageElement>("[data-wiki-side-image-preview]");
    const button = page.querySelector<HTMLButtonElement>("[data-wiki-side-image-upload]");
    const caption = page.querySelector<HTMLElement>("[data-wiki-side-image-caption]");

    expect(box).toBeTruthy();
    expect(preview?.getAttribute("src")).toBe("/api/page-side-image?path=wiki%2F.page-media%2Fconcepts%2Fsample-side.png");
    expect(caption?.textContent).toContain("这是一张右侧说明图。");
    expect(button?.textContent).toContain("更换图片");
    expect(box?.textContent).not.toContain("IMAGE");
    expect(box?.textContent).not.toContain("页面配图");
    expect(box?.textContent).not.toContain("给这篇 wiki 页面补一张右侧配图");
  });

  it("mounts the relationship overview side image beside the page explanation section", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/tree?")) {
        return ok({ name: "wiki", path: "wiki", kind: "dir", children: [] });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/crm/人际关系总览.md",
          title: "人际关系总览",
          html: "<h1>人际关系总览</h1><h2>关系网络图</h2><p>graph</p><h2>页面说明</h2><p>说明正文</p>",
          raw: "# 人际关系总览",
          frontmatter: null,
          sourceEditable: true,
          modifiedAt: "2026-04-28T00:00:00.000Z",
        });
      }
      return ok({});
    }));

    const page = renderWikiPage("wiki/crm/人际关系总览.md");
    document.body.appendChild(page);

    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "说明正文");

    const article = page.querySelector<HTMLElement>("[data-wiki-article]")!;
    const sideImageBox = article.querySelector<HTMLElement>("[data-wiki-side-image-box]");
    const pageInfoHeading = Array.from(article.querySelectorAll("h2"))
      .find((heading) => heading.textContent?.includes("页面说明"));
    expect(sideImageBox).toBeTruthy();
    expect(pageInfoHeading?.nextElementSibling).toBe(sideImageBox);
  });

  it("keeps the about-me profile layout hooks in wiki-launch.css", () => {
    const styles = readFileSync(
      resolve(__dirname, "../web/client/assets/styles/wiki-launch.css"),
      "utf8",
    );

    expect(styles).toContain(".about-me-profile__hero");
    expect(styles).toContain("grid-template-columns: 220px minmax(0, 1fr) 360px;");
    expect(styles).toContain(".about-me-profile__content");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) 320px;");
    expect(styles).toContain(".about-me-profile__achievement-grid");
    expect(styles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(styles).toContain(".about-me-profile__strength-grid");
    expect(styles).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
    expect(styles).toContain(".wiki-page__side-image-box");
    expect(styles).toContain("float: right;");
    expect(styles).toContain(".personal-timeline__view.is-active");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);");
    expect(styles).toContain(".personal-timeline__source-scroll");
    expect(styles).toContain(".personal-timeline__source-modal");
    expect(styles).toContain(".personal-timeline__source-dialog");
    expect(styles).toContain(".personal-timeline__rail-list");
    expect(styles).toContain("overflow-y: auto;");
  });

  it("keeps the identity information center as a fixed one-screen layout", () => {
    const styles = readFileSync(
      resolve(__dirname, "../web/client/assets/styles/identity-info-profile.css"),
      "utf8",
    );

    expect(styles).toContain(".identity-info-page");
    expect(styles).toContain("overflow: hidden;");
    expect(styles).toContain("grid-template-columns: repeat(12, minmax(0, 1fr));");
    expect(styles).toContain(".identity-info-page__timeline");
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain("overflow-x: auto;");
    expect(styles).toContain("flex: 0 0 188px;");
  });
});

// fallow-ignore-next-line complexity
function ok(data: unknown) {
  return {
    ok: true,
    json: async () => ({ success: true, data }),
  };
}

// fallow-ignore-next-line complexity
function rawOk(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
}

async function waitForText(node: HTMLElement, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (node.textContent?.includes(text)) {
      return;
    }
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}

// fallow-ignore-next-line complexity
function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

// fallow-ignore-next-line complexity
function dispatchSidebarDrag(
  target: HTMLElement,
  type: string,
  options: { clientY?: number; dataTransferPath?: string },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "clientY", { value: options.clientY ?? 0 });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      dropEffect: "move",
      effectAllowed: "move",
      getData: () => options.dataTransferPath ?? "",
      setData: vi.fn(),
    },
  });
  target.dispatchEvent(event);
}

// fallow-ignore-next-line complexity
function dispatchDashboardDrag(
  target: HTMLElement,
  type: string,
  options: { clientX: number; clientY: number; dataTransferPath?: string },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "clientX", { value: options.clientX });
  Object.defineProperty(event, "clientY", { value: options.clientY });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      getData: () => options.dataTransferPath ?? "",
      setData: vi.fn(),
    },
  });
  target.dispatchEvent(event);
}

// fallow-ignore-next-line complexity
function stubDashboardRect(target: HTMLElement, left: number, top: number, width: number, height: number): void {
  target.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
}

// fallow-ignore-next-line complexity
function readFirstTimelineFact(data: Record<string, unknown> | undefined): string {
  const first = Array.isArray(data?.items) ? data.items[0] : null;
  return first && typeof first === "object" && !Array.isArray(first)
    ? String((first as Record<string, unknown>).fact ?? "")
    : "";
}

// fallow-ignore-next-line complexity
function readFirstNavTitle(data: Record<string, unknown> | undefined): string {
  const first = Array.isArray(data?.items) ? data.items[0] : null;
  return Array.isArray(first) ? String(first[0] ?? "") : "";
}

// fallow-ignore-next-line complexity
function installWikiStyles(): void {
  const existing = document.head.querySelector("[data-test-wiki-styles]");
  if (existing) {
    existing.remove();
  }
  const style = document.createElement("style");
  style.dataset.testWikiStyles = "true";
  style.textContent = readFileSync(
    resolve(__dirname, "../web/client/assets/styles/wiki-launch.css"),
    "utf8",
  );
  document.head.appendChild(style);
}

// fallow-ignore-next-line complexity
function createDomRect(
  values: { left: number; top: number; width: number; height: number },
): DOMRect {
  return {
    x: values.left,
    y: values.top,
    width: values.width,
    height: values.height,
    top: values.top,
    left: values.left,
    right: values.left + values.width,
    bottom: values.top + values.height,
    toJSON: () => ({}),
  } as DOMRect;
}
