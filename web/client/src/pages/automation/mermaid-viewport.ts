/**
 * Interactive viewport helpers for workflow Mermaid diagrams.
 *
 * The workflow detail page keeps all comment pins and anchors in Mermaid's
 * native coordinate space. This module only scales the rendered surface inside
 * a scrollable viewport so mouse-wheel zoom, touchpad pinch, and explicit zoom
 * buttons can coexist with the existing comment model.
 */

interface MermaidViewportSurface {
  viewport: HTMLElement;
  frame: HTMLElement;
  surface: HTMLElement;
  svg: SVGSVGElement;
  zoomLabel: HTMLElement | null;
  zoomInButton: HTMLButtonElement | null;
  zoomOutButton: HTMLButtonElement | null;
  zoomFitButton: HTMLButtonElement | null;
}

type MermaidViewportHost = HTMLElement & { __disposeMermaidViewport?: () => void };

interface MermaidViewportFocusArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MermaidViewportState {
  scale?: number;
  scrollLeft?: number;
  scrollTop?: number;
}

interface MermaidViewportBindOptions {
  focusArea?: MermaidViewportFocusArea | null;
}

export {
  clampAutomationMermaidScale,
  computeAutomationMermaidDraggedScroll,
  computeAutomationMermaidFitScale,
  computeAutomationMermaidScrollOffset,
  computeAutomationMermaidViewportLayout,
} from "./mermaid-viewport-layout.js";
import {
  clampAutomationMermaidScale,
  computeAutomationMermaidDraggedScroll,
  computeAutomationMermaidFitScale,
  computeAutomationMermaidScrollOffset,
  computeAutomationMermaidViewportLayout,
  normalizeAutomationMermaidSvgDimensions,
  readAutomationMermaidFocusX,
  readAutomationMermaidSurfaceSize,
  type MermaidSurfaceSize,
} from "./mermaid-viewport-layout.js";

const MERMAID_SCALE_STEP = 0.16;
const MERMAID_DRAG_THRESHOLD = 4;
const MERMAID_LAYOUT_WARMUP_PASSES = 5;
const MERMAID_LAYOUT_WARMUP_DELAY_MS = 16;

export function bindAutomationMermaidViewport(
  host: HTMLElement,
  surface: MermaidViewportSurface,
  state: MermaidViewportState,
  options: MermaidViewportBindOptions = {},
): void {
  const typedHost = host as MermaidViewportHost;
  disposeAutomationMermaidViewport(typedHost);
  const baseSize = readAutomationMermaidSurfaceSize(surface.svg);
  normalizeAutomationMermaidSvgDimensions(surface.svg, baseSize);
  const focusArea = options.focusArea ?? null;
  const focusX = focusArea ? focusArea.x + (focusArea.width / 2) : readAutomationMermaidFocusX(surface.svg, baseSize.width / 2);
  const fitWidth = focusArea?.width ?? baseSize.width;
  let scale = resolveInitialMermaidScale(surface.viewport, fitWidth, state.scale);
  let shouldKeepInitialCenter = typeof state.scrollLeft !== "number" || typeof state.scrollTop !== "number";
  const syncLayout = (): void => {
    applyAutomationMermaidScale(surface, baseSize, scale, focusX);
  };
  const syncInitialLayout = (): void => {
    syncLayout();
    if (shouldKeepInitialCenter) {
      restoreAutomationMermaidScroll(surface.viewport, state, scale, focusArea, focusX, baseSize);
    }
  };
  syncLayout();
  restoreAutomationMermaidScroll(surface.viewport, state, scale, focusArea, focusX, baseSize);
  renderAutomationMermaidZoomLabel(surface.zoomLabel, scale);

  const updateScale = (nextScale: number, focus: { x: number; y: number }): void => {
    const clampedScale = clampAutomationMermaidScale(nextScale);
    if (Math.abs(clampedScale - scale) < 0.001) {
      return;
    }
    shouldKeepInitialCenter = false;
    const previousLayout = computeAutomationMermaidViewportLayout(surface.viewport.clientWidth, baseSize, scale, focusX);
    const nextLayout = computeAutomationMermaidViewportLayout(surface.viewport.clientWidth, baseSize, clampedScale, focusX);
    const scrollLeft = computeAutomationMermaidScrollOffset(
      surface.viewport.scrollLeft,
      focus.x,
      scale,
      clampedScale,
      previousLayout.insetLeft,
      nextLayout.insetLeft,
    );
    const scrollTop = computeAutomationMermaidScrollOffset(surface.viewport.scrollTop, focus.y, scale, clampedScale);
    scale = clampedScale;
    syncLayout();
    surface.viewport.scrollLeft = Math.max(0, scrollLeft);
    surface.viewport.scrollTop = Math.max(0, scrollTop);
    syncAutomationMermaidViewportState(state, surface.viewport, scale);
    renderAutomationMermaidZoomLabel(surface.zoomLabel, scale);
  };

  const handleWheel = (event: WheelEvent): void => {
    if (!shouldZoomAutomationMermaid(event)) {
      return;
    }
    event.preventDefault();
    updateScale(resolveNextAutomationMermaidScale(scale, event.deltaY), readAutomationMermaidViewportPoint(surface.viewport, event));
  };

  const handleScroll = (): void => {
    shouldKeepInitialCenter = false;
    syncAutomationMermaidViewportState(state, surface.viewport, scale);
  };
  let dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  } | null = null;

  const handlePointerDown = (event: PointerEvent): void => {
    if (!shouldStartAutomationMermaidDrag(event)) {
      return;
    }
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: surface.viewport.scrollLeft,
      startScrollTop: surface.viewport.scrollTop,
      moved: false,
    };
    surface.viewport.dataset.dragging = "true";
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const nextScroll = computeAutomationMermaidDraggedScroll(dragState, event.clientX, event.clientY);
    dragState.moved = dragState.moved || hasAutomationMermaidDragMoved(dragState, event.clientX, event.clientY);
    surface.viewport.scrollLeft = Math.max(0, nextScroll.left);
    surface.viewport.scrollTop = Math.max(0, nextScroll.top);
    syncAutomationMermaidViewportState(state, surface.viewport, scale);
    event.preventDefault();
  };

  const handlePointerUp = (event: PointerEvent): void => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const moved = dragState.moved;
    dragState = null;
    delete surface.viewport.dataset.dragging;
    if (moved) {
      surface.viewport.dataset.dragSuppressClick = "true";
    }
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    dragState = null;
    delete surface.viewport.dataset.dragging;
  };

  const handleClickCapture = (event: Event): void => {
    if (surface.viewport.dataset.dragSuppressClick !== "true") {
      return;
    }
    delete surface.viewport.dataset.dragSuppressClick;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handleZoomIn = (): void => {
    updateScale(scale * (1 + MERMAID_SCALE_STEP), readAutomationMermaidViewportCenter(surface.viewport));
  };
  const handleZoomOut = (): void => {
    updateScale(scale * (1 - MERMAID_SCALE_STEP), readAutomationMermaidViewportCenter(surface.viewport));
  };
  const handleZoomFit = (): void => {
    shouldKeepInitialCenter = false;
    scale = computeAutomationMermaidFitScale(surface.viewport.clientWidth, fitWidth);
    syncLayout();
    restoreAutomationMermaidScroll(surface.viewport, {}, scale, focusArea, focusX, baseSize);
    syncAutomationMermaidViewportState(state, surface.viewport, scale);
    renderAutomationMermaidZoomLabel(surface.zoomLabel, scale);
  };

  const layoutWarmup = scheduleAutomationMermaidLayoutWarmup(syncInitialLayout);

  surface.viewport.addEventListener("pointerdown", handlePointerDown);
  surface.viewport.addEventListener("click", handleClickCapture, true);
  surface.viewport.addEventListener("wheel", handleWheel, { passive: false });
  surface.viewport.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", syncInitialLayout);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerCancel);
  surface.zoomInButton?.addEventListener("click", handleZoomIn);
  surface.zoomOutButton?.addEventListener("click", handleZoomOut);
  surface.zoomFitButton?.addEventListener("click", handleZoomFit);

  typedHost.__disposeMermaidViewport = () => {
    surface.viewport.removeEventListener("pointerdown", handlePointerDown);
    surface.viewport.removeEventListener("click", handleClickCapture, true);
    surface.viewport.removeEventListener("wheel", handleWheel);
    surface.viewport.removeEventListener("scroll", handleScroll);
    window.removeEventListener("resize", syncInitialLayout);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
    layoutWarmup.dispose();
    surface.zoomInButton?.removeEventListener("click", handleZoomIn);
    surface.zoomOutButton?.removeEventListener("click", handleZoomOut);
    surface.zoomFitButton?.removeEventListener("click", handleZoomFit);
    delete surface.viewport.dataset.dragging;
    delete surface.viewport.dataset.dragSuppressClick;
  };
}

export function disposeAutomationMermaidViewport(host: HTMLElement): void {
  disposeAutomationMermaidViewportState(host as MermaidViewportHost);
}

function scheduleAutomationMermaidLayoutWarmup(
  syncLayout: () => void,
): { dispose: () => void } {
  const timeoutIds = Array.from({ length: MERMAID_LAYOUT_WARMUP_PASSES }, (_, index) => (
    window.setTimeout(syncLayout, index * MERMAID_LAYOUT_WARMUP_DELAY_MS)
  ));
  return {
    dispose() {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    },
  };
}

function disposeAutomationMermaidViewportState(host: MermaidViewportHost): void {
  host.__disposeMermaidViewport?.();
  delete host.__disposeMermaidViewport;
}

function resolveInitialMermaidScale(
  viewport: HTMLElement,
  fitWidth: number,
  currentScale: number | undefined,
): number {
  if (typeof currentScale === "number" && Number.isFinite(currentScale)) {
    return clampAutomationMermaidScale(currentScale);
  }
  return computeAutomationMermaidFitScale(viewport.clientWidth, fitWidth);
}

function applyAutomationMermaidScale(
  surface: MermaidViewportSurface,
  baseSize: MermaidSurfaceSize,
  scale: number,
  focusX: number,
): void {
  const layout = computeAutomationMermaidViewportLayout(surface.viewport.clientWidth, baseSize, scale, focusX);
  surface.frame.style.width = `${layout.frameWidth}px`;
  surface.frame.style.height = `${layout.frameHeight}px`;
  surface.surface.style.left = `${layout.insetLeft}px`;
  surface.surface.style.transform = `scale(${scale})`;
}

function restoreAutomationMermaidScroll(
  viewport: HTMLElement,
  state: MermaidViewportState,
  scale: number,
  focusArea: MermaidViewportFocusArea | null,
  focusX: number,
  baseSize: MermaidSurfaceSize,
): void {
  if (typeof state.scrollLeft !== "number" || typeof state.scrollTop !== "number") {
    const layout = computeAutomationMermaidViewportLayout(viewport.clientWidth, baseSize, scale, focusX);
    const centeredLeft = Math.max(0, (focusX * scale) + layout.insetLeft - (viewport.clientWidth / 2));
    if (focusArea) {
      viewport.scrollLeft = centeredLeft;
      viewport.scrollTop = Math.max(0, (focusArea.y * scale) - 48);
      return;
    }
    viewport.scrollLeft = centeredLeft;
    viewport.scrollTop = 0;
    return;
  }
  viewport.scrollLeft = Math.max(0, state.scrollLeft ?? 0);
  viewport.scrollTop = Math.max(0, state.scrollTop ?? 0);
}

function renderAutomationMermaidZoomLabel(label: HTMLElement | null, scale: number): void {
  if (label) {
    label.textContent = `${Math.round(scale * 100)}%`;
  }
}

function shouldZoomAutomationMermaid(event: WheelEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function shouldStartAutomationMermaidDrag(event: PointerEvent): boolean {
  if (event.button !== 0) {
    return false;
  }
  if (!(event.target instanceof Element)) {
    return false;
  }
  return !event.target.closest(
    "[data-automation-comment-pin], [data-automation-zoom], textarea, input, select",
  );
}

function resolveNextAutomationMermaidScale(currentScale: number, deltaY: number): number {
  const direction = deltaY < 0 ? 1 + MERMAID_SCALE_STEP : 1 - MERMAID_SCALE_STEP;
  return currentScale * direction;
}

function readAutomationMermaidViewportPoint(
  viewport: HTMLElement,
  event: Pick<WheelEvent, "clientX" | "clientY">,
): { x: number; y: number } {
  const rect = viewport.getBoundingClientRect();
  return {
    x: Math.max(0, event.clientX - rect.left),
    y: Math.max(0, event.clientY - rect.top),
  };
}

function readAutomationMermaidViewportCenter(viewport: HTMLElement): { x: number; y: number } {
  return {
    x: viewport.clientWidth / 2,
    y: viewport.clientHeight / 2,
  };
}

function syncAutomationMermaidViewportState(
  state: MermaidViewportState,
  viewport: HTMLElement,
  scale: number,
): void {
  state.scale = scale;
  state.scrollLeft = viewport.scrollLeft;
  state.scrollTop = viewport.scrollTop;
}

function hasAutomationMermaidDragMoved(
  state: { startX: number; startY: number },
  clientX: number,
  clientY: number,
): boolean {
  return Math.abs(clientX - state.startX) > MERMAID_DRAG_THRESHOLD
    || Math.abs(clientY - state.startY) > MERMAID_DRAG_THRESHOLD;
}
