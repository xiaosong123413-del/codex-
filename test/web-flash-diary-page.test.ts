// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderFlashDiaryPage } from "../web/client/src/pages/flash-diary/index.js";

describe("flash diary page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the two-column diary workspace with a pinned memory card", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          twelveQuestions: {
            kind: "document",
            title: "十二个问题",
            path: "wiki/journal-twelve-questions.md",
            description: "固定追问清单",
            exists: false,
            modifiedAt: null,
          },
          items: [],
          memory: {
            kind: "memory",
            title: "Memory",
            path: "wiki/journal-memory.md",
            description: "根据日记沉淀的分层记忆",
            exists: false,
            modifiedAt: null,
            lastAppliedDiaryDate: null,
          },
        },
      }),
    }));
    window.localStorage.setItem("llmWiki.panel.flashDiary.listWidth", "400");

    const page = renderFlashDiaryPage();
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-memory]")).toBeTruthy();
    });

    expect(page.querySelector(".flash-diary-page__hero")).toBeNull();
    expect(page.querySelector("[data-flash-diary-list]")).toBeTruthy();
    expect(page.querySelector("[data-flash-diary-twelve-questions]")?.textContent).toContain("十二个问题");
    expect(page.querySelector("[data-flash-diary-memory]")?.textContent).toContain("Memory");
    expect(page.querySelector("[data-flash-diary-editor]")).toBeTruthy();
    expect(page.querySelector("[data-flash-diary-save]")).toBeTruthy();
    expect(page.querySelector("[data-panel-handle='flashDiary.listWidth']")).toBeTruthy();
    expect(page.querySelector("[data-flash-diary-mode='preview']")).toBeNull();
    expect(page.querySelector("[data-flash-diary-preview]")).toBeNull();
    expect(page.querySelector<HTMLElement>(".flash-diary-page__workspace")?.style.getPropertyValue("--flash-diary-list-width")).toBe("400px");
    expect(
      page.querySelector("[data-flash-diary-list]")?.firstElementChild?.getAttribute("data-flash-diary-twelve-questions"),
    ).not.toBeNull();
  });

  it("opens current-page find from the diary top area when Ctrl+F is pressed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          twelveQuestions: {
            kind: "document",
            title: "十二个问题",
            path: "wiki/journal-twelve-questions.md",
            description: "固定追问清单",
            exists: false,
            modifiedAt: null,
          },
          items: [],
          memory: {
            kind: "memory",
            title: "Memory",
            path: "wiki/journal-memory.md",
            description: "根据日记沉淀的分层记忆",
            exists: false,
            modifiedAt: null,
            lastAppliedDiaryDate: null,
          },
        },
      }),
    }));

    const page = renderFlashDiaryPage();
    document.body.appendChild(page);
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-memory]")).toBeTruthy();
    });

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(document.dispatchEvent(event)).toBe(false);
    const input = page.querySelector<HTMLInputElement>("[data-page-text-search-input]");
    expect(input).toBeTruthy();
    expect(input?.closest(".flash-diary-page__list-panel")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("finds text only inside the currently opened diary page", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/flash-diary") {
        return ok({
          twelveQuestions: {
            kind: "document",
            title: "十二个问题",
            path: "wiki/journal-twelve-questions.md",
            description: "固定追问清单",
            exists: false,
            modifiedAt: null,
          },
          items: [
            {
              path: "raw/闪念日记/2026-04-29.md",
              title: "2026-04-29",
              date: "2026-04-29",
              entryCount: 1,
              modifiedAt: "2026-04-29T10:00:00.000Z",
              thumbnailUrl: null,
            },
          ],
          memory: {
            kind: "memory",
            title: "Memory",
            path: "wiki/journal-memory.md",
            description: "根据日记沉淀的分层记忆",
            exists: false,
            modifiedAt: null,
            lastAppliedDiaryDate: null,
          },
        });
      }
      if (url.includes("/api/flash-diary/page?")) {
        return ok({
          path: "raw/闪念日记/2026-04-29.md",
          title: "2026-04-29",
          raw: "# 2026-04-29\n\n## 10:00:00\n\n我们只查当前日记。\n",
          html: "<h1>2026-04-29</h1><h2>10:00:00</h2><p>我们只查当前日记。</p>",
          modifiedAt: "2026-04-29T10:00:00.000Z",
          entryCount: 1,
        });
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderFlashDiaryPage();
    document.body.appendChild(page);
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-visual-editor]")?.textContent).toContain("我们只查当前日记");
    });

    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    const input = page.querySelector<HTMLInputElement>("[data-page-text-search-input]")!;
    input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    input.value = "h";
    input.dispatchEvent(createComposingInputEvent());
    expect(document.activeElement).toBe(input);
    expect(page.querySelector("[data-page-text-search-status]")?.textContent).toBe("");

    input.value = "ha";
    input.dispatchEvent(createComposingInputEvent());
    expect(document.activeElement).toBe(input);
    expect(page.querySelector("[data-page-text-search-status]")?.textContent).toBe("");

    input.value = "好";
    input.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(document.activeElement).toBe(input);
    expect(page.querySelector("[data-page-text-search-status]")?.textContent).toBe("无结果");

    input.value = "我们";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(window.getSelection()?.toString()).toBe("");
    expect(page.querySelectorAll("[data-page-text-search-mark]").length).toBeGreaterThan(0);
    expect(page.querySelector("[data-page-text-search-status]")?.textContent).toBe("1 个结果");

    page.querySelector<HTMLButtonElement>("[data-page-text-search-next]")?.click();

    expect(window.getSelection()?.toString()).toBe("我们");

    input.value = "Memory";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(page.querySelector("[data-page-text-search-status]")?.textContent).toBe("无结果");
    expect(window.getSelection()?.toString()).toBe("");
    expect(fetchMock.mock.calls.some(([call]) => String(call).includes("/api/search?"))).toBe(false);
  });

  it("loads the latest diary and opens it automatically", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            twelveQuestions: {
              kind: "document",
              title: "十二个问题",
              path: "wiki/journal-twelve-questions.md",
              description: "固定追问清单",
              exists: false,
              modifiedAt: null,
            },
            memory: {
              kind: "memory",
              title: "Memory",
              path: "wiki/journal-memory.md",
              description: "根据日记沉淀的分层记忆",
              exists: true,
              modifiedAt: "2026-04-19T10:00:00.000Z",
              lastAppliedDiaryDate: "2026-04-18",
            },
            items: [
              {
                path: "raw/\u95ea\u5ff5\u65e5\u8bb0/2026-04-19.md",
                title: "2026-04-19",
                date: "2026-04-19",
                entryCount: 2,
                modifiedAt: "2026-04-19T10:00:00.000Z",
                thumbnailUrl: "/api/flash-diary/media?path=raw%2F%E9%97%AA%E5%BF%B5%E6%97%A5%E8%AE%B0%2Fassets%2F2026-04-19%2Fidea.png",
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            path: "raw/\u95ea\u5ff5\u65e5\u8bb0/2026-04-19.md",
            title: "2026-04-19",
            raw: "# 2026-04-19\n\n## 10:00:00\n\nhello\n",
            html: "<h1>2026-04-19</h1><h2>10:00:00</h2><p>hello</p>",
            modifiedAt: "2026-04-19T10:00:00.000Z",
            entryCount: 2,
          },
        }),
      }));

    const page = renderFlashDiaryPage();
    await waitFor(() => {
      expect((page.querySelector("[data-flash-diary-editor]") as HTMLTextAreaElement).value).toContain("hello");
    });

    expect(page.textContent).toContain("2026-04-19");
    expect(page.querySelector("[data-flash-diary-timeline]")).toBeTruthy();
    expect(page.querySelector<HTMLImageElement>(".flash-diary-page__timeline-thumb img")?.src).toContain("/api/flash-diary/media");
    expect((page.querySelector("[data-flash-diary-editor]") as HTMLTextAreaElement).value).toContain("hello");
    expect(page.querySelector("[data-flash-diary-preview]")).toBeNull();
    expect(page.querySelector("[data-flash-diary-save]")).toBeTruthy();
  });

  it("renders diary markdown images as visual thumbnails and opens a closable preview modal", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            twelveQuestions: {
              kind: "document",
              title: "十二个问题",
              path: "wiki/journal-twelve-questions.md",
              description: "固定追问清单",
              exists: false,
              modifiedAt: null,
            },
            memory: {
              kind: "memory",
              title: "Memory",
              path: "wiki/journal-memory.md",
              description: "根据日记沉淀的分层记忆",
              exists: true,
              modifiedAt: "2026-04-27T10:00:00.000Z",
              lastAppliedDiaryDate: "2026-04-26",
            },
            items: [
              {
                path: "raw/闪念日记/2026-04-27.md",
                title: "2026-04-27",
                date: "2026-04-27",
                entryCount: 1,
                modifiedAt: "2026-04-27T10:00:00.000Z",
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            path: "raw/闪念日记/2026-04-27.md",
            title: "2026-04-27",
            raw: [
              "# 2026-04-27 闪念日记",
              "",
              "今天想补一张图。",
              "",
              "![图片 1](./assets/2026-04-27/pasted.png)",
            ].join("\n"),
            html: "",
            modifiedAt: "2026-04-27T10:00:00.000Z",
            entryCount: 1,
          },
        }),
      }));

    const page = renderFlashDiaryPage();
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-visual-editor]")).toBeTruthy();
    });

    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-image-thumb]")).toBeTruthy();
    });

    const image = page.querySelector<HTMLImageElement>("[data-flash-diary-image-thumb]");
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toContain("/api/flash-diary/media?path=");
    image?.click();

    await waitFor(() => {
      expect(page.querySelector<HTMLElement>("[data-flash-diary-image-preview]")?.hidden).toBe(false);
    });

    page.querySelector<HTMLButtonElement>("[data-flash-diary-image-preview-close]")?.click();

    await waitFor(() => {
      expect(page.querySelector<HTMLElement>("[data-flash-diary-image-preview]")?.hidden).toBe(true);
    });
  });

  it("opens memory in rendered commentable mode when the memory card is clicked", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            twelveQuestions: {
              kind: "document",
              title: "十二个问题",
              path: "wiki/journal-twelve-questions.md",
              description: "固定追问清单",
              exists: false,
              modifiedAt: null,
            },
            memory: {
              kind: "memory",
              title: "Memory",
              path: "wiki/journal-memory.md",
              description: "根据日记沉淀的分层记忆",
              exists: true,
              modifiedAt: "2026-04-22T08:00:00.000Z",
              lastAppliedDiaryDate: "2026-04-21",
            },
            items: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            path: "wiki/journal-memory.md",
            title: "Memory",
            raw: [
              "# Memory",
              "",
              "## 短期记忆（最近 7 天）",
              "### 健康状态",
              "- 作息偏乱",
              "",
              "## 长期记忆",
              "- 更稳定的记忆线索",
            ].join("\n"),
            html: [
              "<h1>Memory</h1>",
              "<h2>短期记忆（最近 7 天）</h2>",
              "<h3>健康状态</h3>",
              "<p>作息偏乱</p>",
              "<h2>长期记忆</h2>",
              "<p>更稳定的记忆线索</p>",
            ].join(""),
            modifiedAt: "2026-04-22T08:00:00.000Z",
            sourceEditable: true,
            lastAppliedDiaryDate: "2026-04-21",
          },
        }),
      })
      .mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true, data: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderFlashDiaryPage();
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-memory]")).toBeTruthy();
    });

    page.querySelector<HTMLButtonElement>("[data-flash-diary-memory]")?.click();

    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-memory-body]")?.textContent).toContain("短期记忆（最近 7 天）");
    });

    expect(page.querySelector("[data-flash-diary-memory-body]")?.textContent).toContain("长期记忆");
    expect(page.querySelector("[data-flash-diary-save]")?.hasAttribute("hidden")).toBe(true);
    expect(page.querySelector("[data-flash-diary-memory-refresh]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector("[data-flash-diary-memory-comment]")?.hasAttribute("hidden")).toBe(false);
    expect(page.querySelector("[data-wiki-comments-status]")).toBeTruthy();
  });

  it("opens the twelve-questions markdown document in the editable panel", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            twelveQuestions: {
              kind: "document",
              title: "十二个问题",
              path: "wiki/journal-twelve-questions.md",
              description: "固定追问清单",
              exists: true,
              modifiedAt: "2026-04-26T04:00:00.000Z",
            },
            memory: {
              kind: "memory",
              title: "Memory",
              path: "wiki/journal-memory.md",
              description: "根据日记沉淀的分层记忆",
              exists: true,
              modifiedAt: "2026-04-22T08:00:00.000Z",
              lastAppliedDiaryDate: "2026-04-21",
            },
            items: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            path: "wiki/journal-twelve-questions.md",
            title: "十二个问题",
            raw: "# 十二个问题\n\n- 最近最想逃避什么？\n",
            html: "<h1>十二个问题</h1><ul><li>最近最想逃避什么？</li></ul>",
            modifiedAt: "2026-04-26T04:00:00.000Z",
            entryCount: 0,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderFlashDiaryPage();
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-twelve-questions]")).toBeTruthy();
    });

    page.querySelector<HTMLButtonElement>("[data-flash-diary-twelve-questions]")?.click();

    await waitFor(() => {
      expect((page.querySelector("[data-flash-diary-editor]") as HTMLTextAreaElement).value).toContain("最近最想逃避什么");
    });

    const editor = page.querySelector("[data-flash-diary-editor]") as HTMLTextAreaElement;
    editor.value = "# 十二个问题\n\n- 最近最想逃避什么？\n- 现在真正该推进什么？\n";
    editor.dispatchEvent(new Event("input"));
    page.querySelector<HTMLButtonElement>("[data-flash-diary-save]")?.click();

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) =>
        String(url) === "/api/flash-diary/page" && init?.method === "PUT",
      )).toBe(true);
    });

    expect(page.querySelector("[data-flash-diary-current-title]")?.textContent).toContain("十二个问题");
    expect(page.querySelector("[data-flash-diary-save]")?.hasAttribute("hidden")).toBe(false);
    expect(editor.readOnly).toBe(false);
    expect(page.querySelector("[data-flash-diary-memory-layout]")?.hasAttribute("hidden")).toBe(true);
    const saveRequest = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === "/api/flash-diary/page" && init?.method === "PUT",
    );
    expect(JSON.parse(String(saveRequest?.[1]?.body))).toEqual({
      path: "wiki/journal-twelve-questions.md",
      raw: "# 十二个问题\n\n- 最近最想逃避什么？\n- 现在真正该推进什么？\n",
    });
  });

  it("shows a dedicated missing-document placeholder when twelve questions does not exist", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            twelveQuestions: {
              kind: "document",
              title: "十二个问题",
              path: "wiki/journal-twelve-questions.md",
              description: "你的固定追问清单",
              exists: false,
              modifiedAt: null,
            },
            memory: {
              kind: "memory",
              title: "Memory",
              path: "wiki/journal-memory.md",
              description: "根据日记沉淀的分层记忆",
              exists: true,
              modifiedAt: "2026-04-22T08:00:00.000Z",
              lastAppliedDiaryDate: "2026-04-21",
            },
            items: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: "twelve questions document not found",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderFlashDiaryPage();
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-twelve-questions]")).toBeTruthy();
    });

    page.querySelector<HTMLButtonElement>("[data-flash-diary-twelve-questions]")?.click();

    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-current-meta]")?.textContent).toContain("文档不存在");
    });

    const editor = page.querySelector("[data-flash-diary-editor]") as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(true);
    expect(editor.value).toBe("");
    expect(editor.placeholder).toBe("十二个问题文档不存在");
  });

  it("shows an explicit error state when the memory request returns a non-ok response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            twelveQuestions: {
              kind: "document",
              title: "十二个问题",
              path: "wiki/journal-twelve-questions.md",
              description: "固定追问清单",
              exists: true,
              modifiedAt: "2026-04-26T04:00:00.000Z",
            },
            memory: {
              kind: "memory",
              title: "Memory",
              path: "wiki/journal-memory.md",
              description: "根据日记沉淀的分层记忆",
              exists: true,
              modifiedAt: "2026-04-22T08:00:00.000Z",
              lastAppliedDiaryDate: "2026-04-21",
            },
            items: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: "provider unavailable",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderFlashDiaryPage();
    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-memory]")).toBeTruthy();
    });

    page.querySelector<HTMLButtonElement>("[data-flash-diary-memory]")?.click();

    await waitFor(() => {
      expect(page.querySelector("[data-flash-diary-current-meta]")?.textContent).toContain("Memory 加载失败");
    });

    expect(page.querySelector("[data-flash-diary-memory-body]")?.textContent).toContain("Memory 加载失败");
    expect(page.querySelector("[data-flash-diary-memory-layout]")?.hasAttribute("hidden")).toBe(false);
  });

  // fallow-ignore-next-line complexity
  it("shows the shared selection toolbar in memory mode and creates comments from the selected quote", async () => {
    let createdComment:
      | {
          id: string;
          path: string;
          quote: string;
          text: string;
          start: number;
          end: number;
          resolved: boolean;
          createdAt: string;
        }
      | null = null;

    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/flash-diary") {
        return ok({
          items: [],
          memory: {
            kind: "memory",
            title: "Memory",
            path: "wiki/journal-memory.md",
            description: "根据日记沉淀的分层记忆",
            exists: true,
            modifiedAt: "2026-04-22T08:00:00.000Z",
            lastAppliedDiaryDate: "2026-04-21",
          },
        });
      }
      if (url === "/api/flash-diary/memory") {
        return ok({
          path: "wiki/journal-memory.md",
          title: "Memory",
          raw: [
            "# Memory",
            "",
            "## 短期记忆（最近 7 天）",
            "",
            "### 学习状态",
            "",
            "Alpha Beta Gamma",
            "",
            "## 长期记忆",
            "",
            "Delta",
          ].join("\n"),
          html: [
            "<h1>Memory</h1>",
            "<h2>短期记忆（最近 7 天）</h2>",
            "<h3>学习状态</h3>",
            "<p id=\"memory-target\">Alpha Beta Gamma</p>",
            "<h2>长期记忆</h2>",
            "<p>Delta</p>",
          ].join(""),
          modifiedAt: "2026-04-22T08:00:00.000Z",
          sourceEditable: true,
          lastAppliedDiaryDate: "2026-04-21",
        });
      }
      if (url.startsWith("/api/wiki-comments?path=")) {
        return ok(createdComment ? [createdComment] : []);
      }
      if (url === "/api/wiki-comments" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          path: string;
          quote: string;
          text: string;
          start: number;
          end: number;
        };
        createdComment = {
          id: "comment-1",
          path: body.path,
          quote: body.quote,
          text: body.text,
          start: body.start,
          end: body.end,
          resolved: false,
          createdAt: "2026-04-24T00:05:00.000Z",
        };
        return ok(createdComment);
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const originalRangeDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => createDomRect({ left: 120, top: 160, width: 80, height: 24 }),
    });

    try {
      const page = renderFlashDiaryPage();
      document.body.appendChild(page);

      await waitFor(() => {
        expect(page.querySelector("[data-flash-diary-memory]")).toBeTruthy();
      });

      page.querySelector<HTMLButtonElement>("[data-flash-diary-memory]")?.click();

      await waitFor(() => {
        const memoryText = page.querySelector("[data-flash-diary-memory-body]")?.textContent ?? "";
        expect(memoryText).toContain("短期记忆（最近 7 天）");
        expect(memoryText).toContain("长期记忆");
        expect(memoryText).toContain("Alpha Beta Gamma");
      });

      const textNode = page.querySelector("#memory-target")?.firstChild;
      const range = document.createRange();
      range.setStart(textNode!, 6);
      range.setEnd(textNode!, 10);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await flush();

      const toolbar = page.querySelector<HTMLElement>("[data-flash-diary-selection-toolbar]");
      expect(toolbar?.hidden).toBe(false);
      expect(toolbar?.textContent).toContain("评论");
      expect(toolbar?.textContent).toContain("复制");
      expect(toolbar?.textContent).toContain("取消");

      page.querySelector<HTMLButtonElement>("[data-flash-diary-selection-comment]")?.click();

      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([call, options]) =>
          String(call) === "/api/wiki-comments" && options?.method === "POST",
        )).toBe(true);
      });

      const createRequest = fetchMock.mock.calls.find(([call, options]) =>
        String(call) === "/api/wiki-comments" && options?.method === "POST",
      );
      const requestBody = JSON.parse(String(createRequest?.[1]?.body)) as {
        path: string;
        quote: string;
        text: string;
        start: number;
        end: number;
      };

      expect(requestBody.path).toBe("wiki/journal-memory.md");
      expect(requestBody.quote).toBe("Beta");
      expect(toolbar?.hidden).toBe(true);
      expect(selection.rangeCount).toBe(0);
      expect(page.querySelector<HTMLElement>("[data-flash-diary-memory-comments]")?.hidden).toBe(false);

      await waitFor(() => {
        const input = page.querySelector<HTMLTextAreaElement>("[data-wiki-comments-input=\"comment-1\"]");
        expect(input).toBeTruthy();
        expect(document.activeElement).toBe(input);
      });
    } finally {
      if (originalRangeDescriptor) {
        Object.defineProperty(Range.prototype, "getBoundingClientRect", originalRangeDescriptor);
      } else {
        delete (Range.prototype as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
      }
    }
  });

  // fallow-ignore-next-line complexity
  it("keeps the memory layout at a fixed viewport height so the article scrolls internally", () => {
    const styles = readFileSync(path.join(process.cwd(), "web", "client", "styles.css"), "utf8");
    const memoryLayoutBlock = styles.match(/\.flash-diary-page__memory-layout\s*\{[^}]+\}/)?.[0] ?? "";
    const workspaceBlock = styles.match(/\.flash-diary-page__workspace\s*\{[^}]+\}/)?.[0] ?? "";
    const editorPanelBlock = Array.from(styles.matchAll(/\.flash-diary-page__editor-panel\s*\{[^}]+\}/g))
      .map((match) => match[0])
      .find((block) => block.includes("grid-template-rows")) ?? "";
    const visualEditorBlock = styles.match(/\.flash-diary-visual-editor\s*\{[^}]+\}/)?.[0] ?? "";
    const listBlock = styles.match(/\.flash-diary-page__list\s*\{[^}]+\}/)?.[0] ?? "";
    const listItemBlock = styles.match(/\.flash-diary-page__list-item\s*\{[^}]+\}/)?.[0] ?? "";
    const timelineItemBlock = styles.match(/\.flash-diary-page__timeline-item\s*\{[^}]+\}/)?.[0] ?? "";
    const timelineThumbBlock = Array.from(styles.matchAll(/\.flash-diary-page__timeline-thumb img\s*\{[^}]+\}/g))
      .map((match) => match[0])
      .at(0) ?? "";

    expect(memoryLayoutBlock).toMatch(/\n\s+height: 100%;/);
    expect(workspaceBlock).toMatch(/\n\s+height: 100%;/);
    expect(editorPanelBlock).toMatch(/\n\s+grid-template-rows: auto minmax\(0, 1fr\);/);
    expect(visualEditorBlock).toMatch(/\n\s+height: 100%;/);
    expect(listBlock).toMatch(/\n\s+overflow-x: hidden;/);
    expect(listBlock).toMatch(/\n\s+overflow-y: auto;/);
    expect(listItemBlock).toMatch(/\n\s+padding: 12px 14px;/);
    expect(timelineItemBlock).toMatch(/\n\s+grid-template-columns: 54px minmax\(0, 1fr\);/);
    expect(timelineThumbBlock).toMatch(/\n\s+object-fit: cover;/);
  });
});

async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch {
      await flush();
      await flush();
    }
  }
  assertion();
}

// fallow-ignore-next-line complexity
function ok(data: unknown) {
  return {
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({ success: true, data }),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
}

// fallow-ignore-next-line complexity
function createComposingInputEvent(): InputEvent {
  const event = new Event("input", { bubbles: true }) as InputEvent;
  Object.defineProperty(event, "isComposing", { value: true });
  return event;
}

// fallow-ignore-next-line complexity
function createDomRect(values: { left: number; top: number; width: number; height: number }): DOMRect {
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
