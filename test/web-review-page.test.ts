// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderReviewPage, renderReviewItems } from "../web/client/src/pages/review/index.js";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;

  onerror: ((event: Event) => void) | null = null;

  private readonly listeners: Record<string, EventListenerOrEventListenerObject[]> = {};

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  close(): void {}

  emitStatus(status: "running" | "succeeded" | "failed"): void {
    this.emit("status", new MessageEvent("status", { data: JSON.stringify({
      run: { id: "run-check-1", kind: "check", status },
    }) }));
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners[type] ?? []) {
      if (typeof listener === "function") listener.call(this as unknown as EventTarget, event);
      else listener.handleEvent(event);
    }
  }
}

describe("review page", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    MockEventSource.instances = [];
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/review") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: { items: [], state: null },
            }),
          } as Response;
        }
        if (url === "/api/project-log/workspace") {
          const payload = {
            success: true,
            data: {
              groups: [
                {
                  name: "\u6784\u5efa\u4ea7\u7269\u4e0e\u672c\u5730\u72b6\u6001",
                  entries: [
                    {
                      path: "gui-panel-state.json",
                      status: "\u751f\u6210\u4ef6",
                      project: "\u6784\u5efa\u4ea7\u7269\u4e0e\u672c\u5730\u72b6\u6001",
                      recommendation: "delete" as const,
                      reason: "\u672c\u5730 UI \u9762\u677f\u72b6\u6001\u6587\u4ef6\u3002",
                      kind: "file" as const,
                    },
                  ],
                },
              ],
              pending: [
                {
                  id: "lint-image-source-trace",
                  title: "Lint \u56fe\u7247\u6765\u6e90\u8ffd\u6eaf\u89c4\u5219",
                  area: "\u7cfb\u7edf\u68c0\u67e5",
                  status: "\u534a\u6210\u54c1",
                  description: "\u68c0\u67e5 wiki \u6b63\u6587\u5f15\u7528\u56fe\u7247\u662f\u5426\u80fd\u8ffd\u6eaf\u6765\u6e90\u3002",
                  pausedReason: "\u8fd8\u6ca1\u6709\u843d\u8fdb\u7cfb\u7edf\u68c0\u67e5\u6267\u884c\u94fe\u8def\u3002",
                  nextStep: "\u626b\u63cf Markdown \u56fe\u7247\u5f15\u7528\u5e76\u8f93\u51fa\u5ba1\u67e5\u9879\u3002",
                },
              ],
            },
          };
          return {
            ok: true,
            text: async () => JSON.stringify(payload),
          } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  it("renders the review shell without hero and stat cards", () => {
    const page = renderReviewPage();

    expect(page.querySelector(".review-page__layout")).toBeTruthy();
    expect(page.querySelector(".review-page__main")).toBeTruthy();
    expect(page.querySelector(".review-page__workspace")).toBeTruthy();
    expect(page.querySelector(".review-page__hero")).toBeNull();
    expect(page.querySelector("[data-review-stats]")).toBeNull();
    expect(page.textContent).not.toContain("Build");
  });

  it("does not mount workspace retained files inside the review page", async () => {
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();

    expect(page.querySelector<HTMLElement>("[data-review-workspace]")?.hidden).toBe(true);
    expect(page.textContent).not.toContain("\u5de5\u4f5c\u533a\u7559\u5b58\u6587\u4ef6");
  });

  it("shows a visible busy state when the toolbar refresh button reloads the queue", async () => {
    let resolveReview: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/review") {
        return new Promise<Response>((resolve) => {
          resolveReview = resolve;
        });
      }
      if (url === "/api/project-log/workspace") {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { groups: [], pending: [] },
          }),
        } as Response);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();

    resolveReview?.({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: {
          items: [
            {
              id: "research-1",
              kind: "deep-research",
              severity: "warn",
              title: "引用缺失",
              detail: "引用缺失：缓存段落缺少外部来源",
              createdAt: "2026-04-17T01:00:00.000Z",
              target: "wiki/concepts/example.md",
              deepResearch: {
                category: "missing-citation",
                scope: "claim",
                pagePath: "wiki/concepts/example.md",
                line: 22,
                factText: "这段结论缺少来源文件支撑。",
                gapText: "Broken citation ^[clip.md] - source file not found",
                triggerReason: "原文引用指向的来源文件不存在。",
                status: "pending",
                progress: 0,
                updatedAt: "2026-04-17T01:00:00.000Z",
              },
            },
          ],
          state: null,
        },
      }),
      json: async () => ({
        success: true,
        data: {
          items: [
            {
              id: "research-1",
              kind: "deep-research",
              severity: "warn",
              title: "引用缺失",
              detail: "引用缺失：缓存段落缺少外部来源",
              createdAt: "2026-04-17T01:00:00.000Z",
              target: "wiki/concepts/example.md",
              deepResearch: {
                category: "missing-citation",
                scope: "claim",
                pagePath: "wiki/concepts/example.md",
                line: 22,
                factText: "这段结论缺少来源文件支撑。",
                gapText: "Broken citation ^[clip.md] - source file not found",
                triggerReason: "原文引用指向的来源文件不存在。",
                status: "pending",
                progress: 0,
                updatedAt: "2026-04-17T01:00:00.000Z",
              },
            },
          ],
          state: null,
        },
      }),
    } as Response);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-review-refresh]")?.click();
    await Promise.resolve();

    expect(page.querySelector("[data-review-refresh]")?.textContent).toContain("刷新中");
    expect(page.querySelector("[data-review-status]")?.textContent).toContain("正在刷新审查队列");

    resolveReview = null;
  });

  it("renders review item cards", () => {
    const page = renderReviewPage();
    renderReviewItems(page, [
      {
        id: "item-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "引用缺失：缓存段落缺少外部来源",
        createdAt: "2026-04-17T01:00:00.000Z",
        target: "wiki/concepts/example.md",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在。",
          sourceExcerpt: "Broken citation ^[clip.md] - source file not found",
          status: "pending",
          progress: 0,
          updatedAt: "2026-04-17T01:00:00.000Z",
        },
      },
    ]);

    expect(page.querySelector(".review-card__title")?.textContent).toContain("引用缺失");
  });

  it("shows a guided ingest action for inbox items", () => {
    const page = renderReviewPage();
    renderReviewItems(page, [
      {
        id: "inbox-1",
        kind: "inbox",
        severity: "suggest",
        title: "Inbox source",
        detail: "Needs decision",
        target: "inbox/source.md",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    expect(page.querySelector("[data-inbox-guide='inbox/source.md']")?.textContent).toContain("\u4eb2\u81ea\u6307\u5bfc\u5f55\u5165");
  });

  it("auto-opens the detail rail for a single inbox item so the page stays complete", () => {
    const page = renderReviewPage();
    document.body.appendChild(page);
    renderReviewItems(page, [
      {
        id: "inbox-1",
        kind: "inbox",
        severity: "suggest",
        title: "Inbox source",
        detail: "Needs decision",
        target: "inbox/source.md",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    expect(page.classList.contains("review-page--workspace-open")).toBe(true);
    expect(page.querySelector<HTMLElement>("[data-review-workspace]")?.hidden).toBe(false);
    expect(page.querySelector("[data-review-detail-panel]")?.textContent).toContain("Inbox source");
    expect(page.querySelector("[data-review-detail-panel]")?.textContent).toContain("亲自指导录入");
    expect(page.querySelector("[data-review-detail-panel]")?.textContent).toContain("优先批量录入");
  });

  it("opens a guided ingest chat workspace in the review sidebar and keeps the inbox page selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { groups: [], pending: [] },
          }),
        } as Response;
      }
      if (url === "/api/chat" && init?.method === "POST") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: {
              id: "chat-guided-1",
              title: "指导录入：Inbox source",
              messages: [],
              articleRefs: ["inbox/source.md"],
            },
          }),
        } as Response;
      }
      if (url === "/api/chat/chat-guided-1/messages" && init?.method === "POST") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: {
              id: "chat-guided-1",
              title: "指导录入：Inbox source",
              articleRefs: ["inbox/source.md"],
              messages: [
                {
                  id: "m-1",
                  role: "user",
                  content: "请先帮我整理成可录入结构",
                  createdAt: "2026-04-17T01:00:00.000Z",
                },
                {
                  id: "m-2",
                  role: "assistant",
                  content: "先给出主题、结论和来源边界。",
                  createdAt: "2026-04-17T01:00:01.000Z",
                },
              ],
            },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    installClientStyles();
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "inbox-1",
        kind: "inbox",
        severity: "suggest",
        title: "Inbox source",
        detail: "Needs decision",
        target: "inbox/source.md",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    page.querySelector<HTMLButtonElement>("[data-inbox-guide='inbox/source.md']")?.click();
    await flush();

    const panel = page.querySelector<HTMLElement>("[data-review-guided-panel]");
    expect(panel?.textContent).toContain("指导录入");
    expect(panel?.textContent).toContain("Inbox source");
    expect(panel?.textContent).toContain("inbox/source.md");
    expect(panel?.textContent).toContain("当前选中页面");
    expect(window.location.hash).not.toBe("#/chat");

    const input = page.querySelector<HTMLTextAreaElement>("[data-review-guided-input]");
    input!.value = "请先帮我整理成可录入结构";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-review-guided-send]")?.click();
    await flush();

    const sendCall = fetchMock.mock.calls.find(([inputArg, init]) =>
      String(inputArg) === "/api/chat/chat-guided-1/messages" && init?.method === "POST");
    expect(sendCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "请先帮我整理成可录入结构",
        articleRefs: ["inbox/source.md"],
      }),
    });
    const updatedPanel = page.querySelector<HTMLElement>("[data-review-guided-panel]");
    expect(updatedPanel?.textContent).toContain("先给出主题、结论和来源边界。");
  });

  it("queues inbox items for priority batch ingest from review cards", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { groups: [], pending: [] },
          }),
        } as Response;
      }
      if (url === "/api/review/inbox/batch-ingest" && init?.method === "POST") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { queued: 1, skipped: 0 },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "inbox-1",
        kind: "inbox",
        severity: "suggest",
        title: "Inbox source",
        detail: "Needs decision",
        target: "inbox/source.md",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    const button = page.querySelector<HTMLButtonElement>("[data-inbox-batch='inbox/source.md']");
    expect(button?.disabled).toBe(false);

    button?.click();
    await flush();

    const call = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === "/api/review/inbox/batch-ingest" && init?.method === "POST");
    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: ["inbox/source.md"] }),
    });
    expect(page.querySelector("[data-review-status]")?.textContent).toContain("已加入 1 条优先批量录入队列");
  });

  it("renders xiaohongshu sync failures with the correct kind label", () => {
    const page = renderReviewPage();
    renderReviewItems(page, [
      {
        id: "xhs-1",
        kind: "xhs-sync-failure",
        severity: "error",
        title: "XHS sync failed",
        detail: "cookie expired",
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    expect(page.querySelector(".review-card__kind")?.textContent).toContain("\u5c0f\u7ea2\u4e66\u540c\u6b65");
    expect(page.querySelector("[data-review-resolve]")).toBeNull();
  });

  it("renders deep-research quick actions in the card footer", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: {
              groups: [],
              pending: [],
            },
          }),
        } as Response;
      }
      if (url === "/api/review/deep-research/research-1/actions" && init?.method === "POST") {
        const payload = {
          success: true,
          data: {
            id: "research-1",
            kind: "deep-research",
            severity: "warn",
            title: "引用缺失",
            detail: "原文引用指向的来源文件不存在。",
            target: "wiki/concepts/example.md",
            createdAt: "2026-04-17T01:00:00.000Z",
            deepResearch: {
              category: "missing-citation",
              scope: "claim",
              pagePath: "wiki/concepts/example.md",
              line: 22,
              factText: "这段结论缺少来源文件支撑。",
              gapText: "Broken citation ^[clip.md] - source file not found",
              triggerReason: "原文引用指向的来源文件不存在。",
              sourceExcerpt: "Broken citation ^[clip.md] - source file not found",
              status: "running",
              progress: 35,
              selectedAction: "add-citation",
              updatedAt: "2026-04-17T01:00:03.000Z",
            },
          },
        };
        return {
          ok: true,
          text: async () => JSON.stringify(payload),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    installClientStyles();
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "research-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        target: "wiki/concepts/example.md",
        createdAt: "2026-04-17T01:00:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在。",
          sourceExcerpt: "Broken citation ^[clip.md] - source file not found",
          status: "pending",
          progress: 0,
          updatedAt: "2026-04-17T01:00:00.000Z",
        },
      },
    ]);

    expect(page.querySelector(".review-card__kind")?.textContent).toContain("Deep Research");
    expect(page.querySelector("[data-review-resolve]")).toBeNull();
    const actions = page.querySelector<HTMLElement>(".review-card__actions");
    expect(actions?.textContent).toContain("忽略");
    expect(actions?.textContent).toContain("补引用");
    expect(actions?.textContent).toContain("对话");
    expect(getComputedStyle(actions!).justifyContent).toBe("flex-end");

    page.querySelector<HTMLButtonElement>("[data-review-action='add-citation'][data-review-id='research-1']")?.click();
    await flush();

    const actionCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === "/api/review/deep-research/research-1/actions" && init?.method === "POST");
    expect(actionCall).toBeTruthy();
    expect(page.querySelector(".review-card__progress")?.textContent).toContain("35%");
  });

  it("opens a scrollable deep-research detail panel without horizontal text overflow", () => {
    installClientStyles();
    const page = renderReviewPage();
    document.body.appendChild(page);
    renderReviewItems(page, [
      {
        id: "research-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        target: "wiki/concepts/example.md",
        createdAt: "2026-04-17T01:00:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑，这一行应该在详情面板里完整换行显示，而不是继续横向超出容器边界。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在，需要补齐可追溯来源。",
          sourceExcerpt: "x error wiki/concepts/example.md:22 Broken citation ^[clip.md] - source file not found",
          status: "running",
          progress: 68,
          selectedAction: "add-citation",
          updatedAt: "2026-04-17T01:00:03.000Z",
          draftResult: {
            mode: "append",
            pagePath: "wiki/concepts/example.md",
            summary: "补引用草案",
            preview: "建议补充稳定来源并回写到该段落。",
            content: "## 补引用草案\n- 这段结论缺少来源文件支撑。",
          },
        },
      },
    ]);

    page.querySelector<HTMLElement>("[data-review-open='research-1']")?.click();

    const panel = page.querySelector<HTMLElement>("[data-review-detail-panel]");
    expect(panel?.textContent).toContain("wiki/concepts/example.md");
    expect(panel?.textContent).toContain("Broken citation");
    expect(panel?.textContent).toContain("68%");
    expect(getComputedStyle(panel!).overflowY).toBe("auto");

    const wrappedValue = page.querySelector<HTMLElement>(".review-detail__value");
    expect(getComputedStyle(wrappedValue!).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(wrappedValue!).wordBreak).toBe("break-word");
  });

  it("navigates to the linked wiki page when clicking the page path in a deep-research card", () => {
    window.location.hash = "#/review";
    const page = renderReviewPage();
    document.body.appendChild(page);
    renderReviewItems(page, [
      {
        id: "research-link-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        target: "wiki/concepts/example.md",
        createdAt: "2026-04-17T01:00:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在。",
          status: "pending",
          progress: 0,
          updatedAt: "2026-04-17T01:00:00.000Z",
        },
      },
    ]);

    page.querySelector<HTMLElement>("[data-review-open-page='wiki/concepts/example.md']")?.click();

    expect(window.location.hash).toBe("#/wiki/wiki%2Fconcepts%2Fexample.md");
    expect(page.querySelector("[data-review-detail-panel]")).toBeNull();
  });

  it("keeps deep-research card titles visible and avoids reserving spacer above the action row", () => {
    installClientStyles();
    const page = renderReviewPage();
    document.body.appendChild(page);
    renderReviewItems(page, [
      {
        id: "research-layout-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        target: "wiki/concepts/oauth-桌面端回调机制.md",
        createdAt: "2026-04-25T04:40:12.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/oauth-桌面端回调机制.md",
          line: 72,
          factText: "第 72 行引用无法追溯到现有来源文件。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在。",
          status: "running",
          progress: 68,
          selectedAction: "add-citation",
          updatedAt: "2026-04-25T04:40:12.000Z",
        },
      },
    ]);

    const title = page.querySelector<HTMLElement>(".review-card__title");
    const actions = page.querySelector<HTMLElement>(".review-card__actions");
    const footer = page.querySelector<HTMLElement>(".review-card__footer");

    expect(getComputedStyle(title!).display).toBe("block");
    expect(getComputedStyle(title!).overflow).toBe("visible");
    expect(getComputedStyle(actions!).marginTop).toBe("0px");
    expect(getComputedStyle(footer!).marginTop).toBe("auto");
  });

  it("formats review details as problem and next-step guidance", () => {
    const page = renderReviewPage();
    renderReviewItems(page, [
      {
        id: "xhs-1",
        kind: "xhs-sync-failure",
        severity: "error",
        title: "XHS sync failed",
        detail: "https://example.com/post\n\n\u9519\u8bef\uff1acookie expired",
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    const detail = page.querySelector(".review-card__detail")?.textContent ?? "";
    expect(detail).toContain("\u95ee\u9898\uff1a");
    expect(detail).toContain("\u4e0b\u4e00\u6b65\u5efa\u8bae\uff1a");
    expect(detail).toContain("cookie expired");
    expect(detail).not.toContain("https://example.com/post");
    expect(page.querySelector("[data-review-problem]")?.getAttribute("title")).toContain("https://example.com/post");
  });

  it("compacts long review details into dense single-line summaries", () => {
    const page = renderReviewPage();
    renderReviewItems(page, [
      {
        id: "xhs-1",
        kind: "xhs-sync-failure",
        severity: "error",
        title: "XHS sync failed",
        detail: "https://example.com/post\n\n\u9519\u8bef\uff1acookie expired\n\u5df2\u4fdd\u5b58\u89c6\u9891\u94fe\u63a5\u3002",
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    const problem = page.querySelector<HTMLElement>("[data-review-problem]");
    expect(problem?.textContent).not.toContain("\n");
    expect(problem?.getAttribute("title")).toContain("\u9519\u8bef\uff1acookie expired");
  });

  it("renders frozen-page cards with explicit slug details and suspicious entries", () => {
    const page = renderReviewPage();
    renderReviewItems(page, [
      {
        id: "state-frozen-slugs",
        kind: "state",
        severity: "warn",
        title: "存在冻结页面",
        detail: "当前有 3 个 frozen slug，需要确认是否仍有来源。",
        createdAt: "2026-04-17T01:00:00.000Z",
        stateInfo: {
          frozenSlugs: ["react", "", "vs"],
          suspiciousFrozenSlugs: ["", "vs"],
        },
      },
    ]);

    expect(page.querySelector("[data-review-frozen-slugs]")?.textContent).toContain("react");
    expect(page.querySelector("[data-review-frozen-slugs]")?.textContent).toContain("空 slug");
    expect(page.querySelector("[data-review-frozen-anomalies]")?.textContent).toContain("vs");
  });

  it("opens a frozen-page detail panel when the state card is clicked", () => {
    installClientStyles();
    const page = renderReviewPage();
    document.body.appendChild(page);
    renderReviewItems(page, [
      {
        id: "state-frozen-slugs",
        kind: "state",
        severity: "warn",
        title: "存在冻结页面",
        detail: "当前有 3 个 frozen slug，需要确认是否仍有来源。",
        createdAt: "2026-04-17T01:00:00.000Z",
        stateInfo: {
          frozenSlugs: ["react", "", "vs"],
          suspiciousFrozenSlugs: ["", "vs"],
        },
      },
    ]);

    page.querySelector<HTMLElement>("[data-review-open='state-frozen-slugs']")?.click();

    const panel = page.querySelector<HTMLElement>("[data-review-detail-panel]");
    expect(panel?.textContent).toContain("冻结页面");
    expect(panel?.textContent).toContain("react");
    expect(panel?.textContent).toContain("空 slug");
    expect(panel?.textContent).toContain("vs");
    expect(panel?.textContent).toContain("异常项");
    expect(getComputedStyle(panel!).overflowY).toBe("auto");
  });

  it("auto-sizes the review page based on viewport height and paginates without clipping card copy", () => {
    vi.stubGlobal("innerHeight", 900);
    const page = renderReviewPage();
    renderReviewItems(
      page,
      Array.from({ length: 12 }, (_, index) => ({
        id: `item-${index + 1}`,
        kind: "xhs-sync-failure" as const,
        severity: "error" as const,
        title: `Item ${index + 1}`,
        detail: `https://example.com/post/${index + 1}\n\n错误：Failure ${index + 1}`,
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: `2026-04-17T01:${String(index).padStart(2, "0")}:00.000Z`,
      })),
    );

    expect(page.querySelector("[data-review-list]")?.getAttribute("data-review-visible-slots")).toBe("3");
    expect(page.querySelector("[data-review-toolbar-pagination]")?.textContent).toContain("\u7b2c 1 / 4 \u9875");
    expect(page.querySelectorAll(".review-card")).toHaveLength(3);
    expect(page.textContent).toContain("Item 1");
    expect(page.textContent).not.toContain("Item 4");
    expect(page.querySelector(".review-card__title")?.textContent).toContain("Item 1");
    expect(page.querySelector("[data-review-problem]")?.textContent).toContain("\u95ee\u9898\uff1a");
    expect(page.querySelector("[data-review-next-step]")?.textContent).toContain("\u4e0b\u4e00\u6b65\u5efa\u8bae\uff1a");

    page.querySelector<HTMLButtonElement>("[data-review-toolbar-pagination] [data-review-next]")?.click();

    const titles = [...page.querySelectorAll(".review-card__title")].map((node) => node.textContent);
    expect(page.querySelectorAll(".review-card")).toHaveLength(3);
    expect(titles).toEqual(["Item 4", "Item 5", "Item 6"]);
  });

  it("locks the full-page review layout to the viewport instead of clipping from a scrolling shell", () => {
    installClientStyles();
    const shell = document.createElement("div");
    shell.id = "workspace-shell";
    shell.setAttribute("data-full-page", "");
    const main = document.createElement("main");
    main.className = "shell-main";
    shell.appendChild(main);
    document.body.appendChild(shell);

    const page = renderReviewPage();
    main.appendChild(page);

    const layout = page.querySelector<HTMLElement>(".review-page__layout");
    const mainColumn = page.querySelector<HTMLElement>(".review-page__main");

    expect(getComputedStyle(main).overflow).toBe("hidden");
    expect(getComputedStyle(layout!).alignItems).toBe("stretch");
    expect(getComputedStyle(mainColumn!).overflow).toBe("hidden");
  });

  it("starts a backend system check run from broken-link review cards", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({ success: true, data: { items: [], state: null } }),
        } as Response;
      }
      if (url === "/api/runs/check" && init?.method === "POST") {
        return new Response(JSON.stringify({
          success: true,
          data: { id: "run-check-1", kind: "check", status: "running" },
        }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [{
      id: "run-check-1",
      kind: "run",
      severity: "error",
      title: "系统检查失败",
      detail: "x error wiki/example.md:1 Broken wikilink [[Missing]] - no matching page found",
      createdAt: "2026-05-03T00:00:00.000Z",
      run: { kind: "check", status: "failed", exitCode: 1 },
    }]);

    page.querySelector<HTMLButtonElement>("[data-run-autofix-check]")?.click();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/check", { method: "POST" });
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/run-check-1/events");

    MockEventSource.instances[0]?.emitStatus("succeeded");
    await flush();

    expect(page.querySelector("[data-review-status]")?.textContent).toContain("系统检查通过");
  });

  it("submits a batch delete request for selected xiaohongshu failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: {
              groups: [],
              pending: [],
            },
          }),
        } as Response;
      }
      if (url === "/api/xhs-sync/failures" && init?.method === "DELETE") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { deleted: ["xhs-1", "xhs-2"], remaining: 0 },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "xhs-1",
        kind: "xhs-sync-failure",
        severity: "error",
        title: "XHS 1",
        detail: "Failure 1",
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
      {
        id: "xhs-2",
        kind: "xhs-sync-failure",
        severity: "error",
        title: "XHS 2",
        detail: "Failure 2",
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: "2026-04-17T01:01:00.000Z",
      },
    ]);

    const checkbox = page.querySelector<HTMLInputElement>("[data-review-select='xhs-1']");
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-review-batch-delete]")?.click();
    await flush();

    const deleteCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/xhs-sync/failures" && init?.method === "DELETE");
    expect(deleteCall).toBeTruthy();
    expect(deleteCall?.[1]).toMatchObject({
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["xhs-1"] }),
    });
  });

  it("surfaces batch delete failures instead of silently doing nothing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: {
              groups: [],
              pending: [],
            },
          }),
        } as Response;
      }
      if (url === "/api/xhs-sync/failures" && init?.method === "DELETE") {
        return {
          ok: false,
          text: async () => JSON.stringify({
            success: false,
            error: "route missing",
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "xhs-1",
        kind: "xhs-sync-failure",
        severity: "error",
        title: "XHS 1",
        detail: "Failure 1",
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: "2026-04-17T01:00:00.000Z",
      },
    ]);

    const checkbox = page.querySelector<HTMLInputElement>("[data-review-select='xhs-1']");
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event("change", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-review-batch-delete]")?.click();
    await flush();

    expect(page.querySelector("[data-review-status]")?.textContent).toContain("\u5220\u9664\u5931\u8d25");
    expect(page.querySelector("[data-review-status]")?.textContent).toContain("route missing");
  });

  it("toggles select-all for the current page only", () => {
    vi.stubGlobal("innerHeight", 900);
    const page = renderReviewPage();
    renderReviewItems(
      page,
      Array.from({ length: 6 }, (_, index) => ({
        id: `xhs-${index + 1}`,
        kind: "xhs-sync-failure" as const,
        severity: "error" as const,
        title: `Item ${index + 1}`,
        detail: `Failure ${index + 1}`,
        target: "raw/\u526a\u85cf/\u5c0f\u7ea2\u4e66",
        createdAt: `2026-04-17T01:${String(index).padStart(2, "0")}:00.000Z`,
      })),
    );

    const toggleButton = page.querySelector<HTMLButtonElement>("[data-review-toggle-page-select]");
    expect(toggleButton?.textContent).toContain("\u5168\u9009\u672c\u9875");

    toggleButton?.click();

    const currentPageCheckboxes = [...page.querySelectorAll<HTMLInputElement>("[data-review-select]")];
    expect(currentPageCheckboxes).toHaveLength(3);
    expect(currentPageCheckboxes.every((checkbox) => checkbox.checked)).toBe(true);
    expect(page.querySelector("[data-review-batch-delete]")?.textContent).toContain("3");
    expect(toggleButton?.textContent).toContain("\u53d6\u6d88\u5168\u9009");

    page.querySelector<HTMLButtonElement>("[data-review-toolbar-pagination] [data-review-next]")?.click();

    const nextPageCheckboxes = [...page.querySelectorAll<HTMLInputElement>("[data-review-select]")];
    expect(nextPageCheckboxes).toHaveLength(3);
    expect(nextPageCheckboxes[0]?.checked).toBe(false);

    page.querySelector<HTMLButtonElement>("[data-review-toolbar-pagination] [data-review-prev]")?.click();
    page.querySelector<HTMLButtonElement>("[data-review-toggle-page-select]")?.click();

    const resetCheckboxes = [...page.querySelectorAll<HTMLInputElement>("[data-review-select]")];
    expect(resetCheckboxes.every((checkbox) => checkbox.checked === false)).toBe(true);
    expect(page.querySelector("[data-review-batch-delete]")?.textContent).toContain("\u6279\u91cf\u5220\u9664");
  });

  it("hides page-selection tools when the loaded page has no deletable review items", () => {
    const page = renderReviewPage();
    renderReviewItems(page, [
      {
        id: "research-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "引用缺失：缓存段落缺少外部来源",
        createdAt: "2026-04-17T01:00:00.000Z",
        target: "wiki/concepts/example.md",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在。",
          status: "done-await-confirm",
          progress: 100,
          updatedAt: "2026-04-17T01:00:00.000Z",
          selectedAction: "add-citation",
          draftResult: {
            mode: "append",
            pagePath: "wiki/concepts/example.md",
            summary: "补引用草案",
            preview: "预览",
            content: "## 补引用草案",
          },
        },
      },
    ]);

    const toggleButton = page.querySelector<HTMLButtonElement>("[data-review-toggle-page-select]");
    const batchDeleteButton = page.querySelector<HTMLButtonElement>("[data-review-batch-delete]");

    expect(toggleButton?.hidden).toBe(true);
    expect(batchDeleteButton?.hidden).toBe(true);
  });

  it("adds a toolbar run-all button that bulk-dispatches deep-research actions across loaded pages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { groups: [], pending: [] },
          }),
        } as Response;
      }
      if (url === "/api/review/deep-research/bulk-advance" && init?.method === "POST") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { started: 2, confirmed: 0, skipped: 2 },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "research-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        target: "wiki/concepts/example-1.md",
        createdAt: "2026-04-17T01:00:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-1.md",
          line: 22,
          factText: "事实 1",
          gapText: "Broken citation",
          triggerReason: "需要补引用。",
          status: "pending",
          progress: 0,
          updatedAt: "2026-04-17T01:00:00.000Z",
        },
      },
      {
        id: "research-2",
        kind: "deep-research",
        severity: "warn",
        title: "需要网络搜索补证的数据空白",
        detail: "需要补证。",
        target: "wiki/concepts/example-2.md",
        createdAt: "2026-04-17T01:01:00.000Z",
        deepResearch: {
          category: "needs-deep-research",
          scope: "claim",
          pagePath: "wiki/concepts/example-2.md",
          line: 10,
          factText: "事实 2",
          gapText: "Low-confidence claim",
          triggerReason: "需要 Deep Research。",
          status: "pending",
          progress: 0,
          updatedAt: "2026-04-17T01:01:00.000Z",
        },
      },
      {
        id: "research-3",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "待确认写入。",
        target: "wiki/concepts/example-3.md",
        createdAt: "2026-04-17T01:02:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-3.md",
          line: 3,
          factText: "事实 3",
          gapText: "Broken citation",
          triggerReason: "待确认。",
          status: "done-await-confirm",
          progress: 100,
          updatedAt: "2026-04-17T01:02:00.000Z",
          selectedAction: "add-citation",
          draftResult: {
            mode: "append",
            pagePath: "wiki/concepts/example-3.md",
            summary: "补引用草案",
            preview: "预览",
            content: "## 补引用草案",
          },
        },
      },
      {
        id: "research-4",
        kind: "deep-research",
        severity: "error",
        title: "引用缺失",
        detail: "失败项。",
        target: "wiki/concepts/example-4.md",
        createdAt: "2026-04-17T01:03:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-4.md",
          line: 4,
          factText: "事实 4",
          gapText: "Broken citation",
          triggerReason: "失败项。",
          status: "failed",
          progress: 0,
          updatedAt: "2026-04-17T01:03:00.000Z",
          errorMessage: "source missing",
        },
      },
    ]);

    const button = page.querySelector<HTMLButtonElement>("[data-review-run-all]");
    expect(button?.textContent).toContain("全部进行");
    expect(page.querySelector("[data-review-confirm-all]")?.textContent).toContain("全部写入");

    button?.click();
    await flush();

    const bulkCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === "/api/review/deep-research/bulk-advance" && init?.method === "POST");
    expect(bulkCall).toBeTruthy();
    expect(page.querySelector("[data-review-status]")?.textContent).toContain("已启动 2 项");
    expect(page.querySelector("[data-review-status]")?.textContent).toContain("跳过 2 项");
  });

  it("adds a toolbar confirm-all button that bulk-confirms visible deep-research drafts", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { groups: [], pending: [] },
          }),
        } as Response;
      }
      if (url === "/api/review/deep-research/bulk-confirm" && init?.method === "POST") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { confirmed: 1, failed: 0, skipped: 1 },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "research-confirm-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "待确认写入。",
        target: "wiki/concepts/example-3.md",
        createdAt: "2026-04-17T01:02:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-3.md",
          line: 3,
          factText: "事实 3",
          gapText: "Broken citation",
          triggerReason: "待确认。",
          status: "done-await-confirm",
          progress: 100,
          updatedAt: "2026-04-17T01:02:00.000Z",
          selectedAction: "add-citation",
          draftResult: {
            mode: "append",
            pagePath: "wiki/concepts/example-3.md",
            summary: "补引用草案",
            preview: "预览",
            content: "## 补引用草案",
          },
        },
      },
      {
        id: "research-failed-1",
        kind: "deep-research",
        severity: "error",
        title: "引用缺失",
        detail: "失败页。",
        target: "wiki/concepts/example-4.md",
        createdAt: "2026-04-17T01:03:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-4.md",
          line: 4,
          factText: "事实 4",
          gapText: "Broken citation",
          triggerReason: "失败页。",
          status: "failed",
          progress: 0,
          updatedAt: "2026-04-17T01:03:00.000Z",
          errorMessage: "source missing",
        },
      },
    ]);

    const button = page.querySelector<HTMLButtonElement>("[data-review-confirm-all]");
    expect(button?.textContent).toContain("全部写入");

    button?.click();
    await flush();

    const bulkCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === "/api/review/deep-research/bulk-confirm" && init?.method === "POST");
    expect(bulkCall).toBeTruthy();
    expect(page.querySelector("[data-review-status]")?.textContent).toContain("已确认写入 1 项");
  });

  it("removes a deep-research card from the queue after single confirm succeeds", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response;
      }
      if (url === "/api/project-log/workspace") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { groups: [], pending: [] },
          }),
        } as Response;
      }
      if (url === "/api/review/deep-research/research-confirm-1/confirm" && init?.method === "POST") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: {
              id: "research-confirm-1",
              kind: "deep-research",
              severity: "info",
              title: "引用缺失",
              detail: "已写入。",
              createdAt: "2026-04-17T01:02:00.000Z",
              target: "wiki/concepts/example-3.md",
              deepResearch: {
                category: "missing-citation",
                scope: "claim",
                pagePath: "wiki/concepts/example-3.md",
                line: 3,
                factText: "事实 3",
                gapText: "Broken citation",
                triggerReason: "待确认。",
                status: "completed",
                progress: 100,
                updatedAt: "2026-04-17T01:04:00.000Z",
              },
            },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "research-confirm-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "待确认写入。",
        target: "wiki/concepts/example-3.md",
        createdAt: "2026-04-17T01:02:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-3.md",
          line: 3,
          factText: "事实 3",
          gapText: "Broken citation",
          triggerReason: "待确认。",
          status: "done-await-confirm",
          progress: 100,
          updatedAt: "2026-04-17T01:02:00.000Z",
          selectedAction: "add-citation",
          draftResult: {
            mode: "append",
            pagePath: "wiki/concepts/example-3.md",
            summary: "补引用草案",
            preview: "预览",
            content: "## 补引用草案",
          },
        },
      },
    ]);

    page.querySelector<HTMLButtonElement>("[data-review-confirm='research-confirm-1']")?.click();
    await flush();

    expect(page.querySelector("[data-review-open='research-confirm-1']")).toBeNull();
    expect(page.querySelector("[data-review-status]")?.textContent).toContain("确认写入完成");
  });

  it("does not hide confirmable deep-research cards while toolbar run-all is still in flight", async () => {
    let resolveBulk: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/review") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { items: [], state: null },
          }),
        } as Response);
      }
      if (url === "/api/project-log/workspace") {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({
            success: true,
            data: { groups: [], pending: [] },
          }),
        } as Response);
      }
      if (url === "/api/review/deep-research/bulk-advance" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveBulk = resolve;
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = renderReviewPage();
    document.body.appendChild(page);
    await flush();
    renderReviewItems(page, [
      {
        id: "research-1",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "原文引用指向的来源文件不存在。",
        target: "wiki/concepts/example-1.md",
        createdAt: "2026-04-17T01:00:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-1.md",
          line: 22,
          factText: "事实 1",
          gapText: "Broken citation",
          triggerReason: "需要补引用。",
          status: "pending",
          progress: 0,
          updatedAt: "2026-04-17T01:00:00.000Z",
        },
      },
      {
        id: "research-2",
        kind: "deep-research",
        severity: "warn",
        title: "引用缺失",
        detail: "待确认写入。",
        target: "wiki/concepts/example-2.md",
        createdAt: "2026-04-17T01:01:00.000Z",
        deepResearch: {
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example-2.md",
          line: 2,
          factText: "事实 2",
          gapText: "Broken citation",
          triggerReason: "待确认。",
          status: "done-await-confirm",
          progress: 100,
          updatedAt: "2026-04-17T01:01:00.000Z",
          selectedAction: "add-citation",
          draftResult: {
            mode: "append",
            pagePath: "wiki/concepts/example-2.md",
            summary: "补引用草案",
            preview: "预览",
            content: "## 补引用草案",
          },
        },
      },
    ]);

    page.querySelector<HTMLButtonElement>("[data-review-run-all]")?.click();

    const firstCard = page.querySelector<HTMLElement>("[data-review-open='research-1']");
    expect(firstCard?.textContent).toContain("执行中");
    expect(firstCard?.textContent).toContain("10%");
    const secondCard = page.querySelector<HTMLElement>("[data-review-open='research-2']");
    expect(secondCard).not.toBeNull();
    expect(secondCard?.textContent).toContain("待确认写入");
    expect(secondCard?.textContent).toContain("确认写入");

    resolveBulk?.({
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        data: { started: 1, confirmed: 1, skipped: 0 },
      }),
    } as Response);
    await flush();
  });
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// fallow-ignore-next-line complexity
function installClientStyles(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const style = document.createElement("style");
  style.textContent = [
    fs.readFileSync(path.join(root, "web", "client", "assets", "styles", "shell.css"), "utf8"),
    fs.readFileSync(path.join(root, "web", "client", "styles.css"), "utf8"),
  ].join("\n");
  document.head.appendChild(style);
}
