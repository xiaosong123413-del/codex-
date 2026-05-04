/**
 * Automation flow normalization and DAG validation helpers.
 *
 * The automation workspace stores flow structure as nodes, edges, and branch
 * groups. This module keeps that structure valid and provides a legacy
 * fallback flow so older flat automation records can still render.
 */

const FLOW_NODE_TYPES = new Set(["trigger", "action", "branch", "merge"]);

type AutomationTriggerLike = "schedule" | "webhook" | "message";
type NormalizeMode = "read" | "save";

type AutomationFlowNodeType = "trigger" | "action" | "branch" | "merge";
type AutomationFlowModelMode = "explicit" | "default";

export interface AutomationFlowNode {
  id: string;
  type: AutomationFlowNodeType;
  title: string;
  description: string;
  standard?: string;
  implementation?: string;
  appId?: string;
  modelMode: AutomationFlowModelMode;
  model?: string;
}

export interface AutomationFlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface AutomationFlowBranch {
  id: string;
  title: string;
  sourceNodeId: string;
  mergeNodeId?: string;
  nodeIds: string[];
}

export interface AutomationFlow {
  nodes: AutomationFlowNode[];
  edges: AutomationFlowEdge[];
  branches: AutomationFlowBranch[];
}

interface AutomationFlowContext {
  id: string;
  name: string;
  summary: string;
  trigger: AutomationTriggerLike;
  appId: string;
  mode: NormalizeMode;
}

export function normalizeAutomationFlow(input: unknown, automation: AutomationFlowContext): AutomationFlow {
  const record = isRecord(input) ? input : null;
  if (!record) {
    return requireFlowRecord(automation);
  }

  const flow = {
    branches: normalizeFlowBranches(record.branches, automation.name),
    edges: normalizeFlowEdges(record.edges, automation.name),
    nodes: normalizeFlowNodes(record.nodes, automation.name),
  };
  if (flow.nodes.length === 0) {
    return requireFlowNodes(automation);
  }

  validateFlow(flow, automation.name);
  return flow;
}

function createLegacyFlow(automation: Omit<AutomationFlowContext, "mode">): AutomationFlow {
  const triggerId = `trigger-${automation.id}`;
  const actionId = `action-${automation.id}`;
  return {
    nodes: [
      {
        id: triggerId,
        type: "trigger",
        title: createLegacyTriggerTitle(automation.trigger),
        description: automation.summary,
        modelMode: "default",
      },
      {
        id: actionId,
        type: "action",
        title: `执行 ${automation.name}`,
        description: `调用应用 ${automation.appId} 继续处理。`,
        appId: automation.appId,
        modelMode: "default",
      },
    ],
    edges: [{ id: `edge-${automation.id}`, source: triggerId, target: actionId }],
    branches: [],
  };
}

function requireFlowRecord(automation: AutomationFlowContext): AutomationFlow {
  if (automation.mode === "read") {
    return createLegacyFlow(automation);
  }
  throw new Error(`Automation ${automation.name} is missing flow.`);
}

function requireFlowNodes(automation: AutomationFlowContext): AutomationFlow {
  if (automation.mode === "read") {
    return createLegacyFlow(automation);
  }
  throw new Error(`Automation ${automation.name} is missing flow.nodes.`);
}

function normalizeFlowNodes(input: unknown, automationName: string): AutomationFlowNode[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((node, index) => normalizeFlowNode(node, automationName, index));
}

function normalizeFlowEdges(input: unknown, automationName: string): AutomationFlowEdge[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((edge, index) => normalizeFlowEdge(edge, automationName, index));
}

function normalizeFlowBranches(input: unknown, automationName: string): AutomationFlowBranch[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((branch, index) => normalizeFlowBranch(branch, automationName, index));
}

function normalizeFlowNode(input: unknown, automationName: string, index: number): AutomationFlowNode {
  if (!isRecord(input)) {
    throw new Error(`Automation ${automationName} has an invalid flow node.`);
  }
  const title = requireText(input.title, `Automation ${automationName} has a node missing title.`);
  const modelMode = normalizeModelMode(input.modelMode);
  const model = normalizeText(input.model) ?? undefined;
  if (modelMode === "explicit" && !model) {
    throw new Error(`Automation ${automationName} node ${title} requires an explicit model.`);
  }
  return {
    id: requireText(input.id, `Automation ${automationName} node ${index + 1} is missing id.`),
    type: normalizeFlowNodeType(input.type, automationName),
    title,
    description: requireText(input.description, `Automation ${automationName} node ${title} is missing description.`),
    ...normalizeOptionalFlowNodeFields(input),
    modelMode,
    ...(model ? { model } : {}),
  };
}

function normalizeOptionalFlowNodeFields(input: Record<string, unknown>): Partial<AutomationFlowNode> {
  const standard = normalizeText(input.standard);
  const implementation = normalizeText(input.implementation);
  const appId = normalizeText(input.appId);
  return {
    ...(standard ? { standard } : {}),
    ...(implementation ? { implementation } : {}),
    ...(appId ? { appId } : {}),
  };
}

function normalizeFlowEdge(input: unknown, automationName: string, index: number): AutomationFlowEdge {
  if (!isRecord(input)) {
    throw new Error(`Automation ${automationName} has an invalid flow edge.`);
  }
  return {
    id: requireText(input.id, `Automation ${automationName} edge ${index + 1} is missing id.`),
    source: requireText(input.source, `Automation ${automationName} edge ${index + 1} is missing source.`),
    target: requireText(input.target, `Automation ${automationName} edge ${index + 1} is missing target.`),
  };
}

function normalizeFlowBranch(input: unknown, automationName: string, index: number): AutomationFlowBranch {
  if (!isRecord(input)) {
    throw new Error(`Automation ${automationName} has an invalid flow branch.`);
  }
  const nodeIds = normalizeBranchNodeIds(input.nodeIds, automationName, index);
  const mergeNodeId = normalizeText(input.mergeNodeId) ?? undefined;
  return {
    id: requireText(input.id, `Automation ${automationName} branch ${index + 1} is missing id.`),
    title: requireText(input.title, `Automation ${automationName} branch ${index + 1} is missing title.`),
    sourceNodeId: requireText(input.sourceNodeId, `Automation ${automationName} branch ${index + 1} is missing sourceNodeId.`),
    ...(mergeNodeId ? { mergeNodeId } : {}),
    nodeIds,
  };
}

function normalizeBranchNodeIds(input: unknown, automationName: string, index: number): string[] {
  const nodeIds = Array.isArray(input)
    ? input.map((nodeId) => requireText(nodeId, `Automation ${automationName} branch ${index + 1} has an empty node id.`))
    : [];
  if (nodeIds.length === 0) {
    throw new Error(`Automation ${automationName} branch ${index + 1} must include nodeIds.`);
  }
  return nodeIds;
}

function validateFlow(flow: AutomationFlow, automationName: string): void {
  const nodesById = mapNodesById(flow, automationName);
  validateTriggerCount(flow.nodes, automationName);
  validateEdges(flow.edges, nodesById, automationName);
  validateBranches(flow, nodesById, automationName);
  if (containsCycle(flow)) {
    throw new Error(`Automation ${automationName} flow must be a DAG.`);
  }
}

function mapNodesById(flow: AutomationFlow, automationName: string): Map<string, AutomationFlowNode> {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== flow.nodes.length) {
    throw new Error(`Automation ${automationName} has duplicate flow node ids.`);
  }
  return nodesById;
}

function validateTriggerCount(nodes: AutomationFlowNode[], automationName: string): void {
  const triggerCount = nodes.filter((node) => node.type === "trigger").length;
  if (triggerCount !== 1) {
    throw new Error(`Automation ${automationName} must include exactly one trigger node.`);
  }
}

function validateEdges(
  edges: AutomationFlowEdge[],
  nodesById: Map<string, AutomationFlowNode>,
  automationName: string,
): void {
  for (const edge of edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      throw new Error(`Automation ${automationName} has an edge pointing to a missing node.`);
    }
  }
}

function validateBranches(
  flow: AutomationFlow,
  nodesById: Map<string, AutomationFlowNode>,
  automationName: string,
): void {
  for (const branch of flow.branches) {
    validateBranchEndpoints(branch, nodesById, automationName);
    validateBranchNodes(branch, flow.edges, nodesById, automationName);
  }
}

function validateBranchEndpoints(
  branch: AutomationFlowBranch,
  nodesById: Map<string, AutomationFlowNode>,
  automationName: string,
): void {
  const source = nodesById.get(branch.sourceNodeId);
  if (!source || source.type !== "branch") {
    throw new Error(`Automation ${automationName} branch ${branch.id} must reference a branch source node.`);
  }
  if (!branch.mergeNodeId) {
    return;
  }
  const merge = nodesById.get(branch.mergeNodeId);
  if (!merge || merge.type !== "merge") {
    throw new Error(`Automation ${automationName} branch ${branch.id} must reference a merge node.`);
  }
}

function validateBranchNodes(
  branch: AutomationFlowBranch,
  edges: AutomationFlowEdge[],
  nodesById: Map<string, AutomationFlowNode>,
  automationName: string,
): void {
  for (const nodeId of branch.nodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Automation ${automationName} branch ${branch.id} references a missing node.`);
    }
    if (node.type === "trigger" || node.id === branch.sourceNodeId) {
      throw new Error(`Automation ${automationName} branch ${branch.id} references an invalid branch node.`);
    }
    if (!hasInboundBranchEdge(branch, nodeId, edges)) {
      throw new Error(`Automation ${automationName} branch ${branch.id} contains an unreachable node.`);
    }
    if (branch.mergeNodeId && !hasOutboundBranchEdge(branch, nodeId, edges)) {
      throw new Error(`Automation ${automationName} branch ${branch.id} contains an isolated node before merge.`);
    }
  }
}

function hasInboundBranchEdge(branch: AutomationFlowBranch, nodeId: string, edges: AutomationFlowEdge[]): boolean {
  return edges.some((edge) => edge.target === nodeId && isBranchInboundSource(branch, edge.source));
}

function hasOutboundBranchEdge(branch: AutomationFlowBranch, nodeId: string, edges: AutomationFlowEdge[]): boolean {
  return edges.some((edge) => edge.source === nodeId && isBranchOutboundTarget(branch, edge.target));
}

function isBranchInboundSource(branch: AutomationFlowBranch, sourceId: string): boolean {
  return sourceId === branch.sourceNodeId || branch.nodeIds.includes(sourceId);
}

function isBranchOutboundTarget(branch: AutomationFlowBranch, targetId: string): boolean {
  return (branch.mergeNodeId ? targetId === branch.mergeNodeId : false) || branch.nodeIds.includes(targetId);
}

function containsCycle(flow: AutomationFlow): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of flow.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of flow.edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  return flow.nodes.some((node) => visitNode(node.id, adjacency, visiting, visited));
}

function visitNode(
  nodeId: string,
  adjacency: Map<string, string[]>,
  visiting: Set<string>,
  visited: Set<string>,
): boolean {
  if (visiting.has(nodeId)) {
    return true;
  }
  if (visited.has(nodeId)) {
    return false;
  }
  visiting.add(nodeId);
  for (const next of adjacency.get(nodeId) ?? []) {
    if (visitNode(next, adjacency, visiting, visited)) {
      return true;
    }
  }
  visiting.delete(nodeId);
  visited.add(nodeId);
  return false;
}

function createLegacyTriggerTitle(trigger: AutomationTriggerLike): string {
  switch (trigger) {
    case "schedule":
      return "定时触发";
    case "webhook":
      return "Webhook 触发";
    default:
      return "消息触发";
  }
}

function normalizeFlowNodeType(input: unknown, automationName: string): AutomationFlowNodeType {
  if (!FLOW_NODE_TYPES.has(String(input ?? ""))) {
    throw new Error(`Automation ${automationName} has an invalid flow node type.`);
  }
  return input as AutomationFlowNodeType;
}

function normalizeModelMode(input: unknown): AutomationFlowModelMode {
  return input === "explicit" ? "explicit" : "default";
}

function requireText(value: unknown, message: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw new Error(message);
  }
  return text;
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
