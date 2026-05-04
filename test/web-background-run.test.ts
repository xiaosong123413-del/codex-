// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmBackgroundSync,
  startBackgroundRun,
} from "../web/client/src/background-run.js";

type MockRunKind = "check" | "sync";
type MockRunStatus = "running" | "succeeded" | "failed" | "stopped";

interface MockRunSnapshot {
  id: string;
  kind: MockRunKind;
  status: MockRunStatus;
}

interface MockRunLine {
  text: string;
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;

  onerror: ((event: Event) => void) | null = null;

  private readonly listeners: Record<string, EventListenerOrEventListenerObject[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  close(): void {}

  emitLine(line: MockRunLine): void {
    this.emit("line", new MessageEvent("line", { data: JSON.stringify({ line }) }));
  }

  emitStatus(run: MockRunSnapshot): void {
    this.emit("status", new MessageEvent("status", { data: JSON.stringify({ run }) }));
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
  document.body.innerHTML = "";
  MockEventSource.instances = [];
});

describe("background run helpers", () => {
  it("starts a check run and reports success toasts", async () => {
    const showToast = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: "run-1", kind: "check", status: "running" },
      }),
    }));

    await startBackgroundRun("check", document.body, showToast, {
      eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/runs/check", { method: "POST" });
    expect(showToast).toHaveBeenNthCalledWith(1, "正在启动系统检查...");
    expect(showToast).toHaveBeenNthCalledWith(2, "系统检查已在后台运行，结果会进入运行日志和审查。");
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/run-1/events");
    expect(document.querySelector<HTMLElement>("[data-run-progress-key='check']")?.dataset.state).toBe("running");
    expect(document.querySelector("[data-run-progress-key='check']")?.textContent).toContain("系统检查运行中");
    expect(document.querySelector("[data-run-progress-key='check']")?.textContent).toContain("8%");

    MockEventSource.instances[0]?.emitLine({ text: "进度 42%：正在检查 wiki 链接" });

    expect(document.querySelector("[data-run-progress-key='check']")?.textContent).toContain("42%");
    expect(document.querySelector("[data-run-progress-key='check']")?.textContent).toContain("正在检查 wiki 链接");

    MockEventSource.instances[0]?.emitStatus({ id: "run-1", kind: "check", status: "succeeded" });

    expect(document.querySelector<HTMLElement>("[data-run-progress-key='check']")?.dataset.state).toBe("complete");
    expect(document.querySelector("[data-run-progress-key='check']")?.textContent).toContain("系统检查已完成");
    expect(document.querySelector("[data-run-progress-key='check']")?.textContent).toContain("100%");
  });

  it("does not start sync when the confirmation step declines", async () => {
    const showToast = vi.fn();
    const confirmSync = vi.fn(async () => false);
    const fetchImpl = vi.fn();

    await startBackgroundRun("sync", document.body, showToast, {
      confirmSync,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(confirmSync).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(document.querySelector("[data-run-progress-key='sync']")?.textContent).toContain("未启动同步编译");
  });

  it("reports start failures as error toasts", async () => {
    const showToast = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ success: false, error: "backend down" }),
    }));

    await startBackgroundRun("sync", document.body, showToast, {
      confirmSync: async () => true,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(showToast).toHaveBeenNthCalledWith(1, "正在启动同步编译...");
    expect(showToast).toHaveBeenNthCalledWith(2, "启动失败：backend down", "error");
    expect(document.querySelector("[data-run-progress-key='sync']")?.textContent).toContain("启动失败：backend down");
  });

  it("stops sync when no new intake items are found", async () => {
    const showToast = vi.fn();
    const loadScan = vi.fn(async () => ({ items: [], plan: [] }));
    const showDialog = vi.fn();

    await expect(confirmBackgroundSync(document.body, showToast, {
      loadScan: loadScan as never,
      showDialog: showDialog as never,
    })).resolves.toBe(false);

    expect(showToast).toHaveBeenCalledWith("未检测到新源料");
    expect(showDialog).not.toHaveBeenCalled();
  });

  it("reports intake scan errors", async () => {
    const showToast = vi.fn();

    await expect(confirmBackgroundSync(document.body, showToast, {
      loadScan: async () => {
        throw new Error("scan failed");
      },
    })).resolves.toBe(false);

    expect(showToast).toHaveBeenCalledWith("新源料检测失败：scan failed", "error");
  });
});
