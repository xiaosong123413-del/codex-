/**
 * Comment sidebar state and resize helpers for workflow detail pages.
 *
 * The workflow detail route keeps the Mermaid canvas and comment panel mounted
 * side by side. This module owns the panel's open state, width clamping, and
 * drag-to-resize behavior so route rendering stays small and predictable.
 */

import { attachResizeHandle } from "../../shell/resize-handle.js";

const DEFAULT_COMMENT_PANEL_WIDTH = 320;
const MIN_COMMENT_PANEL_WIDTH = 160;
const MAX_COMMENT_PANEL_WIDTH = 520;

interface ResizeAwareElement extends HTMLElement {
  __automationCommentSidebarCleanup?: () => void;
}

export interface AutomationCommentSidebarState {
  commentPanelOpen: boolean;
  commentPanelWidth: number;
}

interface AutomationCommentSidebarElements {
  body: HTMLElement;
  commentPanel: HTMLElement;
  resizeHandle: HTMLElement;
}

export function createAutomationCommentSidebarState(): AutomationCommentSidebarState {
  return {
    commentPanelOpen: false,
    commentPanelWidth: DEFAULT_COMMENT_PANEL_WIDTH,
  };
}

export function openAutomationCommentSidebar(state: AutomationCommentSidebarState): void {
  state.commentPanelOpen = true;
}

export function closeAutomationCommentSidebar(state: AutomationCommentSidebarState): void {
  state.commentPanelOpen = false;
}

export function syncAutomationCommentSidebar(
  elements: AutomationCommentSidebarElements,
  state: AutomationCommentSidebarState,
): void {
  state.commentPanelWidth = clampAutomationCommentSidebarWidth(state.commentPanelWidth);
  const specPanelOpen = elements.body.dataset.automationSpecPanel === "true";
  const panelOpen = state.commentPanelOpen || specPanelOpen;
  elements.body.dataset.automationCommentPanelOpen = panelOpen ? "true" : "false";
  elements.body.style.setProperty("--automation-comment-panel-width", `${state.commentPanelWidth}px`);
  elements.commentPanel.hidden = !panelOpen;
  elements.resizeHandle.hidden = !state.commentPanelOpen;
}

export function bindAutomationCommentSidebarResize(
  elements: AutomationCommentSidebarElements,
  state: AutomationCommentSidebarState,
): void {
  const body = elements.body as ResizeAwareElement;
  if (body.__automationCommentSidebarCleanup) {
    return;
  }

  let dragStartX = 0;
  let dragStartWidth = state.commentPanelWidth;
  const rememberDragStart = (event: MouseEvent): void => {
    dragStartX = event.clientX;
    dragStartWidth = state.commentPanelWidth;
  };

  elements.resizeHandle.addEventListener("mousedown", rememberDragStart);
  body.__automationCommentSidebarCleanup = attachResizeHandle({
    handle: elements.resizeHandle,
    onMove(event) {
      state.commentPanelWidth = clampAutomationCommentSidebarWidth(
        dragStartWidth + (dragStartX - event.clientX),
      );
      syncAutomationCommentSidebar(elements, state);
    },
  });
}

function clampAutomationCommentSidebarWidth(width: number): number {
  return Math.min(MAX_COMMENT_PANEL_WIDTH, Math.max(MIN_COMMENT_PANEL_WIDTH, width));
}
