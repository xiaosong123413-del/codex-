/**
 * Delete controls for project workspace task and action cards.
 *
 * The renderer keeps graph nodes as draggable buttons. This module adds a small
 * in-card control after render and routes deletion back to the workspace shell.
 */
import { readProjectWorkspaceGraphNode, type ProjectWorkspaceDragNode } from "./project-workspace-dnd.js";

export interface ProjectWorkspaceDeleteHandlers {
  readonly onDeleteNode?: (node: ProjectWorkspaceDragNode) => void;
}

const DELETE_SELECTOR = "[data-project-node-delete]";
const DELETABLE_NODE_SELECTOR = "[data-project-drag-kind='task'], [data-project-drag-kind='action']";

/**
 * Mounts delete affordances for rendered task and action nodes.
 */
export function mountProjectWorkspaceDelete(page: HTMLElement, handlers: ProjectWorkspaceDeleteHandlers): void {
  page.querySelectorAll<HTMLElement>(DELETABLE_NODE_SELECTOR).forEach(ensureDeleteControl);
  page.addEventListener("mousedown", stopDeletePointerStart, true);
  page.addEventListener("click", (event) => handleDeleteClick(event, page, handlers), true);
  page.addEventListener("keydown", (event) => handleDeleteKey(event, page, handlers), true);
}

function ensureDeleteControl(node: HTMLElement): void {
  const frame = ensureDeleteFrame(node);
  if (frame.querySelector(DELETE_SELECTOR)) return;
  const control = document.createElement("button");
  control.type = "button";
  control.className = "project-workspace-node__delete";
  control.dataset.projectNodeDelete = "true";
  control.setAttribute("aria-label", node.dataset.projectDragKind === "action" ? "删除行动" : "删除任务");
  control.textContent = "x";
  node.classList.add("project-workspace-node--deletable");
  frame.append(control);
}

function ensureDeleteFrame(node: HTMLElement): HTMLElement {
  const parent = node.parentElement;
  if (parent?.classList.contains("project-workspace-node-frame")) return parent;
  const frame = document.createElement("div");
  frame.className = "project-workspace-node-frame";
  node.before(frame);
  frame.append(node);
  return frame;
}

function stopDeletePointerStart(event: MouseEvent): void {
  if (readDeleteControl(event.target)) event.stopPropagation();
}

function handleDeleteClick(
  event: MouseEvent,
  page: HTMLElement,
  handlers: ProjectWorkspaceDeleteHandlers,
): void {
  const node = readDeleteNode(event.target, page);
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  handlers.onDeleteNode?.(node);
}

function handleDeleteKey(
  event: KeyboardEvent,
  page: HTMLElement,
  handlers: ProjectWorkspaceDeleteHandlers,
): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  const node = readDeleteNode(event.target, page);
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  handlers.onDeleteNode?.(node);
}

function readDeleteNode(target: EventTarget | null, page: HTMLElement): ProjectWorkspaceDragNode | null {
  const control = readDeleteControl(target);
  if (!control || !page.contains(control)) return null;
  const frame = control.closest<HTMLElement>(".project-workspace-node-frame");
  const node = frame?.querySelector<HTMLElement>("[data-project-drag-kind]");
  return node ? readProjectWorkspaceGraphNode(node) : null;
}

function readDeleteControl(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(DELETE_SELECTOR) : null;
}
