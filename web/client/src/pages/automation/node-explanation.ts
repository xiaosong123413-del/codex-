/**
 * Node explanation panel for source-insight workflow specs.
 *
 * Mermaid stays responsible for the route skeleton. This component renders
 * the selected node's standard, inputs, outputs, and short prompt summary in
 * a readable table outside the diagram.
 */

import type {
  AutomationDetailResponse,
  AutomationSourceInsightNodeInsightResponse,
  AutomationSourceInsightNodeKind,
} from "./api.js";

type SourceInsight = NonNullable<AutomationDetailResponse["automation"]["sourceInsight"]>;
type SourceInsightNode = SourceInsight["graph"]["nodes"][number];

export function createNodeExplanationHtml(
  node: SourceInsightNode,
  insight: AutomationSourceInsightNodeInsightResponse,
): string {
  const rows = readNodeSpecRows(insight);
  return `
    <article class="automation-spec-node">
      <header class="automation-spec-node__header">
        <span class="automation-spec-node__kind">${escapeHtml(readNodeKindLabel(node.kind))}</span>
        <h3><span>${escapeHtml(node.displayId ?? node.id)}</span>${escapeHtml(readNodeTitle(node.label))}</h3>
      </header>
      <table class="automation-spec-node__table">
        <tbody>
          ${rows.map((row) => `
            <tr>
              <th>${escapeHtml(row.label)}</th>
              <td>${escapeHtml(row.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function readNodeSpecRows(
  insight: AutomationSourceInsightNodeInsightResponse,
): Array<{ label: string; value: string }> {
  if (insight.specRows && insight.specRows.length > 0) {
    return insight.specRows;
  }
  return [
    { label: "作用", value: insight.summary },
    { label: "输入", value: insight.upstream.join(" / ") || "无" },
    { label: "输出", value: insight.downstream.join(" / ") || "无" },
    { label: "落点", value: insight.shownIn.join(" / ") || "无" },
  ];
}

function readNodeTitle(label: string): string {
  return label.replace(/^[A-Z]\d+\s*/, "").replace(/^(触发|判断|输入|处理|结果)：/, "").trim();
}

function readNodeKindLabel(kind: AutomationSourceInsightNodeKind): string {
  switch (kind) {
    case "trigger":
      return "触发";
    case "decision":
      return "判断";
    case "input":
      return "输入";
    case "process":
      return "处理";
    case "result":
      return "结果";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}
