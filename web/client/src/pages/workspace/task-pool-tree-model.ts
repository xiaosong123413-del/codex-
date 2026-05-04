/**
 * Pure task-pool tree model helpers for the workspace page.
 *
 * The shared task pool is still persisted as a flat `TaskPlanPoolItem[]`, but the
 * tree view needs a normalized hierarchy with stable labels for unnamed domains
 * and projects. This module centralizes that mapping so the page runtime can reuse
 * the same rules for filtering, rendering, and future tree interactions without
 * duplicating grouping logic inside the main workspace page module.
 */
import type { TaskPlanPoolItem } from "./index.js";

export type TaskPoolTreeLevel = "domain" | "project" | "task";
type TaskPoolTreeNodeType = TaskPoolTreeLevel;

export interface TaskPoolTreeNodeIdentity {
  readonly type: TaskPoolTreeNodeType;
  readonly domain: string;
  readonly project: string;
  readonly taskId: string | null;
}

export interface TaskPoolTreeTaskNode {
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly project: string;
}

export interface TaskPoolTreeProjectNode {
  readonly label: string;
  readonly domain: string;
  readonly tasks: readonly TaskPoolTreeTaskNode[];
}

export interface TaskPoolTreeDomainNode {
  readonly label: string;
  readonly projects: readonly TaskPoolTreeProjectNode[];
}

export interface TaskPoolTreeOption {
  readonly key: string;
  readonly label: string;
}

export const TASK_POOL_UNGROUPED_DOMAIN = "未归类";
export const TASK_POOL_UNGROUPED_PROJECT = "待分组";

/**
 * Returns the display label used for the item's domain in the tree.
 */
export function getTaskPoolDomainName(item: TaskPlanPoolItem): string {
  return item.domain?.trim() || TASK_POOL_UNGROUPED_DOMAIN;
}

/**
 * Returns the display label used for the item's project in the tree.
 */
function getTaskPoolProjectName(item: TaskPlanPoolItem): string {
  return item.project?.trim() || TASK_POOL_UNGROUPED_PROJECT;
}

/**
 * Returns the stable checkbox key for a project option under a specific domain.
 */
export function getTaskPoolProjectOptionKey(domain: string, project: string): string {
  return `${encodeURIComponent(domain)}::${encodeURIComponent(project)}`;
}

/**
 * Builds the checkbox/filter option list for the current tree level.
 */
export function getTaskPoolTreeOptions(
  items: readonly TaskPlanPoolItem[],
  level: TaskPoolTreeLevel,
): TaskPoolTreeOption[] {
  if (level === "domain") {
    return buildTaskPoolTreeOptions(items, getTaskPoolDomainName);
  }
  if (level === "project") {
    return buildTaskPoolProjectOptions(items);
  }
  return items
    .filter((item) => item.title)
    .map((item) => ({
      key: item.id,
      label: item.title,
    }));
}

/**
 * Applies the current tree-level checkbox selection to the flat shared pool items.
 */
export function filterTaskPoolTreeItems(
  items: readonly TaskPlanPoolItem[],
  level: TaskPoolTreeLevel,
  selectedOptionKeys: readonly string[],
): TaskPlanPoolItem[] {
  if (selectedOptionKeys.length === 0) {
    return [];
  }
  return items.filter((item) => {
    if (level === "domain") {
      return selectedOptionKeys.includes(getTaskPoolDomainName(item));
    }
    if (level === "project") {
      return selectedOptionKeys.includes(
        getTaskPoolProjectOptionKey(getTaskPoolDomainName(item), getTaskPoolProjectName(item)),
      );
    }
    return selectedOptionKeys.includes(item.id);
  });
}

function buildTaskPoolProjectOptions(
  items: readonly TaskPlanPoolItem[],
): TaskPoolTreeOption[] {
  const uniqueProjects: Array<{ key: string; domain: string; project: string }> = [];
  const seenKeys = new Set<string>();
  for (const item of items) {
    const domain = getTaskPoolDomainName(item);
    const project = getTaskPoolProjectName(item);
    const key = getTaskPoolProjectOptionKey(domain, project);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    uniqueProjects.push({ key, domain, project });
  }
  const projectLabelCounts = new Map<string, number>();
  for (const option of uniqueProjects) {
    const project = option.project;
    projectLabelCounts.set(project, (projectLabelCounts.get(project) ?? 0) + 1);
  }
  const options: TaskPoolTreeOption[] = [];
  for (const option of uniqueProjects) {
    options.push({
      key: option.key,
      label:
        (projectLabelCounts.get(option.project) ?? 0) > 1
          ? `${option.project}（${option.domain}）`
          : option.project,
    });
  }
  return options;
}

function buildTaskPoolTreeOptions(
  items: readonly TaskPlanPoolItem[],
  getLabel: (item: TaskPlanPoolItem) => string,
): TaskPoolTreeOption[] {
  const seenKeys = new Set<string>();
  const options: TaskPoolTreeOption[] = [];
  for (const item of items) {
    const label = getLabel(item);
    if (!label || seenKeys.has(label)) {
      continue;
    }
    seenKeys.add(label);
    options.push({
      key: label,
      label,
    });
  }
  return options;
}

/**
 * Converts the flat shared pool into a domain -> project -> task hierarchy while
 * preserving the original insertion order from the persisted array.
 */
export function buildTaskPoolTreeHierarchy(
  items: readonly TaskPlanPoolItem[],
): TaskPoolTreeDomainNode[] {
  const domainMap = new Map<string, Map<string, TaskPoolTreeTaskNode[]>>();
  for (const item of items) {
    const domain = getTaskPoolDomainName(item);
    const project = getTaskPoolProjectName(item);
    const projectMap = domainMap.get(domain) ?? new Map<string, TaskPoolTreeTaskNode[]>();
    const tasks = projectMap.get(project) ?? [];
    tasks.push({
      id: item.id,
      title: item.title,
      domain,
      project,
    });
    projectMap.set(project, tasks);
    domainMap.set(domain, projectMap);
  }
  return Array.from(domainMap.entries()).map(([label, projects]) => ({
    label,
    projects: Array.from(projects.entries()).map(([projectLabel, tasks]) => ({
      label: projectLabel,
      domain: label,
      tasks,
    })),
  }));
}

/**
 * Returns whether the given node can enter the generic inline rename flow.
 */
export function canRenameTaskPoolTreeNode(node: TaskPoolTreeNodeIdentity): boolean {
  if (node.type === "domain") {
    return node.domain !== TASK_POOL_UNGROUPED_DOMAIN;
  }
  if (node.type === "project") {
    return node.project !== TASK_POOL_UNGROUPED_PROJECT;
  }
  return true;
}

/**
 * Returns whether the given node can be deleted from the tree keyboard flow.
 */
export function canDeleteTaskPoolTreeNode(node: TaskPoolTreeNodeIdentity): boolean {
  if (node.type === "domain") {
    return node.domain !== TASK_POOL_UNGROUPED_DOMAIN;
  }
  if (node.type === "project") {
    return node.project !== TASK_POOL_UNGROUPED_PROJECT;
  }
  return true;
}

/**
 * Reads the current draft label represented by the given tree node.
 */
export function getTaskPoolTreeNodeLabel(
  items: readonly TaskPlanPoolItem[],
  node: TaskPoolTreeNodeIdentity,
): string {
  if (node.type === "task") {
    return items.find((item) => item.id === node.taskId)?.title ?? "";
  }
  if (node.type === "project") {
    return node.project;
  }
  return node.domain;
}

/**
 * Renames the tasks represented by a selected tree node in the shared pool draft.
 */
export function renameTaskPoolTreeNode(
  items: readonly TaskPlanPoolItem[],
  node: TaskPoolTreeNodeIdentity,
  nextValue: string,
): TaskPlanPoolItem[] {
  const normalizedValue = normalizeTaskPoolTreeField(nextValue);
  if (node.type === "task" && node.taskId) {
    return items.map((item) => (item.id === node.taskId ? { ...item, title: normalizedValue ?? "" } : item));
  }
  if (node.type === "project") {
    return items.map((item) =>
      isSameTaskPoolProject(item, node) ? { ...item, project: normalizedValue } : item,
    );
  }
  return items.map((item) =>
    isSameTaskPoolDomain(item, node) ? { ...item, domain: normalizedValue } : item,
  );
}

/**
 * Deletes the selected node without dropping unaffected task data.
 */
export function deleteTaskPoolTreeNode(
  items: readonly TaskPlanPoolItem[],
  node: TaskPoolTreeNodeIdentity,
): TaskPlanPoolItem[] {
  if (!canDeleteTaskPoolTreeNode(node)) {
    return [...items];
  }
  if (node.type === "task" && node.taskId) {
    return items.filter((item) => item.id !== node.taskId);
  }
  if (node.type === "project") {
    return items.map((item) =>
      isSameTaskPoolProject(item, node) ? { ...item, project: undefined } : item,
    );
  }
  return items.map((item) =>
    isSameTaskPoolDomain(item, node) ? { ...item, domain: undefined, project: undefined } : item,
  );
}

/**
 * Adds a new task below the selected node and returns the next editor focus target.
 */
export function addTaskPoolTreeChild(
  items: readonly TaskPlanPoolItem[],
  node: TaskPoolTreeNodeIdentity,
  nextId: string,
): {
  items: TaskPlanPoolItem[];
  focus: TaskPoolTreeNodeIdentity;
} {
  if (node.type === "domain") {
    const nextTask = createTaskPoolDraftTask(
      nextId,
      node.domain === TASK_POOL_UNGROUPED_DOMAIN ? undefined : node.domain,
      undefined,
    );
    return {
      items: [...items, nextTask],
      focus: {
        type: "project",
        domain: getTaskPoolDomainName(nextTask),
        project: TASK_POOL_UNGROUPED_PROJECT,
        taskId: null,
      },
    };
  }
  if (node.type === "project") {
    const nextTask = createTaskPoolDraftTask(
      nextId,
      node.domain === TASK_POOL_UNGROUPED_DOMAIN ? undefined : node.domain,
      node.project === TASK_POOL_UNGROUPED_PROJECT ? undefined : node.project,
    );
    return {
      items: [...items, nextTask],
      focus: {
        type: "task",
        domain: getTaskPoolDomainName(nextTask),
        project: getTaskPoolProjectName(nextTask),
        taskId: nextTask.id,
      },
    };
  }
  const currentTask = items.find((item) => item.id === node.taskId);
  const nextTask = createTaskPoolDraftTask(nextId, currentTask?.domain, currentTask?.project);
  return {
    items: [...items, nextTask],
    focus: {
      type: "task",
      domain: getTaskPoolDomainName(nextTask),
      project: getTaskPoolProjectName(nextTask),
      taskId: nextTask.id,
    },
  };
}

/**
 * Re-links a task to the target project branch while preserving the flat pool shape.
 */
export function moveTaskPoolTaskToProject(
  items: readonly TaskPlanPoolItem[],
  taskId: string,
  targetDomain: string,
  targetProject: string,
): TaskPlanPoolItem[] {
  return items.map((item) =>
    item.id === taskId
      ? {
          ...item,
          domain: targetDomain === TASK_POOL_UNGROUPED_DOMAIN ? undefined : targetDomain,
          project: targetProject === TASK_POOL_UNGROUPED_PROJECT ? undefined : targetProject,
        }
      : item,
  );
}

function createTaskPoolDraftTask(
  id: string,
  domain: string | undefined,
  project: string | undefined,
): TaskPlanPoolItem {
  return {
    id,
    title: "",
    priority: "neutral",
    source: "手动新增",
    domain,
    project,
    createdAt: new Date().toISOString(),
  };
}

function normalizeTaskPoolTreeField(value: string): string | undefined {
  const trimmedValue = value.trim();
  return trimmedValue || undefined;
}

function isSameTaskPoolDomain(
  item: TaskPlanPoolItem,
  node: TaskPoolTreeNodeIdentity,
): boolean {
  return getTaskPoolDomainName(item) === node.domain;
}

function isSameTaskPoolProject(
  item: TaskPlanPoolItem,
  node: TaskPoolTreeNodeIdentity,
): boolean {
  return isSameTaskPoolDomain(item, node) && getTaskPoolProjectName(item) === node.project;
}
