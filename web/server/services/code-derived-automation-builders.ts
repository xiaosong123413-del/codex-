/**
 * Small helpers for source-owned automation flow modules.
 *
 * The helpers keep per-feature flow modules focused on the audited flow
 * content instead of repeating node, edge, and branch object boilerplate.
 */

import type { AutomationFlow } from "./automation-flow.js";

type FlowNodeType = "trigger" | "action" | "branch" | "merge";

export function flowNode(
  id: string,
  type: FlowNodeType,
  title: string,
  description: string,
  implementation?: string,
  standard?: string,
): AutomationFlow["nodes"][number] {
  return {
    id,
    type,
    title,
    description,
    ...(implementation ? { implementation } : {}),
    ...(standard ? { standard } : {}),
    modelMode: "default",
  };
}

export function flowEdge(source: string, target: string): AutomationFlow["edges"][number] {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}

export function flowBranch(
  id: string,
  title: string,
  sourceNodeId: string,
  nodeIds: string[],
  mergeNodeId?: string,
): AutomationFlow["branches"][number] {
  return {
    id,
    title,
    sourceNodeId,
    ...(mergeNodeId ? { mergeNodeId } : {}),
    nodeIds,
  };
}
