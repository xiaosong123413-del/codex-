# Project Workspace Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `项目工作区` placeholder document with a two-pane project execution room: a connected `领域 -> 项目 -> 任务 -> 行动` hierarchy graph on the left and today's project advancement windows on the right.

**Architecture:** Add a focused workspace module for project-workspace rendering and interaction, following the existing `execution-workbench.ts` pattern. Keep the main workspace page responsible only for selecting the special document, passing task-pool data, mounting interactions, and loading the task-plan state. Put visual rules in a dedicated CSS file linked from the WebUI entry page.

**Tech Stack:** TypeScript DOM rendering, existing workspace document model, existing task-plan pool state, CSS/SVG, Vitest + jsdom.

---

## File Structure

- Create `web/client/src/pages/workspace/project-workspace.ts`
  - Owns the special document detection, model building, HTML rendering, node/window highlighting interactions, and local split width persistence.
- Create `web/client/assets/styles/project-workspace.css`
  - Owns all project-workspace layout, graph, connector, node, and timeline-window styles.
- Modify `web/client/src/pages/workspace/index.ts`
  - Imports the project-workspace module, passes task-pool data into the work-log renderer, loads task-plan state for the work-log tab, and mounts project-workspace interactions.
- Modify `web/client/index.html`
  - Links `project-workspace.css`.
- Modify `test/web-workspace-page.test.ts`
  - Adds focused coverage for the special project-workspace document, hierarchy graph, timeline windows, highlighting, and draggable pane divider.
- Modify `docs/project-log.md`
  - Documents the user-visible project-workspace layout after implementation.

---

### Task 1: Add Failing Workspace Page Tests

**Files:**
- Modify: `test/web-workspace-page.test.ts`

- [ ] **Step 1: Extend the work-log fetch fixture with task-plan state**

Add a project-workspace-specific task-plan state fixture near `workspaceDocsFixture()`:

```ts
function projectWorkspaceTaskPlanFixture(): unknown {
  const now = "2026-05-03T09:00:00.000Z";
  return {
    voice: { transcript: "", audioPath: null, updatedAt: null },
    statusSummary: "",
    pool: {
      items: [
        {
          id: "task-work-log",
          title: "工作日志整合",
          priority: "high",
          source: "工作日志",
          domain: "个人知识库",
          project: "LLM Wiki",
          currentProgress: "执行现场已经合并为单页",
          nextStep: "确认项目工作区布局",
          workflowLog: [{
            id: "log-merge-execution",
            recordedAt: now,
            node: "推进",
            tool: "workspace",
            input: "执行现场合并",
            output: "合并执行现场页面",
            issue: "",
            nextStep: "确认项目工作区布局",
            attachments: [],
            sourceRecordId: "we_1",
          }],
        },
        {
          id: "task-graphy-layout",
          title: "Graphy 布局卡点",
          priority: "mid",
          source: "工作日志",
          domain: "个人知识库",
          project: "LLM Wiki",
          lastStop: "Graphy 与正文布局互相抢占空间",
          nextStep: "确定 Graphy 在项目工作区中的辅助边界",
          workflowLog: [{
            id: "log-graphy-blocker",
            recordedAt: now,
            node: "卡点",
            tool: "workspace",
            input: "Graphy 默认右上角",
            output: "",
            issue: "Graphy 与正文布局互相抢占空间",
            nextStep: "确定 Graphy 在项目工作区中的辅助边界",
            attachments: [],
            sourceRecordId: "we_2",
          }],
        },
        {
          id: "task-method-review",
          title: "方法库验收",
          priority: "low",
          source: "AI 生成",
          domain: "个人知识库",
          project: "知识沉淀",
          nextStep: "沉淀方法库验收规则",
          workflowLog: [],
        },
      ],
    },
    schedule: {
      generationId: null,
      revisionId: null,
      confirmed: true,
      items: [],
    },
    roadmap: {
      view: "week",
      windowStart: "2026-05-03",
      topLabel: "",
      windowLabel: "",
      groups: [],
    },
    morningFlow: { voiceDone: false, diaryDone: false, planningDone: false },
  };
}
```

Update `installWorkspaceDocsFetchMock()` to return this fixture for `/api/task-plan/state`:

```ts
if (url === "/api/task-plan/state") {
  return jsonOk({ success: true, data: { state: projectWorkspaceTaskPlanFixture() } });
}
```

- [ ] **Step 2: Add a failing render test**

Add this test after the execution-site workbench test:

```ts
it("renders the project workspace as a connected execution hierarchy with time windows", async () => {
  const { page } = await setupWorkspaceDocsPage();

  page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
  await flush();
  await flush();

  expect(fetch).toHaveBeenCalledWith("/api/task-plan/state");
  expect(page.querySelector("[data-project-workspace]")).not.toBeNull();
  expect(page.querySelector("[data-project-workspace-graph]")?.textContent).toContain("个人知识库");
  expect(page.querySelector("[data-project-workspace-graph]")?.textContent).toContain("LLM Wiki");
  expect(page.querySelector("[data-project-workspace-graph]")?.textContent).toContain("工作日志整合");
  expect(page.querySelector("[data-project-workspace-graph]")?.textContent).toContain("合并执行现场页面");
  expect(page.querySelectorAll("[data-project-workspace-link]")).toHaveLength(7);
  expect(page.querySelector("[data-project-workspace-window-list]")?.textContent).toContain("上午");
  expect(page.querySelector("[data-project-workspace-window-list]")?.textContent).toContain("确认项目工作区布局");
  expect(page.querySelector("[data-workspace-doc-editor]")).toBeNull();
});
```

- [ ] **Step 3: Add a failing interaction test**

Add this test after the render test:

```ts
it("links project workspace time windows back to graph nodes and persists split width", async () => {
  window.localStorage.removeItem("workspace.projectWorkspaceSplit");
  const { page } = await setupWorkspaceDocsPage();

  page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
  await flush();
  await flush();

  page.querySelector<HTMLButtonElement>("[data-project-window-task='task-graphy-layout']")?.click();
  expect(page.querySelector("[data-project-node-id='task-graphy-layout']")?.classList.contains("is-highlighted")).toBe(true);

  const layout = page.querySelector<HTMLElement>("[data-project-workspace-layout]");
  const handle = page.querySelector<HTMLElement>("[data-project-workspace-split]");
  expect(layout).not.toBeNull();
  expect(handle).not.toBeNull();
  vi.spyOn(layout!, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    toJSON() {
      return {};
    },
  } as DOMRect);

  handle!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 600 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 650 }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 650 }));

  expect(layout?.style.getPropertyValue("--project-workspace-left-ratio")).toBe("0.65");
  expect(window.localStorage.getItem("workspace.projectWorkspaceSplit")).toBe("0.65");
});
```

- [ ] **Step 4: Run the focused test and verify failure**

Run:

```powershell
rtk test "npx vitest run test/web-workspace-page.test.ts"
```

Expected: fail because `data-project-workspace`, graph links, and project split behavior do not exist yet.

- [ ] **Step 5: Commit test changes**

```powershell
git add test/web-workspace-page.test.ts
git commit -m "test: cover project workspace execution layout"
```

---

### Task 2: Create the Project Workspace Renderer

**Files:**
- Create: `web/client/src/pages/workspace/project-workspace.ts`

- [ ] **Step 1: Add the module header, public document detection, and data contracts**

Create `project-workspace.ts` with:

```ts
/**
 * Project workspace execution-room view for the workspace work-log page.
 *
 * The project workspace is a special document surface. It renders task-pool
 * project state as a connected domain -> project -> task -> action hierarchy
 * and a project-only timeline for today's advancement windows.
 */

const PROJECT_WORKSPACE_PATH = "wiki/专题/01-项目工作区/index.md";
const PROJECT_WORKSPACE_SPLIT_KEY = "workspace.projectWorkspaceSplit";
const DEFAULT_SPLIT_RATIO = 0.58;
const MIN_SPLIT_RATIO = 0.34;
const MAX_SPLIT_RATIO = 0.76;
const TIME_WINDOW_LABELS = ["上午", "下午", "晚上"] as const;

export interface ProjectWorkspaceDocument {
  path: string;
  label: string;
  title: string | null;
}

export interface ProjectWorkspacePoolItem {
  id: string;
  title: string;
  domain?: string;
  project?: string;
  currentProgress?: string;
  lastStop?: string;
  nextStep?: string;
  workflowLog?: readonly ProjectWorkspaceWorkflowLogEntry[];
}

export interface ProjectWorkspaceWorkflowLogEntry {
  id: string;
  node: string;
  output: string;
  issue: string;
  nextStep: string;
}

type ProjectWorkspaceStatus = "progress" | "blocked" | "next" | "recorded";

interface ProjectWorkspaceModel {
  domains: readonly DomainNode[];
  windows: readonly ProjectWindow[];
}
```

- [ ] **Step 2: Add model-building helpers**

Add small helpers that turn task-pool items into hierarchy data:

```ts
interface DomainNode {
  id: string;
  label: string;
  projects: ProjectNode[];
}

interface ProjectNode {
  id: string;
  label: string;
  domainId: string;
  tasks: TaskNode[];
}

interface TaskNode {
  id: string;
  label: string;
  projectId: string;
  status: ProjectWorkspaceStatus;
  summary: string;
  actions: ActionNode[];
}

interface ActionNode {
  id: string;
  label: string;
  taskId: string;
  status: ProjectWorkspaceStatus;
}

interface ProjectWindow {
  label: string;
  taskId: string;
  title: string;
  path: string;
  output: string;
  status: ProjectWorkspaceStatus;
}

export function isProjectWorkspaceDocument(document: Pick<ProjectWorkspaceDocument, "path">): boolean {
  return document.path === PROJECT_WORKSPACE_PATH;
}

function buildProjectWorkspaceModel(items: readonly ProjectWorkspacePoolItem[]): ProjectWorkspaceModel {
  const domains = new Map<string, DomainNode>();
  for (const item of items) {
    const domainLabel = item.domain?.trim() || "待分组领域";
    const projectLabel = item.project?.trim() || "未归类项目";
    const domain = getOrCreateDomain(domains, domainLabel);
    const project = getOrCreateProject(domain, projectLabel);
    project.tasks.push(buildTaskNode(item, project.id));
  }
  return {
    domains: [...domains.values()],
    windows: buildProjectWindows([...domains.values()]),
  };
}
```

Add the helper functions used above:

```ts
function getOrCreateDomain(domains: Map<string, DomainNode>, label: string): DomainNode {
  const id = `domain:${label}`;
  const existing = domains.get(id);
  if (existing) return existing;
  const created: DomainNode = { id, label, projects: [] };
  domains.set(id, created);
  return created;
}

function getOrCreateProject(domain: DomainNode, label: string): ProjectNode {
  const id = `${domain.id}/project:${label}`;
  const existing = domain.projects.find((project) => project.id === id);
  if (existing) return existing;
  const created: ProjectNode = { id, label, domainId: domain.id, tasks: [] };
  domain.projects.push(created);
  return created;
}

function buildTaskNode(item: ProjectWorkspacePoolItem, projectId: string): TaskNode {
  const status = readTaskStatus(item);
  const actions = buildActionNodes(item, status);
  return {
    id: item.id,
    label: item.title,
    projectId,
    status,
    summary: item.lastStop || item.currentProgress || item.nextStep || "等待下一条执行记录",
    actions,
  };
}

function buildActionNodes(item: ProjectWorkspacePoolItem, fallbackStatus: ProjectWorkspaceStatus): ActionNode[] {
  const logs = item.workflowLog ?? [];
  if (logs.length === 0) {
    return [{
      id: `${item.id}:next`,
      label: item.nextStep || item.currentProgress || item.lastStop || "补充下一步行动",
      taskId: item.id,
      status: fallbackStatus,
    }];
  }
  return logs.slice(-2).map((entry) => ({
    id: entry.id,
    label: entry.output || entry.issue || entry.nextStep || entry.node || "执行记录",
    taskId: item.id,
    status: readActionStatus(entry, fallbackStatus),
  }));
}

function readTaskStatus(item: ProjectWorkspacePoolItem): ProjectWorkspaceStatus {
  if (item.lastStop) return "blocked";
  if (item.currentProgress) return "progress";
  if (item.nextStep) return "next";
  return "recorded";
}

function readActionStatus(
  entry: ProjectWorkspaceWorkflowLogEntry,
  fallback: ProjectWorkspaceStatus,
): ProjectWorkspaceStatus {
  if (entry.issue) return "blocked";
  if (entry.output) return "progress";
  if (entry.nextStep) return "next";
  return fallback;
}
```

- [ ] **Step 3: Add render functions with stable test selectors**

Append:

```ts
export function renderProjectWorkspaceDocument(
  document: ProjectWorkspaceDocument,
  items: readonly ProjectWorkspacePoolItem[],
): string {
  const title = document.title ?? document.label;
  const model = buildProjectWorkspaceModel(items);
  const split = readProjectWorkspaceSplit();
  return `
    <section class="workspace-log-wiki-entry project-workspace-page" data-project-workspace data-workspace-wiki-open data-wiki-current-path="${escapeHtml(document.path)}">
      <main class="project-workspace">
        <header class="project-workspace__header">
          <div>
            <p class="eyebrow">PROJECTS</p>
            <h1>${escapeHtml(title)}</h1>
            <p>看清项目链路，安排今天的项目推进窗口。</p>
          </div>
          ${renderProjectWorkspaceMetrics(model)}
        </header>
        <div class="project-workspace__layout" data-project-workspace-layout style="--project-workspace-left-ratio: ${split};">
          ${renderProjectGraph(model)}
          <div class="project-workspace__split" data-project-workspace-split role="separator" aria-orientation="vertical"></div>
          ${renderProjectWindows(model.windows)}
        </div>
      </main>
    </section>
  `;
}
```

Add graph and window rendering:

```ts
function renderProjectGraph(model: ProjectWorkspaceModel): string {
  return `
    <section class="project-workspace-graph" data-project-workspace-graph>
      <header class="project-workspace-pane__header">
        <strong>执行层级图</strong>
        <span>领域 -> 项目 -> 任务 -> 行动</span>
      </header>
      <div class="project-workspace-graph__grid">
        ${model.domains.map(renderDomainLane).join("")}
      </div>
    </section>
  `;
}

function renderDomainLane(domain: DomainNode): string {
  return `
    <div class="project-workspace-domain" data-project-node-id="${escapeHtml(domain.id)}">
      ${renderNode("domain", domain.id, domain.label, "recorded")}
      <div class="project-workspace-domain__projects">
        ${domain.projects.map(renderProjectNode).join("")}
      </div>
    </div>
  `;
}

function renderProjectNode(project: ProjectNode): string {
  return `
    <div class="project-workspace-project">
      ${renderConnector(project.domainId, project.id, "recorded")}
      ${renderNode("project", project.id, project.label, readProjectStatus(project))}
      <div class="project-workspace-project__tasks">
        ${project.tasks.map((task) => renderTaskNode(task, project.id)).join("")}
      </div>
    </div>
  `;
}

function renderTaskNode(task: TaskNode, projectId: string): string {
  return `
    <div class="project-workspace-task">
      ${renderConnector(projectId, task.id, task.status)}
      ${renderNode("task", task.id, task.label, task.status, task.summary)}
      <div class="project-workspace-task__actions">
        ${task.actions.map((action) => renderActionNode(action, task.id)).join("")}
      </div>
    </div>
  `;
}

function renderActionNode(action: ActionNode, taskId: string): string {
  return `
    <div class="project-workspace-action">
      ${renderConnector(taskId, action.id, action.status)}
      ${renderNode("action", action.id, action.label, action.status)}
    </div>
  `;
}

function renderConnector(from: string, to: string, status: ProjectWorkspaceStatus): string {
  return `<span class="project-workspace-link project-workspace-link--${status}" data-project-workspace-link data-link-from="${escapeHtml(from)}" data-link-to="${escapeHtml(to)}"></span>`;
}
```

Add node, metrics, windows, split helpers:

```ts
function renderNode(
  kind: "domain" | "project" | "task" | "action",
  id: string,
  label: string,
  status: ProjectWorkspaceStatus,
  summary = "",
): string {
  return `
    <button type="button" class="project-workspace-node project-workspace-node--${kind} project-workspace-node--${status}" data-project-node-id="${escapeHtml(id)}">
      <strong>${escapeHtml(label)}</strong>
      ${summary ? `<span>${escapeHtml(summary)}</span>` : ""}
    </button>
  `;
}

function renderProjectWorkspaceMetrics(model: ProjectWorkspaceModel): string {
  const tasks = model.domains.flatMap((domain) => domain.projects.flatMap((project) => project.tasks));
  return `
    <div class="project-workspace__metrics">
      <span>项目 ${model.domains.flatMap((domain) => domain.projects).length}</span>
      <span>推进 ${tasks.filter((task) => task.status === "progress").length}</span>
      <span>卡点 ${tasks.filter((task) => task.status === "blocked").length}</span>
      <span>下一步 ${tasks.filter((task) => task.status === "next").length}</span>
    </div>
  `;
}

function renderProjectWindows(windows: readonly ProjectWindow[]): string {
  return `
    <section class="project-workspace-windows">
      <header class="project-workspace-pane__header">
        <strong>今日项目推进窗口</strong>
        <span>只显示今天用于推进项目的时间块</span>
      </header>
      <div class="project-workspace-window-list" data-project-workspace-window-list>
        ${windows.map(renderProjectWindow).join("") || `<p class="project-workspace-empty">今天还没有项目推进窗口。</p>`}
      </div>
    </section>
  `;
}

function renderProjectWindow(window: ProjectWindow): string {
  return `
    <button type="button" class="project-workspace-window project-workspace-window--${window.status}" data-project-window-task="${escapeHtml(window.taskId)}">
      <time>${escapeHtml(window.label)}</time>
      <strong>${escapeHtml(window.title)}</strong>
      <span>${escapeHtml(window.path)}</span>
      <small>${escapeHtml(window.output)}</small>
    </button>
  `;
}
```

Add model utility helpers:

```ts
function buildProjectWindows(domains: readonly DomainNode[]): ProjectWindow[] {
  const tasks = domains
    .flatMap((domain) => domain.projects.map((project) => ({ domain, project })))
    .flatMap(({ domain, project }) => project.tasks.map((task) => ({ domain, project, task })))
    .filter(({ task }) => task.status === "blocked" || task.status === "progress" || task.status === "next")
    .slice(0, TIME_WINDOW_LABELS.length);
  return tasks.map(({ domain, project, task }, index) => ({
    label: TIME_WINDOW_LABELS[index] ?? "项目窗口",
    taskId: task.id,
    title: task.status === "blocked" ? `处理卡点：${task.label}` : `推进：${task.label}`,
    path: `${domain.label} -> ${project.label} -> ${task.label}`,
    output: task.summary,
    status: task.status,
  }));
}

function readProjectStatus(project: ProjectNode): ProjectWorkspaceStatus {
  if (project.tasks.some((task) => task.status === "blocked")) return "blocked";
  if (project.tasks.some((task) => task.status === "progress")) return "progress";
  if (project.tasks.some((task) => task.status === "next")) return "next";
  return "recorded";
}

function readProjectWorkspaceSplit(): string {
  const value = Number(window.localStorage.getItem(PROJECT_WORKSPACE_SPLIT_KEY));
  return String(clampSplitRatio(Number.isFinite(value) ? value : DEFAULT_SPLIT_RATIO));
}

function writeProjectWorkspaceSplit(value: number): number {
  const next = clampSplitRatio(value);
  window.localStorage.setItem(PROJECT_WORKSPACE_SPLIT_KEY, next.toFixed(2));
  return next;
}

function clampSplitRatio(value: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, Math.round(value * 100) / 100));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return escaped[character] ?? character;
  });
}
```

- [ ] **Step 4: Add interaction mounting**

Add:

```ts
export function mountProjectWorkspace(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-project-workspace]").forEach((container) => {
    if (container.dataset.projectWorkspaceMounted === "true") return;
    container.dataset.projectWorkspaceMounted = "true";
    bindNodeHighlight(container);
    bindProjectWorkspaceSplit(container);
  });
}

function bindNodeHighlight(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>("[data-project-window-task]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.dataset.projectWindowTask ?? "";
      highlightProjectPath(container, taskId);
    });
  });
  container.querySelectorAll<HTMLElement>("[data-project-node-id]").forEach((node) => {
    node.addEventListener("click", () => highlightProjectPath(container, node.dataset.projectNodeId ?? ""));
  });
}

function highlightProjectPath(container: HTMLElement, id: string): void {
  container.querySelectorAll<HTMLElement>(".is-highlighted").forEach((node) => node.classList.remove("is-highlighted"));
  if (!id) return;
  container.querySelector<HTMLElement>(`[data-project-node-id="${cssEscape(id)}"]`)?.classList.add("is-highlighted");
  container.querySelectorAll<HTMLElement>("[data-project-workspace-link]").forEach((link) => {
    const active = link.dataset.linkFrom === id || link.dataset.linkTo === id;
    link.classList.toggle("is-highlighted", active);
  });
}

function bindProjectWorkspaceSplit(container: HTMLElement): void {
  const layout = container.querySelector<HTMLElement>("[data-project-workspace-layout]");
  const handle = container.querySelector<HTMLElement>("[data-project-workspace-split]");
  if (!layout || !handle) return;
  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const move = (moveEvent: MouseEvent): void => {
      const rect = layout.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = writeProjectWorkspaceSplit((moveEvent.clientX - rect.left) / rect.width);
      layout.style.setProperty("--project-workspace-left-ratio", String(ratio));
    };
    const end = (): void => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
  });
}

function cssEscape(value: string): string {
  const css = (window as Window & { CSS?: { escape?: (input: string) => string } }).CSS;
  return typeof css?.escape === "function" ? css.escape(value) : value.replace(/["\\]/g, "\\$&");
}
```

- [ ] **Step 5: Run TypeScript and verify expected unused-module errors are absent**

Run:

```powershell
rtk tsc --noEmit
```

Expected: pass or only fail because the module is not yet integrated. If import-related errors appear before integration, fix them in this module.

- [ ] **Step 6: Commit renderer module**

```powershell
git add web/client/src/pages/workspace/project-workspace.ts
git commit -m "feat: add project workspace renderer"
```

---

### Task 3: Integrate the Project Workspace Into the Work-Log Page

**Files:**
- Modify: `web/client/src/pages/workspace/index.ts`

- [ ] **Step 1: Import the project-workspace module**

Add next to the execution workbench import:

```ts
import {
  isProjectWorkspaceDocument,
  mountProjectWorkspace,
  renderProjectWorkspaceDocument,
} from "./project-workspace.js";
```

- [ ] **Step 2: Pass task-plan state into the work-log renderer**

Extend the `renderWorkLogView` options type:

```ts
taskPlanState?: TaskPlanViewState;
```

When calling `renderWorkspaceWikiDocument`, pass the available task-plan pool:

```ts
${renderWorkspaceWikiDocument(
  selected,
  currentHtml,
  options.graphyPosition,
  visibleDocuments,
  options.gallerySelectedPath,
  options.taskPlanState?.state?.pool.items ?? [],
)}
```

Update the function signature:

```ts
function renderWorkspaceWikiDocument(
  document: WorkspaceDocument,
  html: string,
  graphyPosition: WorkspaceGraphyPosition,
  documents: readonly WorkspaceDocument[],
  gallerySelectedPath: string | null,
  taskPoolItems: readonly TaskPlanPoolItem[],
): string {
```

- [ ] **Step 3: Render project workspace before the generic wiki article**

Inside `renderWorkspaceWikiDocument`, after the execution workbench branch and before gallery pages:

```ts
if (isProjectWorkspaceDocument(document)) {
  return renderProjectWorkspaceDocument(document, taskPoolItems);
}
```

- [ ] **Step 4: Mount project-workspace interactions and load task-plan state for work-log**

In `runWorkspaceRenderEffects`, keep the execution workbench mount and add project workspace mount:

```ts
if (activeTab === "work-log") {
  mountExecutionWorkbench(root);
  mountProjectWorkspace(root);
}
```

Update `tabNeedsTaskPlanState`:

```ts
function tabNeedsTaskPlanState(tab: WorkspaceTab): boolean {
  return tab === "project-progress" || tab === "task-plan" || tab === "task-pool" || tab === "work-log";
}
```

- [ ] **Step 5: Run the focused tests and verify the new tests pass**

Run:

```powershell
rtk test "npx vitest run test/web-workspace-page.test.ts"
```

Expected: the new project-workspace tests pass. If old work-log tests fail because `/api/task-plan/state` is now requested, update the local fetch mock in `installWorkspaceDocsFetchMock()` as described in Task 1.

- [ ] **Step 6: Commit integration**

```powershell
git add web/client/src/pages/workspace/index.ts test/web-workspace-page.test.ts
git commit -m "feat: render project workspace execution room"
```

---

### Task 4: Add Dedicated Project Workspace CSS

**Files:**
- Create: `web/client/assets/styles/project-workspace.css`
- Modify: `web/client/index.html`

- [ ] **Step 1: Link the stylesheet**

In `web/client/index.html`, add this link after `execution-workbench.css`:

```html
<link rel="stylesheet" href="/assets/styles/project-workspace.css?v=%BUILD_VERSION%" />
```

- [ ] **Step 2: Add the layout and pane styles**

Create `project-workspace.css`:

```css
/**
 * Project workspace execution-room styles.
 *
 * This file owns the special project workspace document rendered inside the
 * workspace work-log page. It keeps the hierarchy graph and project time
 * windows visually separate from generic wiki article styling.
 */

.project-workspace-page {
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.project-workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  height: 100%;
  padding: 18px;
}

.project-workspace__header,
.project-workspace-graph,
.project-workspace-windows {
  border: 1px solid #d7e0ef;
  border-radius: 8px;
  background: #fff;
}

.project-workspace__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
}

.project-workspace__header h1 {
  margin: 0;
  font-size: 30px;
}

.project-workspace__header p {
  margin: 6px 0 0;
  color: #64748b;
}

.project-workspace__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.project-workspace__metrics span {
  padding: 7px 10px;
  border: 1px solid #dbe3ef;
  border-radius: 999px;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.project-workspace__layout {
  display: grid;
  grid-template-columns:
    minmax(360px, calc(var(--project-workspace-left-ratio, 0.58) * 100%))
    10px
    minmax(300px, 1fr);
  min-height: 0;
}

.project-workspace__split {
  cursor: col-resize;
  background: linear-gradient(180deg, #dbeafe, #bfdbfe);
}
```

- [ ] **Step 3: Add graph, connector, node, and window styles**

Append:

```css
.project-workspace-graph,
.project-workspace-windows {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.project-workspace-graph {
  border-radius: 8px 0 0 8px;
  background: #fbfdff;
}

.project-workspace-windows {
  border-left: 0;
  border-radius: 0 8px 8px 0;
}

.project-workspace-pane__header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.96);
}

.project-workspace-pane__header span {
  color: #64748b;
  font-size: 13px;
}

.project-workspace-graph__grid {
  display: grid;
  gap: 18px;
  min-width: 920px;
  padding: 18px;
}

.project-workspace-domain,
.project-workspace-project,
.project-workspace-task,
.project-workspace-action {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 12px;
}

.project-workspace-domain__projects,
.project-workspace-project__tasks,
.project-workspace-task__actions {
  display: grid;
  gap: 12px;
}

.project-workspace-link {
  width: 42px;
  height: 28px;
  border-left: 2px solid #94a3b8;
  border-bottom: 2px solid #94a3b8;
  border-radius: 0 0 0 8px;
  align-self: start;
  margin-top: 16px;
}

.project-workspace-link--progress {
  border-color: #22c55e;
}

.project-workspace-link--blocked {
  border-color: #f97316;
}

.project-workspace-link--next {
  border-color: #2563eb;
}

.project-workspace-node {
  display: grid;
  gap: 5px;
  width: 100%;
  min-width: 150px;
  padding: 12px 14px;
  border: 2px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  text-align: left;
  cursor: pointer;
}

.project-workspace-node span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

.project-workspace-node--project {
  border-color: #2563eb;
  background: #eff6ff;
}

.project-workspace-node--progress {
  border-color: #22c55e;
  background: #f0fdf4;
}

.project-workspace-node--blocked {
  border-color: #f97316;
  background: #fff7ed;
}

.project-workspace-node--next {
  border-color: #2563eb;
  background: #eff6ff;
}

.project-workspace-node.is-highlighted,
.project-workspace-link.is-highlighted {
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
}

.project-workspace-window-list {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.project-workspace-window {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid #d7e0ef;
  border-left: 5px solid #94a3b8;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  text-align: left;
  cursor: pointer;
}

.project-workspace-window--progress {
  border-left-color: #22c55e;
  background: #f0fdf4;
}

.project-workspace-window--blocked {
  border-left-color: #f97316;
  background: #fff7ed;
}

.project-workspace-window--next {
  border-left-color: #2563eb;
  background: #eff6ff;
}

.project-workspace-window time,
.project-workspace-window span,
.project-workspace-window small,
.project-workspace-empty {
  color: #64748b;
}
```

- [ ] **Step 4: Run the Web build**

Run:

```powershell
rtk err "npm run web:build"
```

Expected: build succeeds and `project-workspace.css` is copied to `web/dist/client/assets/styles/project-workspace.css`.

- [ ] **Step 5: Commit styling**

```powershell
git add web/client/assets/styles/project-workspace.css web/client/index.html
git commit -m "style: add project workspace execution layout"
```

---

### Task 5: Update Documentation and Final Verification

**Files:**
- Modify: `docs/project-log.md`

- [ ] **Step 1: Update the current interface description**

In the `工作台页` section, add one concise paragraph:

```md
项目工作区入口现在不再显示普通 Wiki 文档占位页，而是显示项目执行室：左侧为 `领域 -> 项目 -> 任务 -> 行动` 的执行层级图，节点之间用细直角分层线表达归属和推进关系；右侧为今日项目推进窗口，只展示今天用于推进项目的时间块，并且每个时间块都能追溯到左侧任务或行动节点。左右两栏之间可拖拽调整宽度。
```

- [ ] **Step 2: Add a timeline entry**

At the top of `## 时间线`, add:

```md
### [2026-05-03 HH:mm] 项目工作区改为执行层级图

- 修改内容：项目工作区入口改为双栏项目执行室，左侧展示 `领域 -> 项目 -> 任务 -> 行动` 的执行层级图，右侧展示今日项目推进窗口。
- 修改内容：层级图使用细直角分层线连接节点，任务和行动节点显示推进、卡点、下一步和已记录状态；点击右侧时间窗口会高亮左侧对应任务节点。
- 验证结果：工作台页面测试、TypeScript、构建、完整测试和 fallow 均通过。
```

Replace `HH:mm` with the local time from:

```powershell
Get-Date -Format "yyyy-MM-dd HH:mm"
```

- [ ] **Step 3: Run focused verification**

Run:

```powershell
rtk test "npx vitest run test/web-workspace-page.test.ts"
```

Expected: all tests in `test/web-workspace-page.test.ts` pass.

- [ ] **Step 4: Run required project checks**

Run:

```powershell
rtk tsc --noEmit
rtk err "npm run build"
rtk test "npm test"
rtk err "fallow"
```

Expected:

- TypeScript: no errors.
- Build: succeeds.
- Tests: pass; existing `punycode` deprecation warnings are acceptable.
- Fallow: no dead code, no duplication, no complexity threshold failures.

- [ ] **Step 5: Rebuild the WebUI bundle and verify assets**

Run:

```powershell
rtk err "npm run web:build"
```

Then verify the local server serves the new CSS:

```powershell
$css = (Invoke-WebRequest -Uri "http://127.0.0.1:4175/assets/styles/project-workspace.css" -UseBasicParsing).Content
[pscustomobject]@{
  hasLayout = $css.Contains("project-workspace__layout")
  hasLink = $css.Contains("project-workspace-link")
}
```

Expected: `hasLayout` and `hasLink` are both `True`.

- [ ] **Step 6: Commit docs and verification-ready changes**

```powershell
git add docs/project-log.md
git commit -m "docs: document project workspace execution view"
```

## Self-Review

- Spec coverage: The plan covers the two-pane layout, draggable divider, execution hierarchy graph, thin orthogonal connectors, project time windows, Graphy boundary, and implementation constraints from the design spec.
- Placeholder scan: The plan contains no TBD/TODO placeholders. Every task has concrete file paths, code snippets, commands, and expected results.
- Type consistency: `ProjectWorkspacePoolItem`, `ProjectWorkspaceWorkflowLogEntry`, and status names are defined before use. The integration passes `TaskPlanPoolItem[]` into renderer code that accepts a compatible minimal item shape.
