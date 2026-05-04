/**
 * View helpers for the flash-diary page.
 *
 * Keeps render/state helpers out of the main page binder so the workspace can
 * stay small while supporting diary files, Memory, and peer editable docs.
 */

import type { WikiCommentSurfaceController } from "../../components/wiki-comments.js";
import type { WikiSelectionToolbarController } from "../../components/wiki-selection-toolbar.js";

interface FlashDiaryFileSummary {
  path: string;
  title: string;
  date: string;
  entryCount: number;
  modifiedAt: string;
  thumbnailUrl?: string | null;
}

interface FlashDiaryDocumentSummary {
  kind: "document";
  title: string;
  path: string;
  description: string;
  exists: boolean;
  modifiedAt: string | null;
}

interface FlashDiaryMemorySummary {
  kind: "memory";
  title: string;
  path: string;
  description: string;
  exists: boolean;
  modifiedAt: string | null;
  lastAppliedDiaryDate: string | null;
}

export interface FlashDiaryPageResponse {
  path: string;
  title: string;
  raw: string;
  html: string;
  modifiedAt: string;
  entryCount: number;
}

export interface FlashDiaryMemoryPageResponse {
  path: string;
  title: string;
  raw: string;
  html: string;
  modifiedAt: string;
  sourceEditable: boolean;
  lastAppliedDiaryDate: string | null;
}

export interface FlashDiaryListPayload {
  items: FlashDiaryFileSummary[];
  memory?: FlashDiaryMemorySummary;
  twelveQuestions?: FlashDiaryDocumentSummary;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FlashDiaryPageRefs {
  list: HTMLElement;
  title: HTMLElement;
  meta: HTMLElement;
  visualEditorHost: HTMLElement;
  editor: HTMLTextAreaElement;
  saveButton: HTMLButtonElement;
  memoryRefreshButton: HTMLButtonElement;
  memoryCommentButton: HTMLButtonElement;
  memoryLayout: HTMLElement;
  memoryBody: HTMLElement;
}

interface FlashDiaryPageState {
  view: ActiveView;
  currentPath: string;
  savedRaw: string;
  items: FlashDiaryFileSummary[];
  memory: FlashDiaryMemorySummary;
  twelveQuestions: FlashDiaryDocumentSummary;
}

type ActiveView = "empty" | "diary" | "memory" | "document";

export const MEMORY_PATH = "wiki/journal-memory.md";
export const MEMORY_TITLE = "Memory";
export const TWELVE_QUESTIONS_PATH = "wiki/journal-twelve-questions.md";
const TWELVE_QUESTIONS_TITLE = "十二个问题";

export function createPageState(): FlashDiaryPageState {
  return {
    view: "empty",
    currentPath: "",
    savedRaw: "",
    items: [],
    memory: createDefaultMemorySummary(),
    twelveQuestions: createDefaultTwelveQuestionsSummary(),
  };
}

export function applyDiaryView(refs: FlashDiaryPageRefs, page: FlashDiaryPageResponse, state: FlashDiaryPageState): void {
  state.view = "diary";
  refs.title.textContent = page.title;
  refs.meta.textContent = `${formatTime(page.modifiedAt)} · ${page.entryCount} 条记录`;
  refs.visualEditorHost.hidden = false;
  refs.editor.value = page.raw;
  refs.editor.placeholder = "尚未加载日记";
  refs.editor.readOnly = false;
  refs.editor.hidden = true;
  refs.memoryLayout.hidden = true;
  refs.saveButton.hidden = false;
  refs.saveButton.disabled = true;
  refs.memoryRefreshButton.hidden = true;
  refs.memoryCommentButton.hidden = true;
}

export function applyDocumentView(
  refs: FlashDiaryPageRefs,
  page: FlashDiaryPageResponse,
  state: FlashDiaryPageState,
  summary: FlashDiaryDocumentSummary,
): void {
  state.view = "document";
  refs.title.textContent = page.title;
  refs.meta.textContent = formatDocumentMeta(summary);
  refs.visualEditorHost.hidden = true;
  refs.editor.value = page.raw;
  refs.editor.placeholder = "文档内容";
  refs.editor.readOnly = false;
  refs.editor.hidden = false;
  refs.memoryLayout.hidden = true;
  refs.saveButton.hidden = false;
  refs.saveButton.disabled = true;
  refs.memoryRefreshButton.hidden = true;
  refs.memoryCommentButton.hidden = true;
}

export function applyMemoryView(refs: FlashDiaryPageRefs, page: FlashDiaryMemoryPageResponse): void {
  refs.title.textContent = page.title;
  refs.meta.textContent = `${formatTime(page.modifiedAt)} · 已处理到 ${page.lastAppliedDiaryDate ?? "尚未写入日记"}`;
  refs.memoryBody.innerHTML = page.html;
  refs.visualEditorHost.hidden = true;
  refs.editor.hidden = true;
  refs.memoryLayout.hidden = false;
  refs.saveButton.hidden = true;
  refs.memoryRefreshButton.hidden = false;
  refs.memoryCommentButton.hidden = false;
}

export function resetView(
  selectionToolbar: WikiSelectionToolbarController,
  comments: WikiCommentSurfaceController,
  refs: FlashDiaryPageRefs,
  state: FlashDiaryPageState,
): void {
  state.view = "empty";
  state.currentPath = "";
  state.savedRaw = "";
  selectionToolbar.reset();
  refs.title.textContent = "未选中文档";
  refs.meta.textContent = "请从左侧选择一篇日记、十二个问题或 Memory。";
  refs.visualEditorHost.hidden = true;
  refs.editor.value = "";
  refs.editor.placeholder = "尚未加载日记";
  refs.editor.readOnly = false;
  refs.editor.hidden = false;
  refs.memoryLayout.hidden = true;
  refs.saveButton.hidden = false;
  refs.saveButton.disabled = true;
  refs.memoryRefreshButton.hidden = true;
  refs.memoryCommentButton.hidden = true;
  comments.clear("当前没有打开可评论的页面。");
}

export function renderList(list: HTMLElement, state: FlashDiaryPageState, showDiaryEmpty = false): void {
  const diaryItems = state.items.map((item) => renderDiaryListItem(item, item.path === state.currentPath));
  const items = [
    renderDocumentItem(state.twelveQuestions, state.currentPath === TWELVE_QUESTIONS_PATH),
    renderMemoryItem(state.memory, state.currentPath === MEMORY_PATH),
    diaryItems.length > 0 ? `<div class="flash-diary-page__timeline" data-flash-diary-timeline>${diaryItems.join("")}</div>` : "",
  ];
  if (showDiaryEmpty || state.items.length === 0) {
    items.push(`<div class="flash-diary-page__empty">还没有闪念日记。</div>`);
  }
  list.innerHTML = items.join("");
}

export function bindListActions(
  list: HTMLElement,
  handlers: {
    openDiary: (relativePath: string) => Promise<void>;
    openMemory: () => Promise<void>;
    openTwelveQuestions: () => Promise<void>;
  },
): void {
  list.querySelector<HTMLButtonElement>("[data-flash-diary-twelve-questions]")?.addEventListener("click", () => {
    void handlers.openTwelveQuestions();
  });
  list.querySelector<HTMLButtonElement>("[data-flash-diary-memory]")?.addEventListener("click", () => {
    void handlers.openMemory();
  });
  list.querySelectorAll<HTMLButtonElement>("[data-flash-diary-path]").forEach((button) => {
    button.addEventListener("click", () => {
      void handlers.openDiary(button.dataset.flashDiaryPath ?? "");
    });
  });
}

export function syncActiveItem(list: HTMLElement, currentPath: string): void {
  list.querySelector("[data-flash-diary-twelve-questions]")?.classList.toggle("is-active", currentPath === TWELVE_QUESTIONS_PATH);
  list.querySelector("[data-flash-diary-memory]")?.classList.toggle("is-active", currentPath === MEMORY_PATH);
  list.querySelectorAll<HTMLElement>("[data-flash-diary-path]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-flash-diary-path") === currentPath);
  });
}

export function createDefaultMemorySummary(): FlashDiaryMemorySummary {
  return {
    kind: "memory",
    title: MEMORY_TITLE,
    path: MEMORY_PATH,
    description: "根据日记沉淀的分层记忆",
    exists: false,
    modifiedAt: null,
    lastAppliedDiaryDate: null,
  };
}

function createDefaultTwelveQuestionsSummary(): FlashDiaryDocumentSummary {
  return {
    kind: "document",
    title: TWELVE_QUESTIONS_TITLE,
    path: TWELVE_QUESTIONS_PATH,
    description: "你的固定追问清单",
    exists: false,
    modifiedAt: null,
  };
}

function renderDocumentItem(item: FlashDiaryDocumentSummary, active: boolean): string {
  const meta = item.modifiedAt ? `更新于 ${formatTime(item.modifiedAt)}` : "尚未找到文档";
  return `
    <button
      type="button"
      class="flash-diary-page__list-item flash-diary-page__list-item--document${active ? " is-active" : ""}"
      data-flash-diary-twelve-questions
    >
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.description)}</span>
      <span>${escapeHtml(meta)}</span>
    </button>
  `;
}

function renderMemoryItem(item: FlashDiaryMemorySummary, active: boolean): string {
  const meta = item.modifiedAt ? `更新于 ${formatTime(item.modifiedAt)}` : item.exists ? "尚未记录更新时间" : "首次打开时会创建";
  return `
    <button type="button" class="flash-diary-page__list-item flash-diary-page__list-item--memory${active ? " is-active" : ""}" data-flash-diary-memory>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.description)}</span>
      <span>${escapeHtml(meta)}</span>
    </button>
  `;
}

function renderDiaryListItem(item: FlashDiaryFileSummary, active: boolean): string {
  const thumbnail = item.thumbnailUrl
    ? `<span class="flash-diary-page__timeline-thumb"><img src="${escapeHtml(item.thumbnailUrl)}" alt=""></span>`
    : `<span class="flash-diary-page__timeline-dot">${escapeHtml(item.date.slice(-2))}</span>`;
  return `
    <button type="button" class="flash-diary-page__timeline-item${active ? " is-active" : ""}" data-flash-diary-path="${escapeHtml(item.path)}">
      <span class="flash-diary-page__timeline-marker">${thumbnail}</span>
      <span class="flash-diary-page__timeline-copy">
        <strong>${escapeHtml(item.date)}</strong>
        <span>${item.entryCount} 条记录</span>
        <span>${escapeHtml(formatTime(item.modifiedAt))}</span>
      </span>
    </button>
  `;
}

function formatDocumentMeta(item: FlashDiaryDocumentSummary): string {
  return item.modifiedAt ? `${formatTime(item.modifiedAt)} · Markdown 文档` : "文档不存在";
}

export function formatMemoryMeta(item: FlashDiaryMemorySummary): string {
  const modifiedAt = item.modifiedAt ? formatTime(item.modifiedAt) : "尚未生成";
  const lastApplied = item.lastAppliedDiaryDate ?? "尚未写入日记";
  return `${modifiedAt} · 已处理到 ${lastApplied}`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
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
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
