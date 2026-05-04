/**
 * Mermaid geometry helpers for workflow comment pins.
 *
 * This module only reads SVG structure and resolves pin coordinates. It keeps
 * DOM mutation out of the rendering path so the Mermaid source passthrough can
 * stay unchanged while later tasks add interactive comment wiring.
 */

import type {
  AutomationCommentDraftTarget,
  AutomationCommentResponse,
} from "./api.js";
import {
  readStableMermaidEdgeId,
  readStableMermaidNodeId,
  resolveMermaidTargetAnchor,
} from "./mermaid-targets.js";

export interface MermaidTargetAnchor {
  targetType: "node" | "edge" | "canvas";
  targetId: string;
  x: number;
  y: number;
  label?: string;
}

export interface MermaidCommentPinPosition {
  targetType: AutomationCommentResponse["targetType"] | "canvas";
  targetId: string;
  pinnedX?: number;
  pinnedY?: number;
  manualX?: number;
  manualY?: number;
}

interface MermaidSurfacePoint {
  x: number;
  y: number;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MermaidSurfaceBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

export function collectMermaidTargetAnchors(svg: SVGSVGElement): MermaidTargetAnchor[] {
  const anchors = [
    ...collectNodeAnchors(svg),
    ...collectEdgeAnchors(svg),
  ];
  const canvasAnchor = collectCanvasAnchor(svg);
  return canvasAnchor ? [...anchors, canvasAnchor] : anchors;
}

export function resolveCommentPinPosition(
  comment: MermaidCommentPinPosition,
  anchors: MermaidTargetAnchor[],
): { x: number; y: number; orphaned: boolean } {
  const targetAnchor = resolveMermaidTargetAnchor(comment, anchors);
  const manual = pickPoint(comment.manualX, comment.manualY);
  if (manual) {
    return { ...manual, orphaned: targetAnchor === undefined && comment.targetType !== "canvas" };
  }
  if (targetAnchor) {
    return { x: targetAnchor.x, y: targetAnchor.y, orphaned: false };
  }
  const pinned = pickPoint(comment.pinnedX, comment.pinnedY);
  if (pinned) {
    return { ...pinned, orphaned: true };
  }
  const canvasAnchor = anchors.find((anchor) => anchor.targetType === "canvas");
  if (canvasAnchor) {
    return { x: canvasAnchor.x, y: canvasAnchor.y, orphaned: true };
  }
  return { x: 0, y: 0, orphaned: true };
}

export function toSurfacePoint(
  event: Pick<PointerEvent, "clientX" | "clientY">,
  surfaceRect: MermaidSurfaceBounds,
): MermaidSurfacePoint {
  return {
    x: (event.clientX - surfaceRect.left) / surfaceRect.scaleX,
    y: (event.clientY - surfaceRect.top) / surfaceRect.scaleY,
  };
}

export function clampPinToSurface(
  point: MermaidSurfacePoint,
  size: { width: number; height: number },
): MermaidSurfacePoint {
  return {
    x: Math.max(0, Math.min(size.width, point.x)),
    y: Math.max(0, Math.min(size.height, point.y)),
  };
}

export function measureMermaidSurface(
  surface: HTMLElement,
  svg: SVGSVGElement,
): MermaidSurfaceBounds {
  const rect = surface.getBoundingClientRect();
  const fallbackSize = readSvgViewportSize(svg);
  const width = fallbackSize.width > 0 ? fallbackSize.width : rect.width;
  const height = fallbackSize.height > 0 ? fallbackSize.height : rect.height;
  const scaleX = width > 0 && rect.width > 0 ? rect.width / width : 1;
  const scaleY = height > 0 && rect.height > 0 ? rect.height / height : 1;
  return {
    left: rect.left,
    top: rect.top,
    width,
    height,
    scaleX,
    scaleY,
  };
}

export function resolveMermaidDraftTarget(
  surface: {
    surface: HTMLElement;
    svg: SVGSVGElement;
    anchors: MermaidTargetAnchor[];
  },
  eventTarget: EventTarget | null,
  event: Pick<PointerEvent, "clientX" | "clientY">,
): AutomationCommentDraftTarget | null {
  const targetElement = eventTarget instanceof Element ? eventTarget : null;
  if (!targetElement || targetElement.closest("[data-automation-comment-pin]")) {
    return null;
  }
  const nodeTargetElement = targetElement.closest<SVGElement>("g.node[id], g.node[data-id]");
  const nodeTarget = nodeTargetElement
    ? createDraftTargetFromAnchor(
      surface.anchors.find((anchor) => anchor.targetType === "node" && anchor.targetId === readStableMermaidNodeId(nodeTargetElement)),
    )
    : null;
  if (nodeTarget) return nodeTarget;
  const edgeTarget = readMermaidEdgeDraftTarget(targetElement, surface.anchors);
  if (edgeTarget) {
    return edgeTarget;
  }
  const point = clampPinToSurface(
    toSurfacePoint(event, measureMermaidSurface(surface.surface, surface.svg)),
    readSvgViewportSize(surface.svg),
  );
  return {
    targetType: "canvas",
    targetId: "canvas",
    pinnedX: point.x,
    pinnedY: point.y,
  };
}

function collectNodeAnchors(svg: SVGSVGElement): MermaidTargetAnchor[] {
  return Array.from(svg.querySelectorAll<SVGGElement>("g.node[id], g.node[data-id]"))
    .map((node) => createAnchor("node", readStableMermaidNodeId(node), getElementCenter(node), normalizeSvgText(node.textContent)))
    .filter((anchor): anchor is MermaidTargetAnchor => anchor !== null);
}

function readMermaidEdgeDraftTarget(
  targetElement: Element,
  anchors: MermaidTargetAnchor[],
): AutomationCommentDraftTarget | null {
  const edgeGroup = targetElement.closest<SVGElement>("g.edgePath[id], g.edgePath[class*='LS-']");
  if (edgeGroup) {
    const edgeGroupTarget = createDraftTargetFromAnchor(
      anchors.find((anchor) => anchor.targetType === "edge" && anchor.targetId === readStableMermaidEdgeId(edgeGroup)),
    );
    if (edgeGroupTarget) {
      return edgeGroupTarget;
    }
  }
  const edgePath = targetElement.closest<SVGPathElement>("path.flowchart-link[id], path[class*='flowchart-link'][id]");
  if (!edgePath) {
    return null;
  }
  const edgeTargetId = readStableMermaidEdgeId(edgePath);
  if (edgeTargetId === "") {
    return null;
  }
  return createDraftTargetFromAnchor(anchors.find((anchor) => anchor.targetType === "edge" && anchor.targetId === edgeTargetId));
}

function collectEdgeAnchors(svg: SVGSVGElement): MermaidTargetAnchor[] {
  const edgeGroups = Array.from(svg.querySelectorAll<SVGGElement>("g.edgePath[id]"));
  if (edgeGroups.length > 0) {
    return edgeGroups
      .map((edge) => createAnchor("edge", readStableMermaidEdgeId(edge), getPathCenter(edge.querySelector("path")) ?? getElementCenter(edge)))
      .filter((anchor): anchor is MermaidTargetAnchor => anchor !== null);
  }
  return Array.from(svg.querySelectorAll<SVGPathElement>("path.flowchart-link[id], path[class*='flowchart-link'][id]"))
    .map((path) => createAnchor("edge", readStableMermaidEdgeId(path), getPathCenter(path)))
    .filter((anchor): anchor is MermaidTargetAnchor => anchor !== null);
}

function collectCanvasAnchor(svg: SVGSVGElement): MermaidTargetAnchor | null {
  const parsedViewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (parsedViewBox) {
    return {
      targetType: "canvas",
      targetId: "canvas",
      x: parsedViewBox.x + (parsedViewBox.width / 2),
      y: parsedViewBox.y + (parsedViewBox.height / 2),
    };
  }
  const width = parseCoordinate(svg.getAttribute("width"));
  const height = parseCoordinate(svg.getAttribute("height"));
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }
  return {
    targetType: "canvas",
    targetId: "canvas",
    x: width / 2,
    y: height / 2,
  };
}

function createAnchor(
  targetType: MermaidTargetAnchor["targetType"],
  targetId: string,
  point: { x: number; y: number } | null,
  label?: string,
): MermaidTargetAnchor | null {
  if (!targetId || !point) {
    return null;
  }
  return { targetType, targetId, x: point.x, y: point.y, label };
}

function createDraftTargetFromAnchor(anchor: MermaidTargetAnchor | undefined): AutomationCommentDraftTarget | null {
  if (!anchor) {
    return null;
  }
  return {
    targetType: anchor.targetType,
    targetId: anchor.targetId,
    pinnedX: anchor.x,
    pinnedY: anchor.y,
  };
}

function getElementCenter(element: Element | null): { x: number; y: number } | null {
  if (!element) {
    return null;
  }
  const graphic = element as SVGGraphicsElement;
  if (typeof graphic.getBBox === "function") {
    const box = graphic.getBBox();
    if (isFiniteNumber(box.width) && isFiniteNumber(box.height) && (box.width > 0 || box.height > 0)) {
      return mapPointToSvgSpace(graphic, {
        x: box.x + (box.width / 2),
        y: box.y + (box.height / 2),
      });
    }
  }
  const bounds = getElementBounds(element);
  if (!bounds) {
    return null;
  }
  return mapPointToSvgSpace(graphic, {
    x: bounds.left + ((bounds.right - bounds.left) / 2),
    y: bounds.top + ((bounds.bottom - bounds.top) / 2),
  });
}

function getElementBounds(element: Element): Bounds | null {
  const ownBounds = getShapeBounds(element);
  const childBounds = Array.from(element.children).map(getElementBounds).filter((value): value is Bounds => value !== null);
  return mergeBounds(ownBounds ? [ownBounds, ...childBounds] : childBounds);
}

// fallow-ignore-next-line complexity
function getShapeBounds(element: Element): Bounds | null {
  if (matchesSvgTag(element, "rect")) {
    const x = parseCoordinate(element.getAttribute("x")) ?? 0;
    const y = parseCoordinate(element.getAttribute("y")) ?? 0;
    const width = parseCoordinate(element.getAttribute("width"));
    const height = parseCoordinate(element.getAttribute("height"));
    if (isFiniteNumber(width) && isFiniteNumber(height)) {
      return { left: x, top: y, right: x + width, bottom: y + height };
    }
  }
  if (matchesSvgTag(element, "circle")) {
    const cx = parseCoordinate(element.getAttribute("cx"));
    const cy = parseCoordinate(element.getAttribute("cy"));
    const radius = parseCoordinate(element.getAttribute("r"));
    if (isFiniteNumber(cx) && isFiniteNumber(cy) && isFiniteNumber(radius)) {
      return { left: cx - radius, top: cy - radius, right: cx + radius, bottom: cy + radius };
    }
  }
  if (matchesSvgTag(element, "ellipse")) {
    const cx = parseCoordinate(element.getAttribute("cx"));
    const cy = parseCoordinate(element.getAttribute("cy"));
    const rx = parseCoordinate(element.getAttribute("rx"));
    const ry = parseCoordinate(element.getAttribute("ry"));
    if (isFiniteNumber(cx) && isFiniteNumber(cy) && isFiniteNumber(rx) && isFiniteNumber(ry)) {
      return { left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry };
    }
  }
  if (matchesSvgTag(element, "polygon")) {
    const points = parsePolygonPoints(element.getAttribute("points"));
    if (points.length > 0) {
      return {
        left: Math.min(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      };
    }
  }
  return null;
}

function getPathCenter(path: SVGPathElement | null): { x: number; y: number } | null {
  if (!path) {
    return null;
  }
  if (typeof path.getTotalLength === "function" && typeof path.getPointAtLength === "function") {
    const midpoint = path.getPointAtLength(path.getTotalLength() / 2);
    if (isFiniteNumber(midpoint.x) && isFiniteNumber(midpoint.y)) {
      return mapPointToSvgSpace(path, { x: midpoint.x, y: midpoint.y });
    }
  }
  const points = extractPathPoints(path.getAttribute("d") ?? "");
  if (points.length === 0) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  return mapPointToSvgSpace(path, {
    x: (first.x + last.x) / 2,
    y: (first.y + last.y) / 2,
  });
}

function mapPointToSvgSpace(
  graphic: SVGGraphicsElement,
  point: { x: number; y: number },
): { x: number; y: number } {
  const translatedPoint = applyTranslate(point, readAccumulatedTranslate(graphic));
  const matrix = typeof graphic.getCTM === "function" ? graphic.getCTM() : null;
  if (!matrix) {
    return translatedPoint;
  }
  const matrixPoint = {
    x: (matrix.a * point.x) + (matrix.c * point.y) + matrix.e,
    y: (matrix.b * point.x) + (matrix.d * point.y) + matrix.f,
  };
  if (shouldPreferAttributeTranslate(point, matrixPoint, translatedPoint)) {
    return translatedPoint;
  }
  return matrixPoint;
}

function shouldPreferAttributeTranslate(
  localPoint: { x: number; y: number },
  matrixPoint: { x: number; y: number },
  translatedPoint: { x: number; y: number },
): boolean {
  return isSamePoint(matrixPoint, localPoint) && !isSamePoint(translatedPoint, localPoint);
}

function readAccumulatedTranslate(element: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: Element | null = element;
  while (current && current.namespaceURI === "http://www.w3.org/2000/svg") {
    const transform = current.getAttribute("transform");
    const translation = parseTranslate(transform);
    if (translation) {
      x += translation.x;
      y += translation.y;
    }
    current = current.parentElement;
  }
  return { x, y };
}

function parseTranslate(value: string | null): { x: number; y: number } | null {
  if (!value) {
    return null;
  }
  const match = /translate\(([-\d.]+)(?:[,\s]+([-\d.]+))?\)/.exec(value);
  if (!match) {
    return null;
  }
  const x = Number.parseFloat(match[1] ?? "");
  const y = Number.parseFloat(match[2] ?? "0");
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function applyTranslate(
  point: { x: number; y: number },
  translation: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: point.x + translation.x,
    y: point.y + translation.y,
  };
}

function parsePolygonPoints(value: string | null): Array<{ x: number; y: number }> {
  const matches = String(value ?? "").trim().split(/[\s]+/).flatMap((pair) => {
    const [x, y] = pair.split(",");
    const parsedX = Number.parseFloat(x ?? "");
    const parsedY = Number.parseFloat(y ?? "");
    return Number.isFinite(parsedX) && Number.isFinite(parsedY) ? [{ x: parsedX, y: parsedY }] : [];
  });
  return matches;
}

function isSamePoint(
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function extractPathPoints(value: string): Array<{ x: number; y: number }> {
  const matches = value.match(/-?\d*\.?\d+/g) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < matches.length - 1; index += 2) {
    const x = Number(matches[index]);
    const y = Number(matches[index + 1]);
    if (isFiniteNumber(x) && isFiniteNumber(y)) {
      points.push({ x, y });
    }
  }
  return points;
}

function mergeBounds(boundsList: Bounds[]): Bounds | null {
  if (boundsList.length === 0) {
    return null;
  }
  return boundsList.reduce((merged, bounds) => ({
    left: Math.min(merged.left, bounds.left),
    top: Math.min(merged.top, bounds.top),
    right: Math.max(merged.right, bounds.right),
    bottom: Math.max(merged.bottom, bounds.bottom),
  }));
}

function pickPoint(x: number | undefined, y: number | undefined): { x: number; y: number } | null {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }
  return { x, y };
}

function parseCoordinate(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseViewBox(value: string | null): { x: number; y: number; width: number; height: number } | null {
  if (!value) {
    return null;
  }
  const parts = value.trim().split(/[\s,]+/).map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function readSvgViewportSize(svg: SVGSVGElement): { width: number; height: number } {
  const parsedViewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (parsedViewBox) {
    return { width: parsedViewBox.width, height: parsedViewBox.height };
  }
  const width = parseCoordinate(svg.getAttribute("width")) ?? 0;
  const height = parseCoordinate(svg.getAttribute("height")) ?? 0;
  return { width, height };
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function matchesSvgTag(element: Element, tagName: string): boolean {
  return element.tagName.toLowerCase() === tagName;
}

function normalizeSvgText(value: string | null): string | undefined {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized === "" ? undefined : normalized;
}
