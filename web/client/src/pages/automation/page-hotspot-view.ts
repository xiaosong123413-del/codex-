/**
 * Page-hotspot detail rendering for source-owned automation insights.
 *
 * This theme keeps a page thumbnail in the middle and attaches outward micro
 * flows to clickable hotspots so business users can inspect concrete page
 * regions before drilling into node explanations in the right sidebar. It
 * reuses the same zoomable viewport behavior as Mermaid detail pages so touch
 * gestures, mouse-wheel zoom, and drag-to-pan stay consistent across themes.
 */

import type { AutomationDetailResponse } from "./api.js";
import { disposeAutomationMermaidViewport } from "./mermaid-viewport.js";

type PageHotspotAutomation = AutomationDetailResponse["automation"];
type PageHotspotView = NonNullable<NonNullable<PageHotspotAutomation["sourceInsight"]>["pageHotspotView"]>;

export interface RenderedPageHotspotSurface {
  svg: SVGSVGElement;
  targets: SVGElement[];
  viewport: HTMLElement;
  frame: HTMLElement;
  surface: HTMLElement;
  focusArea: { x: number; y: number; width: number; height: number } | null;
  zoomLabel: HTMLElement | null;
  zoomInButton: HTMLButtonElement | null;
  zoomOutButton: HTMLButtonElement | null;
  zoomFitButton: HTMLButtonElement | null;
}

export function renderAutomationPageHotspotView(
  host: HTMLElement,
  automation: PageHotspotAutomation,
): RenderedPageHotspotSurface | null {
  disposeAutomationMermaidViewport(host);
  const view = automation.sourceInsight?.pageHotspotView;
  if (!view) {
    host.innerHTML = "";
    return null;
  }
  host.innerHTML = createPageHotspotHtml(view);
  return readRenderedPageHotspotSurface(host);
}

export function syncAutomationPageHotspotSelection(
  surface: RenderedPageHotspotSurface,
  selectedNodeId: string | null,
): void {
  for (const target of surface.targets) {
    const isSelected = target.dataset.automationSourceNode === selectedNodeId;
    target.dataset.automationInsightSelected = isSelected ? "true" : "false";
  }
}

export function bindAutomationPageHotspotTargets(
  surface: RenderedPageHotspotSurface,
  selectedNodeId: string | null,
  onSelect: (nodeId: string) => void,
): void {
  syncAutomationPageHotspotSelection(surface, selectedNodeId);
  for (const target of surface.targets) {
    bindPageHotspotTarget(target, onSelect);
  }
}

function createPageHotspotHtml(view: PageHotspotView): string {
  return `
    <div class="automation-detail__page-hotspot-diagram" data-automation-page-hotspot-diagram>
      <header class="automation-detail__page-hotspot-copy">
        <strong>${escapeHtml(view.title)}</strong>
        <p>${escapeHtml(view.description)}</p>
      </header>
      <div class="automation-detail__page-hotspot-toolbar" data-automation-page-hotspot-toolbar>
        <button type="button" class="btn btn-secondary" data-automation-zoom="out" aria-label="缩小流程图">-</button>
        <span class="automation-detail__mermaid-zoom-label" data-automation-zoom-label>100%</span>
        <button type="button" class="btn btn-secondary" data-automation-zoom="in" aria-label="放大流程图">+</button>
        <button type="button" class="btn btn-secondary" data-automation-zoom="fit">适应</button>
      </div>
      <div class="automation-detail__page-hotspot-viewport" data-automation-page-hotspot-viewport>
        <div class="automation-detail__page-hotspot-frame" data-automation-page-hotspot-frame>
          <div class="automation-detail__page-hotspot-surface" data-automation-page-hotspot-surface>
            ${view.svg}
          </div>
        </div>
      </div>
    </div>
  `;
}

function readRenderedPageHotspotSurface(host: HTMLElement): RenderedPageHotspotSurface | null {
  const viewport = host.querySelector<HTMLElement>("[data-automation-page-hotspot-viewport]");
  const frame = host.querySelector<HTMLElement>("[data-automation-page-hotspot-frame]");
  const surface = host.querySelector<HTMLElement>("[data-automation-page-hotspot-surface]");
  const svg = surface?.querySelector<SVGSVGElement>("svg");
  if (!viewport || !frame || !surface || !svg) {
    return null;
  }
  const targets = [...svg.querySelectorAll<SVGElement>("[data-automation-source-node]")];
  for (const target of targets) {
    preparePageHotspotTarget(target);
  }
  return {
    svg,
    targets,
    viewport,
    frame,
    surface,
    focusArea: readPageHotspotFocusArea(svg),
    zoomLabel: host.querySelector<HTMLElement>("[data-automation-zoom-label]"),
    zoomInButton: host.querySelector<HTMLButtonElement>("[data-automation-zoom=\"in\"]"),
    zoomOutButton: host.querySelector<HTMLButtonElement>("[data-automation-zoom=\"out\"]"),
    zoomFitButton: host.querySelector<HTMLButtonElement>("[data-automation-zoom=\"fit\"]"),
  };
}

function preparePageHotspotTarget(target: SVGElement): void {
  target.setAttribute("tabindex", "0");
  target.setAttribute("role", "button");
}

function readPageHotspotFocusArea(
  svg: SVGSVGElement,
): { x: number; y: number; width: number; height: number } | null {
  const focusNode = svg.querySelector<SVGGraphicsElement>("[data-automation-page-hotspot-center=\"true\"]");
  if (!focusNode) {
    return null;
  }
  const bounds = focusNode.getBBox();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function bindPageHotspotTarget(
  target: SVGElement,
  onSelect: (nodeId: string) => void,
): void {
  const nodeId = target.dataset.automationSourceNode;
  if (!nodeId) {
    return;
  }
  target.addEventListener("click", () => onSelect(nodeId));
  target.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onSelect(nodeId);
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}
