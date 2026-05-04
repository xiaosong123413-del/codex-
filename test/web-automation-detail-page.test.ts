// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const mermaidRuntimeMocks = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(async (_id: string, source: string) => (
    source.includes("A1 执行记录器输入")
      ? `
        <svg data-mermaid="true" viewBox="0 0 360 420">
          <g class="node" id="A1"><rect x="120" y="20" width="120" height="32"></rect></g>
          <g class="node" id="B1"><rect x="120" y="76" width="120" height="32"></rect></g>
          <g class="node" id="C1"><rect x="120" y="132" width="120" height="32"></rect></g>
          <g class="node" id="D1"><rect x="120" y="188" width="120" height="32"></rect></g>
          <g class="node" id="E1"><polygon points="180,244 230,276 180,308 130,276"></polygon></g>
        </svg>
      `
      : source.includes("saveTrigger{{\"触发：用户保存闪念日记\"}}")
      ? `
        <svg data-mermaid="true" viewBox="0 0 320 220">
          <g class="node" id="saveTrigger">
            <polygon points="20,30 44,12 112,12 136,30 112,48 44,48"></polygon>
            <text x="78" y="32">触发：用户保存闪念日记</text>
          </g>
          <g class="node" id="memoryFile">
            <rect x="160" y="88" width="110" height="44"></rect>
            <text x="215" y="102">结果：Memory 文件</text>
            <text x="215" y="120">wiki/journal-memory.md</text>
          </g>
          <g class="edgePath" id="edge-save-memory">
            <path d="M136,30 L160,110"></path>
          </g>
        </svg>
      `
      : `
        <svg data-mermaid="true" viewBox="0 0 200 120">
          <g class="node" id="trigger">
            <rect x="10" y="20" width="60" height="24"></rect>
          </g>
          <g class="node" id="action">
            <rect x="110" y="58" width="72" height="24"></rect>
          </g>
          <g class="edgePath" id="edge-trigger-action">
            <path d="M70,32 L110,70"></path>
          </g>
        </svg>
      `
  )),
}));

vi.mock("../web/client/src/pages/automation/mermaid-runtime.js", () => ({
  renderMermaidSvg: mermaidRuntimeMocks.renderMermaidSvg,
}));

import { renderAutomationWorkspacePage } from "../web/client/src/pages/automation/index.js";

const automationWorkspaceEvents = createEventSourceHarness();
const root = path.resolve(import.meta.dirname, "..");

afterEach(() => {
  automationWorkspaceEvents.reset();
  mermaidRuntimeMocks.renderMermaidSvg.mockClear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("automation workspace detail mermaid view", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", automationWorkspaceEvents.EventSource);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/automation-workspace/daily-sync") {
        return jsonResponse(buildDailySyncPayload(
          mermaidRuntimeMocks.renderMermaidSvg.mock.calls.length === 0 ? "同步内容" : "同步内容 v2",
        ));
      }
      if (url === "/api/automation-workspace/code-flow-sync-entry") {
        return jsonResponse(buildCodeFlowPayload());
      }
      if (url === "/api/automation-workspace/code-flow-flash-diary-page") {
        return jsonResponse(buildFlashDiarySourceInsightPayload());
      }
      if (url === "/api/automation-workspace/code-flow-workflow-recorder") {
        return jsonResponse(buildWorkflowRecorderSpecPayload());
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
  });

  it("renders configured automation details as a Mermaid diagram", async () => {
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flush();
    await flush();

    expect(page.getAttribute("data-automation-scroll")).toBe("");
    expect(page.classList.contains("automation-route--detail")).toBe(true);
    expect(page.querySelector("[data-automation-mermaid-diagram]")).not.toBeNull();
    expect(page.querySelector("[data-automation-mermaid-viewport]")).not.toBeNull();
    expect(page.querySelector("[data-automation-mermaid-surface]")).not.toBeNull();
    expect(page.querySelector("[data-automation-comment-pins]")).not.toBeNull();
    expect(page.querySelector("[data-automation-comment-toggle]")?.textContent).toBe("评论");
    expect(page.querySelector(".automation-detail__mermaid-zoom-controls")).not.toBeNull();
    expect(page.querySelector("[data-automation-zoom=\"in\"]")).not.toBeNull();
    expect(page.querySelector("[data-automation-zoom=\"out\"]")).not.toBeNull();
    expect(page.querySelector("[data-automation-zoom=\"fit\"]")).not.toBeNull();
    expect(page.querySelector("[data-automation-edge-svg]")).toBeNull();
    expect(page.querySelector("[data-automation-canvas-scroll]")).toBeNull();
    expect(mermaidRuntimeMocks.renderMermaidSvg).toHaveBeenCalledTimes(1);
    const source = String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls[0]?.[1] ?? "");
    expect(source).toContain("flowchart TD");
    expect(source).not.toContain("subgraph apiConsumption");
    expect(source).not.toContain("apiConsumption_");
    expect(source).not.toContain("classDef apiConsumerNode");
    expect(source).not.toContain("用户触发");
    expect(source).toContain("trigger[\"每日 09:00 触发<br/>按计划触发。\"]");
    expect(source).toContain("action[\"同步内容<br/>执行应用同步。\"]");
    expect(source).not.toContain("标准：");
    expect(source).toContain("trigger --> action");
    expect(page.querySelectorAll("[data-automation-standard-node]")).toHaveLength(0);
    expect(page.querySelector("[data-automation-standard-popover]")).toBeNull();
  });

  it("keeps workflow details on one page while the Mermaid viewport scrolls internally", async () => {
    const stylesheet = await readFile(path.join(root, "web", "client", "styles.css"), "utf8");

    expect(stylesheet).toMatch(/\.automation-route--detail\s*\{[\s\S]*overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.settings-page\[data-settings-active-section="automation"\] \.settings-content\s*\{[\s\S]*overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.automation-page--detail\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.automation-detail__body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(stylesheet).toMatch(/\.automation-detail__body\[data-automation-comment-panel-open="true"\]\s*\{[\s\S]*var\(--automation-comment-panel-width,\s*320px\)/);
    expect(stylesheet).toContain(".automation-detail__body[data-automation-spec-panel=\"true\"]");
    expect(stylesheet).toContain("grid-template-columns: minmax(0, 1fr) 0 minmax(360px, 420px);");
    expect(stylesheet).toContain("grid-template-columns: minmax(0, 1.15fr) 0 minmax(380px, 0.85fr);");
    expect(stylesheet).toMatch(/\.automation-detail__body\[data-automation-spec-panel="true"\]\s*>\s*\.automation-detail__comment-panel\s*\{[\s\S]*width:\s*100%;/);
    expect(stylesheet).not.toContain("width: min(430px, calc(100vw - 96px));");
    expect(stylesheet).toMatch(/\.automation-detail__mermaid-diagram\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.automation-detail__mermaid-viewport\s*\{[\s\S]*overflow:\s*auto;/);
    expect(stylesheet).toMatch(/\.automation-detail__page-hotspot-diagram\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
    expect(stylesheet).toMatch(/\.automation-detail__page-hotspot-viewport\s*\{[\s\S]*overflow:\s*auto;/);
    expect(stylesheet).toMatch(/\.automation-detail__page-hotspot-surface\s*\{[\s\S]*transform-origin:\s*top left;/);
  });

  it("supports zoom controls and ctrl-wheel zoom inside the workflow canvas", async () => {
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flush();
    await flush();

    const viewport = page.querySelector<HTMLElement>("[data-automation-mermaid-viewport]");
    const surface = page.querySelector<HTMLElement>("[data-automation-mermaid-surface]");
    const zoomIn = page.querySelector<HTMLButtonElement>("[data-automation-zoom=\"in\"]");
    const zoomFit = page.querySelector<HTMLButtonElement>("[data-automation-zoom=\"fit\"]");
    const zoomLabel = page.querySelector<HTMLElement>("[data-automation-zoom-label]");
    if (!viewport || !surface || !zoomIn || !zoomFit || !zoomLabel) {
      throw new Error("workflow zoom controls not rendered");
    }

    expect(surface.style.transform).toContain("scale(");
    const initialTransform = surface.style.transform;

    zoomIn.click();
    expect(surface.style.transform).not.toBe(initialTransform);
    expect(zoomLabel.textContent).not.toBe("100%");

    viewport.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -120,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 96,
    }));
    expect(surface.style.transform).not.toBe(initialTransform);

    zoomFit.click();
    expect(zoomLabel.textContent).toMatch(/%$/);
  });

  it("supports dragging the workflow viewport to move the current view", async () => {
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flush();
    await flush();

    const viewport = page.querySelector<HTMLElement>("[data-automation-mermaid-viewport]");
    if (!viewport) {
      throw new Error("workflow viewport not rendered");
    }

    viewport.scrollLeft = 40;
    viewport.scrollTop = 24;
    viewport.dispatchEvent(createPointerEvent("pointerdown", { pointerId: 7, clientX: 220, clientY: 140 }));
    window.dispatchEvent(createPointerEvent("pointermove", { pointerId: 7, clientX: 180, clientY: 100 }));
    window.dispatchEvent(createPointerEvent("pointerup", { pointerId: 7, clientX: 180, clientY: 100 }));

    expect(viewport.scrollLeft).toBe(80);
    expect(viewport.scrollTop).toBe(64);
    expect(viewport.dataset.dragging).toBeUndefined();
  });

  it("re-centers the workflow diagram after the viewport width becomes available", async () => {
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flush();
    await flush();

    const viewport = page.querySelector<HTMLElement>("[data-automation-mermaid-viewport]");
    const surface = page.querySelector<HTMLElement>("[data-automation-mermaid-surface]");
    if (!viewport || !surface) {
      throw new Error("workflow surface not rendered");
    }

    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 640 });
    await waitForLayoutWarmup();

    expect(surface.style.left).toBe("280px");
  });

  it("renders code-derived automation details as a Mermaid diagram", async () => {
    const page = renderAutomationWorkspacePage("code-flow-sync-entry");
    document.body.appendChild(page);
    await flush();
    await flush();

    expect(page.textContent).toContain("源码真实流程");
    expect(page.querySelector("[data-automation-mermaid-diagram]")).not.toBeNull();
    const source = String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls.at(-1)?.[1] ?? "");
    expect(source).toContain("branch-sync{\"是否检测到待处理项");
    expect(source).toContain("sync-run[\"POST /api/runs/sync 并订阅事件");
    expect(source).toContain("attachRunStream(await startRun('sync'))");
    expect(source).toContain("trigger-sync[\"点击同步按钮<br/>bindRunPage() startButton.click\"]");
    expect(source).not.toContain("subgraph apiConsumption");
    expect(source).not.toContain("apiConsumption_");
    expect(source).toContain("classDef apiConsumerNode");
    expect(source).toContain("class sync-run apiConsumerNode;");
    expect(source).toContain("POST /api/runs/sync");
    expect(source).not.toContain("源码入口：web/client/src/pages/runs/index.ts -> bindRunPage()");
  });

  it("defaults flash-diary code flow to the page-hotspot theme and still switches back to the unified graph", async () => {
    const page = renderAutomationWorkspacePage("code-flow-flash-diary-page");
    document.body.appendChild(page);
    await flush();
    await flush();

    expect(page.querySelector("[data-automation-page-hotspot-diagram]")).not.toBeNull();
    expect(page.textContent).toContain("页面热点流程");
    expect(page.querySelector<HTMLElement>("[data-automation-comment-panel]")?.hidden).toBe(true);
    expect(page.querySelector("[data-automation-detail-view=\"mermaid\"]")).not.toBeNull();
    expect(page.querySelector("[data-automation-detail-view=\"page-hotspot\"]")).not.toBeNull();

    page.querySelector<SVGGElement>("[data-automation-source-node=\"memoryFile\"]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(page.textContent).toContain("节点说明");
    expect(page.textContent).toContain("闪念日记页 · #/flash-diary");
    expect(page.textContent).toContain("Memory 的真实持久化文件。用户打开 Memory 时会先显示当前版本，不等刷新完成。");
    expect(page.textContent).toContain("作用");
    expect(page.textContent).toContain("输出");

    page.querySelector<HTMLButtonElement>("[data-automation-detail-view=\"mermaid\"]")?.click();
    await flush();
    await flush();

    expect(page.querySelector("[data-automation-mermaid-diagram]")).not.toBeNull();
    expect(String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls.at(-1)?.[1] ?? "")).toContain("compileDecision{\"判断：是否满足闪念日记 auto compile 条件\"}");
    expect(String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls.at(-1)?.[1] ?? "")).not.toContain("memoryFile --> recentStatusView");
  });

  it("renders workflow recorder as a main diagram with node explanation and appendix tabs", async () => {
    const page = renderAutomationWorkspacePage("code-flow-workflow-recorder");
    document.body.appendChild(page);
    await flush();
    await flush();

    expect(page.querySelector(".automation-detail__body")?.getAttribute("data-automation-spec-panel")).toBe("false");
    expect(page.querySelector("[data-automation-comment-toggle]")).toBeNull();
    expect(page.querySelectorAll("[data-automation-standard-node]")).toHaveLength(0);
    expect(page.querySelector<HTMLElement>("[data-automation-comment-panel]")?.hidden).toBe(true);
    expect(page.querySelector<HTMLElement>("[data-automation-comment-panel]")?.textContent).not.toContain("节点说明");
    expect(page.querySelector<HTMLElement>("[data-automation-comment-panel]")?.textContent).not.toContain("Prompt 附录");

    page.querySelector<SVGGElement>("[data-automation-insight-node=\"C1\"]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(page.querySelector(".automation-detail__body")?.getAttribute("data-automation-spec-panel")).toBe("true");
    expect(page.querySelector<HTMLElement>("[data-automation-comment-panel]")?.hidden).toBe(false);
    expect(page.textContent).toContain("C1AI 解析事件");
    expect(page.textContent).toContain("Workflow Event Candidate");
    expect(page.textContent).toContain("Prompt 附录");
    expect(page.textContent).toContain("Schema 附录");
    expect(page.textContent).toContain("规则附录");
    expect(page.querySelector<SVGGElement>("[data-automation-insight-node=\"C1\"]")?.dataset.automationInsightSelected).toBe("true");

    page.querySelector<HTMLButtonElement>("[data-automation-appendix-tab=\"schema\"]")?.click();
    expect(page.querySelector<HTMLElement>("[data-automation-appendix-panel=\"schema\"]")?.hidden).toBe(false);
    expect(page.textContent).toContain("\"record_type\"");
  });

  it("supports zoom controls and dragging inside the page-hotspot theme", async () => {
    const page = renderAutomationWorkspacePage("code-flow-flash-diary-page");
    document.body.appendChild(page);
    await flush();
    await flush();

    const viewport = page.querySelector<HTMLElement>("[data-automation-page-hotspot-viewport]");
    const surface = page.querySelector<HTMLElement>("[data-automation-page-hotspot-surface]");
    const zoomIn = page.querySelector<HTMLButtonElement>("[data-automation-zoom=\"in\"]");
    const zoomFit = page.querySelector<HTMLButtonElement>("[data-automation-zoom=\"fit\"]");
    const zoomLabel = page.querySelector<HTMLElement>("[data-automation-zoom-label]");
    if (!viewport || !surface || !zoomIn || !zoomFit || !zoomLabel) {
      throw new Error("page-hotspot viewport not rendered");
    }

    expect(surface.style.transform).toContain("scale(");
    const initialTransform = surface.style.transform;

    zoomIn.click();
    expect(surface.style.transform).not.toBe(initialTransform);
    expect(zoomLabel.textContent).not.toBe("100%");

    viewport.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -120,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 180,
      clientY: 140,
    }));
    expect(surface.style.transform).not.toBe(initialTransform);

    viewport.scrollLeft = 40;
    viewport.scrollTop = 24;
    viewport.dispatchEvent(createPointerEvent("pointerdown", { pointerId: 9, clientX: 260, clientY: 180 }));
    window.dispatchEvent(createPointerEvent("pointermove", { pointerId: 9, clientX: 220, clientY: 132 }));
    window.dispatchEvent(createPointerEvent("pointerup", { pointerId: 9, clientX: 220, clientY: 132 }));

    expect(viewport.scrollLeft).toBe(80);
    expect(viewport.scrollTop).toBe(72);
    expect(viewport.dataset.dragging).toBeUndefined();

    zoomFit.click();
    expect(zoomLabel.textContent).toMatch(/%$/);
  });

  it("refreshes the Mermaid diagram when automation workspace change events arrive", async () => {
    const page = renderAutomationWorkspacePage("daily-sync");
    document.body.appendChild(page);
    await flush();
    await flush();
    expect(String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls[0]?.[1] ?? "")).toContain("同步内容");
    expect(String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls[0]?.[1] ?? "")).not.toContain("同步内容 v2");
    automationWorkspaceEvents.emit("/api/automation-workspace/events", "change", {
      version: 2,
      changedAt: "2026-04-25T10:00:00.000Z",
      files: ["web/client/src/pages/automation/automation-flow.ts"],
    });
    await flush();
    await flush();

    expect(String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls.at(-1)?.[1] ?? "")).toContain("同步内容 v2");
  });
});

function buildDailySyncPayload(actionTitle: string) {
  return {
    success: true,
    data: {
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
          nodes: [
            { id: "trigger", type: "trigger", title: "每日 09:00 触发", description: "按计划触发。", standard: "标准：只在每日 09:00 自动触发。", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
            { id: "action", type: "action", title: actionTitle, description: "执行应用同步。", standard: "标准：输出必须能验收。", app: { id: "writer-app", name: "Writer App", workflow: "读取内容\\n整理摘要", prompt: "整理摘要并回写" }, effectiveModel: { provider: "openai", model: "gpt-5-writer", source: "app", label: "应用模型 · openai / gpt-5-writer" } },
          ],
          edges: [{ id: "edge-trigger-action", source: "trigger", target: "action" }],
          branches: [],
        },
      },
      comments: [],
      layout: { automationId: "daily-sync", branchOffsets: {} },
    },
  };
}

function buildCodeFlowPayload() {
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
            { id: "trigger-sync", type: "trigger", title: "点击同步按钮", description: "源码入口：web/client/src/pages/runs/index.ts -> bindRunPage()", implementation: "bindRunPage() startButton.click", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
            { id: "scan-sync", type: "action", title: "调用 /api/intake/scan", description: "confirmSyncPlan() -> loadIntakeScan()", implementation: "loadIntakeScan()", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
            { id: "branch-sync", type: "branch", title: "是否检测到待处理项", description: "if (scan.items.length === 0) return 'none'", implementation: "if (scan.items.length === 0)", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
            { id: "sync-none", type: "action", title: "提示未检测到新源料并结束", description: "syncDecision === 'none'", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
            { id: "sync-run", type: "action", title: "POST /api/runs/sync 并订阅事件", description: "attachRunStream(await startRun('sync'))", implementation: "attachRunStream(await startRun('sync'))", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
          ],
          edges: [
            { id: "edge-1", source: "trigger-sync", target: "scan-sync" },
            { id: "edge-2", source: "scan-sync", target: "branch-sync" },
            { id: "edge-3", source: "branch-sync", target: "sync-none" },
            { id: "edge-4", source: "branch-sync", target: "sync-run" },
          ],
          branches: [{ id: "sync-entry-items", title: "scan.items 分支", sourceNodeId: "branch-sync", nodeIds: ["sync-none", "sync-run"] }],
        },
        documentSteps: [],
      },
      comments: [],
      layout: { automationId: "code-flow-sync-entry", branchOffsets: {} },
    },
  };
}

function buildFlashDiarySourceInsightPayload() {
  return {
    success: true,
    data: {
      automation: {
        id: "code-flow-flash-diary-page",
        name: "闪念日记页",
        summary: "统一链路图。",
        icon: "notebook-text",
        enabled: true,
        trigger: "page",
        sourceKind: "code",
        viewMode: "flow",
        flow: {
          nodes: [
            { id: "placeholder-trigger", type: "trigger", title: "打开闪念日记页", description: "打开详情。", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
          ],
          edges: [],
          branches: [],
        },
        sourceInsight: {
          scope: "page",
          page: {
            id: "flash-diary",
            title: "闪念日记页",
            routeLabel: "#/flash-diary",
          },
          graph: {
            mermaid: `
              flowchart TD
              saveTrigger{{"触发：用户保存闪念日记"}} --> diaryFile(["结果：当日日记文件"])
              diaryFile --> memoryFile(["结果：Memory 文件"])
              compileTrigger{{"触发：同步窗口命中"}} --> compileDecision{"判断：是否满足闪念日记 auto compile 条件"}
            `,
            nodes: [
              { id: "saveTrigger", kind: "trigger", label: "触发：用户保存闪念日记" },
              { id: "memoryFile", kind: "result", label: "结果：Memory 文件 wiki/journal-memory.md" },
              { id: "questionsView", kind: "result", label: "结果：右侧显示十二个问题" },
            ],
            edges: [
              { source: "saveTrigger", target: "memoryFile", label: "写回" },
            ],
          },
          pageHotspotView: {
            title: "页面热点流程",
            description: "中间是闪念日记页缩略图，外面每个热点都接一段完整微流程。",
            svg: `
              <svg width="400" height="260" viewBox="0 0 400 260" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="108" y="24" width="184" height="164" rx="20" fill="#FFFFFF" stroke="#DDD6FB"/>
                <rect x="126" y="62" width="72" height="42" rx="10" fill="#EEE8FF" stroke="#CFC1FF"/>
                <rect x="126" y="118" width="72" height="42" rx="10" fill="#E9F0FF" stroke="#C4D2FF"/>
                <rect x="226" y="48" width="46" height="24" rx="12" fill="#7759F2"/>
                <circle cx="162" cy="139" r="8" fill="#7A67F4" stroke="#FFFFFF" stroke-width="4"/>
                <path d="M162 139 C120 139, 88 144, 64 162" stroke="#7A67F4" stroke-width="3"/>
                <g data-automation-source-node="memoryFile">
                  <rect x="24" y="150" width="116" height="76" rx="16" fill="#FFFFFF" stroke="#DDD6FB"/>
                  <text x="82" y="180" text-anchor="middle">按钮：点击 / 刷新 Memory</text>
                  <text x="82" y="206" text-anchor="middle">结果：当前 Memory</text>
                </g>
                <g data-automation-source-node="saveTrigger">
                  <circle cx="249" cy="60" r="8" fill="#7A67F4" stroke="#FFFFFF" stroke-width="4"/>
                </g>
              </svg>
            `.trim(),
          },
          nodeInsights: {
            saveTrigger: {
              summary: "用户在闪念日记页保存当前编辑内容。",
              upstream: [],
              downstream: ["结果：当日日记文件"],
              shownIn: [],
              sourcePaths: ["web/client/src/pages/flash-diary/index.ts"],
              missingLinks: [],
              potentialDestinations: [],
            },
            memoryFile: {
              summary: "Memory 的真实持久化文件。用户打开 Memory 时会先显示当前版本，不等刷新完成。",
              upstream: ["处理：汇总近日日记，生成新的 Memory"],
              downstream: ["结果：Memory 页面显示"],
              shownIn: ["闪念日记页 Memory 视图"],
              sourcePaths: ["web/server/services/flash-diary-memory-files.ts"],
              missingLinks: [
                {
                  to: "结果：工作台“近日状态”",
                  statusNote: "当前真实源码里，近日状态不读取 Memory。",
                },
              ],
              potentialDestinations: [],
            },
            questionsView: {
              summary: "左侧“十二个问题”卡点开后，右侧会切到固定追问文档。",
              upstream: ["按钮：点击“十二个问题”"],
              downstream: [],
              shownIn: ["闪念日记页右侧正文区"],
              sourcePaths: ["web/client/src/pages/flash-diary/index.ts"],
              missingLinks: [],
              potentialDestinations: [],
            },
          },
        },
      },
      comments: [],
      layout: { automationId: "code-flow-flash-diary-page", branchOffsets: {} },
    },
  };
}

function buildWorkflowRecorderSpecPayload() {
  return {
    success: true,
    data: {
      automation: {
        id: "code-flow-workflow-recorder",
        name: "执行记录器归档流程设计",
        summary: "主流程图 + 节点说明 + 附录。",
        icon: "clipboard-pen-line",
        enabled: true,
        trigger: "message",
        sourceKind: "code",
        viewMode: "flow",
        flow: {
          nodes: [],
          edges: [],
          branches: [],
        },
        sourceInsight: {
          scope: "cross-page",
          page: {
            id: "workflow-recorder",
            title: "执行记录器归档流程设计",
            routeLabel: "主流程图 + 节点说明 + 附录",
          },
          graph: {
            mermaid: `
              flowchart TD
              A1["A1 执行记录器输入"] --> B1["B1 记录清洗"]
              B1 --> C1["C1 AI 解析事件"]
              C1 --> D1["D1 匹配任务卡"]
            `,
            nodes: [
              { id: "A1", kind: "trigger", label: "A1 执行记录器输入" },
              { id: "C1", kind: "process", label: "C1 AI 解析事件" },
            ],
            edges: [
              { source: "A1", target: "C1" },
            ],
          },
          nodeInsights: {
            A1: {
              summary: "接收用户的现场执行记录。",
              upstream: [],
              downstream: ["B1 记录清洗"],
              shownIn: ["执行记录器归档流程设计"],
              sourcePaths: [],
              missingLinks: [],
              potentialDestinations: [],
              specRows: [
                { label: "作用", value: "接收执行现场的文本、图片、链接或附件。" },
                { label: "输入", value: "text / image / link" },
              ],
            },
            C1: {
              summary: "把记录解析成事件候选。",
              upstream: ["B1 记录清洗"],
              downstream: ["D1 匹配任务卡"],
              shownIn: ["执行记录器归档流程设计"],
              sourcePaths: [],
              missingLinks: [],
              potentialDestinations: [],
              specRows: [
                { label: "作用", value: "提取过程、卡点、解决、下一步。" },
                { label: "输出", value: "Workflow Event Candidate" },
              ],
            },
          },
          appendices: [
            { id: "prompt", title: "Prompt 附录", content: "你是 Workflow Event 解析助手。" },
            { id: "schema", title: "Schema 附录", content: "{ \"record_type\": \"process\" }" },
            { id: "rules", title: "规则附录", content: "高置信度写入任务卡。" },
          ],
        },
        documentSteps: [],
      },
      comments: [],
      layout: { automationId: "code-flow-workflow-recorder", branchOffsets: {} },
    },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForLayoutWarmup(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createPointerEvent(
  type: string,
  init: { pointerId: number; clientX: number; clientY: number },
): Event {
  const EventCtor = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  const event = new EventCtor(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: 0,
  });
  if (!("pointerId" in event)) {
    Object.defineProperty(event, "pointerId", { value: init.pointerId });
  }
  return event;
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
