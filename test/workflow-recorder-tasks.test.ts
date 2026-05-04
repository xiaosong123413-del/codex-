/**
 * Verifies the desktop workflow recorder binds against the task-pool source of
 * truth and ranks the most relevant current tasks first.
 */
import { describe, expect, it } from "vitest";
import { selectWorkflowRecorderTasks } from "../desktop-webui/src/workflow-recorder-tasks.js";

describe("workflow recorder task selection", () => {
  it("prioritizes today's scheduled task-pool task before other active tasks", () => {
    const tasks = selectWorkflowRecorderTasks({
      schedule: {
        items: [
          { id: "schedule-1", title: "今天要推进的任务", startTime: "09:30", priority: "low" },
        ],
      },
      pool: {
        items: [
          task("far-high", "长期高优任务", { dueDate: "2026-12-31", priority: "high", zone: "mine" }),
          task("today", "今天要推进的任务", { priority: "low", zone: "candidate" }),
          task("soon", "明天截止任务", { dueDate: "05-04", priority: "low", zone: "ai" }),
          task("done", "已完成任务", { completedAt: "2026-05-03T08:00:00.000Z" }),
        ],
      },
    }, { today: new Date(2026, 4, 3), limit: 4 });

    expect(tasks.map((item) => item.id)).toEqual(["today", "soon", "far-high"]);
    expect(tasks[0]).toMatchObject({ title: "今天要推进的任务", badge: "今天 09:30" });
    expect(tasks[1]?.badge).toBe("近期截止");
  });

  it("keeps returned task ids identical to task-pool ids", () => {
    const tasks = selectWorkflowRecorderTasks({
      pool: {
        items: [
          task("pool-task-1", "整理需求变更记录文档", { project: "未归类项目", zone: "mine" }),
          task("pool-task-2", "准备用户访谈提纲", { project: "用户研究", zone: "mine" }),
        ],
      },
    });

    expect(tasks.map((item) => item.id)).toEqual(["pool-task-1", "pool-task-2"]);
    expect(tasks[0]).toMatchObject({ domain: "个人效率系统", project: "未归类项目" });
  });

  it("returns all active task-pool tasks by default so the recorder can scroll/search them", () => {
    const tasks = selectWorkflowRecorderTasks({
      pool: {
        items: [
          task("task-1", "任务一", { zone: "mine" }),
          task("task-2", "任务二", { zone: "mine" }),
          task("task-3", "任务三", { zone: "ai" }),
          task("task-4", "任务四", { zone: "ai" }),
          task("task-5", "任务五", { zone: "candidate" }),
          task("task-6", "任务六", { zone: "candidate" }),
          task("done", "已完成任务", { completedAt: "2026-05-03T08:00:00.000Z" }),
        ],
      },
    }, { today: new Date(2026, 4, 3) });

    expect(tasks.map((item) => item.id)).toEqual([
      "task-1",
      "task-2",
      "task-3",
      "task-4",
      "task-5",
      "task-6",
    ]);
  });
});

function task(
  id: string,
  title: string,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title,
    priority: "mid",
    source: "文字输入",
    domain: "个人效率系统",
    project: "个人App开发",
    zone: "mine",
    createdAt: "2026-05-01T08:00:00.000Z",
    ...patch,
  };
}
