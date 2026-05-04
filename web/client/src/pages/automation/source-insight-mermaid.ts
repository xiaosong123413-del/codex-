/**
 * Node-selection bindings for code-derived source-insight graphs.
 *
 * The unified lineage graph keeps node explanation in the right sidebar.
 * These helpers bind click selection onto Mermaid nodes and mirror the
 * currently selected node back into SVG data attributes for styling.
 */

import { readStableMermaidNodeId } from "./mermaid-targets.js";
import type { RenderedMermaidSurface } from "./mermaid-view.js";

export function bindAutomationSourceInsightTargets(
  surface: RenderedMermaidSurface,
  selectedNodeId: string | null,
  onSelectNode: (nodeId: string) => void,
): void {
  const nodes = readMermaidNodeElements(surface);
  for (const node of nodes) {
    const nodeId = readStableMermaidNodeId(node);
    if (nodeId === "") {
      continue;
    }
    node.dataset.automationInsightSelected = nodeId === selectedNodeId ? "true" : "false";
    node.dataset.automationInsightNode = nodeId;
    node.style.cursor = "pointer";
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectNode(nodeId);
    });
  }
}

export function syncAutomationSourceInsightSelection(
  surface: RenderedMermaidSurface,
  selectedNodeId: string | null,
): void {
  for (const node of readMermaidNodeElements(surface)) {
    const nodeId = readStableMermaidNodeId(node);
    node.dataset.automationInsightSelected = nodeId !== "" && nodeId === selectedNodeId ? "true" : "false";
  }
}

function readMermaidNodeElements(surface: RenderedMermaidSurface): SVGGElement[] {
  return Array.from(surface.svg.querySelectorAll<SVGGElement>("g.node[id], g.node[data-id]"));
}
