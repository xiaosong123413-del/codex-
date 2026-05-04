/**
 * Branch collapse interaction for the project workspace execution graph.
 *
 * Collapse state is kept in the rendered DOM because it is a view preference:
 * the task hierarchy and schedule sync data remain unchanged.
 */
const GRAPH_CHANGE_EVENT = "project-workspace:graph-change";

export function mountProjectWorkspaceCollapse(page: HTMLElement): void {
  page.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest<HTMLElement>("[data-project-collapse-toggle]");
    if (!toggle || !page.contains(toggle)) return;
    const group = toggle.closest<HTMLElement>("[data-project-collapse-group]");
    if (!group) return;
    toggleCollapseGroup(page, group, toggle);
  });
}

function toggleCollapseGroup(page: HTMLElement, group: HTMLElement, toggle: HTMLElement): void {
  const target = readCollapseTarget(group);
  if (!target) return;
  const collapsed = toggle.getAttribute("aria-expanded") !== "false";
  group.classList.toggle("is-collapsed", collapsed);
  target.hidden = collapsed;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  page.dispatchEvent(new Event(GRAPH_CHANGE_EVENT));
}

function readCollapseTarget(group: HTMLElement): HTMLElement | null {
  return Array.from(group.children).find((child): child is HTMLElement =>
    child instanceof HTMLElement && child.hasAttribute("data-project-collapse-target")
  ) ?? null;
}
