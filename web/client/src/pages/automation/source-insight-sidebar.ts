/**
 * Source-insight sidebar for workflow spec pages.
 *
 * The right panel owns the selected node explanation and appendix tabs. The
 * Mermaid canvas stays a compact backbone and no longer carries standard
 * chips, prompt text, or long rule copy.
 */

import type {
  AutomationDetailResponse,
  AutomationSourceInsightNodeInsightResponse,
} from "./api.js";
import type { AutomationCommentPanelState } from "./panels.js";
import { createAppendixTabsHtml, bindAppendixTabs } from "./appendix-tabs.js";
import { createNodeExplanationHtml } from "./node-explanation.js";

type AutomationSourceInsight = NonNullable<AutomationDetailResponse["automation"]["sourceInsight"]>;
type AutomationSourceInsightNode = AutomationSourceInsight["graph"]["nodes"][number];

interface AutomationSourceInsightSidebarModel {
  detail: AutomationDetailResponse;
  selectedNodeId: string | null;
  commentPanel: AutomationCommentPanelState;
}

interface AutomationSourceInsightSidebarHandlers {
  onClosePanel: () => void;
  onSaveDraft: (text: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onSelectComment: (commentId: string) => void;
}

export function pickSelectedAutomationSourceInsightNodeId(
  detail: AutomationDetailResponse,
  selectedNodeId: string | null,
): string | null {
  const nodes = detail.automation.sourceInsight?.graph.nodes ?? [];
  if (!selectedNodeId || nodes.length === 0) {
    return null;
  }
  return nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null;
}

export function renderAutomationSourceInsightSidebar(
  panel: HTMLElement,
  model: AutomationSourceInsightSidebarModel,
  handlers: AutomationSourceInsightSidebarHandlers,
): void {
  panel.innerHTML = createAutomationSourceInsightSidebarHtml(model);
  bindAutomationSourceInsightSidebar(panel, handlers);
  bindAppendixTabs(panel);
}

function createAutomationSourceInsightSidebarHtml(
  model: AutomationSourceInsightSidebarModel,
): string {
  return `
    <section class="automation-spec-panel">
      <header class="automation-spec-panel__head">
        <strong>节点说明</strong>
        <span>${escapeHtml(readInsightMeta(model.detail))}</span>
      </header>
      ${createAutomationSourceInsightBodyHtml(model)}
    </section>
    ${model.detail.automation.sourceInsight ? createAppendixTabsHtml(model.detail.automation.sourceInsight) : ""}
  `;
}

function readInsightMeta(detail: AutomationDetailResponse): string {
  const sourceInsight = detail.automation.sourceInsight;
  if (!sourceInsight) {
    return detail.automation.name;
  }
  return `${sourceInsight.page.title} · ${sourceInsight.page.routeLabel}`;
}

function createAutomationSourceInsightBodyHtml(
  model: AutomationSourceInsightSidebarModel,
): string {
  const selected = readSelectedInsight(model);
  if (!selected) {
    return `<div class="automation-detail__comment-hint">点击主流程图中的节点后，这里会显示节点说明。</div>`;
  }
  return createNodeExplanationHtml(selected.node, selected.insight);
}

function readSelectedInsight(
  model: AutomationSourceInsightSidebarModel,
): {
  node: AutomationSourceInsightNode;
  insight: AutomationSourceInsightNodeInsightResponse;
} | null {
  const sourceInsight = model.detail.automation.sourceInsight;
  if (!sourceInsight || !model.selectedNodeId) {
    return null;
  }
  const node = sourceInsight.graph.nodes.find((item) => item.id === model.selectedNodeId);
  const insight = sourceInsight.nodeInsights[model.selectedNodeId];
  return node && insight ? { node, insight } : null;
}

function bindAutomationSourceInsightSidebar(
  panel: HTMLElement,
  handlers: AutomationSourceInsightSidebarHandlers,
): void {
  panel.querySelector<HTMLButtonElement>("[data-automation-comment-close]")?.addEventListener("click", handlers.onClosePanel);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}
