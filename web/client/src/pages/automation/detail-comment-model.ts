/**
 * Comment-panel state helpers for automation detail pages.
 *
 * These helpers normalize selected comments, draft labels, and target captions
 * so the main detail controller can stay focused on rendering decisions.
 */

import type {
  AutomationCommentDraftTarget,
  AutomationCommentResponse,
  AutomationDetailResponse,
} from "./api.js";
import { resolveMermaidTargetLabel } from "./mermaid-targets.js";
import type { AutomationCommentPanelState } from "./panels.js";

type CommentAnchor = {
  targetType: "node" | "edge" | "canvas";
  targetId: string;
  label?: string;
  x: number;
  y: number;
};

export function pickSelectedAutomationCommentId(
  comments: AutomationDetailResponse["comments"],
  selectedCommentId: string | null,
): string | null {
  if (!selectedCommentId) {
    return null;
  }
  return comments.some((comment) => comment.id === selectedCommentId) ? selectedCommentId : null;
}

export function createAutomationCommentPanelState(
  state: {
    detail: AutomationDetailResponse;
    commentMode: boolean;
    draftTarget: AutomationCommentDraftTarget | null;
    selectedCommentId: string | null;
  },
  anchors: ReadonlyArray<CommentAnchor>,
  orphanedCommentIds: ReadonlySet<string>,
): AutomationCommentPanelState {
  return {
    comments: state.detail.comments,
    commentMode: state.commentMode,
    selectedCommentId: state.selectedCommentId,
    draft: state.draftTarget,
    draftLabel: readDraftLabel(state.draftTarget, anchors),
    targetLabels: buildCommentTargetLabels(state.detail.comments, anchors),
    orphanedCommentIds,
  };
}

function readDraftLabel(
  draftTarget: AutomationCommentDraftTarget | null,
  anchors: ReadonlyArray<CommentAnchor>,
): string | null {
  return draftTarget ? resolveMermaidTargetLabel(draftTarget, [...anchors]) : null;
}

function buildCommentTargetLabels(
  comments: ReadonlyArray<AutomationCommentResponse>,
  anchors: ReadonlyArray<CommentAnchor>,
): Record<string, string> {
  return Object.fromEntries(comments.flatMap((comment) => {
    const label = resolveMermaidTargetLabel(comment, [...anchors]);
    return label ? [[comment.id, label]] : [];
  }));
}
