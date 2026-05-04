/**
 * Execution workbench archive controls.
 *
 * The merged execution-site page shows workflow records from runtime queues.
 * This module owns the operational archive path for low-confidence records:
 * load active task-pool tasks, render a task selector beside each pending
 * archive record, post the selected record/task pair to the existing workflow
 * recorder archive API, and report inline status before the workbench reloads.
 */
import { renderIcon } from "../../components/icon.js";

export interface ExecutionTaskOption {
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly project: string;
}

interface WorkflowArchiveResult {
  readonly status: "archived" | "pending";
  readonly message: string;
}

interface ArchiveResponse {
  readonly success: boolean;
  readonly data: WorkflowArchiveResult | null;
  readonly error: string;
}

interface TaskStateResponse {
  readonly success: boolean;
  readonly tasks: ExecutionTaskOption[];
  readonly error: string;
}

interface ArchiveRequest {
  readonly recordId: string;
  readonly taskId: string;
}

/** Loads active task-pool tasks that a pending workflow record can archive into. */
export async function fetchExecutionTaskOptions(): Promise<ExecutionTaskOption[]> {
  const response = await fetch("/api/task-plan/state");
  const payload: unknown = await response.json();
  const parsed = parseTaskStateResponse(payload);
  if (!response.ok || !parsed.success) {
    throw new Error(parsed.error || "任务池读取失败");
  }
  return parsed.tasks;
}

/** Renders pending archive rows with a task selector and archive command. */
export function renderArchiveQueueItems(
  items: readonly unknown[],
  taskOptions: readonly ExecutionTaskOption[],
  emptyCopy: string,
): string {
  if (items.length === 0) {
    return `<p class="workspace-execution-empty">${escapeHtml(emptyCopy)}</p>`;
  }
  return `<div class="workspace-execution-list">${items.map((item) => renderArchiveQueueItem(item, taskOptions)).join("")}</div>`;
}

/** Binds manual archive controls and reloads the workbench after success. */
export function bindArchiveActions(container: HTMLElement, reload: () => Promise<void>): void {
  container.querySelectorAll<HTMLSelectElement>("[data-execution-archive-task]").forEach((select) => {
    select.addEventListener("change", () => syncArchiveButton(container, select.dataset.executionArchiveTask ?? ""));
    syncArchiveButton(container, select.dataset.executionArchiveTask ?? "");
  });
  container.querySelectorAll<HTMLButtonElement>("[data-execution-archive-record]").forEach((button) => {
    button.addEventListener("click", () => {
      void archiveQueueRecord(container, button, reload);
    });
  });
}

function renderArchiveQueueItem(item: unknown, taskOptions: readonly ExecutionTaskOption[]): string {
  const record = asRecord(item);
  const recordId = readString(record?.id);
  const selectedTaskId = readSelectedTaskId(record, taskOptions);
  const title = readRecordTitle(record);
  const meta = readRecordMeta(record);
  const time = readRecordTime(record);
  return `
    <article class="workspace-execution-row workspace-execution-row--actionable">
      <span class="workspace-execution-row__dot"></span>
      <div class="workspace-execution-row__body">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml([time, meta].filter(Boolean).join(" · ") || "待归档")}</span>
        ${renderArchiveControls(recordId, selectedTaskId, taskOptions)}
      </div>
    </article>
  `;
}

function renderArchiveControls(
  recordId: string,
  selectedTaskId: string,
  taskOptions: readonly ExecutionTaskOption[],
): string {
  const disabled = !recordId || !selectedTaskId || taskOptions.length === 0;
  const status = taskOptions.length === 0 ? "没有可归档任务" : "";
  return `
    <div class="workspace-execution-archive">
      ${renderTaskSelect(recordId, selectedTaskId, taskOptions)}
      <button type="button" class="workspace-execution-archive__button" data-execution-archive-record="${escapeHtml(recordId)}"${disabled ? " disabled" : ""}>
        ${renderIcon("archive", { size: 14 })}
        <span>归档</span>
      </button>
      <span class="workspace-execution-archive__status" data-execution-archive-status="${escapeHtml(recordId)}">${escapeHtml(status)}</span>
    </div>
  `;
}

function renderTaskSelect(
  recordId: string,
  selectedTaskId: string,
  taskOptions: readonly ExecutionTaskOption[],
): string {
  const disabled = taskOptions.length === 0 ? " disabled" : "";
  return `
    <select class="workspace-execution-archive__select" data-execution-archive-task="${escapeHtml(recordId)}" aria-label="归档任务"${disabled}>
      <option value="">选择任务</option>
      ${taskOptions.map((task) => renderTaskOption(task, selectedTaskId)).join("")}
    </select>
  `;
}

function renderTaskOption(task: ExecutionTaskOption, selectedTaskId: string): string {
  const selected = task.id === selectedTaskId ? " selected" : "";
  return `<option value="${escapeHtml(task.id)}"${selected}>${escapeHtml(formatTaskLabel(task))}</option>`;
}

function formatTaskLabel(task: ExecutionTaskOption): string {
  const context = [task.domain, task.project].filter(Boolean).join(" / ");
  return context ? `${task.title} · ${context}` : task.title;
}

async function archiveQueueRecord(
  container: HTMLElement,
  button: HTMLButtonElement,
  reload: () => Promise<void>,
): Promise<void> {
  const recordId = button.dataset.executionArchiveRecord ?? "";
  const taskId = findArchiveTaskSelect(container, recordId)?.value.trim() ?? "";
  if (!recordId || !taskId) {
    setArchiveStatus(container, recordId, "先选择任务", true);
    return;
  }
  button.disabled = true;
  setArchiveStatus(container, recordId, "正在归档...", false);
  try {
    const result = await postExecutionArchive({ recordId, taskId });
    setArchiveStatus(container, recordId, result.message, false);
    await reload();
  } catch (error) {
    setArchiveStatus(container, recordId, error instanceof Error ? error.message : "归档失败", true);
    syncArchiveButton(container, recordId);
  }
}

async function postExecutionArchive(input: ArchiveRequest): Promise<WorkflowArchiveResult> {
  const response = await fetch("/api/workflow-recorder/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload: unknown = await response.json();
  const parsed = parseArchiveResponse(payload);
  if (!response.ok || !parsed.success || !parsed.data) {
    throw new Error(parsed.error || "归档失败");
  }
  return parsed.data;
}

function syncArchiveButton(container: HTMLElement, recordId: string): void {
  const button = findArchiveButton(container, recordId);
  const select = findArchiveTaskSelect(container, recordId);
  if (!button || !select) return;
  button.disabled = !select.value;
}

function setArchiveStatus(container: HTMLElement, recordId: string, message: string, isError: boolean): void {
  const status = findArchiveStatus(container, recordId);
  if (!status) return;
  status.textContent = message;
  status.dataset.state = isError ? "error" : "idle";
}

function findArchiveTaskSelect(container: HTMLElement, recordId: string): HTMLSelectElement | null {
  return findByRecordId(container.querySelectorAll<HTMLSelectElement>("[data-execution-archive-task]"), recordId);
}

function findArchiveButton(container: HTMLElement, recordId: string): HTMLButtonElement | null {
  return findByRecordId(container.querySelectorAll<HTMLButtonElement>("[data-execution-archive-record]"), recordId);
}

function findArchiveStatus(container: HTMLElement, recordId: string): HTMLElement | null {
  return findByRecordId(container.querySelectorAll<HTMLElement>("[data-execution-archive-status]"), recordId);
}

function findByRecordId<T extends HTMLElement>(items: NodeListOf<T>, recordId: string): T | null {
  for (const item of items) {
    const currentId = item.dataset.executionArchiveTask
      ?? item.dataset.executionArchiveRecord
      ?? item.dataset.executionArchiveStatus;
    if (currentId === recordId) return item;
  }
  return null;
}

function readSelectedTaskId(
  record: Record<string, unknown> | null,
  taskOptions: readonly ExecutionTaskOption[],
): string {
  const taskIds = new Set(taskOptions.map((task) => task.id));
  return readCandidateTaskIds(record).find((taskId) => taskIds.has(taskId)) ?? "";
}

function readCandidateTaskIds(record: Record<string, unknown> | null): string[] {
  return readArray(record?.candidates)
    .map((candidate) => readString(asRecord(candidate)?.taskId))
    .filter(Boolean);
}

function parseTaskStateResponse(value: unknown): TaskStateResponse {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  const state = asRecord(data?.state);
  const pool = asRecord(state?.pool);
  return {
    success: record?.success === true,
    tasks: readArray(pool?.items).map(readTaskOption).filter(isTaskOption),
    error: readError(record?.error),
  };
}

function readTaskOption(value: unknown): ExecutionTaskOption | null {
  const record = asRecord(value);
  const id = readString(record?.id);
  const title = readString(record?.title);
  if (!id || !title || readString(record?.completedAt)) return null;
  return {
    id,
    title,
    domain: readString(record?.domain),
    project: readString(record?.project),
  };
}

function isTaskOption(value: ExecutionTaskOption | null): value is ExecutionTaskOption {
  return value !== null;
}

function parseArchiveResponse(value: unknown): ArchiveResponse {
  const record = asRecord(value);
  return {
    success: record?.success === true,
    data: readArchiveResult(record?.data),
    error: readError(record?.error),
  };
}

function readArchiveResult(value: unknown): WorkflowArchiveResult | null {
  const record = asRecord(value);
  const status = readString(record?.status);
  if (status !== "archived" && status !== "pending") return null;
  return { status, message: readString(record?.message) || "已归档" };
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

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readError(value: unknown): string {
  return readString(value) || readString(asRecord(value)?.message);
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
