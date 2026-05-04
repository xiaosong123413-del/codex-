/**
 * Status filtering for the project workspace execution graph.
 *
 * Filtering only changes what is visible in the graph. The underlying pool
 * data, metrics, schedule sync, and drag persistence remain unchanged.
 */
const GRAPH_CHANGE_EVENT = "project-workspace:graph-change";
const DEFAULT_FILTER = "unfinished";

type ProjectWorkspaceFilter = "unfinished" | "all";

export function mountProjectWorkspaceFilter(page: HTMLElement): void {
  page.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-project-workspace-filter]");
    if (!button) return;
    applyProjectWorkspaceFilter(page, readFilter(button));
  });
  applyProjectWorkspaceFilter(page, DEFAULT_FILTER);
}

function applyProjectWorkspaceFilter(page: HTMLElement, filter: ProjectWorkspaceFilter): void {
  page.dataset.projectWorkspaceFilterMode = filter;
  for (const button of page.querySelectorAll<HTMLButtonElement>("[data-project-workspace-filter]")) {
    const isActive = button.dataset.projectWorkspaceFilter === filter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
  for (const item of page.querySelectorAll<HTMLElement>("[data-project-filter-scope]")) {
    item.hidden = filter === "unfinished" && item.dataset.projectLifecycle === "done";
  }
  page.dispatchEvent(new Event(GRAPH_CHANGE_EVENT));
}

function readFilter(button: HTMLButtonElement): ProjectWorkspaceFilter {
  return button.dataset.projectWorkspaceFilter === "all" ? "all" : "unfinished";
}
