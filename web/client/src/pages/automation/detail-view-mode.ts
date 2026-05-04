/**
 * Detail-view mode helpers for code-derived automation pages.
 *
 * Code-backed flows can expose more than one visual theme. These helpers keep
 * the current mode normalization and header toggle markup out of the route
 * controller so the main page file stays under the project size budget.
 */

import type { AutomationDetailResponse } from "./api.js";

export type AutomationDetailViewMode = "mermaid" | "page-hotspot";

export function createAutomationDetailViewToggleHtml(
  automation: AutomationDetailResponse["automation"],
  selectedView: AutomationDetailViewMode | null,
): string {
  if (!automation.sourceInsight?.pageHotspotView) {
    return "";
  }
  return `
    <div class="automation-detail__view-toggle" role="group" aria-label="流程视图切换">
      ${createAutomationDetailViewButton("page-hotspot", "页面热点流程", selectedView)}
      ${createAutomationDetailViewButton("mermaid", "统一链路图", selectedView)}
    </div>
  `;
}

export function resolveAutomationDetailViewMode(
  detail: AutomationDetailResponse,
  currentMode: AutomationDetailViewMode | null,
): AutomationDetailViewMode {
  if (detail.automation.sourceInsight?.pageHotspotView) {
    return currentMode ?? "page-hotspot";
  }
  return "mermaid";
}

function createAutomationDetailViewButton(
  mode: AutomationDetailViewMode,
  label: string,
  selectedView: AutomationDetailViewMode | null,
): string {
  const activeMode = selectedView ?? "mermaid";
  const buttonClass = activeMode === mode ? "btn btn-primary" : "btn btn-secondary";
  return `<button type="button" class="${buttonClass}" data-automation-detail-view="${mode}">${label}</button>`;
}
