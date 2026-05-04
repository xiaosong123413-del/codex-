/**
 * Renders CRM relationship mermaid blocks as Obsidian-like relationship graphs.
 */

interface RelationNode {
  id: string;
  label: string;
  type: RelationType;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  radius: number;
  isPerson: boolean;
}

interface RelationEdge {
  from: string;
  to: string;
  label?: string;
}

type RelationType = "self" | "intimate" | "family" | "academic" | "mentor" | "collaboration" | "weak";

interface RelationPageResponse {
  frontmatter: Record<string, unknown> | null;
}

interface ViewBoxState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GraphDragState {
  startX: number;
  startY: number;
  startViewBox: ViewBoxState;
}

const GRAPH_WIDTH = 1080;
const GRAPH_HEIGHT = 640;
const PERSONAL_FACTS_PAGE_PATH = "wiki/个人信息档案/个人信息和事实.md";

const RELATION_TYPES: Record<string, RelationType> = {
  亲密关系: "intimate",
  家庭关系: "family",
  学业关系: "academic",
  指导关系: "mentor",
  协作关系: "collaboration",
  弱关系: "weak",
};

const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  self: "我",
  intimate: "亲密关系",
  family: "家庭关系",
  academic: "学业关系",
  mentor: "指导关系",
  collaboration: "协作关系",
  weak: "弱关系",
};

export function enhanceWikiRelationGraphs(article: HTMLElement): void {
  const blocks = article.querySelectorAll<HTMLElement>("pre code.language-mermaid, pre code.lang-mermaid");
  blocks.forEach((code) => {
    const source = code.textContent ?? "";
    if (!isRelationGraphSource(source)) {
      return;
    }
    code.closest("pre")?.replaceWith(renderRelationGraph(source));
  });
}

export function renderWikiRelationGraph(source: string): HTMLElement {
  return renderRelationGraph(source);
}

function isRelationGraphSource(source: string): boolean {
  return source.includes("Me[我]") && source.includes("-->");
}

function renderRelationGraph(source: string): HTMLElement {
  const host = document.createElement("section");
  const graph = parseRelationGraph(source);
  host.className = "wiki-relation-graph";
  host.innerHTML = `
    <div class="wiki-relation-graph__toolbar">
      <strong>关系网络图谱</strong>
      <span>点击头像显示直接关系，滚轮或双指缩放，按住拖动移动</span>
    </div>
    ${renderRelationSvg(graph)}
    <div class="wiki-relation-graph__legend">
      ${Object.entries(RELATION_TYPE_LABELS).map(([type, label]) => `
        <span class="wiki-relation-graph__legend-item" data-relation-type="${type}">
          <i></i>${escapeHtml(label)}
        </span>
      `).join("")}
    </div>
  `;
  bindRelationGraphZoom(host);
  bindRelationGraphSelection(host, graph.edges);
  selectRelationNode(host, graph.edges, "Me");
  void hydrateRelationNodeImages(host, graph.nodes);
  return host;
}

function parseRelationGraph(source: string): { nodes: RelationNode[]; edges: RelationEdge[] } {
  const labels = new Map<string, string>();
  const edges: RelationEdge[] = [];
  for (const line of source.split(/\r?\n/u)) {
    const edge = parseMermaidEdge(line);
    const standalone = /^\s*([A-Za-z0-9_]+)\[(.+?)\]/u.exec(line);
    if (standalone?.[1] && standalone[2]) {
      labels.set(standalone[1], standalone[2]);
    }
    if (edge) {
      edges.push(edge);
      if (edge.toLabel) {
        labels.set(edge.to, edge.toLabel);
      }
    }
  }
  labels.set("Me", labels.get("Me") ?? "我");
  return { nodes: layoutNodes(labels, edges), edges };
}

function parseMermaidEdge(line: string): (RelationEdge & { toLabel?: string }) | null {
  const labeled = /^\s*([A-Za-z0-9_]+)\s*--\s*(.+?)\s*-->\s*([A-Za-z0-9_]+)(?:\[(.+?)\])?/u.exec(line);
  if (labeled?.[1] && labeled[3]) {
    return { from: labeled[1], to: labeled[3], label: labeled[2], toLabel: labeled[4] };
  }
  const direct = /^\s*([A-Za-z0-9_]+)\s*-->\s*([A-Za-z0-9_]+)(?:\[(.+?)\])?/u.exec(line);
  return direct?.[1] && direct[2] ? { from: direct[1], to: direct[2], toLabel: direct[3] } : null;
}

function layoutNodes(labels: Map<string, string>, edges: RelationEdge[]): RelationNode[] {
  const categoryIds = edges.filter((edge) => edge.from === "Me").map((edge) => edge.to);
  const typeHints = collectRelationTypeHints(edges);
  const center = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  const nodes = new Map<string, RelationNode>();
  nodes.set("Me", createNode("Me", labels.get("Me") ?? "我", "self", center.x, center.y, 28, 0, true));
  categoryIds.forEach((id, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(categoryIds.length, 1) - Math.PI / 2;
    const label = labels.get(id) ?? id;
    const type = inferRelationType(label, typeHints.get(id));
    const x = center.x + Math.cos(angle) * 260;
    const y = center.y + Math.sin(angle) * 190;
    nodes.set(id, createNode(id, label, type, x, y, 22, angle, RELATION_TYPES[label] === undefined));
    addChildNodes(nodes, labels, edges, id, typeHints, x, y, angle);
  });
  return Array.from(nodes.values());
}

function collectRelationTypeHints(edges: RelationEdge[]): Map<string, string[]> {
  const hints = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!edge.label) return;
    hints.set(edge.from, [...(hints.get(edge.from) ?? []), edge.label]);
    hints.set(edge.to, [...(hints.get(edge.to) ?? []), edge.label]);
  });
  return hints;
}

function inferRelationType(label: string, hints: string[] = []): RelationType {
  if (RELATION_TYPES[label]) return RELATION_TYPES[label];
  const text = [label, ...hints].join(" ");
  if (/女朋友|亲密|闺蜜/u.test(text)) return "intimate";
  if (/父|母|家人|家庭/u.test(text)) return "family";
  if (/同学|室友|大学|高中|学业/u.test(text)) return "academic";
  if (/老师|导师|指导|请教/u.test(text)) return "mentor";
  if (/项目|队友|合作|协作|竞赛/u.test(text)) return "collaboration";
  return "weak";
}

function addChildNodes(
  nodes: Map<string, RelationNode>,
  labels: Map<string, string>,
  edges: RelationEdge[],
  parentId: string,
  typeHints: Map<string, string[]>,
  parentX: number,
  parentY: number,
  baseAngle: number,
): void {
  const children = edges.filter((edge) => edge.from === parentId).map((edge) => edge.to);
  children.forEach((childId, index) => {
    if (nodes.has(childId)) return;
    const spread = children.length === 1 ? 0 : (index - (children.length - 1) / 2) * 0.58;
    const angle = baseAngle + spread;
    const distance = children.length > 2 ? 170 : 150;
    const label = labels.get(childId) ?? childId;
    nodes.set(childId, createNode(
      childId,
      label,
      inferRelationType(label, typeHints.get(childId)),
      parentX + Math.cos(angle) * distance,
      parentY + Math.sin(angle) * (distance - 24),
      20,
      angle,
      true,
    ));
  });
}

function createNode(
  id: string,
  label: string,
  type: RelationType,
  x: number,
  y: number,
  radius: number,
  labelAngle: number,
  isPerson: boolean,
): RelationNode {
  const offset = radius + (isPerson ? 38 : 32);
  return {
    id,
    label,
    type,
    x: Math.round(x),
    y: Math.round(y),
    labelX: Math.round(x + Math.cos(labelAngle) * offset),
    labelY: Math.round(y + Math.sin(labelAngle) * offset),
    radius,
    isPerson,
  };
}

function renderRelationSvg(graph: { nodes: RelationNode[]; edges: RelationEdge[] }): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return `
    <svg class="wiki-relation-graph__svg" viewBox="0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}" role="img" aria-label="人际关系网络图谱">
      <defs>
        ${graph.nodes.filter((node) => node.isPerson).map(renderNodeClip).join("")}
      </defs>
      <g class="wiki-relation-graph__edges">
        ${graph.edges.map((edge) => renderEdge(nodes.get(edge.from), nodes.get(edge.to), edge.label)).join("")}
      </g>
      <g class="wiki-relation-graph__nodes">
        ${graph.nodes.map(renderNode).join("")}
      </g>
    </svg>
  `;
}

function renderEdge(from: RelationNode | undefined, to: RelationNode | undefined, label?: string): string {
  if (!from || !to) return "";
  const centerX = Math.round((from.x + to.x) / 2);
  const centerY = Math.round((from.y + to.y) / 2);
  const labelWidth = Math.max(52, Math.min(132, (label?.length ?? 0) * 15 + 24));
  return `
    <g class="wiki-relation-graph__edge" data-edge-from="${escapeHtml(from.id)}" data-edge-to="${escapeHtml(to.id)}">
      <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />
      ${label ? `
        <g class="wiki-relation-graph__edge-label" transform="translate(${centerX} ${centerY})">
          <rect x="${-labelWidth / 2}" y="-12" width="${labelWidth}" height="24" rx="12"></rect>
          <text y="4" text-anchor="middle">${escapeHtml(label)}</text>
        </g>
      ` : ""}
    </g>
  `;
}

function renderNode(node: RelationNode): string {
  const labelWidth = Math.max(52, Math.min(128, node.label.length * 15 + 24));
  const labelHeight = 24;
  return `
    <g class="wiki-relation-graph__node" data-relation-node-id="${escapeHtml(node.id)}" data-relation-type="${node.type}" role="button" tabindex="0" transform="translate(${node.x} ${node.y})">
      <circle class="wiki-relation-graph__node-ring" r="${node.radius + 5}"></circle>
      <circle class="wiki-relation-graph__node-fill" r="${node.radius}"></circle>
      ${node.isPerson ? renderNodeImage(node) : ""}
    </g>
    <g class="wiki-relation-graph__label" data-relation-label-id="${escapeHtml(node.id)}" role="button" tabindex="0" transform="translate(${node.labelX} ${node.labelY})">
      <rect x="${-labelWidth / 2}" y="${-labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="12"></rect>
      <text y="4" text-anchor="middle">${escapeHtml(node.label)}</text>
    </g>
  `;
}

function renderNodeClip(node: RelationNode): string {
  return `<clipPath id="wiki-relation-clip-${escapeHtml(node.id)}"><circle r="${node.radius}"></circle></clipPath>`;
}

function renderNodeImage(node: RelationNode): string {
  const size = node.radius * 2;
  return `
    <image
      data-relation-node-image="${escapeHtml(node.label)}"
      href=""
      x="${-node.radius}"
      y="${-node.radius}"
      width="${size}"
      height="${size}"
      preserveAspectRatio="xMidYMid slice"
      clip-path="url(#wiki-relation-clip-${escapeHtml(node.id)})"
    ></image>
  `;
}

function bindRelationGraphZoom(host: HTMLElement): void {
  const svg = host.querySelector<SVGSVGElement>(".wiki-relation-graph__svg");
  if (!svg) return;
  const state: ViewBoxState = { x: 0, y: 0, width: GRAPH_WIDTH, height: GRAPH_HEIGHT };
  bindWheelZoom(svg, state);
  bindPinchZoom(svg, state);
  bindDragPan(svg, state);
}

function bindRelationGraphSelection(host: HTMLElement, edges: RelationEdge[]): void {
  const selectors = "[data-relation-node-id], [data-relation-label-id]";
  host.querySelectorAll<SVGGElement>(selectors).forEach((target) => {
    const nodeId = target.dataset.relationNodeId ?? target.dataset.relationLabelId ?? "";
    target.addEventListener("click", () => selectRelationNode(host, edges, nodeId));
    target.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectRelationNode(host, edges, nodeId);
    });
  });
}

function selectRelationNode(host: HTMLElement, edges: RelationEdge[], nodeId: string): void {
  const related = edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
  host.querySelectorAll<SVGGElement>("[data-relation-node-id]").forEach((node) => {
    node.classList.toggle("is-selected", node.dataset.relationNodeId === nodeId);
  });
  host.querySelectorAll<SVGGElement>("[data-relation-label-id]").forEach((label) => {
    label.classList.toggle("is-selected", label.dataset.relationLabelId === nodeId);
  });
  host.querySelectorAll<SVGGElement>(".wiki-relation-graph__edge").forEach((edge) => {
    edge.classList.toggle("is-relation-visible", isRelatedEdge(edge, related));
  });
}

function isRelatedEdge(edgeNode: SVGGElement, related: RelationEdge[]): boolean {
  const from = edgeNode.dataset.edgeFrom ?? "";
  const to = edgeNode.dataset.edgeTo ?? "";
  return related.some((edge) => edge.from === from && edge.to === to);
}

function bindWheelZoom(svg: SVGSVGElement, state: ViewBoxState): void {
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const point = svgPoint(svg, event.clientX, event.clientY, state);
    zoomViewBox(svg, state, event.deltaY > 0 ? 1.12 : 0.88, point.x, point.y);
  }, { passive: false });
}

function bindPinchZoom(svg: SVGSVGElement, state: ViewBoxState): void {
  let startDistance = 0;
  let startState: ViewBoxState | null = null;
  svg.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 2) return;
    startDistance = touchDistance(event.touches[0], event.touches[1]);
    startState = { ...state };
  }, { passive: true });
  svg.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 2 || !startState || startDistance <= 0) return;
    event.preventDefault();
    Object.assign(state, startState);
    const center = touchCenter(svg, event.touches[0], event.touches[1], state);
    zoomViewBox(svg, state, startDistance / touchDistance(event.touches[0], event.touches[1]), center.x, center.y);
  }, { passive: false });
}

function bindDragPan(svg: SVGSVGElement, state: ViewBoxState): void {
  let drag: GraphDragState | null = null;
  const move = (event: MouseEvent): void => {
    if (!drag) return;
    panViewBox(svg, state, drag, event.clientX, event.clientY);
  };
  const end = (): void => {
    drag = null;
    svg.classList.remove("is-dragging");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", end);
  };
  svg.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { startX: event.clientX, startY: event.clientY, startViewBox: { ...state } };
    svg.classList.add("is-dragging");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  });
}

function panViewBox(
  svg: SVGSVGElement,
  state: ViewBoxState,
  drag: GraphDragState,
  clientX: number,
  clientY: number,
): void {
  const rect = svg.getBoundingClientRect();
  state.x = drag.startViewBox.x - ((clientX - drag.startX) / rect.width) * drag.startViewBox.width;
  state.y = drag.startViewBox.y - ((clientY - drag.startY) / rect.height) * drag.startViewBox.height;
  applyViewBox(svg, state);
}

function zoomViewBox(svg: SVGSVGElement, state: ViewBoxState, factor: number, cx: number, cy: number): void {
  const nextWidth = Math.max(360, Math.min(GRAPH_WIDTH * 1.35, state.width * factor));
  const nextHeight = nextWidth * (GRAPH_HEIGHT / GRAPH_WIDTH);
  const ratioX = (cx - state.x) / state.width;
  const ratioY = (cy - state.y) / state.height;
  state.x = cx - ratioX * nextWidth;
  state.y = cy - ratioY * nextHeight;
  state.width = nextWidth;
  state.height = nextHeight;
  applyViewBox(svg, state);
}

function applyViewBox(svg: SVGSVGElement, state: ViewBoxState): void {
  svg.setAttribute("viewBox", `${state.x} ${state.y} ${state.width} ${state.height}`);
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number, state: ViewBoxState): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: state.x + ((clientX - rect.left) / rect.width) * state.width,
    y: state.y + ((clientY - rect.top) / rect.height) * state.height,
  };
}

function touchCenter(svg: SVGSVGElement, first: Touch, second: Touch, state: ViewBoxState): { x: number; y: number } {
  return svgPoint(svg, (first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2, state);
}

function touchDistance(first: Touch, second: Touch): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

async function hydrateRelationNodeImages(host: HTMLElement, nodes: RelationNode[]): Promise<void> {
  await Promise.all(nodes.filter((node) => node.isPerson).map(async (node) => {
    const imagePath = await fetchRelationNodeImage(node);
    const image = host.querySelector<SVGImageElement>(`[data-relation-node-image="${cssEscape(node.label)}"]`);
    if (imagePath && image) {
      image.setAttribute("href", `/api/page-side-image?path=${encodeURIComponent(imagePath)}`);
      image.classList.add("is-loaded");
    }
  }));
}

async function fetchRelationNodeImage(node: RelationNode): Promise<string | null> {
  const path = node.id === "Me" ? PERSONAL_FACTS_PAGE_PATH : `wiki/crm/${node.label}.md`;
  const response = await fetch(`/api/page?path=${encodeURIComponent(path)}&raw=0`);
  if (!response.ok) return null;
  const page = (await response.json()) as RelationPageResponse;
  return readRelationImagePath(page.frontmatter, node.id === "Me" ? ["side_image", "avatar_image"] : ["side_image"]);
}

function readRelationImagePath(frontmatter: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = frontmatter?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function cssEscape(value: string): string {
  const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
  return typeof css?.escape === "function" ? css.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return character;
    }
  });
}
