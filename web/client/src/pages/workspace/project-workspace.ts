import { mountProjectWorkspaceGraphConnectors } from "./project-workspace-connectors.js";
import { mountProjectWorkspaceCollapse } from "./project-workspace-collapse.js";
import { mountProjectWorkspaceDelete, type ProjectWorkspaceDeleteHandlers } from "./project-workspace-delete.js";
import { mountProjectWorkspaceDrag, type ProjectWorkspaceDragHandlers } from "./project-workspace-dnd.js";
import { mountProjectWorkspaceFilter } from "./project-workspace-filter.js";
import { mountProjectWorkspaceKeyboard } from "./project-workspace-keyboard.js";
import {
  mountProjectWorkspaceHighlighting,
  mountProjectWorkspaceSplit,
  readInitialProjectWorkspaceSplitRatio,
} from "./project-workspace-layout.js";
import {
  aggregateLifecycle,
  isTaskScheduled,
  lifecycleLabel,
  sortProjectItems,
  taskLifecycle,
  type ProjectWorkspaceLifecycle,
  type ProjectWorkspacePriority,
} from "./project-workspace-rules.js";
import {
  aggregate,
  firstText,
  html,
  labelOr,
  renderGraphLinks,
  renderLinkSlot,
  renderMetrics,
  renderWindows,
  taskStatus,
} from "./project-workspace-render-parts.js";
import { mountProjectWorkspaceGraphZoom, readInitialGraphScale } from "./project-workspace-zoom.js";
/**
 * Renderer and DOM runtime for the special project workspace wiki page.
 *
 * The module turns the flat task pool into a domain -> project -> task
 * execution graph, plus three daily advancement windows. It stays self-contained
 * so the normal wiki markdown renderer can opt into this one page only.
 */
interface ProjectWorkspaceDocument { path: string; label: string; title: string | null; }

interface ProjectWorkspacePoolItem {
  id: string;
  title: string;
  priority: ProjectWorkspacePriority;
  domain?: string;
  project?: string;
  stageId?: string;
  projectOrder?: number;
  taskOrder?: number;
  completedAt?: string;
  currentProgress?: string;
  lastStop?: string;
  nextStep?: string;
  workflowLog?: readonly ProjectWorkspaceWorkflowLogEntry[];
  actions?: readonly ProjectWorkspaceActionItem[];
}

interface ProjectWorkspaceStageItem { id: string; title: string; domain: string; project: string; order: number; }

interface ProjectWorkspaceActionItem { id: string; title: string; order: number; completedAt?: string; }

interface ProjectWorkspaceWorkflowLogEntry {
  id: string;
  node: string;
  output: string;
  issue: string;
  nextStep: string;
}

type WorkspaceStatus = "progress" | "blocked" | "next" | "recorded";
type WorkspaceNodeKind = "domain" | "project" | "stage" | "task" | "action";
type WorkspaceLifecycle = ProjectWorkspaceLifecycle;
type TaskPlanPriority = ProjectWorkspacePriority;
type DomainMap = Map<string, Map<string, WorkspaceProjectDraft>>;
type ProjectWorkspaceHandlers = ProjectWorkspaceDragHandlers & ProjectWorkspaceDeleteHandlers;

interface WorkspaceGraph { readonly domains: readonly WorkspaceDomain[]; readonly links: readonly WorkspaceLink[]; readonly windows: readonly WorkspaceWindow[]; }
interface WorkspaceDomain { readonly id: string; readonly label: string; readonly status: WorkspaceStatus; readonly lifecycle: WorkspaceLifecycle; readonly projects: readonly WorkspaceProject[]; }
interface WorkspaceProject { readonly id: string; readonly label: string; readonly status: WorkspaceStatus; readonly lifecycle: WorkspaceLifecycle; readonly tasks: readonly WorkspaceTask[]; readonly stages: readonly WorkspacePhase[]; }
interface WorkspaceTask { readonly id: string; readonly label: string; readonly priority: TaskPlanPriority; readonly status: WorkspaceStatus; readonly lifecycle: WorkspaceLifecycle; readonly stageId: string; readonly summary: string; readonly actions: readonly WorkspaceAction[]; }
interface WorkspaceAction { readonly id: string; readonly label: string; readonly lifecycle: WorkspaceLifecycle; }
interface WorkspacePhase { readonly id: string; readonly label: string; readonly note: string; readonly lifecycle: WorkspaceLifecycle; readonly tasks: readonly WorkspaceTask[]; readonly order: number; }
interface WorkspaceProjectDraft { readonly tasks: WorkspaceTask[]; readonly stages: ProjectWorkspaceStageItem[]; }
interface WorkspaceLink { readonly from: string; readonly to: string; readonly status: WorkspaceStatus; }
interface WorkspaceWindow { readonly label: string; readonly title: string; readonly taskId: string | null; readonly path: string; readonly output: string; readonly status: WorkspaceStatus; readonly lifecycle: WorkspaceLifecycle; }
interface ProjectWorkspaceScheduleItem { readonly id: string; readonly title: string; readonly startTime: string; readonly priority: TaskPlanPriority; }

const PROJECT_WORKSPACE_PATH = "wiki/专题/01-项目工作区/index.md";
const TIME_WINDOW_LABELS = ["上午", "下午", "晚上"] as const;

const FALLBACK_DOMAIN = "待分组领域";
const FALLBACK_PROJECT = "未归类项目";

/**
 * Returns whether a workspace wiki document should use the project renderer.
 */
export function isProjectWorkspaceDocument(document: Pick<ProjectWorkspaceDocument, "path">): boolean {
  return document.path === PROJECT_WORKSPACE_PATH;
}

/**
 * Renders the special project workspace document as a two-pane execution room.
 */
export function renderProjectWorkspaceDocument(
  document: ProjectWorkspaceDocument,
  items: readonly ProjectWorkspacePoolItem[],
  stages: readonly ProjectWorkspaceStageItem[] = [],
  scheduleItems: readonly ProjectWorkspaceScheduleItem[] = [],
): string {
  const graph = buildGraph(items, stages, scheduleItems);
  return `
    <section class="workspace-log-wiki-entry project-workspace-page" data-project-workspace data-workspace-wiki-open data-wiki-current-path="${html(document.path)}">
      <main class="project-workspace">
        <div class="project-workspace__layout" data-project-workspace-layout style="--project-workspace-left-ratio:${readInitialProjectWorkspaceSplitRatio()};">
          ${renderGraphSection(graph)}
          <button type="button" class="project-workspace__split" data-project-workspace-split role="separator" aria-orientation="vertical" aria-label="调整项目工作区分栏"></button>
          ${renderWindows(graph.windows)}
        </div>
      </main>
    </section>
  `;
}

/**
 * Mounts project workspace interactions once for each rendered page root.
 */
export function mountProjectWorkspace(root: ParentNode, handlers: ProjectWorkspaceHandlers = {}): void {
  for (const page of Array.from(root.querySelectorAll<HTMLElement>("[data-project-workspace]"))) {
    if (page.dataset.projectWorkspaceMounted === "true") {
      continue;
    }
    page.dataset.projectWorkspaceMounted = "true";
    mountProjectWorkspaceHighlighting(page);
    mountProjectWorkspaceCollapse(page);
    mountProjectWorkspaceFilter(page);
    mountProjectWorkspaceSplit(page);
    mountProjectWorkspaceGraphZoom(page);
    mountProjectWorkspaceGraphConnectors(page);
    mountProjectWorkspaceDrag(page, handlers);
    mountProjectWorkspaceDelete(page, handlers);
    mountProjectWorkspaceKeyboard(page, handlers);
  }
}

function buildGraph(
  items: readonly ProjectWorkspacePoolItem[],
  stages: readonly ProjectWorkspaceStageItem[],
  scheduleItems: readonly ProjectWorkspaceScheduleItem[],
): WorkspaceGraph {
  const domains = Array.from(groupItems(sortProjectItems(items), stages, scheduleItems).entries()).map(([label, projects]) => {
    const projectNodes = Array.from(projects.entries()).map(([projectLabel, draft]) =>
      buildProject(label, projectLabel, draft),
    );
    return buildDomain(label, projectNodes);
  });
  return { domains, links: buildLinks(domains), windows: buildWindows(domains, scheduleItems) };
}

function groupItems(
  items: readonly ProjectWorkspacePoolItem[],
  stages: readonly ProjectWorkspaceStageItem[],
  scheduleItems: readonly ProjectWorkspaceScheduleItem[],
): DomainMap {
  const domains: DomainMap = new Map();
  for (const stage of stages) {
    const projects = domains.get(stage.domain) ?? new Map<string, WorkspaceProjectDraft>();
    const draft = projects.get(stage.project) ?? { tasks: [], stages: [] };
    projects.set(stage.project, { tasks: draft.tasks, stages: [...draft.stages, stage] });
    domains.set(stage.domain, projects);
  }
  for (const item of items) {
    const domain = labelOr(item.domain, FALLBACK_DOMAIN);
    const project = labelOr(item.project, FALLBACK_PROJECT);
    const projects = domains.get(domain) ?? new Map<string, WorkspaceProjectDraft>();
    const draft = projects.get(project) ?? { tasks: [], stages: [] };
    const task = buildTask(item, isTaskScheduled(item, scheduleItems));
    projects.set(project, { stages: draft.stages, tasks: [...draft.tasks, task] });
    domains.set(domain, projects);
  }
  return domains;
}

function buildDomain(label: string, projects: readonly WorkspaceProject[]): WorkspaceDomain {
  return {
    id: `domain:${label}`,
    label,
    status: aggregate(projects.map((item) => item.status)),
    lifecycle: aggregateLifecycle(projects.map((item) => item.lifecycle)),
    projects,
  };
}

function buildProject(domain: string, label: string, draft: WorkspaceProjectDraft): WorkspaceProject {
  const stages = buildProjectStages(draft);
  const tasks = stages.flatMap((stage) => stage.tasks);
  return {
    id: `project:${domain}:${label}`,
    label,
    status: aggregate(tasks.map((task) => task.status)),
    lifecycle: aggregateLifecycle(tasks.map((task) => task.lifecycle)),
    tasks,
    stages,
  };
}

function buildTask(item: ProjectWorkspacePoolItem, scheduled: boolean): WorkspaceTask {
  const lifecycle = taskLifecycle(item, scheduled);
  return {
    id: item.id,
    label: item.title,
    priority: item.priority,
    status: taskStatus(item),
    lifecycle,
    stageId: item.stageId ?? defaultStageId(lifecycle),
    summary: firstText(item.lastStop, item.nextStep, item.currentProgress, item.title),
    actions: (item.actions ?? [])
      .slice()
      .sort((left, right) => left.order - right.order)
      .map(buildAction),
  };
}

function buildAction(item: ProjectWorkspaceActionItem): WorkspaceAction {
  return {
    id: item.id,
    label: item.title,
    lifecycle: item.completedAt?.trim() ? "done" : "active",
  };
}

function buildLinks(domains: readonly WorkspaceDomain[]): WorkspaceLink[] {
  const links: WorkspaceLink[] = [];
  for (const domain of domains) {
    for (const project of domain.projects) {
      links.push({ from: domain.id, to: project.id, status: project.status });
      for (const stage of project.stages) {
        links.push({ from: project.id, to: stage.id, status: stage.tasks[0]?.status ?? project.status });
        for (const task of stage.tasks) {
          links.push({ from: stage.id, to: task.id, status: task.status });
        }
      }
    }
  }
  return links;
}

function buildWindows(
  domains: readonly WorkspaceDomain[],
  scheduleItems: readonly ProjectWorkspaceScheduleItem[],
): WorkspaceWindow[] {
  const tasks = flattenTasks(domains);
  return scheduleItems.map((item, index) => {
    const matched = tasks.find(({ task }) => task.id === item.id || task.label === item.title);
    return {
      label: item.startTime || TIME_WINDOW_LABELS[index] || "待排期",
      title: matched ? `推进：${matched.task.label}` : item.title,
      taskId: matched?.task.id ?? null,
      path: matched ? `${matched.domain.label} -> ${matched.project.label} -> ${matched.task.label}` : "任务计划页今日建议时间表",
      output: matched?.task.summary ?? "来自任务计划页今日建议时间表",
      status: matched?.task.status ?? "next",
      lifecycle: matched?.task.lifecycle ?? "active",
    };
  });
}

function flattenTasks(domains: readonly WorkspaceDomain[]): Array<{
  readonly domain: WorkspaceDomain;
  readonly project: WorkspaceProject;
  readonly task: WorkspaceTask;
}> {
  return domains.flatMap((domain) =>
    domain.projects.flatMap((project) => project.tasks.map((task) => ({ domain, project, task }))),
  );
}

function renderGraphSection(graph: WorkspaceGraph): string {
  const scale = readInitialGraphScale();
  return `
    <section class="project-workspace-graph" data-project-workspace-graph>
      <header>
        <div><h2>执行层级图</h2><p>领域 -> 项目 -> 阶段列；同列任务表示同步推进</p></div>
        ${renderMetrics(graph)}
        <div class="project-workspace-graph__controls">
          <div class="project-workspace-filter" aria-label="项目状态筛选">
            <button type="button" data-project-workspace-filter="unfinished" aria-pressed="true">未完成</button>
            <button type="button" data-project-workspace-filter="all" aria-pressed="false">全部</button>
          </div>
          <div class="project-workspace-graph__tools">
            <button type="button" data-project-graph-zoom="out" aria-label="缩小">-</button>
            <button type="button" data-project-graph-zoom="reset" aria-label="重置缩放">${Math.round(scale * 100)}%</button>
            <button type="button" data-project-graph-zoom="in" aria-label="放大">+</button>
          </div>
        </div>
      </header>
      <div class="project-workspace-graph__viewport" data-project-graph-viewport>
        <div class="project-workspace-graph__layer" data-project-graph-layer style="--project-workspace-graph-scale:${scale};">
          ${renderGraphLinks(graph.links)}
          <div class="project-workspace-graph__domains">${graph.domains.map(renderDomain).join("")}</div>
        </div>
      </div>
    </section>
  `;
}

function renderDomain(domain: WorkspaceDomain): string {
  return `<article class="project-workspace-domain" data-project-filter-scope data-project-lifecycle="${domain.lifecycle}" data-project-collapse-group>${renderNode(domain.id, domain.label, "domain", domain.status, domain.lifecycle, domain.label, "", "", "", "", true)}<div class="project-workspace-projects" data-project-collapse-target>${domain.projects.map((project) => renderProject(project, domain.label)).join("")}</div></article>`;
}

function renderProject(project: WorkspaceProject, domainLabel: string): string {
  return `<section class="project-workspace-project" data-project-filter-scope data-project-lifecycle="${project.lifecycle}" data-project-collapse-group>${renderLinkSlot()}${renderNode(project.id, project.label, "project", project.status, project.lifecycle, domainLabel, project.label, "", "", "", true)}<div class="project-workspace-tasks" data-project-collapse-target>${project.stages.map((phase) => renderPhase(phase, domainLabel, project.label)).join("")}</div></section>`;
}

function renderPhase(phase: WorkspacePhase, domainLabel: string, projectLabel: string): string {
  const label = `阶段 ${phase.order + 1} · ${phase.label}`;
  const stageNode = renderNode(phase.id, label, "stage", phase.tasks[0]?.status ?? "next", phase.lifecycle, domainLabel, projectLabel, phase.note, phase.id);
  return `<section class="project-workspace-phase" data-project-workspace-phase="${html(label)}" data-project-stage-drop-node="${html(phase.id)}" data-project-domain-label="${html(domainLabel)}" data-project-project-label="${html(projectLabel)}" data-project-filter-scope data-project-lifecycle="${phase.lifecycle}">${stageNode}<div class="project-workspace-phase__tasks">${phase.tasks.map((task) => renderTask(task, domainLabel, projectLabel, phase.id)).join("")}</div></section>`;
}

function renderTask(task: WorkspaceTask, domainLabel: string, projectLabel: string, stageId: string): string {
  const actions = task.actions.map((action) => renderAction(action, domainLabel, projectLabel, stageId, task.id)).join("");
  return `<article class="project-workspace-task" data-project-filter-scope data-project-lifecycle="${task.lifecycle}">${renderLinkSlot()}${renderNode(task.id, task.label, "task", task.status, task.lifecycle, domainLabel, projectLabel, task.summary, stageId)}${actions ? `<div class="project-workspace-actions">${actions}</div>` : ""}</article>`;
}

function renderAction(
  action: WorkspaceAction,
  domainLabel: string,
  projectLabel: string,
  stageId: string,
  taskId: string,
): string {
  return renderNode(action.id, action.label, "action", "next", action.lifecycle, domainLabel, projectLabel, "", stageId, taskId);
}

function buildProjectStages(draft: WorkspaceProjectDraft): WorkspacePhase[] {
  const stages = draft.stages.length > 0 ? draft.stages : defaultProjectStages(draft.tasks);
  return stages
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((stage) => {
      const tasks = draft.tasks.filter((task) => task.stageId === stage.id);
      const lifecycle = aggregateLifecycle(tasks.map((task) => task.lifecycle));
      return { id: stage.id, label: stage.title, note: phaseNote(tasks), lifecycle, tasks, order: stage.order };
    });
}

function defaultProjectStages(tasks: readonly WorkspaceTask[]): ProjectWorkspaceStageItem[] {
  const source = [
    { id: defaultStageId("done"), title: "已完成" },
    { id: defaultStageId("active"), title: "同步推进" },
    { id: defaultStageId("uncertain"), title: "待推进" },
  ];
  return source
    .map((stage, order) => ({ ...stage, order }))
    .filter((stage) => tasks.some((task) => task.stageId === stage.id))
    .map((stage) => ({ ...stage, domain: "", project: "" }));
}

function defaultStageId(lifecycle: WorkspaceLifecycle): string {
  return `stage:auto:${lifecycle}`;
}

function phaseNote(tasks: readonly WorkspaceTask[]): string {
  return tasks.length > 1 ? `${tasks.length} 个任务同步` : "Tab 建任务 / Enter 建阶段";
}

function renderNode(
  id: string,
  label: string,
  kind: WorkspaceNodeKind,
  status: WorkspaceStatus,
  lifecycle: WorkspaceLifecycle,
  domainLabel: string,
  projectLabel = "",
  summary = "",
  stageId = "",
  taskId = "",
  collapsible = false,
): string {
  const detail = summary ? `<small class="project-workspace-node__meta">${html(summary)}</small>` : "";
  const collapse = collapsible ? ` data-project-collapse-toggle="${html(id)}" aria-expanded="true"` : "";
  const marker = collapsible ? '<span class="project-workspace-node__fold" aria-hidden="true"></span>' : "";
  const task = kind === "task" ? ` data-project-task-node="${html(id)}"` : "";
  const stage = kind === "stage" ? ` data-project-stage-node="${html(id)}"` : (stageId ? ` data-project-stage-node="${html(stageId)}"` : "");
  const action = kind === "action" ? ` data-project-action-node="${html(id)}" data-project-parent-task-node="${html(taskId)}"` : "";
  return `<button type="button" class="project-workspace-node project-workspace-node--${kind} project-workspace-node--${status} project-workspace-node--${lifecycle}" data-project-node-id="${html(id)}" data-project-drag-kind="${kind}" data-project-domain-label="${html(domainLabel)}" data-project-project-label="${html(projectLabel)}"${stage}${collapse}${task}${action} draggable="true"><span class="project-workspace-node__line">${marker}<span class="project-workspace-node__title">${html(label || "未命名")}</span></span><span class="project-workspace-node__state">${lifecycleLabel(lifecycle)}</span>${detail}</button>`;
}
