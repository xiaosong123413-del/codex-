/**
 * Stable Mermaid target identifiers and label resolution for workflow comments.
 *
 * Mermaid renders temporary DOM ids like `flowchart-D-83`, but the SVG also
 * exposes more stable identifiers and class metadata. These helpers normalize
 * node/edge ids so comment pins survive rerendering and old runtime-id
 * comments can still recover their nearest real target.
 */

import type {
  AutomationCommentResponse,
} from "./api.js";
import type {
  MermaidCommentPinPosition,
  MermaidTargetAnchor,
} from "./mermaid-comments.js";

const LEGACY_TARGET_MAX_DISTANCE = 96;

export function readStableMermaidNodeId(node: Element): string {
  return readPreferredAttribute(node, "data-id") || readPreferredAttribute(node, "id");
}

export function readStableMermaidEdgeId(edge: Element): string {
  return readPreferredAttribute(edge, "data-id")
    || readMermaidEdgeClassId(edge.getAttribute("class"))
    || readPreferredAttribute(edge, "id");
}

export function resolveMermaidTargetAnchor(
  comment: MermaidCommentPinPosition,
  anchors: MermaidTargetAnchor[],
): MermaidTargetAnchor | undefined {
  const exactTarget = anchors.find((anchor) => anchor.targetType === comment.targetType && anchor.targetId === comment.targetId);
  if (exactTarget) {
    return exactTarget;
  }
  if (!isLegacyMermaidRuntimeTarget(comment.targetId)) {
    return undefined;
  }
  const targetPoint = pickTargetPoint(comment);
  if (!targetPoint) {
    return undefined;
  }
  const nearestTarget = findNearestAnchor(
    anchors.filter((anchor) => anchor.targetType === comment.targetType),
    targetPoint.x,
    targetPoint.y,
  );
  return nearestTarget && nearestTarget.distance <= LEGACY_TARGET_MAX_DISTANCE ? nearestTarget.anchor : undefined;
}

export function resolveMermaidTargetLabel(
  target: Pick<AutomationCommentResponse, "targetType" | "targetId">
    & Partial<Pick<AutomationCommentResponse, "pinnedX" | "pinnedY" | "manualX" | "manualY">>,
  anchors: MermaidTargetAnchor[],
): string | null {
  if (target.targetType === "canvas") {
    return "画布空白处";
  }
  const anchor = resolveMermaidTargetAnchor(target, anchors);
  return anchor?.label ?? anchor?.targetId ?? null;
}

function readPreferredAttribute(element: Element, name: string): string {
  return String(element.getAttribute(name) ?? "").trim();
}

function readMermaidEdgeClassId(className: string | null): string {
  const normalizedClassName = String(className ?? "");
  const sourceMatch = normalizedClassName.match(/\bLS-([^\s]+)/);
  const targetMatch = normalizedClassName.match(/\bLE-([^\s]+)/);
  if (!sourceMatch?.[1] || !targetMatch?.[1]) {
    return "";
  }
  return `${sourceMatch[1]}-->${targetMatch[1]}`;
}

function isLegacyMermaidRuntimeTarget(targetId: string): boolean {
  return /^flowchart-/i.test(targetId) || /^L[_-]/.test(targetId);
}

function pickTargetPoint(comment: MermaidCommentPinPosition): { x: number; y: number } | null {
  if (isFiniteNumber(comment.manualX) && isFiniteNumber(comment.manualY)) {
    return { x: comment.manualX, y: comment.manualY };
  }
  if (isFiniteNumber(comment.pinnedX) && isFiniteNumber(comment.pinnedY)) {
    return { x: comment.pinnedX, y: comment.pinnedY };
  }
  return null;
}

function findNearestAnchor(
  anchors: MermaidTargetAnchor[],
  x: number,
  y: number,
): { anchor: MermaidTargetAnchor; distance: number } | null {
  if (anchors.length === 0) {
    return null;
  }
  let bestAnchor = anchors[0];
  let bestDistance = readDistance(bestAnchor, x, y);
  for (const anchor of anchors.slice(1)) {
    const distance = readDistance(anchor, x, y);
    if (distance < bestDistance) {
      bestAnchor = anchor;
      bestDistance = distance;
    }
  }
  return { anchor: bestAnchor, distance: bestDistance };
}

function readDistance(anchor: MermaidTargetAnchor, x: number, y: number): number {
  return Math.hypot(anchor.x - x, anchor.y - y);
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
