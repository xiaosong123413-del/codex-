/**
 * Appendix tabs for workflow spec detail pages.
 *
 * Prompt, schema, and rule details sit below the node explanation so the
 * Mermaid diagram can remain a compact backbone instead of a dense document.
 */

import type { AutomationDetailResponse } from "./api.js";

type SourceInsight = NonNullable<AutomationDetailResponse["automation"]["sourceInsight"]>;
type Appendix = NonNullable<SourceInsight["appendices"]>[number];

export function createAppendixTabsHtml(sourceInsight: SourceInsight): string {
  const appendices = sourceInsight.appendices ?? [];
  if (appendices.length === 0) {
    return "";
  }
  return `
    <section class="automation-spec-appendix" data-automation-appendix-tabs>
      <div class="automation-spec-appendix__tabs">
        ${appendices.map((appendix, index) => `
          <button
            type="button"
            data-automation-appendix-tab="${escapeAttr(appendix.id)}"
            data-active="${index === 0 ? "true" : "false"}"
          >${escapeHtml(appendix.title)}</button>
        `).join("")}
      </div>
      <div class="automation-spec-appendix__panels">
        ${appendices.map((appendix, index) => `
          <pre data-automation-appendix-panel="${escapeAttr(appendix.id)}" ${index === 0 ? "" : "hidden"}>${escapeHtml(appendix.content)}</pre>
        `).join("")}
      </div>
    </section>
  `;
}

export function bindAppendixTabs(panel: HTMLElement): void {
  const host = panel.querySelector<HTMLElement>("[data-automation-appendix-tabs]");
  if (!host) {
    return;
  }
  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-automation-appendix-tab]")) {
    button.addEventListener("click", () => {
      selectAppendixTab(host, button.dataset.automationAppendixTab ?? "");
    });
  }
}

function selectAppendixTab(host: HTMLElement, selectedId: string): void {
  for (const button of host.querySelectorAll<HTMLButtonElement>("[data-automation-appendix-tab]")) {
    button.dataset.active = button.dataset.automationAppendixTab === selectedId ? "true" : "false";
  }
  for (const panel of host.querySelectorAll<HTMLElement>("[data-automation-appendix-panel]")) {
    panel.hidden = panel.dataset.automationAppendixPanel !== selectedId;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
