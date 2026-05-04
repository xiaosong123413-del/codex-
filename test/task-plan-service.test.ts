import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { LLMProvider } from "../src/utils/provider.js";
import { handleTaskPlanScheduleSave, registerTaskPlanRoutes } from "../web/server/routes/task-plan.js";
const { resolveAgentRuntimeProviderMock } = vi.hoisted(() => ({
  resolveAgentRuntimeProviderMock: vi.fn(),
}));

vi.mock("../web/server/services/llm-chat.js", () => ({
  resolveAgentRuntimeProvider: resolveAgentRuntimeProviderMock,
}));

import {
  generateTaskPlan,
  readCurrentTaskPlanState,
  refreshTaskPlanStatusSummary,
  saveTaskPlanPool,
  saveTaskPlanStatusSummary,
  saveTaskPlanText,
} from "../web/server/services/task-plan-service.js";
import { generateTaskPoolCandidates } from "../web/server/services/task-pool-generation-service.js";
import { writeTaskPlanState } from "../web/server/services/task-plan-store.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  resolveAgentRuntimeProviderMock.mockReset();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("task plan service", () => {
  it("saves direct text input into the planning transcript slot", async () => {
    const root = makeTempRoot("task-plan-service-text");

    const result = await saveTaskPlanText({
      text: "直接输入的计划文本",
      storageRoot: root,
    });

    expect(result.state.voice.transcript).toBe("直接输入的计划文本");
    expect(result.state.voice.audioPath).toBeNull();
    expect(typeof result.state.voice.updatedAt).toBe("string");
    expect(result.state.morningFlow.voiceDone).toBe(true);

    const persisted = await readCurrentTaskPlanState({ storageRoot: root });
    expect(persisted.voice.transcript).toBe("直接输入的计划文本");
    expect(persisted.voice.audioPath).toBeNull();
  });

  it("refreshes recent status summary from provider using current planning input and recent context", async () => {
    const root = makeTempRoot("task-plan-service-status-refresh");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "docs", "project-log.md"),
      "# Project Log\n\n- 上午处理需求文档，下午整理用户反馈。\n",
      "utf8",
    );
    await saveTaskPlanText({
      text: "今天先完成需求文档，再整理用户反馈。",
      storageRoot: root,
    });
    const capture = createCapturingProvider("最近状态：需求文档推进中，用户反馈已开始归类。");

    const result = await refreshTaskPlanStatusSummary({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: capture.provider,
    });

    expect(result.state.statusSummary).toBe("最近状态：需求文档推进中，用户反馈已开始归类。");
    expect(result.state.voice.transcript).toBe("今天先完成需求文档，再整理用户反馈。");
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0]?.messages[0]?.content).toContain("今天先完成需求文档，再整理用户反馈。");
    expect(capture.calls[0]?.messages[0]?.content).toContain("# Project Log");
    expect(capture.calls[0]?.messages[0]?.content).toContain("<task_pool>");
    expect(capture.calls[0]?.messages[0]?.content).toContain("完成需求文档初稿");

    const persisted = await readCurrentTaskPlanState({ storageRoot: root });
    expect(result.state).toEqual(persisted);
  });

  it("persists manual status summary edits", async () => {
    const root = makeTempRoot("task-plan-service-status-save");

    const result = await saveTaskPlanStatusSummary({
      statusSummary: "手动编辑后的状态摘要",
      storageRoot: root,
    });

    expect(result.state.statusSummary).toBe("手动编辑后的状态摘要");

    const persisted = await readCurrentTaskPlanState({ storageRoot: root });
    expect(persisted.statusSummary).toBe("手动编辑后的状态摘要");
  });

  it("persists manual task-pool edits with source labels", async () => {
    const root = makeTempRoot("task-plan-service-pool-save");

    const result = await saveTaskPlanPool({
      items: [
        { id: "pool-manual-1", title: "手动新增任务", priority: "mid", source: "手动新增" },
        {
          id: "pool-manual-2",
          title: "来自工作日志的任务",
          priority: "low",
          source: "工作日志",
          domain: "知识管理",
          project: "个人知识库",
        },
      ],
      storageRoot: root,
    });

    expect(result.state.pool.items).toEqual([
      {
        id: "pool-manual-1",
        title: "手动新增任务",
        priority: "mid",
        source: "手动新增",
        stageId: "stage:待分组领域:未归类项目:待推进",
      },
      {
        id: "pool-manual-2",
        title: "来自工作日志的任务",
        priority: "low",
        source: "工作日志",
        domain: "知识管理",
        project: "个人知识库",
        stageId: "stage:知识管理:个人知识库:待推进",
      },
    ]);
    expect(result.state.pool.stages).toEqual([
      { id: "stage:待分组领域:未归类项目:待推进", title: "待推进", domain: "待分组领域", project: "未归类项目", order: 0 },
      { id: "stage:知识管理:个人知识库:待推进", title: "待推进", domain: "知识管理", project: "个人知识库", order: 0 },
    ]);

    const persisted = await readCurrentTaskPlanState({ storageRoot: root });
    expect(persisted.pool.items).toEqual(result.state.pool.items);
    const taxonomy = JSON.parse(fs.readFileSync(path.join(root, "taxonomy.json"), "utf8")) as {
      domains: string[];
      projects: Array<{ domain: string; name: string }>;
    };
    expect(taxonomy.domains).toContain("知识管理");
    expect(taxonomy.projects).toContainEqual({ domain: "知识管理", name: "个人知识库" });
  });

  it("blocks generation when voice transcript is missing", async () => {
    const root = makeTempRoot("task-plan-service-voice");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const state = await readCurrentTaskPlanState({ storageRoot: root });
    await writeTaskPlanState({
      ...state,
      voice: {
        ...state.voice,
        transcript: "   ",
      },
    }, { storageRoot: root });

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: createProvider("[]"),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing-voice-input",
        message: "latest voice transcript is required for generation",
      },
    });
  });

  it("persists generated schedule items from fenced JSON with an injected provider", async () => {
    const root = makeTempRoot("task-plan-service-generate");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(wikiRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(
      path.join(wikiRoot, "raw", "闪念日记", "2026-04-24.md"),
      "# 2026-04-24\n\n## 09:00:00\n\n今天先把需求卡点记下来。\n\n---\n",
      "utf8",
    );

    const initialState = await readCurrentTaskPlanState({ storageRoot: root });
    await writeTaskPlanState({
      ...initialState,
      schedule: {
        ...initialState.schedule,
        revisionId: "schedule-revision-existing",
      },
    }, { storageRoot: root });

    const generatedPayload = JSON.stringify({
      items: [
        { id: "generated-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
        { id: "generated-2", title: "整理用户反馈并归类", startTime: "14:00", priority: "mid" },
      ],
    });
    const provider = createProvider(`\`\`\`json\n${generatedPayload}\n\`\`\``);

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected successful generation");
    }
    expect(result.data.schedule.items).toEqual([
      { id: "generated-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
      { id: "generated-2", title: "整理用户反馈并归类", startTime: "14:00", priority: "mid" },
    ]);
    expect(typeof result.data.schedule.generationId).toBe("string");
    expect(result.data.schedule.generationId?.length).toBeGreaterThan(0);
    expect(result.data.schedule.revisionId).toBe("schedule-revision-existing");
    expect(result.data.schedule.confirmed).toBe(false);

    const state = await readCurrentTaskPlanState({ storageRoot: root });
    expect(state.schedule).toEqual(result.data.schedule);
    expect(state.morningFlow.diaryDone).toBe(true);
    expect(state.morningFlow.planningDone).toBe(true);
  });

  it("resolves the dedicated task-plan assistant provider path when no provider is injected", async () => {
    const root = makeTempRoot("task-plan-service-agent");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "agents"), { recursive: true });
    fs.mkdirSync(path.join(wikiRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "agents", "agents.json"),
      JSON.stringify({
        activeAgentId: "task-plan-assistant",
        agents: [
          {
            id: "task-plan-assistant",
            name: "任务计划助手",
            purpose: "处理任务计划页",
            provider: "openai",
            accountRef: "",
            model: "",
            workflow: "",
            prompt: "",
            enabled: true,
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
        ],
      }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(wikiRoot, "raw", "闪念日记", "2026-04-24.md"),
      "# 2026-04-24\n\n## 09:00:00\n\n记录一条工作日志。\n\n---\n",
      "utf8",
    );

    const provider = createProvider(JSON.stringify({
      items: [
        { id: "resolved-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
      ],
    }));
    resolveAgentRuntimeProviderMock.mockReturnValue(provider);

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
    });

    expect(result.ok).toBe(true);
    expect(resolveAgentRuntimeProviderMock).toHaveBeenCalledTimes(1);
    expect(resolveAgentRuntimeProviderMock.mock.calls[0]?.[0]).toBe(projectRoot);
    expect(resolveAgentRuntimeProviderMock.mock.calls[0]?.[1]?.id).toBe("task-plan-assistant");
    expect(resolveAgentRuntimeProviderMock.mock.calls[0]?.[2]).toBe("task-plan");
  });

  it("backfills a dedicated task-plan assistant from the active app account when legacy config is missing it", async () => {
    const root = makeTempRoot("task-plan-service-agent-backfill");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "agents"), { recursive: true });
    fs.mkdirSync(path.join(wikiRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "agents", "agents.json"),
      JSON.stringify({
        defaultAppId: "wiki-general",
        apps: [
          {
            id: "wiki-general",
            name: "通用助手",
            mode: "chat",
            purpose: "处理通用问题",
            provider: "relay",
            accountRef: "api:relay:-",
            model: "gpt-5-codex",
            workflow: "",
            prompt: "",
            enabled: true,
            updatedAt: "2026-04-25T00:00:00.000Z",
          },
        ],
      }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(wikiRoot, "raw", "闪念日记", "2026-04-24.md"),
      "# 2026-04-24\n\n## 09:00:00\n\n记录一条工作日志。\n\n---\n",
      "utf8",
    );
    await saveTaskPlanText({
      text: "今天先完成需求文档，再同步项目进展。",
      storageRoot: root,
    });

    const provider = createProvider(JSON.stringify({
      items: [
        { id: "resolved-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
      ],
    }));
    resolveAgentRuntimeProviderMock.mockReturnValue(provider);

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
    });

    expect(result.ok).toBe(true);
    expect(resolveAgentRuntimeProviderMock).toHaveBeenCalledTimes(1);
    expect(resolveAgentRuntimeProviderMock.mock.calls[0]?.[0]).toBe(projectRoot);
    expect(resolveAgentRuntimeProviderMock.mock.calls[0]?.[1]).toMatchObject({
      id: "task-plan-assistant",
      provider: "relay",
      accountRef: "api:relay:-",
      model: "",
      enabled: true,
    });
    expect(resolveAgentRuntimeProviderMock.mock.calls[0]?.[2]).toBe("task-plan");
  });

  it("returns task-plan-agent-not-found instead of falling back when the dedicated assistant is disabled", async () => {
    const root = makeTempRoot("task-plan-service-agent-disabled");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "agents"), { recursive: true });
    fs.mkdirSync(path.join(wikiRoot, "raw", "闪念日记"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "agents", "agents.json"),
      JSON.stringify({
        defaultAppId: "wiki-general",
        apps: [
          {
            id: "task-plan-assistant",
            name: "任务计划助手",
            mode: "chat",
            purpose: "处理任务计划页",
            provider: "relay",
            accountRef: "api:relay:-",
            model: "",
            workflow: "",
            prompt: "",
            enabled: false,
            updatedAt: "2026-04-25T00:00:00.000Z",
          },
          {
            id: "wiki-general",
            name: "通用助手",
            mode: "chat",
            purpose: "处理通用问题",
            provider: "relay",
            accountRef: "api:relay:-",
            model: "gpt-5-codex",
            workflow: "",
            prompt: "",
            enabled: true,
            updatedAt: "2026-04-25T00:00:00.000Z",
          },
        ],
      }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(wikiRoot, "raw", "闪念日记", "2026-04-24.md"),
      "# 2026-04-24\n\n## 09:00:00\n\n记录一条工作日志。\n\n---\n",
      "utf8",
    );
    await saveTaskPlanText({
      text: "今天先完成需求文档，再同步项目进展。",
      storageRoot: root,
    });
    resolveAgentRuntimeProviderMock.mockReturnValue(createProvider("should-not-be-used"));

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "task-plan-agent-not-found",
        message: "task-plan-assistant is not configured",
      },
    });
    expect(resolveAgentRuntimeProviderMock).not.toHaveBeenCalled();
  });

  it("generates successfully from project work-log context when flash diary is absent", async () => {
    const root = makeTempRoot("task-plan-service-work-log");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "docs", "project-log.md"),
      "# Project Log\n\n- 今天推进需求文档和用户反馈归类。\n",
      "utf8",
    );

    const capture = createCapturingProvider(JSON.stringify({
      items: [
        { id: "worklog-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
      ],
    }));

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: capture.provider,
    });

    expect(result.ok).toBe(true);
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0]?.messages[0]?.content).toContain("# Project Log");
    expect(capture.calls[0]?.messages[0]?.content).toContain("今天推进需求文档和用户反馈归类");
  });

  it("returns missing diary context when both flash diary and work-log context are absent", async () => {
    const root = makeTempRoot("task-plan-service-missing-diary");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: createProvider("[]"),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing-diary-context",
        message: "recent diary or work-log context is required for generation",
      },
    });
  });

  it("rejects when provider output is not strict JSON", async () => {
    const root = makeTempRoot("task-plan-service-invalid-json");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "docs", "project-log.md"),
      "# Project Log\n\n- 提供最小工作日志上下文。\n",
      "utf8",
    );

    await expect(generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: createProvider("not json"),
    })).rejects.toThrow();
  });

  it("rejects generated schedule items with invalid startTime values", async () => {
    const root = makeTempRoot("task-plan-service-invalid-start-time");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "docs", "project-log.md"),
      "# Project Log\n\n- 提供生成上下文。\n",
      "utf8",
    );

    await expect(generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: createProvider(JSON.stringify({
        items: [
          { id: "bad-time-1", title: "非法时间事项", startTime: "9:00", priority: "high" },
        ],
      })),
    })).rejects.toThrow("task plan generation item is invalid");
  });

  it("resets fineTuneDone to false after regenerating a previously confirmed schedule", async () => {
    const root = makeTempRoot("task-plan-service-regenerate");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
    fs.mkdirSync(wikiRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "docs", "project-log.md"),
      "# Project Log\n\n- 用于重新生成计划。\n",
      "utf8",
    );

    const initialState = await readCurrentTaskPlanState({ storageRoot: root });
    await writeTaskPlanState({
      ...initialState,
      schedule: {
        ...initialState.schedule,
        confirmed: true,
      },
      morningFlow: {
        ...initialState.morningFlow,
        fineTuneDone: true,
      },
    }, { storageRoot: root });

    const result = await generateTaskPlan({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: createProvider(JSON.stringify({
        items: [
          { id: "regen-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
        ],
      })),
    });

    expect(result.ok).toBe(true);
    const state = await readCurrentTaskPlanState({ storageRoot: root });
    expect(state.schedule.confirmed).toBe(false);
    expect(state.morningFlow.fineTuneDone).toBe(false);
  });

  it("generates task-pool candidates from fenced JSON for only unrecorded flash diaries", async () => {
    const root = makeTempRoot("task-pool-candidates");
    const wikiRoot = path.join(root, "wiki-root");
    const projectRoot = path.join(root, "project-root");
    const diaryRoot = path.join(wikiRoot, "raw", "闪念日记");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(diaryRoot, { recursive: true });
    fs.writeFileSync(path.join(diaryRoot, "2026-04-25.md"), "# 2026-04-25\n\nNeed a task pool drawer.\n", "utf8");
    fs.writeFileSync(path.join(diaryRoot, "2026-04-26.md"), "# 2026-04-26\n\nTrack generated task batches.\n", "utf8");

    const initialState = await readCurrentTaskPlanState({ storageRoot: root });
    const duplicateTitle = initialState.pool.items[0]?.title ?? "duplicate";
    const generatedPayload = JSON.stringify({
      tasks: [
        { title: duplicateTitle, priority: "high", owner: "me", reason: "Already exists." },
        {
          title: "Build task-pool generation history",
          priority: "mid",
          owner: "ai",
          reason: "Both new diaries mention batch tracking.",
          domain: "Personal system",
          project: "Task pool",
          dueDate: "05-09",
        },
      ],
    });
    const capture = createCapturingProvider(`\`\`\`json\n${generatedPayload}\n\`\`\``);

    const result = await generateTaskPoolCandidates({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: capture.provider,
      now: new Date("2026-04-28T02:30:00.000Z"),
    });

    expect(result.generationRecord?.diaryDates).toEqual(["2026-04-25", "2026-04-26"]);
    expect(result.generationRecord?.createdTaskIds).toHaveLength(1);
    expect(result.generationRecord?.skippedDuplicateTitles).toEqual([duplicateTitle]);
    const candidate = result.state.pool.items.find((item) => item.title === "Build task-pool generation history");
    expect(candidate).toMatchObject({
      zone: "candidate",
      owner: "ai",
      source: "AI 生成",
      createdAt: "2026-04-28T02:30:00.000Z",
      generatedReason: "Both new diaries mention batch tracking.",
    });
    expect(capture.calls[0]?.messages[0]?.content).toContain("2026-04-25");
    expect(capture.calls[0]?.messages[0]?.content).toContain("2026-04-26");
    expect(capture.calls[0]?.system).toContain("结合YYYY-M-D日记说");

    const second = await generateTaskPoolCandidates({
      projectRoot,
      wikiRoot,
      storageRoot: root,
      provider: createProvider(JSON.stringify({ tasks: [] })),
    });
    expect(second.generationRecord).toBeNull();
  });

  it("rejects whitespace-only schedule save fields with a structured 400 payload", async () => {
    const root = makeTempRoot("task-plan-service-route-validation");
    const response = createResponse();

    await handleTaskPlanScheduleSave(makeConfig(root), { storageRoot: root })({
      body: {
        items: [
          { id: "   ", title: "   ", startTime: "   ", priority: "high" },
        ],
        confirmed: false,
      },
    } as unknown as Request, response as Response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "invalid_request",
        message: "schedule item is invalid",
      },
    });
  });

  it("registers the generate route", () => {
    const routes: Array<{ method: string; path: string }> = [];
    const app = {
      get(routePath: string) {
        routes.push({ method: "get", path: routePath });
      },
      put(routePath: string) {
        routes.push({ method: "put", path: routePath });
      },
      post(routePath: string) {
        routes.push({ method: "post", path: routePath });
      },
    };

    registerTaskPlanRoutes(app as unknown as Parameters<typeof registerTaskPlanRoutes>[0], {
      wikiRoot: "wiki-root",
      projectRoot: "project-root",
      host: "127.0.0.1",
      port: 4175,
      author: "test",
    });

    expect(routes).toEqual(expect.arrayContaining([
      { method: "post", path: "/api/task-plan/generate" },
      { method: "put", path: "/api/task-plan/text" },
      { method: "put", path: "/api/task-plan/pool" },
      { method: "put", path: "/api/task-plan/status" },
      { method: "post", path: "/api/task-plan/status/refresh" },
    ]));
  });
});

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  roots.push(root);
  return root;
}

function makeConfig(projectRoot: string) {
  return {
    wikiRoot: projectRoot,
    projectRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "test",
  };
}

function createProvider(result: string): LLMProvider {
  return {
    async complete() {
      return result;
    },
    async stream() {
      return result;
    },
  };
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

function createCapturingProvider(result: string): {
  provider: LLMProvider;
  calls: Array<{ system: string; messages: Parameters<LLMProvider["complete"]>[1]; maxTokens: number }>;
} {
  const calls: Array<{ system: string; messages: Parameters<LLMProvider["complete"]>[1]; maxTokens: number }> = [];
  return {
    provider: {
      async complete(system, messages, maxTokens) {
        calls.push({ system, messages, maxTokens });
        return result;
      },
      async stream() {
        return result;
      },
    },
    calls,
  };
}
