/**
 * Workflow detail comment integration for Mermaid-based automation pages.
 *
 * This module owns the wiring between rendered Mermaid surfaces, persisted
 * comments, and the existing side-panel controls so the page entry module can
 * stay focused on route-level state and layout concerns.
 */

import {
  createAutomationCommentPanelState,
} from "./detail-comment-model.js";
import {
  patchAutomationComment,
  type AutomationCommentDraftTarget,
  type AutomationCommentResponse,
  type AutomationDetailResponse,
} from "./api.js";
import {
  closeAutomationCommentSidebar,
  openAutomationCommentSidebar,
  type AutomationCommentSidebarState,
} from "./comment-sidebar.js";
import {
  bindAutomationCommentTargets,
  createAutomationDraftComment,
  removeAutomationComment,
  renderAutomationCommentPanel,
  renderAutomationCommentPins,
  type AutomationCommentPanelState,
} from "./panels.js";
import {
  bindAutomationMermaidViewport,
  type MermaidViewportState,
} from "./mermaid-viewport.js";
import {
  bindAutomationCommentPinDragging,
  renderAutomationMermaidView,
  type RenderedMermaidSurface,
} from "./mermaid-view.js";
import {
  bindAutomationPageHotspotTargets,
  renderAutomationPageHotspotView,
  syncAutomationPageHotspotSelection,
  type RenderedPageHotspotSurface,
} from "./page-hotspot-view.js";
import {
  bindAutomationSourceInsightTargets,
  syncAutomationSourceInsightSelection,
} from "./source-insight-mermaid.js";
import {
  pickSelectedAutomationSourceInsightNodeId,
  renderAutomationSourceInsightSidebar,
} from "./source-insight-sidebar.js";

export interface AutomationDetailCommentState extends AutomationCommentSidebarState {
  detail: AutomationDetailResponse | null;
  commentMode: boolean;
  draftTarget: AutomationCommentDraftTarget | null;
  selectedCommentId: string | null;
  selectedInsightNodeId: string | null;
  detailViewMode: "mermaid" | "page-hotspot" | null;
  viewport: MermaidViewportState;
}

interface AutomationDetailCommentElements {
  canvasWrap: HTMLElement;
  commentPanel: HTMLElement;
}

// fallow-ignore-next-line complexity
export async function renderAutomationDetailComments(
  elements: AutomationDetailCommentElements,
  automationId: string,
  state: AutomationDetailCommentState,
  rerender: () => void,
): Promise<void> {
  if (!state.detail) {
    return;
  }
  if (state.detailViewMode === "page-hotspot") {
    renderAutomationPageHotspotComments(elements, automationId, state, rerender);
    return;
  }
  const automation = state.detail.automation;
  state.selectedInsightNodeId = pickSelectedInsightNodeId(state);
  const surface = await renderAutomationMermaidView(elements.canvasWrap, automation);
  if (!surface || state.detail?.automation.id !== automation.id) {
    return;
  }
  bindAutomationMermaidViewport(elements.canvasWrap, surface, state.viewport);
  bindAutomationCommentModeToggle(surface, state, rerender);
  bindAutomationSourceInsightSelection(surface, state, rerender);
  const orphanedCommentIds = renderAutomationCommentPins(surface, state.detail.comments, state.selectedCommentId, (commentId) => {
    state.selectedCommentId = commentId;
    state.draftTarget = null;
    openAutomationCommentSidebar(state);
    rerender();
  });
  bindAutomationCommentPinDragging(elements.canvasWrap, surface, {
    onMoveComment: async (commentId, position) => {
      const nextDetail = await moveAutomationComment(state.detail, automationId, commentId, position.x, position.y);
      state.detail = nextDetail;
      rerender();
    },
  });
  bindAutomationCommentTargets(surface, state.commentMode, (draftTarget) => {
    state.draftTarget = draftTarget;
    state.selectedCommentId = null;
    state.selectedInsightNodeId = draftTarget.targetType === "node" ? draftTarget.targetId : state.selectedInsightNodeId;
    openAutomationCommentSidebar(state);
    rerender();
  });
  renderAutomationSidebar(elements.commentPanel, state, automationId, surface.anchors, orphanedCommentIds, rerender);
}

function renderAutomationPageHotspotComments(
  elements: AutomationDetailCommentElements,
  automationId: string,
  state: AutomationDetailCommentState,
  rerender: () => void,
): void {
  if (!state.detail) {
    return;
  }
  state.commentMode = false;
  state.selectedInsightNodeId = pickSelectedInsightNodeId(state);
  const surface = renderAutomationPageHotspotView(elements.canvasWrap, state.detail.automation);
  if (!surface) {
    return;
  }
  bindAutomationMermaidViewport(elements.canvasWrap, surface, state.viewport, {
    focusArea: surface.focusArea,
  });
  bindAutomationPageHotspotSelection(surface, state, rerender);
  renderAutomationSidebar(elements.commentPanel, state, automationId, [], new Set(), rerender);
}

function bindAutomationCommentModeToggle(
  surface: { commentToggleButton: HTMLButtonElement | null },
  state: AutomationDetailCommentState,
  rerender: () => void,
): void {
  surface.commentToggleButton?.addEventListener("click", () => {
    state.commentMode = !state.commentMode;
    if (state.commentMode) {
      openAutomationCommentSidebar(state);
    }
    if (!state.commentMode) {
      state.draftTarget = null;
    }
    rerender();
  });
}

function bindAutomationSourceInsightSelection(
  surface: RenderedMermaidSurface,
  state: AutomationDetailCommentState,
  rerender: () => void,
): void {
  if (!state.detail?.automation.sourceInsight) {
    return;
  }
  syncAutomationSourceInsightSelection(surface, state.selectedInsightNodeId);
  if (state.commentMode) {
    return;
  }
  bindAutomationSourceInsightTargets(surface, state.selectedInsightNodeId, (nodeId) => {
    state.selectedInsightNodeId = nodeId;
    state.draftTarget = null;
    openAutomationCommentSidebar(state);
    rerender();
  });
}

function bindAutomationPageHotspotSelection(
  surface: RenderedPageHotspotSurface,
  state: AutomationDetailCommentState,
  rerender: () => void,
): void {
  if (!state.detail?.automation.sourceInsight) {
    return;
  }
  syncAutomationPageHotspotSelection(surface, state.selectedInsightNodeId);
  bindAutomationPageHotspotTargets(surface, state.selectedInsightNodeId, (nodeId) => {
    state.selectedInsightNodeId = nodeId;
    state.draftTarget = null;
    openAutomationCommentSidebar(state);
    rerender();
  });
}

function renderAutomationSidebar(
  panel: HTMLElement,
  state: AutomationDetailCommentState,
  automationId: string,
  anchors: ReadonlyArray<{
    targetType: "node" | "edge" | "canvas";
    targetId: string;
    label?: string;
    x: number;
    y: number;
  }>,
  orphanedCommentIds: ReadonlySet<string>,
  rerender: () => void,
): void {
  const commentPanelState = createAutomationCommentPanelState(state, anchors, orphanedCommentIds);
  const handlers = createAutomationSidebarHandlers(state, automationId, rerender);
  if (!state.detail?.automation.sourceInsight) {
    renderAutomationCommentPanel(panel, commentPanelState, handlers);
    return;
  }
  if (!state.selectedInsightNodeId) {
    panel.replaceChildren();
    return;
  }
  renderAutomationSourceInsightSidebar(panel, {
    detail: state.detail,
    selectedNodeId: state.selectedInsightNodeId,
    commentPanel: commentPanelState,
  }, handlers);
}

function createAutomationSidebarHandlers(
  state: AutomationDetailCommentState,
  automationId: string,
  rerender: () => void,
): {
  onSaveDraft: (text: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onSelectComment: (commentId: string) => void;
  onClosePanel: () => void;
} {
  return {
    onSaveDraft: (text) => saveAutomationCommentDraft(state, automationId, text, rerender),
    onDeleteComment: (commentId) => deleteAutomationCommentSelection(state, automationId, commentId, rerender),
    onSelectComment: (commentId) => {
      state.selectedCommentId = commentId;
      state.draftTarget = null;
      openAutomationCommentSidebar(state);
      rerender();
    },
    onClosePanel: () => {
      state.commentMode = false;
      state.draftTarget = null;
      if (state.detail?.automation.sourceInsight) {
        state.selectedInsightNodeId = null;
      }
      closeAutomationCommentSidebar(state);
      rerender();
    },
  };
}

async function saveAutomationCommentDraft(
  state: AutomationDetailCommentState,
  automationId: string,
  text: string,
  rerender: () => void,
): Promise<void> {
  if (!state.detail || !state.draftTarget) {
    return;
  }
  const created = await createAutomationDraftComment(automationId, state.draftTarget, text);
  if (!created) {
    return;
  }
  state.detail = { ...state.detail, comments: [...state.detail.comments, created] };
  state.selectedCommentId = created.id;
  state.draftTarget = null;
  openAutomationCommentSidebar(state);
  rerender();
}

async function deleteAutomationCommentSelection(
  state: AutomationDetailCommentState,
  automationId: string,
  commentId: string,
  rerender: () => void,
): Promise<void> {
  if (!state.detail) {
    return;
  }
  await removeAutomationComment(automationId, commentId);
  state.detail = {
    ...state.detail,
    comments: state.detail.comments.filter((comment) => comment.id !== commentId),
  };
  state.selectedCommentId = state.selectedCommentId === commentId ? null : state.selectedCommentId;
  rerender();
}

function pickSelectedInsightNodeId(state: AutomationDetailCommentState): string | null {
  if (!state.detail?.automation.sourceInsight) {
    return null;
  }
  return pickSelectedAutomationSourceInsightNodeId(state.detail, state.selectedInsightNodeId);
}

async function moveAutomationComment(
  detail: AutomationDetailResponse,
  automationId: string,
  commentId: string,
  x: number,
  y: number,
): Promise<AutomationDetailResponse> {
  const updatedComment = await patchAutomationComment(automationId, commentId, {
    manualX: x,
    manualY: y,
    pinnedX: x,
    pinnedY: y,
  });
  return {
    ...detail,
    comments: detail.comments.map((comment) => replaceUpdatedComment(comment, updatedComment)),
  };
}

function replaceUpdatedComment(
  comment: AutomationCommentResponse,
  updatedComment: AutomationCommentResponse,
): AutomationCommentResponse {
  return comment.id === updatedComment.id ? updatedComment : comment;
}
