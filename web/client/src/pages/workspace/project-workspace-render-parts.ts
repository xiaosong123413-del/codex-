/**
 * Shared rendering helpers for the project workspace page.
 *
 * These helpers keep the main page module focused on graph assembly and DOM
 * mounting while still using structural types so the data model can evolve in
 * the page module without a broad public API.
 */
type WorkspaceStatus = "blocked" | "progress" | "next" | "recorded";
type WorkspaceLifecycle = "done" | "active" | "uncertain";

interface WorkspaceLink {
  readonly from: string;
  readonly to: string;
  readonly status: WorkspaceStatus;
}

interface WorkspaceWindow {
  readonly label: string;
  readonly title: string;
  readonly path: string;
  readonly output: string;
  readonly taskId: string | null;
  readonly status: WorkspaceStatus;
  readonly lifecycle: WorkspaceLifecycle;
}

interface WorkspaceMetricTask {
  readonly lifecycle: WorkspaceLifecycle;
}

interface WorkspaceMetricProject {
  readonly tasks: readonly WorkspaceMetricTask[];
}

interface WorkspaceMetricDomain {
  readonly projects: readonly WorkspaceMetricProject[];
}

interface WorkspaceMetricGraph {
  readonly domains: readonly WorkspaceMetricDomain[];
}

interface TaskStatusSource {
  readonly currentProgress?: string;
  readonly lastStop?: string;
  readonly nextStep?: string;
}

export function renderGraphLinks(links: readonly WorkspaceLink[]): string {
  return `<svg class="project-workspace-graph__links" data-project-graph-links aria-hidden="true"><g data-project-graph-link-trunks></g><g>${links.map(renderGraphLink).join("")}</g></svg>`;
}

export function renderLinkSlot(): string {
  return `<span class="project-workspace-link-slot" aria-hidden="true"></span>`;
}

export function renderWindows(windows: readonly WorkspaceWindow[]): string {
  const body = windows.map(renderWindow).join("") || '<p class="project-workspace-window-list__empty">把正在进行或未确定的任务拖到这里，生成今日建议时间表。</p>';
  return `<aside class="project-workspace-windows"><header><h2>今日推进窗口</h2><small>同步任务计划页今日建议时间表</small></header><div class="project-workspace-window-list" data-project-workspace-window-list>${body}</div></aside>`;
}

export function renderMetrics(graph: WorkspaceMetricGraph): string {
  const projects = graph.domains.flatMap((domain) => domain.projects);
  const tasks = projects.flatMap((project) => project.tasks);
  return `
    <div class="project-workspace__metrics">
      <span class="project-workspace__metric">项目 ${projects.length}</span>
      <span class="project-workspace__metric">已完成 ${tasks.filter((task) => task.lifecycle === "done").length}</span>
      <span class="project-workspace__metric">正在进行 ${tasks.filter((task) => task.lifecycle === "active").length}</span>
      <span class="project-workspace__metric">未确定 ${tasks.filter((task) => task.lifecycle === "uncertain").length}</span>
    </div>
  `;
}

export function taskStatus(item: TaskStatusSource): WorkspaceStatus {
  if (item.lastStop?.trim()) return "blocked";
  if (item.currentProgress?.trim()) return "progress";
  return item.nextStep?.trim() ? "next" : "recorded";
}

export function aggregate(statuses: readonly WorkspaceStatus[]): WorkspaceStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("progress")) return "progress";
  return statuses.includes("next") ? "next" : "recorded";
}

export function labelOr(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

export function firstText(...values: readonly (string | undefined)[]): string {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

export function html(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return escaped[character] ?? character;
  });
}

function renderGraphLink(link: WorkspaceLink): string {
  return `<path data-project-workspace-link data-link-from="${html(link.from)}" data-link-to="${html(link.to)}" class="project-workspace-link project-workspace-link--${link.status}"></path>`;
}

function renderWindow(windowItem: WorkspaceWindow): string {
  return `
    <button type="button" class="project-workspace-window project-workspace-window--${windowItem.status} project-workspace-window--${windowItem.lifecycle}" ${windowItem.taskId ? `data-project-window-task="${html(windowItem.taskId)}"` : ""}>
      <span class="project-workspace-window__time">${html(windowItem.label)}</span>
      <strong class="project-workspace-window__title">${html(windowItem.title)}</strong>
      <small class="project-workspace-window__path">${html(windowItem.path)}</small>
      <p class="project-workspace-window__summary">${html(windowItem.output)}</p>
    </button>
  `;
}
