/**
 * Drag-and-drop runtime for the project workspace graph.
 *
 * Tasks can be reordered, moved between phase columns, or dropped onto the
 * daily window list. Persistence stays in the workspace shell through callbacks.
 */
export interface ProjectWorkspaceDragHandlers {
  readonly onTaskOrderChange?: (orderedTaskIds: readonly string[]) => void;
  readonly onHierarchyMove?: (move: ProjectWorkspaceHierarchyMove) => void;
  readonly onScheduleTask?: (taskId: string) => void;
  readonly onCreateNode?: (request: ProjectWorkspaceCreateRequest) => void;
}

export interface ProjectWorkspaceHierarchyMove {
  readonly source: ProjectWorkspaceDragNode;
  readonly target: ProjectWorkspaceDragNode;
  readonly orderedTaskIds: readonly string[];
}

export interface ProjectWorkspaceDragNode {
  readonly kind: ProjectWorkspaceDragKind;
  readonly nodeId: string;
  readonly domain: string;
  readonly project: string;
  readonly stageId: string;
  readonly taskId: string;
  readonly actionId: string;
  readonly taskIds: readonly string[];
}

interface ProjectWorkspacePointerDragState {
  readonly page: HTMLElement;
  readonly source: ProjectWorkspaceDragNode;
  readonly sourceElement: HTMLElement;
  readonly handlers: ProjectWorkspaceDragHandlers;
  readonly startX: number;
  readonly startY: number;
  isDragging: boolean;
}

export interface ProjectWorkspaceCreateRequest {
  readonly mode: "child" | "sibling";
  readonly node: ProjectWorkspaceDragNode;
}

type ProjectWorkspaceDragKind = "domain" | "project" | "stage" | "task" | "action";

const TASK_MIME = "application/x-project-workspace-task";
const NODE_MIME = "application/x-project-workspace-node";
const DRAG_KINDS = new Set(["domain", "project", "stage", "task", "action"]);
const POINTER_DRAG_THRESHOLD = 4;

export function mountProjectWorkspaceDrag(page: HTMLElement, handlers: ProjectWorkspaceDragHandlers): void {
  page.querySelectorAll<HTMLElement>("[data-project-drag-kind]").forEach((node) => {
    node.addEventListener("mousedown", (event) => startPointerDrag(event, page, node, handlers));
    node.addEventListener("dragstart", (event) => startNodeDrag(event, node));
    node.addEventListener("dragend", () => clearDragState(page, node));
    node.addEventListener("dragover", (event) => previewGraphDrop(event, page, node));
    node.addEventListener("dragleave", () => node.classList.remove("is-drop-preview"));
    node.addEventListener("drop", (event) => dropOnGraphNode(event, page, node, handlers));
  });
  page.querySelectorAll<HTMLElement>("[data-project-stage-drop-node]").forEach((phase) => {
    phase.addEventListener("dragover", (event) => previewPhaseDrop(event, page, phase));
    phase.addEventListener("dragleave", () => phase.classList.remove("is-drop-preview"));
    phase.addEventListener("drop", (event) => dropOnPhase(event, page, phase, handlers));
  });
  const windowList = page.querySelector<HTMLElement>("[data-project-workspace-window-list]");
  if (!windowList) return;
  windowList.addEventListener("dragover", (event) => {
    if (readDraggedTaskId(event)) event.preventDefault();
  });
  windowList.addEventListener("drop", (event) => dropOnWindowList(event, handlers));
}

function startPointerDrag(
  event: MouseEvent,
  page: HTMLElement,
  node: HTMLElement,
  handlers: ProjectWorkspaceDragHandlers,
): void {
  if (event.button !== 0) return;
  const source = readGraphNode(node);
  if (!source || !canStartPointerDrag(source)) return;
  const state: ProjectWorkspacePointerDragState = {
    page,
    source,
    sourceElement: node,
    handlers,
    startX: event.clientX,
    startY: event.clientY,
    isDragging: false,
  };
  const onMouseMove = (moveEvent: MouseEvent): void => updatePointerDrag(state, moveEvent);
  const onMouseUp = (upEvent: MouseEvent): void => finishPointerDrag(state, upEvent, onMouseMove, onMouseUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

function startNodeDrag(event: DragEvent, node: HTMLElement): void {
  const payload = readGraphNode(node);
  if (!payload) return;
  event.dataTransfer?.setData(NODE_MIME, JSON.stringify(payload));
  if (payload.taskId) {
    event.dataTransfer?.setData(TASK_MIME, payload.taskId);
    event.dataTransfer?.setData("text/plain", payload.taskId);
  }
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  node.classList.add("is-dragging");
}

function dropOnGraphNode(
  event: DragEvent,
  page: HTMLElement,
  target: HTMLElement,
  handlers: ProjectWorkspaceDragHandlers,
): void {
  event.preventDefault();
  event.stopPropagation();
  clearDropPreview(page);
  const source = readDraggedNode(event);
  const targetNode = readGraphNode(target);
  if (!source || !targetNode || isSameGraphNode(source, targetNode)) return;
  moveGraphNode(page, source, targetNode, handlers);
}

function dropOnPhase(
  event: DragEvent,
  page: HTMLElement,
  phase: HTMLElement,
  handlers: ProjectWorkspaceDragHandlers,
): void {
  event.preventDefault();
  event.stopPropagation();
  clearDropPreview(page);
  const source = readDraggedNode(event);
  const target = readPhaseDropNode(phase);
  if (!source || !target || !canDropTaskOnPhase(source, target)) return;
  movePhaseNode(page, source, target, handlers);
}

function dropOnWindowList(event: DragEvent, handlers: ProjectWorkspaceDragHandlers): void {
  event.preventDefault();
  const taskId = readDraggedTaskId(event);
  if (taskId) handlers.onScheduleTask?.(taskId);
}

function updatePointerDrag(state: ProjectWorkspacePointerDragState, event: MouseEvent): void {
  if (!state.isDragging && !hasPointerDragStarted(state, event)) return;
  event.preventDefault();
  state.isDragging = true;
  state.sourceElement.classList.add("is-dragging");
  previewPointerDrop(state, event);
}

function finishPointerDrag(
  state: ProjectWorkspacePointerDragState,
  event: MouseEvent,
  onMouseMove: (event: MouseEvent) => void,
  onMouseUp: (event: MouseEvent) => void,
): void {
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
  state.sourceElement.classList.remove("is-dragging");
  clearDropPreview(state.page);
  if (!state.isDragging) return;
  event.preventDefault();
  suppressNextClick();
  dropPointerTarget(state, event);
}

function readDraggedTaskId(event: DragEvent): string {
  return event.dataTransfer?.getData(TASK_MIME) || event.dataTransfer?.getData("text/plain") || "";
}

function readDraggedNode(event: DragEvent): ProjectWorkspaceDragNode | null {
  const rawValue = event.dataTransfer?.getData(NODE_MIME);
  if (!rawValue) return null;
  const parsed = JSON.parse(rawValue) as ProjectWorkspaceDragNode;
  return parsed.nodeId ? parsed : null;
}

function readGraphNode(node: HTMLElement): ProjectWorkspaceDragNode | null {
  const kind = readDragKind(node);
  if (!kind) return null;
  return {
    kind,
    nodeId: node.dataset.projectNodeId ?? "",
    domain: node.dataset.projectDomainLabel ?? "",
    project: node.dataset.projectProjectLabel ?? "",
    stageId: node.dataset.projectStageNode ?? "",
    taskId: node.dataset.projectTaskNode ?? node.dataset.projectParentTaskNode ?? "",
    actionId: node.dataset.projectActionNode ?? "",
    taskIds: readNodeTaskIds(node),
  };
}

function readPhaseDropNode(phase: HTMLElement): ProjectWorkspaceDragNode | null {
  const stageId = phase.dataset.projectStageDropNode ?? "";
  if (!stageId) return null;
  return {
    kind: "stage",
    nodeId: stageId,
    domain: phase.dataset.projectDomainLabel ?? "",
    project: phase.dataset.projectProjectLabel ?? "",
    stageId,
    taskId: "",
    actionId: "",
    taskIds: readTaskIds(phase),
  };
}

function readDragKind(node: HTMLElement): ProjectWorkspaceDragKind | null {
  const kind = node.dataset.projectDragKind;
  return kind && DRAG_KINDS.has(kind) ? kind as ProjectWorkspaceDragKind : null;
}

function readNodeTaskIds(node: HTMLElement): string[] {
  if (node.dataset.projectActionNode) return [];
  if (node.dataset.projectTaskNode) return [node.dataset.projectTaskNode];
  if (node.dataset.projectStageNode) {
    const phase = node.closest<HTMLElement>("[data-project-workspace-phase]");
    return readTaskIds(phase ?? node);
  }
  const group = node.closest<HTMLElement>("[data-project-collapse-group]");
  return Array.from(group?.querySelectorAll<HTMLElement>("[data-project-task-node]") ?? [])
    .map((task) => task.dataset.projectTaskNode ?? "")
    .filter(Boolean);
}

function readTaskIds(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll<HTMLElement>("[data-project-task-node]"))
    .map((node) => node.dataset.projectTaskNode ?? "")
    .filter(Boolean);
}

function reorderTaskIds(ids: readonly string[], draggedIds: readonly string[], targetId: string): string[] {
  const dragged = new Set(draggedIds);
  const nextIds = ids.filter((id) => !dragged.has(id));
  const targetIndex = nextIds.indexOf(targetId);
  if (targetIndex < 0) return [...ids];
  nextIds.splice(targetIndex, 0, ...draggedIds);
  return nextIds;
}

function reorderTaskIdsAfterTargetGroup(
  ids: readonly string[],
  draggedIds: readonly string[],
  targetIds: readonly string[],
): string[] {
  const dragged = new Set(draggedIds);
  const nextIds = ids.filter((id) => !dragged.has(id));
  const targetIndexes = targetIds.map((id) => nextIds.indexOf(id)).filter((index) => index >= 0);
  const insertAt = targetIndexes.length > 0 ? Math.max(...targetIndexes) + 1 : nextIds.length;
  nextIds.splice(insertAt, 0, ...draggedIds);
  return nextIds;
}

function moveGraphNode(
  page: HTMLElement,
  source: ProjectWorkspaceDragNode,
  target: ProjectWorkspaceDragNode,
  handlers: ProjectWorkspaceDragHandlers,
): void {
  const orderedTaskIds = reorderTaskIds(readTaskIds(page), source.taskIds, target.taskIds[0] ?? "");
  if (handlers.onHierarchyMove) {
    handlers.onHierarchyMove({ source, target, orderedTaskIds });
  } else if (source.kind === "task" && target.kind === "task") {
    handlers.onTaskOrderChange?.(orderedTaskIds);
  }
}

function movePhaseNode(
  page: HTMLElement,
  source: ProjectWorkspaceDragNode,
  target: ProjectWorkspaceDragNode,
  handlers: ProjectWorkspaceDragHandlers,
): void {
  handlers.onHierarchyMove?.({
    source,
    target,
    orderedTaskIds: reorderTaskIdsAfterTargetGroup(readTaskIds(page), source.taskIds, target.taskIds),
  });
}

function isSameGraphNode(source: ProjectWorkspaceDragNode, target: ProjectWorkspaceDragNode): boolean {
  return source.nodeId === target.nodeId || source.taskIds.includes(target.taskIds[0] ?? "");
}

function previewGraphDrop(event: DragEvent, page: HTMLElement, node: HTMLElement): void {
  if (!readDraggedNode(event)) return;
  event.preventDefault();
  event.stopPropagation();
  clearDropPreview(page);
  node.classList.add("is-drop-preview");
}

function previewPhaseDrop(event: DragEvent, page: HTMLElement, phase: HTMLElement): void {
  const source = readDraggedNode(event);
  const target = readPhaseDropNode(phase);
  if (!source || !target || !canDropTaskOnPhase(source, target)) return;
  event.preventDefault();
  clearDropPreview(page);
  phase.classList.add("is-drop-preview");
}

function previewPointerDrop(state: ProjectWorkspacePointerDragState, event: MouseEvent): void {
  const target = readPointerTarget(event);
  clearDropPreview(state.page);
  if (target.node && !isSameGraphNode(state.source, target.node)) {
    target.element?.classList.add("is-drop-preview");
    return;
  }
  if (target.phase && canDropTaskOnPhase(state.source, target.phase)) {
    target.element?.classList.add("is-drop-preview");
  }
}

function dropPointerTarget(state: ProjectWorkspacePointerDragState, event: MouseEvent): void {
  const target = readPointerTarget(event);
  if (target.windowList && state.source.taskId) {
    state.handlers.onScheduleTask?.(state.source.taskId);
    return;
  }
  if (target.node && !isSameGraphNode(state.source, target.node)) {
    moveGraphNode(state.page, state.source, target.node, state.handlers);
    return;
  }
  if (target.phase && canDropTaskOnPhase(state.source, target.phase)) {
    movePhaseNode(state.page, state.source, target.phase, state.handlers);
  }
}

function readPointerTarget(event: MouseEvent): {
  readonly element: HTMLElement | null;
  readonly node: ProjectWorkspaceDragNode | null;
  readonly phase: ProjectWorkspaceDragNode | null;
  readonly windowList: HTMLElement | null;
} {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!(element instanceof HTMLElement)) return { element: null, node: null, phase: null, windowList: null };
  const nodeElement = element.closest<HTMLElement>("[data-project-drag-kind]");
  const phaseElement = element.closest<HTMLElement>("[data-project-stage-drop-node]");
  return {
    element: nodeElement ?? phaseElement,
    node: nodeElement ? readGraphNode(nodeElement) : null,
    phase: phaseElement ? readPhaseDropNode(phaseElement) : null,
    windowList: element.closest<HTMLElement>("[data-project-workspace-window-list]"),
  };
}

function canDropTaskOnPhase(source: ProjectWorkspaceDragNode, target: ProjectWorkspaceDragNode): boolean {
  if (source.kind !== "task") return false;
  return source.stageId !== target.stageId || source.domain !== target.domain || source.project !== target.project;
}

function canStartPointerDrag(source: ProjectWorkspaceDragNode): boolean {
  return source.taskIds.length > 0 || source.kind === "action";
}

function hasPointerDragStarted(state: ProjectWorkspacePointerDragState, event: MouseEvent): boolean {
  return Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= POINTER_DRAG_THRESHOLD;
}

function suppressNextClick(): void {
  document.addEventListener("click", stopSuppressedClick, { capture: true, once: true });
  window.setTimeout(() => document.removeEventListener("click", stopSuppressedClick, true), 0);
}

function stopSuppressedClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function clearDragState(page: HTMLElement, node: HTMLElement): void {
  node.classList.remove("is-dragging");
  clearDropPreview(page);
}

function clearDropPreview(page: HTMLElement): void {
  page.querySelectorAll<HTMLElement>(".is-drop-preview").forEach((node) => node.classList.remove("is-drop-preview"));
}

export function readProjectWorkspaceGraphNode(node: HTMLElement): ProjectWorkspaceDragNode | null {
  return readGraphNode(node);
}
