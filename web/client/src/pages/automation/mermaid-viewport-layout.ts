/**
 * Pure layout helpers for workflow Mermaid viewport rendering.
 *
 * The interactive viewport needs two kinds of logic: DOM event wiring and
 * deterministic geometry calculations. This module keeps the geometry pieces
 * isolated so centering, zoom, and drag behavior stay testable without the
 * browser event layer.
 */

export interface MermaidSurfaceSize {
  width: number;
  height: number;
}

interface MermaidViewportLayout {
  frameWidth: number;
  frameHeight: number;
  insetLeft: number;
}

const MIN_MERMAID_SCALE = 0.45;
const MAX_MERMAID_SCALE = 2.8;
const DEFAULT_MERMAID_SCALE = 1;
const MAX_AUTO_SCALE = 1.8;
const MERMAID_FIT_PADDING = 56;
const MERMAID_SCROLL_END_PADDING = 120;

export function clampAutomationMermaidScale(scale: number): number {
  return Math.max(MIN_MERMAID_SCALE, Math.min(MAX_MERMAID_SCALE, scale));
}

export function computeAutomationMermaidFitScale(viewportWidth: number, contentWidth: number): number {
  if (viewportWidth <= 0 || contentWidth <= 0) {
    return DEFAULT_MERMAID_SCALE;
  }
  return clampAutomationMermaidScale(Math.min((viewportWidth - MERMAID_FIT_PADDING) / contentWidth, MAX_AUTO_SCALE));
}

export function computeAutomationMermaidScrollOffset(
  scrollOffset: number,
  focusOffset: number,
  previousScale: number,
  nextScale: number,
  previousInset = 0,
  nextInset = 0,
): number {
  const baseOffset = (scrollOffset + focusOffset - previousInset) / previousScale;
  return (baseOffset * nextScale) + nextInset - focusOffset;
}

export function computeAutomationMermaidDraggedScroll(
  state: {
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  },
  clientX: number,
  clientY: number,
): { left: number; top: number } {
  return {
    left: state.startScrollLeft - (clientX - state.startX),
    top: state.startScrollTop - (clientY - state.startY),
  };
}

export function computeAutomationMermaidViewportLayout(
  viewportWidth: number,
  baseSize: MermaidSurfaceSize,
  scale: number,
  focusX = baseSize.width / 2,
): MermaidViewportLayout {
  const scaledWidth = baseSize.width * scale;
  const insetLeft = Math.max(0, (viewportWidth / 2) - (focusX * scale));
  const frameWidth = Math.max(viewportWidth, scaledWidth + insetLeft);
  return {
    frameWidth,
    frameHeight: (baseSize.height * scale) + MERMAID_SCROLL_END_PADDING,
    insetLeft,
  };
}

export function readAutomationMermaidSurfaceSize(svg: SVGSVGElement): MermaidSurfaceSize {
  const viewBox = parseAutomationMermaidViewBox(svg.getAttribute("viewBox"));
  if (viewBox) {
    return viewBox;
  }
  return {
    width: readAutomationMermaidLength(svg.getAttribute("width")) ?? 1,
    height: readAutomationMermaidLength(svg.getAttribute("height")) ?? 1,
  };
}

export function readAutomationMermaidFocusX(svg: SVGSVGElement, fallbackX: number): number {
  const focusNode = findTopmostAutomationMermaidNode(svg);
  if (!focusNode) {
    return fallbackX;
  }
  const transform = parseAutomationMermaidTranslate(focusNode.getAttribute("transform"));
  if (transform) {
    return transform.x;
  }
  const rect = focusNode.querySelector<SVGRectElement>("rect");
  if (!rect) {
    return fallbackX;
  }
  const x = readAutomationMermaidLength(rect.getAttribute("x")) ?? 0;
  const width = readAutomationMermaidLength(rect.getAttribute("width")) ?? 0;
  return width > 0 ? x + (width / 2) : fallbackX;
}

export function normalizeAutomationMermaidSvgDimensions(
  svg: SVGSVGElement,
  baseSize: MermaidSurfaceSize,
): void {
  svg.setAttribute("width", String(baseSize.width));
  svg.setAttribute("height", String(baseSize.height));
  svg.style.width = `${baseSize.width}px`;
  svg.style.height = `${baseSize.height}px`;
  svg.style.maxWidth = "none";
}

function parseAutomationMermaidViewBox(value: string | null): MermaidSurfaceSize | null {
  if (!value) {
    return null;
  }
  const parts = value.trim().split(/[\s,]+/).map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return parts[2]! > 0 && parts[3]! > 0 ? { width: parts[2]!, height: parts[3]! } : null;
}

function findTopmostAutomationMermaidNode(svg: SVGSVGElement): SVGGElement | null {
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>("g.node[id]"));
  return nodes.reduce<SVGGElement | null>((topmost, node) => {
    const transform = parseAutomationMermaidTranslate(node.getAttribute("transform"));
    if (!transform) {
      return topmost ?? node;
    }
    if (!topmost) {
      return node;
    }
    const topmostTransform = parseAutomationMermaidTranslate(topmost.getAttribute("transform"));
    return topmostTransform && topmostTransform.y <= transform.y ? topmost : node;
  }, null);
}

function parseAutomationMermaidTranslate(value: string | null): { x: number; y: number } | null {
  if (!value) {
    return null;
  }
  const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(value);
  if (!match) {
    return null;
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function readAutomationMermaidLength(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
