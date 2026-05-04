/**
 * Layout interactions for the project workspace page.
 *
 * This module owns node highlighting and the two-pane split handle, keeping
 * rendering code focused on HTML generation.
 */
const PROJECT_WORKSPACE_SPLIT_KEY = "workspace.projectWorkspaceSplit";
const DEFAULT_SPLIT_RATIO = 0.58;
const MIN_SPLIT_RATIO = 0.34;
const MAX_SPLIT_RATIO = 0.76;

export function readInitialProjectWorkspaceSplitRatio(): string {
  if (typeof window === "undefined") {
    return String(DEFAULT_SPLIT_RATIO);
  }
  const storedValue = Number(window.localStorage.getItem(PROJECT_WORKSPACE_SPLIT_KEY));
  return String(clampSplitRatio(storedValue || DEFAULT_SPLIT_RATIO));
}

export function mountProjectWorkspaceHighlighting(page: HTMLElement): void {
  page.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const windowButton = target.closest<HTMLElement>("[data-project-window-task]");
    const nodeButton = target.closest<HTMLElement>("[data-project-node-id]");
    const nodeId = windowButton?.dataset.projectWindowTask ?? nodeButton?.dataset.projectNodeId;
    if (nodeId) highlightNode(page, nodeId);
  });
}

export function mountProjectWorkspaceSplit(page: HTMLElement): void {
  const handle = page.querySelector<HTMLElement>("[data-project-workspace-split]");
  const layout = page.querySelector<HTMLElement>("[data-project-workspace-layout]");
  if (handle && layout) {
    handle.addEventListener("mousedown", (event) => startSplitDrag(event, layout));
  }
}

function startSplitDrag(event: MouseEvent, layout: HTMLElement): void {
  event.preventDefault();
  const onMouseMove = (moveEvent: MouseEvent): void => updateSplitRatio(layout, moveEvent.clientX);
  const onMouseUp = (): void => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

function updateSplitRatio(layout: HTMLElement, clientX: number): void {
  const rect = layout.getBoundingClientRect();
  const ratio = Number(clampSplitRatio((clientX - rect.left) / rect.width).toFixed(2));
  layout.style.setProperty("--project-workspace-left-ratio", String(ratio));
  window.localStorage.setItem(PROJECT_WORKSPACE_SPLIT_KEY, String(ratio));
}

function highlightNode(page: HTMLElement, nodeId: string): void {
  page.querySelectorAll(".is-highlighted").forEach((element) => element.classList.remove("is-highlighted"));
  page.querySelector(`[data-project-node-id="${cssEscape(nodeId)}"]`)?.classList.add("is-highlighted");
  page.querySelectorAll<HTMLElement>("[data-project-workspace-link]").forEach((link) => {
    link.classList.toggle("is-highlighted", link.dataset.linkFrom === nodeId || link.dataset.linkTo === nodeId);
  });
}

function clampSplitRatio(value: number): number {
  const safeValue = Number.isFinite(value) ? value : DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, safeValue));
}

function cssEscape(value: string): string {
  const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
  if (typeof css?.escape === "function") return css.escape(value);
  return value.replace(/["\\\]\[]/g, "\\$&");
}
