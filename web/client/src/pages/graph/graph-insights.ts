/**
 * Rule-based Graphy insight detection.
 *
 * The rules operate only on the graph payload that Graphy already receives:
 * nodes, weighted edges, node types, and Louvain community assignments. The
 * output is UI-ready card data; no LLM is used in this detection pass.
 */
import type {
  WikiHomeGraphEdge,
  WikiHomeGraphNode,
  WikiHomeGraphPayload,
} from "../wiki/home-graph.js";

type KnowledgeGapType = "isolated-page" | "sparse-community" | "bridge-node";

export interface SurprisingConnection {
  key: string;
  source: WikiHomeGraphNode;
  target: WikiHomeGraphNode;
  edgeId: string;
  nodeIds: string[];
  reasons: string[];
  score: number;
}

export interface KnowledgeGap {
  key: string;
  type: KnowledgeGapType;
  title: string;
  description: string;
  suggestion: string;
  nodeIds: string[];
  score: number;
}

interface GraphStats {
  nodeById: Map<string, WikiHomeGraphNode>;
  degreeByNode: Map<string, number>;
  edgesByNode: Map<string, WikiHomeGraphEdge[]>;
  maxDegree: number;
}

const MAX_CONNECTION_CARDS = 5;
const MAX_GAP_CARDS = 8;
const ISOLATED_DEGREE = 1;
const SPARSE_COMMUNITY_COHESION = 0.15;
const PERIPHERAL_CORE_REASON = "边缘节点连接核心节点";
const WEAK_CONNECTION_REASON = "弱连接但真实存在";
const STRUCTURAL_PAGE_IDS = new Set(["index", "log", "overview"]);
const DISTANT_TYPE_PAIRS = new Set([
  "source-concept",
  "concept-source",
  "source-synthesis",
  "synthesis-source",
  "query-entity",
  "entity-query",
]);

export function findSurprisingConnections(payload: WikiHomeGraphPayload): SurprisingConnection[] {
  const stats = buildGraphStats(payload);
  return payload.edges
    .map((edge) => toSurprisingConnection(edge, stats))
    .filter((item): item is SurprisingConnection => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CONNECTION_CARDS);
}

export function detectKnowledgeGaps(payload: WikiHomeGraphPayload): KnowledgeGap[] {
  const stats = buildGraphStats(payload);
  return [
    ...findIsolatedPageGaps(payload.nodes, stats),
    ...findSparseCommunityGaps(payload, stats),
    ...findBridgeNodeGaps(payload.nodes, stats),
  ].sort((left, right) => right.score - left.score).slice(0, MAX_GAP_CARDS);
}

function toSurprisingConnection(edge: WikiHomeGraphEdge, stats: GraphStats): SurprisingConnection | null {
  const source = stats.nodeById.get(edge.source);
  const target = stats.nodeById.get(edge.target);
  if (!source || !target) return null;
  if (isStructuralNode(source) || isStructuralNode(target)) return null;
  const reasons = connectionReasons(source, target, edge, stats);
  if (reasons.length === 0) return null;
  const score = scoreConnection(reasons);
  if (score < 3) return null;
  return {
    key: edge.id,
    source,
    target,
    edgeId: edge.id,
    nodeIds: [source.id, target.id],
    reasons,
    score,
  };
}

function connectionReasons(
  source: WikiHomeGraphNode,
  target: WikiHomeGraphNode,
  edge: WikiHomeGraphEdge,
  stats: GraphStats,
): string[] {
  return [
    crossCommunityReason(source, target),
    crossTypeReason(source, target),
    peripheralCoreReason(source, target, stats),
    weakConnectionReason(edge),
  ].filter(isPresent);
}

function crossCommunityReason(source: WikiHomeGraphNode, target: WikiHomeGraphNode): string | null {
  return source.community === target.community ? null : "跨社区连接";
}

function crossTypeReason(source: WikiHomeGraphNode, target: WikiHomeGraphNode): string | null {
  if (source.type === target.type) return null;
  const pair = `${source.type}-${target.type}`;
  const prefix = DISTANT_TYPE_PAIRS.has(pair) ? "跨远距离类型连接" : "跨类型连接";
  return `${prefix}：${source.type} ↔ ${target.type}`;
}

function peripheralCoreReason(
  source: WikiHomeGraphNode,
  target: WikiHomeGraphNode,
  stats: GraphStats,
): string | null {
  return isPeripheralCorePair(source.id, target.id, stats) ? PERIPHERAL_CORE_REASON : null;
}

function appendHighWeightReason(
  reasons: readonly string[],
  edge: WikiHomeGraphEdge,
  stats: GraphStats,
): string[] {
  if (reasons.length === 0 || edge.weight < stats.highWeight) return [...reasons];
  return [...reasons, HIGH_WEIGHT_REASON];
}

function isPeripheralCorePair(sourceId: string, targetId: string, stats: GraphStats): boolean {
  const leftDegree = stats.degreeByNode.get(sourceId) ?? 0;
  const rightDegree = stats.degreeByNode.get(targetId) ?? 0;
  const coreLimit = stats.maxDegree * 0.5;
  return isPeripheralCoreDegree(leftDegree, rightDegree, coreLimit)
    || isPeripheralCoreDegree(rightDegree, leftDegree, coreLimit);
}

function isPeripheralCoreDegree(
  peripheralDegree: number,
  coreDegree: number,
  coreLimit: number,
): boolean {
  return peripheralDegree <= 2 && coreDegree >= coreLimit;
}

function weakConnectionReason(edge: WikiHomeGraphEdge): string | null {
  return edge.weight > 0 && edge.weight < 2 ? WEAK_CONNECTION_REASON : null;
}

function scoreConnection(reasons: readonly string[]): number {
  return reasons.reduce((total, reason) => total + reasonWeight(reason), 0);
}

function reasonWeight(reason: string): number {
  if (reason.startsWith("跨社区")) return 3;
  if (reason.startsWith("跨远距离")) return 2;
  if (reason.startsWith("边缘")) return 2.1;
  return 1;
}

function findIsolatedPageGaps(nodes: readonly WikiHomeGraphNode[], stats: GraphStats): KnowledgeGap[] {
  return nodes
    .filter((node) => !isStructuralNode(node) && (stats.degreeByNode.get(node.id) ?? 0) <= ISOLATED_DEGREE)
    .map((node) => ({
      key: `isolated:${node.id}`,
      type: "isolated-page",
      title: `孤立页面：${node.label}`,
      description: "这页在图谱里的连接很少，通常说明它缺少上下文、引用或反向链接。",
      suggestion: "补充它和现有实体、概念、来源之间的关系说明。",
      nodeIds: [node.id],
      score: 3 - (stats.degreeByNode.get(node.id) ?? 0),
    }));
}

function findSparseCommunityGaps(payload: WikiHomeGraphPayload, stats: GraphStats): KnowledgeGap[] {
  return [...groupNodesByCommunity(payload.nodes).entries()]
    .filter(([, nodes]) => nodes.length >= 3)
    .map(([community, nodes]) => sparseCommunityGap(community, nodes, stats))
    .filter((gap): gap is KnowledgeGap => Boolean(gap));
}

function sparseCommunityGap(
  community: number,
  nodes: readonly WikiHomeGraphNode[],
  stats: GraphStats,
): KnowledgeGap | null {
  const cohesion = communityCohesion(nodes, stats);
  if (cohesion >= SPARSE_COMMUNITY_COHESION) return null;
  return {
    key: `community:${community}`,
    type: "sparse-community",
    title: `稀疏社区：Community ${community}`,
    description: `这个社区有 ${nodes.length} 个节点，但内部连接密度只有 ${cohesion.toFixed(2)}。`,
    suggestion: "补一页社区总览，解释这些页面为什么属于同一组。",
    nodeIds: nodes.map((node) => node.id),
    score: Number((SPARSE_COMMUNITY_COHESION - cohesion + nodes.length / 10).toFixed(2)),
  };
}

function findBridgeNodeGaps(nodes: readonly WikiHomeGraphNode[], stats: GraphStats): KnowledgeGap[] {
  return nodes
    .map((node) => bridgeNodeGap(node, stats))
    .filter((gap): gap is KnowledgeGap => Boolean(gap));
}

function bridgeNodeGap(node: WikiHomeGraphNode, stats: GraphStats): KnowledgeGap | null {
  if (isStructuralNode(node)) return null;
  const communities = neighborCommunities(node.id, stats);
  if (communities.size < 3) return null;
  return {
    key: `bridge:${node.id}`,
    type: "bridge-node",
    title: `桥接节点：${node.label}`,
    description: `它连接了 ${communities.size} 个社区，是跨领域枢纽，但可能缺少解释页面。`,
    suggestion: "补一页桥接说明，解释它连接这些主题的原因和边界。",
    nodeIds: [node.id],
    score: communities.size + (stats.degreeByNode.get(node.id) ?? 0) / 10,
  };
}

function buildGraphStats(payload: WikiHomeGraphPayload): GraphStats {
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node]));
  const degreeByNode = new Map(payload.nodes.map((node) => [node.id, 0]));
  const edgesByNode = new Map(payload.nodes.map((node) => [node.id, [] as WikiHomeGraphEdge[]]));
  for (const edge of payload.edges) {
    incrementDegree(edge.source, degreeByNode, edgesByNode, edge);
    incrementDegree(edge.target, degreeByNode, edgesByNode, edge);
  }
  const degrees = [...degreeByNode.values()];
  return {
    nodeById,
    degreeByNode,
    edgesByNode,
    maxDegree: Math.max(1, ...degrees),
  };
}

function incrementDegree(
  nodeId: string,
  degreeByNode: Map<string, number>,
  edgesByNode: Map<string, WikiHomeGraphEdge[]>,
  edge: WikiHomeGraphEdge,
): void {
  degreeByNode.set(nodeId, (degreeByNode.get(nodeId) ?? 0) + 1);
  edgesByNode.get(nodeId)?.push(edge);
}

function groupNodesByCommunity(nodes: readonly WikiHomeGraphNode[]): Map<number, WikiHomeGraphNode[]> {
  const communities = new Map<number, WikiHomeGraphNode[]>();
  for (const node of nodes) {
    communities.set(node.community, [...(communities.get(node.community) ?? []), node]);
  }
  return communities;
}

function communityCohesion(nodes: readonly WikiHomeGraphNode[], stats: GraphStats): number {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const internalEdges = collectInternalEdges(nodes, nodeIds, stats);
  return internalEdges.size / maxInternalEdges(nodes.length);
}

function collectInternalEdges(
  nodes: readonly WikiHomeGraphNode[],
  nodeIds: ReadonlySet<string>,
  stats: GraphStats,
): Set<string> {
  const internalEdges = new Set<string>();
  for (const node of nodes) {
    for (const edge of stats.edgesByNode.get(node.id) ?? []) {
      if (isInternalEdge(edge, nodeIds)) internalEdges.add(edge.id);
    }
  }
  return internalEdges;
}

function isInternalEdge(edge: WikiHomeGraphEdge, nodeIds: ReadonlySet<string>): boolean {
  return nodeIds.has(edge.source) && nodeIds.has(edge.target);
}

function maxInternalEdges(nodeCount: number): number {
  return Math.max(1, (nodeCount * (nodeCount - 1)) / 2);
}

function neighborCommunities(nodeId: string, stats: GraphStats): Set<number> {
  const communities = (stats.edgesByNode.get(nodeId) ?? [])
    .map((edge) => neighborCommunity(edge, nodeId, stats))
    .filter(isNumber);
  return new Set(communities);
}

function neighborCommunity(edge: WikiHomeGraphEdge, nodeId: string, stats: GraphStats): number | null {
  return stats.nodeById.get(otherNodeId(edge, nodeId))?.community ?? null;
}

function otherNodeId(edge: WikiHomeGraphEdge, nodeId: string): string {
  return edge.source === nodeId ? edge.target : edge.source;
}

function isNumber(value: number | null): value is number {
  return typeof value === "number";
}

function isPresent(value: string | null): value is string {
  return value !== null;
}

function isStructuralNode(node: WikiHomeGraphNode): boolean {
  return node.type === "overview" || STRUCTURAL_PAGE_IDS.has(nodeBasename(node.id));
}

function nodeBasename(value: string): string {
  const base = value.split("/").pop() ?? value;
  return base.replace(/\.(md|markdown|txt)$/iu, "").toLowerCase();
}
