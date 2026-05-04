/**
 * API consumption highlighting for automation Mermaid diagrams.
 *
 * API cost belongs to the workflow step that performs the call. This helper
 * does not add API nodes or edges; it only colors existing workflow nodes when
 * their Mermaid label or source flow metadata contains a real `/api/...`
 * endpoint.
 */

import type { AutomationDetailResponse } from "./api.js";

type MermaidAutomation = AutomationDetailResponse["automation"];
type AutomationNode = MermaidAutomation["flow"]["nodes"][number];

const API_ENDPOINT_PATTERN = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/api\/[^\s<>"`|)\]]+/i;
const MERMAID_NODE_DEFINITION_PATTERN = /([A-Za-z][\w-]*)\s*(\[[^\]]*\]|\{[^}]*\})/g;
const API_CONSUMER_CLASS = "apiConsumerNode";

export function appendAutomationApiConsumptionFlow(
  mermaid: string,
  automation: MermaidAutomation,
): string {
  if (mermaid.includes(`classDef ${API_CONSUMER_CLASS}`)) {
    return mermaid;
  }
  const nodeIds = collectApiConsumerNodeIds(mermaid, automation);
  if (nodeIds.length === 0) {
    return mermaid;
  }
  return [
    mermaid.trimEnd(),
    "",
    `classDef ${API_CONSUMER_CLASS} fill:#f5faff,stroke:#3366cc,stroke-width:2px,color:#202122;`,
    `class ${nodeIds.join(",")} ${API_CONSUMER_CLASS};`,
  ].join("\n");
}

function collectApiConsumerNodeIds(
  mermaid: string,
  automation: MermaidAutomation,
): string[] {
  return uniqueNodeIds([
    ...mermaid.split(/\r?\n/).flatMap(readApiConsumerIdsFromMermaidLine),
    ...automation.flow.nodes.filter(nodeContainsApiEndpoint).map((node) => node.id),
  ]);
}

function readApiConsumerIdsFromMermaidLine(line: string): string[] {
  if (!API_ENDPOINT_PATTERN.test(line)) {
    return [];
  }
  return [...line.matchAll(MERMAID_NODE_DEFINITION_PATTERN)]
    .filter((match) => API_ENDPOINT_PATTERN.test(match[2] ?? ""))
    .map((match) => match[1])
    .filter((nodeId): nodeId is string => Boolean(nodeId));
}

function nodeContainsApiEndpoint(node: AutomationNode): boolean {
  return API_ENDPOINT_PATTERN.test([
    node.title,
    node.description,
    node.implementation ?? "",
    node.app?.workflow ?? "",
    node.app?.prompt ?? "",
  ].join("\n"));
}

function uniqueNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds)];
}
