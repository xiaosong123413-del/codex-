/**
 * Comment and log panel helpers for the automation workspace.
 *
 * These helpers keep DOM template code out of the page entry module while
 * preserving the page's state-driven interactions.
 */

import {
  createAutomationComment,
  deleteAutomationComment,
  fetchAutomationLogs,
  type AutomationCommentDraftTarget,
  type AutomationCommentResponse,
} from "./api.js";
import {
  resolveCommentPinPosition,
  resolveMermaidDraftTarget,
} from "./mermaid-comments.js";
import type { RenderedMermaidSurface } from "./mermaid-view.js";

export interface AutomationCommentPanelState {
  comments: AutomationCommentResponse[];
  commentMode: boolean;
  selectedCommentId: string | null;
  draft: AutomationCommentDraftTarget | null;
  draftLabel: string | null;
  targetLabels: Record<string, string>;
  orphanedCommentIds: ReadonlySet<string>;
}

interface AutomationCommentPanelHandlers {
  onSaveDraft: (text: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onSelectComment: (commentId: string) => void;
  onClosePanel: () => void;
}

export async function loadAutomationLogs(root: HTMLElement, automationId: string): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-automation-log-status]");
  const list = root.querySelector<HTMLElement>("[data-automation-log-list]");
  if (!status || !list) {
    return;
  }
  try {
    const logs = await fetchAutomationLogs(automationId);
    status.textContent = logs.length === 0 ? "暂无运行记录。" : `最近 ${logs.length} 条运行记录`;
    list.innerHTML = logs.map((log) => `
      <article class="automation-log-page__item">
        <strong>${escapeHtml(log.summary)}</strong>
        <span>${escapeHtml(log.status)}</span>
      </article>
    `).join("");
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

export function renderAutomationCommentPanel(
  panel: HTMLElement,
  state: AutomationCommentPanelState,
  handlers: AutomationCommentPanelHandlers,
): void {
  panel.innerHTML = `
    <header class="automation-detail__comment-panel-head">
      <div>
        <strong class="automation-detail__comment-panel-title">评论</strong>
        <div class="automation-detail__comment-panel-meta">共 ${state.comments.length} 条</div>
      </div>
      <button type="button" class="btn btn-secondary" data-automation-comment-close>关闭</button>
    </header>
    <div data-automation-comment-body></div>
  `;
  const body = panel.querySelector<HTMLElement>("[data-automation-comment-body]");
  if (!body) {
    return;
  }
  renderAutomationCommentPanelContent(body, state, handlers);
  panel.querySelector<HTMLButtonElement>("[data-automation-comment-close]")?.addEventListener("click", () => {
    clearCommentPanelError(body);
    handlers.onClosePanel();
  });
}

function renderAutomationCommentPanelContent(
  panel: HTMLElement,
  state: AutomationCommentPanelState,
  handlers: Omit<AutomationCommentPanelHandlers, "onClosePanel">,
): void {
  panel.innerHTML = createAutomationCommentPanelBodyHtml(state);
  bindCommentPanel(panel, state, handlers);
}

function bindCommentPanel(
  panel: HTMLElement,
  state: AutomationCommentPanelState,
  handlers: Omit<AutomationCommentPanelHandlers, "onClosePanel">,
): void {
  panel.querySelector<HTMLButtonElement>("[data-automation-comment-save]")?.addEventListener("click", async () => {
    const input = panel.querySelector<HTMLTextAreaElement>("[data-automation-comment-input]");
    if (!state.draft || !input) {
      return;
    }
    clearCommentPanelError(panel);
    try {
      await handlers.onSaveDraft(input.value.trim());
    } catch (error) {
      showCommentPanelError(panel, error);
    }
  });
  panel.querySelectorAll<HTMLButtonElement>("[data-automation-comment-select]").forEach((button) => {
    button.addEventListener("click", () => {
      clearCommentPanelError(panel);
      handlers.onSelectComment(button.dataset.automationCommentSelect ?? "");
    });
  });
  panel.querySelectorAll<HTMLButtonElement>("[data-automation-comment-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      clearCommentPanelError(panel);
      try {
        await handlers.onDeleteComment(button.dataset.automationCommentDelete ?? "");
      } catch (error) {
        showCommentPanelError(panel, error);
      }
    });
  });
}

function createAutomationCommentPanelBodyHtml(state: AutomationCommentPanelState): string {
  return `
    <div class="automation-detail__comment-hint">${getCommentHint(state)}</div>
    <div data-automation-comment-error hidden></div>
    ${state.draft ? `
      <div class="automation-detail__comment-item">
        <strong>${escapeHtml(getDraftLabel(state))}</strong>
        <textarea class="automation-detail__comment-input" data-automation-comment-input placeholder="输入评论"></textarea>
        <button type="button" class="btn btn-primary" data-automation-comment-save>保存评论</button>
      </div>
    ` : ""}
    <div class="automation-detail__comment-list">
      ${state.comments.map((comment) => `
        <article class="automation-detail__comment-item" data-selected="${comment.id === state.selectedCommentId ? "true" : "false"}">
          <button type="button" class="btn btn-secondary" data-automation-comment-select="${escapeAttr(comment.id)}">${escapeHtml(getCommentTitle(comment, state))}</button>
          <div>${escapeHtml(comment.text)}</div>
          ${state.orphanedCommentIds.has(comment.id) ? "<div>原目标已不存在，当前显示为保留图钉。</div>" : ""}
          <button type="button" class="btn btn-secondary" data-automation-comment-delete="${escapeAttr(comment.id)}">删除</button>
        </article>
      `).join("")}
    </div>
  `;
}

export async function createAutomationDraftComment(
  automationId: string,
  draft: AutomationCommentDraftTarget,
  text: string,
): Promise<AutomationCommentResponse | null> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  return createAutomationComment(automationId, {
    targetType: draft.targetType,
    targetId: draft.targetId,
    text: trimmed,
    pinnedX: draft.pinnedX,
    pinnedY: draft.pinnedY,
  });
}

async function deleteAutomationExistingComment(automationId: string, commentId: string): Promise<void> {
  if (commentId === "") {
    return;
  }
  await deleteAutomationComment(automationId, commentId);
}

function getCommentHint(state: AutomationCommentPanelState): string {
  if (state.draft) {
    return "已选中图上目标，输入评论后保存。";
  }
  if (state.commentMode) {
    return "评论模式已开启，点击节点、连线或空白处落点。";
  }
  if (state.comments.length > 0) {
    return "可从列表选择已有评论，或进入评论模式继续添加。";
  }
  return "进入评论模式后，再点击节点、连线或空白处添加评论。";
}

function getDraftLabel(state: AutomationCommentPanelState): string {
  if (!state.draft) {
    return "";
  }
  if (state.draft.targetType === "canvas") {
    return "当前草稿: 画布空白处";
  }
  return `当前草稿: ${state.draftLabel ?? state.draft.targetId}`;
}

function getCommentTitle(comment: AutomationCommentResponse, state: AutomationCommentPanelState): string {
  return state.targetLabels[comment.id] ?? (comment.targetType === "canvas" ? "画布空白处" : comment.targetId);
}

export async function removeAutomationComment(
  automationId: string,
  commentId: string,
): Promise<void> {
  await deleteAutomationExistingComment(automationId, commentId);
}

export function renderAutomationCommentPins(
  surface: RenderedMermaidSurface,
  comments: AutomationCommentResponse[],
  selectedCommentId: string | null,
  onSelectComment: (commentId: string) => void,
): ReadonlySet<string> {
  const orphanedCommentIds = new Set<string>();
  surface.pinsHost.innerHTML = comments.map((comment) => {
    const position = resolveCommentPinPosition(comment, surface.anchors);
    if (position.orphaned) {
      orphanedCommentIds.add(comment.id);
    }
    return `
      <button
        type="button"
        class="automation-detail__comment-pin"
        data-automation-comment-pin="${escapeHtml(comment.id)}"
        data-selected="${comment.id === selectedCommentId ? "true" : "false"}"
        data-orphaned="${position.orphaned ? "true" : "false"}"
        style="left:${position.x}px;top:${position.y}px"
        title="${escapeHtml(comment.text)}"
      ></button>
    `;
  }).join("");
  surface.pinsHost.querySelectorAll<HTMLButtonElement>("[data-automation-comment-pin]").forEach((button) => {
    button.addEventListener("click", () => {
      onSelectComment(button.dataset.automationCommentPin ?? "");
    });
  });
  return orphanedCommentIds;
}

export function bindAutomationCommentTargets(
  surface: RenderedMermaidSurface,
  commentMode: boolean,
  onCreateDraft: (draftTarget: AutomationCommentDraftTarget) => void,
): void {
  if (!commentMode) {
    return;
  }
  surface.surface.addEventListener("click", (event) => {
    const draftTarget = resolveMermaidDraftTarget(surface, event.target, event);
    if (!draftTarget) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onCreateDraft(draftTarget);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function clearCommentPanelError(panel: HTMLElement): void {
  const error = panel.querySelector<HTMLElement>("[data-automation-comment-error]");
  if (!error) {
    return;
  }
  error.hidden = true;
  error.textContent = "";
}

function showCommentPanelError(panel: HTMLElement, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorBanner = panel.querySelector<HTMLElement>("[data-automation-comment-error]");
  if (!errorBanner) {
    return;
  }
  errorBanner.hidden = false;
  errorBanner.textContent = errorMessage || "评论操作失败。";
}
