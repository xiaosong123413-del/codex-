/**
 * Draws the project workspace hierarchy connectors as a real tree overlay.
 *
 * DOM layout owns the readable node columns. This module measures rendered
 * nodes and draws parent trunks plus child arms in an SVG layer, so the graph
 * expresses actual domain -> project -> task -> action relationships.
 */
interface Point {
  readonly x: number;
  readonly y: number;
}

interface Connector {
  readonly fromId: string;
  readonly from: Point;
  readonly to: Point;
  readonly path: SVGPathElement;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_CONNECTOR_SCALE = 1;
const GRAPH_CHANGE_EVENT = "project-workspace:graph-change";

export function mountProjectWorkspaceGraphConnectors(page: HTMLElement): void {
  const layer = page.querySelector<HTMLElement>("[data-project-graph-layer]");
  const svg = page.querySelector<SVGSVGElement>("[data-project-graph-links]");
  if (!layer || !svg) return;
  const draw = (): void => drawGraphConnectors(layer, svg);
  scheduleDraw(draw);
  window.addEventListener("resize", draw);
  page.addEventListener(GRAPH_CHANGE_EVENT, () => scheduleDraw(draw));
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(draw).observe(layer);
  }
}

function scheduleDraw(draw: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(draw);
    return;
  }
  draw();
}

function drawGraphConnectors(layer: HTMLElement, svg: SVGSVGElement): void {
  const connectors = readConnectors(layer, svg);
  sizeSvg(svg, layer);
  drawTrunks(svg, connectors);
  for (const group of groupByParent(connectors).values()) {
    drawArms(group);
  }
}

function readConnectors(layer: HTMLElement, svg: SVGSVGElement): Connector[] {
  const scale = readLayerScale(layer);
  const layerRect = layer.getBoundingClientRect();
  return Array.from(svg.querySelectorAll<SVGPathElement>("[data-project-workspace-link]"))
    .map((path) => readConnector(layer, layerRect, scale, path))
    .filter((connector): connector is Connector => connector !== null);
}

function readConnector(
  layer: HTMLElement,
  layerRect: DOMRect,
  scale: number,
  path: SVGPathElement,
): Connector | null {
  const fromId = path.dataset.linkFrom ?? "";
  const fromNode = findNode(layer, fromId);
  const toNode = findNode(layer, path.dataset.linkTo ?? "");
  if (!fromNode || !toNode || !isVisibleNode(fromNode) || !isVisibleNode(toNode)) {
    path.setAttribute("d", "");
    return null;
  }
  return {
    fromId,
    from: nodePoint(fromNode, layerRect, scale, "right"),
    to: nodePoint(toNode, layerRect, scale, "left"),
    path,
  };
}

function isVisibleNode(node: HTMLElement): boolean {
  return node.getClientRects().length > 0;
}

function findNode(layer: HTMLElement, id: string): HTMLElement | null {
  return Array.from(layer.querySelectorAll<HTMLElement>("[data-project-node-id]"))
    .find((node) => node.dataset.projectNodeId === id) ?? null;
}

function nodePoint(node: HTMLElement, layerRect: DOMRect, scale: number, edge: "left" | "right"): Point {
  const rect = node.getBoundingClientRect();
  const x = edge === "right" ? rect.right - layerRect.left : rect.left - layerRect.left;
  return { x: x / scale, y: (rect.top - layerRect.top + rect.height / 2) / scale };
}

function sizeSvg(svg: SVGSVGElement, layer: HTMLElement): void {
  const width = Math.ceil(layer.scrollWidth);
  const height = Math.ceil(layer.scrollHeight);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
}

function drawTrunks(svg: SVGSVGElement, connectors: readonly Connector[]): void {
  const trunks = svg.querySelector<SVGGElement>("[data-project-graph-link-trunks]");
  if (!trunks) return;
  trunks.replaceChildren(...Array.from(groupByParent(connectors).values()).map(createTrunkPath));
}

function createTrunkPath(connectors: readonly Connector[]): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", "project-workspace-link-trunk");
  path.setAttribute("d", trunkPath(connectors));
  return path;
}

function drawArms(connectors: readonly Connector[]): void {
  const trunkX = trunkPosition(connectors);
  for (const connector of connectors) {
    connector.path.setAttribute("d", connectors.length === 1
      ? `M ${connector.from.x} ${connector.from.y} H ${connector.to.x}`
      : `M ${trunkX} ${connector.to.y} H ${connector.to.x}`);
  }
}

function trunkPath(connectors: readonly Connector[]): string {
  const sorted = sortByTargetY(connectors);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const trunkX = trunkPosition(sorted);
  if (!first || !last || sorted.length === 1) return "";
  return `M ${first.from.x} ${first.from.y} H ${trunkX} M ${trunkX} ${Math.min(first.from.y, first.to.y)} V ${Math.max(first.from.y, last.to.y)}`;
}

function trunkPosition(connectors: readonly Connector[]): number {
  const first = connectors[0];
  if (!first) return 0;
  const childX = Math.min(...connectors.map((connector) => connector.to.x));
  return Math.max(first.from.x + 18, Math.min(first.from.x + 44, childX - 20));
}

function groupByParent(connectors: readonly Connector[]): Map<string, Connector[]> {
  const groups = new Map<string, Connector[]>();
  for (const connector of connectors) {
    groups.set(connector.fromId, [...(groups.get(connector.fromId) ?? []), connector]);
  }
  return groups;
}

function sortByTargetY(connectors: readonly Connector[]): Connector[] {
  return [...connectors].sort((left, right) => left.to.y - right.to.y);
}

function readLayerScale(layer: HTMLElement): number {
  return Number(layer.style.getPropertyValue("--project-workspace-graph-scale")) || DEFAULT_CONNECTOR_SCALE;
}
