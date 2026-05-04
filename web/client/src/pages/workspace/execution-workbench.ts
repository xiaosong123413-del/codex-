/**
 * Execution-site workbench for the workspace work-log page.
 *
 * The execution-site documents remain separate wiki/runtime records, but the
 * workspace exposes them as one operational surface. This module owns the
 * read-only dashboard rendering and the small tab interaction used inside the
 * work-log document area.
 */
import { renderIcon } from "../../components/icon.js";
import {
  bindArchiveActions,
  fetchExecutionTaskOptions,
  renderArchiveQueueItems,
  type ExecutionTaskOption,
} from "./execution-workbench-archive.js";

const EXECUTION_WORKBENCH_PATH = "wiki/专题/00-执行现场/index.md";
const MAX_QUEUE_ITEMS = 4;

interface ExecutionWorkbenchDocument {
  path: string;
  label: string;
  title: string | null;
}

interface WorkflowArtifactsPayload {
  events: readonly unknown[];
  pendingConfirm: readonly unknown[];
  pendingArchive: readonly unknown[];
}

interface MetricCard {
  label: string;
  value: number;
  icon: string;
  tone: "blue" | "teal" | "amber" | "green" | "red";
}

interface QueueGroup {
  key: "binding" | "archive";
  label: string;
  items: readonly unknown[];
}

/** Returns true when a workspace document should use the integrated workbench. */
export function isExecutionWorkbenchDocument(document: Pick<ExecutionWorkbenchDocument, "path">): boolean {
  return document.path === EXECUTION_WORKBENCH_PATH;
}

/** Renders the static shell that will be hydrated from workflow artifact data. */
export function renderExecutionWorkbenchDocument(document: ExecutionWorkbenchDocument): string {
  const title = document.title ?? document.label;
  return `
    <section class="workspace-log-wiki-entry workspace-execution-entry" data-workspace-wiki-open data-wiki-current-path="${escapeHtml(document.path)}">
      <main class="workspace-execution-page">
        <header class="workspace-execution-page__head">
          <div>
            <p class="eyebrow">EXECUTION</p>
            <h1>${escapeHtml(title)}</h1>
          </div>
          <button type="button" class="workspace-execution-page__button" data-execution-workbench-refresh>
            ${renderIcon("refresh-cw", { size: 16 })}
            <span>刷新</span>
          </button>
        </header>
        <div class="workspace-execution-workbench" data-execution-workbench>
          <div class="workspace-execution-workbench__loading">正在读取执行现场...</div>
        </div>
      </main>
    </section>
  `;
}

/** Mounts data loading and queue tabs for any execution workbench in the root. */
export function mountExecutionWorkbench(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-execution-workbench]").forEach((container) => {
    if (container.dataset.executionWorkbenchMounted === "true") return;
    container.dataset.executionWorkbenchMounted = "true";
    bindRefresh(root, container);
    void loadExecutionWorkbench(container);
  });
}

function bindRefresh(root: ParentNode, container: HTMLElement): void {
  root.querySelector<HTMLButtonElement>("[data-execution-workbench-refresh]")?.addEventListener("click", () => {
    void loadExecutionWorkbench(container);
  });
}

async function loadExecutionWorkbench(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div class="workspace-execution-workbench__loading">正在读取执行现场...</div>`;
  try {
    const response = await fetch("/api/workflow-artifacts");
    const parsed = parseWorkflowArtifactsResponse(await response.json());
    if (!response.ok || !parsed.success || !parsed.data) {
      throw new Error(parsed.error || "执行现场读取失败");
    }
    const taskOptions = await loadArchiveTaskOptions(parsed.data);
    container.innerHTML = renderExecutionWorkbench(parsed.data, taskOptions);
    bindQueueTabs(container);
    bindArchiveActions(container, () => loadExecutionWorkbench(container));
  } catch (error) {
    const message = error instanceof Error ? error.message : "执行现场读取失败";
    container.innerHTML = `<div class="workspace-execution-workbench__error">${escapeHtml(message)}</div>`;
  }
}

async function loadArchiveTaskOptions(data: WorkflowArtifactsPayload): Promise<ExecutionTaskOption[]> {
  return data.pendingArchive.length > 0 ? fetchExecutionTaskOptions() : [];
}

function renderExecutionWorkbench(data: WorkflowArtifactsPayload, taskOptions: readonly ExecutionTaskOption[]): string {
  const todayEvents = data.events.filter(isTodayRecord);
  const archivedEvents = data.events.filter(isArchivedEvent);
  const metrics = buildMetrics(data, todayEvents.length, archivedEvents.length);
  return `
    <section class="workspace-execution-metrics" aria-label="执行现场状态">
      ${metrics.map(renderMetric).join("")}
    </section>
    <section class="workspace-execution-grid">
      ${renderTodayPanel(todayEvents)}
      ${renderQueuePanel(data, taskOptions)}
      ${renderArchivedPanel(archivedEvents)}
      ${renderEventPanel(data.events)}
    </section>
  `;
}

function buildMetrics(data: WorkflowArtifactsPayload, todayCount: number, archivedCount: number): MetricCard[] {
  return [
    { label: "今日行动", value: todayCount, icon: "list-checks", tone: "blue" },
    { label: "待绑定任务", value: data.pendingConfirm.length, icon: "link", tone: "teal" },
    { label: "待归档记录", value: data.pendingArchive.length, icon: "archive", tone: "amber" },
    { label: "已归档记录", value: archivedCount, icon: "check-circle-2", tone: "green" },
    { label: "Workflow Event", value: data.events.length, icon: "clipboard-list", tone: "red" },
  ];
}

function renderMetric(metric: MetricCard): string {
  return `
    <article class="workspace-execution-metric" data-tone="${metric.tone}">
      <span>${renderIcon(metric.icon, { size: 17 })}${escapeHtml(metric.label)}</span>
      <strong>${metric.value}</strong>
    </article>
  `;
}

function renderTodayPanel(items: readonly unknown[]): string {
  return renderPanel("今日行动", "list-checks", renderQueueItems(items, "今天暂无行动记录。"), "primary");
}

function renderArchivedPanel(items: readonly unknown[]): string {
  return renderPanel("最近完成", "check-circle-2", renderQueueItems(items, "暂无已归档记录。"), "secondary");
}

function renderEventPanel(items: readonly unknown[]): string {
  return renderPanel("Workflow Event", "clipboard-list", renderQueueItems(items, "暂无 Workflow Event。"), "secondary");
}

function renderQueuePanel(data: WorkflowArtifactsPayload, taskOptions: readonly ExecutionTaskOption[]): string {
  const groups: QueueGroup[] = [
    { key: "binding", label: "待绑定", items: data.pendingConfirm },
    { key: "archive", label: "待归档", items: data.pendingArchive },
  ];
  return `
    <section class="workspace-execution-panel workspace-execution-panel--queue">
      <header class="workspace-execution-panel__head">
        <h2>${renderIcon("archive", { size: 18 })}<span>待处理队列</span></h2>
        <div class="workspace-execution-tabs" role="tablist" aria-label="待处理类型">
          ${groups.map(renderQueueTab).join("")}
        </div>
      </header>
      ${groups.map((group, index) => renderQueueBody(group, index, taskOptions)).join("")}
    </section>
  `;
}

function renderQueueTab(group: QueueGroup, index: number): string {
  const active = index === 0;
  return `
    <button type="button" class="workspace-execution-tab${active ? " is-active" : ""}" data-execution-tab="${group.key}" role="tab" aria-selected="${active ? "true" : "false"}">
      ${escapeHtml(group.label)}
    </button>
  `;
}

function renderQueueBody(group: QueueGroup, index: number, taskOptions: readonly ExecutionTaskOption[]): string {
  const body = group.key === "archive"
    ? renderArchiveQueueItems(group.items.slice(0, MAX_QUEUE_ITEMS), taskOptions, "暂无待处理记录。")
    : renderQueueItems(group.items, "暂无待处理记录。");
  return `
    <div class="workspace-execution-queue${index === 0 ? " is-active" : ""}" data-execution-queue="${group.key}">
      ${body}
    </div>
  `;
}

function renderPanel(title: string, icon: string, body: string, variant: "primary" | "secondary"): string {
  return `
    <section class="workspace-execution-panel workspace-execution-panel--${variant}">
      <header class="workspace-execution-panel__head">
        <h2>${renderIcon(icon, { size: 18 })}<span>${escapeHtml(title)}</span></h2>
      </header>
      ${body}
    </section>
  `;
}

function renderQueueItems(items: readonly unknown[], emptyCopy: string): string {
  const visibleItems = items.slice(0, MAX_QUEUE_ITEMS);
  if (visibleItems.length === 0) {
    return `<p class="workspace-execution-empty">${escapeHtml(emptyCopy)}</p>`;
  }
  return `<div class="workspace-execution-list">${visibleItems.map(renderQueueItem).join("")}</div>`;
}

function renderQueueItem(item: unknown): string {
  const record = asRecord(item);
  const title = readRecordTitle(record);
  const meta = readRecordMeta(record);
  const time = readRecordTime(record);
  return `
    <article class="workspace-execution-row">
      <span class="workspace-execution-row__dot"></span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml([time, meta].filter(Boolean).join(" · ") || "待处理")}</span>
      </div>
    </article>
  `;
}

function bindQueueTabs(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>("[data-execution-tab]").forEach((button) => {
    button.addEventListener("click", () => activateQueue(container, button.dataset.executionTab ?? ""));
  });
}

function activateQueue(container: HTMLElement, key: string): void {
  container.querySelectorAll<HTMLButtonElement>("[data-execution-tab]").forEach((button) => {
    const active = button.dataset.executionTab === key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  container.querySelectorAll<HTMLElement>("[data-execution-queue]").forEach((body) => {
    body.classList.toggle("is-active", body.dataset.executionQueue === key);
  });
}

function parseWorkflowArtifactsResponse(value: unknown): {
  success: boolean;
  data: WorkflowArtifactsPayload | null;
  error: string;
} {
  const record = asRecord(value);
  if (!record) return { success: false, data: null, error: "执行现场响应格式错误" };
  return {
    success: record.success === true,
    data: parseWorkflowArtifactsPayload(record.data),
    error: readString(record.error),
  };
}

function parseWorkflowArtifactsPayload(value: unknown): WorkflowArtifactsPayload | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    events: readArray(record.events),
    pendingConfirm: readArray(record.pendingConfirm),
    pendingArchive: readArray(record.pendingArchive),
  };
}

function readRecordTitle(record: Record<string, unknown> | null): string {
  return readString(record?.raw_input) || readString(record?.text) || readString(record?.id) || "未命名记录";
}

const RECORD_META_KEYS = ["matched_task", "event_type", "confidence", "eventId", "event_id"] as const;

function readRecordMeta(record: Record<string, unknown> | null): string {
  for (const key of RECORD_META_KEYS) {
    const value = readString(record?.[key]);
    if (value) return value;
  }
  return "";
}

function readRecordTime(record: Record<string, unknown> | null): string {
  const createdAt = readString(record?.createdAt);
  if (!createdAt) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(date);
}

function isTodayRecord(item: unknown): boolean {
  const createdAt = readString(asRecord(item)?.createdAt);
  if (!createdAt) return false;
  const date = new Date(createdAt);
  const today = new Date();
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
}

function isArchivedEvent(item: unknown): boolean {
  return readString(asRecord(item)?.confidence) === "high";
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return escaped[character] ?? character;
  });
}
