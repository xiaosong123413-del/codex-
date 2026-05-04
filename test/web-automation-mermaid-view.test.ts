// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectMermaidTargetAnchors,
  resolveCommentPinPosition,
} from "../web/client/src/pages/automation/mermaid-comments.js";

/**
 * Focused Mermaid rendering and geometry coverage for automation detail pages.
 */

const mermaidRuntimeMocks = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(async () => `
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
  `),
}));

vi.mock("../web/client/src/pages/automation/mermaid-runtime.js", () => ({
  renderMermaidSvg: mermaidRuntimeMocks.renderMermaidSvg,
}));

import { renderAutomationWorkspacePage } from "../web/client/src/pages/automation/index.js";

afterEach(() => {
  mermaidRuntimeMocks.renderMermaidSvg.mockClear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("automation mermaid passthrough", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", class {
      addEventListener(): void {}
      close(): void {}
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/automation-workspace/code-flow-review-board") {
        return jsonResponse(buildReviewBoardPayload());
      }
      if (url === "/api/automation-workspace/code-flow-sync-compile-overview") {
        return jsonResponse(buildCompileOverviewPayload());
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
  });

  it("passes through custom Mermaid source for code-derived workflows that need exact edge labels", async () => {
    const page = renderAutomationWorkspacePage("code-flow-review-board");
    document.body.appendChild(page);
    await flushTwice();

    const source = String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls.at(-1)?.[1] ?? "");
    expect(source).toContain(REVIEW_BOARD_MERMAID.trim());
    expect(source).not.toContain("subgraph apiConsumption");
    expect(source).not.toContain("apiConsumption_");
    expect(source).toContain("classDef apiConsumerNode");
    expect(source).toContain("class B,J,W,AK apiConsumerNode;");
    expect(source).toContain("GET /api/review");
    expect(source).toContain("POST /api/review/deep-research/:id/actions");
    expect(source.startsWith("%%{init:")).toBe(false);
  });

  it("passes through the handwritten compile overview Mermaid source", async () => {
    const page = renderAutomationWorkspacePage("code-flow-sync-compile-overview");
    document.body.appendChild(page);
    await flushTwice();

    const source = String(mermaidRuntimeMocks.renderMermaidSvg.mock.calls.at(-1)?.[1] ?? "");
    expect(source).toContain(COMPILE_OVERVIEW_MERMAID.trim());
    expect(source).not.toContain("subgraph apiConsumption");
    expect(source).not.toContain("apiConsumption_");
    expect(source).not.toContain("classDef apiConsumerNode");
    expect(source.startsWith("%%{init:")).toBe(false);
  });
});

describe("mermaid comment geometry helpers", () => {
  it("collects node, edge, and canvas anchors from a rendered Mermaid svg", () => {
    document.body.innerHTML = createMermaidFixture();
    const svg = document.querySelector<SVGSVGElement>("svg");
    expect(svg).not.toBeNull();

    const anchors = collectMermaidTargetAnchors(svg!);

    expect(anchors).toEqual(expect.arrayContaining([
      { targetType: "node", targetId: "trigger", x: 40, y: 32 },
      { targetType: "node", targetId: "action", x: 146, y: 70 },
      { targetType: "edge", targetId: "edge-trigger-action", x: 90, y: 51 },
      { targetType: "canvas", targetId: "canvas", x: 100, y: 60 },
    ]));
  });

  it("resolves pin positions with manual, anchor, and orphan fallbacks", () => {
    const anchors = [
      { targetType: "node", targetId: "action", x: 146, y: 70 },
      { targetType: "canvas", targetId: "canvas", x: 100, y: 60 },
    ] as const;

    expect(resolveCommentPinPosition({
      targetType: "node",
      targetId: "action",
      manualX: 12,
      manualY: 18,
      pinnedX: 146,
      pinnedY: 70,
    }, [...anchors])).toEqual({ x: 12, y: 18, orphaned: false });
    expect(resolveCommentPinPosition({
      targetType: "node",
      targetId: "action",
      pinnedX: 146,
      pinnedY: 70,
    }, [...anchors])).toEqual({ x: 146, y: 70, orphaned: false });
    expect(resolveCommentPinPosition({
      targetType: "edge",
      targetId: "missing-edge",
      pinnedX: 180,
      pinnedY: 90,
    }, [...anchors])).toEqual({ x: 180, y: 90, orphaned: true });
  });

  it("ignores non-edge id paths in the fallback edge scan", () => {
    document.body.innerHTML = `
      <svg viewBox="0 0 200 120">
        <path id="decorative-outline" d="M0,0 L10,10"></path>
        <path id="edge-inline" class="flowchart-link" d="M20,30 L80,90"></path>
      </svg>
    `;
    const svg = document.querySelector<SVGSVGElement>("svg");
    expect(svg).not.toBeNull();

    const anchors = collectMermaidTargetAnchors(svg!);

    expect(anchors).toEqual(expect.arrayContaining([
      { targetType: "edge", targetId: "edge-inline", x: 50, y: 60 },
      { targetType: "canvas", targetId: "canvas", x: 100, y: 60 },
    ]));
    expect(anchors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: "edge", targetId: "decorative-outline" }),
    ]));
  });
});

const REVIEW_BOARD_MERMAID = `
flowchart TD
    A["打开 #/review<br/>renderReviewPage() / bindReviewPage()"] --> B["GET /api/review<br/>handleReviewSummary()"]
    H --> I{"用户点了哪种动作"}
    I -->|单条推进| J["POST /api/review/deep-research/:id/actions<br/>handleDeepResearchAction()"]
    I -->|确认写入| W["POST /api/review/deep-research/:id/confirm<br/>handleDeepResearchConfirm()"]
    I -->|批量录入 inbox| AK["POST /api/review/inbox/batch-ingest<br/>handleReviewInboxBatchIngest()"]
    AQ --> AU["跳转 #/chat/:id"]
`;

const COMPILE_OVERVIEW_MERMAID = `  flowchart TD
    A["用户点击同步<br/>bindRunPage() startButton.click"] --> D["判断哪些文件需要进入本轮编译<br/>readAutoCompileFiles() + selectNextBatch()"]
    D --> E{"有待编译文件吗"}
    E -->|没有| F["写最终结果并发布当前 wiki<br/>writeFinalCompileResult() + publishWikiToCloudflare()"]
    E -->|有| G["按批次执行 llmwiki compile<br/>prepareActiveSources() + runCompile()"]
    G --> L["发布 staging 结果<br/>publishStagingRun() + writeBatchState()"]
    L --> M["发布 Cloudflare wiki 并输出结果<br/>publishWikiToCloudflare() + refreshEntityIndexSnapshot()"]
  `;

function buildReviewBoardPayload() {
  return {
    success: true,
    data: {
      automation: {
        id: "code-flow-review-board",
        name: "审查与运行结果",
        summary: "审查页真实流程。",
        icon: "bot",
        enabled: true,
        trigger: "message",
        sourceKind: "code",
        viewMode: "flow",
        mermaid: REVIEW_BOARD_MERMAID,
        flow: {
          nodes: [
            { id: "review-trigger", type: "trigger", title: "打开 /review", description: "页面挂载后立即读取审查队列。", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
          ],
          edges: [],
          branches: [],
        },
        documentSteps: [],
      },
      comments: [],
      layout: { automationId: "code-flow-review-board", branchOffsets: {} },
    },
  };
}

function buildCompileOverviewPayload() {
  return {
    success: true,
    data: {
      automation: {
        id: "code-flow-sync-compile-overview",
        name: "同步编译总览",
        summary: "同步编译端到端总览。",
        icon: "rocket",
        enabled: true,
        trigger: "message",
        sourceKind: "code",
        viewMode: "flow",
        mermaid: COMPILE_OVERVIEW_MERMAID,
        flow: {
          nodes: [
            { id: "overview-trigger", type: "trigger", title: "点击同步按钮", description: "运行页进入同步前置检查。", effectiveModel: { provider: "", model: "", source: "none", label: "" } },
          ],
          edges: [],
          branches: [],
        },
        documentSteps: [],
      },
      comments: [],
      layout: { automationId: "code-flow-sync-compile-overview", branchOffsets: {} },
    },
  };
}

function createMermaidFixture(): string {
  return `
    <svg viewBox="0 0 200 120">
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
  `;
}

async function flushTwice(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
