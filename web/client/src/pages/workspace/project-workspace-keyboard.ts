/**
 * Keyboard creation shortcuts for the project workspace graph.
 * Enter creates a sibling node; Tab creates the next lower level.
 */
import {
  readProjectWorkspaceGraphNode,
  type ProjectWorkspaceCreateRequest,
  type ProjectWorkspaceDragHandlers,
} from "./project-workspace-dnd.js";

export function mountProjectWorkspaceKeyboard(page: HTMLElement, handlers: ProjectWorkspaceDragHandlers): void {
  page.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const node = target.closest<HTMLElement>("[data-project-drag-kind]");
    if (!node || !page.contains(node)) return;
    const request = readCreateRequest(event, node);
    if (!request) return;
    event.preventDefault();
    handlers.onCreateNode?.(request);
  });
}

function readCreateRequest(event: KeyboardEvent, node: HTMLElement): ProjectWorkspaceCreateRequest | null {
  const graphNode = readProjectWorkspaceGraphNode(node);
  if (!graphNode) return null;
  if (event.key === "Tab" && !event.shiftKey) return { mode: "child", node: graphNode };
  if (event.key === "Enter") return { mode: "sibling", node: graphNode };
  return null;
}
