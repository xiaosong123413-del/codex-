/**
 * Page-local Graphy widget for workspace work-log objects.
 *
 * It asks the workspace graph endpoint for the selected work object and renders
 * its direct backlinks across task, project, case, method, and toolbox nodes.
 */
import type Graph from "graphology";
import type Sigma from "sigma";
import type { Settings } from "sigma/settings";
import { waitForGraphStageSize } from "../wiki/home-graph.js";

interface WorkspaceGraphNode {
  id: string;
  label: string;
  path: string;
  type: string;
  size: number;
  color: string;
}

interface WorkspaceGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  label: string;
}

interface WorkspaceGraphPayload {
  nodes: WorkspaceGraphNode[];
  edges: WorkspaceGraphEdge[];
}

interface WorkspaceGraphApiResponse {
  success?: boolean;
  data?: WorkspaceGraphPayload;
}

interface WorkspaceRelationNode {
  id: string;
  label: string;
  type: string;
  path: string;
}

interface WorkspaceRelationView {
  id: string;
  typeLabel: string;
  source: WorkspaceRelationNode;
  target: WorkspaceRelationNode;
}

interface WorkspaceRelationState {
  current: WorkspaceRelationNode | null;
  relations: WorkspaceRelationView[];
  candidates: WorkspaceRelationNode[];
  types: Array<{ value: string; label: string }>;
}

interface WorkspaceRelationApiResponse {
  success?: boolean;
  data?: WorkspaceRelationState;
}

interface WorkspaceGraphNodeAttributes {
  label: string;
  path: string;
  nodeType: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

interface WorkspaceGraphEdgeAttributes {
  label: string;
  weight: number;
  size: number;
  color: string;
}

interface MountedWorkspaceGraph {
  kill: () => void;
}

const mountedWorkspaceGraphs = new WeakMap<HTMLElement, MountedWorkspaceGraph>();
const WORKSPACE_GRAPH_RING_SIZE = 20;

export function mountWorkspacePageGraph(
  root: HTMLElement,
  container: HTMLElement,
  nodeId: string,
  signal: AbortSignal,
): void {
  disposeWorkspacePageGraph(root);
  container.hidden = false;
  container.innerHTML = renderWorkspaceGraphShell(`<p class="wiki-page__graph-placeholder">正在加载 Graphy...</p>`);
  void loadWorkspacePageGraph(root, container, nodeId, signal);
}

export function disposeWorkspacePageGraph(root: HTMLElement): void {
  mountedWorkspaceGraphs.get(root)?.kill();
  mountedWorkspaceGraphs.delete(root);
}

async function loadWorkspacePageGraph(
  root: HTMLElement,
  container: HTMLElement,
  nodeId: string,
  signal: AbortSignal,
): Promise<void> {
  let relationState: WorkspaceRelationState | null | undefined;
  try {
    const [graphResponse, relationResponse] = await Promise.all([
      fetch(`/api/workspace/graph?nodeId=${encodeURIComponent(nodeId)}`, { signal }),
      fetch(`/api/workspace/relations?nodeId=${encodeURIComponent(nodeId)}`, { signal }),
    ]);
    const payload = (await graphResponse.json()) as WorkspaceGraphApiResponse;
    const relationPayload = (await relationResponse.json()) as WorkspaceRelationApiResponse;
    if (signal.aborted) return;
    const graph = payload.success === false ? null : payload.data;
    relationState = relationPayload.success === false ? null : relationPayload.data;
    if (!isWorkspaceGraphPayload(graph) || graph.nodes.length < 2 || graph.edges.length === 0) {
      renderWorkspaceGraphEmpty(root, container, nodeId, relationState, signal);
      return;
    }
    await renderSigmaWorkspaceGraph(root, container, graph, nodeId, relationState, signal);
  } catch {
    if (!signal.aborted) {
      renderWorkspaceGraphEmpty(root, container, nodeId, relationState, signal);
    }
  }
}

async function renderSigmaWorkspaceGraph(
  root: HTMLElement,
  container: HTMLElement,
  payload: WorkspaceGraphPayload,
  nodeId: string,
  relationState: WorkspaceRelationState | null | undefined,
  signal: AbortSignal,
): Promise<void> {
  const [{ default: GraphCtor }, { default: SigmaCtor }] = await Promise.all([
    import("graphology"),
    import("sigma"),
  ]);
  if (signal.aborted) return;

  const graph = createWorkspaceGraph(GraphCtor, payload, nodeId);
  container.innerHTML = renderWorkspaceGraphShell(`
    <div class="wiki-page__graph-stage" data-workspace-page-graph-stage></div>
    <div class="wiki-page__graph-meta">${payload.nodes.length - 1} 个相关对象 · ${payload.edges.length} 条双链</div>
    ${renderWorkspaceRelationPanel(nodeId, relationState)}
  `);
  bindWorkspaceRelationEvents(root, container, nodeId, signal);
  const stage = container.querySelector<HTMLElement>("[data-workspace-page-graph-stage]");
  if (!stage) return;

  await waitForGraphStageSize(stage, signal);
  if (signal.aborted) return;
  const renderer = new SigmaCtor(graph, stage, WORKSPACE_GRAPH_SETTINGS);
  mountedWorkspaceGraphs.set(root, { kill: () => renderer.kill() });
}

function createWorkspaceGraph(
  GraphCtor: typeof Graph,
  payload: WorkspaceGraphPayload,
  nodeId: string,
): Graph<WorkspaceGraphNodeAttributes, WorkspaceGraphEdgeAttributes> {
  const graph = new GraphCtor<WorkspaceGraphNodeAttributes, WorkspaceGraphEdgeAttributes>({ type: "undirected" });
  const positions = workspaceGraphPositions(payload.nodes, nodeId);
  for (const node of payload.nodes) {
    graph.addNode(node.id, toNodeAttributes(node, positions.get(node.id), node.id === nodeId));
  }
  for (const edge of payload.edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.addUndirectedEdgeWithKey(edge.id, edge.source, edge.target, toEdgeAttributes(edge));
    }
  }
  return graph;
}

function workspaceGraphPositions(
  nodes: readonly WorkspaceGraphNode[],
  nodeId: string,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(nodeId, { x: 0, y: 0 });
  nodes.filter((node) => node.id !== nodeId).forEach((node, index) => {
    const ring = Math.floor(index / WORKSPACE_GRAPH_RING_SIZE);
    const ringStart = ring * WORKSPACE_GRAPH_RING_SIZE;
    const ringCount = Math.min(WORKSPACE_GRAPH_RING_SIZE, nodes.length - 1 - ringStart);
    const angle = -Math.PI / 2 + (Math.PI * 2 * (index - ringStart)) / Math.max(1, ringCount);
    const radius = 1.8 + ring * 0.72;
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return positions;
}

function toNodeAttributes(
  node: WorkspaceGraphNode,
  position: { x: number; y: number } | undefined,
  isCurrentPage: boolean,
): WorkspaceGraphNodeAttributes {
  return {
    label: node.label,
    path: node.path,
    nodeType: node.type,
    x: position?.x ?? 0,
    y: position?.y ?? 0,
    size: isCurrentPage ? 11 : Math.max(4, Math.min(8, node.size)),
    color: isCurrentPage ? "#111827" : node.color,
  };
}

function toEdgeAttributes(edge: WorkspaceGraphEdge): WorkspaceGraphEdgeAttributes {
  return {
    label: edge.label,
    weight: edge.weight,
    size: Math.max(0.7, Math.min(2.4, Math.sqrt(edge.weight) * 0.65)),
    color: "rgba(51, 65, 85, 0.48)",
  };
}

function renderWorkspaceGraphShell(body: string): string {
  return `
    <article class="wiki-page__graph-card">
      <div class="wiki-page__graph-header">
        <h2>Graphy</h2>
      </div>
      <div class="wiki-page__graph-body">${body}</div>
    </article>
  `;
}

function renderWorkspaceGraphEmpty(
  root: HTMLElement,
  container: HTMLElement,
  nodeId: string,
  relationState: WorkspaceRelationState | null | undefined,
  signal: AbortSignal,
): void {
  container.innerHTML = renderWorkspaceGraphShell(
    `<p class="wiki-page__graph-placeholder">当前工作对象还没有可展示的双链关系。</p>
    ${renderWorkspaceRelationPanel(nodeId, relationState)}`,
  );
  bindWorkspaceRelationEvents(root, container, nodeId, signal);
}

function isWorkspaceGraphPayload(value: WorkspaceGraphPayload | null | undefined): value is WorkspaceGraphPayload {
  return Array.isArray(value?.nodes) && Array.isArray(value?.edges);
}

function renderWorkspaceRelationPanel(
  nodeId: string,
  state: WorkspaceRelationState | null | undefined,
): string {
  const relations = state?.relations ?? [];
  const candidates = state?.candidates ?? [];
  const types = state?.types ?? [];
  return `
    <section class="workspace-graph-relations" data-workspace-relations>
      <div class="workspace-graph-relations__header">
        <strong>双链</strong>
        <span>${relations.length} 条</span>
      </div>
      <div class="workspace-graph-relations__list">
        ${relations.length > 0 ? relations.map((relation) => renderWorkspaceRelation(nodeId, relation)).join("") : `
          <p class="workspace-graph-relations__empty">暂无手动双链。</p>
        `}
      </div>
      <div class="workspace-graph-relations__editor">
        <select data-workspace-relation-type aria-label="关系类型">
          ${types.map((type) => `<option value="${escapeHtml(type.value)}">${escapeHtml(type.label)}</option>`).join("")}
        </select>
        <select data-workspace-relation-target aria-label="关联对象">
          ${candidates.map((candidate) => `
            <option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.label)} · ${escapeHtml(candidate.type)}</option>
          `).join("")}
        </select>
        <button type="button" data-workspace-relation-add ${candidates.length === 0 ? "disabled" : ""}>添加</button>
      </div>
    </section>
  `;
}

function renderWorkspaceRelation(nodeId: string, relation: WorkspaceRelationView): string {
  const sourceIsCurrent = relation.source.id === nodeId;
  const counterpart = sourceIsCurrent ? relation.target : relation.source;
  const direction = sourceIsCurrent ? "正向" : "反向";
  return `
    <div class="workspace-graph-relations__item">
      <div>
        <span>${escapeHtml(direction)} · ${escapeHtml(relation.typeLabel)}</span>
        <strong>${escapeHtml(counterpart.label)}</strong>
      </div>
      <button
        type="button"
        data-workspace-relation-delete="${escapeHtml(relation.id)}"
        aria-label="删除双链"
      >×</button>
    </div>
  `;
}

function bindWorkspaceRelationEvents(
  root: HTMLElement,
  container: HTMLElement,
  nodeId: string,
  signal: AbortSignal,
): void {
  container.querySelector<HTMLButtonElement>("[data-workspace-relation-add]")?.addEventListener("click", () => {
    const target = container.querySelector<HTMLSelectElement>("[data-workspace-relation-target]")?.value ?? "";
    const type = container.querySelector<HTMLSelectElement>("[data-workspace-relation-type]")?.value ?? "";
    if (target && type) {
      void saveWorkspaceRelation(root, container, nodeId, signal, { sourceId: nodeId, targetId: target, type });
    }
  });
  container.querySelectorAll<HTMLButtonElement>("[data-workspace-relation-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const relationId = button.dataset.workspaceRelationDelete ?? "";
      if (relationId) {
        void deleteWorkspaceRelation(root, container, nodeId, signal, relationId);
      }
    });
  });
}

async function saveWorkspaceRelation(
  root: HTMLElement,
  container: HTMLElement,
  nodeId: string,
  signal: AbortSignal,
  payload: { sourceId: string; targetId: string; type: string },
): Promise<void> {
  await fetch("/api/workspace/relations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  await reloadWorkspaceGraph(root, container, nodeId, signal);
}

async function deleteWorkspaceRelation(
  root: HTMLElement,
  container: HTMLElement,
  nodeId: string,
  signal: AbortSignal,
  relationId: string,
): Promise<void> {
  await fetch(`/api/workspace/relations/${encodeURIComponent(relationId)}`, { method: "DELETE", signal });
  await reloadWorkspaceGraph(root, container, nodeId, signal);
}

async function reloadWorkspaceGraph(
  root: HTMLElement,
  container: HTMLElement,
  nodeId: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  disposeWorkspacePageGraph(root);
  await loadWorkspacePageGraph(root, container, nodeId, signal);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

const WORKSPACE_GRAPH_SETTINGS: Partial<Settings<WorkspaceGraphNodeAttributes, WorkspaceGraphEdgeAttributes>> = {
  renderEdgeLabels: false,
  defaultEdgeColor: "#64748b",
  defaultNodeColor: "#94a3b8",
  labelDensity: 1,
  labelRenderedSizeThreshold: 0,
  labelSize: 13,
  labelWeight: "bold",
  stagePadding: 44,
};
