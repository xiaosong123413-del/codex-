/**
 * Workflow recorder task selection.
 *
 * The desktop quick recorder should bind only to real task-pool tasks. This
 * helper keeps the ranking rule testable: today's scheduled tasks first, then
 * near due tasks, then current/high-priority/recent task-pool work.
 */

export interface WorkflowRecorderTask {
  id: string;
  title: string;
  domain: string;
  project: string;
  badge: string;
}

interface SelectWorkflowRecorderTasksOptions {
  limit?: number;
  today?: Date;
}

interface RawTaskPoolItem {
  id: string;
  title: string;
  domain: string;
  project: string;
  priority: string;
  zone: string;
  createdAt: string;
  completedAt: string;
  dueDate: string;
}

interface ScheduleEntry {
  id: string;
  title: string;
  startTime: string;
  order: number;
}

interface RankedTask {
  item: RawTaskPoolItem;
  index: number;
  schedule: ScheduleEntry | null;
  nearDueTime: number | null;
  dueTime: number | null;
  createdTime: number | null;
}

const NEAR_DUE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function selectWorkflowRecorderTasks(
  state: unknown,
  options: SelectWorkflowRecorderTasksOptions = {},
): WorkflowRecorderTask[] {
  const today = options.today ?? new Date();
  const scheduleEntries = readScheduleEntries(state);
  const rankedTasks = readTaskPoolItems(state)
    .filter((item) => item.id && item.title && !item.completedAt)
    .map((item, index) => rankTask(item, index, scheduleEntries, today))
    .sort(compareRankedTasks);

  return applyTaskLimit(rankedTasks, options.limit)
    .map((task) => toWorkflowRecorderTask(task, today));
}

function applyTaskLimit(tasks: RankedTask[], limit: number | undefined): RankedTask[] {
  return typeof limit === "number" ? tasks.slice(0, Math.max(0, limit)) : tasks;
}

function rankTask(
  item: RawTaskPoolItem,
  index: number,
  scheduleEntries: readonly ScheduleEntry[],
  today: Date,
): RankedTask {
  const dueTime = readDueTime(item.dueDate, today);
  return {
    item,
    index,
    schedule: findScheduleEntry(item, scheduleEntries),
    nearDueTime: readNearDueTime(dueTime, today),
    dueTime,
    createdTime: readDateTime(item.createdAt),
  };
}

function compareRankedTasks(left: RankedTask, right: RankedTask): number {
  return compareSchedule(left.schedule, right.schedule)
    || compareNullableAsc(left.nearDueTime, right.nearDueTime)
    || zoneRank(left.item.zone) - zoneRank(right.item.zone)
    || priorityRank(left.item.priority) - priorityRank(right.item.priority)
    || compareNullableDesc(left.createdTime, right.createdTime)
    || left.index - right.index;
}

function toWorkflowRecorderTask(task: RankedTask, today: Date): WorkflowRecorderTask {
  return {
    id: task.item.id,
    title: task.item.title,
    domain: task.item.domain,
    project: task.item.project,
    badge: readTaskBadge(task, today),
  };
}

function readTaskPoolItems(state: unknown): RawTaskPoolItem[] {
  const items = readRecord(readRecord(state)?.pool)?.items;
  if (!Array.isArray(items)) return [];
  return items.map(readTaskPoolItem).filter((item): item is RawTaskPoolItem => item !== null);
}

function readTaskPoolItem(value: unknown): RawTaskPoolItem | null {
  const record = readRecord(value);
  if (!record) return null;
  return {
    id: readString(record.id),
    title: readString(record.title),
    domain: readString(record.domain),
    project: readString(record.project),
    priority: readString(record.priority),
    zone: readString(record.zone),
    createdAt: readString(record.createdAt),
    completedAt: readString(record.completedAt),
    dueDate: readString(record.dueDate),
  };
}

function readScheduleEntries(state: unknown): ScheduleEntry[] {
  const items = readRecord(readRecord(state)?.schedule)?.items;
  if (!Array.isArray(items)) return [];
  return items.map(readScheduleEntry).filter((item): item is ScheduleEntry => item !== null);
}

function readScheduleEntry(value: unknown, index: number): ScheduleEntry | null {
  const record = readRecord(value);
  if (!record) return null;
  const title = readString(record.title);
  if (!title) return null;
  return {
    id: readString(record.id),
    title,
    startTime: readString(record.startTime),
    order: readScheduleOrder(readString(record.startTime), index),
  };
}

function findScheduleEntry(item: RawTaskPoolItem, entries: readonly ScheduleEntry[]): ScheduleEntry | null {
  const normalizedTitle = normalizeText(item.title);
  return entries.find((entry) =>
    (entry.id && entry.id === item.id) || normalizeText(entry.title) === normalizedTitle
  ) ?? null;
}

function readScheduleOrder(startTime: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 24 * 60 + fallback;
}

function readDueTime(value: string, today: Date): number | null {
  if (!value || value === "未设截止") return null;
  const fullDate = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (fullDate) return localDateTime(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]));
  const monthDay = /^(\d{1,2})[-/](\d{1,2})/.exec(value);
  return monthDay ? localDateTime(today.getFullYear(), Number(monthDay[1]), Number(monthDay[2])) : null;
}

function readNearDueTime(dueTime: number | null, today: Date): number | null {
  if (dueTime === null) return null;
  const todayStart = localDayStart(today);
  const nearDueLimit = todayStart + NEAR_DUE_DAYS * DAY_MS;
  return dueTime <= nearDueLimit ? dueTime : null;
}

function readTaskBadge(task: RankedTask, today: Date): string {
  if (task.schedule) return task.schedule.startTime ? `今天 ${task.schedule.startTime}` : "今天";
  if (task.nearDueTime !== null) return readNearDueBadge(task.nearDueTime, today);
  if (readZone(task.item.zone) === "mine") return "当前任务";
  return priorityRank(task.item.priority) <= 1 ? "高优先级" : "";
}

function readNearDueBadge(dueTime: number, today: Date): string {
  const todayStart = localDayStart(today);
  if (dueTime < todayStart) return "已逾期";
  if (dueTime === todayStart) return "今天截止";
  return "近期截止";
}

function compareSchedule(left: ScheduleEntry | null, right: ScheduleEntry | null): number {
  if (left && right) return left.order - right.order;
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function compareNullableAsc(left: number | null, right: number | null): number {
  if (left !== null && right !== null) return left - right;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left !== null && right !== null) return right - left;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

function priorityRank(value: string): number {
  if (value === "high") return 0;
  if (value === "mid" || value === "cool") return 1;
  if (value === "low") return 2;
  return 3;
}

function zoneRank(value: string): number {
  const zone = readZone(value);
  if (zone === "mine") return 0;
  if (zone === "ai") return 1;
  return 2;
}

function readZone(value: string): "mine" | "ai" | "candidate" {
  return value === "mine" || value === "ai" || value === "candidate" ? value : "mine";
}

function readDateTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function localDateTime(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

function localDayStart(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
