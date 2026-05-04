/**
 * Automation workspace list, detail, and log pages.
 *
 * The list page mirrors the white-card overview from the approved mockup.
 * Detail and log routes stay independent full-page views so the shell router
 * can mount them without reusing the settings editor surface.
 */

import {
  fetchAutomationDetail,
  fetchAutomationList,
  type AutomationCommentDraftTarget,
  type AutomationDetailResponse,
  type AutomationListItem,
} from "./api.js";
import {
  bindAutomationCommentSidebarResize,
  closeAutomationCommentSidebar,
  createAutomationCommentSidebarState,
  openAutomationCommentSidebar,
  syncAutomationCommentSidebar,
} from "./comment-sidebar.js";
import {
  renderAutomationDetailComments,
  type AutomationDetailCommentState,
} from "./detail-comments.js";
import { pickSelectedAutomationCommentId } from "./detail-comment-model.js";
import {
  createAutomationDetailViewToggleHtml,
  resolveAutomationDetailViewMode,
  type AutomationDetailViewMode,
} from "./detail-view-mode.js";
import { bindAutomationWorkspaceLiveRefresh } from "./live-events.js";
import {
  createAutomationListSectionHtml,
  getSourceLabel,
  isCodeItem,
  isExecutableItem,
  isInformationItem,
} from "./rendering.js";
import { loadAutomationLogs } from "./panels.js";

type DisposableAutomationRoute = HTMLElement & { __dispose?: () => void };
interface AutomationWorkspaceRouteOptions {
  homeHash?: string;
  onNavigate?: (target: AutomationWorkspaceRouteTarget) => void;
}

interface AutomationWorkspaceRouteTarget {
  automationId?: string;
  automationLogId?: string;
}

const WORKFLOW_LABEL = "Workflow";
const WORKFLOW_LOG_EYEBROW = "WORKFLOW LOG";
const WORKFLOW_LIST_EYEBROW = "WORKFLOW";
const WORKFLOW_DETAIL_EYEBROW = "WORKFLOW DETAIL";
const DEFAULT_WORKFLOW_HOME_HASH = "#/automation";

export function renderAutomationWorkspacePage(
  automationId?: string,
  options: AutomationWorkspaceRouteOptions = {},
): HTMLElement {
  return automationId ? renderAutomationDetailPage(automationId, options) : renderAutomationListPage(options);
}

export function renderAutomationLogPage(
  automationId = "",
  options: AutomationWorkspaceRouteOptions = {},
): HTMLElement {
  const homeHash = options.homeHash ?? DEFAULT_WORKFLOW_HOME_HASH;
  const root = document.createElement("section") as DisposableAutomationRoute;
  root.className = "automation-route";
  root.dataset.automationScroll = "";
  root.innerHTML = `
    <section class="automation-log-page">
      <header class="automation-log-page__header">
        <div>
          <div class="automation-page__eyebrow">${WORKFLOW_LOG_EYEBROW}</div>
          <h1>运行日志</h1>
        </div>
        <button type="button" class="btn btn-secondary" data-automation-log-back>返回 ${WORKFLOW_LABEL}</button>
      </header>
      <div class="automation-log-page__status" data-automation-log-status>正在读取日志...</div>
      <div class="automation-log-page__list" data-automation-log-list></div>
    </section>
  `;
  root.querySelector<HTMLButtonElement>("[data-automation-log-back]")?.addEventListener("click", () => {
    if (options.onNavigate) {
      options.onNavigate({});
      return;
    }
    window.location.hash = homeHash;
  });
  void loadAutomationLogs(root, automationId);
  return root;
}

function renderAutomationListPage(options: AutomationWorkspaceRouteOptions): HTMLElement {
  const root = document.createElement("section") as DisposableAutomationRoute;
  root.className = "automation-route";
  root.dataset.automationScroll = "";
  root.innerHTML = `
    <section class="automation-page automation-page--list">
      <header class="automation-page__header">
        <div>
          <div class="automation-page__eyebrow">${WORKFLOW_LIST_EYEBROW}</div>
          <h1>${WORKFLOW_LABEL}</h1>
          <p>查看并管理所有 workflow。</p>
        </div>
        <label class="automation-page__search">
          <input type="search" placeholder="搜索 Workflow 名称 / 流程说明" data-automation-search />
        </label>
      </header>
      <div class="automation-page__status" data-automation-status>正在读取 Workflow...</div>
      <div class="automation-page__list" data-automation-list></div>
    </section>
  `;
  bindAutomationListPage(root, options);
  return root;
}

function renderAutomationDetailPage(
  automationId: string,
  options: AutomationWorkspaceRouteOptions,
): HTMLElement {
  const homeHash = options.homeHash ?? DEFAULT_WORKFLOW_HOME_HASH;
  const root = document.createElement("section") as DisposableAutomationRoute;
  root.className = "automation-route automation-route--detail";
  root.dataset.automationScroll = "";
  root.innerHTML = `
    <section class="automation-page automation-page--detail">
      <header class="automation-detail__header" data-automation-detail-header>
        <div class="automation-detail__header-main">
          <div class="automation-page__eyebrow">${WORKFLOW_DETAIL_EYEBROW}</div>
          <div class="automation-page__status" data-automation-detail-status>正在读取 Workflow 详情...</div>
        </div>
        <div class="automation-detail__header-actions">
          <button type="button" class="btn btn-secondary" data-automation-back>返回 ${WORKFLOW_LABEL}</button>
        </div>
      </header>
      <section class="automation-detail__body">
        <div class="automation-detail__canvas" data-automation-canvas-wrap></div>
        <div
          class="automation-detail__comment-resize"
          data-automation-comment-resize
          aria-hidden="true"
        ></div>
        <aside class="automation-detail__comment-panel" data-automation-comment-panel></aside>
      </section>
    </section>
  `;
  root.querySelector<HTMLButtonElement>("[data-automation-back]")?.addEventListener("click", () => {
    if (options.onNavigate) {
      options.onNavigate({});
      return;
    }
    window.location.hash = homeHash;
  });
  bindAutomationDetailPage(root, automationId, options);
  return root;
}

function bindAutomationListPage(
  root: DisposableAutomationRoute,
  options: AutomationWorkspaceRouteOptions,
): void {
  const state = { query: "", items: [] as AutomationListItem[] };
  const refresh = async () => {
    try {
      state.items = await fetchAutomationList();
      renderAutomationList(root, state, options);
    } catch (error) {
      const status = root.querySelector<HTMLElement>("[data-automation-status]");
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  root.querySelector<HTMLInputElement>("[data-automation-search]")?.addEventListener("input", (event) => {
    state.query = (event.currentTarget as HTMLInputElement).value.trim();
    renderAutomationList(root, state, options);
  });
  root.__dispose = bindAutomationWorkspaceLiveRefresh(refresh);
  void refresh();
}

function renderAutomationList(
  root: HTMLElement,
  state: { query: string; items: AutomationListItem[] },
  options: AutomationWorkspaceRouteOptions,
): void {
  const list = root.querySelector<HTMLElement>("[data-automation-list]");
  const status = root.querySelector<HTMLElement>("[data-automation-status]");
  if (!list || !status) return;
  const filteredItems = state.items.filter((item) => matchesAutomationQuery(item, state.query));
  const executableItems = filteredItems.filter(isExecutableItem);
  const informationItems = filteredItems.filter(isInformationItem);
  const codeItems = filteredItems.filter(isCodeItem);
  const sections = createAutomationListSections(executableItems, informationItems, codeItems);
  const visibleCount = executableItems.length + informationItems.length + codeItems.length;

  status.textContent = visibleCount === 0 ? "没有匹配的 Workflow。" : `共 ${visibleCount} 项`;
  list.innerHTML = sections.map(createAutomationListSectionHtml).join("");
  bindAutomationListActions(list, options);
}

function matchesAutomationQuery(item: AutomationListItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return `${item.name} ${item.summary} ${item.trigger}`.toLowerCase().includes(normalizedQuery);
}

function createAutomationListSections(
  executableItems: AutomationListItem[],
  informationItems: AutomationListItem[],
  codeItems: AutomationListItem[],
): Array<{ title: string; description: string; items: AutomationListItem[] }> {
  const sections: Array<{ title: string; description: string; items: AutomationListItem[] }> = [];
  if (executableItems.length > 0) {
    sections.push({
      title: "应用流程",
      description: "这里展示当前可执行的显式 workflow 和应用内流程。",
      items: executableItems,
    });
  }
  if (informationItems.length > 0) {
    sections.push({
      title: "信息流转流程",
      description: "这里展示输入信息在触发器、读取内容、生成动作和落点之间的真实流向。",
      items: informationItems,
    });
  }
  if (codeItems.length > 0) {
    sections.push({
      title: "源码真实流程",
      description: "这里展示能直接追溯到当前源码入口函数、分支条件和应用调用的真实 DAG。",
      items: codeItems,
    });
  }
  return sections;
}

function bindAutomationListActions(
  list: HTMLElement,
  options: AutomationWorkspaceRouteOptions,
): void {
  list.querySelectorAll<HTMLButtonElement>("[data-automation-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const automationId = button.dataset.automationOpen ?? "";
      if (options.onNavigate) {
        options.onNavigate({ automationId });
        return;
      }
      window.location.hash = `#/automation/${encodeURIComponent(automationId)}`;
    });
  });
  list.querySelectorAll<HTMLButtonElement>("[data-automation-log]").forEach((button) => {
    button.addEventListener("click", () => {
      const automationLogId = button.dataset.automationLog ?? "";
      if (options.onNavigate) {
        options.onNavigate({ automationLogId });
        return;
      }
      window.location.hash = `#/automation-log/${encodeURIComponent(automationLogId)}`;
    });
  });
}

function bindAutomationDetailPage(
  root: DisposableAutomationRoute,
  automationId: string,
  options: AutomationWorkspaceRouteOptions,
): void {
  const state: AutomationDetailCommentState = {
    ...createAutomationCommentSidebarState(),
    detail: null as AutomationDetailResponse | null,
    commentMode: false,
    draftTarget: null as AutomationCommentDraftTarget | null,
    selectedCommentId: null as string | null,
    selectedInsightNodeId: null as string | null,
    detailViewMode: null as AutomationDetailViewMode | null,
    viewport: {},
  };
  const refresh = async () => {
    try {
      const detail = await fetchAutomationDetail(automationId);
      state.detail = detail;
      state.selectedCommentId = pickSelectedAutomationCommentId(detail.comments, state.selectedCommentId);
      state.detailViewMode = resolveAutomationDetailViewMode(detail, state.detailViewMode);
      renderAutomationDetail(root, automationId, state, options);
    } catch (error) {
      const status = root.querySelector<HTMLElement>("[data-automation-detail-status]");
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  root.__dispose = bindAutomationWorkspaceLiveRefresh(refresh);
  void refresh();
}

function renderAutomationDetail(
  root: HTMLElement,
  automationId: string,
  state: AutomationDetailCommentState,
  options: AutomationWorkspaceRouteOptions,
): void {
  const elements = getAutomationDetailElements(root);
  if (!elements || !state.detail) {
    return;
  }

  const automation = state.detail.automation;
  elements.body.dataset.automationViewMode = state.detailViewMode ?? "mermaid";
  elements.body.dataset.automationSpecPanel = hasOpenAutomationSpecPanel(automation, state) ? "true" : "false";
  syncAutomationCommentSidebar(elements, state);
  bindAutomationCommentSidebarResize(elements, state);
  renderAutomationDetailHeader(elements.header, automation, automationId, state, () => {
    renderAutomationDetail(root, automationId, state, options);
  }, options);
  void renderAutomationDetailComments(
    { canvasWrap: elements.canvasWrap, commentPanel: elements.commentPanel },
    automationId,
    state,
    () => renderAutomationDetail(root, automationId, state, options),
  );
}

function hasOpenAutomationSpecPanel(
  automation: AutomationDetailResponse["automation"],
  state: AutomationDetailCommentState,
): boolean {
  return Boolean(automation.sourceInsight && state.selectedInsightNodeId);
}

function getAutomationDetailElements(root: HTMLElement): {
  header: HTMLElement;
  body: HTMLElement;
  canvasWrap: HTMLElement;
  commentPanel: HTMLElement;
  resizeHandle: HTMLElement;
} | null {
  const header = root.querySelector<HTMLElement>("[data-automation-detail-header]");
  const body = root.querySelector<HTMLElement>(".automation-detail__body");
  const canvasWrap = root.querySelector<HTMLElement>("[data-automation-canvas-wrap]");
  const commentPanel = root.querySelector<HTMLElement>("[data-automation-comment-panel]");
  const resizeHandle = root.querySelector<HTMLElement>("[data-automation-comment-resize]");
  if (!header || !body || !canvasWrap || !commentPanel || !resizeHandle) {
    return null;
  }
  return { header, body, canvasWrap, commentPanel, resizeHandle };
}

function renderAutomationDetailHeader(
  header: HTMLElement,
  automation: AutomationDetailResponse["automation"],
  automationId: string,
  state: AutomationDetailCommentState,
  rerender: () => void,
  options: AutomationWorkspaceRouteOptions,
): void {
  const supportsExecutionControls = isExecutableItem(automation);
  const viewToggle = createAutomationDetailViewToggleHtml(automation, state.detailViewMode);
  const commentToggle = automation.sourceInsight ? "" : renderAutomationCommentToggle(state);
  header.innerHTML = `
    <div class="automation-detail__header-main">
      <div class="automation-page__eyebrow">${WORKFLOW_DETAIL_EYEBROW}</div>
      <h1>${escapeHtml(automation.name)}</h1>
      <p>${escapeHtml(automation.summary)}</p>
    </div>
    <div class="automation-detail__header-actions">
      <button type="button" class="btn btn-secondary" data-automation-back>返回 ${WORKFLOW_LABEL}</button>
      ${commentToggle}
      ${renderAutomationLogsButton(supportsExecutionControls)}
      ${viewToggle}
      <span class="automation-list-card__source" data-source-kind="${automation.sourceKind}">${escapeHtml(getSourceLabel(automation.sourceKind))}</span>
      ${renderAutomationStatusBadge(automation, supportsExecutionControls)}
    </div>
  `;
  bindAutomationDetailHeader(header, automationId, state, rerender, options);
}

function renderAutomationCommentToggle(state: AutomationDetailCommentState): string {
  const isActive = state.commentMode || state.commentPanelOpen;
  return `
    <button
      type="button"
      class="btn ${isActive ? "btn-primary" : "btn-secondary"}"
      data-automation-comment-toggle
      aria-pressed="${isActive ? "true" : "false"}"
    >${readAutomationCommentToggleLabel(state)}</button>
  `;
}

function readAutomationCommentToggleLabel(state: AutomationDetailCommentState): string {
  if (state.commentMode) {
    return "退出评论";
  }
  return state.commentPanelOpen ? "关闭评论" : "评论";
}

function renderAutomationLogsButton(supportsExecutionControls: boolean): string {
  return supportsExecutionControls
    ? `<button type="button" class="btn btn-secondary" data-automation-open-logs>运行日志</button>`
    : "";
}

function renderAutomationStatusBadge(
  automation: AutomationDetailResponse["automation"],
  supportsExecutionControls: boolean,
): string {
  if (!supportsExecutionControls) {
    return "";
  }
  const enabled = automation.enabled ? "true" : "false";
  const label = automation.enabled ? "运行中" : "未启动";
  return `<span class="automation-list-card__status" data-enabled="${enabled}">${label}</span>`;
}

function bindAutomationDetailHeader(
  header: HTMLElement,
  automationId: string,
  state: AutomationDetailCommentState,
  rerender: () => void,
  options: AutomationWorkspaceRouteOptions,
): void {
  header.querySelector<HTMLButtonElement>("[data-automation-back]")?.addEventListener("click", () => {
    if (options.onNavigate) {
      options.onNavigate({});
      return;
    }
    window.location.hash = "#/automation";
  });
  header.querySelector<HTMLButtonElement>("[data-automation-open-logs]")?.addEventListener("click", () => {
    if (options.onNavigate) {
      options.onNavigate({ automationLogId: automationId });
      return;
    }
    window.location.hash = `#/automation-log/${encodeURIComponent(automationId)}`;
  });
  header.querySelector<HTMLButtonElement>("[data-automation-comment-toggle]")?.addEventListener("click", () => {
    toggleAutomationCommentPanel(state);
    rerender();
  });
  bindAutomationDetailViewToggle(header, state, rerender);
}

function toggleAutomationCommentPanel(state: AutomationDetailCommentState): void {
  if (state.detailViewMode === "mermaid") {
    state.commentMode = !state.commentMode;
    if (state.commentMode) {
      openAutomationCommentSidebar(state);
      return;
    }
    state.draftTarget = null;
    closeAutomationCommentSidebar(state);
    return;
  }
  if (state.commentPanelOpen) {
    closeAutomationCommentSidebar(state);
    return;
  }
  openAutomationCommentSidebar(state);
}

function bindAutomationDetailViewToggle(
  header: HTMLElement,
  state: AutomationDetailCommentState,
  rerender: () => void,
): void {
  for (const button of header.querySelectorAll<HTMLButtonElement>("[data-automation-detail-view]")) {
    button.addEventListener("click", () => {
      state.detailViewMode = button.dataset.automationDetailView as AutomationDetailViewMode;
      state.commentMode = false;
      state.draftTarget = null;
      rerender();
    });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}
