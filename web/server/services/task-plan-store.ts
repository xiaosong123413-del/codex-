import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_TASK_PLAN_STORAGE_ROOT = "D:\\Desktop\\ai的仓库\\task plan";

const STATE_FILE_NAME = "state.json";

export interface TaskPlanStoreOptions {
  storageRoot?: string;
}

export type TaskPlanPriority = "high" | "mid" | "low" | "cool" | "neutral";
export type TaskPlanTaskSource = "文字输入" | "近日状态" | "闪念日记" | "工作日志" | "AI 生成" | "手动新增";
export type TaskPoolZone = "mine" | "ai" | "candidate";
export type TaskPoolOwner = "me" | "ai";

interface TaskPlanVoiceState {
  transcript: string;
  audioPath: string | null;
  updatedAt: string | null;
}

export interface TaskPlanPoolItem {
  id: string;
  title: string;
  priority: TaskPlanPriority;
  source: TaskPlanTaskSource;
  domain?: string;
  project?: string;
  stageId?: string;
  projectOrder?: number;
  taskOrder?: number;
  zone?: TaskPoolZone;
  owner?: TaskPoolOwner;
  createdAt?: string;
  completedAt?: string;
  dueDate?: string;
  diaryDate?: string;
  generationBatchId?: string;
  generatedReason?: string;
  duplicateOfTitle?: string;
  currentProgress?: string;
  lastStop?: string;
  nextStep?: string;
  linkedCases?: string[];
  linkedResources?: string[];
  linkedMethods?: string[];
  sourceRefs?: string[];
  workflowLog?: TaskWorkflowLogEntry[];
  actions?: TaskPlanActionItem[];
}

export interface TaskPlanStageItem {
  id: string;
  title: string;
  domain: string;
  project: string;
  order: number;
}

export interface TaskPlanActionItem {
  id: string;
  title: string;
  order: number;
  completedAt?: string;
}

export interface TaskWorkflowLogEntry {
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
}

export interface TaskPoolGenerationRecord {
  id: string;
  generatedAt: string;
  diaryPaths: string[];
  diaryDates: string[];
  createdTaskIds: string[];
  skippedDuplicateTitles: string[];
}

interface TaskPlanPoolState {
  items: TaskPlanPoolItem[];
  stages: TaskPlanStageItem[];
  generationRecords: TaskPoolGenerationRecord[];
}

export interface TaskPlanScheduleItem {
  id: string;
  title: string;
  startTime: string;
  priority: TaskPlanPriority;
}

export interface TaskPlanScheduleState {
  generationId: string | null;
  revisionId: string | null;
  items: TaskPlanScheduleItem[];
  confirmed: boolean;
}

interface TaskPlanRoadmapEntry {
  id: string;
  title: string;
}

interface TaskPlanRoadmapGroup {
  id: string;
  title: string;
  items: TaskPlanRoadmapEntry[];
}

export interface TaskPlanRoadmapState {
  view: "week";
  windowStart: string;
  topLabel: string;
  windowLabel: string;
  groups: TaskPlanRoadmapGroup[];
}

interface TaskPlanMorningFlowState {
  voiceDone: boolean;
  diaryDone: boolean;
  planningDone: boolean;
  fineTuneDone: boolean;
}

export interface TaskPlanState {
  voice: TaskPlanVoiceState;
  pool: TaskPlanPoolState;
  schedule: TaskPlanScheduleState;
  roadmap: TaskPlanRoadmapState;
  statusSummary: string;
  morningFlow: TaskPlanMorningFlowState;
}

interface TaskPlanStoreSnapshot {
  state: TaskPlanState;
}

export async function bootstrapTaskPlanStore(
  options: TaskPlanStoreOptions = {},
): Promise<TaskPlanStoreSnapshot> {
  const storageRoot = resolveStorageRoot(options);
  await mkdir(storageRoot, { recursive: true });
  const state = await readTaskPlanState(options);
  return { state };
}

export async function readTaskPlanState(
  options: TaskPlanStoreOptions = {},
): Promise<TaskPlanState> {
  const filePath = getStatePath(resolveStorageRoot(options));
  if (!existsSync(filePath)) {
    const state = normalizeTaskPlanState(createDefaultTaskPlanState());
    await writeJson(filePath, state);
    return state;
  }

  const stored = await readJsonFile<Partial<TaskPlanState>>(filePath);
  return normalizeTaskPlanState(stored);
}

export async function writeTaskPlanState(
  state: TaskPlanState,
  options: TaskPlanStoreOptions = {},
): Promise<TaskPlanState> {
  const normalized = normalizeTaskPlanState(state);
  await writeJson(getStatePath(resolveStorageRoot(options)), normalized);
  return normalized;
}

function createDefaultTaskPlanState(): TaskPlanState {
  const now = "2026-04-24T00:00:00.000Z";
  return {
    voice: {
      transcript: "今天要先完成需求文档，再和产品确认功能逻辑，下午整理用户反馈，晚上复盘。",
      audioPath: null,
      updatedAt: now,
    },
    pool: {
      items: createDefaultPoolItems(),
      stages: [],
      generationRecords: [],
    },
    schedule: {
      generationId: null,
      revisionId: null,
      items: createDefaultScheduleItems(),
      confirmed: false,
    },
    roadmap: {
      view: "week",
      windowStart: "2024-05-01",
      topLabel: "领域 / 产品设计",
      windowLabel: "2024年5月",
      groups: createDefaultRoadmapGroups(),
    },
    statusSummary: "今天聚焦需求确认、反馈整理和晚间复盘，先把高优事项推进到可交付状态。",
    morningFlow: {
      voiceDone: false,
      diaryDone: false,
      planningDone: false,
      fineTuneDone: false,
    },
  };
}

function createDefaultPoolItems(): TaskPlanPoolItem[] {
  return [
    { id: "pool-1", title: "完成需求文档初稿", priority: "high", source: "文字输入", domain: "产品设计", project: "工作台改版" },
    { id: "pool-2", title: "与开发确认功能逻辑", priority: "high", source: "文字输入", domain: "产品设计", project: "任务同步" },
    { id: "pool-3", title: "整理用户反馈并归类", priority: "mid", source: "近日状态", domain: "用户研究", project: "反馈归类" },
    { id: "pool-4", title: "操写项目复盘", priority: "cool", source: "AI 生成", domain: "个人成长", project: "效率系统" },
    { id: "pool-5", title: "复盘今日完成情况", priority: "low", source: "近日状态", domain: "个人成长", project: "日常复盘" },
    { id: "pool-6", title: "整理需求变更记录文档", priority: "low", source: "工作日志", domain: "产品设计", project: "任务同步" },
    { id: "pool-7", title: "准备用户访谈提纲", priority: "low", source: "闪念日记", domain: "用户研究", project: "访谈计划" },
    { id: "pool-8", title: "学习用户研究方法", priority: "low", source: "闪念日记", domain: "用户研究", project: "方法沉淀" },
    { id: "pool-9", title: "优化效率模型逻辑", priority: "cool", source: "AI 生成", domain: "个人成长", project: "效率系统" },
    { id: "pool-10", title: "准备需求汇报材料", priority: "cool", source: "手动新增", domain: "产品设计", project: "视觉梳理" },
    { id: "pool-11", title: "处理邮件与消息", priority: "neutral", source: "工作日志", domain: "个人成长", project: "日常维护" },
  ];
}

function createDefaultScheduleItems(): TaskPlanScheduleItem[] {
  return [
    {
      id: "schedule-1",
      title: "完成需求文档初稿",
      startTime: "09:00",
      priority: "high",
    },
    {
      id: "schedule-2",
      title: "与开发确认功能逻辑",
      startTime: "10:30",
      priority: "high",
    },
    {
      id: "schedule-3",
      title: "整理用户反馈并归类",
      startTime: "14:00",
      priority: "mid",
    },
    {
      id: "schedule-4",
      title: "复盘项目进度",
      startTime: "16:00",
      priority: "cool",
    },
    {
      id: "schedule-5",
      title: "复盘今日完成情况",
      startTime: "19:30",
      priority: "low",
    },
  ];
}

function createDefaultRoadmapGroups(): TaskPlanRoadmapGroup[] {
  return [
    {
      id: "roadmap-group-1",
      title: "1. 产品 & 设计",
      items: [
        { id: "roadmap-item-1", title: "工作台改版" },
        { id: "roadmap-item-2", title: "任务追踪页优化" },
      ],
    },
    {
      id: "roadmap-group-2",
      title: "2. 用户研究",
      items: [
        { id: "roadmap-item-3", title: "用户访谈洞察" },
        { id: "roadmap-item-4", title: "访谈提要" },
      ],
    },
    {
      id: "roadmap-group-3",
      title: "3. 个人成长",
      items: [
        { id: "roadmap-item-5", title: "效率系统复盘" },
        { id: "roadmap-item-6", title: "阅读沉淀" },
      ],
    },
  ];
}

function getStatePath(root: string): string {
  return path.join(root, STATE_FILE_NAME);
}

function resolveStorageRoot(options: TaskPlanStoreOptions): string {
  return options.storageRoot ?? DEFAULT_TASK_PLAN_STORAGE_ROOT;
}

function normalizeTaskPlanState(input: Partial<TaskPlanState>): TaskPlanState {
  const defaults = createDefaultTaskPlanState();
  return {
    voice: normalizeTaskPlanVoice(input, defaults),
    pool: normalizeTaskPlanPool(input, defaults),
    schedule: normalizeTaskPlanSchedule(input, defaults),
    roadmap: normalizeTaskPlanRoadmap(input, defaults),
    statusSummary: typeof input.statusSummary === "string" ? input.statusSummary : defaults.statusSummary,
    morningFlow: normalizeMorningFlow(input, defaults),
  };
}

function normalizeTaskPlanVoice(
  input: Partial<TaskPlanState>,
  defaults: TaskPlanState,
): TaskPlanVoiceState {
  const voice = input.voice;
  return {
    transcript: readStringValue(voice?.transcript, defaults.voice.transcript),
    audioPath: readNullableString(voice?.audioPath, defaults.voice.audioPath),
    updatedAt: readNullableString(voice?.updatedAt, defaults.voice.updatedAt),
  };
}

function normalizeTaskPlanPool(
  input: Partial<TaskPlanState>,
  defaults: TaskPlanState,
): TaskPlanPoolState {
  const pool = input.pool;
  const items = Array.isArray(pool?.items)
    ? pool.items.map((item, index) => normalizeTaskPlanPoolItem(item, defaults.pool.items[index]))
    : defaults.pool.items;
  const stages = Array.isArray(pool?.stages)
    ? pool.stages.map(normalizeTaskPlanStage).filter((stage): stage is TaskPlanStageItem => stage !== null)
    : [];
  const migrated = ensureTaskPlanStages(items, stages);
  return {
    items: migrated.items,
    stages: migrated.stages,
    generationRecords: Array.isArray(pool?.generationRecords)
      ? pool.generationRecords.map(normalizeTaskPoolGenerationRecord)
      : defaults.pool.generationRecords,
  };
}

function normalizeTaskPlanSchedule(
  input: Partial<TaskPlanState>,
  defaults: TaskPlanState,
): TaskPlanScheduleState {
  return {
    generationId: readNullableString(input.schedule?.generationId, defaults.schedule.generationId),
    revisionId: readNullableString(input.schedule?.revisionId, defaults.schedule.revisionId),
    items: Array.isArray(input.schedule?.items) ? input.schedule.items : defaults.schedule.items,
    confirmed: typeof input.schedule?.confirmed === "boolean" ? input.schedule.confirmed : defaults.schedule.confirmed,
  };
}

function normalizeTaskPlanRoadmap(
  input: Partial<TaskPlanState>,
  defaults: TaskPlanState,
): TaskPlanRoadmapState {
  const roadmap = input.roadmap;
  return {
    view: roadmap?.view === "week" ? roadmap.view : defaults.roadmap.view,
    windowStart: readStringValue(roadmap?.windowStart, defaults.roadmap.windowStart),
    topLabel: readStringValue(roadmap?.topLabel, defaults.roadmap.topLabel),
    windowLabel: readStringValue(roadmap?.windowLabel, defaults.roadmap.windowLabel),
    groups: Array.isArray(roadmap?.groups) ? roadmap.groups : defaults.roadmap.groups,
  };
}

function normalizeMorningFlow(
  input: Partial<TaskPlanState>,
  defaults: TaskPlanState,
): TaskPlanMorningFlowState {
  return {
    voiceDone: typeof input.morningFlow?.voiceDone === "boolean" ? input.morningFlow.voiceDone : defaults.morningFlow.voiceDone,
    diaryDone: typeof input.morningFlow?.diaryDone === "boolean" ? input.morningFlow.diaryDone : defaults.morningFlow.diaryDone,
    planningDone:
      typeof input.morningFlow?.planningDone === "boolean" ? input.morningFlow.planningDone : defaults.morningFlow.planningDone,
    fineTuneDone:
      typeof input.morningFlow?.fineTuneDone === "boolean" ? input.morningFlow.fineTuneDone : defaults.morningFlow.fineTuneDone,
  };
}

function readNullableString(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" || value === null ? value : fallback;
}

function readStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeTaskPlanPoolItem(input: unknown, fallback: TaskPlanPoolItem | undefined): TaskPlanPoolItem {
  const defaults = fallback ?? createDefaultPoolItems()[0];
  if (!isRecord(input)) {
    return defaults;
  }
  const item: TaskPlanPoolItem = {
    id: typeof input.id === "string" && input.id.trim() ? input.id : defaults.id,
    title: typeof input.title === "string" && input.title.trim() ? input.title : defaults.title,
    priority: isTaskPlanPriority(input.priority) ? input.priority : defaults.priority,
    source: isTaskPlanTaskSource(input.source) ? input.source : defaults.source,
  };
  assignOptionalTaskPoolFields(item, input);
  return item;
}

function assignOptionalTaskPoolFields(item: TaskPlanPoolItem, input: Record<string, unknown>): void {
  const textFields = [
    "domain",
    "project",
    "stageId",
    "createdAt",
    "completedAt",
    "dueDate",
    "diaryDate",
    "generationBatchId",
    "generatedReason",
    "duplicateOfTitle",
    "currentProgress",
    "lastStop",
    "nextStep",
  ] as const;
  for (const field of textFields) {
    const value = readOptionalText(input[field]);
    if (value) {
      item[field] = value;
    }
  }
  const zone = readTaskPoolZone(input.zone);
  if (zone) item.zone = zone;
  const projectOrder = readOptionalNumber(input.projectOrder);
  if (projectOrder !== undefined) item.projectOrder = projectOrder;
  const taskOrder = readOptionalNumber(input.taskOrder);
  if (taskOrder !== undefined) item.taskOrder = taskOrder;
  const owner = readTaskPoolOwner(input.owner);
  if (owner) item.owner = owner;
  const workflowLog = readTaskWorkflowLog(input.workflowLog);
  if (workflowLog.length > 0) item.workflowLog = workflowLog;
  const actions = readTaskActions(input.actions);
  if (actions.length > 0) item.actions = actions;
  assignOptionalTaskPoolLists(item, input);
}

function normalizeTaskPlanStage(input: unknown): TaskPlanStageItem | null {
  if (!isRecord(input)) return null;
  const id = readOptionalText(input.id);
  const title = readOptionalText(input.title);
  const domain = readOptionalText(input.domain);
  const project = readOptionalText(input.project);
  const order = readOptionalNumber(input.order);
  if (!id || !title || !domain || !project || order === undefined) return null;
  return { id, title, domain, project, order };
}

function ensureTaskPlanStages(
  items: TaskPlanPoolItem[],
  stages: TaskPlanStageItem[],
): { items: TaskPlanPoolItem[]; stages: TaskPlanStageItem[] } {
  const nextStages = [...stages];
  const nextItems = items.map((item) => {
    const domain = item.domain ?? "待分组领域";
    const project = item.project ?? "未归类项目";
    const stageId = item.stageId && nextStages.some((stage) => stage.id === item.stageId)
      ? item.stageId
      : ensureDefaultStage(nextStages, domain, project, defaultStageTitle(item));
    return { ...item, stageId };
  });
  return { items: nextItems, stages: nextStages };
}

function ensureDefaultStage(
  stages: TaskPlanStageItem[],
  domain: string,
  project: string,
  title: string,
): string {
  const existing = stages.find((stage) => stage.domain === domain && stage.project === project && stage.title === title);
  if (existing) return existing.id;
  const projectStages = stages.filter((stage) => stage.domain === domain && stage.project === project);
  const id = `stage:${safeStagePart(domain)}:${safeStagePart(project)}:${safeStagePart(title)}`;
  stages.push({ id, title, domain, project, order: projectStages.length });
  return id;
}

function defaultStageTitle(item: TaskPlanPoolItem): string {
  if (item.completedAt?.trim()) return "已完成";
  if (item.currentProgress?.trim() || item.lastStop?.trim()) return "同步推进";
  return "待推进";
}

function safeStagePart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || "stage";
}

function readTaskActions(value: unknown): TaskPlanActionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(readTaskAction).filter((action): action is TaskPlanActionItem => action !== null);
}

function readTaskAction(value: unknown): TaskPlanActionItem | null {
  if (!isRecord(value)) return null;
  const id = readOptionalText(value.id);
  const title = readOptionalText(value.title);
  const order = readOptionalNumber(value.order);
  if (!id || !title || order === undefined) return null;
  const completedAt = readOptionalText(value.completedAt);
  return completedAt ? { id, title, order, completedAt } : { id, title, order };
}

function assignOptionalTaskPoolLists(item: TaskPlanPoolItem, input: Record<string, unknown>): void {
  const listFields = ["linkedCases", "linkedResources", "linkedMethods", "sourceRefs"] as const;
  for (const field of listFields) {
    const value = readStringArray(input[field]);
    if (value.length > 0) {
      item[field] = value;
    }
  }
}

function readTaskWorkflowLog(value: unknown): TaskWorkflowLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map(readTaskWorkflowLogEntry).filter((entry): entry is TaskWorkflowLogEntry => entry !== null);
}

// fallow-ignore-next-line complexity
function readTaskWorkflowLogEntry(value: unknown): TaskWorkflowLogEntry | null {
  if (!isRecord(value)) return null;
  const id = readOptionalText(value.id);
  const recordedAt = readOptionalText(value.recordedAt);
  if (!id || !recordedAt) return null;
  return {
    id,
    recordedAt,
    node: readOptionalText(value.node) ?? "待整理",
    tool: readOptionalText(value.tool) ?? "未识别",
    input: readOptionalText(value.input) ?? "",
    output: readOptionalText(value.output) ?? "",
    issue: readOptionalText(value.issue) ?? "",
    nextStep: readOptionalText(value.nextStep) ?? "",
    attachments: readStringArray(value.attachments),
    sourceRecordId: readOptionalText(value.sourceRecordId) ?? id,
  };
}

function normalizeTaskPoolGenerationRecord(input: unknown): TaskPoolGenerationRecord {
  const record = isRecord(input) ? input : {};
  return {
    id: readStringValue(record.id, `task-pool-generation-${Date.now()}`),
    generatedAt: readStringValue(record.generatedAt, new Date().toISOString()),
    diaryPaths: readStringArray(record.diaryPaths),
    diaryDates: readStringArray(record.diaryDates),
    createdTaskIds: readStringArray(record.createdTaskIds),
    skippedDuplicateTitles: readStringArray(record.skippedDuplicateTitles),
  };
}

function isTaskPlanPriority(value: unknown): value is TaskPlanPriority {
  return value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral";
}

function isTaskPlanTaskSource(value: unknown): value is TaskPlanTaskSource {
  return value === "文字输入" || value === "近日状态" || value === "闪念日记" || value === "工作日志" || value === "AI 生成"
    || value === "手动新增";
}

function readTaskPoolZone(value: unknown): TaskPoolZone | undefined {
  return value === "mine" || value === "ai" || value === "candidate" ? value : undefined;
}

function readTaskPoolOwner(value: unknown): TaskPoolOwner | undefined {
  return value === "me" || value === "ai" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
