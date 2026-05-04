/**
 * Task-pool workflow recorder render helpers.
 *
 * The board owns layout and event wiring; this file keeps the recorder modal
 * and workflow-log snippets separate so the board renderer stays small.
 */
import { renderIcon } from "../../components/icon.js";
import type { TaskPoolBoardItem } from "./task-pool-board-data.js";

interface WorkflowRecorderRenderOptions {
  recorderOpen: boolean;
  recorderDraft: string;
  recorderFeedback: string | null;
}

export function renderWorkflowLog(item: TaskPoolBoardItem): string {
  const logs = item.workflowLog ?? [];
  if (logs.length === 0) return "";
  return `
    <section class="workspace-task-pool-board__workflow-log">
      <h4>工作流日志</h4>
      ${logs.slice(0, 5).map((log) => `
        <article>
          <strong>${escapeHtml(log.node)}</strong>
          <span>${escapeHtml(formatDateTime(log.recordedAt))}</span>
          <p>${escapeHtml(log.input)}</p>
          ${log.issue ? `<em>问题：${escapeHtml(log.issue)}</em>` : ""}
          ${log.nextStep ? `<em>下一步：${escapeHtml(log.nextStep)}</em>` : ""}
        </article>
      `).join("")}
    </section>
  `;
}

export function renderWorkflowRecorder(options: WorkflowRecorderRenderOptions): string {
  if (!options.recorderOpen) return "";
  return `
    <div class="workspace-task-pool-board__modal" role="dialog" aria-modal="true">
      <section class="workspace-task-pool-board__modal-card workspace-task-pool-board__recorder">
        <header>
          <h2>当前执行记录器</h2>
          <button type="button" class="icon-btn" data-workflow-recorder-close aria-label="关闭">${renderIcon("x", { size: 16 })}</button>
        </header>
        <p>随手写刚刚做了什么。系统会自动判断任务，写入任务卡工作流日志；不确定时进入待归档队列。</p>
        <textarea data-workflow-recorder-input placeholder="刚刚做了什么？遇到了什么问题？下一步是什么？">${escapeHtml(options.recorderDraft)}</textarea>
        <div class="workspace-task-pool-board__recorder-actions">
          <button type="button" class="btn btn-primary btn-inline" data-workflow-recorder-submit="normal">记录</button>
          <button type="button" class="btn btn-secondary btn-inline" data-workflow-recorder-submit="issue">记录并标记为问题</button>
          <button type="button" class="btn btn-secondary btn-inline" data-workflow-recorder-submit="end-node">记录并结束当前节点</button>
        </div>
        ${options.recorderFeedback ? `<div class="workspace-task-pool-board__recorder-status">${escapeHtml(options.recorderFeedback)}</div>` : ""}
      </section>
    </div>
  `;
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
