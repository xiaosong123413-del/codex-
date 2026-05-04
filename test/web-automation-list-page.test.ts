// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderAutomationLogPage,
  renderAutomationWorkspacePage,
} from "../web/client/src/pages/automation/index.js";

const automationWorkspaceEvents = createEventSourceHarness();

afterEach(() => {
  automationWorkspaceEvents.reset();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("automation workspace list and logs", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", automationWorkspaceEvents.EventSource);
    const listPayloads = [
      {
        success: true,
        data: {
          automations: [
            { id: "daily-sync", name: "每日同步", summary: "同步昨日新增内容。", icon: "calendar", enabled: true, trigger: "schedule", sourceKind: "automation" },
            { id: "publish-hook", name: "发布回调", summary: "收到发布回调后执行。", icon: "rocket", enabled: false, trigger: "webhook", sourceKind: "automation" },
            { id: "code-flow-information-transfer", name: "信息流转流程", summary: "追踪输入信息流转。", icon: "git-branch", enabled: true, trigger: "message", sourceKind: "information" },
            { id: "code-flow-sync-entry", name: "同步入口", summary: "真实同步入口分支。", icon: "rocket", enabled: true, trigger: "message", sourceKind: "code" },
            { id: "code-flow-compile-chain", name: "编译链路", summary: "真实编译链路。", icon: "cpu", enabled: true, trigger: "message", sourceKind: "code" },
          ],
        },
      },
      {
        success: true,
        data: {
          automations: [
            { id: "daily-sync", name: "每日同步 v2", summary: "同步昨日新增内容。", icon: "calendar", enabled: true, trigger: "schedule", sourceKind: "automation" },
            { id: "publish-hook", name: "发布回调", summary: "收到发布回调后执行。", icon: "rocket", enabled: false, trigger: "webhook", sourceKind: "automation" },
            { id: "code-flow-information-transfer", name: "信息流转流程", summary: "追踪输入信息流转。", icon: "git-branch", enabled: true, trigger: "message", sourceKind: "information" },
            { id: "code-flow-sync-entry", name: "同步入口", summary: "真实同步入口分支。", icon: "rocket", enabled: true, trigger: "message", sourceKind: "code" },
            { id: "code-flow-compile-chain", name: "编译链路", summary: "真实编译链路。", icon: "cpu", enabled: true, trigger: "message", sourceKind: "code" },
          ],
        },
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/automation-workspace") {
        return jsonResponse(listPayloads.shift() ?? listPayloads.at(-1));
      }
      if (url === "/api/automation-workspace/daily-sync/logs") {
        return jsonResponse({
          success: true,
          data: {
            logs: [
              {
                id: "log-1",
                status: "success",
                summary: "同步完成",
                startedAt: "2026-04-25T09:00:00.000Z",
                endedAt: "2026-04-25T09:01:00.000Z",
              },
            ],
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
  });

  it("renders the list view, searches, and navigates to detail and logs", async () => {
    const page = renderAutomationWorkspacePage();
    document.body.appendChild(page);
    await flush();

    expect(page.querySelector(".automation-page")).not.toBeNull();
    expect(page.getAttribute("data-automation-scroll")).toBe("");
    expect(page.textContent).toContain("Workflow");
    expect(page.textContent).toContain("应用流程");
    expect(page.textContent).toContain("信息流转流程");
    expect(page.textContent).toContain("源码真实流程");
    expect(page.textContent).toContain("每日同步");
    expect(page.textContent).toContain("发布回调");
    expect(page.textContent).toContain("追踪输入信息流转。");
    expect(page.textContent).toContain("同步入口");
    expect(page.textContent).toContain("编译链路");
    expect(page.querySelector("[data-automation-filter]")).toBeNull();
    expect(page.textContent).not.toContain("全部 Workflow");

    const search = page.querySelector<HTMLInputElement>("[data-automation-search]");
    expect(search).not.toBeNull();
    search!.value = "每日";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(page.textContent).toContain("每日同步");
    expect(page.textContent).not.toContain("发布回调");

    page.querySelector<HTMLButtonElement>("[data-automation-open='daily-sync']")?.click();
    expect(window.location.hash).toBe("#/automation/daily-sync");

    page.querySelector<HTMLButtonElement>("[data-automation-log='daily-sync']")?.click();
    expect(window.location.hash).toBe("#/automation-log/daily-sync");
  });

  it("renders the log page for a single automation", async () => {
    const page = renderAutomationLogPage("daily-sync");
    document.body.appendChild(page);
    await flush();

    expect(page.getAttribute("data-automation-scroll")).toBe("");
    expect(page.querySelector(".automation-log-page")).not.toBeNull();
    expect(page.textContent).toContain("运行日志");
    expect(page.textContent).toContain("同步完成");
  });

  it("refreshes the list when automation workspace change events arrive", async () => {
    const page = renderAutomationWorkspacePage();
    document.body.appendChild(page);
    await flush();

    expect(page.textContent).toContain("每日同步");
    expect(page.textContent).not.toContain("每日同步 v2");

    automationWorkspaceEvents.emit("/api/automation-workspace/events", "change", {
      version: 2,
      changedAt: "2026-04-25T10:00:00.000Z",
      files: ["web/client/src/pages/runs/automation-flow.ts"],
    });
    await flush();
    await flush();

    expect(page.textContent).toContain("每日同步 v2");
  });
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
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
