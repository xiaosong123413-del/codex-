// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMainSlot } from "../web/client/src/shell/main-slot.js";

describe("createMainSlot", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="workspace-shell">
        <main id="main-slot">
          <section id="legacy-chat"></section>
        </main>
        <aside id="browser-slot"></aside>
      </section>
    `;
    vi.stubGlobal("EventSource", createSilentEventSourceStub());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/remote-brain/status")) {
          return jsonResponse(makeRemoteBrainStatusPayload());
        }
        if (url.includes("/api/tree?layer=wiki")) {
          return jsonResponse(makeWikiTreePayload());
        }
        if (url.includes("/api/page?path=wiki%2Findex.md")) {
          return jsonResponse(makeWikiPagePayload());
        }
        if (url.includes("/api/source-gallery")) {
          return jsonResponse(makeSourceGalleryPayload());
        }
        if (url.includes("/api/automation-workspace/code-flow-sync-entry")) {
          return jsonResponse(makeAutomationDetailPayload());
        }
        if (url.includes("/api/automation-workspace")) {
          return jsonResponse(makeAutomationListPayload());
        }
        if (url.includes("/api/project-log")) {
          return jsonResponse(makeProjectLogPayload());
        }
        return jsonResponse({ success: true, data: {} });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the legacy chat visible on #/chat", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "chat", params: {} });

    expect(legacyChatNode.hidden).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(legacyChatNode);
    expect(legacyBrowser.hidden).toBe(false);
    expect(shell.hasAttribute("data-browser-hidden")).toBe(false);
    expect(container.querySelector(".shell-placeholder")).toBeNull();
  });

  it("shows the settings page and hides the browser in settings", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "settings", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("settings");
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector(".settings-page__title")?.textContent).toContain("\u8bbe\u7f6e");
  });

  it("shows review as a full page without the file browser or chat layout", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "review", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("review");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector(".review-board")).toBeTruthy();
  });

  it("shows wiki as a full page without the file browser or chat layout", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "wiki", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("wiki");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector("[data-wiki-home]")).toBeTruthy();
    expect(container.textContent).toContain("欢迎来到 Peiweipedia");
  });

  it("shows Graphy as a full page with a return button", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "graph", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("graph");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector(".graphy-page")).toBeTruthy();
    expect(container.querySelector("[data-graphy-back]")?.textContent).toContain("返回");
  });

  it("shows sources as a full page without the file browser or chat layout", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "sources", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("sources");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector(".source-gallery-page__filters")).toBeTruthy();
    expect(container.querySelector(".source-gallery-page h1")).toBeNull();
    expect(container.textContent).toContain("\u641c\u7d22");
  });

  it("shows flash diary as a full page without the file browser or chat layout", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "flash-diary", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("flash-diary");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector(".flash-diary-page__editor")).toBeTruthy();
  });

  it("shows project log as a full page without the file browser or chat layout", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "project-log", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("project-log");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector('[data-settings-nav="project-log"]')?.getAttribute("data-active")).toBe("true");
    expect(container.querySelector(".project-log-page__title")?.textContent).toContain("\u9879\u76ee\u65e5\u5fd7");
  });

  it("shows workflow detail as a full page without the settings sidebar", async () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "automation", params: { id: "code-flow-sync-entry" } });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(legacyChatNode.hidden).toBe(true);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("automation");
    expect(container.querySelector(".automation-detail__header")).toBeTruthy();
    expect(container.querySelector(".settings-sidebar")).toBeNull();
  });

  it("shows workspace as a full page without the file browser or chat layout", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "workspace", params: {} });

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("workspace");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector("[data-workspace-sidebar]")).toBeTruthy();
    expect(container.querySelector("[data-workspace-sidebar-toggle]")).toBeNull();
    expect(container.querySelector(".workspace-page__sidebar-nav > :first-child")?.getAttribute("data-workspace-tab")).toBe("task-plan");
    expect(container.querySelector("[data-workspace-tab='task-plan']")?.getAttribute("data-active")).toBe("true");
    expect(container.querySelector("[data-workspace-tab='project-progress']")).toBeNull();
  });

  it("opens app settings directly when the route targets app-config", async () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "settings", params: { section: "app-config" } });
    await flushMicrotasks();

    expect(legacyChatNode.hidden).toBe(true);
    expect(container.contains(legacyChatNode)).toBe(false);
    expect(container.children).toHaveLength(1);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("settings");
    expect(shell.hasAttribute("data-browser-hidden")).toBe(true);
    expect(shell.hasAttribute("data-full-page")).toBe(true);
    expect(container.querySelector("[data-settings-panel=\"app-config\"]")?.hasAttribute("hidden")).toBe(false);
  });

  it("opens the user guide inside settings when the route targets user-guide", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const shell = document.getElementById("workspace-shell") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "settings", params: { section: "user-guide" }, anchor: "settings-layout" });

    expect(legacyChatNode.hidden).toBe(true);
    expect(legacyBrowser.hidden).toBe(true);
    expect(shell.getAttribute("data-route")).toBe("settings");
    expect(container.querySelector("[data-settings-panel=\"user-guide\"]")?.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector('[data-settings-nav="user-guide"]')?.getAttribute("data-active")).toBe("true");
    expect(container.querySelector(".user-guide-page h1")?.textContent).toContain("\u4f7f\u7528\u8bf4\u660e");
  });

  it("restores the chat node after leaving a full page", () => {
    const container = document.getElementById("main-slot") as HTMLElement;
    const legacyChatNode = document.getElementById("legacy-chat") as HTMLElement;
    const legacyBrowser = document.getElementById("browser-slot") as HTMLElement;
    const slot = createMainSlot({ container, legacyChatNode, legacyBrowser });

    slot.render({ name: "review", params: {} });
    slot.render({ name: "chat", params: {} });

    expect(container.contains(legacyChatNode)).toBe(true);
    expect(legacyChatNode.hidden).toBe(false);
    expect(container.querySelector(".review-page")).toBeNull();
  });
});

function makeStatusPayload() {
  return makeRemoteBrainStatusPayload();
}

function makeRemoteBrainStatusPayload() {
  return {
    success: true,
    data: {
      provider: "cloudflare",
      mode: "cloudflare-unconfigured",
      connected: false,
      endpoint: null,
      pushSupported: true,
      pullSupported: true,
      publishSupported: true,
      cloudflare: {
        provider: "cloudflare",
        enabled: false,
        workerUrl: null,
        accountId: null,
        d1DatabaseId: null,
        r2Bucket: null,
        vectorizeIndex: null,
        tokenConfigured: false,
      },
      flashDiarySync: {
        mode: "local",
        lastSyncedAt: null,
        queueSize: 0,
      },
    },
  };
}

function makeWikiTreePayload() {
  return {
    name: "root",
    path: "root",
    kind: "dir",
    children: [
      {
        name: "wiki",
        path: "wiki",
        kind: "dir",
        children: [
          {
            name: "index.md",
            path: "wiki/index.md",
            kind: "file",
          },
        ],
      },
    ],
  };
}

function makeWikiPagePayload() {
  return {
    path: "wiki/index.md",
    title: "Wiki",
    html: "<h1>Wiki</h1>",
    raw: "# Wiki",
    frontmatter: null,
    aliases: [],
    sizeBytes: 8,
    modifiedAt: new Date().toISOString(),
  };
}

function makeSourceGalleryPayload() {
  return {
    success: true,
    data: {
      items: [
        {
          id: "source-1",
          path: "raw/demo.md",
          title: "Demo Source",
          layer: "raw",
          bucket: "raw",
          tags: ["demo"],
          modifiedAt: new Date().toISOString(),
          excerpt: "Demo excerpt",
        },
      ],
    },
  };
}

function makeProjectLogPayload() {
  return {
    success: true,
    data: {
      path: "docs/project-log.md",
      html: "<h1>Project log</h1>",
      raw: "# Project log",
      modifiedAt: new Date().toISOString(),
    },
  };
}

function makeAutomationListPayload() {
  return {
    success: true,
    data: {
      automations: [
        {
          id: "code-flow-sync-entry",
          name: "同步入口",
          summary: "真实同步入口分支。",
          icon: "rocket",
          enabled: true,
          trigger: "message",
          sourceKind: "code",
        },
      ],
    },
  };
}

function makeAutomationDetailPayload() {
  return {
    success: true,
    data: {
      automation: {
        id: "code-flow-sync-entry",
        name: "同步入口",
        summary: "真实同步入口分支。",
        icon: "rocket",
        enabled: true,
        trigger: "message",
        sourceKind: "code",
        viewMode: "flow",
        flow: {
          nodes: [
            {
              id: "trigger-sync",
              type: "trigger",
              title: "点击同步按钮",
              description: "源码入口",
              implementation: "bindRunPage() startButton.click",
              effectiveModel: { provider: "", model: "", source: "none", label: "" },
            },
            {
              id: "sync-run",
              type: "action",
              title: "启动同步",
              description: "POST /api/runs/sync",
              implementation: "startRun('sync')",
              effectiveModel: { provider: "", model: "", source: "none", label: "" },
            },
          ],
          edges: [{ id: "edge-trigger-sync", source: "trigger-sync", target: "sync-run" }],
          branches: [],
        },
        comments: [],
        layout: { automationId: "code-flow-sync-entry", branchOffsets: {} },
      },
      comments: [],
      layout: { automationId: "code-flow-sync-entry", branchOffsets: {} },
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createSilentEventSourceStub(): typeof EventSource {
  class SilentEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    readonly url: string;
    readonly withCredentials = false;
    readyState = SilentEventSource.OPEN;

    constructor(url: string | URL) {
      this.url = String(url);
    }

    addEventListener(): void {}

    removeEventListener(): void {}

    close(): void {
      this.readyState = SilentEventSource.CLOSED;
    }
  }

  return SilentEventSource as unknown as typeof EventSource;
}
