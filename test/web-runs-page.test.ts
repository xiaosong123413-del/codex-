// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderRunPage } from "../web/client/src/pages/runs/index.js";

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

  emitLine(text: string): void {
    this.emit("line", new MessageEvent("line", { data: JSON.stringify({
      line: { at: new Date("2026-05-03T00:00:01.000Z").toISOString(), source: "stdout", text },
    }) }));
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners[type] ?? []) {
      if (typeof listener === "function") {
        listener.call(this as unknown as EventTarget, event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  MockEventSource.instances = [];
});

describe("renderRunPage", () => {
  it("renders the system check page with a start button and log view", () => {
    const page = renderRunPage("check");

    expect(page.querySelector(".run-page__title")?.textContent).toContain("\u7cfb\u7edf\u68c0\u67e5");
    expect(page.querySelector<HTMLButtonElement>("[data-run-start]")?.textContent).toContain("\u5f00\u59cb");
    expect(page.querySelector("[data-run-log]")).toBeTruthy();
  });

  it("renders the sync page with sync-specific copy", () => {
    const page = renderRunPage("sync");

    expect(page.querySelector(".run-page__title")?.textContent).toContain("\u540c\u6b65\u7f16\u8bd1");
    expect(page.querySelector(".run-page__copy")?.textContent).toContain("\u540c\u6b65\u6e90\u6587\u4ef6\u5939");
  });

  it("shows a bottom progress bar when a check run starts", async () => {
    const page = renderRunPage("check");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        id: "run-1",
        kind: "check",
        status: "running",
        startedAt: new Date("2026-05-03T00:00:00.000Z").toISOString(),
        lines: [],
      },
    })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-run-start]")?.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const progress = document.querySelector<HTMLElement>("[data-run-progress-key='check']");
    expect(progress?.textContent).toContain("\u7cfb\u7edf\u68c0\u67e5\u8fd0\u884c\u4e2d");
    expect(progress?.textContent).toContain("8%");
    expect(progress?.querySelector(".run-progress-toast__bar")).toBeTruthy();
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/run-1/events");

    MockEventSource.instances[0]?.emitLine("进度 27%：正在读取 wiki 文件");

    expect(progress?.textContent).toContain("27%");
    expect(progress?.textContent).toContain("正在读取 wiki 文件");
  });
});
