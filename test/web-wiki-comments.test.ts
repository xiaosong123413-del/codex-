// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWikiCommentSurface } from "../web/client/src/components/wiki-comments.js";
import { renderWikiPage } from "../web/client/src/pages/wiki/index.js";

describe("wiki page comments", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installWikiStyles();
  });

  it("starts with the comments drawer closed and toggles it without creating a comment", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              children: [{ name: "test.md", path: "wiki/concepts/test.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/test.md",
          title: "Test",
          html: "<h1>Test</h1><p id=\"wiki-target\">Alpha Beta Gamma</p>",
          raw: "# Test\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-24T00:00:00.000Z",
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Ftest.md") {
        return ok([
          {
            id: "comment-1",
            path: "wiki/concepts/test.md",
            quote: "Beta",
            text: "共享评论",
            start: 10,
            end: 14,
            resolved: false,
            createdAt: "2026-04-24T00:00:00.000Z",
          },
        ]);
      }
      if (url === "/api/wiki-comments" && init?.method === "POST") {
        return ok({
          id: "comment-2",
          path: "wiki/concepts/test.md",
          quote: "Gamma",
          text: "",
          start: 11,
          end: 16,
          resolved: false,
          createdAt: "2026-04-24T00:05:00.000Z",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/test.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Beta");
    expect(page.querySelector("[data-feedback-submit]")).toBeNull();
    expect(page.querySelector("[data-wiki-comments-add]")).toBeNull();
    expect(page.textContent).not.toContain("共享评论");
    expect(page.querySelector("[data-wiki-comments-highlight=\"comment-1\"]")).toBeNull();

    const commentsPanel = page.querySelector(".wiki-page__comments") as HTMLElement;
    const article = page.querySelector<HTMLElement>("[data-wiki-article]")!;
    const articleMarkupBeforeToggle = article.innerHTML;
    expect(commentsPanel.hidden).toBe(true);

    const commentsButton = page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]");
    commentsButton?.click();
    await flush();

    const fetchMock = vi.mocked(fetch);
    expect(commentsPanel.hidden).toBe(false);
    await waitForText(page, "共享评论");
    expect(article.innerHTML).not.toBe(articleMarkupBeforeToggle);
    expect(page.querySelector("[data-wiki-comments-highlight=\"comment-1\"]")?.textContent).toBe("Beta");
    expect(fetchMock.mock.calls.some(([call]) => String(call) === "/api/wiki-comments?path=wiki%2Fconcepts%2Ftest.md")).toBe(true);
    expect(fetchMock.mock.calls.some(([call, options]) =>
      String(call) === "/api/wiki-comments" && options?.method === "POST",
    )).toBe(false);

    commentsButton?.click();

    expect(commentsPanel.hidden).toBe(true);
    expect(article.innerHTML).not.toBe(articleMarkupBeforeToggle);
  });

  it("can adopt an already-rendered article without rewriting the content", async () => {
    const content = document.createElement("article");
    const list = document.createElement("div");
    const status = document.createElement("p");
    const panel = document.createElement("aside");
    content.innerHTML = "<p>Already rendered</p>";

    const surface = createWikiCommentSurface({
      content,
      list,
      status,
      panel,
      emptyLabel: "empty",
    });

    await surface.setDocument("wiki/concepts/rendered.md", "<p>Replacement</p>", {
      sourceEditable: true,
      refreshPage: () => {},
      loadOnSet: false,
      contentAlreadyRendered: true,
    });

    expect(content.innerHTML).toBe("<p>Already rendered</p>");
    expect(status.textContent).toBe("打开评论面板后读取评论。");
  });

  it("keeps the toc and comments drawer from remaining open together", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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
              children: [{ name: "test.md", path: "wiki/concepts/test.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/test.md",
          title: "Test",
          html: "<h1>Test</h1><h2>Overview</h2><p>Alpha Beta Gamma</p>",
          raw: "# Test\n\n## Overview\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-24T00:00:00.000Z",
        });
      }
      if (url.startsWith("/api/wiki-comments?path=")) {
        return ok([]);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/test.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Overview");

    const commentsButton = page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]");
    const commentsPanel = page.querySelector<HTMLElement>("[data-wiki-comments-status]")?.closest<HTMLElement>(".wiki-page__comments");
    const tocToggle = page.querySelector<HTMLButtonElement>("[data-wiki-toc-toggle]");
    const tocPanel = page.querySelector<HTMLElement>("[data-wiki-toc-panel]");

    tocToggle?.click();
    expect(tocPanel?.hidden).toBe(false);

    commentsButton?.click();
    await flush();

    expect(commentsPanel?.hidden).toBe(false);
    expect(tocPanel?.hidden).toBe(true);

    tocToggle?.click();

    expect(tocPanel?.hidden).toBe(false);
    expect(commentsPanel?.hidden).toBe(true);
  });

  it("shows a friendly error for non-json comment responses and lets the comments panel close", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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
              children: [{ name: "broken.md", path: "wiki/concepts/broken.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/broken.md",
          title: "Broken",
          html: "<h1>Broken</h1><p>Alpha Beta Gamma</p>",
          raw: "# Broken\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-24T00:00:00.000Z",
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Fbroken.md") {
        return {
          ok: true,
          headers: {
            get: (name: string) => name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
          },
          text: async () => "<!DOCTYPE html><html></html>",
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/broken.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");
    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();
    await waitForText(page, "评论服务暂时不可用");

    expect(page.textContent).toContain("评论服务暂时不可用");

    const commentsPanel = page.querySelector(".wiki-page__comments") as HTMLElement;
    expect(commentsPanel.hidden).toBe(false);

    page.querySelector<HTMLButtonElement>("[data-wiki-comments-close]")?.click();

    expect(commentsPanel.hidden).toBe(true);
  });

  it("creates a comment draft from the preserved toolbar selection and opens the drawer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              children: [{ name: "draft.md", path: "wiki/concepts/draft.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/draft.md",
          title: "Draft",
          html: "<h1>Draft</h1><p id=\"wiki-target\">Alpha Beta Gamma</p>",
          raw: "# Draft\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-24T00:00:00.000Z",
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Fdraft.md") {
        return ok([]);
      }
      if (url === "/api/wiki-comments" && init?.method === "POST") {
        return ok({
          id: "comment-2",
          path: "wiki/concepts/draft.md",
          quote: "Beta",
          text: "",
          start: 11,
          end: 15,
          resolved: false,
          createdAt: "2026-04-24T00:05:00.000Z",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/draft.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");

    const textNode = page.querySelector("#wiki-target")?.lastChild;
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
    const commentsPanel = page.querySelector(".wiki-page__comments") as HTMLElement;
    const tocToggle = page.querySelector<HTMLButtonElement>("[data-wiki-toc-toggle]");
    const tocPanel = page.querySelector<HTMLElement>("[data-wiki-toc-panel]");
    const commentStatus = page.querySelector<HTMLElement>("[data-wiki-comments-status]")!;

    expect(toolbar?.hidden).toBe(false);
    selection.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    tocToggle?.click();
    expect(tocPanel?.hidden).toBe(false);

    toolbarAction?.click();
    await waitForCondition(() => commentStatus.textContent?.includes("评论已创建") === true);

    const fetchMock = vi.mocked(fetch);
    const createCall = fetchMock.mock.calls.find(([call, options]) =>
      String(call) === "/api/wiki-comments" && options?.method === "POST",
    );

    expect(createCall).toBeTruthy();
    expect(createCall?.[1]?.body).toBe(JSON.stringify({
      path: "wiki/concepts/draft.md",
      quote: "Beta",
      text: "",
      start: 11,
      end: 15,
    }));
    expect(toolbar?.hidden).toBe(true);
    expect(commentsPanel.hidden).toBe(false);
    expect(tocPanel?.hidden).toBe(true);
    expect(document.activeElement).toBe(page.querySelector("[data-wiki-comments-input=\"comment-2\"]"));
  });

  it("saves and deletes comments through the drawer controls", async () => {
    let comments = [
      {
        id: "comment-1",
        path: "wiki/concepts/editable.md",
        quote: "Beta",
        text: "初始评论",
        start: 6,
        end: 10,
        resolved: false,
        createdAt: "2026-04-24T00:00:00.000Z",
      },
    ];

    // fallow-ignore-next-line complexity
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              children: [{ name: "editable.md", path: "wiki/concepts/editable.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/editable.md",
          title: "Editable",
          html: "<h1>Editable</h1><p>Alpha Beta Gamma</p>",
          raw: "# Editable\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-24T00:00:00.000Z",
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Feditable.md") {
        return ok(comments);
      }
      if (url === "/api/wiki-comments/comment-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { text: string };
        comments = comments.map((comment) =>
          comment.id === "comment-1"
            ? { ...comment, text: body.text }
            : comment,
        );
        return ok(comments[0]);
      }
      if (url === "/api/wiki-comments/comment-1?path=wiki%2Fconcepts%2Feditable.md" && init?.method === "DELETE") {
        comments = [];
        return ok(null);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/editable.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");
    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();
    await waitForText(page, "初始评论");

    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();

    const textarea = page.querySelector<HTMLTextAreaElement>("[data-wiki-comments-input=\"comment-1\"]")!;
    const saveButton = page.querySelector<HTMLButtonElement>("[data-wiki-comments-save]")!;
    const deleteButton = page.querySelector<HTMLButtonElement>("[data-wiki-comments-delete]")!;

    textarea.value = "已更新的评论";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    saveButton.click();

    const fetchMock = vi.mocked(fetch);
    await waitForCondition(() => fetchMock.mock.calls.some(([call, options]) =>
      String(call) === "/api/wiki-comments/comment-1" && options?.method === "PATCH",
    ));

    const patchCall = fetchMock.mock.calls.find(([call, options]) =>
      String(call) === "/api/wiki-comments/comment-1" && options?.method === "PATCH",
    );

    expect(patchCall).toBeTruthy();
    expect(patchCall?.[1]?.body).toBe(JSON.stringify({
      path: "wiki/concepts/editable.md",
      text: "已更新的评论",
    }));
    await waitForCondition(() =>
      page.querySelector<HTMLTextAreaElement>("[data-wiki-comments-input=\"comment-1\"]")?.value === "已更新的评论",
    );

    deleteButton.click();

    await waitForCondition(() => fetchMock.mock.calls.some(([call, options]) =>
      String(call) === "/api/wiki-comments/comment-1?path=wiki%2Fconcepts%2Feditable.md" && options?.method === "DELETE",
    ));

    const deleteCall = fetchMock.mock.calls.find(([call, options]) =>
      String(call) === "/api/wiki-comments/comment-1?path=wiki%2Fconcepts%2Feditable.md" && options?.method === "DELETE",
    );

    expect(deleteCall).toBeTruthy();
    await waitForCondition(() => page.querySelector("[data-wiki-comments-card=\"comment-1\"]") === null);
    expect(page.querySelector("[data-wiki-comments-input]")).toBeNull();
  });

  it("ignores stale comment responses from a previous page after setDocument switches paths", async () => {
    let resolveFirstComments: ((value: ReturnType<typeof ok>) => void) | null = null;
    let resolveSecondComments: ((value: ReturnType<typeof ok>) => void) | null = null;

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Ffirst.md") {
        return new Promise((resolveFetch) => {
          resolveFirstComments = resolveFetch as (value: ReturnType<typeof ok>) => void;
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Fsecond.md") {
        return new Promise((resolveFetch) => {
          resolveSecondComments = resolveFetch as (value: ReturnType<typeof ok>) => void;
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const content = document.createElement("article");
    const list = document.createElement("div");
    const status = document.createElement("p");
    const panel = document.createElement("aside");
    const surface = createWikiCommentSurface({
      content,
      list,
      status,
      panel,
      emptyLabel: "empty",
    });

    const firstLoad = surface.setDocument("wiki/concepts/first.md", "<p>Alpha Beta</p>", {
      sourceEditable: true,
      refreshPage: () => {},
    });
    const secondLoad = surface.setDocument("wiki/concepts/second.md", "<p>Gamma Delta</p>", {
      sourceEditable: true,
      refreshPage: () => {},
    });

    resolveSecondComments?.(ok([
      {
        id: "comment-second",
        path: "wiki/concepts/second.md",
        quote: "Delta",
        text: "第二页评论",
        start: 6,
        end: 11,
        resolved: false,
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    ]));
    await secondLoad;

    expect(list.textContent).toContain("第二页评论");
    expect(content.textContent).toContain("Gamma Delta");
    expect(content.textContent).not.toContain("Alpha Beta");
    expect(content.querySelector("[data-wiki-comments-highlight=\"comment-second\"]")?.textContent).toBe("Delta");

    resolveFirstComments?.(ok([
      {
        id: "comment-first",
        path: "wiki/concepts/first.md",
        quote: "Beta",
        text: "第一页旧评论",
        start: 6,
        end: 10,
        resolved: false,
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    ]));
    await firstLoad;
    await flush();

    expect(list.textContent).toContain("第二页评论");
    expect(list.textContent).not.toContain("第一页旧评论");
    expect(content.textContent).toContain("Gamma Delta");
    expect(content.textContent).not.toContain("Alpha Beta");
    expect(content.querySelector("[data-wiki-comments-highlight=\"comment-first\"]")).toBeNull();
    expect(status.textContent).toContain("已加载 1 条评论");
  });

  it("ignores a stale create-comment response after setDocument switches to another page", async () => {
    let resolveCreateComment: ((value: ReturnType<typeof ok>) => void) | null = null;

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Ffirst.md") {
        return Promise.resolve(ok([]));
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Fsecond.md") {
        return Promise.resolve(ok([]));
      }
      if (url === "/api/wiki-comments" && init?.method === "POST") {
        return new Promise((resolveFetch) => {
          resolveCreateComment = resolveFetch as (value: ReturnType<typeof ok>) => void;
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const content = document.createElement("article");
    const list = document.createElement("div");
    const status = document.createElement("p");
    const panel = document.createElement("aside");
    const surface = createWikiCommentSurface({
      content,
      list,
      status,
      panel,
      emptyLabel: "empty",
    });

    await surface.setDocument("wiki/concepts/first.md", "<p>Alpha Beta</p>", {
      sourceEditable: true,
      refreshPage: () => {},
    });

    const createRequest = surface.createFromSelection({
      quote: "Beta",
      start: 6,
      end: 10,
    });

    await surface.setDocument("wiki/concepts/second.md", "<p>Gamma Delta</p>", {
      sourceEditable: true,
      refreshPage: () => {},
    });

    resolveCreateComment?.(ok({
      id: "comment-first-created",
      path: "wiki/concepts/first.md",
      quote: "Beta",
      text: "",
      start: 6,
      end: 10,
      resolved: false,
      createdAt: "2026-04-25T00:00:00.000Z",
    }));
    await createRequest;
    await flush();

    expect(content.textContent).toContain("Gamma Delta");
    expect(content.textContent).not.toContain("Alpha Beta");
    expect(content.querySelector("[data-wiki-comments-highlight=\"comment-first-created\"]")).toBeNull();
    expect(list.querySelector("[data-wiki-comments-card]")).toBeNull();
    expect(list.textContent).toContain("empty");
    expect(status.textContent).not.toContain("评论已创建");
  });

  it("ignores a stale confirm response after setDocument switches to another page", async () => {
    let resolveConfirmDraft: ((value: ReturnType<typeof ok>) => void) | null = null;
    const refreshFirst = vi.fn();
    const refreshSecond = vi.fn();

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Ffirst.md") {
        return Promise.resolve(ok([
          {
            id: "comment-first",
            path: "wiki/concepts/first.md",
            quote: "Beta",
            text: "把 Beta 改成 Better。",
            start: 6,
            end: 10,
            resolved: false,
            createdAt: "2026-04-25T00:00:00.000Z",
          },
        ]));
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Fsecond.md") {
        return Promise.resolve(ok([]));
      }
      if (url === "/api/wiki-comments/comment-first/ai-draft" && init?.method === "POST") {
        return Promise.resolve(ok({
          id: "draft-1",
          commentId: "comment-first",
          pagePath: "wiki/concepts/first.md",
          diffText: [
            "--- current",
            "+++ proposed",
            "@@",
            "-Alpha Beta",
            "+Alpha Better",
          ].join("\n"),
        }));
      }
      if (url === "/api/wiki-comments/comment-first/ai-draft/draft-1/confirm" && init?.method === "POST") {
        return new Promise((resolveFetch) => {
          resolveConfirmDraft = resolveFetch as (value: ReturnType<typeof ok>) => void;
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const content = document.createElement("article");
    const list = document.createElement("div");
    const status = document.createElement("p");
    const panel = document.createElement("aside");
    const surface = createWikiCommentSurface({
      content,
      list,
      status,
      panel,
      emptyLabel: "empty",
    });

    await surface.setDocument("wiki/concepts/first.md", "<p>Alpha Beta</p>", {
      sourceEditable: true,
      refreshPage: refreshFirst,
    });

    list.querySelector<HTMLButtonElement>("[data-wiki-comments-ai-resolve]")?.click();
    await waitForCondition(() => list.textContent?.includes("确认写回") === true);

    list.querySelector<HTMLButtonElement>("[data-wiki-comments-ai-confirm]")?.click();

    await surface.setDocument("wiki/concepts/second.md", "<p>Gamma Delta</p>", {
      sourceEditable: true,
      refreshPage: refreshSecond,
    });

    resolveConfirmDraft?.(ok({
      id: "draft-1",
      pagePath: "wiki/concepts/first.md",
      page: {
        path: "wiki/concepts/first.md",
        title: "First",
        html: "<p>Alpha Better</p>",
        raw: "Alpha Better",
        frontmatter: null,
        modifiedAt: "2026-04-25T00:10:00.000Z",
        sourceEditable: true,
      },
    }));
    await flush();
    await flush();

    expect(content.textContent).toContain("Gamma Delta");
    expect(content.textContent).not.toContain("Alpha Better");
    expect(refreshFirst).not.toHaveBeenCalled();
    expect(refreshSecond).not.toHaveBeenCalled();
    expect(status.textContent).not.toContain("评论已解决");
  });

  it("closes the selection toolbar even when clipboard copy fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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
              children: [{ name: "copy.md", path: "wiki/concepts/copy.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/copy.md",
          title: "Copy",
          html: "<h1>Copy</h1><p id=\"wiki-target\">Alpha Beta Gamma</p>",
          raw: "# Copy\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-25T00:00:00.000Z",
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Fcopy.md") {
        return ok([]);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const unhandledErrors: unknown[] = [];
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      unhandledErrors.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const clipboard = {
      writeText: vi.fn(async () => {
        throw new Error("clipboard blocked");
      }),
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });

    try {
      const page = renderWikiPage("wiki/concepts/copy.md");
      document.body.appendChild(page);
      await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");

      const textNode = page.querySelector("#wiki-target")?.lastChild;
      const range = document.createRange();
      range.setStart(textNode!, 6);
      range.setEnd(textNode!, 10);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await flush();

      const toolbar = page.querySelector<HTMLElement>("[data-wiki-selection-toolbar]")!;
      expect(toolbar.hidden).toBe(false);

      page.querySelector<HTMLButtonElement>("[data-wiki-selection-copy]")?.click();
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(toolbar.hidden).toBe(true);
      expect(unhandledErrors).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    }
  });

  it("shows AI auto resolve only for editable unresolved comments with text", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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
              children: [{ name: "editable.md", path: "wiki/concepts/editable.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/editable.md",
          title: "Editable",
          html: "<h1>Editable</h1><p>Alpha Beta Gamma</p>",
          raw: "# Editable\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-25T00:00:00.000Z",
          sourceEditable: true,
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Feditable.md") {
        return ok([
          {
            id: "comment-eligible",
            path: "wiki/concepts/editable.md",
            quote: "Beta",
            text: "把这里改成更具体的描述。",
            start: 6,
            end: 10,
            resolved: false,
            createdAt: "2026-04-25T00:00:00.000Z",
          },
          {
            id: "comment-empty",
            path: "wiki/concepts/editable.md",
            quote: "Gamma",
            text: "",
            start: 11,
            end: 16,
            resolved: false,
            createdAt: "2026-04-25T00:01:00.000Z",
          },
          {
            id: "comment-resolved",
            path: "wiki/concepts/editable.md",
            quote: "Alpha",
            text: "这个评论已经处理过。",
            start: 0,
            end: 5,
            resolved: true,
            createdAt: "2026-04-25T00:02:00.000Z",
          },
        ]);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/editable.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");
    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();
    await waitForText(page, "把这里改成更具体的描述。");

    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();

    expect(findButtonsByText(page, "AI自动解决")).toHaveLength(1);
    expect(page.querySelector("[data-wiki-comments-card=\"comment-eligible\"]")?.textContent).toContain("AI自动解决");
    expect(page.querySelector("[data-wiki-comments-card=\"comment-empty\"]")?.textContent).not.toContain("AI自动解决");
    expect(page.querySelector("[data-wiki-comments-card=\"comment-resolved\"]")?.textContent).not.toContain("AI自动解决");
  });

  it("renders diff review after AI resolve and refreshes the article from confirm data.page", async () => {
    let commentResolved = false;

    // fallow-ignore-next-line complexity
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              children: [{ name: "editable.md", path: "wiki/concepts/editable.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/editable.md",
          title: "Editable",
          html: "<h1>Editable</h1><p id=\"wiki-target\">Alpha Beta Gamma</p>",
          raw: "# Editable\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-25T00:00:00.000Z",
          sourceEditable: true,
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Feditable.md") {
        return ok([
          {
            id: "comment-1",
            path: "wiki/concepts/editable.md",
            quote: "Beta",
            text: "把 Beta 改成 Better。",
            start: 6,
            end: 10,
            resolved: commentResolved,
            createdAt: "2026-04-25T00:00:00.000Z",
          },
        ]);
      }
      if (url === "/api/wiki-comments/comment-1/ai-draft" && init?.method === "POST") {
        return ok({
          id: "draft-1",
          commentId: "comment-1",
          pagePath: "wiki/concepts/editable.md",
          status: "done-await-confirm",
          diffText: [
            "--- current",
            "+++ proposed",
            "@@",
            "-# Editable",
            "-",
            "-Alpha Beta Gamma",
            "+# Editable",
            "+",
            "+Alpha Better Gamma",
          ].join("\n"),
        });
      }
      if (url === "/api/wiki-comments/comment-1/ai-draft/draft-1/confirm" && init?.method === "POST") {
        commentResolved = true;
        return ok({
          id: "draft-1",
          pagePath: "wiki/concepts/editable.md",
          page: {
            path: "wiki/concepts/editable.md",
            title: "Editable",
            html: "<h1>Editable</h1><p id=\"wiki-target\">Alpha Better Gamma</p>",
            raw: "# Editable\n\nAlpha Better Gamma",
            frontmatter: null,
            modifiedAt: "2026-04-25T00:10:00.000Z",
            sourceEditable: true,
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/editable.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");
    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();
    await waitForText(page, "把 Beta 改成 Better。");

    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();

    const aiResolveButton = findButtonsByText(page, "AI自动解决")[0];
    expect(aiResolveButton).toBeTruthy();
    aiResolveButton?.click();

    await waitForText(page, "+++ proposed");

    const confirmButton = findButtonsByText(page, "确认写回")[0];
    expect(confirmButton).toBeTruthy();
    confirmButton?.click();

    await waitForCondition(() =>
      page.querySelector<HTMLElement>("[data-wiki-article]")?.textContent?.includes("Alpha Better Gamma") === true,
    );
    expect(page.querySelector<HTMLElement>("[data-wiki-article]")?.textContent).toContain("Alpha Better Gamma");
    expect(page.querySelector<HTMLElement>("[data-wiki-article]")?.textContent).not.toContain("Alpha Beta Gamma");
    await waitForText(page, "评论已解决");
  });

  it("discards AI diff review and restores the normal unresolved comment state", async () => {
    // fallow-ignore-next-line complexity
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              children: [{ name: "editable.md", path: "wiki/concepts/editable.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/editable.md",
          title: "Editable",
          html: "<h1>Editable</h1><p>Alpha Beta Gamma</p>",
          raw: "# Editable\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-25T00:00:00.000Z",
          sourceEditable: true,
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Feditable.md") {
        return ok([
          {
            id: "comment-1",
            path: "wiki/concepts/editable.md",
            quote: "Beta",
            text: "把 Beta 改成 Better。",
            start: 6,
            end: 10,
            resolved: false,
            createdAt: "2026-04-25T00:00:00.000Z",
          },
        ]);
      }
      if (url === "/api/wiki-comments/comment-1/ai-draft" && init?.method === "POST") {
        return ok({
          id: "draft-1",
          commentId: "comment-1",
          pagePath: "wiki/concepts/editable.md",
          status: "done-await-confirm",
          diffText: [
            "--- current",
            "+++ proposed",
            "@@",
            "-# Editable",
            "-",
            "-Alpha Beta Gamma",
            "+# Editable",
            "+",
            "+Alpha Better Gamma",
          ].join("\n"),
        });
      }
      if (url === "/api/wiki-comments/comment-1/ai-draft/draft-1" && init?.method === "DELETE") {
        return ok(null);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/editable.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");
    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();
    await waitForText(page, "把 Beta 改成 Better。");

    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();

    const aiResolveButton = findButtonsByText(page, "AI自动解决")[0];
    expect(aiResolveButton).toBeTruthy();
    aiResolveButton?.click();

    await waitForText(page, "+++ proposed");

    const discardButton = findButtonsByText(page, "放弃草案")[0];
    expect(discardButton).toBeTruthy();
    discardButton?.click();

    await waitForCondition(() => page.textContent?.includes("+++ proposed") !== true);
    expect(page.textContent).toContain("把 Beta 改成 Better。");
    expect(page.textContent).toContain("AI自动解决");
    expect(page.textContent).not.toContain("评论已解决");
  });

  it("does not show AI auto resolve on runtime-only wiki pages", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
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
              children: [{ name: "runtime-only.md", path: "wiki/concepts/runtime-only.md", kind: "file" }],
            },
          ],
        });
      }
      if (url.includes("/api/page?")) {
        return rawOk({
          path: "wiki/concepts/runtime-only.md",
          title: "Runtime only",
          html: "<h1>Runtime only</h1><p>Alpha Beta Gamma</p>",
          raw: "# Runtime only\n\nAlpha Beta Gamma",
          frontmatter: null,
          modifiedAt: "2026-04-25T00:00:00.000Z",
          sourceEditable: false,
        });
      }
      if (url === "/api/wiki-comments?path=wiki%2Fconcepts%2Fruntime-only.md") {
        return ok([
          {
            id: "comment-1",
            path: "wiki/concepts/runtime-only.md",
            quote: "Beta",
            text: "即使评论有内容，runtime-only 页面也不能 AI 自动解决。",
            start: 6,
            end: 10,
            resolved: false,
            createdAt: "2026-04-25T00:00:00.000Z",
          },
        ]);
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const page = renderWikiPage("wiki/concepts/runtime-only.md");
    document.body.appendChild(page);
    await waitForText(page.querySelector<HTMLElement>("[data-wiki-article]")!, "Alpha Beta Gamma");
    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();
    await waitForText(page, "runtime-only 页面也不能 AI 自动解决");

    page.querySelector<HTMLButtonElement>("[data-wiki-comment-action]")?.click();
    await flush();

    expect(findButtonsByText(page, "AI自动解决")).toHaveLength(0);
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
function findButtonsByText(root: ParentNode, text: string): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .filter((button) => button.textContent?.includes(text) === true);
}
