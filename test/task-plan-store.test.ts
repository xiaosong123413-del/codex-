import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapTaskPlanStore,
  readTaskPlanState,
} from "../web/server/services/task-plan-store.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function withPendingStageIds<T extends { domain?: string; project?: string }>(items: readonly T[]): Array<T & { stageId: string }> {
  return items.map((item) => ({ ...item, stageId: pendingStageId(item) }));
}

function pendingStagesFor(items: readonly { domain?: string; project?: string }[]): Array<{
  id: string;
  title: string;
  domain: string;
  project: string;
  order: number;
}> {
  const stages = new Map<string, { id: string; title: string; domain: string; project: string; order: number }>();
  for (const item of items) {
    const domain = item.domain ?? "待分组领域";
    const project = item.project ?? "未归类项目";
    const id = pendingStageId(item);
    stages.set(id, { id, title: "待推进", domain, project, order: 0 });
  }
  return Array.from(stages.values());
}

function pendingStageId(item: { domain?: string; project?: string }): string {
  return `stage:${item.domain ?? "待分组领域"}:${item.project ?? "未归类项目"}:待推进`;
}

describe("task plan store", () => {
  it("bootstraps state.json under an injected storage root", async () => {
    const root = makeTempRoot();

    const snapshot = await bootstrapTaskPlanStore({ storageRoot: root });

    const statePath = path.join(root, "state.json");
    expect(fs.existsSync(statePath)).toBe(true);

    const state = await readTaskPlanState({ storageRoot: root });
    expect(snapshot.state).toEqual(state);
    expect(state.voice.transcript).toBe("今天要先完成需求文档，再和产品确认功能逻辑，下午整理用户反馈，晚上复盘。");
    expect(state.statusSummary).toBe("今天聚焦需求确认、反馈整理和晚间复盘，先把高优事项推进到可交付状态。");
  });

  it("seeds the nested task-plan state with the exact current static UI content", async () => {
    const root = makeTempRoot();

    await bootstrapTaskPlanStore({ storageRoot: root });
    const state = await readTaskPlanState({ storageRoot: root });
    const seedItems = [
      { id: "pool-1", title: "完成需求文档初稿", priority: "high", source: "文字输入", domain: "产品设计", project: "工作台改版" },
      { id: "pool-2", title: "与开发确认功能逻辑", priority: "high", source: "文字输入", domain: "产品设计", project: "任务同步" },
      { id: "pool-3", title: "整理用户反馈并归类", priority: "mid", source: "近日状态", domain: "用户研究", project: "反馈归类" },
      { id: "pool-4", title: "操写项目复盘", priority: "cool", source: "AI 生成", domain: "个人成长", project: "效率系统" },
      { id: "pool-5", title: "复盘今日完成情况", priority: "low", source: "近日状态", domain: "个人成长", project: "日常复盘" },
      { id: "pool-6", title: "整理需求变更记录文档", priority: "low", source: "工作日志", domain: "产品设计", project: "任务同步" },
      { id: "pool-7", title: "准备用户访谈提纲", priority: "low", source: "闪念日记", domain: "用户研究", project: "访谈计划" },
      { id: "pool-8", title: "学习用户研究方法", priority: "low", source: "闪念日记", domain: "用户研究", project: "方法沉淀" },
      { id: "pool-9", title: "优化效率模型逻辑", priority: "cool", source: "AI 生成", domain: "个人成长", project: "效率系统" },
      { id: "pool-10", title: "准备需求汇报材料", priority: "cool", source: "手动新增", domain: "产品设计", project: "视觉梳理" },
      { id: "pool-11", title: "处理邮件与消息", priority: "neutral", source: "工作日志", domain: "个人成长", project: "日常维护" },
    ];

    expect(state).toEqual({
      voice: {
        transcript: "今天要先完成需求文档，再和产品确认功能逻辑，下午整理用户反馈，晚上复盘。",
        audioPath: null,
        updatedAt: "2026-04-24T00:00:00.000Z",
      },
      pool: {
        items: withPendingStageIds(seedItems),
        stages: pendingStagesFor(seedItems),
        generationRecords: [],
      },
      schedule: {
        generationId: null,
        revisionId: null,
        items: [
          { id: "schedule-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
          { id: "schedule-2", title: "与开发确认功能逻辑", startTime: "10:30", priority: "high" },
          { id: "schedule-3", title: "整理用户反馈并归类", startTime: "14:00", priority: "mid" },
          { id: "schedule-4", title: "复盘项目进度", startTime: "16:00", priority: "cool" },
          { id: "schedule-5", title: "复盘今日完成情况", startTime: "19:30", priority: "low" },
        ],
        confirmed: false,
      },
      roadmap: {
        view: "week",
        windowStart: "2024-05-01",
        topLabel: "领域 / 产品设计",
        windowLabel: "2024年5月",
        groups: [
          {
            id: "roadmap-group-1",
            title: "1. 产品 & 设计",
            items: [
              { id: "roadmap-item-1", title: "工作台改版" },
              { id: "roadmap-item-2", title: "任务追踪页优化" },
            ],
          },
          {
            id: "roadmap-group-2",
            title: "2. 用户研究",
            items: [
              { id: "roadmap-item-3", title: "用户访谈洞察" },
              { id: "roadmap-item-4", title: "访谈提要" },
            ],
          },
          {
            id: "roadmap-group-3",
            title: "3. 个人成长",
            items: [
              { id: "roadmap-item-5", title: "效率系统复盘" },
              { id: "roadmap-item-6", title: "阅读沉淀" },
            ],
          },
        ],
      },
      statusSummary: "今天聚焦需求确认、反馈整理和晚间复盘，先把高优事项推进到可交付状态。",
      morningFlow: {
        voiceDone: false,
        diaryDone: false,
        planningDone: false,
        fineTuneDone: false,
      },
    });
  });

  it("hydrates legacy partial state files by backfilling missing nested fields", async () => {
    const root = makeTempRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "state.json"), JSON.stringify({
      voice: {
        transcript: "遗留语音文本",
      },
      schedule: {
        items: [
          { id: "schedule-legacy-1", title: "遗留事项", startTime: "08:30", priority: "high" },
        ],
      },
      roadmap: {
        groups: [],
      },
      morningFlow: {
        planningDone: true,
      },
    }, null, 2), "utf8");

    const state = await readTaskPlanState({ storageRoot: root });

    expect(state.voice).toEqual({
      transcript: "遗留语音文本",
      audioPath: null,
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    expect(state.schedule).toEqual({
      generationId: null,
      revisionId: null,
      items: [
        { id: "schedule-legacy-1", title: "遗留事项", startTime: "08:30", priority: "high" },
      ],
      confirmed: false,
    });
    expect(state.pool.items[0]?.source).toBe("文字输入");
    expect(state.pool.items[0]?.domain).toBe("产品设计");
    expect(state.roadmap.view).toBe("week");
    expect(state.roadmap.groups).toEqual([]);
    expect(state.morningFlow).toEqual({
      voiceDone: false,
      diaryDone: false,
      planningDone: true,
      fineTuneDone: false,
    });
    expect(state.statusSummary).toBe("今天聚焦需求确认、反馈整理和晚间复盘，先把高优事项推进到可交付状态。");
  });

  it("falls back to defaults when nested task-plan fields have invalid shapes", async () => {
    const root = makeTempRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "state.json"), JSON.stringify({
      voice: {
        transcript: 123,
        audioPath: 456,
        updatedAt: false,
      },
      pool: {
        items: [{ id: "", title: "", priority: "urgent", source: "未知" }],
      },
      schedule: {
        generationId: 123,
        revisionId: {},
        items: "bad-shape",
        confirmed: "yes",
      },
      roadmap: {
        view: "month",
        windowStart: 20240501,
        topLabel: [],
        windowLabel: {},
        groups: "bad-shape",
      },
      statusSummary: 999,
      morningFlow: {
        voiceDone: "true",
        diaryDone: 1,
        planningDone: false,
        fineTuneDone: null,
      },
    }, null, 2), "utf8");

    const state = await readTaskPlanState({ storageRoot: root });

    expect(state.voice).toEqual({
      transcript: "今天要先完成需求文档，再和产品确认功能逻辑，下午整理用户反馈，晚上复盘。",
      audioPath: null,
      updatedAt: "2026-04-24T00:00:00.000Z",
    });
    expect(state.pool.items[0]).toEqual({
      id: "pool-1",
      title: "完成需求文档初稿",
      priority: "high",
      source: "文字输入",
      stageId: "stage:待分组领域:未归类项目:待推进",
    });
    expect(state.schedule).toEqual({
      generationId: null,
      revisionId: null,
      items: [
        { id: "schedule-1", title: "完成需求文档初稿", startTime: "09:00", priority: "high" },
        { id: "schedule-2", title: "与开发确认功能逻辑", startTime: "10:30", priority: "high" },
        { id: "schedule-3", title: "整理用户反馈并归类", startTime: "14:00", priority: "mid" },
        { id: "schedule-4", title: "复盘项目进度", startTime: "16:00", priority: "cool" },
        { id: "schedule-5", title: "复盘今日完成情况", startTime: "19:30", priority: "low" },
      ],
      confirmed: false,
    });
    expect(state.roadmap).toEqual({
      view: "week",
      windowStart: "2024-05-01",
      topLabel: "领域 / 产品设计",
      windowLabel: "2024年5月",
      groups: [
        {
          id: "roadmap-group-1",
          title: "1. 产品 & 设计",
          items: [
            { id: "roadmap-item-1", title: "工作台改版" },
            { id: "roadmap-item-2", title: "任务追踪页优化" },
          ],
        },
        {
          id: "roadmap-group-2",
          title: "2. 用户研究",
          items: [
            { id: "roadmap-item-3", title: "用户访谈洞察" },
            { id: "roadmap-item-4", title: "访谈提要" },
          ],
        },
        {
          id: "roadmap-group-3",
          title: "3. 个人成长",
          items: [
            { id: "roadmap-item-5", title: "效率系统复盘" },
            { id: "roadmap-item-6", title: "阅读沉淀" },
          ],
        },
      ],
    });
    expect(state.statusSummary).toBe("今天聚焦需求确认、反馈整理和晚间复盘，先把高优事项推进到可交付状态。");
    expect(state.morningFlow).toEqual({
      voiceDone: false,
      diaryDone: false,
      planningDone: false,
      fineTuneDone: false,
    });
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-store-"));
  roots.push(root);
  return root;
}
