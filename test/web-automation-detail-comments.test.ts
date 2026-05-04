// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers workflow detail comment-mode interactions, persistence across rerender,
 * and local failure feedback for Mermaid comment pins.
 */

const mermaidRuntimeMocks = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(async (_renderId: string, source: string) => {
    const showActionNode = source.includes("action[");
    return `
      <svg data-mermaid="true" viewBox="0 0 200 120">
        <g class="node" id="trigger">
          <rect x="10" y="20" width="60" height="24"></rect>
          <text x="40" y="36">每日 09:00 触发</text>
        </g>
        ${showActionNode ? `
          <g class="node" id="action">
            <rect x="110" y="58" width="72" height="24"></rect>
            <text x="146" y="74">同步内容</text>
          </g>
          <g class="edgePath" id="edge-trigger-action">
            <path d="M70,32 L110,70"></path>
          </g>
        ` : ""}
      </svg>
    `;
  }),
}));

vi.mock("../web/client/src/pages/automation/mermaid-runtime.js", () => ({
  renderMermaidSvg: mermaidRuntimeMocks.renderMermaidSvg,
}));

import { renderAutomationWorkspacePage } from "../web/client/src/pages/automation/index.js";

const automationWorkspaceEvents = createEventSourceHarness();

afterEach(() => {
  automationWorkspaceEvents.reset();
  mermaidRuntimeMocks.renderMermaidSvg.mockClear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("automation workspace detail mermaid comments", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", automationWorkspaceEvents.EventSource);
  });

  it("creates a Mermaid comment draft and saves it as a pin", async () => {
    installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flushTwice();
    clickMermaidNode(page, "action");
    await flush();

    const input = page.querySelector<HTMLTextAreaElement>("[data-automation-comment-input]");
    expect(input).not.toBeNull();
    input!.value = "这里要收紧节点间距";
    page.querySelector<HTMLButtonElement>("[data-automation-comment-save]")?.click();
    await flush();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(2);
    expect(page.textContent).toContain("这里要收紧节点间距");
  });

  it("keeps existing pins after detail refresh and comment-mode toggles", async () => {
    installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(1);
    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flush();

    automationWorkspaceEvents.emit("/api/automation-workspace/events", "change", {
      version: 2,
      changedAt: "2026-04-27T12:00:00.000Z",
      files: ["web/client/src/pages/automation/automation-flow.ts"],
    });
    await flushTwice();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(1);
  });

  it("deletes a comment pin and keeps it removed after refresh", async () => {
    installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(1);
    expect(page.textContent).toContain("已有评论");

    page.querySelector<HTMLButtonElement>("[data-automation-comment-delete='comment-1']")?.click();
    await flushTwice();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(0);
    expect(page.textContent).not.toContain("已有评论");

    automationWorkspaceEvents.emit("/api/automation-workspace/events", "change", {
      version: 2,
      changedAt: "2026-04-27T12:05:00.000Z",
      files: ["web/client/src/pages/automation/automation-flow.ts"],
    });
    await flushTwice();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(0);
    expect(page.textContent).not.toContain("已有评论");
  });

  it("shows the human-readable node title in the comment sidebar", async () => {
    installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    const titleButton = page.querySelector<HTMLButtonElement>("[data-automation-comment-select='comment-1']");
    expect(titleButton?.textContent?.trim()).toBe("同步内容");
  });

  it("shows a local error message when saving a comment fails", async () => {
    installCommentFetchMock({ failSave: true });
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flushTwice();
    clickMermaidNode(page, "action");
    await flush();

    const input = page.querySelector<HTMLTextAreaElement>("[data-automation-comment-input]");
    expect(input).not.toBeNull();
    input!.value = "保存失败";
    page.querySelector<HTMLButtonElement>("[data-automation-comment-save]")?.click();
    await flushTwice();

    const error = page.querySelector<HTMLElement>("[data-automation-comment-error]");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain("保存评论失败");
    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(1);
  });

  it("shows a local error message when deleting a comment fails and keeps the pin", async () => {
    installCommentFetchMock({ failDelete: true });
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(1);
    expect(page.textContent).toContain("已有评论");

    page.querySelector<HTMLButtonElement>("[data-automation-comment-delete='comment-1']")?.click();
    await flushTwice();

    const error = page.querySelector<HTMLElement>("[data-automation-comment-error]");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain("删除评论失败");
    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(1);
    expect(page.textContent).toContain("已有评论");

    automationWorkspaceEvents.emit("/api/automation-workspace/events", "change", {
      version: 2,
      changedAt: "2026-04-27T12:06:00.000Z",
      files: ["web/client/src/pages/automation/automation-flow.ts"],
    });
    await flushTwice();

    expect(page.querySelectorAll("[data-automation-comment-pin]").length).toBe(1);
    expect(page.textContent).toContain("已有评论");
  });

  it("renders comments in a right sidebar that can be closed and reopened from comment mode", async () => {
    installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    const body = page.querySelector<HTMLElement>(".automation-detail__body");
    const panel = page.querySelector<HTMLElement>("[data-automation-comment-panel]");
    const resizeHandle = page.querySelector<HTMLElement>("[data-automation-comment-resize]");
    if (!body || !panel || !resizeHandle) {
      throw new Error("comment sidebar not rendered");
    }

    expect(body.dataset.automationCommentPanelOpen).toBe("false");
    expect(body.style.getPropertyValue("--automation-comment-panel-width")).toBe("320px");
    expect(panel.hidden).toBe(true);
    expect(resizeHandle.hidden).toBe(true);

    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flushTwice();

    expect(body.dataset.automationCommentPanelOpen).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(resizeHandle.hidden).toBe(false);

    page.querySelector<HTMLButtonElement>("[data-automation-comment-close]")?.click();
    await flush();

    expect(body.dataset.automationCommentPanelOpen).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(resizeHandle.hidden).toBe(true);

    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flushTwice();
    clickMermaidNode(page, "action");
    await flush();

    expect(body.dataset.automationCommentPanelOpen).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(page.querySelector("[data-automation-comment-input]")).not.toBeNull();
  });

  it("supports dragging the right comment sidebar to change its width", async () => {
    installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    const body = page.querySelector<HTMLElement>(".automation-detail__body");
    const resizeHandle = page.querySelector<HTMLElement>("[data-automation-comment-resize]");
    if (!body || !resizeHandle) {
      throw new Error("comment sidebar resize handle not rendered");
    }

    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flushTwice();

    resizeCommentSidebar(resizeHandle, { startX: 1180, nextX: 1120 });
    expect(body.style.getPropertyValue("--automation-comment-panel-width")).toBe("380px");
  });

  it("sends a PATCH with new coordinates when a pin is dragged", async () => {
    const fetchMock = installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    const pin = page.querySelector<HTMLElement>("[data-automation-comment-pin='comment-1']");
    expect(pin).not.toBeNull();
    pin!.dispatchEvent(createPointerEvent("pointerdown", { bubbles: true, clientX: 146, clientY: 70 }));
    window.dispatchEvent(createPointerEvent("pointermove", { bubbles: true, clientX: 172, clientY: 94 }));
    window.dispatchEvent(createPointerEvent("pointerup", { bubbles: true, clientX: 172, clientY: 94 }));
    await flushTwice();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/automation-workspace/daily-sync/comments/comment-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          manualX: 172,
          manualY: 94,
          pinnedX: 172,
          pinnedY: 94,
        }),
      }),
    );
  });

  it("keeps dragged coordinates across a local rerender using updated comment state", async () => {
    installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    dragCommentPin(page, "comment-1", { startX: 146, startY: 70, nextX: 172, nextY: 94 });
    await flushTwice();

    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flushTwice();

    const pin = page.querySelector<HTMLElement>("[data-automation-comment-pin='comment-1']");
    expect(pin?.style.left).toBe("172px");
    expect(pin?.style.top).toBe("94px");
  });

  it("restores the original coordinates when pin dragging is cancelled", async () => {
    const fetchMock = installCommentFetchMock();
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    const pin = page.querySelector<HTMLElement>("[data-automation-comment-pin='comment-1']");
    expect(pin).not.toBeNull();
    pin!.dispatchEvent(createPointerEvent("pointerdown", { bubbles: true, clientX: 146, clientY: 70 }));
    window.dispatchEvent(createPointerEvent("pointermove", { bubbles: true, clientX: 188, clientY: 104 }));
    window.dispatchEvent(createPointerEvent("pointercancel", { bubbles: true }));
    await flushTwice();

    expect(pin?.style.left).toBe("146px");
    expect(pin?.style.top).toBe("70px");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/automation-workspace/daily-sync/comments/comment-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("restores the original coordinates when drag save fails", async () => {
    installCommentFetchMock({ failPatch: true });
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    dragCommentPin(page, "comment-1", { startX: 146, startY: 70, nextX: 190, nextY: 108 });
    await flushTwice();

    let pin = page.querySelector<HTMLElement>("[data-automation-comment-pin='comment-1']");
    expect(pin?.style.left).toBe("146px");
    expect(pin?.style.top).toBe("70px");

    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    page.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.click();
    await flushTwice();

    pin = page.querySelector<HTMLElement>("[data-automation-comment-pin='comment-1']");
    expect(pin?.style.left).toBe("146px");
    expect(pin?.style.top).toBe("70px");
    expect(page.textContent).toContain("已有评论");
  });

  it("keeps a dragged orphaned pin visible after refresh when its target disappears", async () => {
    installCommentFetchMock({ removeActionTargetAfterRefresh: true });
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flushTwice();

    const pin = page.querySelector<HTMLElement>("[data-automation-comment-pin='comment-1']");
    expect(pin).not.toBeNull();
    pin!.dispatchEvent(createPointerEvent("pointerdown", { bubbles: true, clientX: 146, clientY: 70 }));
    window.dispatchEvent(createPointerEvent("pointermove", { bubbles: true, clientX: 180, clientY: 100 }));
    window.dispatchEvent(createPointerEvent("pointerup", { bubbles: true, clientX: 180, clientY: 100 }));
    await flushTwice();

    automationWorkspaceEvents.emit("/api/automation-workspace/events", "change", {
      version: 3,
      changedAt: "2026-04-27T12:10:00.000Z",
      files: ["web/client/src/pages/automation/automation-flow.ts"],
    });
    await flushTwice();

    const refreshedPin = page.querySelector<HTMLElement>("[data-automation-comment-pin='comment-1']");
    expect(refreshedPin).not.toBeNull();
    expect(refreshedPin?.dataset.orphaned).toBe("true");
    expect(refreshedPin?.style.left).toBe("180px");
    expect(refreshedPin?.style.top).toBe("100px");
  });
});

function installCommentFetchMock(options?: {
  failSave?: boolean;
  failDelete?: boolean;
  failPatch?: boolean;
  removeActionTargetAfterRefresh?: boolean;
}): ReturnType<typeof vi.fn> {
  const detailState = {
    requestCount: 0,
    comments: [buildComment("comment-1", "action", "已有评论")],
  };
  // fallow-ignore-next-line complexity
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/automation-workspace/daily-sync") {
      const actionTitle = detailState.requestCount === 0 ? "同步内容" : "同步内容 v2";
      const includeActionNode = !(options?.removeActionTargetAfterRefresh && detailState.requestCount > 0);
      detailState.requestCount += 1;
      return jsonResponse(buildDailySyncPayload(actionTitle, detailState.comments, includeActionNode));
    }
    if (url === "/api/automation-workspace/daily-sync/comments" && method === "POST") {
      if (options?.failSave) {
        return errorResponse("保存评论失败");
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        targetType: "node" | "edge" | "canvas";
        targetId: string;
        text: string;
        pinnedX: number;
        pinnedY: number;
      };
      const created = buildComment(`comment-${detailState.comments.length + 1}`, body.targetId, body.text, body.targetType, body.pinnedX, body.pinnedY);
      detailState.comments = [...detailState.comments, created];
      return jsonResponse(created);
    }
    if (url.startsWith("/api/automation-workspace/daily-sync/comments/") && method === "PATCH") {
      if (options?.failPatch) {
        return errorResponse("拖拽保存失败");
      }
      const commentId = url.split("/").at(-1) ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Partial<ReturnType<typeof buildComment>>;
      detailState.comments = detailState.comments.map((comment) => {
        if (comment.id !== commentId) {
          return comment;
        }
        return {
          ...comment,
          ...body,
          updatedAt: "2026-04-27T10:05:00.000Z",
        };
      });
      const updated = detailState.comments.find((comment) => comment.id === commentId);
      return jsonResponse(updated ?? null);
    }
    if (url.startsWith("/api/automation-workspace/daily-sync/comments/") && method === "DELETE") {
      if (options?.failDelete) {
        return errorResponse("删除评论失败");
      }
      const commentId = url.split("/").at(-1) ?? "";
      detailState.comments = detailState.comments.filter((comment) => comment.id !== commentId);
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function buildDailySyncPayload(
  actionTitle: string,
  comments: ReturnType<typeof buildComment>[],
  includeActionNode = true,
) {
  const nodes = [
    { id: "trigger", type: "trigger", title: "每日 09:00 触发", description: "按计划触发。", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
  ];
  if (includeActionNode) {
    nodes.push({
      id: "action",
      type: "action",
      title: actionTitle,
      description: "执行应用同步。",
      app: { id: "writer-app", name: "Writer App", workflow: "读取内容\\n整理摘要", prompt: "整理摘要并回写", provider: "openai", model: "gpt-5-writer" },
      effectiveModel: { provider: "openai", model: "gpt-5-writer", source: "app", label: "应用模型 · openai / gpt-5-writer" },
    });
  }
  return {
    automation: {
      id: "daily-sync",
      name: "每日同步",
      summary: "同步昨日新增内容。",
      icon: "calendar",
      enabled: true,
      trigger: "schedule",
      sourceKind: "automation",
      viewMode: "flow",
      flow: {
        nodes,
        edges: [{ id: "edge-trigger-action", source: "trigger", target: "action" }],
        branches: [],
      },
    },
    comments,
    layout: { automationId: "daily-sync", branchOffsets: {} },
  };
}

function buildComment(
  id: string,
  targetId: string,
  text: string,
  targetType: "node" | "edge" | "canvas" = "node",
  pinnedX = 146,
  pinnedY = 70,
) {
  return {
    id,
    automationId: "daily-sync",
    targetType,
    targetId,
    text,
    createdAt: "2026-04-27T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z",
    pinnedX,
    pinnedY,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushTwice(): Promise<void> {
  await flush();
  await flush();
}

function clickMermaidNode(page: HTMLElement, nodeId: string): void {
  page.querySelector<SVGRectElement>(`g.node#${nodeId} rect`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function resizeCommentSidebar(
  handle: HTMLElement,
  coordinates: { startX: number; nextX: number },
): void {
  handle.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true,
    button: 0,
    clientX: coordinates.startX,
  }));
  document.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true,
    clientX: coordinates.nextX,
  }));
  document.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true,
    clientX: coordinates.nextX,
  }));
}

function dragCommentPin(
  page: HTMLElement,
  commentId: string,
  coordinates: { startX: number; startY: number; nextX: number; nextY: number },
): void {
  const pin = page.querySelector<HTMLElement>(`[data-automation-comment-pin='${commentId}']`);
  expect(pin).not.toBeNull();
  pin!.dispatchEvent(createPointerEvent("pointerdown", {
    bubbles: true,
    clientX: coordinates.startX,
    clientY: coordinates.startY,
  }));
  window.dispatchEvent(createPointerEvent("pointermove", {
    bubbles: true,
    clientX: coordinates.nextX,
    clientY: coordinates.nextY,
  }));
  window.dispatchEvent(createPointerEvent("pointerup", {
    bubbles: true,
    clientX: coordinates.nextX,
    clientY: coordinates.nextY,
  }));
}

function createPointerEvent(type: string, init: MouseEventInit): Event {
  const PointerEventConstructor = window.PointerEvent;
  if (typeof PointerEventConstructor === "function") {
    return new PointerEventConstructor(type, init);
  }
  return new MouseEvent(type, init);
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(message: string): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

function createEventSourceHarness(): {
  EventSource: typeof EventSource;
  emit: (url: string, event: string, payload: unknown) => void;
  reset: () => void;
} {
  const instances = new Map<string, Set<{ listeners: Map<string, Array<(event: MessageEvent) => void>>; close: () => void }>>();

  class FakeEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    readonly url: string;
    readonly withCredentials = false;
    readyState = FakeEventSource.OPEN;
    private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

    constructor(url: string | URL) {
      this.url = String(url);
      const group = instances.get(this.url) ?? new Set();
      group.add(this);
      instances.set(this.url, group);
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      const callback = typeof listener === "function"
        ? listener as (event: MessageEvent) => void
        : ((event: MessageEvent) => listener.handleEvent(event));
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      const callback = typeof listener === "function"
        ? listener as (event: MessageEvent) => void
        : ((event: MessageEvent) => listener.handleEvent(event));
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== callback));
    }

    close(): void {
      this.readyState = FakeEventSource.CLOSED;
      instances.get(this.url)?.delete(this);
    }

    dispatch(type: string, payload: unknown): void {
      const event = new MessageEvent(type, { data: JSON.stringify(payload) });
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  return {
    EventSource: FakeEventSource as unknown as typeof EventSource,
    emit(url, event, payload) {
      for (const instance of instances.get(url) ?? []) {
        instance.dispatch(event, payload);
      }
    },
    reset() {
      instances.clear();
    },
  };
}
