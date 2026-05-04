/**
 * Task-pool board renderer.
 *
 * The workspace page owns state and API calls; this module only renders the
 * task-pool source-of-truth surface. Keeping the board markup here prevents the
 * already large workspace route from absorbing a second complex layout.
 */
import { renderIcon } from "../../components/icon.js";
import { renderReasonDrawer } from "./task-pool-reason-drawer.js";
import { renderWorkflowRecorder } from "./task-pool-workflow-recorder.js";
import {
  TASK_POOL_GROUP_LABELS,
  TASK_POOL_SORT_LABELS,
  groupTaskPoolBoardItems,
  normalizePriority,
  priorityLabel,
  readTaskPoolBoardZone,
  sortTaskPoolBoardItems,
  type TaskPoolBoardGroup,
  type TaskPoolBoardGroupMode,
  type TaskPoolBoardGroupModes,
  type TaskPoolBoardItem,
  type TaskPoolBoardSortMode,
  type TaskPoolBoardSortModes,
  type TaskPoolBoardZone,
} from "./task-pool-board-data.js";

export { TASK_POOL_SORT_LABELS, readTaskPoolBoardZone, sortTaskPoolBoardItems };
export type {
  TaskPoolBoardGroupMode,
  TaskPoolBoardGroupModes,
  TaskPoolBoardSortMode,
  TaskPoolBoardSortModes,
  TaskPoolBoardZone,
};

interface TaskPoolGenerationRecord {
  id: string;
  generatedAt: string;
  diaryPaths: string[];
  diaryDates: string[];
  createdTaskIds: string[];
  skippedDuplicateTitles: string[];
}

interface TaskPoolBoardState {
  items: readonly TaskPoolBoardItem[];
  generationRecords?: readonly TaskPoolGenerationRecord[];
}

interface RenderTaskPoolBoardOptions {
  pool: TaskPoolBoardState;
  selectedCandidateId: string | null;
  recordsOpen: boolean;
  recorderOpen: boolean;
  recorderDraft: string;
  recorderFeedback: string | null;
  busy: boolean;
  feedback: string | null;
  error: string | null;
  sortModes?: Partial<TaskPoolBoardSortModes> | undefined;
  groupModes?: Partial<TaskPoolBoardGroupModes> | undefined;
}

const DEFAULT_TASK_POOL_SORT_MODES: TaskPoolBoardSortModes = {
  mine: "created-desc",
  ai: "created-desc",
  candidate: "created-desc",
};

const DEFAULT_TASK_POOL_GROUP_MODES: TaskPoolBoardGroupModes = {
  mine: "none",
  ai: "none",
  candidate: "none",
};

export function renderTaskPoolBoard(options: RenderTaskPoolBoardOptions): string {
  const sortModes = normalizeTaskPoolSortModes(options.sortModes);
  const groupModes = normalizeTaskPoolGroupModes(options.groupModes);
  const mine = sortTaskPoolBoardItems(filterZoneItems(options.pool.items, "mine"), sortModes.mine);
  const ai = sortTaskPoolBoardItems(filterZoneItems(options.pool.items, "ai"), sortModes.ai);
  const candidate = sortTaskPoolBoardItems(filterZoneItems(options.pool.items, "candidate"), sortModes.candidate);
  const selected = options.pool.items.find((item) => item.id === options.selectedCandidateId) ?? null;
  const latestRecord = options.pool.generationRecords?.[0] ?? null;
  return `
    <section class="workspace-view workspace-view--task-pool" data-workspace-view="task-pool">
      <div class="workspace-task-pool-board">
        ${renderBoardTopbar(options)}
        <div class="workspace-task-pool-board__grid">
          <section class="workspace-task-pool-board__panel workspace-task-pool-board__panel--current">
            <h2>当前任务区</h2>
            <div class="workspace-task-pool-board__current-zones">
              ${renderDropZone("mine", "我要做的", mine, options.busy, sortModes.mine, groupModes.mine)}
              ${renderDropZone("ai", "AI 要做的", ai, options.busy, sortModes.ai, groupModes.ai)}
            </div>
          </section>
          <section class="workspace-task-pool-board__panel workspace-task-pool-board__panel--candidate">
            <h2>备选区</h2>
            ${renderBatchSummary(latestRecord)}
            <p class="workspace-task-pool-board__note">这些任务由 AI 根据近日日记生成，拖到左侧后进入当前执行池。</p>
            ${renderDropZone("candidate", "", candidate, options.busy, sortModes.candidate, groupModes.candidate)}
          </section>
        </div>
        ${renderReasonDrawer(selected)}
        ${renderWorkflowRecorder(options)}
        ${renderGenerationRecords(options.pool.generationRecords ?? [], options.recordsOpen)}
      </div>
    </section>
  `;
}

function normalizeTaskPoolSortModes(
  modes: Partial<TaskPoolBoardSortModes> | undefined,
): TaskPoolBoardSortModes {
  return {
    mine: modes?.mine ?? DEFAULT_TASK_POOL_SORT_MODES.mine,
    ai: modes?.ai ?? DEFAULT_TASK_POOL_SORT_MODES.ai,
    candidate: modes?.candidate ?? DEFAULT_TASK_POOL_SORT_MODES.candidate,
  };
}

function normalizeTaskPoolGroupModes(
  modes: Partial<TaskPoolBoardGroupModes> | undefined,
): TaskPoolBoardGroupModes {
  return {
    mine: modes?.mine ?? DEFAULT_TASK_POOL_GROUP_MODES.mine,
    ai: modes?.ai ?? DEFAULT_TASK_POOL_GROUP_MODES.ai,
    candidate: modes?.candidate ?? DEFAULT_TASK_POOL_GROUP_MODES.candidate,
  };
}

function renderBoardTopbar(options: RenderTaskPoolBoardOptions): string {
  const status = options.error ?? options.feedback ?? "主事实源：任务池页 · 已同步";
  return `
    <header class="workspace-task-pool-board__topbar">
      <button type="button" class="btn btn-primary btn-inline" data-task-pool-generate ${options.busy ? "disabled" : ""}>
        ${renderIcon("plus", { size: 16 })}<span>根据近日日记生成任务</span>
      </button>
      <button type="button" class="btn btn-secondary btn-inline" data-task-pool-records>
        ${renderIcon("clipboard-list", { size: 16 })}<span>查看生成记录</span>
      </button>
      <button type="button" class="btn btn-secondary btn-inline" data-task-pool-sync ${options.busy ? "disabled" : ""}>
        ${renderIcon("refresh-cw", { size: 16 })}<span>同步任务计划页</span>
      </button>
      <div class="workspace-task-pool-board__status" data-error="${options.error ? "true" : "false"}">
        <span></span><strong>${escapeHtml(status)}</strong>
      </div>
    </header>
  `;
}

function renderDropZone(
  zone: TaskPoolBoardZone,
  title: string,
  items: readonly TaskPoolBoardItem[],
  busy: boolean,
  sortMode: TaskPoolBoardSortMode,
  groupMode: TaskPoolBoardGroupMode,
): string {
  const heading = renderZoneHead(zone, title, items.length, sortMode, groupMode);
  const groups = groupTaskPoolBoardItems(items, groupMode);
  return `
    <section class="workspace-task-pool-board__zone" data-task-pool-drop-zone="${zone}">
      ${heading}
      <div class="workspace-task-pool-board__cards">
        ${groups.map((group) => renderTaskGroup(group, zone, busy, groupMode)).join("")}
      </div>
    </section>
  `;
}

function renderZoneHead(
  zone: TaskPoolBoardZone,
  title: string,
  count: number,
  sortMode: TaskPoolBoardSortMode,
  groupMode: TaskPoolBoardGroupMode,
): string {
  const titleHtml = title ? `<h3>${title}</h3><span>${count}</span>` : `<strong>排序</strong>`;
  return `
    <div class="workspace-task-pool-board__zone-head">
      <div class="workspace-task-pool-board__zone-title">${titleHtml}</div>
      <div class="workspace-task-pool-board__zone-controls">
        ${renderZoneSelect("排序", `data-task-pool-sort-zone="${zone}"`, TASK_POOL_SORT_LABELS, sortMode)}
        ${renderZoneSelect("分组", `data-task-pool-group-zone="${zone}"`, TASK_POOL_GROUP_LABELS, groupMode)}
      </div>
    </div>
  `;
}

function renderZoneSelect<T extends string>(
  label: string,
  dataAttribute: string,
  labels: Record<T, string>,
  activeValue: T,
): string {
  return `
    <label class="workspace-task-pool-board__select">
      <span>${label}</span>
      <select ${dataAttribute}>
        ${(Object.keys(labels) as T[]).map((value) => `
          <option value="${value}" ${value === activeValue ? "selected" : ""}>${labels[value]}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function renderTaskGroup(
  group: TaskPoolBoardGroup<TaskPoolBoardItem>,
  zone: TaskPoolBoardZone,
  busy: boolean,
  groupMode: TaskPoolBoardGroupMode,
): string {
  const cards = group.items.map((item) => renderTaskCard(item, zone, busy)).join("");
  if (groupMode === "none") {
    return cards;
  }
  return `
    <section class="workspace-task-pool-board__group" data-task-pool-group="${escapeHtml(group.key)}">
      <h4>${escapeHtml(group.title)}<span>${group.items.length}</span></h4>
      ${cards}
    </section>
  `;
}

function renderTaskCard(
  item: TaskPoolBoardItem,
  zone: TaskPoolBoardZone,
  busy: boolean,
): string {
  const priority = normalizePriority(item.priority);
  const owner = readTaskCardOwner(item, zone);
  return `
    <article class="workspace-task-pool-board__card" draggable="${busy ? "false" : "true"}" data-task-pool-card="${escapeHtml(item.id)}" data-task-pool-card-zone="${zone}">
      <span class="workspace-task-pool-board__drag">⋮</span>
      <span class="workspace-task-pool-board__icon">${renderIcon(zone === "ai" ? "hammer" : "copy", { size: 15 })}</span>
      <div class="workspace-task-pool-board__main">
        <h4 title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h4>
        <p>项目：${escapeHtml(item.project || item.domain || "个人知识系统")}</p>
        ${renderTaskCardSourceLine(item, zone)}
      </div>
      <span class="workspace-task-pool-board__priority workspace-task-pool-board__priority--${priority}">${priorityLabel(priority)}</span>
      <span class="workspace-task-pool-board__due">${escapeHtml(item.dueDate || "未设截止")}</span>
      <span class="workspace-task-pool-board__owner" data-owner="${owner === "AI" ? "ai" : "me"}">${owner}</span>
      ${renderTaskCardActions(item, busy)}
    </article>
  `;
}

function readTaskCardOwner(item: TaskPoolBoardItem, zone: TaskPoolBoardZone): "AI" | "我" {
  return zone === "ai" || item.owner === "ai" ? "AI" : "我";
}

function renderTaskCardSourceLine(item: TaskPoolBoardItem, zone: TaskPoolBoardZone): string {
  return zone === "candidate" ? "" : `<p>来源：${escapeHtml(item.source)}</p>`;
}

function renderTaskCardActions(item: TaskPoolBoardItem, busy: boolean): string {
  const disabled = busy ? "disabled" : "";
  return `
    <span class="workspace-task-pool-board__actions">
      <button type="button" data-task-pool-complete="${escapeHtml(item.id)}" aria-label="完成：${escapeHtml(item.title)}" ${disabled}>
        ${renderIcon("check-circle-2", { size: 13 })}
      </button>
      <button type="button" data-task-pool-delete="${escapeHtml(item.id)}" aria-label="删除：${escapeHtml(item.title)}" ${disabled}>
        ${renderIcon("x", { size: 13 })}
      </button>
    </span>
  `;
}

function renderBatchSummary(record: TaskPoolGenerationRecord | null): string {
  if (!record) {
    return `<div class="workspace-task-pool-board__batch-summary"><strong>尚未生成任务</strong><span>点击左上按钮后，会记录本批次使用的日记。</span></div>`;
  }
  return `
    <div class="workspace-task-pool-board__batch-summary">
      <strong>生成批次：${escapeHtml(formatDateTime(record.generatedAt))}</strong>
      <span>来源日记：${escapeHtml(record.diaryDates.join("、") || "无")}</span>
      <span>生成 ${record.createdTaskIds.length} 个，跳过重复 ${record.skippedDuplicateTitles.length} 个</span>
    </div>
  `;
}

function renderGenerationRecords(records: readonly TaskPoolGenerationRecord[], open: boolean): string {
  if (!open) {
    return "";
  }
  return `
    <div class="workspace-task-pool-board__modal" role="dialog" aria-modal="true">
      <section class="workspace-task-pool-board__modal-card">
        <header><h2>生成记录</h2><button type="button" class="icon-btn" data-task-pool-records-close aria-label="关闭">${renderIcon("x", { size: 16 })}</button></header>
        <div class="workspace-task-pool-board__records">
          ${records.length > 0 ? records.map(renderGenerationRecord).join("") : "<p>还没有生成记录。</p>"}
        </div>
      </section>
    </div>
  `;
}

function renderGenerationRecord(record: TaskPoolGenerationRecord): string {
  return `
    <article class="workspace-task-pool-board__record">
      <strong>${escapeHtml(formatDateTime(record.generatedAt))}</strong>
      <span>使用日记：${escapeHtml(record.diaryDates.join("、") || record.diaryPaths.join("、"))}</span>
      <span>生成 ${record.createdTaskIds.length} 个，跳过重复 ${record.skippedDuplicateTitles.length} 个</span>
    </article>
  `;
}

function filterZoneItems(
  items: readonly TaskPoolBoardItem[],
  zone: TaskPoolBoardZone,
): TaskPoolBoardItem[] {
  return items.filter((item) => !item.completedAt && readTaskPoolBoardZone(item) === zone);
}

function formatDateTime(value: string): string {
  return Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return escaped[character] ?? character;
  });
}
