/**
 * Flash-diary workspace page.
 *
 * Binds the left rail, editable markdown panel, and rendered Memory view for
 * the flash-diary workflow.
 */
import {
  applyPanelWidth,
  clampPanelWidth,
  readPanelWidth,
  writePanelWidth,
  type PanelWidthBounds,
} from "../../shell/panel-layout.js";
import { attachResizeHandle } from "../../shell/resize-handle.js";
import { bindPageSearchShortcut } from "../../search-shortcut.js";
import { createWikiCommentSurface, type WikiCommentSurfaceController } from "../../components/wiki-comments.js";
import {
  createWikiSelectionToolbar,
  type WikiSelectionToolbarController,
} from "../../components/wiki-selection-toolbar.js";
import {
  applyDiaryView,
  applyDocumentView,
  applyMemoryView,
  bindListActions,
  createDefaultMemorySummary,
  createPageState,
  formatMemoryMeta,
  MEMORY_PATH,
  MEMORY_TITLE,
  renderList,
  resetView,
  syncActiveItem,
  TWELVE_QUESTIONS_PATH,
  type ApiResponse,
  type FlashDiaryListPayload,
  type FlashDiaryMemoryPageResponse,
  type FlashDiaryPageResponse,
} from "./view-helpers.js";
import { renderFlashDiaryPageShell } from "./page-shell.js";
import { getFlashDiaryPageRefs as getRefs } from "./refs.js";
import { createFlashDiaryVisualEditor } from "./visual-editor.js";

type DisposableNode = HTMLElement & {
  __dispose?: () => void;
};

const FLASH_DIARY_LIST_BOUNDS: PanelWidthBounds = {
  defaultWidth: 304,
  minWidth: 252,
  maxWidth: 420,
};

export function renderFlashDiaryPage(): HTMLElement {
  const root = document.createElement("section") as DisposableNode;
  root.className = "flash-diary-page";
  root.innerHTML = renderFlashDiaryPageShell();
  bindFlashDiaryPage(root);
  return root;
}

function bindFlashDiaryPage(root: DisposableNode): void {
  const refs = getRefs(root);
  const comments = createMemoryCommentSurface(refs);
  const selectionToolbar = createMemorySelectionToolbar(refs, comments);
  const diaryEditor = createFlashDiaryVisualEditor(refs.visualEditorHost);
  const state = createPageState();
  const workspace = root.querySelector<HTMLElement>(".flash-diary-page__workspace")!;
  const resizeHandle = root.querySelector<HTMLElement>("[data-panel-handle='flashDiary.listWidth']")!;
  let listWidth = readPanelWidth("flashDiary.listWidth", FLASH_DIARY_LIST_BOUNDS);
  applyPanelWidth(workspace, "--flash-diary-list-width", listWidth);
  const disposeSearchShortcut = bindPageSearchShortcut(root, () => getCurrentDiaryTextSearchScope(refs));

  refs.refreshButton.addEventListener("click", () => {
    void loadList();
  });
  refs.saveButton.addEventListener("click", () => {
    void saveCurrentEditablePage();
  });
  refs.memoryRefreshButton.addEventListener("click", () => {
    void openMemory();
  });
  refs.memoryCommentButton.addEventListener("click", () => {
    if (window.getSelection()?.toString().trim()) {
      selectionToolbar.reset();
      void comments.createFromSelection(null);
      return;
    }
    comments.toggle();
  });
  refs.editor.addEventListener("input", () => {
    refs.saveButton.disabled = (state.view !== "diary" && state.view !== "document") || refs.editor.value === state.savedRaw;
  });
  diaryEditor.setOnChange(() => {
    if (state.view !== "diary") {
      return;
    }
    refs.saveButton.disabled = normalizeMarkdown(diaryEditor.getMarkdown()) === normalizeMarkdown(state.savedRaw);
  });

  const disposeResize = attachResizeHandle({
    handle: resizeHandle,
    onMove(event) {
      const rect = workspace.getBoundingClientRect();
      listWidth = clampPanelWidth(event.clientX - rect.left, FLASH_DIARY_LIST_BOUNDS);
      applyPanelWidth(workspace, "--flash-diary-list-width", listWidth);
    },
    onEnd() {
      listWidth = writePanelWidth("flashDiary.listWidth", listWidth, FLASH_DIARY_LIST_BOUNDS);
      applyPanelWidth(workspace, "--flash-diary-list-width", listWidth);
    },
  });

  const refreshFromDesktop = () => {
    void loadList();
  };
  window.addEventListener("llmwiki:flash-diary-refresh", refreshFromDesktop);
  root.__dispose = () => {
    window.removeEventListener("llmwiki:flash-diary-refresh", refreshFromDesktop);
    disposeSearchShortcut();
    disposeResize();
    selectionToolbar.dispose();
    diaryEditor.dispose();
  };

  void loadList();

  async function loadList(): Promise<void> {
    refs.list.innerHTML = `<div class="flash-diary-page__empty">正在读取闪念日记...</div>`;
    try {
      const response = await fetch("/api/flash-diary");
      const payload = (await response.json()) as ApiResponse<FlashDiaryListPayload>;
      state.items = payload.data?.items ?? [];
      state.memory = payload.data?.memory ?? createDefaultMemorySummary();
      state.twelveQuestions = payload.data?.twelveQuestions ?? state.twelveQuestions;
      renderList(refs.list, state);
      bindListActions(refs.list, { openDiary, openMemory, openTwelveQuestions });
      await restoreActiveView();
    } catch {
      refs.list.innerHTML = `<div class="flash-diary-page__empty">闪念日记列表读取失败。</div>`;
      resetView(selectionToolbar, comments, refs, state);
    }
  }

  async function restoreActiveView(): Promise<void> {
    if (state.view === "memory" || state.currentPath === MEMORY_PATH) {
      await openMemory();
      return;
    }
    if (state.view === "document" || state.currentPath === TWELVE_QUESTIONS_PATH) {
      await openTwelveQuestions();
      return;
    }
    if (state.items.length === 0) {
      resetView(selectionToolbar, comments, refs, state);
      renderList(refs.list, state, true);
      bindListActions(refs.list, { openDiary, openMemory, openTwelveQuestions });
      return;
    }
    const nextPath = state.items.some((item) => item.path === state.currentPath)
      ? state.currentPath
      : state.items[0]!.path;
    await openDiary(nextPath);
  }

  async function openDiary(relativePath: string): Promise<void> {
    if (!relativePath) {
      return;
    }
    try {
      const response = await fetch(`/api/flash-diary/page?path=${encodeURIComponent(relativePath)}`);
      const payload = (await response.json()) as ApiResponse<FlashDiaryPageResponse>;
      if (!response.ok || !payload.success || !payload.data) {
        return;
      }
      state.view = "diary";
      state.currentPath = payload.data.path;
      state.savedRaw = normalizeMarkdown(payload.data.raw);
      selectionToolbar.reset();
      applyDiaryView(refs, payload.data, state);
      diaryEditor.load(payload.data);
      comments.clear("当前打开的是日记原文。");
      syncActiveItem(refs.list, state.currentPath);
    } catch {
      diaryEditor.clear();
      resetView(selectionToolbar, comments, refs, state);
    }
  }

  async function openTwelveQuestions(): Promise<void> {
    try {
      const response = await fetch(`/api/flash-diary/page?path=${encodeURIComponent(TWELVE_QUESTIONS_PATH)}`);
      const payload = (await response.json()) as ApiResponse<FlashDiaryPageResponse>;
      if (!response.ok || !payload.success || !payload.data) {
        selectionToolbar.reset();
        state.view = "document";
        state.currentPath = TWELVE_QUESTIONS_PATH;
        state.savedRaw = "";
        refs.title.textContent = "十二个问题";
        refs.meta.textContent = "文档不存在";
        refs.visualEditorHost.hidden = true;
        refs.editor.value = "";
        refs.editor.placeholder = "十二个问题文档不存在";
        refs.editor.readOnly = true;
        refs.editor.hidden = false;
        refs.memoryLayout.hidden = true;
        refs.saveButton.hidden = true;
        refs.saveButton.disabled = true;
        refs.memoryRefreshButton.hidden = true;
        refs.memoryCommentButton.hidden = true;
        diaryEditor.clear();
        comments.clear("十二个问题文档不存在。");
        syncActiveItem(refs.list, TWELVE_QUESTIONS_PATH);
        return;
      }
      state.currentPath = payload.data.path;
      state.savedRaw = payload.data.raw;
      selectionToolbar.reset();
      applyDocumentView(refs, payload.data, state, state.twelveQuestions);
      diaryEditor.clear();
      comments.clear("当前打开的是可编辑 Markdown 文档。");
      syncActiveItem(refs.list, state.currentPath);
    } catch {
      diaryEditor.clear();
      resetView(selectionToolbar, comments, refs, state);
    }
  }

  async function openMemory(): Promise<void> {
    try {
      const response = await fetch("/api/flash-diary/memory");
      const payload = (await response.json()) as ApiResponse<FlashDiaryMemoryPageResponse>;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "Memory 加载失败。");
      }
      state.view = "memory";
      state.currentPath = payload.data.path;
      state.savedRaw = payload.data.raw;
      state.memory = {
        ...state.memory,
        exists: true,
        modifiedAt: payload.data.modifiedAt,
        lastAppliedDiaryDate: payload.data.lastAppliedDiaryDate,
      };
      selectionToolbar.reset();
      applyMemoryView(refs, payload.data);
      diaryEditor.clear();
      syncActiveItem(refs.list, MEMORY_PATH);
      void comments.setDocument(payload.data.path, payload.data.html, {
        sourceEditable: payload.data.sourceEditable,
        refreshPage(page) {
          selectionToolbar.reset();
          state.savedRaw = page.raw;
          state.memory = {
            ...state.memory,
            exists: true,
            modifiedAt: page.modifiedAt ?? state.memory.modifiedAt,
          };
          refs.title.textContent = page.title ?? MEMORY_TITLE;
          refs.meta.textContent = formatMemoryMeta(state.memory);
          renderList(refs.list, state);
          bindListActions(refs.list, { openDiary, openMemory, openTwelveQuestions });
          syncActiveItem(refs.list, MEMORY_PATH);
        },
      });
      renderList(refs.list, state);
      bindListActions(refs.list, { openDiary, openMemory, openTwelveQuestions });
    } catch {
      selectionToolbar.reset();
      refs.title.textContent = MEMORY_TITLE;
      refs.meta.textContent = "Memory 加载失败。";
      refs.memoryBody.innerHTML = `<div class="flash-diary-page__empty">Memory 加载失败。</div>`;
      refs.visualEditorHost.hidden = true;
      refs.editor.hidden = true;
      refs.memoryLayout.hidden = false;
      refs.saveButton.hidden = true;
      refs.memoryRefreshButton.hidden = false;
      refs.memoryCommentButton.hidden = false;
      diaryEditor.clear();
      comments.clear("当前 Memory 还没有评论。");
    }
  }

  async function saveCurrentEditablePage(): Promise<void> {
    if ((state.view !== "diary" && state.view !== "document") || !state.currentPath) {
      return;
    }
    try {
      const raw = state.view === "diary" ? diaryEditor.getMarkdown() : refs.editor.value;
      const response = await fetch("/api/flash-diary/page", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: state.currentPath,
          raw,
        }),
      });
      const payload = (await response.json()) as ApiResponse<unknown>;
      if (!response.ok || !payload.success) {
        return;
      }
      await reloadCurrentEditablePage(state.currentPath);
      await loadList();
    } catch {
      // Keep current editor content untouched so the user can retry save.
    }
  }

  async function reloadCurrentEditablePage(currentPath: string): Promise<void> {
    if (currentPath === TWELVE_QUESTIONS_PATH) {
      await openTwelveQuestions();
      return;
    }
    await openDiary(currentPath);
  }
}

function createMemoryCommentSurface(refs: ReturnType<typeof getRefs>): WikiCommentSurfaceController {
  return createWikiCommentSurface({
    content: refs.memoryBody,
    list: refs.commentList,
    status: refs.commentStatus,
    panel: refs.memoryCommentsPanel,
    closeButton: refs.memoryCommentsClose,
    emptyLabel: "当前 Memory 还没有评论。",
  });
}

function createMemorySelectionToolbar(
  refs: ReturnType<typeof getRefs>,
  comments: WikiCommentSurfaceController,
): WikiSelectionToolbarController {
  return createWikiSelectionToolbar({
    article: refs.memoryBody,
    toolbar: refs.selectionToolbar,
    commentButton: refs.selectionComment,
    copyButton: refs.selectionCopy,
    cancelButton: refs.selectionCancel,
    comments,
  });
}

function getCurrentDiaryTextSearchScope(refs: ReturnType<typeof getRefs>): HTMLElement | null {
  if (!refs.visualEditorHost.hidden) {
    return refs.visualEditorHost;
  }
  if (!refs.editor.hidden) {
    return refs.editor;
  }
  if (!refs.memoryLayout.hidden) {
    return refs.memoryBody;
  }
  return null;
}

function normalizeMarkdown(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trimEnd();
  return normalized ? `${normalized}\n` : "";
}
