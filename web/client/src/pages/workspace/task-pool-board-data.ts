/**
 * Task-pool board data helpers.
 *
 * The task-pool board uses these pure helpers to classify, group, and sort
 * tasks before rendering. Keeping this logic separate makes the board renderer
 * easier to scan and keeps the same rules available to task-plan previews.
 */

export type TaskPoolBoardZone = "mine" | "ai" | "candidate";
export type TaskPoolBoardGroupMode = "none" | "project" | "priority";
export type TaskPoolBoardGroupModes = Record<TaskPoolBoardZone, TaskPoolBoardGroupMode>;
export type TaskPoolBoardSortMode =
  | "created-desc"
  | "created-asc"
  | "due-asc"
  | "due-desc"
  | "priority-desc"
  | "priority-asc";

export type TaskPoolBoardSortModes = Record<TaskPoolBoardZone, TaskPoolBoardSortMode>;

export interface TaskPoolBoardItem {
  id: string;
  title: string;
  priority: TaskPoolBoardPriority;
  source: string;
  domain?: string;
  project?: string;
  zone?: TaskPoolBoardZone;
  owner?: "me" | "ai";
  createdAt?: string;
  completedAt?: string;
  dueDate?: string;
  diaryDate?: string;
  generationBatchId?: string;
  generatedReason?: string;
  duplicateOfTitle?: string;
  workflowLog?: Array<{
    id: string;
    recordedAt: string;
    node: string;
    tool: string;
    input: string;
    output: string;
    issue: string;
    nextStep: string;
    attachments: string[];
    sourceRecordId: string;
  }>;
}

type TaskPoolBoardPriority = "high" | "mid" | "low" | "cool" | "neutral";
type NormalizedTaskPoolPriority = "high" | "mid" | "low" | "neutral";

export interface TaskPoolBoardGroup<T extends TaskPoolBoardItem> {
  key: string;
  title: string;
  items: T[];
}

export const TASK_POOL_SORT_LABELS: Record<TaskPoolBoardSortMode, string> = {
  "created-desc": "设立时间近",
  "created-asc": "设立时间远",
  "due-asc": "截止时间近",
  "due-desc": "截止时间远",
  "priority-desc": "优先级高",
  "priority-asc": "优先级低",
};

export const TASK_POOL_GROUP_LABELS: Record<TaskPoolBoardGroupMode, string> = {
  none: "不分组",
  project: "按项目",
  priority: "按优先级",
};

const TASK_POOL_PRIORITY_RANK: Record<NormalizedTaskPoolPriority, number> = {
  high: 4,
  mid: 3,
  low: 2,
  neutral: 1,
};

const TASK_POOL_PRIORITY_GROUP_ORDER: readonly NormalizedTaskPoolPriority[] = ["high", "mid", "low", "neutral"];

export function readTaskPoolBoardZone(item: TaskPoolBoardItem): TaskPoolBoardZone {
  if (item.zone === "mine" || item.zone === "ai" || item.zone === "candidate") {
    return item.zone;
  }
  return item.source === "AI 生成" ? "ai" : "mine";
}

export function groupTaskPoolBoardItems<T extends TaskPoolBoardItem>(
  items: readonly T[],
  groupMode: TaskPoolBoardGroupMode,
): TaskPoolBoardGroup<T>[] {
  if (groupMode === "none") {
    return [{ key: "none", title: "", items: [...items] }];
  }
  const groups = buildTaskPoolBoardGroups(items, groupMode);
  return groupMode === "priority" ? orderPriorityGroups(groups) : groups;
}

export function sortTaskPoolBoardItems<T extends TaskPoolBoardItem>(
  items: readonly T[],
  sortMode: TaskPoolBoardSortMode,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => compareTaskPoolBoardItems(left, right, sortMode))
    .map(({ item }) => item);
}

export function normalizePriority(priority: unknown): NormalizedTaskPoolPriority {
  if (priority === "high" || priority === "mid" || priority === "low") {
    return priority;
  }
  return priority === "cool" ? "mid" : "neutral";
}

export function priorityLabel(priority: NormalizedTaskPoolPriority): string {
  return { high: "高", mid: "中", low: "低", neutral: "低" }[priority];
}

function buildTaskPoolBoardGroups<T extends TaskPoolBoardItem>(
  items: readonly T[],
  groupMode: Exclude<TaskPoolBoardGroupMode, "none">,
): TaskPoolBoardGroup<T>[] {
  const groups: TaskPoolBoardGroup<T>[] = [];
  const groupIndexes = new Map<string, number>();
  for (const item of items) {
    const group = readTaskPoolBoardGroup(item, groupMode);
    const existingIndex = groupIndexes.get(group.key);
    if (existingIndex === undefined) {
      groupIndexes.set(group.key, groups.length);
      groups.push({ ...group, items: [item] });
      continue;
    }
    groups[existingIndex]?.items.push(item);
  }
  return groups;
}

function readTaskPoolBoardGroup(
  item: TaskPoolBoardItem,
  groupMode: Exclude<TaskPoolBoardGroupMode, "none">,
): { key: string; title: string } {
  if (groupMode === "priority") {
    const priority = normalizePriority(item.priority);
    return { key: priority, title: `${priorityLabel(priority)}优先级` };
  }
  const title = item.project || item.domain || "未分项目";
  return { key: title, title };
}

function orderPriorityGroups<T extends TaskPoolBoardItem>(
  groups: readonly TaskPoolBoardGroup<T>[],
): TaskPoolBoardGroup<T>[] {
  return TASK_POOL_PRIORITY_GROUP_ORDER
    .map((priority) => groups.find((group) => group.key === priority))
    .filter((group): group is TaskPoolBoardGroup<T> => Boolean(group));
}

function compareTaskPoolBoardItems(
  left: { item: TaskPoolBoardItem; index: number },
  right: { item: TaskPoolBoardItem; index: number },
  sortMode: TaskPoolBoardSortMode,
): number {
  if (sortMode === "created-desc" || sortMode === "created-asc") {
    return compareNumbers(readCreatedTime(left), readCreatedTime(right), sortMode === "created-desc");
  }
  if (sortMode === "due-asc" || sortMode === "due-desc") {
    return compareOptionalNumbers(readDueTime(left.item), readDueTime(right.item), sortMode === "due-desc", left.index, right.index);
  }
  const priority = compareNumbers(
    TASK_POOL_PRIORITY_RANK[normalizePriority(left.item.priority)],
    TASK_POOL_PRIORITY_RANK[normalizePriority(right.item.priority)],
    sortMode === "priority-desc",
  );
  return priority || left.index - right.index;
}

function readCreatedTime(item: { item: TaskPoolBoardItem; index: number }): number {
  const createdAtTime = readDateTime(item.item.createdAt);
  if (createdAtTime !== null) {
    return createdAtTime;
  }
  const batchTime = /^task-pool-generation-(\d+)$/.exec(item.item.generationBatchId ?? "")?.[1];
  return batchTime ? Number(batchTime) : -item.index;
}

function readDueTime(item: TaskPoolBoardItem): number | null {
  const raw = item.dueDate?.trim();
  if (!raw || raw === "未设截止") {
    return null;
  }
  const fullDate = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (fullDate) {
    return Date.UTC(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]));
  }
  const monthDay = /^(\d{1,2})[-/](\d{1,2})/.exec(raw);
  return monthDay ? Date.UTC(new Date().getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2])) : null;
}

function readDateTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function compareNumbers(left: number, right: number, desc: boolean): number {
  return desc ? right - left : left - right;
}

function compareOptionalNumbers(
  left: number | null,
  right: number | null,
  desc: boolean,
  leftIndex: number,
  rightIndex: number,
): number {
  if (left === null && right === null) {
    return leftIndex - rightIndex;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return compareNumbers(left, right, desc) || leftIndex - rightIndex;
}
