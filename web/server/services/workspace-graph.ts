/**
 * Workspace Graphy graph builder.
 *
 * Work-log pages do not participate in the compiled wiki graph, so this
 * service derives a separate graph from workspace objects: sections, projects,
 * task pages, case records, methods, and toolbox records.
 */
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { ensureWorkspaceDocScaffold, listWorkspaceDocSummaries, type WorkspaceDocRecord } from "../routes/pages.js";
import { readTaskPlanState, type TaskPlanPoolItem } from "./task-plan-store.js";
import { readWorkspaceRelations, workspaceRelationTypeLabel } from "./workspace-relations.js";

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

type WorkspaceLinkField = "linkedCases" | "linkedMethods" | "linkedResources" | "sourceRefs";

const PROJECT_WORKSPACE_SECTION = "01-项目工作区";
const ROOT_NODE_ID = "root";

const NODE_COLORS: Record<string, string> = {
  root: "#334155",
  domain: "#2563eb",
  project: "#d97706",
  task: "#16a34a",
  action: "#0f766e",
  case: "#e11d48",
  method: "#7c3aed",
  tool: "#0891b2",
  "work-log": "#475569",
};

const TASK_LINK_RELATIONS: Array<{ field: WorkspaceLinkField; project: string; label: string }> = [
  { field: "linkedCases", project: "案例库", label: "关联案例" },
  { field: "linkedMethods", project: "方法库", label: "使用方法" },
  { field: "linkedResources", project: "工具箱", label: "关联资源" },
  { field: "sourceRefs", project: "", label: "引用来源" },
];

export async function buildWorkspaceGraphForNode(
  cfg: ServerConfig,
  nodeId: string,
): Promise<WorkspaceGraphPayload> {
  ensureWorkspaceDocScaffold(cfg.sourceVaultRoot);
  const documents = await listWorkspaceDocSummaries(cfg);
  const nodes = documents.map(toGraphNode);
  const edges = [
    ...buildHierarchyEdges(documents),
    ...await buildTaskRelationEdges(cfg, documents),
    ...buildStoredRelationEdges(documents, await readWorkspaceRelations(cfg)),
  ];
  return filterWorkspaceGraph(nodes, dedupeEdges(edges), nodeId);
}

function toGraphNode(document: WorkspaceDocRecord): WorkspaceGraphNode {
  const type = readNodeType(document);
  return {
    id: document.id,
    label: document.title ?? document.label,
    path: document.path,
    type,
    size: document.kind === "work-log" ? 7 : 9,
    color: NODE_COLORS[type] ?? NODE_COLORS["work-log"],
  };
}

function readNodeType(document: WorkspaceDocRecord): string {
  if (document.gallery?.type) {
    return document.gallery.type;
  }
  if (readActionParentTaskId(document.id)) {
    return "action";
  }
  if (document.kind === "work-log" && document.domain === PROJECT_WORKSPACE_SECTION) {
    return document.path.includes("/tasks/") ? "task" : "work-log";
  }
  if (document.kind === "work-log" && document.project === "案例库") {
    return "case";
  }
  return document.kind;
}

function buildHierarchyEdges(documents: readonly WorkspaceDocRecord[]): WorkspaceGraphEdge[] {
  const edges: WorkspaceGraphEdge[] = [];
  const projectByKey = new Map<string, WorkspaceDocRecord>();
  const domainByLabel = new Map<string, WorkspaceDocRecord>();
  for (const document of documents) {
    if (document.kind === "domain") {
      domainByLabel.set(document.label, document);
    }
    if (document.kind === "project" && document.domain && document.project) {
      projectByKey.set(workspaceProjectKey(document.domain, document.project), document);
    }
  }
  for (const document of documents) {
    addStructuralEdge(edges, document, domainByLabel, projectByKey);
  }
  return edges;
}

function addStructuralEdge(
  edges: WorkspaceGraphEdge[],
  document: WorkspaceDocRecord,
  domainByLabel: ReadonlyMap<string, WorkspaceDocRecord>,
  projectByKey: ReadonlyMap<string, WorkspaceDocRecord>,
): void {
  if (document.kind === "domain") {
    addDomainStructuralEdge(edges, document);
    return;
  }
  if (document.kind === "project") {
    addProjectStructuralEdge(edges, document, domainByLabel);
    return;
  }
  if (document.kind === "work-log") {
    addWorkLogStructuralEdge(edges, document, projectByKey);
  }
}

function addDomainStructuralEdge(edges: WorkspaceGraphEdge[], document: WorkspaceDocRecord): void {
  edges.push(graphEdge(ROOT_NODE_ID, document.id, "包含", 1));
}

function addProjectStructuralEdge(
  edges: WorkspaceGraphEdge[],
  document: WorkspaceDocRecord,
  domainByLabel: ReadonlyMap<string, WorkspaceDocRecord>,
): void {
  if (!document.domain) return;
  const domain = domainByLabel.get(document.domain);
  if (domain) edges.push(graphEdge(domain.id, document.id, "包含", 1.2));
}

function addWorkLogStructuralEdge(
  edges: WorkspaceGraphEdge[],
  document: WorkspaceDocRecord,
  projectByKey: ReadonlyMap<string, WorkspaceDocRecord>,
): void {
  if (!document.domain || !document.project) return;
  const parentTaskId = readActionParentTaskId(document.id);
  if (parentTaskId) {
    edges.push(graphEdge(parentTaskId, document.id, "行动", 1.6));
    return;
  }
  const project = projectByKey.get(workspaceProjectKey(document.domain, document.project));
  if (project) edges.push(graphEdge(project.id, document.id, "双链", 1.4));
}

function readActionParentTaskId(documentId: string): string | null {
  const match = /^work-log:01-项目工作区\/action\/([^/]+)\//u.exec(documentId);
  return match ? `work-log:${PROJECT_WORKSPACE_SECTION}/task/${match[1]}` : null;
}

async function buildTaskRelationEdges(
  cfg: ServerConfig,
  documents: readonly WorkspaceDocRecord[],
): Promise<WorkspaceGraphEdge[]> {
  const state = await readTaskPlanState({ storageRoot: path.join(cfg.sourceVaultRoot, "task plan") });
  const documentsByReference = buildDocumentReferenceMap(documents);
  return state.pool.items.flatMap((task) => taskRelationEdges(task, documentsByReference));
}

function taskRelationEdges(
  task: TaskPlanPoolItem,
  documentsByReference: ReadonlyMap<string, WorkspaceDocRecord>,
): WorkspaceGraphEdge[] {
  const taskNodeId = `work-log:${PROJECT_WORKSPACE_SECTION}/task/${task.id}`;
  if (!documentsByReference.has(normalizeReference(taskNodeId))) {
    return [];
  }
  return TASK_LINK_RELATIONS.flatMap((relation) =>
    (task[relation.field] ?? [])
      .map((reference) => resolveLinkedDocument(reference, relation.project, documentsByReference))
      .filter((document): document is WorkspaceDocRecord => Boolean(document))
      .map((document) => graphEdge(taskNodeId, document.id, relation.label, 2)),
  );
}

function buildDocumentReferenceMap(
  documents: readonly WorkspaceDocRecord[],
): Map<string, WorkspaceDocRecord> {
  const map = new Map<string, WorkspaceDocRecord>();
  for (const document of documents) {
    for (const key of documentReferenceKeys(document)) {
      map.set(key, document);
    }
  }
  return map;
}

function buildStoredRelationEdges(
  documents: readonly WorkspaceDocRecord[],
  relations: Awaited<ReturnType<typeof readWorkspaceRelations>>,
): WorkspaceGraphEdge[] {
  const nodeIds = new Set(documents.map((document) => document.id));
  return relations
    .filter((relation) => nodeIds.has(relation.sourceId) && nodeIds.has(relation.targetId))
    .map((relation) => graphEdge(
      relation.sourceId,
      relation.targetId,
      workspaceRelationTypeLabel(relation.type),
      2.4,
    ));
}

function documentReferenceKeys(document: WorkspaceDocRecord): string[] {
  const basename = document.path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? "";
  return [
    document.id,
    document.path,
    document.label,
    document.title ?? "",
    basename,
    safeDecodeURIComponent(basename),
  ].map(normalizeReference).filter(Boolean);
}

function resolveLinkedDocument(
  reference: string,
  project: string,
  documentsByReference: ReadonlyMap<string, WorkspaceDocRecord>,
): WorkspaceDocRecord | undefined {
  const exact = documentsByReference.get(normalizeReference(reference));
  if (exact && matchesLinkedProject(exact, project)) {
    return exact;
  }
  return Array.from(documentsByReference.values()).find((document) =>
    matchesLinkedProject(document, project)
      && documentReferenceKeys(document).includes(normalizeReference(reference)),
  );
}

function matchesLinkedProject(document: WorkspaceDocRecord, project: string): boolean {
  return !project
    || document.project === project
    || document.project?.startsWith(project)
    || (project === "案例库" && document.gallery?.type === "case");
}

function filterWorkspaceGraph(
  nodes: readonly WorkspaceGraphNode[],
  edges: readonly WorkspaceGraphEdge[],
  nodeId: string,
): WorkspaceGraphPayload {
  const selectedId = nodeId.trim() || ROOT_NODE_ID;
  const selected = nodes.find((node) => node.id === selectedId);
  if (!selected) {
    return { nodes: [], edges: [] };
  }
  const relatedEdges = edges.filter((edge) => edge.source === selectedId || edge.target === selectedId);
  const nodeIds = new Set<string>([selectedId]);
  for (const edge of relatedEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return {
    nodes: nodes.filter((node) => nodeIds.has(node.id)),
    edges: relatedEdges,
  };
}

function dedupeEdges(edges: readonly WorkspaceGraphEdge[]): WorkspaceGraphEdge[] {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}

function graphEdge(source: string, target: string, label: string, weight: number): WorkspaceGraphEdge {
  const [left, right] = source < target ? [source, target] : [target, source];
  return {
    id: `${left}::${right}::${label}`,
    source: left,
    target: right,
    weight,
    label,
  };
}

function workspaceProjectKey(domain: string, project: string): string {
  return `${domain}/${project}`;
}

function normalizeReference(value: string): string {
  return value
    .replace(/^#\/wiki\//u, "")
    .replace(/^wiki\//u, "wiki/")
    .replace(/\.md$/iu, "")
    .trim()
    .toLowerCase();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
