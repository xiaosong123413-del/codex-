/**
 * Task-pool task explanation drawer renderer.
 *
 * The drawer explains why a task exists and where it sits in the user's work
 * hierarchy. It keeps the task standard visible at the point where generated
 * or current task cards are inspected, without changing task generation rules.
 */
import { renderIcon } from "../../components/icon.js";
import { renderWorkflowLog } from "./task-pool-workflow-recorder.js";
import type { TaskPoolBoardItem } from "./task-pool-board-data.js";

export function renderReasonDrawer(item: TaskPoolBoardItem | null): string {
  const open = item ? " is-open" : "";
  return `
    <aside class="workspace-task-pool-board__drawer${open}" aria-label="任务说明">
      <button type="button" class="icon-btn" data-task-pool-drawer-close aria-label="关闭">${renderIcon("x", { size: 16 })}</button>
      <h2>任务说明</h2>
      ${item ? renderReasonContent(item) : "<p>点击任务卡片后显示任务定义、层级归属和生成依据。</p>"}
    </aside>
  `;
}

function renderReasonContent(item: TaskPoolBoardItem): string {
  const reasons = readReasonPoints(item);
  const diary = item.diaryDate ? `<div class="workspace-task-pool-board__evidence">来源日记：${escapeHtml(item.diaryDate)}</div>` : "";
  return `
    <h3>${escapeHtml(item.title)}</h3>
    <div class="workspace-task-pool-board__reason-list">
      <article class="workspace-task-pool-board__reason-card">${escapeHtml(buildTaskDefinition(item))}</article>
      <article class="workspace-task-pool-board__reason-card">${escapeHtml(buildTaskHierarchy(item))}</article>
      ${reasons.map((reason) => `<article class="workspace-task-pool-board__reason-card">${escapeHtml(reason)}</article>`).join("")}
    </div>
    ${renderWorkflowLog(item)}
    <div class="workspace-task-pool-board__evidence">所属领域：${escapeHtml(readTaskArea(item))}</div>
    <div class="workspace-task-pool-board__evidence">所属项目：${escapeHtml(readTaskProject(item))}</div>
    ${diary}
  `;
}

function buildTaskDefinition(item: TaskPoolBoardItem): string {
  return `任务定义：这是“${item.title}”下需要持续跟踪、能验收、通常由多个行动完成的工作单元。`;
}

function buildTaskHierarchy(item: TaskPoolBoardItem): string {
  return `层级关系：领域“${readTaskArea(item)}” → 项目“${readTaskProject(item)}” → 任务“${item.title}” → 行动与执行记录。`;
}

function readReasonPoints(item: TaskPoolBoardItem): string[] {
  const points = splitReasonText(item.generatedReason);
  if (points.length === 0) {
    return [`生成依据：这项任务来自任务池来源“${item.source}”，后续应跟踪当前进度、下一步和执行记录。`];
  }
  return points.map((point) => normalizeReasonSentence(point, item));
}

function splitReasonText(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\n+|[；;]/)
    .map((line) => line.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter((line) => line.length > 0);
}

function normalizeReasonSentence(point: string, item: TaskPoolBoardItem): string {
  if (point.includes("结合") && point.includes("新增任务")) {
    return point;
  }
  const diaryDate = formatReasonDiaryDate(item.diaryDate);
  if (!diaryDate) {
    return `生成依据：结合任务池信息“${point}”，因此关注任务“${item.title}”。`;
  }
  return `生成依据：结合${diaryDate}日记说“${point}”，因此新增任务“${item.title}”。`;
}

function formatReasonDiaryDate(value: string | undefined): string | null {
  const first = value?.split(/[、,，\s]+/).find((part) => part.trim().length > 0)?.trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(first ?? "");
  if (!match) {
    return first || null;
  }
  return `${match[1]}-${Number(match[2])}-${Number(match[3])}`;
}

function readTaskArea(item: TaskPoolBoardItem): string {
  return item.domain || "未分领域";
}

function readTaskProject(item: TaskPoolBoardItem): string {
  return item.project || "未分项目";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return escaped[character] ?? character;
  });
}
