import { showRunProgress, type RunProgressHandle } from "../../run-progress.js";

type ReviewKind = "deep-research" | "run" | "state" | "inbox" | "flash-diary-failure" | "xhs-sync-failure";
type ReviewSeverity = "info" | "suggest" | "warn" | "error";
type ReviewRunKind = "check" | "sync";
type ReviewRunStatus = "running" | "succeeded" | "failed" | "stopped";
type DeepResearchCategory = "outdated-source" | "missing-citation" | "needs-deep-research" | "suggestion";
type DeepResearchScope = "claim" | "page";
type DeepResearchStatus = "pending" | "running" | "confirming-write" | "done-await-confirm" | "failed" | "ignored" | "completed";
type DeepResearchAction = "start-rewrite" | "add-citation" | "deep-research" | "accept-suggestion" | "ignore";

const REVIEW_DEFAULT_PAGE_SIZE = 5;
const REVIEW_CARD_MIN_HEIGHT = 192;
const REVIEW_LIST_GAP = 12;
const REVIEW_PAGE_HEIGHT_BUFFER = 224;
const REVIEW_POLL_INTERVAL_MS = 900;
const reviewPageStates = new WeakMap<HTMLElement, ReviewPageState>();

interface DeepResearchDraftResult {
  mode: "append" | "rewrite-citations";
  pagePath: string;
  summary: string;
  preview: string;
  content: string;
  citationTarget?: string;
  replacementCitation?: string;
}

interface DeepResearchReviewData {
  category: DeepResearchCategory;
  scope: DeepResearchScope;
  pagePath: string;
  line?: number;
  factText?: string;
  gapText: string;
  triggerReason: string;
  sourceExcerpt?: string;
  status: DeepResearchStatus;
  progress: number;
  selectedAction?: DeepResearchAction;
  draftResult?: DeepResearchDraftResult;
  errorMessage?: string;
  chatId?: string;
  updatedAt: string;
}

interface ReviewStateInfo {
  frozenSlugs: string[];
  suspiciousFrozenSlugs: string[];
}

interface ReviewRunInfo {
  kind: ReviewRunKind;
  status: ReviewRunStatus;
  exitCode?: number | null;
}

interface ReviewItem {
  id: string;
  kind: ReviewKind;
  severity: ReviewSeverity;
  title: string;
  detail: string;
  createdAt: string;
  target?: string;
  deepResearch?: DeepResearchReviewData;
  stateInfo?: ReviewStateInfo;
  run?: ReviewRunInfo;
}

interface ReviewSummary {
  items: ReviewItem[];
  state: {
    sourceCount: number;
    frozenCount: number;
    latestCompiledAt: string | null;
    frozenSlugs: string[];
    suspiciousFrozenSlugs: string[];
  } | null;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface DeleteFailuresResponse {
  deleted: string[];
  remaining: number;
}

interface ChatLaunchResponse {
  id: string;
}

interface BulkAdvanceResponse {
  started: number;
  confirmed: number;
  skipped: number;
}

interface BulkConfirmResponse {
  confirmed: number;
  failed: number;
  skipped: number;
}

interface RunSnapshot {
  id: string;
  kind: ReviewRunKind;
  status: ReviewRunStatus;
}

interface RunStatusEvent {
  run?: RunSnapshot;
}

interface ChatThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface ChatConversation {
  id: string;
  title: string;
  messages: ChatThreadMessage[];
  articleRefs: string[];
}

interface GuidedIngestWorkspaceState {
  target: string;
  title: string;
  conversation: ChatConversation | null;
  draft: string;
  busy: boolean;
}

interface ReviewPageState {
  items: ReviewItem[];
  currentPage: number;
  pageSize: number;
  selectedIds: Set<string>;
  activeItemId: string | null;
  guidedIngest: GuidedIngestWorkspaceState | null;
  pollTimer: number | null;
}

interface ReviewCardSections {
  problem: string;
  problemSummary: string;
  nextStep: string;
  nextStepSummary: string;
}

export function renderReviewPage(): HTMLElement {
  const root = document.createElement("section");
  root.className = "review-page";
  root.innerHTML = `
    <div class="review-page__layout">
      <main class="review-page__main">
        <section class="review-board">
          <div class="review-board__header">
            <div class="review-board__intro">
              <div class="eyebrow">PENDING WORK</div>
              <h2>待处理事项</h2>
              <p class="review-board__copy">集中处理系统检查、同步失败和 Deep Research 补证产生的待处理事项。</p>
              <p class="review-board__status" data-review-status hidden></p>
            </div>
            <div class="review-board__actions">
              <span class="review-board__meta" data-review-count>读取中</span>
              <div class="review-board__pager" data-review-toolbar-pagination></div>
              <button type="button" class="btn btn-primary btn-inline" data-review-run-all disabled>全部进行</button>
              <button type="button" class="btn btn-secondary btn-inline" data-review-confirm-all disabled>全部写入</button>
              <button type="button" class="btn btn-secondary btn-inline" data-review-toggle-page-select disabled>全选本页</button>
              <button type="button" class="btn btn-secondary btn-inline" data-review-batch-delete disabled>批量删除</button>
              <button type="button" class="btn btn-secondary btn-inline" data-review-refresh>刷新</button>
            </div>
          </div>
          <div class="review-page__list" data-review-list>
            <div class="review-empty">正在读取审查队列...</div>
          </div>
        </section>
      </main>
      <aside class="review-page__workspace" data-review-workspace hidden></aside>
    </div>
  `;
  bindReviewPage(root);
  return root;
}

export function renderReviewItems(root: HTMLElement, items: ReviewItem[]): void {
  const state = getReviewPageState(root);
  state.items = [...items];
  state.currentPage = 1;
  state.selectedIds = new Set(
    [...state.selectedIds].filter((id) => state.items.some((item) => item.id === id && isReviewItemDeletable(item))),
  );
  state.activeItemId = resolveReviewActiveItemId(state.items, state.activeItemId);
  renderReviewState(root);
}

function bindReviewPage(root: HTMLElement): void {
  const resizeController = new AbortController();
  window.addEventListener(
    "resize",
    () => {
      if (!root.isConnected) {
        resizeController.abort();
        clearReviewPoll(root);
        return;
      }
      renderReviewState(root);
    },
    { signal: resizeController.signal },
  );
  root.querySelector<HTMLButtonElement>("[data-review-refresh]")!.addEventListener("click", () => {
    void refreshReview(root);
  });
  root.addEventListener("change", (event) => {
    const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>("[data-review-select]");
    if (!checkbox) {
      return;
    }
    const id = checkbox.dataset.reviewSelect ?? "";
    if (!id) {
      return;
    }
    const state = getReviewPageState(root);
    if (checkbox.checked) {
      state.selectedIds.add(id);
    } else {
      state.selectedIds.delete(id);
    }
    updateSelectionControls(root, state);
  });
  root.addEventListener("input", (event) => {
    const input = (event.target as HTMLElement).closest<HTMLTextAreaElement>("[data-review-guided-input]");
    if (!input) {
      return;
    }
    const state = getReviewPageState(root);
    if (!state.guidedIngest) {
      return;
    }
    state.guidedIngest.draft = input.value;
  });
  root.addEventListener("submit", (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-review-guided-form]");
    if (!form) {
      return;
    }
    event.preventDefault();
    void sendGuidedIngestMessage(root);
  });
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (handleReviewToolbarClick(root, target, event)) return;
    if (handleReviewItemClick(root, target, event)) return;
    if (handleReviewWorkspaceOpenClick(root, target, event)) return;
    handleReviewInboxClick(root, target, event);
  });
  void loadReview(root);
}

function handleReviewToolbarClick(root: HTMLElement, target: HTMLElement, event: Event): boolean {
  const openPageLink = target.closest<HTMLAnchorElement>("[data-review-open-page]");
  if (openPageLink?.dataset.reviewOpenPage) {
    event.preventDefault();
    window.location.hash = wikiRouteHref(openPageLink.dataset.reviewOpenPage);
    return true;
  }

  if (target.closest<HTMLButtonElement>("[data-review-toggle-page-select]")) {
    event.preventDefault();
    toggleCurrentPageSelection(root);
    return true;
  }

  if (target.closest<HTMLButtonElement>("[data-review-batch-delete]")) {
    event.preventDefault();
    void deleteSelectedXhsFailures(root);
    return true;
  }

  if (target.closest<HTMLButtonElement>("[data-review-run-all]")) {
    event.preventDefault();
    void bulkAdvanceDeepResearch(root);
    return true;
  }

  if (target.closest<HTMLButtonElement>("[data-review-confirm-all]")) {
    event.preventDefault();
    void bulkConfirmDeepResearch(root);
    return true;
  }

  if (target.closest<HTMLButtonElement>("[data-review-prev]")) {
    event.preventDefault();
    changeReviewPage(root, -1);
    return true;
  }

  if (target.closest<HTMLButtonElement>("[data-review-next]")) {
    event.preventDefault();
    changeReviewPage(root, 1);
    return true;
  }

  return false;
}

function handleReviewItemClick(root: HTMLElement, target: HTMLElement, event: Event): boolean {
  const autofixButton = target.closest<HTMLButtonElement>("[data-run-autofix-check]");
  if (autofixButton) {
    event.preventDefault();
    void startSystemCheckAutofix(root, autofixButton);
    return true;
  }

  const confirmButton = target.closest<HTMLButtonElement>("[data-review-confirm]");
  if (confirmButton?.dataset.reviewConfirm) {
    event.preventDefault();
    void confirmDeepResearch(root, confirmButton.dataset.reviewConfirm);
    return true;
  }

  const chatButton = target.closest<HTMLButtonElement>("[data-review-chat]");
  if (chatButton?.dataset.reviewChat) {
    event.preventDefault();
    void openDeepResearchChat(root, chatButton.dataset.reviewChat);
    return true;
  }

  const actionButton = target.closest<HTMLButtonElement>("[data-review-action][data-review-id]");
  if (actionButton?.dataset.reviewAction && actionButton.dataset.reviewId) {
    event.preventDefault();
    void startDeepResearch(root, actionButton.dataset.reviewId, actionButton.dataset.reviewAction);
    return true;
  }

  return false;
}

function handleReviewWorkspaceOpenClick(root: HTMLElement, target: HTMLElement, event: Event): boolean {
  if (target.closest("[data-inbox-guide],[data-inbox-batch],[data-flash-diary-retry]")) {
    return false;
  }

  const openCard = target.closest<HTMLElement>("[data-review-open]");
  if (!openCard?.dataset.reviewOpen) {
    return false;
  }

  const item = getReviewPageState(root).items.find((candidate) => candidate.id === openCard.dataset.reviewOpen);
  if (!item || !isWorkspaceDetailItem(item)) {
    return true;
  }

  event.preventDefault();
  const state = getReviewPageState(root);
  state.activeItemId = item.id;
  state.guidedIngest = null;
  renderReviewState(root);
  return true;
}

function handleReviewInboxClick(root: HTMLElement, target: HTMLElement, event: Event): boolean {
  const guideButton = target.closest<HTMLButtonElement>("[data-inbox-guide]");
  if (guideButton) {
    event.preventDefault();
    void openGuidedIngestWorkspace(root, guideButton.dataset.inboxGuide ?? "");
    return true;
  }

  if (target.closest<HTMLButtonElement>("[data-review-guided-close]")) {
    event.preventDefault();
    closeGuidedIngestWorkspace(root);
    return true;
  }

  const batchIngestButton = target.closest<HTMLButtonElement>("[data-inbox-batch]");
  if (batchIngestButton) {
    event.preventDefault();
    void queueInboxBatchIngest(root, batchIngestButton.dataset.inboxBatch ?? "", batchIngestButton);
    return true;
  }

  const retryDiaryButton = target.closest<HTMLButtonElement>("[data-flash-diary-retry]");
  if (retryDiaryButton) {
    event.preventDefault();
    void retryFlashDiaryFailure(root, retryDiaryButton.dataset.flashDiaryRetry ?? "");
    return true;
  }

  return false;
}

async function loadReview(root: HTMLElement): Promise<ReviewSummary | null> {
  const list = root.querySelector<HTMLElement>("[data-review-list]")!;
  try {
    const response = await fetch("/api/review");
    const payload = (await response.json()) as ApiResponse<ReviewSummary>;
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "review load failed");
    }
    renderReviewItems(root, payload.data.items);
    return payload.data;
  } catch (error) {
    clearReviewPoll(root);
    const state = getReviewPageState(root);
    state.items = [];
    state.currentPage = 1;
    state.selectedIds.clear();
    state.activeItemId = null;
    updateSelectionControls(root, state);
    root.querySelector<HTMLElement>("[data-review-toolbar-pagination]")!.innerHTML = "";
    renderWorkspaceRail(root);
    const message = error instanceof Error ? error.message : String(error);
    list.innerHTML = `<div class="review-empty">读取失败：${escapeHtml(message)}</div>`;
    setReviewStatus(root, `读取失败：${message}`, "error");
    return null;
  }
}

async function refreshReview(root: HTMLElement): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("[data-review-refresh]");
  if (!button || button.disabled) {
    return;
  }
  const originalText = button.textContent ?? "刷新";
  button.disabled = true;
  button.textContent = "刷新中...";
  setReviewStatus(root, "正在刷新审查队列...");
  try {
    const summary = await loadReview(root);
    if (summary) {
      setReviewStatus(root, `已刷新，共 ${summary.items.length} 项。`);
    }
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderReviewState(root: HTMLElement): void {
  const state = getReviewPageState(root);
  const list = root.querySelector<HTMLElement>("[data-review-list]")!;
  const count = root.querySelector<HTMLElement>("[data-review-count]");
  const toolbarPagination = root.querySelector<HTMLElement>("[data-review-toolbar-pagination]")!;
  const previousPageSize = state.pageSize;
  const nextPageSize = getReviewPageSize(root);
  if (nextPageSize !== previousPageSize) {
    const firstVisibleIndex = Math.max(0, (state.currentPage - 1) * previousPageSize);
    state.pageSize = nextPageSize;
    state.currentPage = Math.floor(firstVisibleIndex / nextPageSize) + 1;
  }
  list.dataset.reviewVisibleSlots = String(state.pageSize);
  if (count) {
    count.textContent = `${state.items.length} 项`;
  }
  if (state.items.length === 0) {
    updateSelectionControls(root, state);
    list.innerHTML = `<div class="review-empty">暂无待处理事项</div>`;
    toolbarPagination.innerHTML = "";
    renderWorkspaceRail(root);
    syncReviewPolling(root);
    return;
  }
  const pageCount = getReviewPageCount(state.items.length, state.pageSize);
  state.currentPage = clampReviewPage(state.currentPage, pageCount);
  const start = (state.currentPage - 1) * state.pageSize;
  const end = start + state.pageSize;
  const pageItems = state.items.slice(start, end);
  updateSelectionControls(root, state);
  list.innerHTML = pageItems.map((item) => renderReviewCard(item, state.selectedIds.has(item.id), state.activeItemId === item.id)).join("");
  toolbarPagination.innerHTML = renderReviewPagination(state.currentPage, pageCount);
  renderWorkspaceRail(root);
  syncReviewPolling(root);
}

function renderReviewCard(item: ReviewItem, selected: boolean, active: boolean): string {
  if (isDeepResearchItem(item)) {
    return renderDeepResearchCard(item, active);
  }
  const sections = getReviewCardSections(item);
  const openable = isWorkspaceDetailItem(item);
  return `
    <article class="review-card severity-${item.severity}${openable ? ` review-card--workspace-detail${active ? " is-active" : ""}` : ""}" ${openable ? `data-review-open="${escapeHtml(item.id)}"` : ""}>
      <div class="review-card__topline">
        <div class="review-card__tags">
          ${renderReviewSelection(item, selected)}
          <span class="review-card__kind">${formatKind(item.kind)}</span>
        </div>
        <span class="review-card__severity">${formatSeverity(item.severity)}</span>
      </div>
      <h2 class="review-card__title">${escapeHtml(item.title)}</h2>
      <div class="review-card__detail">
        <p data-review-problem title="${escapeHtml(sections.problem)}"><strong>问题：</strong><span class="review-card__detail-text">${escapeHtml(sections.problemSummary)}</span></p>
        <p data-review-next-step title="${escapeHtml(sections.nextStep)}"><strong>下一步建议：</strong><span class="review-card__detail-text">${escapeHtml(sections.nextStepSummary)}</span></p>
      </div>
      ${renderStateInfoBlock(item)}
      ${renderReviewActions(item)}
      <footer class="review-card__footer">
        <span>${item.target ? escapeHtml(item.target) : "全局项"}</span>
        <span>${formatTime(item.createdAt)}</span>
      </footer>
    </article>
  `;
}

function renderDeepResearchCard(item: ReviewItem & { deepResearch: DeepResearchReviewData }, active: boolean): string {
  const progressLabel = formatDeepResearchProgress(item.deepResearch);
  const factSummary = compactReviewText(item.deepResearch.factText || item.deepResearch.gapText, 96);
  const triggerSummary = compactReviewText(item.deepResearch.errorMessage || item.deepResearch.triggerReason, 108);
  return `
    <article class="review-card review-card--deep-research severity-${item.severity}${active ? " is-active" : ""}" data-review-open="${escapeHtml(item.id)}">
      <div class="review-card__topline">
        <div class="review-card__tags">
          <span class="review-card__kind">${formatKind(item.kind)}</span>
          <span class="review-card__status">${formatDeepResearchStatus(item.deepResearch.status)}</span>
        </div>
        <span class="review-card__progress">${escapeHtml(progressLabel)}</span>
      </div>
      <h2 class="review-card__title">${escapeHtml(item.title)}</h2>
      <div class="review-card__summary">
        <p class="review-card__summary-line"><span class="review-card__summary-label">页面</span><span class="review-card__summary-value">${renderReviewPageLink(item.deepResearch.pagePath)}</span></p>
        <p class="review-card__summary-line"><span class="review-card__summary-label">${item.deepResearch.scope === "claim" ? "事实" : "缺口"}</span><span class="review-card__summary-value">${escapeHtml(factSummary)}</span></p>
        <p class="review-card__summary-line"><span class="review-card__summary-label">${item.deepResearch.status === "failed" ? "原因" : "依据"}</span><span class="review-card__summary-value">${escapeHtml(triggerSummary)}</span></p>
      </div>
      ${renderDeepResearchActions(item)}
      <footer class="review-card__footer">
        <span>${item.deepResearch.line ? `第 ${item.deepResearch.line} 行` : item.deepResearch.scope === "page" ? "页面级" : "事实级"}</span>
        <span>${formatTime(item.deepResearch.updatedAt)}</span>
      </footer>
    </article>
  `;
}

function renderReviewSelection(item: ReviewItem, selected: boolean): string {
  if (!isReviewItemDeletable(item)) {
    return "";
  }
  return `
    <label class="review-card__select">
      <input type="checkbox" data-review-select="${escapeHtml(item.id)}" ${selected ? "checked" : ""} aria-label="选择待删除项">
      <span>选中</span>
    </label>
  `;
}

function renderReviewActions(item: ReviewItem): string {
  if (isSystemCheckRunItem(item)) {
    return `
      <div class="review-card__actions">
        <button type="button" class="btn btn-primary btn-inline" data-run-autofix-check>自动补齐双链</button>
      </div>
    `;
  }
  if (item.kind === "flash-diary-failure") {
    return `
      <div class="review-card__actions">
        <button type="button" class="btn btn-primary btn-inline" data-flash-diary-retry="${escapeHtml(item.id)}">重试写入闪念日记</button>
      </div>
    `;
  }
  if (item.kind === "inbox") {
    return `
      <div class="review-card__actions">
        <button type="button" class="btn btn-secondary btn-inline" data-inbox-guide="${escapeHtml(item.target ?? "")}">亲自指导录入</button>
        <button type="button" class="btn btn-primary btn-inline" data-inbox-batch="${escapeHtml(item.target ?? "")}" ${item.target ? "" : "disabled"}>优先批量录入</button>
      </div>
    `;
  }
  return "";
}

function renderStateInfoBlock(item: ReviewItem): string {
  if (item.kind !== "state" || !item.stateInfo || item.stateInfo.frozenSlugs.length === 0) {
    return "";
  }
  return `
    <div class="review-card__state-detail">
      <p class="review-card__state-line">
        <strong>冻结项：</strong>
        <span class="review-card__state-list" data-review-frozen-slugs>${item.stateInfo.frozenSlugs
          .map((slug) => renderFrozenSlugChip(slug))
          .join("")}</span>
      </p>
      ${item.stateInfo.suspiciousFrozenSlugs.length > 0
        ? `<p class="review-card__state-line">
            <strong>异常项：</strong>
            <span class="review-card__state-list" data-review-frozen-anomalies>${item.stateInfo.suspiciousFrozenSlugs
              .map((slug) => renderFrozenSlugChip(slug, true))
              .join("")}</span>
          </p>`
        : ""}
    </div>
  `;
}

function renderFrozenSlugChip(value: string, suspicious = false): string {
  return `<span class="review-card__state-chip${suspicious ? " is-suspicious" : ""}">${escapeHtml(formatFrozenSlugLabel(value))}</span>`;
}

function renderDeepResearchActions(item: ReviewItem & { deepResearch: DeepResearchReviewData }): string {
  const primaryAction = getPrimaryDeepResearchAction(item.deepResearch.category);
  if (item.deepResearch.status === "running") {
    return `
      <div class="review-card__actions">
        <button type="button" class="btn btn-secondary btn-inline" data-review-action="ignore" data-review-id="${escapeHtml(item.id)}">忽略</button>
        <button type="button" class="btn btn-primary btn-inline" disabled>${escapeHtml(formatDeepResearchProgress(item.deepResearch))}</button>
        <button type="button" class="btn btn-secondary btn-inline" data-review-chat="${escapeHtml(item.id)}">对话</button>
      </div>
    `;
  }
  if (item.deepResearch.status === "confirming-write") {
    return `
      <div class="review-card__actions">
        <button type="button" class="btn btn-secondary btn-inline" disabled>确认写入中</button>
        <button type="button" class="btn btn-primary btn-inline" disabled>${escapeHtml(formatDeepResearchProgress(item.deepResearch))}</button>
        <button type="button" class="btn btn-secondary btn-inline" data-review-chat="${escapeHtml(item.id)}">对话</button>
      </div>
    `;
  }
  if (item.deepResearch.status === "done-await-confirm") {
    return `
      <div class="review-card__actions">
        <button type="button" class="btn btn-secondary btn-inline" data-review-action="ignore" data-review-id="${escapeHtml(item.id)}">忽略</button>
        <button type="button" class="btn btn-primary btn-inline" data-review-confirm="${escapeHtml(item.id)}">确认写入</button>
        <button type="button" class="btn btn-secondary btn-inline" data-review-chat="${escapeHtml(item.id)}">对话</button>
      </div>
    `;
  }
  if (item.deepResearch.status === "completed") {
    return `
      <div class="review-card__actions">
        <button type="button" class="btn btn-secondary btn-inline" data-review-action="ignore" data-review-id="${escapeHtml(item.id)}">忽略</button>
        <button type="button" class="btn btn-primary btn-inline" disabled>${escapeHtml(formatDeepResearchProgress(item.deepResearch))}</button>
        <button type="button" class="btn btn-secondary btn-inline" data-review-chat="${escapeHtml(item.id)}">对话</button>
      </div>
    `;
  }
  return `
    <div class="review-card__actions">
      <button type="button" class="btn btn-secondary btn-inline" data-review-action="ignore" data-review-id="${escapeHtml(item.id)}">忽略</button>
      <button type="button" class="btn btn-primary btn-inline" data-review-action="${primaryAction}" data-review-id="${escapeHtml(item.id)}">${escapeHtml(actionLabel(primaryAction))}</button>
      <button type="button" class="btn btn-secondary btn-inline" data-review-chat="${escapeHtml(item.id)}">对话</button>
    </div>
  `;
}

function renderReviewPagination(currentPage: number, pageCount: number): string {
  if (pageCount <= 1) {
    return "";
  }
  return `
    <span class="review-page__page-meta">第 ${currentPage} / ${pageCount} 页</span>
    <button type="button" class="btn btn-secondary btn-inline" data-review-prev ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
    <button type="button" class="btn btn-secondary btn-inline" data-review-next ${currentPage >= pageCount ? "disabled" : ""}>下一页</button>
  `;
}

function renderWorkspaceRail(root: HTMLElement): void {
  const workspace = root.querySelector<HTMLElement>("[data-review-workspace]");
  if (!workspace) {
    return;
  }
  const state = getReviewPageState(root);
  if (state.guidedIngest) {
    showReviewWorkspace(root, workspace, "guided-ingest", renderGuidedIngestWorkspace(state.guidedIngest));
    return;
  }
  const activeItem = state.activeItemId
    ? state.items.find((item) => item.id === state.activeItemId)
    : null;
  if (activeItem && isDeepResearchItem(activeItem)) {
    showReviewWorkspace(root, workspace, "detail", renderDeepResearchDetail(activeItem));
    return;
  }
  if (activeItem && isStateDetailItem(activeItem)) {
    showReviewWorkspace(root, workspace, "detail", renderStateDetail(activeItem));
    return;
  }
  if (isInboxDetailItem(activeItem)) {
    showReviewWorkspace(root, workspace, "detail", renderInboxDetail(activeItem));
    return;
  }
  hideReviewWorkspace(root, workspace);
}

function showReviewWorkspace(root: HTMLElement, workspace: HTMLElement, pane: string, markup: string): void {
  root.classList.add("review-page--workspace-open");
  workspace.hidden = false;
  workspace.dataset.reviewPane = pane;
  workspace.innerHTML = markup;
}

function hideReviewWorkspace(root: HTMLElement, workspace: HTMLElement): void {
  root.classList.remove("review-page--workspace-open");
  workspace.hidden = true;
  workspace.dataset.reviewPane = "idle";
  workspace.innerHTML = "";
}

function renderGuidedIngestWorkspace(workspaceState: GuidedIngestWorkspaceState): string {
  const messages = workspaceState.conversation?.messages ?? [];
  const articleRefs = workspaceState.conversation?.articleRefs?.length
    ? workspaceState.conversation.articleRefs
    : [workspaceState.target];
  return `
    <div class="review-guided-panel" data-review-guided-panel>
      <div class="review-guided-panel__header">
        <div>
          <div class="eyebrow">GUIDED INGEST</div>
          <h2>${escapeHtml(workspaceState.title)}</h2>
          <p class="review-guided-panel__path">${escapeHtml(workspaceState.target)}</p>
        </div>
        <button type="button" class="btn btn-secondary btn-inline" data-review-guided-close>关闭</button>
      </div>
      <section class="chat-refs-panel">
        <div class="chat-refs-panel__header">
          <div>
            <div class="eyebrow">Pages</div>
            <strong>当前选中页面</strong>
          </div>
        </div>
        <div class="chat-article-refs">${articleRefs.map((path) => renderGuidedIngestRefChip(path)).join("")}</div>
      </section>
      <div class="review-guided-panel__messages chat-message-list" data-review-guided-messages>
        ${messages.length > 0
          ? messages.map((message) => `
              <article class="chat-message chat-message--${escapeHtml(message.role)}">
                <div class="chat-message__body">${escapeHtml(message.content)}</div>
              </article>
            `).join("")
          : `<div class="chat-empty-state"><p class="chat-empty-state__title">指导录入</p><p class="muted">围绕这条 inbox 原料继续对话，确认内容结构后再录入。</p></div>`}
      </div>
      <form class="review-guided-panel__composer chat-composer" data-review-guided-form>
        <textarea
          class="input chat-composer__input"
          data-review-guided-input
          rows="4"
          placeholder="输入你希望如何整理这条原料..."
          ${workspaceState.busy ? "disabled" : ""}
        >${escapeHtml(workspaceState.draft)}</textarea>
        <button type="submit" class="btn btn-primary chat-composer__send" data-review-guided-send ${workspaceState.busy || !workspaceState.conversation ? "disabled" : ""}>发送</button>
      </form>
    </div>
  `;
}

function renderGuidedIngestRefChip(pathValue: string): string {
  return `<span class="review-guided-panel__ref-chip">${escapeHtml(pathValue)}</span>`;
}

function renderDeepResearchDetail(item: ReviewItem & { deepResearch: DeepResearchReviewData }): string {
  const draftPreview = item.deepResearch.draftResult
    ? `
      <section class="review-detail__section review-detail__section--draft">
        <div class="review-detail__section-head">
          <strong>${escapeHtml(item.deepResearch.draftResult.summary)}</strong>
          <span>待确认写入</span>
        </div>
        <div class="review-detail__draft">
          <p class="review-detail__value">${escapeHtml(item.deepResearch.draftResult.preview)}</p>
          <pre>${escapeHtml(item.deepResearch.draftResult.content)}</pre>
        </div>
      </section>
    `
    : "";
  const errorBlock = item.deepResearch.errorMessage
    ? `
      <section class="review-detail__section review-detail__section--error">
        <div class="review-detail__section-head">
          <strong>失败原因</strong>
        </div>
        <p class="review-detail__value">${escapeHtml(item.deepResearch.errorMessage)}</p>
      </section>
    `
    : "";
  return `
    <div class="review-detail-panel" data-review-detail-panel>
      <div class="review-detail__header">
        <div>
          <div class="eyebrow">Deep Research</div>
          <h2>${escapeHtml(item.title)}</h2>
          <p class="review-detail__subcopy">${escapeHtml(formatDeepResearchStatus(item.deepResearch.status))} · ${escapeHtml(formatDeepResearchProgress(item.deepResearch))}</p>
        </div>
        <span class="review-card__progress">${escapeHtml(formatDeepResearchProgress(item.deepResearch))}</span>
      </div>
      <div class="review-detail__body">
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>定位</strong>
          </div>
          <div class="review-detail__grid">
            <div class="review-detail__row">
              <span class="review-detail__label">页面</span>
              <span class="review-detail__value">${renderReviewPageLink(item.deepResearch.pagePath)}</span>
            </div>
            <div class="review-detail__row">
              <span class="review-detail__label">范围</span>
              <span class="review-detail__value">${item.deepResearch.scope === "claim" ? "事实级" : "页面级"}</span>
            </div>
            <div class="review-detail__row">
              <span class="review-detail__label">行号</span>
              <span class="review-detail__value">${item.deepResearch.line ? `第 ${item.deepResearch.line} 行` : "未提供"}</span>
            </div>
          </div>
        </section>
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>具体对象</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(item.deepResearch.factText || item.deepResearch.gapText)}</p>
        </section>
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>触发依据</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(item.deepResearch.triggerReason)}</p>
          ${item.deepResearch.sourceExcerpt ? `<p class="review-detail__value review-detail__value--excerpt">${escapeHtml(item.deepResearch.sourceExcerpt)}</p>` : ""}
        </section>
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>后台进展</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(formatDeepResearchProgress(item.deepResearch))}</p>
        </section>
        ${errorBlock}
        ${draftPreview}
      </div>
      <footer class="review-detail__actions">
        ${renderDeepResearchActions(item)}
      </footer>
    </div>
  `;
}

function renderStateDetail(item: ReviewItem & { stateInfo: ReviewStateInfo }): string {
  const sections = getReviewCardSections(item);
  return `
    <div class="review-detail-panel" data-review-detail-panel>
      <div class="review-detail__header">
        <div>
          <div class="eyebrow">SYSTEM STATE</div>
          <h2>${escapeHtml(item.title)}</h2>
          <p class="review-detail__subcopy">${escapeHtml(sections.problemSummary)}</p>
        </div>
        <span class="review-card__severity">${escapeHtml(formatSeverity(item.severity))}</span>
      </div>
      <div class="review-detail__body">
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>问题</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(sections.problem)}</p>
        </section>
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>冻结页面</strong>
          </div>
          <div class="review-card__state-list">${item.stateInfo.frozenSlugs.map((slug) => renderFrozenSlugChip(slug)).join("")}</div>
        </section>
        ${item.stateInfo.suspiciousFrozenSlugs.length > 0
          ? `<section class="review-detail__section review-detail__section--error">
              <div class="review-detail__section-head">
                <strong>异常项</strong>
              </div>
              <div class="review-card__state-list">${item.stateInfo.suspiciousFrozenSlugs.map((slug) => renderFrozenSlugChip(slug, true)).join("")}</div>
            </section>`
          : ""}
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>下一步建议</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(sections.nextStep)}</p>
        </section>
      </div>
    </div>
  `;
}

function renderInboxDetail(item: ReviewItem): string {
  const sections = getReviewCardSections(item);
  return `
    <div class="review-detail-panel" data-review-detail-panel>
      <div class="review-detail__header">
        <div>
          <div class="eyebrow">INBOX MATERIAL</div>
          <h2>${escapeHtml(item.title)}</h2>
          <p class="review-detail__subcopy">${escapeHtml(sections.problemSummary)}</p>
        </div>
        <span class="review-card__severity">${escapeHtml(formatSeverity(item.severity))}</span>
      </div>
      <div class="review-detail__body">
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>来源路径</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(item.target ?? "未提供")}</p>
        </section>
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>问题</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(sections.problem)}</p>
        </section>
        <section class="review-detail__section">
          <div class="review-detail__section-head">
            <strong>下一步建议</strong>
          </div>
          <p class="review-detail__value">${escapeHtml(sections.nextStep)}</p>
        </section>
      </div>
      <footer class="review-detail__actions">
        ${renderReviewActions(item)}
      </footer>
    </div>
  `;
}

function getReviewCardSections(item: ReviewItem): ReviewCardSections {
  const detail = item.detail || "无详细说明";
  switch (item.kind) {
    case "deep-research":
      return {
        problem: detail,
        problemSummary: compactReviewText(detail),
        nextStep: "先确认是否继续联网 Deep Research 补证，然后补充外部来源并回填 wiki；完成后重新执行同步或系统检查。",
        nextStepSummary: compactReviewText("先确认是否继续联网 Deep Research 补证，然后补充外部来源并回填 wiki；完成后重新执行同步或系统检查。"),
      };
    case "xhs-sync-failure":
      const xhsFailure = parseReviewFailureDetail(detail);
      return {
        problem: xhsFailure.fullProblem,
        problemSummary: compactReviewText(xhsFailure.visibleProblem, 112),
        nextStep: "先检查原链接、Cookie 和媒体处理错误，确认后重新同步；不需要保留的记录可直接批量删除。",
        nextStepSummary: compactReviewText("先检查原链接、Cookie 和媒体处理错误，确认后重新同步；不需要保留的记录可直接批量删除。"),
      };
    case "flash-diary-failure":
      return {
        problem: detail,
        problemSummary: compactReviewText(detail),
        nextStep: "先检查失败原因和目标日期，然后点击“重试写入闪念日记”。",
        nextStepSummary: compactReviewText("先检查失败原因和目标日期，然后点击“重试写入闪念日记”。"),
      };
    case "inbox":
      return {
        problem: detail,
        problemSummary: compactReviewText(detail),
        nextStep: "选择“亲自指导录入”或“优先批量录入”处理这条原料。",
        nextStepSummary: compactReviewText("选择“亲自指导录入”或“优先批量录入”处理这条原料。"),
      };
    case "run":
      return {
        problem: detail,
        problemSummary: compactReviewText(detail),
        nextStep: "按运行日志逐条处理后，重新执行相关检查或同步。",
        nextStepSummary: compactReviewText("按运行日志逐条处理后，重新执行相关检查或同步。"),
      };
    case "state":
      return {
        problem: detail,
        problemSummary: compactReviewText(detail),
        nextStep: "检查 frozen slug 是否仍有有效来源，再决定是解除冻结还是补充来源。",
        nextStepSummary: compactReviewText("检查 frozen slug 是否仍有有效来源，再决定是解除冻结还是补充来源。"),
      };
  }
}

function compactReviewText(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatFrozenSlugLabel(value: string): string {
  return value.trim() ? value : "空 slug";
}

function parseReviewFailureDetail(detail: string): { fullProblem: string; visibleProblem: string } {
  const lines = detail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => /^错误[:：]/u.test(line));
  const sourceLine = lines.find((line) => line !== errorLine);
  if (!errorLine) {
    return {
      fullProblem: detail,
      visibleProblem: detail,
    };
  }
  return {
    fullProblem: sourceLine ? `${errorLine} 链接：${sourceLine}` : errorLine,
    visibleProblem: errorLine,
  };
}

function resolveReviewActiveItemId(items: readonly ReviewItem[], activeItemId: string | null): string | null {
  if (activeItemId && items.some((item) => item.id === activeItemId && isWorkspaceDetailItem(item))) {
    return activeItemId;
  }
  if (items.length !== 1 || !isInboxDetailItem(items[0]!)) {
    return null;
  }
  return items[0]!.id;
}

function getReviewPageState(root: HTMLElement): ReviewPageState {
  const existing = reviewPageStates.get(root);
  if (existing) {
    return existing;
  }
  const state: ReviewPageState = {
    items: [],
    currentPage: 1,
    pageSize: REVIEW_DEFAULT_PAGE_SIZE,
    selectedIds: new Set<string>(),
    activeItemId: null,
    guidedIngest: null,
    pollTimer: null,
  };
  reviewPageStates.set(root, state);
  return state;
}

function isReviewItemDeletable(item: ReviewItem): boolean {
  return item.kind === "xhs-sync-failure";
}

function updateBatchDeleteButton(root: HTMLElement, state: ReviewPageState): void {
  const button = root.querySelector<HTMLButtonElement>("[data-review-batch-delete]");
  if (!button) {
    return;
  }
  const hasDeletableItems = state.items.some((item) => isReviewItemDeletable(item));
  const selectedCount = [...state.selectedIds].length;
  button.hidden = !hasDeletableItems && selectedCount === 0;
  button.disabled = selectedCount === 0;
  button.textContent = selectedCount > 0 ? `批量删除（${selectedCount}）` : "批量删除";
}

function updateSelectionControls(root: HTMLElement, state: ReviewPageState): void {
  updateBatchDeleteButton(root, state);
  updatePageSelectButton(root, state);
  updateRunAllButton(root, state);
  updateConfirmAllButton(root, state);
}

function updatePageSelectButton(root: HTMLElement, state: ReviewPageState): void {
  const button = root.querySelector<HTMLButtonElement>("[data-review-toggle-page-select]");
  if (!button) {
    return;
  }
  const currentPageItems = getCurrentPageDeletableItems(state);
  const allSelected = currentPageItems.length > 0 && currentPageItems.every((item) => state.selectedIds.has(item.id));
  button.hidden = currentPageItems.length === 0;
  button.disabled = currentPageItems.length === 0;
  button.textContent = allSelected ? "取消全选" : "全选本页";
}

function updateRunAllButton(root: HTMLElement, state: ReviewPageState): void {
  const button = root.querySelector<HTMLButtonElement>("[data-review-run-all]");
  if (!button) {
    return;
  }
  const actionableCount = countRunnableDeepResearchItems(state.items);
  button.disabled = actionableCount === 0;
  button.textContent = actionableCount > 0 ? `全部进行（${actionableCount}）` : "全部进行";
}

function updateConfirmAllButton(root: HTMLElement, state: ReviewPageState): void {
  const button = root.querySelector<HTMLButtonElement>("[data-review-confirm-all]");
  if (!button) {
    return;
  }
  const confirmableCount = countConfirmableDeepResearchItems(state.items);
  button.disabled = confirmableCount === 0;
  button.textContent = confirmableCount > 0 ? `全部写入（${confirmableCount}）` : "全部写入";
}

function getReviewPageCount(itemCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(itemCount / Math.max(pageSize, 1)));
}

function clampReviewPage(page: number, pageCount: number): number {
  return Math.min(Math.max(page, 1), Math.max(pageCount, 1));
}

function changeReviewPage(root: HTMLElement, delta: number): void {
  const state = getReviewPageState(root);
  const nextPage = clampReviewPage(state.currentPage + delta, getReviewPageCount(state.items.length, state.pageSize));
  if (nextPage === state.currentPage) {
    return;
  }
  state.currentPage = nextPage;
  renderReviewState(root);
}

function toggleCurrentPageSelection(root: HTMLElement): void {
  const state = getReviewPageState(root);
  const currentPageItems = getCurrentPageDeletableItems(state);
  if (currentPageItems.length === 0) {
    return;
  }
  const allSelected = currentPageItems.every((item) => state.selectedIds.has(item.id));
  for (const item of currentPageItems) {
    if (allSelected) {
      state.selectedIds.delete(item.id);
    } else {
      state.selectedIds.add(item.id);
    }
  }
  renderReviewState(root);
}

function getReviewPageSize(root: HTMLElement): number {
  const list = root.querySelector<HTMLElement>("[data-review-list]");
  const measuredHeight = list ? Math.floor(list.getBoundingClientRect().height) : 0;
  const availableHeight = measuredHeight > 0
    ? measuredHeight
    : Math.max(REVIEW_CARD_MIN_HEIGHT, window.innerHeight - REVIEW_PAGE_HEIGHT_BUFFER);
  return Math.max(1, Math.floor((availableHeight + REVIEW_LIST_GAP) / (REVIEW_CARD_MIN_HEIGHT + REVIEW_LIST_GAP)));
}

function getCurrentPageItems(state: ReviewPageState): ReviewItem[] {
  const start = (state.currentPage - 1) * state.pageSize;
  return state.items.slice(start, start + state.pageSize);
}

function getCurrentPageDeletableItems(state: ReviewPageState): ReviewItem[] {
  return getCurrentPageItems(state).filter((item) => isReviewItemDeletable(item));
}

async function openGuidedIngestWorkspace(root: HTMLElement, target: string): Promise<void> {
  if (!target) {
    return;
  }
  const state = getReviewPageState(root);
  const item = state.items.find((candidate) => candidate.kind === "inbox" && candidate.target === target);
  const title = item?.title ?? basename(target);
  state.activeItemId = null;
  state.guidedIngest = {
    target,
    title,
    conversation: null,
    draft: "",
    busy: true,
  };
  renderReviewState(root);
  try {
    const conversation = await ensureGuidedIngestConversation(target, title);
    const nextState = getReviewPageState(root);
    nextState.guidedIngest = {
      ...(nextState.guidedIngest ?? {
        target,
        title,
        draft: "",
      }),
      target,
      title,
      conversation,
      busy: false,
    };
    renderReviewState(root);
  } catch (error) {
    closeGuidedIngestWorkspace(root);
    setReviewStatus(root, `打开指导录入失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

function closeGuidedIngestWorkspace(root: HTMLElement): void {
  const state = getReviewPageState(root);
  state.guidedIngest = null;
  renderReviewState(root);
}

function setGuidedIngestBusyState(root: HTMLElement, busy: boolean): GuidedIngestWorkspaceState | null {
  const state = getReviewPageState(root);
  if (!state.guidedIngest) {
    return null;
  }
  state.guidedIngest = {
    ...state.guidedIngest,
    busy,
  };
  renderReviewState(root);
  return state.guidedIngest;
}

function applyGuidedIngestConversation(root: HTMLElement, conversation: ChatConversation): boolean {
  const state = getReviewPageState(root);
  if (!state.guidedIngest) {
    return false;
  }
  state.guidedIngest = {
    ...state.guidedIngest,
    conversation,
    draft: "",
    busy: false,
  };
  renderReviewState(root);
  return true;
}

async function readSuccessfulReviewResponseData<T>(
  response: Response,
  invalidJsonMessage: string,
  fallbackMessage: string,
): Promise<T> {
  const payload = await readApiResponse<T>(response, invalidJsonMessage);
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? fallbackMessage);
  }
  return payload.data;
}

async function sendGuidedIngestMessage(root: HTMLElement): Promise<void> {
  const state = getReviewPageState(root);
  const workspaceState = state.guidedIngest;
  if (!workspaceState?.conversation) {
    return;
  }
  const content = workspaceState.draft.trim();
  if (!content) {
    return;
  }
  setGuidedIngestBusyState(root, true);
  try {
    const response = await fetch(`/api/chat/${encodeURIComponent(workspaceState.conversation.id)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        articleRefs: [workspaceState.target],
      }),
    });
    const conversation = await readSuccessfulReviewResponseData<ChatConversation>(
      response,
      "指导录入消息接口返回了无效内容。",
      "guided ingest send failed",
    );
    if (!applyGuidedIngestConversation(root, conversation)) {
      return;
    }
    setReviewStatus(root, `已更新指导录入对话：${workspaceState.title}`);
  } catch (error) {
    setGuidedIngestBusyState(root, false);
    setReviewStatus(root, `指导录入发送失败：${readErrorMessage(error)}`, "error");
  }
}

async function retryFlashDiaryFailure(root: HTMLElement, id: string): Promise<void> {
  if (!id) {
    return;
  }
  const response = await fetch(`/api/flash-diary/failures/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
  if (!response.ok) {
    return;
  }
  await loadReview(root);
}

function describeQueuedIngestStatus(result: { queued: number; skipped: number }): string {
  const skippedSuffix = result.skipped > 0 ? `，跳过 ${result.skipped} 条。` : "。";
  return `已加入 ${result.queued} 条优先批量录入队列${skippedSuffix}`;
}

function lockReviewActionButton(
  button: HTMLButtonElement | null | undefined,
  busyText: string,
): { restore: () => void } {
  const originalText = button?.textContent ?? "";
  if (button) {
    button.disabled = true;
    button.textContent = busyText;
  }
  return {
    restore: () => {
      if (!button) {
        return;
      }
      button.disabled = false;
      button.textContent = originalText;
    },
  };
}

async function requestInboxBatchIngest(target: string): Promise<{ queued: number; skipped: number }> {
  const response = await fetch("/api/review/inbox/batch-ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targets: [target] }),
  });
  return readSuccessfulReviewResponseData<{ queued: number; skipped: number }>(
    response,
    "优先批量录入接口返回了无效内容。",
    "review inbox batch ingest failed",
  );
}

async function queueInboxBatchIngest(
  root: HTMLElement,
  target: string,
  button?: HTMLButtonElement,
): Promise<void> {
  if (!target) {
    return;
  }
  const controls = lockReviewActionButton(button, "入队中...");
  try {
    setReviewStatus(root, describeQueuedIngestStatus(await requestInboxBatchIngest(target)));
  } catch (error) {
    setReviewStatus(root, `优先批量录入失败：${readErrorMessage(error)}`, "error");
  } finally {
    controls.restore();
  }
}

function readSelectedDeletableFailureIds(state: ReviewPageState): string[] {
  return state.items
    .filter((item) => state.selectedIds.has(item.id) && isReviewItemDeletable(item))
    .map((item) => item.id);
}

function lockReviewBatchDeleteButton(
  root: HTMLElement,
): { restore: () => void } {
  const button = root.querySelector<HTMLButtonElement>("[data-review-batch-delete]");
  const originalText = button?.textContent ?? "批量删除";
  if (button) {
    button.disabled = true;
    button.textContent = "删除中...";
  }
  return {
    restore: () => {
      if (button) {
        button.textContent = originalText;
      }
    },
  };
}

async function deleteReviewFailures(ids: readonly string[]): Promise<DeleteFailuresResponse> {
  const response = await fetch("/api/xhs-sync/failures", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const payload = await readApiResponse<DeleteFailuresResponse>(
    response,
    "删除接口未返回 JSON，请重启 WebUI 服务后再试。",
  );
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? "xhs failure delete failed");
  }
  return payload.data ?? { deleted: [...ids], remaining: 0 };
}

async function deleteSelectedXhsFailures(root: HTMLElement): Promise<void> {
  const state = getReviewPageState(root);
  const ids = readSelectedDeletableFailureIds(state);
  if (ids.length === 0) {
    return;
  }
  const controls = lockReviewBatchDeleteButton(root);
  setReviewStatus(root, "正在删除选中记录...");
  try {
    const deleted = await deleteReviewFailures(ids);
    state.selectedIds.clear();
    updateSelectionControls(root, state);
    await loadReview(root);
    setReviewStatus(root, `已删除 ${deleted.deleted.length} 项。`);
  } catch (error) {
    setReviewStatus(root, `删除失败：${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    controls.restore();
    updateSelectionControls(root, state);
  }
}

function restoreReviewItems(root: HTMLElement, items: readonly ReviewItem[], activeItemId: string | null): void {
  const state = getReviewPageState(root);
  state.items = [...items];
  state.activeItemId = activeItemId;
  renderReviewState(root);
}

async function requestBulkAdvance(): Promise<BulkAdvanceResponse> {
  const response = await fetch("/api/review/deep-research/bulk-advance", {
    method: "POST",
  });
  return readSuccessfulReviewResponseData<BulkAdvanceResponse>(
    response,
    "批量推进接口返回了无效内容。",
    "deep research bulk advance failed",
  );
}

async function bulkAdvanceDeepResearch(root: HTMLElement): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("[data-review-run-all]");
  if (!button || button.disabled) {
    return;
  }
  const state = getReviewPageState(root);
  const previousItems = [...state.items];
  const previousActiveItemId = state.activeItemId;
  const controls = lockReviewActionButton(button, "执行中...");
  setReviewStatus(root, "正在批量推进 Deep Research 卡片...");
  applyOptimisticBulkAdvance(root);
  try {
    const result = await requestBulkAdvance();
    await loadReview(root);
    setReviewStatus(root, `已启动 ${result.started} 项，确认写入 ${result.confirmed} 项，跳过 ${result.skipped} 项。`);
  } catch (error) {
    restoreReviewItems(root, previousItems, previousActiveItemId);
    setReviewStatus(root, `全部进行失败：${readErrorMessage(error)}`, "error");
  } finally {
    controls.restore();
    updateSelectionControls(root, getReviewPageState(root));
  }
}

async function requestBulkConfirm(): Promise<BulkConfirmResponse> {
  const response = await fetch("/api/review/deep-research/bulk-confirm", {
    method: "POST",
  });
  return readSuccessfulReviewResponseData<BulkConfirmResponse>(
    response,
    "批量写入接口返回了无效内容。",
    "deep research bulk confirm failed",
  );
}

async function bulkConfirmDeepResearch(root: HTMLElement): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("[data-review-confirm-all]");
  if (!button || button.disabled) {
    return;
  }
  const state = getReviewPageState(root);
  const previousItems = [...state.items];
  const previousActiveItemId = state.activeItemId;
  const controls = lockReviewActionButton(button, "写入中...");
  setReviewStatus(root, "正在批量确认写入 Deep Research 草案...");
  applyOptimisticBulkConfirm(root);
  try {
    const result = await requestBulkConfirm();
    await loadReview(root);
    setReviewStatus(root, `已确认写入 ${result.confirmed} 项，失败 ${result.failed} 项，跳过 ${result.skipped} 项。`);
  } catch (error) {
    restoreReviewItems(root, previousItems, previousActiveItemId);
    setReviewStatus(root, `全部写入失败：${readErrorMessage(error)}`, "error");
  } finally {
    controls.restore();
    updateSelectionControls(root, getReviewPageState(root));
  }
}

async function requestDeepResearchAction(id: string, action: DeepResearchAction): Promise<ReviewItem> {
  const response = await fetch(`/api/review/deep-research/${encodeURIComponent(id)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return readSuccessfulReviewResponseData<ReviewItem>(
    response,
    "deep research 动作接口返回了无效内容。",
    "deep research action failed",
  );
}

async function startDeepResearch(root: HTMLElement, id: string, action: string): Promise<void> {
  const normalized = normalizeDeepResearchAction(action);
  if (!id || !normalized) {
    return;
  }
  try {
    applyReviewItemUpdate(root, await requestDeepResearchAction(id, normalized));
    setReviewStatus(root, normalized === "ignore" ? "已忽略该 Deep Research 卡片。" : `${actionLabel(normalized)} 已启动。`);
  } catch (error) {
    setReviewStatus(root, `处理失败：${readErrorMessage(error)}`, "error");
  }
}

async function confirmDeepResearch(root: HTMLElement, id: string): Promise<void> {
  if (!id) {
    return;
  }
  try {
    const response = await fetch(`/api/review/deep-research/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
    });
    const payload = await readApiResponse<ReviewItem>(response, "deep research 确认接口返回了无效内容。");
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "deep research confirm failed");
    }
    applyReviewItemUpdate(root, payload.data);
    await loadReview(root);
    setReviewStatus(root, "确认写入完成。");
  } catch (error) {
    setReviewStatus(root, `确认写入失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

async function openDeepResearchChat(root: HTMLElement, id: string): Promise<void> {
  if (!id) {
    return;
  }
  try {
    const response = await fetch(`/api/review/deep-research/${encodeURIComponent(id)}/chat`, {
      method: "POST",
    });
    const payload = await readApiResponse<ChatLaunchResponse>(response, "deep research 对话接口返回了无效内容。");
    if (!response.ok || !payload.success || !payload.data) {
      throw new Error(payload.error ?? "deep research chat failed");
    }
    window.location.hash = `#/chat/${encodeURIComponent(payload.data.id)}`;
  } catch (error) {
    setReviewStatus(root, `打开对话失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

function applyReviewItemUpdate(root: HTMLElement, item: ReviewItem): void {
  const state = getReviewPageState(root);
  const shouldHide = isDeepResearchItem(item)
    && (item.deepResearch.status === "ignored" || item.deepResearch.status === "completed");
  state.items = shouldHide
    ? state.items.filter((candidate) => candidate.id !== item.id)
    : state.items.some((candidate) => candidate.id === item.id)
      ? state.items.map((candidate) => candidate.id === item.id ? item : candidate)
      : [item, ...state.items];
  state.activeItemId = shouldHide
    ? state.activeItemId === item.id ? null : state.activeItemId
    : isDeepResearchItem(item) ? item.id : state.activeItemId;
  renderReviewState(root);
}

function applyOptimisticBulkAdvance(root: HTMLElement): void {
  const state = getReviewPageState(root);
  state.items = state.items.flatMap((item) => {
    if (!isDeepResearchItem(item)) {
      return [item];
    }
    if (item.deepResearch.status === "pending") {
      return [{
        ...item,
        deepResearch: {
          ...item.deepResearch,
          status: "running",
          progress: 10,
          selectedAction: getPrimaryDeepResearchAction(item.deepResearch.category),
          errorMessage: undefined,
          draftResult: undefined,
          updatedAt: new Date().toISOString(),
        },
      }];
    }
    return [item];
  });
  if (state.activeItemId && !state.items.some((item) => item.id === state.activeItemId)) {
    state.activeItemId = null;
  }
  renderReviewState(root);
}

function applyOptimisticBulkConfirm(root: HTMLElement): void {
  const state = getReviewPageState(root);
  state.items = state.items.map((item) => {
    if (!isDeepResearchItem(item) || item.deepResearch.status !== "done-await-confirm") {
      return item;
    }
    return {
      ...item,
      deepResearch: {
        ...item.deepResearch,
        status: "confirming-write",
        progress: 95,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      },
    };
  });
  renderReviewState(root);
}

function syncReviewPolling(root: HTMLElement): void {
  clearReviewPoll(root);
  const state = getReviewPageState(root);
  const hasRunningItems = state.items.some((item) => isDeepResearchItem(item) && item.deepResearch.status === "running");
  if (!hasRunningItems || !root.isConnected) {
    return;
  }
  state.pollTimer = window.setTimeout(() => {
    state.pollTimer = null;
    void loadReview(root);
  }, REVIEW_POLL_INTERVAL_MS);
}

function clearReviewPoll(root: HTMLElement): void {
  const state = getReviewPageState(root);
  if (state.pollTimer !== null) {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

function setReviewStatus(root: HTMLElement, message: string, tone: "info" | "error" = "info"): void {
  const status = root.querySelector<HTMLElement>("[data-review-status]");
  if (!status) {
    return;
  }
  status.hidden = false;
  status.dataset.tone = tone;
  status.textContent = message;
}

async function startSystemCheckAutofix(root: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const originalText = button.textContent ?? "自动补齐双链";
  const progress = showRunProgress({
    key: "review-system-check-autofix",
    title: "自动补齐双链",
    message: "正在启动系统检查...",
    percent: 1,
  });
  button.disabled = true;
  button.textContent = "补齐中...";
  setReviewStatus(root, "正在自动补齐双链并重新检查...");
  try {
    const run = await requestSystemCheckRun();
    const completedRun = run.status === "running" ? await waitForRunCompletion(run, progress) : run;
    settleSystemCheckAutofix(root, progress, completedRun);
    await loadReview(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.fail(`自动补齐失败：${message}`);
    setReviewStatus(root, `自动补齐失败：${message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function requestSystemCheckRun(): Promise<RunSnapshot> {
  const response = await fetch("/api/runs/check", { method: "POST" });
  const payload = await readApiResponse<RunSnapshot>(response, "系统检查接口返回了无效内容。");
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "system check start failed");
  }
  return payload.data;
}

function waitForRunCompletion(run: RunSnapshot, progress: RunProgressHandle): Promise<RunSnapshot> {
  progress.update("系统检查运行中...", 8);
  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(`/api/runs/${encodeURIComponent(run.id)}/events`);
    let settled = false;
    const finish = (result: RunSnapshot | null, error?: Error): void => {
      if (settled) return;
      settled = true;
      eventSource.close();
      if (error) reject(error);
      else resolve(result ?? run);
    };
    eventSource.addEventListener("status", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as RunStatusEvent;
        if (!payload.run || payload.run.status === "running") return;
        finish(payload.run);
      } catch (error) {
        finish(null, error instanceof Error ? error : new Error(String(error)));
      }
    });
    eventSource.onerror = () => finish(null, new Error("运行进度连接中断"));
  });
}

function settleSystemCheckAutofix(root: HTMLElement, progress: RunProgressHandle, run: RunSnapshot): void {
  if (run.status === "succeeded") {
    progress.complete("自动补齐完成，系统检查通过");
    setReviewStatus(root, "自动补齐完成，系统检查通过。");
    return;
  }
  progress.fail("已自动补齐，仍有检查项未通过");
  setReviewStatus(root, "已运行自动补齐，仍有检查项未通过，已刷新列表。", "error");
}

async function readApiResponse<T>(response: Response, htmlFallbackMessage: string): Promise<ApiResponse<T>> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as ApiResponse<T>;
  } catch {
    if (/<!DOCTYPE html/i.test(raw) || /<html/i.test(raw)) {
      throw new Error(htmlFallbackMessage);
    }
    throw new Error("接口返回了无效的 JSON 内容。");
  }
}

async function ensureGuidedIngestConversation(target: string, title: string): Promise<ChatConversation> {
  const storageKey = getGuidedIngestConversationStorageKey(target);
  const existingId = window.localStorage.getItem(storageKey);
  if (existingId) {
    try {
      return await requestChatConversation(existingId);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `指导录入：${title}`,
      articleRefs: [target],
      searchScope: "local",
      agentId: "wiki-general",
    }),
  });
  const payload = await readApiResponse<ChatConversation>(
    response,
    "创建指导录入对话时返回了无效内容。",
  );
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "guided ingest create failed");
  }
  window.localStorage.setItem(storageKey, payload.data.id);
  return payload.data;
}

async function requestChatConversation(id: string): Promise<ChatConversation> {
  const response = await fetch(`/api/chat/${encodeURIComponent(id)}`);
  const payload = await readApiResponse<ChatConversation>(
    response,
    "读取指导录入对话时返回了无效内容。",
  );
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "guided ingest conversation load failed");
  }
  return payload.data;
}

function getGuidedIngestConversationStorageKey(target: string): string {
  return `llmWiki.reviewGuidedConversation:${target}`;
}

function formatKind(kind: ReviewKind): string {
  const labels: Record<ReviewKind, string> = {
    "deep-research": "Deep Research",
    run: "运行任务",
    state: "系统状态",
    inbox: "inbox 原料",
    "flash-diary-failure": "闪念日记",
    "xhs-sync-failure": "小红书同步",
  };
  return labels[kind];
}

function formatSeverity(severity: ReviewSeverity): string {
  const labels: Record<ReviewSeverity, string> = {
    info: "信息",
    suggest: "建议",
    warn: "警告",
    error: "错误",
  };
  return labels[severity];
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatDeepResearchStatus(status: DeepResearchStatus): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "running":
      return "执行中";
    case "confirming-write":
      return "确认写入中";
    case "done-await-confirm":
      return "待确认写入";
    case "failed":
      return "执行失败";
    case "ignored":
      return "已忽略";
    case "completed":
      return "已完成";
  }
}

function formatDeepResearchProgress(deepResearch: DeepResearchReviewData): string {
  if (deepResearch.status === "pending") {
    return "0% 待处理";
  }
  if (deepResearch.status === "confirming-write") {
    return `${deepResearch.progress}% 确认写入中`;
  }
  if (deepResearch.status === "done-await-confirm") {
    return "100% 待确认";
  }
  if (deepResearch.status === "failed") {
    return "失败";
  }
  if (deepResearch.status === "completed") {
    return "100% 已完成";
  }
  return `${deepResearch.progress}% ${formatDeepResearchStatus(deepResearch.status)}`;
}

function getPrimaryDeepResearchAction(category: DeepResearchCategory): DeepResearchAction {
  switch (category) {
    case "outdated-source":
      return "start-rewrite";
    case "missing-citation":
      return "add-citation";
    case "needs-deep-research":
      return "deep-research";
    case "suggestion":
      return "accept-suggestion";
  }
}

function actionLabel(action: DeepResearchAction): string {
  switch (action) {
    case "start-rewrite":
      return "发起改写";
    case "add-citation":
      return "补引用";
    case "deep-research":
      return "Deep Research";
    case "accept-suggestion":
      return "接受建议";
    case "ignore":
      return "忽略";
  }
}

function countRunnableDeepResearchItems(items: readonly ReviewItem[]): number {
  return items.filter((item) => isDeepResearchItem(item) && item.deepResearch.status === "pending").length;
}

function countConfirmableDeepResearchItems(items: readonly ReviewItem[]): number {
  return items.filter((item) => isDeepResearchItem(item) && item.deepResearch.status === "done-await-confirm").length;
}

function normalizeDeepResearchAction(value: string): DeepResearchAction | null {
  return value === "start-rewrite"
    || value === "add-citation"
    || value === "deep-research"
    || value === "accept-suggestion"
    || value === "ignore"
    ? value
    : null;
}

function isDeepResearchItem(item: ReviewItem): item is ReviewItem & { deepResearch: DeepResearchReviewData } {
  return item.kind === "deep-research" && Boolean(item.deepResearch);
}

function isStateDetailItem(item: ReviewItem): item is ReviewItem & { stateInfo: ReviewStateInfo } {
  return item.kind === "state" && Boolean(item.stateInfo) && item.stateInfo.frozenSlugs.length > 0;
}

function isInboxDetailItem(item: ReviewItem | null | undefined): item is ReviewItem {
  return item?.kind === "inbox";
}

function isSystemCheckRunItem(item: ReviewItem): boolean {
  return item.kind === "run" && item.run?.kind === "check";
}

function isWorkspaceDetailItem(item: ReviewItem): boolean {
  return isDeepResearchItem(item) || isStateDetailItem(item) || isInboxDetailItem(item);
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

function renderReviewPageLink(pagePath: string): string {
  return `<a class="review-link" href="${wikiRouteHref(pagePath)}" data-review-open-page="${escapeHtml(pagePath)}">${escapeHtml(pagePath)}</a>`;
}

function wikiRouteHref(pagePath: string): string {
  return `#/wiki/${encodeURIComponent(pagePath)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return character;
    }
  });
}
