import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import {
  handleAutomationPotentialDestinationCreate,
  handleAutomationPotentialDestinationDelete,
  handleAutomationPotentialDestinationPatch,
  handleAutomationWorkspaceCommentCreate,
  handleAutomationWorkspaceCommentDelete,
  handleAutomationWorkspaceCommentPatch,
  handleAutomationWorkspaceDetail,
  handleAutomationWorkspaceEvents,
  handleAutomationWorkspaceLayoutGet,
  handleAutomationWorkspaceLayoutSave,
  handleAutomationWorkspaceList,
  handleAutomationWorkspaceLogs,
} from "../web/server/routes/automation-workspace.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("automation workspace routes", () => {
  it("lists automations and resolves node models from app config or the default LLM config", async () => {
    const cfg = makeConfig();
    seedAutomationConfig(cfg.projectRoot);
    seedAppConfig(cfg.projectRoot);
    seedEnv(cfg.projectRoot, [
      "LLMWIKI_PROVIDER=openai",
      "LLMWIKI_MODEL=gpt-5-default",
    ]);
    const list = createResponse();
    const detail = createResponse();

    await handleAutomationWorkspaceList(cfg)({ query: {} } as Request, list as Response);
    await handleAutomationWorkspaceDetail(cfg)({ params: { id: "daily-sync" } } as unknown as Request, detail as Response);

    expect(list.statusCode).toBe(200);
    expect(list.body.data.automations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "daily-sync",
        name: "Daily Sync",
        enabled: true,
        sourceKind: "automation",
      }),
      expect.objectContaining({
        id: "publish-hook",
        name: "Publish Hook",
        enabled: false,
        sourceKind: "automation",
      }),
    ]));

    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.automation.id).toBe("daily-sync");
    expect(detail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "action-with-app-model",
        app: expect.objectContaining({
          id: "writer-app",
          workflow: "读取内容\\n整理摘要",
        }),
        effectiveModel: {
          provider: "openai",
          model: "gpt-5-writer",
          source: "app",
          label: "应用模型 · openai / gpt-5-writer",
        },
      }),
      expect.objectContaining({
        id: "action-fallback-model",
        app: expect.objectContaining({
          id: "fallback-app",
          prompt: "当内容缺模型时回退默认模型。",
        }),
        effectiveModel: {
          provider: "openai",
          model: "gpt-5-default",
          source: "default",
          label: "跟随默认模型 · openai / gpt-5-default",
        },
      }),
    ]));
  });

  it("falls back to app workflows when explicit automation config is empty", async () => {
    const cfg = makeConfig();
    seedAppConfig(cfg.projectRoot);
    seedEnv(cfg.projectRoot, [
      "LLMWIKI_PROVIDER=openai",
      "LLMWIKI_MODEL=gpt-5-default",
    ]);
    const list = createResponse();
    const detail = createResponse();

    await handleAutomationWorkspaceList(cfg)({ query: {} } as Request, list as Response);
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "app-workflow-writer-app" },
    } as unknown as Request, detail as Response);

    expect(list.statusCode).toBe(200);
    expect(list.body.data.automations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "app-workflow-writer-app",
        name: "Writer App",
        summary: "整理摘要",
        enabled: true,
        sourceKind: "app",
      }),
      expect.objectContaining({
        id: "app-workflow-fallback-app",
        name: "Fallback App",
        summary: "补充标签",
        enabled: true,
        sourceKind: "app",
      }),
    ]));

    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.automation.name).toBe("Writer App");
    expect(detail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "trigger",
        title: "调用应用时触发",
        standard: "标准：只有用户调用该应用或对应 workflow 时触发。",
      }),
      expect.objectContaining({
        title: "读取内容",
        standard: "标准：输入清晰、输出可验收，不虚构缺失上下文。",
        app: expect.objectContaining({
          id: "writer-app",
          name: "Writer App",
        }),
        effectiveModel: {
          provider: "openai",
          model: "gpt-5-writer",
          source: "app",
          label: "应用模型 · openai / gpt-5-writer",
        },
      }),
      expect.objectContaining({
        title: "整理摘要",
        standard: "标准：输入清晰、输出可验收，不虚构缺失上下文。",
        effectiveModel: {
          provider: "openai",
          model: "gpt-5-writer",
          source: "app",
          label: "应用模型 · openai / gpt-5-writer",
        },
      }),
    ]));
  });

  it("exposes task-plan assistant node standards in the automation workspace", async () => {
    const cfg = makeConfig();
    seedAppConfig(cfg.projectRoot);
    const detail = createResponse();

    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "app-workflow-task-plan-assistant" },
    } as unknown as Request, detail as Response);

    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.automation.name).toBe("任务计划助手");
    expect(detail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "调用应用时触发",
        standard: "标准：只在任务计划页需要语音整理、排期生成、微调落盘或执行确认时触发。",
      }),
      expect.objectContaining({
        title: "读取任务计划页状态",
        standard: "标准：读到 voice、pool、schedule、statusSummary；任务需保持领域、项目、任务层级。",
      }),
      expect.objectContaining({
        title: "读取最近语音输入、任务池和工作日志上下文",
        standard: "标准：只把能跟踪、能验收、通常需多个行动的事项识别为任务；一步事项保留为行动或执行记录。",
      }),
      expect.objectContaining({
        title: "输出严格 JSON 计划结果",
        standard: "标准：输出必须是合法 JSON，并包含任务目标、完成标准、当前状态、下一步和可落盘字段。",
      }),
      expect.objectContaining({
        title: "在人工微调后只做结构校正，不改变用户意图",
        standard: "标准：只修正结构和字段一致性，不改变用户意图、领域、项目或任务边界。",
      }),
    ]));
  });

  it("derives code-backed automation entries from audited source flows only", async () => {
    const cfg = makeConfig();
    seedAppConfig(cfg.projectRoot);
    seedEnv(cfg.projectRoot, [
      "LLMWIKI_PROVIDER=openai",
      "LLMWIKI_MODEL=gpt-5-default",
    ]);
    const list = createResponse();

    await handleAutomationWorkspaceList(cfg)({ query: {} } as Request, list as Response);

    expect(list.statusCode).toBe(200);
    expect(list.body.data.automations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "code-flow-sync-entry",
        name: "同步入口",
        enabled: true,
        sourceKind: "code",
      }),
      expect.objectContaining({
        id: "code-flow-sync-compile-overview",
        name: "同步编译总览",
        enabled: true,
        sourceKind: "code",
      }),
      expect.objectContaining({
        id: "code-flow-compile-chain",
        name: "编译链路",
        enabled: true,
        sourceKind: "code",
      }),
      expect.objectContaining({
        id: "code-flow-automation-workspace",
        name: "Workflow 工作区",
        enabled: true,
        sourceKind: "code",
      }),
      expect.objectContaining({
        id: "code-flow-global-knowledge-overview",
        name: "全局知识流转总览",
        enabled: true,
        sourceKind: "information",
      }),
      expect.objectContaining({
        id: "code-flow-information-transfer",
        name: "信息流转流程",
        enabled: true,
        sourceKind: "information",
      }),
      expect.objectContaining({
        id: "code-flow-workflow-recorder",
        name: "执行记录器归档流程",
        enabled: true,
        sourceKind: "code",
      }),
      expect.objectContaining({
        id: "code-flow-workflow-artifacts",
        name: "执行沉淀文件流转",
        enabled: true,
        sourceKind: "information",
      }),
    ]));
    expect(list.body.data.automations.some((automation: { sourceKind: string }) => automation.sourceKind === "document")).toBe(false);

    const syncEntry = list.body.data.automations.find((automation: { name: string }) => automation.name === "同步入口");
    expect(syncEntry).toBeDefined();
    expect(syncEntry.id).toBe("code-flow-sync-entry");

    const detail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: syncEntry.id },
    } as unknown as Request, detail as Response);

    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.automation.name).toBe("同步入口");
    expect(detail.body.data.automation.sourceKind).toBe("code");
    expect(detail.body.data.automation.viewMode).toBe("flow");
    expect(detail.body.data.automation.sourceInsight.page).toEqual({
      id: "runs",
      title: "运行页",
      routeLabel: "#/runs",
    });
    expect(detail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "syncTrigger", kind: "trigger" }),
      expect.objectContaining({ id: "hasItems", kind: "decision" }),
      expect.objectContaining({ id: "batchPlan", kind: "input" }),
      expect.objectContaining({ id: "confirmPlan", kind: "process" }),
      expect.objectContaining({ id: "runLog", kind: "result" }),
    ]));
    expect(detail.body.data.automation.sourceInsight.graph.mermaid).toContain("syncTrigger[\"A1 用户点击同步\"]");
    expect(detail.body.data.automation.sourceInsight.graph.mermaid).toContain("hasPlan{");
    expect(detail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "trigger",
        title: "点击同步按钮",
        implementation: "bindRunPage() startButton.click",
      }),
      expect.objectContaining({
        type: "action",
        title: "confirmSyncPlan()",
        implementation: "confirmSyncPlan()",
      }),
      expect.objectContaining({
        type: "branch",
        title: "scan.items.length 是否为 0",
        implementation: "if (scan.items.length === 0)",
      }),
      expect.objectContaining({
        title: "attachRunStream()",
        implementation: "attachRunStream()",
      }),
    ]));
    expect(detail.body.data.automation.flow.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "sync-items",
        nodeIds: ["sync-none", "sync-branch-plan"],
      }),
    ]));
    expect(detail.body.data.automation.mermaid).toContain("A[\"点击同步按钮<br/>bindRunPage() startButton.click\"]");
    expect(detail.body.data.automation.mermaid).toContain("D -->|是| E");
    expect(detail.body.data.automation.mermaid).toContain("I -->|是| K");

    const reviewBoardDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-review-board" },
    } as unknown as Request, reviewBoardDetail as Response);
    expect(reviewBoardDetail.statusCode).toBe(200);
    expect(reviewBoardDetail.body.data.automation.name).toBe("审查与运行结果");
    expect(reviewBoardDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "review",
      title: "审查页",
      routeLabel: "#/review",
    });
    expect(reviewBoardDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "openReview", kind: "trigger" }),
      expect.objectContaining({ id: "reviewAction", kind: "decision" }),
      expect.objectContaining({ id: "applyDraft", kind: "process" }),
      expect.objectContaining({ id: "confirmResult", kind: "result" }),
    ]));
    expect(reviewBoardDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("singleAdvance[");
    expect(reviewBoardDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("inboxResult[");
    expect(reviewBoardDetail.body.data.automation.mermaid).toContain("I -->|单条推进| J");
    expect(reviewBoardDetail.body.data.automation.mermaid).toContain("I -->|确认写入| W");
    expect(reviewBoardDetail.body.data.automation.mermaid).toContain("I -->|批量录入 inbox| AK");
    expect(reviewBoardDetail.body.data.automation.mermaid).toContain("AQ --> AU");

    const quickCapture = list.body.data.automations.find((automation: { name: string }) => automation.name === "闪念日记快速记录");
    expect(quickCapture).toBeDefined();
    const quickCaptureDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: quickCapture.id },
    } as unknown as Request, quickCaptureDetail as Response);
    expect(quickCaptureDetail.body.data.automation.sourceKind).toBe("code");
    expect(quickCaptureDetail.body.data.automation.viewMode).toBe("flow");
    expect(quickCaptureDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "flash-diary-capture",
      title: "闪念日记快速录入",
      routeLabel: "桌面全局快捷键",
    });
    expect(quickCaptureDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hotkeyTrigger", kind: "trigger" }),
      expect.objectContaining({ id: "fileDecision", kind: "decision" }),
      expect.objectContaining({ id: "entryInput", kind: "input" }),
      expect.objectContaining({ id: "prependBlock", kind: "process" }),
      expect.objectContaining({ id: "failureFile", kind: "result" }),
    ]));
    expect(quickCaptureDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("hotkeyTrigger[\"A1 全局快捷键触发\"]");
    expect(quickCaptureDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("writeDecision{");
    expect(quickCaptureDetail.body.data.automation.mermaid).toContain("A[\"全局快捷键触发<br/>globalShortcut.register()\"]");
    expect(quickCaptureDetail.body.data.automation.mermaid).toContain("G -->|否| H");
    expect(quickCaptureDetail.body.data.automation.mermaid).toContain("L -->|是| N");
    expect(quickCaptureDetail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "全局快捷键触发",
        implementation: "globalShortcut.register()",
      }),
      expect.objectContaining({
        title: "当天日记文件是否已存在",
        implementation: "fs.existsSync(diaryPath)",
      }),
      expect.objectContaining({
        title: "prependDiaryBlock()",
        implementation: "prependDiaryBlock()",
      }),
    ]));

    const compileDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-compile-chain" },
    } as unknown as Request, compileDetail as Response);
    expect(compileDetail.statusCode).toBe(200);
    expect(compileDetail.body.data.automation.name).toBe("编译链路");
    expect(compileDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "compile-chain",
      title: "编译链路",
      routeLabel: "跨页总览",
    });
    expect(compileDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "compileTrigger", kind: "trigger" }),
      expect.objectContaining({ id: "batchDecision", kind: "decision" }),
      expect.objectContaining({ id: "batchInput", kind: "input" }),
      expect.objectContaining({ id: "compileProcess", kind: "process" }),
      expect.objectContaining({ id: "publishLive", kind: "result" }),
    ]));
    expect(compileDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("compileTrigger[\"A1 sync compile run…\"]");
    expect(compileDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("changeDecision{");
    expect(compileDetail.body.data.automation.mermaid).toContain("I -->|是| J");
    expect(compileDetail.body.data.automation.mermaid).toContain("P -->|否| R");
    expect(compileDetail.body.data.automation.mermaid).toContain("W --> X");
    expect(compileDetail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "读取配置和运行根目录",
        implementation: "loadSyncCompileConfig() + resolveCompileRootsFromConfig()",
      }),
      expect.objectContaining({
        type: "branch",
        title: "toCompile / deleted 是否为空",
        implementation: "if (toCompile.length === 0 && deleted.length === 0)",
      }),
      expect.objectContaining({
        title: "更新 tiered memory",
        implementation: "updateTieredMemory()",
      }),
    ]));

    const compileOverviewDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-sync-compile-overview" },
    } as unknown as Request, compileOverviewDetail as Response);
    expect(compileOverviewDetail.statusCode).toBe(200);
    expect(compileOverviewDetail.body.data.automation.name).toBe("同步编译总览");
    expect(compileOverviewDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "sync-compile-overview",
      title: "同步编译总览",
      routeLabel: "跨页总览",
    });
    expect(compileOverviewDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "syncTrigger", kind: "trigger" }),
      expect.objectContaining({ id: "hasItems", kind: "decision" }),
      expect.objectContaining({ id: "batchPlan", kind: "input" }),
      expect.objectContaining({ id: "batchCompile", kind: "process" }),
      expect.objectContaining({ id: "publishCurrent", kind: "result" }),
    ]));
    expect(compileOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("syncTrigger[\"A1 用户点击同步\"]");
    expect(compileOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("hasBatches{");
    expect(compileOverviewDetail.body.data.automation.mermaid).toContain("A[\"用户点击同步<br/>bindRunPage() startButton.click\"]");
    expect(compileOverviewDetail.body.data.automation.mermaid).toContain("E -->|没有| F");
    expect(compileOverviewDetail.body.data.automation.mermaid).toContain("E -->|有| G");
    expect(compileOverviewDetail.body.data.automation.mermaid).toContain("L --> M");
    expect(compileOverviewDetail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "点击同步按钮",
        implementation: "bindRunPage() startButton.click",
      }),
      expect.objectContaining({
        type: "branch",
        title: "batches.length 是否为 0",
        implementation: "if (batches.length === 0)",
      }),
      expect.objectContaining({
        title: "按批次执行 llmwiki compile",
        implementation: "prepareActiveSources() + runCompile()",
      }),
      expect.objectContaining({
        title: "发布 staging 结果",
        implementation: "publishStagingRun() + writeBatchState() + writeFinalCompileResult()",
      }),
    ]));

    const automationWorkspaceDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-automation-workspace" },
    } as unknown as Request, automationWorkspaceDetail as Response);
    expect(automationWorkspaceDetail.statusCode).toBe(200);
    expect(automationWorkspaceDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "automation",
      title: "Workflow 工作区",
      routeLabel: "#/automation",
    });
    expect(automationWorkspaceDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "openWorkspace", kind: "trigger" }),
      expect.objectContaining({ id: "listAction", kind: "decision" }),
      expect.objectContaining({ id: "readDetail", kind: "process" }),
      expect.objectContaining({ id: "logTimeline", kind: "result" }),
    ]));
    expect(automationWorkspaceDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("changeEvent[");
    expect(automationWorkspaceDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("detailRefresh[");
    expect(automationWorkspaceDetail.body.data.automation.mermaid).toContain("A[\"打开 #/automation<br/>renderAutomationWorkspacePage()\"]");
    expect(automationWorkspaceDetail.body.data.automation.mermaid).toContain("E -->|打开详情| G");
    expect(automationWorkspaceDetail.body.data.automation.mermaid).toContain("K -->|查看日志| L");

    const informationTransferDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-information-transfer" },
    } as unknown as Request, informationTransferDetail as Response);
    expect(informationTransferDetail.statusCode).toBe(200);
    expect(informationTransferDetail.body.data.automation.sourceKind).toBe("information");
    expect(informationTransferDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "information-transfer",
      title: "信息流转流程",
      routeLabel: "跨专题总览",
    });
    expect(informationTransferDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("appDefinition[");
    expect(informationTransferDetail.body.data.automation.sourceInsight.nodeInsights.topicLinks.shownIn).toEqual([
      "应用流程",
      "信息流转流程",
      "源码真实流程",
    ]);

    const sourceGalleryDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-source-gallery" },
    } as unknown as Request, sourceGalleryDetail as Response);
    expect(sourceGalleryDetail.statusCode).toBe(200);
    expect(sourceGalleryDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "sources",
      title: "源料库页",
      routeLabel: "#/sources",
    });
    expect(sourceGalleryDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "openSources", kind: "trigger" }),
      expect.objectContaining({ id: "userAction", kind: "decision" }),
      expect.objectContaining({ id: "compileInput", kind: "input" }),
      expect.objectContaining({ id: "buildCompile", kind: "process" }),
      expect.objectContaining({ id: "syncLog", kind: "result" }),
    ]));
    expect(sourceGalleryDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("moveInbox[");
    expect(sourceGalleryDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("compileFile[");
    expect(sourceGalleryDetail.body.data.automation.mermaid).toContain("A[\"打开 #/sources<br/>renderSourcesPage()\"]");
    expect(sourceGalleryDetail.body.data.automation.mermaid).toContain("E -->|送入 inbox| F");
    expect(sourceGalleryDetail.body.data.automation.mermaid).toContain("K --> L");

    const flashDiaryPageDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-flash-diary-page" },
    } as unknown as Request, flashDiaryPageDetail as Response);
    expect(flashDiaryPageDetail.statusCode).toBe(200);
    expect(flashDiaryPageDetail.body.data.automation.name).toBe("闪念日记页");
    expect(flashDiaryPageDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "flash-diary",
      title: "闪念日记页",
      routeLabel: "#/flash-diary",
    });
    expect(flashDiaryPageDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "saveTrigger", kind: "trigger" }),
      expect.objectContaining({ id: "memoryDecision", kind: "decision" }),
      expect.objectContaining({ id: "diaryWindow", kind: "input" }),
      expect.objectContaining({ id: "memoryProcess", kind: "process" }),
      expect.objectContaining({ id: "memoryView", kind: "result" }),
      expect.objectContaining({ id: "questionsView", kind: "result" }),
      expect.objectContaining({ id: "openDiaryCard", kind: "trigger" }),
      expect.objectContaining({ id: "editorView", kind: "result" }),
    ]));
    expect(flashDiaryPageDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("saveTrigger[\"A1 用户保存闪念日记\"]");
    expect(flashDiaryPageDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("memoryDecision{");
    expect(flashDiaryPageDetail.body.data.automation.sourceInsight.graph.mermaid).not.toContain("memoryFile --> recentStatusView");
    expect(flashDiaryPageDetail.body.data.automation.sourceInsight.pageHotspotView).toEqual(expect.objectContaining({
      title: "页面热点流程",
      description: "中间是闪念日记页缩略图；拖拽、滚轮和双指缩放都作用在整张图上，外围每个热点都接一段完整微流程。",
      svg: expect.stringContaining("data-automation-source-node=\"saveTrigger\""),
    }));
    expect(flashDiaryPageDetail.body.data.automation.sourceInsight.nodeInsights.memoryFile.missingLinks).toEqual([
      expect.objectContaining({
        to: "结果：工作台“近日状态”",
      }),
    ]);

    const globalOverviewDetail = createResponse();
    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-global-knowledge-overview" },
    } as unknown as Request, globalOverviewDetail as Response);
    expect(globalOverviewDetail.statusCode).toBe(200);
    expect(globalOverviewDetail.body.data.automation.name).toBe("全局知识流转总览");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.page).toEqual({
      id: "global-knowledge-overview",
      title: "全局知识流转总览",
      routeLabel: "跨页总览",
    });
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "diaryTrigger", kind: "trigger" }),
      expect.objectContaining({ id: "timelineProcess", kind: "process" }),
      expect.objectContaining({ id: "historyFile", kind: "input" }),
      expect.objectContaining({ id: "historyView", kind: "result" }),
      expect.objectContaining({ id: "caseRefreshProcess", kind: "process" }),
      expect.objectContaining({ id: "caseLibraryPages", kind: "result" }),
      expect.objectContaining({ id: "workflowRecorderTrigger", kind: "trigger" }),
      expect.objectContaining({ id: "aboutMeCompose", kind: "process" }),
      expect.objectContaining({ id: "concepts", kind: "result" }),
      expect.objectContaining({ id: "identityFile", kind: "input" }),
      expect.objectContaining({ id: "identityCompose", kind: "process" }),
      expect.objectContaining({ id: "identityView", kind: "result" }),
    ]));
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("concepts[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("historyFile[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("historyView[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("caseRefreshProcess[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("caseLibraryPages[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("workflowRecorderTrigger[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("aboutMeCompose[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("taskPoolState[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.graph.mermaid).toContain("identityCompose[");
    expect(globalOverviewDetail.body.data.automation.sourceInsight.nodeInsights.chatRecords.missingLinks).toEqual([
      expect.objectContaining({
        to: "结果：wiki/个人信息档案/个人时间线.md",
      }),
    ]);
    expect(globalOverviewDetail.body.data.automation.sourceInsight.nodeInsights.caseLibraryPages.upstream).toEqual(expect.arrayContaining([
      "处理：扫描日记、历史回忆和时间线的问题解决信号",
      "触发：执行记录器归档出现问题信号",
    ]));
  });

  it("exposes the workflow recorder filing flow as a code-backed automation", async () => {
    const cfg = makeConfig();
    seedAppConfig(cfg.projectRoot);
    const detail = createResponse();

    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-workflow-recorder" },
    } as unknown as Request, detail as Response);

    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.automation.name).toBe("执行记录器归档流程");
    expect(detail.body.data.automation.sourceKind).toBe("code");
    expect(detail.body.data.automation.viewMode).toBe("flow");
    expect(detail.body.data.automation.mermaid).toContain("A1 执行记录器输入");
    expect(detail.body.data.automation.mermaid).toContain("C1 AI 解析事件");
    expect(detail.body.data.automation.sourceInsight.appendices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "prompt", title: "Prompt 附录" }),
      expect.objectContaining({ id: "schema", title: "Schema 附录" }),
      expect.objectContaining({ id: "rules", title: "规则附录" }),
    ]));
    expect(detail.body.data.automation.sourceInsight.nodeInsights.C1.specRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "输出", value: "Workflow Event Candidate" }),
      expect.objectContaining({ label: "标准", value: "不臆造任务，不直接当方法。" }),
    ]));
    expect(detail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "workflow-shortcut",
        standard: expect.stringContaining("不直接新建任务"),
        title: "执行记录器 / 日记输入",
      }),
      expect.objectContaining({
        id: "workflow-event",
        standard: expect.stringContaining("Workflow Event"),
        title: "Workflow Event 事件池",
      }),
      expect.objectContaining({
        id: "workflow-rank",
        standard: expect.stringContaining("备选任务未确认前不作为默认归档目标"),
        title: "rankTaskCandidates()",
      }),
      expect.objectContaining({
        id: "workflow-resource",
        standard: expect.stringContaining("工具箱候选"),
        title: "生成资源与工具候选",
      }),
      expect.objectContaining({
        id: "workflow-case",
        standard: expect.stringContaining("问题和解决过程"),
        title: "生成案例库候选",
      }),
    ]));
  });

  it("exposes workflow artifact file and folder flow as a code-backed automation", async () => {
    const cfg = makeConfig();
    seedAppConfig(cfg.projectRoot);
    const detail = createResponse();

    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-workflow-artifacts" },
    } as unknown as Request, detail as Response);

    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.automation.name).toBe("执行沉淀文件流转");
    expect(detail.body.data.automation.sourceKind).toBe("information");
    expect(detail.body.data.automation.mermaid).toContain("案例库首页：刷新案例库");
    expect(detail.body.data.automation.mermaid).toContain("写入 wiki/专题/01-案例库/<标题>案例.md");
    expect(detail.body.data.automation.sourceInsight.graph.mermaid).toContain("A[\"输入来源\"]");
    expect(detail.body.data.automation.sourceInsight.graph.mermaid).toContain("写入 wiki/专题/01-案例库/<标题>案例.md");
    expect(detail.body.data.automation.sourceInsight.graph.mermaid).not.toContain("A1 输入来源");
    expect(detail.body.data.automation.sourceInsight.page).toEqual({
      id: "workflow-artifacts",
      title: "执行沉淀文件流转",
      routeLabel: "#/workflow-artifacts",
    });
    expect(detail.body.data.automation.flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "refresh",
        title: "案例库首页刷新",
      }),
      expect.objectContaining({
        id: "caseFile",
        implementation: "wiki/专题/01-案例库/*案例.md",
        title: "写入案例库文件",
      }),
    ]));
  });

  it("stores potential destinations under source-insight nodes without mixing them into comments", async () => {
    const cfg = makeConfig();
    seedAppConfig(cfg.projectRoot);
    const created = createResponse();
    const patched = createResponse();
    const detail = createResponse();
    const removed = createResponse();

    await handleAutomationPotentialDestinationCreate(cfg)({
      params: { id: "code-flow-flash-diary-page" },
      body: {
        nodeId: "memoryFile",
        label: "长期人物状态摘要",
        intendedOutcome: "把 Memory 进一步沉淀成人物状态摘要。",
        note: "这里只是业务意图，不代表当前真实已接通。",
      },
    } as unknown as Request, created as Response);

    expect(created.statusCode).toBe(200);
    expect(created.body.data).toEqual(expect.objectContaining({
      automationId: "code-flow-flash-diary-page",
      nodeId: "memoryFile",
      label: "长期人物状态摘要",
      intendedOutcome: "把 Memory 进一步沉淀成人物状态摘要。",
      note: "这里只是业务意图，不代表当前真实已接通。",
    }));

    await handleAutomationPotentialDestinationPatch(cfg)({
      params: { id: "code-flow-flash-diary-page", potentialId: created.body.data.id },
      body: {
        intendedOutcome: "把短期 Memory 沉淀成稳定人物状态摘要。",
      },
    } as unknown as Request, patched as Response);

    expect(patched.statusCode).toBe(200);
    expect(patched.body.data.intendedOutcome).toBe("把短期 Memory 沉淀成稳定人物状态摘要。");

    await handleAutomationWorkspaceDetail(cfg)({
      params: { id: "code-flow-flash-diary-page" },
    } as unknown as Request, detail as Response);

    expect(detail.statusCode).toBe(200);
    expect(detail.body.data.comments).toEqual([]);
    expect(detail.body.data.automation.sourceInsight.nodeInsights.memoryFile.potentialDestinations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: created.body.data.id,
        automationId: "code-flow-flash-diary-page",
        nodeId: "memoryFile",
        label: "长期人物状态摘要",
        intendedOutcome: "把短期 Memory 沉淀成稳定人物状态摘要。",
      }),
    ]));

    await handleAutomationPotentialDestinationDelete(cfg)({
      params: { id: "code-flow-flash-diary-page", potentialId: created.body.data.id },
    } as unknown as Request, removed as Response);

    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({ success: true });
  });

  it("creates and deletes comments anchored to nodes or edges", async () => {
    const cfg = makeConfig();
    seedAutomationConfig(cfg.projectRoot);
    seedAppConfig(cfg.projectRoot);
    const created = createResponse();
    const removed = createResponse();
    const detail = createResponse();

    await handleAutomationWorkspaceCommentCreate(cfg)({
      params: { id: "daily-sync" },
      body: {
        targetType: "node",
        targetId: "action-with-app-model",
        text: "这里要明确展示应用。",
        pinnedX: 120,
        pinnedY: 84,
      },
    } as unknown as Request, created as Response);

    expect(created.statusCode).toBe(200);
    expect(created.body.data).toEqual(expect.objectContaining({
      automationId: "daily-sync",
      targetType: "node",
      targetId: "action-with-app-model",
      text: "这里要明确展示应用。",
      pinnedX: 120,
      pinnedY: 84,
      updatedAt: expect.any(String),
    }));
    expect(created.body.data.createdAt).toBe(created.body.data.updatedAt);

    await handleAutomationWorkspaceDetail(cfg)({ params: { id: "daily-sync" } } as unknown as Request, detail as Response);
    expect(detail.body.data.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetType: "node",
        targetId: "action-with-app-model",
      }),
    ]));

    await handleAutomationWorkspaceCommentDelete(cfg)({
      params: { id: "daily-sync", commentId: created.body.data.id },
    } as unknown as Request, removed as Response);

    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({ success: true });
  });

  it("rejects comment creation when required target metadata is missing", async () => {
    const cfg = makeConfig();
    seedAutomationConfig(cfg.projectRoot);
    seedAppConfig(cfg.projectRoot);
    const missingType = createResponse();
    const missingPins = createResponse();

    await handleAutomationWorkspaceCommentCreate(cfg)({
      params: { id: "daily-sync" },
      body: {
        targetId: "action-with-app-model",
        text: "缺少类型",
        pinnedX: 12,
        pinnedY: 18,
      },
    } as unknown as Request, missingType as Response);

    expect(missingType.statusCode).toBe(400);
    expect(missingType.body).toEqual({
      success: false,
      error: "Comment targetType is required.",
    });

    await handleAutomationWorkspaceCommentCreate(cfg)({
      params: { id: "daily-sync" },
      body: {
        targetType: "node",
        targetId: "action-with-app-model",
        text: "缺少坐标",
      },
    } as unknown as Request, missingPins as Response);

    expect(missingPins.statusCode).toBe(400);
    expect(missingPins.body).toEqual({
      success: false,
      error: "Comment pinnedX and pinnedY are required.",
    });
  });

  it("updates automation comments with pinned and manual coordinates", async () => {
    const cfg = makeConfig();
    seedAutomationConfig(cfg.projectRoot);
    seedAppConfig(cfg.projectRoot);
    const created = createResponse();
    const patched = createResponse();
    const detail = createResponse();

    await handleAutomationWorkspaceCommentCreate(cfg)({
      params: { id: "daily-sync" },
      body: {
        targetType: "node",
        targetId: "action-with-app-model",
        text: "初始评论",
        pinnedX: 320,
        pinnedY: 180,
      },
    } as unknown as Request, created as Response);
    const createdUpdatedAt = created.body.data.updatedAt;
    await waitForClockTick();

    await handleAutomationWorkspaceCommentPatch(cfg)({
      params: { id: "daily-sync", commentId: created.body.data.id },
      body: {
        text: "已拖动后的评论",
        manualX: 360,
        manualY: 212,
        pinnedX: 360,
        pinnedY: 212,
        targetType: "canvas",
        targetId: "canvas",
      },
    } as unknown as Request, patched as Response);

    expect(patched.statusCode).toBe(200);
    expect(patched.body.data).toEqual(expect.objectContaining({
      text: "已拖动后的评论",
      manualX: 360,
      manualY: 212,
      pinnedX: 360,
      pinnedY: 212,
      targetType: "canvas",
      targetId: "canvas",
      updatedAt: expect.any(String),
    }));
    expect(patched.body.data.updatedAt).not.toBe(createdUpdatedAt);

    const cleared = createResponse();
    await handleAutomationWorkspaceCommentPatch(cfg)({
      params: { id: "daily-sync", commentId: created.body.data.id },
      body: {
        manualX: null,
        manualY: null,
      },
    } as unknown as Request, cleared as Response);

    expect(cleared.statusCode).toBe(200);
    expect(cleared.body.data.manualX).toBeUndefined();
    expect(cleared.body.data.manualY).toBeUndefined();

    await handleAutomationWorkspaceDetail(cfg)({ params: { id: "daily-sync" } } as unknown as Request, detail as Response);
    expect(detail.body.data.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: created.body.data.id,
        text: "已拖动后的评论",
        pinnedX: 360,
        pinnedY: 212,
        targetType: "canvas",
        targetId: "canvas",
      }),
    ]));
  });

  it("reads and saves branch layout offsets and exposes automation logs", async () => {
    const cfg = makeConfig();
    seedAutomationConfig(cfg.projectRoot);
    seedAppConfig(cfg.projectRoot);
    seedLogs(cfg.runtimeRoot);
    const initialLayout = createResponse();
    const savedLayout = createResponse();
    const logs = createResponse();

    await handleAutomationWorkspaceLayoutGet(cfg)({
      params: { id: "daily-sync" },
    } as unknown as Request, initialLayout as Response);
    await handleAutomationWorkspaceLayoutSave(cfg)({
      params: { id: "daily-sync" },
      body: {
        branchOffsets: {
          "content-branches": { x: 36, y: 18 },
        },
      },
    } as unknown as Request, savedLayout as Response);
    await handleAutomationWorkspaceLogs(cfg)({
      params: { id: "daily-sync" },
    } as unknown as Request, logs as Response);

    expect(initialLayout.body.data).toEqual({ automationId: "daily-sync", branchOffsets: {} });
    expect(savedLayout.body.data).toEqual({
      automationId: "daily-sync",
      branchOffsets: {
        "content-branches": { x: 36, y: 18 },
      },
    });
    expect(logs.body.data.logs).toEqual([
      expect.objectContaining({
        id: "log-1",
        status: "success",
        summary: "同步完成",
      }),
    ]);
  });

  it("streams automation workspace change events over SSE", async () => {
    const response = createStreamResponse();
    const request = createEventRequest();
    const events = createAutomationWorkspaceEventStub();

    handleAutomationWorkspaceEvents(events)(request as Request, response as unknown as Response);

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    expect(response.output).toContain("event: change");
    expect(response.output).toContain("\"version\":1");

    events.publish({
      version: 2,
      changedAt: "2026-04-25T10:00:00.000Z",
      files: ["web/client/src/pages/runs/automation-flow.ts"],
    });

    expect(response.output).toContain("\"version\":2");
    expect(response.output).toContain("web/client/src/pages/runs/automation-flow.ts");

    request.close();
    expect(events.listenerCount()).toBe(0);
  });
});

function makeConfig(): ServerConfig {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-automation-workspace-project-"));
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-automation-workspace-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-automation-workspace-runtime-"));
  roots.push(projectRoot, sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(projectRoot, "automations"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "agents"), { recursive: true });
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "tester",
  };
}

async function waitForClockTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2));
}

function seedAutomationConfig(projectRoot: string): void {
  fs.writeFileSync(path.join(projectRoot, "automations", "automations.json"), JSON.stringify({
    automations: [
      {
        id: "daily-sync",
        name: "Daily Sync",
        summary: "同步昨日新增内容。",
        icon: "calendar",
        trigger: "schedule",
        appId: "writer-app",
        enabled: true,
        schedule: "0 9 * * *",
        webhookPath: "",
        updatedAt: "2026-04-25T00:00:00.000Z",
        flow: {
          nodes: [
            {
              id: "trigger-daily-sync",
              type: "trigger",
              title: "每日 09:00 触发",
              description: "按计划触发。",
              modelMode: "default",
            },
            {
              id: "branch-content",
              type: "branch",
              title: "并行处理",
              description: "并行拆分内容处理。",
              modelMode: "default",
            },
            {
              id: "action-with-app-model",
              type: "action",
              title: "摘要整理",
              description: "调用写作应用整理摘要。",
              appId: "writer-app",
              modelMode: "default",
            },
            {
              id: "action-fallback-model",
              type: "action",
              title: "补充标签",
              description: "调用标签应用补充标签。",
              appId: "fallback-app",
              modelMode: "default",
            },
            {
              id: "merge-content",
              type: "merge",
              title: "汇总结果",
              description: "汇总并写回结果。",
              modelMode: "default",
            },
          ],
          edges: [
            { id: "edge-trigger-branch", source: "trigger-daily-sync", target: "branch-content" },
            { id: "edge-branch-left", source: "branch-content", target: "action-with-app-model" },
            { id: "edge-branch-right", source: "branch-content", target: "action-fallback-model" },
            { id: "edge-left-merge", source: "action-with-app-model", target: "merge-content" },
            { id: "edge-right-merge", source: "action-fallback-model", target: "merge-content" },
          ],
          branches: [
            {
              id: "content-branches",
              title: "内容处理",
              sourceNodeId: "branch-content",
              mergeNodeId: "merge-content",
              nodeIds: ["action-with-app-model", "action-fallback-model"],
            },
          ],
        },
      },
      {
        id: "publish-hook",
        name: "Publish Hook",
        summary: "发布后同步回调。",
        icon: "rocket",
        trigger: "webhook",
        appId: "fallback-app",
        enabled: false,
        schedule: "",
        webhookPath: "/hooks/publish",
        updatedAt: "2026-04-25T00:00:00.000Z",
        flow: {
          nodes: [
            {
              id: "trigger-publish-hook",
              type: "trigger",
              title: "收到发布回调",
              description: "接收外部回调。",
              modelMode: "default",
            },
          ],
          edges: [],
          branches: [],
        },
      },
    ],
  }, null, 2), "utf8");
}

function seedAppConfig(projectRoot: string): void {
  fs.writeFileSync(path.join(projectRoot, "agents", "agents.json"), JSON.stringify({
    defaultAppId: "writer-app",
    apps: [
      {
        id: "writer-app",
        name: "Writer App",
        mode: "chat",
        purpose: "整理摘要",
        provider: "openai",
        accountRef: "",
        model: "gpt-5-writer",
        workflow: "读取内容\\n整理摘要",
        prompt: "整理摘要并回写。",
        enabled: true,
        updatedAt: "2026-04-25T00:00:00.000Z",
      },
      {
        id: "fallback-app",
        name: "Fallback App",
        mode: "chat",
        purpose: "补充标签",
        provider: "openai",
        accountRef: "",
        model: "",
        workflow: "读取上下文\\n补充标签",
        prompt: "当内容缺模型时回退默认模型。",
        enabled: true,
        updatedAt: "2026-04-25T00:00:00.000Z",
      },
    ],
  }, null, 2), "utf8");
}

function seedLogs(runtimeRoot: string): void {
  const folder = path.join(runtimeRoot, ".llmwiki");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "automation-logs.json"), JSON.stringify({
    logsByAutomationId: {
      "daily-sync": [
        {
          id: "log-1",
          automationId: "daily-sync",
          status: "success",
          summary: "同步完成",
          startedAt: "2026-04-25T09:00:00.000Z",
          endedAt: "2026-04-25T09:01:00.000Z",
        },
      ],
    },
  }, null, 2), "utf8");
}

function seedEnv(projectRoot: string, lines: string[]): void {
  fs.writeFileSync(path.join(projectRoot, ".env"), `${lines.join("\n")}\n`, "utf8");
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    process.env[key!] = rest.join("=");
  }
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function createStreamResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    output: "",
    writeHead(code: number, headers: Record<string, string>) {
      this.statusCode = code;
      this.headers = headers;
      return this;
    },
    write(chunk: string) {
      this.output += chunk;
      return true;
    },
  };
}

function createEventRequest() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    on(event: string, handler: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return this;
    },
    close() {
      for (const handler of listeners.get("close") ?? []) {
        handler();
      }
    },
  };
}

function createAutomationWorkspaceEventStub(): {
  snapshot: () => { version: number; changedAt: string; files: string[] };
  subscribe: (listener: (event: { version: number; changedAt: string; files: string[] }) => void) => () => void;
  publish: (event: { version: number; changedAt: string; files: string[] }) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(event: { version: number; changedAt: string; files: string[] }) => void>();
  return {
    snapshot: () => ({
      version: 1,
      changedAt: "2026-04-25T09:00:00.000Z",
      files: [],
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}
