/**
 * Automation flow canvas layout helpers.
 *
 * The automation detail page renders a top-down DAG with optional branch-group
 * offsets. This module computes node, edge, and branch bounds plus comment
 * anchor coordinates without touching the DOM.
 */

import type { AutomationCommentResponse } from "./api.js";

interface AutomationFlowDetailNode {
  id: string;
  type: "trigger" | "action" | "branch" | "merge";
  title: string;
  description: string;
  appLabel?: string;
  modelLabel: string;
}

interface AutomationFlowDetailEdge {
  id: string;
  source: string;
  target: string;
}

interface AutomationFlowDetailBranch {
  id: string;
  title: string;
  sourceNodeId: string;
  mergeNodeId?: string;
  nodeIds: string[];
}

export interface AutomationFlowDetail {
  nodes: AutomationFlowDetailNode[];
  edges: AutomationFlowDetailEdge[];
  branches: AutomationFlowDetailBranch[];
}

interface AutomationFlowLayout {
  nodes: Record<string, { x: number; y: number }>;
  edges: Record<string, { x: number; y: number; startX: number; startY: number; endX: number; endY: number; path: string }>;
  branches: Record<string, { x: number; y: number; width: number; height: number }>;
  width: number;
  height: number;
}

interface AutomationLayoutState {
  branchOffsets: Record<string, { x: number; y: number }>;
}

const NODE_WIDTH = 320;
const CENTER_X = 420;
const TOP_Y = 40;
const LEVEL_GAP = 32;
const LANE_GAP = NODE_WIDTH + 96;
const NODE_BASE_HEIGHT = 56;
const TITLE_CHARS_PER_LINE = 15;
const BODY_CHARS_PER_LINE = 18;
const TITLE_LINE_HEIGHT = 28;
const BODY_LINE_HEIGHT = 20;
const BRANCH_PADDING = 40;

export function layoutAutomationFlow(
  detail: AutomationFlowDetail,
  layoutState: AutomationLayoutState = { branchOffsets: {} },
): AutomationFlowLayout {
  const branchOffsets = layoutState.branchOffsets ?? {};
  const depth = computeDepths(detail);
  const nodeSizes = estimateNodeSizes(detail.nodes);
  const levelCenters = computeLevelCenters(depth, nodeSizes);
  const branchMembership = new Map<string, AutomationFlowDetailBranch>();
  for (const branch of detail.branches) {
    for (const nodeId of branch.nodeIds) {
      branchMembership.set(nodeId, branch);
    }
  }

  const nodes: AutomationFlowLayout["nodes"] = {};
  for (const node of detail.nodes) {
    const branch = branchMembership.get(node.id);
    const offset = branch ? branchOffsets[branch.id] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    const laneIndex = branch ? branch.nodeIds.indexOf(node.id) : -1;
    const laneOffset = branch ? (laneIndex - (branch.nodeIds.length - 1) / 2) * LANE_GAP : 0;
    nodes[node.id] = {
      x: CENTER_X + laneOffset + offset.x,
      y: (levelCenters.get(depth.get(node.id) ?? 0) ?? TOP_Y) + offset.y,
    };
  }

  const edges: AutomationFlowLayout["edges"] = {};
  for (const edge of detail.edges) {
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    edges[edge.id] = createEdgeLayout(
      source,
      target,
      nodeSizes.get(edge.source),
      nodeSizes.get(edge.target),
    );
  }

  const branches = computeBranchBoxes(detail.branches, nodes, nodeSizes);
  const nodeBounds = Object.entries(nodes).map(([nodeId, point]) => boundsForPoint(point, nodeSizes.get(nodeId)));
  const maxX = Math.max(
    CENTER_X,
    ...nodeBounds.map((point) => point.right),
    ...Object.values(branches).map((branch) => branch.x + branch.width),
  );
  const maxY = Math.max(
    TOP_Y,
    ...nodeBounds.map((point) => point.bottom),
    ...Object.values(branches).map((branch) => branch.y + branch.height),
  );
  return {
    nodes,
    edges,
    branches,
    width: maxX + 320,
    height: maxY + 260,
  };
}

export function buildAutomationCommentAnchors(
  layout: AutomationFlowLayout,
  comments: AutomationCommentResponse[],
): Record<string, { x: number; y: number }> {
  const anchors: Record<string, { x: number; y: number }> = {};
  for (const comment of comments) {
    const point = comment.targetType === "edge"
      ? layout.edges[comment.targetId]
      : layout.nodes[comment.targetId];
    if (!point) continue;
    anchors[comment.id] = { x: point.x, y: point.y };
  }
  return anchors;
}

function estimateNodeSizes(nodes: AutomationFlowDetailNode[]): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const node of nodes) {
    sizes.set(node.id, {
      width: NODE_WIDTH,
      height: estimateNodeHeight(node),
    });
  }
  return sizes;
}

function estimateNodeHeight(node: AutomationFlowDetailNode): number {
  let height = NODE_BASE_HEIGHT;
  height += estimateTextLines(node.title, TITLE_CHARS_PER_LINE) * TITLE_LINE_HEIGHT;
  if (node.description.trim()) {
    height += 8 + estimateTextLines(node.description, BODY_CHARS_PER_LINE) * BODY_LINE_HEIGHT;
  }
  if (node.appLabel?.trim()) {
    height += 8 + estimateTextLines(node.appLabel, BODY_CHARS_PER_LINE) * BODY_LINE_HEIGHT;
  }
  if (node.modelLabel.trim()) {
    height += 8 + estimateTextLines(node.modelLabel, BODY_CHARS_PER_LINE) * BODY_LINE_HEIGHT;
  }
  return height;
}

function estimateTextLines(value: string, maxCharsPerLine: number): number {
  const text = value.trim();
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(Array.from(text).length / maxCharsPerLine));
}

function computeLevelCenters(
  depth: Map<string, number>,
  nodeSizes: Map<string, { width: number; height: number }>,
): Map<number, number> {
  const levels = new Map<number, number>();
  for (const [nodeId, nodeDepth] of depth.entries()) {
    const nodeHeight = nodeSizes.get(nodeId)?.height ?? NODE_BASE_HEIGHT;
    levels.set(nodeDepth, Math.max(levels.get(nodeDepth) ?? 0, nodeHeight));
  }
  const centers = new Map<number, number>();
  const orderedLevels = [...levels.keys()].sort((left, right) => left - right);
  let currentTop = TOP_Y;
  for (const level of orderedLevels) {
    const height = levels.get(level) ?? NODE_BASE_HEIGHT;
    centers.set(level, currentTop + height / 2);
    currentTop += height + LEVEL_GAP;
  }
  return centers;
}

// fallow-ignore-next-line complexity
function computeDepths(detail: AutomationFlowDetail): Map<string, number> {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of detail.nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of detail.edges) {
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = detail.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => Number(left.type !== "trigger") - Number(right.type !== "trigger"))
    .map((node) => node.id);
  const depth = new Map<string, number>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, currentDepth + 1));
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }
  for (const node of detail.nodes) {
    depth.set(node.id, depth.get(node.id) ?? (node.type === "trigger" ? 0 : 1));
  }
  return depth;
}

function computeBranchBoxes(
  branches: AutomationFlowDetailBranch[],
  nodes: AutomationFlowLayout["nodes"],
  nodeSizes: Map<string, { width: number; height: number }>,
): AutomationFlowLayout["branches"] {
  const result: AutomationFlowLayout["branches"] = {};
  for (const branch of branches) {
    const points = branch.nodeIds
      .flatMap((nodeId) => nodes[nodeId] ? [boundsForPoint(nodes[nodeId], nodeSizes.get(nodeId))] : []);
    if (points.length === 0) continue;
    const minX = Math.min(...points.map((point) => point.left));
    const maxX = Math.max(...points.map((point) => point.right));
    const minY = Math.min(...points.map((point) => point.top));
    const maxY = Math.max(...points.map((point) => point.bottom));
    result[branch.id] = {
      x: minX - BRANCH_PADDING,
      y: minY - BRANCH_PADDING,
      width: maxX - minX + BRANCH_PADDING * 2,
      height: maxY - minY + BRANCH_PADDING * 2,
    };
  }
  return result;
}

function boundsForPoint(
  point: { x: number; y: number } | undefined,
  size: { width: number; height: number } | undefined,
): { left: number; right: number; top: number; bottom: number } {
  const width = size?.width ?? NODE_WIDTH;
  const height = size?.height ?? NODE_BASE_HEIGHT;
  const x = point?.x ?? CENTER_X;
  const y = point?.y ?? TOP_Y;
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function midpointOutsideCards(
  source: { left: number; right: number; top: number; bottom: number },
  target: { left: number; right: number; top: number; bottom: number },
): number {
  const startY = source.bottom <= target.top ? source.bottom : source.top;
  const endY = source.bottom <= target.top ? target.top : target.bottom;
  return (startY + endY) / 2;
}

function createEdgeLayout(
  source: { x: number; y: number } | undefined,
  target: { x: number; y: number } | undefined,
  sourceSize: { width: number; height: number } | undefined,
  targetSize: { width: number; height: number } | undefined,
): AutomationFlowLayout["edges"][string] {
  const sourceBounds = boundsForPoint(source, sourceSize);
  const targetBounds = boundsForPoint(target, targetSize);
  const points = resolveEdgeEndpoints(source, target, sourceBounds, targetBounds);
  return {
    x: (points.startX + points.endX) / 2,
    y: midpointOutsideCards(sourceBounds, targetBounds),
    ...points,
    path: createEdgePath(points.startX, points.startY, points.endX, points.endY),
  };
}

function resolveEdgeEndpoints(
  source: { x: number; y: number } | undefined,
  target: { x: number; y: number } | undefined,
  sourceBounds: { left: number; right: number; top: number; bottom: number },
  targetBounds: { left: number; right: number; top: number; bottom: number },
): { startX: number; startY: number; endX: number; endY: number } {
  const sourceX = source?.x ?? CENTER_X;
  const targetX = target?.x ?? CENTER_X;
  if (sourceBounds.bottom <= targetBounds.top) {
    return {
      startX: sourceX,
      startY: sourceBounds.bottom,
      endX: targetX,
      endY: targetBounds.top,
    };
  }
  return {
    startX: sourceX,
    startY: sourceBounds.top,
    endX: targetX,
    endY: targetBounds.bottom,
  };
}

function createEdgePath(startX: number, startY: number, endX: number, endY: number): string {
  if (Math.abs(startX - endX) < 1) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
  const bendY = startY + (endY - startY) / 2;
  return `M ${startX} ${startY} L ${startX} ${bendY} L ${endX} ${bendY} L ${endX} ${endY}`;
}
