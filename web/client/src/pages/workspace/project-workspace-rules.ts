/**
 * Ordering and lifecycle rules for the project workspace graph.
 *
 * The renderer uses these pure helpers to keep initial priority sorting,
 * manual ordering, and task state labels consistent across the graph.
 */
export type ProjectWorkspaceLifecycle = "done" | "active" | "uncertain";
export type ProjectWorkspacePriority = "high" | "mid" | "low" | "cool" | "neutral";

interface ProjectWorkspaceRuleItem {
  readonly id: string;
  readonly title: string;
  readonly priority: ProjectWorkspacePriority;
  readonly projectOrder?: number;
  readonly completedAt?: string;
  readonly currentProgress?: string;
  readonly lastStop?: string;
}

interface ProjectWorkspaceScheduleMatch {
  readonly id: string;
  readonly title: string;
}

export function sortProjectItems<T extends ProjectWorkspaceRuleItem>(items: readonly T[]): T[] {
  return [...items].sort(compareProjectItems);
}

export function isTaskScheduled(
  item: ProjectWorkspaceScheduleMatch,
  scheduleItems: readonly ProjectWorkspaceScheduleMatch[],
): boolean {
  return scheduleItems.some((schedule) => schedule.id === item.id || schedule.title.trim() === item.title.trim());
}

export function taskLifecycle(item: ProjectWorkspaceRuleItem, scheduled: boolean): ProjectWorkspaceLifecycle {
  if (item.completedAt?.trim()) return "done";
  if (scheduled || item.currentProgress?.trim() || item.lastStop?.trim()) return "active";
  return "uncertain";
}

export function aggregateLifecycle(
  lifecycles: readonly ProjectWorkspaceLifecycle[],
): ProjectWorkspaceLifecycle {
  if (lifecycles.length > 0 && lifecycles.every((item) => item === "done")) return "done";
  return lifecycles.includes("active") ? "active" : "uncertain";
}

export function lifecycleLabel(lifecycle: ProjectWorkspaceLifecycle): string {
  return { done: "已完成", active: "正在进行", uncertain: "未确定" }[lifecycle];
}

function compareProjectItems(left: ProjectWorkspaceRuleItem, right: ProjectWorkspaceRuleItem): number {
  const manual = compareOptionalNumbers(left.projectOrder, right.projectOrder);
  return manual || priorityRank(right.priority) - priorityRank(left.priority) || left.title.localeCompare(right.title);
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (Number.isFinite(left) && Number.isFinite(right)) return Number(left) - Number(right);
  if (Number.isFinite(left)) return -1;
  return Number.isFinite(right) ? 1 : 0;
}

function priorityRank(priority: ProjectWorkspacePriority): number {
  return { high: 4, mid: 3, cool: 2, low: 1, neutral: 0 }[priority] ?? 0;
}
