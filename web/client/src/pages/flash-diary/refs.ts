/**
 * Flash-diary DOM reference collection.
 *
 * Provides typed access to the page shell nodes without keeping query selector
 * details in the main controller.
 */
import type { FlashDiaryPageRefs } from "./view-helpers.js";

type FlashDiaryPageDomRefs = FlashDiaryPageRefs & {
  refreshButton: HTMLButtonElement;
  selectionToolbar: HTMLElement;
  selectionComment: HTMLButtonElement;
  selectionCopy: HTMLButtonElement;
  selectionCancel: HTMLButtonElement;
  memoryCommentsPanel: HTMLElement;
  memoryCommentsClose: HTMLButtonElement;
  commentList: HTMLElement;
  commentStatus: HTMLElement;
};

export function getFlashDiaryPageRefs(root: HTMLElement): FlashDiaryPageDomRefs {
  return {
    list: root.querySelector<HTMLElement>("[data-flash-diary-list]")!,
    title: root.querySelector<HTMLElement>("[data-flash-diary-current-title]")!,
    meta: root.querySelector<HTMLElement>("[data-flash-diary-current-meta]")!,
    visualEditorHost: root.querySelector<HTMLElement>("[data-flash-diary-visual-editor-host]")!,
    editor: root.querySelector<HTMLTextAreaElement>("[data-flash-diary-editor]")!,
    saveButton: root.querySelector<HTMLButtonElement>("[data-flash-diary-save]")!,
    refreshButton: root.querySelector<HTMLButtonElement>("[data-flash-diary-refresh]")!,
    memoryRefreshButton: root.querySelector<HTMLButtonElement>("[data-flash-diary-memory-refresh]")!,
    memoryCommentButton: root.querySelector<HTMLButtonElement>("[data-flash-diary-memory-comment]")!,
    memoryLayout: root.querySelector<HTMLElement>("[data-flash-diary-memory-layout]")!,
    memoryBody: root.querySelector<HTMLElement>("[data-flash-diary-memory-body]")!,
    selectionToolbar: root.querySelector<HTMLElement>("[data-flash-diary-selection-toolbar]")!,
    selectionComment: root.querySelector<HTMLButtonElement>("[data-flash-diary-selection-comment]")!,
    selectionCopy: root.querySelector<HTMLButtonElement>("[data-flash-diary-selection-copy]")!,
    selectionCancel: root.querySelector<HTMLButtonElement>("[data-flash-diary-selection-cancel]")!,
    memoryCommentsPanel: root.querySelector<HTMLElement>("[data-flash-diary-memory-comments]")!,
    memoryCommentsClose: root.querySelector<HTMLButtonElement>("[data-flash-diary-memory-comments-close]")!,
    commentList: root.querySelector<HTMLElement>("[data-wiki-comments-list]")!,
    commentStatus: root.querySelector<HTMLElement>("[data-wiki-comments-status]")!,
  };
}
