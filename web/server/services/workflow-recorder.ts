/**
 * Global workflow recorder service.
 *
 * The recorder is a light input surface: it receives rough text and optional
 * attachments, binds the record to a task when confidence is high, otherwise
 * keeps it in an inbox for later filing. The task card keeps current status,
 * and the project work-log keeps the chronological process page.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { ServerConfig } from "../config.js";
import {
  readTaskPlanState,
  writeTaskPlanState,
  type TaskPlanPoolItem,
  type TaskWorkflowLogEntry,
} from "./task-plan-store.js";
import { appendCaseFromWorkflow } from "./case-library.js";
import { appendProjectWorkLog } from "./project-work-log.js";
import { upsertToolboxCandidateAsset } from "../routes/toolbox.js";

const INBOX_FILE_NAME = "workflow-recorder-inbox.json";
const EVENT_FILE_NAME = "workflow-events.json";
const RESOURCE_CANDIDATES_FILE_NAME = "workflow-resource-candidates.json";
const VALIDATION_CANDIDATES_FILE_NAME = "workflow-validation-candidates.json";
const METHOD_CANDIDATES_FILE_NAME = "workflow-method-candidates.json";
const METHOD_PENDING_FOLDER = "02-方法库/待验证";
const PROBLEM_SIGNALS = ["失败", "卡住", "不行", "报错", "解决", "终于", "换工具", "错误", "太空", "太文字化"];
const VALIDATION_SIGNALS = ["教程", "验证", "资料", "部分错误", "部分对", "按教程"];
const METHOD_SIGNALS = ["流程", "方法", "稳定方法", "沉淀", "复用"];

interface WorkflowRecordInput {
  text: string;
  taskId?: string;
  attachments: string[];
  marker: "normal" | "issue" | "resolved" | "method" | "end-node";
  source?: "execution_recorder" | "diary";
}

interface WorkflowArchiveInput {
  recordId: string;
  taskId: string;
}

interface WorkflowCandidate {
  taskId: string;
  title: string;
  score: number;
}

type WorkflowConfidence = "high" | "medium" | "low";

interface WorkflowEventTaskContext {
  area: string;
  project: string;
  task: string;
}

interface WorkflowInboxRecord {
  id: string;
  eventId: string;
  text: string;
  attachments: string[];
  marker: WorkflowRecordInput["marker"];
  candidates: WorkflowCandidate[];
  confidence: WorkflowConfidence;
  status: "pending" | "archived";
  createdAt: string;
}

interface WorkflowEvent {
  event_id: string;
  source: "execution_recorder" | "diary";
  raw_input: string;
  matched_area: string;
  matched_project: string;
  matched_task: string;
  matched_action: string;
  event_type: string;
  tools: string[];
  problem: string;
  solution: string;
  next_step: string;
  confidence: WorkflowConfidence;
  source_refs: Array<{ type: string; id: string }>;
  createdAt: string;
}

interface WorkflowRecordResult {
  status: "archived" | "pending";
  message: string;
  record: WorkflowInboxRecord;
  taskTitle?: string;
  casePath?: string | null;
  workLogPath?: string | null;
}

export async function recordWorkflowInput(
  cfg: ServerConfig,
  input: WorkflowRecordInput,
): Promise<WorkflowRecordResult> {
  const state = await readTaskPlanState(taskPlanStoreOptions(cfg));
  const candidates = rankTaskCandidates(input.text, state.pool.items);
  const selectedTask = findSelectedTask(input.taskId, state.pool.items);
  if (input.taskId && !selectedTask) {
    throw new Error("绑定任务不存在或已完成。");
  }
  const selectedCandidates = selectedTask
    ? [createSelectedTaskCandidate(selectedTask), ...withoutTaskCandidate(candidates, selectedTask.id)]
    : candidates;
  const confidence = selectedTask ? "high" : classifyConfidence(candidates);
  const record = createInboxRecord(input, selectedCandidates, confidence);
  await appendWorkflowEvent(cfg.runtimeRoot, buildWorkflowEvent(record, input, state.pool.items));
  if (confidence === "high" && selectedCandidates[0]) {
    const archived = await appendWorkflowLogToTask(cfg, record, selectedCandidates[0].taskId);
    return { status: "archived", message: "已写入任务卡和项目工作日志", record: archived.record, ...archived.result };
  }
  await writeInboxRecord(cfg.runtimeRoot, record);
  return { status: "pending", message: confidence === "medium" ? "已放入待确认队列" : "已放入待归档工作流记录", record };
}

export async function archiveWorkflowRecord(
  cfg: ServerConfig,
  input: WorkflowArchiveInput,
): Promise<WorkflowRecordResult> {
  const records = readInbox(cfg.runtimeRoot);
  const record = records.find((item) => item.id === input.recordId);
  if (!record) throw new Error("没有找到待归档记录。");
  const archived = await appendWorkflowLogToTask(cfg, record, input.taskId);
  await updateWorkflowEventAfterArchive(cfg, record, input.taskId);
  await writeInbox(cfg.runtimeRoot, records.map((item) => (
    item.id === record.id ? { ...item, status: "archived" } : item
  )));
  return { status: "archived", message: "已写入任务卡和项目工作日志", record: archived.record, ...archived.result };
}

export function readWorkflowInbox(runtimeRoot: string): WorkflowInboxRecord[] {
  return readInbox(runtimeRoot).filter((record) => record.status === "pending");
}

export function readWorkflowEvents(runtimeRoot: string): WorkflowEvent[] {
  return readJsonArray<WorkflowEvent>(runtimeRoot, EVENT_FILE_NAME, isWorkflowEvent);
}

async function appendWorkflowLogToTask(
  cfg: ServerConfig,
  record: WorkflowInboxRecord,
  taskId: string,
): Promise<{
  record: WorkflowInboxRecord;
  result: { taskTitle: string; casePath: string | null; workLogPath: string | null };
}> {
  const state = await readTaskPlanState(taskPlanStoreOptions(cfg));
  const task = state.pool.items.find((item) => item.id === taskId);
  if (!task) throw new Error("没有找到对应任务。");
  const log = buildWorkflowLogEntry(record);
  const casePath = await appendCaseFromWorkflow(cfg, {
    title: `${task.title}问题记录`,
    sourceRecordId: record.id,
    text: record.text,
    taskTitle: task.title,
  });
  const resourceRefs = await appendResourceCandidates(cfg, record);
  const validationRefs = await appendValidationCandidates(cfg, record);
  const methodRefs = await appendMethodCandidates(cfg, record, {
    hasCase: Boolean(casePath),
    hasValidation: validationRefs.length > 0,
  });
  const workLogPath = await appendProjectWorkLog(cfg, { task, log, eventId: record.eventId });
  const items = state.pool.items.map((item) => (
    item.id === taskId ? updateTaskWithWorkflowResult(item, log, {
      casePath,
      eventId: record.eventId,
      methodRefs,
      resourceRefs,
      workLogPath,
    }) : item
  ));
  await writeTaskPlanState({ ...state, pool: { ...state.pool, items } }, taskPlanStoreOptions(cfg));
  return { record: { ...record, status: "archived" }, result: { taskTitle: task.title, casePath, workLogPath } };
}

function updateTaskWithWorkflowResult(
  item: TaskPlanPoolItem,
  log: TaskWorkflowLogEntry,
  refs: {
    casePath: string | null;
    eventId: string;
    methodRefs: string[];
    resourceRefs: string[];
    workLogPath: string | null;
  },
): TaskPlanPoolItem {
  return {
    ...item,
    currentProgress: log.output,
    lastStop: log.input,
    nextStep: log.nextStep,
    workflowLog: [log, ...(item.workflowLog ?? [])],
    linkedCases: appendUnique(item.linkedCases, refs.casePath ? [refs.casePath] : []),
    linkedResources: appendUnique(item.linkedResources, refs.resourceRefs),
    linkedMethods: appendUnique(item.linkedMethods, refs.methodRefs),
    sourceRefs: appendUnique(item.sourceRefs, [
      `workflow-event/${refs.eventId}`,
      refs.workLogPath ? `work-log/${refs.workLogPath}` : "",
    ]),
  };
}

function buildWorkflowLogEntry(record: WorkflowInboxRecord): TaskWorkflowLogEntry {
  const text = record.text.trim();
  return {
    id: `workflow-${record.id}`,
    recordedAt: record.createdAt,
    node: inferNode(text, record.marker),
    tool: inferTool(text),
    input: text,
    output: inferOutput(text),
    issue: inferIssue(text, record.marker),
    nextStep: inferNextStep(text),
    attachments: record.attachments,
    sourceRecordId: record.id,
  };
}

function rankTaskCandidates(text: string, items: TaskPlanPoolItem[]): WorkflowCandidate[] {
  return items
    .filter((item) => !item.completedAt)
    .map((item) => ({ taskId: item.id, title: item.title, score: scoreTask(text, item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

function findSelectedTask(taskId: string | undefined, items: TaskPlanPoolItem[]): TaskPlanPoolItem | null {
  if (!taskId) return null;
  return items.find((item) => item.id === taskId && !item.completedAt) ?? null;
}

function createSelectedTaskCandidate(task: TaskPlanPoolItem): WorkflowCandidate {
  return { taskId: task.id, title: task.title, score: 99 };
}

function withoutTaskCandidate(candidates: WorkflowCandidate[], taskId: string): WorkflowCandidate[] {
  return candidates.filter((candidate) => candidate.taskId !== taskId);
}

function scoreTask(text: string, item: TaskPlanPoolItem): number {
  const baseScore = scoreTaskTitle(text, item.title) + scoreTaskTokens(text, taskTokens(item));
  return applyTaskZoneScore(baseScore, item.zone);
}

function scoreTaskTitle(text: string, title: string): number {
  return text.includes(title) || title.includes(text.trim()) ? 4 : 0;
}

function scoreTaskTokens(text: string, tokens: string[]): number {
  return tokens.filter((token) => token.length >= 2 && text.includes(token)).length;
}

function applyTaskZoneScore(score: number, zone: TaskPlanPoolItem["zone"]): number {
  if (zone === "candidate") return score - 2;
  if (score > 0 && (zone === "mine" || zone === "ai")) return score + 1;
  return score;
}

function classifyConfidence(candidates: WorkflowCandidate[]): WorkflowConfidence {
  const score = candidates[0]?.score ?? 0;
  if (score >= 3) return "high";
  if (score > 0) return "medium";
  return "low";
}

function buildWorkflowEvent(
  record: WorkflowInboxRecord,
  input: WorkflowRecordInput,
  tasks: TaskPlanPoolItem[],
): WorkflowEvent {
  const context = buildWorkflowEventTaskContext(record, tasks);
  const source = input.source ?? "execution_recorder";
  return {
    event_id: record.eventId,
    source,
    raw_input: record.text,
    matched_area: context.area,
    matched_project: context.project,
    matched_task: context.task,
    matched_action: inferNode(record.text, record.marker),
    event_type: readWorkflowEventType(record.marker),
    tools: inferTools(record.text),
    problem: inferIssue(record.text, record.marker),
    solution: inferSolution(record.text, record.marker),
    next_step: inferNextStep(record.text),
    confidence: record.confidence,
    source_refs: [{ type: source, id: record.id }],
    createdAt: record.createdAt,
  };
}

function buildWorkflowEventTaskContext(
  record: WorkflowInboxRecord,
  tasks: TaskPlanPoolItem[],
): WorkflowEventTaskContext {
  const task = tasks.find((item) => item.id === record.candidates[0]?.taskId);
  if (!task || record.confidence === "low") {
    return { area: "", project: "", task: "" };
  }
  return {
    area: task.domain ?? "",
    project: task.project ?? "",
    task: task.title,
  };
}

function taskTokens(item: TaskPlanPoolItem): string[] {
  return [item.title, item.domain, item.project]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/[\s,，、/|：:《》【】（）()]+/u))
    .filter(Boolean);
}

function createInboxRecord(
  input: WorkflowRecordInput,
  candidates: WorkflowCandidate[],
  confidence: WorkflowConfidence,
): WorkflowInboxRecord {
  const id = randomUUID();
  return {
    id,
    eventId: `we_${id}`,
    text: input.text.trim(),
    attachments: input.attachments,
    marker: input.marker,
    candidates,
    confidence,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

async function writeInboxRecord(runtimeRoot: string, record: WorkflowInboxRecord): Promise<void> {
  await writeInbox(runtimeRoot, [record, ...readInbox(runtimeRoot)]);
}

async function appendWorkflowEvent(runtimeRoot: string, event: WorkflowEvent): Promise<void> {
  const events = readWorkflowEvents(runtimeRoot);
  if (events.some((item) => item.event_id === event.event_id)) return;
  await writeJsonArray(runtimeRoot, EVENT_FILE_NAME, [event, ...events]);
}

async function updateWorkflowEventAfterArchive(
  cfg: ServerConfig,
  record: WorkflowInboxRecord,
  taskId: string,
): Promise<void> {
  const state = await readTaskPlanState(taskPlanStoreOptions(cfg));
  const task = state.pool.items.find((item) => item.id === taskId);
  const events = readWorkflowEvents(cfg.runtimeRoot).map((event) => (
    event.event_id === record.eventId ? {
      ...event,
      matched_area: task?.domain ?? event.matched_area,
      matched_project: task?.project ?? event.matched_project,
      matched_task: task?.title ?? event.matched_task,
      confidence: "high" as const,
    } : event
  ));
  await writeJsonArray(cfg.runtimeRoot, EVENT_FILE_NAME, events);
}

async function appendResourceCandidates(cfg: ServerConfig, record: WorkflowInboxRecord): Promise<string[]> {
  const tools = inferTools(record.text);
  const links = inferLinks(record.text);
  if (tools.length === 0 && links.length === 0) return [];
  const id = `resource-${record.eventId}`;
  await prependCandidate(cfg.runtimeRoot, RESOURCE_CANDIDATES_FILE_NAME, { id, eventId: record.eventId, tools, links, text: record.text });
  const asset = upsertToolboxCandidateAsset(cfg.projectRoot, {
    id,
    title: tools[0] ?? links[0] ?? "工具候选",
    summary: record.text,
    href: links[0] ?? "",
  });
  return [`wiki/专题/03-工具箱/assets/${encodeURIComponent(asset.id)}.md`];
}

async function appendValidationCandidates(cfg: ServerConfig, record: WorkflowInboxRecord): Promise<string[]> {
  if (!VALIDATION_SIGNALS.some((signal) => record.text.includes(signal))) return [];
  const id = `validation-${record.eventId}`;
  await prependCandidate(cfg.runtimeRoot, VALIDATION_CANDIDATES_FILE_NAME, { id, eventId: record.eventId, text: record.text });
  const pathRef = await writeTopicCandidate(cfg, METHOD_PENDING_FOLDER, id, "资料验证候选", record.text);
  return [pathRef];
}

async function appendMethodCandidates(
  cfg: ServerConfig,
  record: WorkflowInboxRecord,
  input: { hasCase: boolean; hasValidation: boolean },
): Promise<string[]> {
  const evidenceKinds = ["workflowLog"];
  if (input.hasCase) evidenceKinds.push("case");
  if (input.hasValidation) evidenceKinds.push("validation");
  if (
    evidenceKinds.length < 2
    && record.marker !== "method"
    && !METHOD_SIGNALS.some((signal) => record.text.includes(signal))
  ) return [];
  const id = `method-${record.eventId}`;
  await prependCandidate(cfg.runtimeRoot, METHOD_CANDIDATES_FILE_NAME, { id, eventId: record.eventId, evidenceKinds, text: record.text });
  const pathRef = await writeTopicCandidate(cfg, METHOD_PENDING_FOLDER, id, "方法候选", record.text);
  return [pathRef];
}

async function writeTopicCandidate(
  cfg: ServerConfig,
  folder: string,
  id: string,
  title: string,
  text: string,
): Promise<string> {
  const relPath = path.join("wiki", "专题", folder, `${id}.md`);
  const fullPath = path.join(cfg.sourceVaultRoot, relPath);
  await ensureTopicFolder(cfg, folder);
  if (!fs.existsSync(fullPath)) {
    await writeFile(fullPath, renderTopicCandidate(title, id, text), "utf8");
  }
  return relPath.replace(/\\/g, "/");
}

async function ensureTopicFolder(cfg: ServerConfig, folder: string): Promise<void> {
  const dir = path.join(cfg.sourceVaultRoot, "wiki", "专题", folder);
  await mkdir(dir, { recursive: true });
  const indexPath = path.join(dir, "index.md");
  if (!fs.existsSync(indexPath)) {
    await writeFile(indexPath, `# ${topicFolderTitle(folder)}\n\n| 条目 | 状态 | 来源 |\n|---|---|---|\n`, "utf8");
  }
}

function topicFolderTitle(folder: string): string {
  const parts = folder.split(/[\\/]/u);
  return parts[parts.length - 1] ?? folder;
}

function renderTopicCandidate(title: string, id: string, text: string): string {
  return [
    "---",
    "status: 候选",
    `source: workflow-event/${id.replace(/^(resource|validation|method)-/u, "")}`,
    `created: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## 候选内容",
    "",
    text,
    "",
    "## 处理状态",
    "",
    "- [ ] 确认是否进入正式专题资产",
  ].join("\n");
}

async function prependCandidate(runtimeRoot: string, filename: string, candidate: Record<string, unknown>): Promise<void> {
  const items = readJsonArray<Record<string, unknown>>(runtimeRoot, filename, isRecord);
  if (items.some((item) => item.id === candidate.id)) return;
  await writeJsonArray(runtimeRoot, filename, [candidate, ...items]);
}

function readInbox(runtimeRoot: string): WorkflowInboxRecord[] {
  return readJsonArray<WorkflowInboxRecord>(runtimeRoot, INBOX_FILE_NAME, isInboxRecord);
}

async function writeInbox(runtimeRoot: string, records: WorkflowInboxRecord[]): Promise<void> {
  await writeJsonArray(runtimeRoot, INBOX_FILE_NAME, records);
}

async function writeJsonArray(runtimeRoot: string, filename: string, records: unknown[]): Promise<void> {
  const filePath = path.join(runtimeRoot, ".llmwiki", filename);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function inboxPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, ".llmwiki", INBOX_FILE_NAME);
}

function readJsonArray<T>(runtimeRoot: string, filename: string, guard: (value: unknown) => value is T): T[] {
  const filePath = path.join(runtimeRoot, ".llmwiki", filename);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch {
    return [];
  }
}

function taskPlanStoreOptions(cfg: ServerConfig): { storageRoot: string } {
  return { storageRoot: path.join(cfg.sourceVaultRoot, "task plan") };
}

function inferNode(text: string, marker: WorkflowRecordInput["marker"]): string {
  if (marker === "end-node") return "结束当前节点";
  if (marker === "method") return "可能的方法方案";
  if (text.includes("ChatGPT")) return "ChatGPT 协作";
  if (text.includes("Gemini")) return "Gemini 协作";
  if (text.includes("Claude")) return "Claude 协作";
  return marker === "issue" ? "问题处理" : "过程记录";
}

function readWorkflowEventType(marker: WorkflowRecordInput["marker"]): string {
  if (marker === "issue") return "问题记录";
  if (marker === "resolved") return "解决记录";
  if (marker === "method") return "方法方案";
  return "过程记录";
}

function inferTool(text: string): string {
  for (const tool of ["ChatGPT", "Gemini", "Claude", "Codex", "PPT", "浏览器", "Quark", "夸克浏览器", "夸克"]) {
    if (text.includes(tool)) return tool;
  }
  return "未识别";
}

function inferTools(text: string): string[] {
  const tools = ["ChatGPT", "Gemini", "Claude", "Codex", "PPT", "浏览器", "Quark", "夸克浏览器", "夸克"]
    .filter((tool) => text.includes(tool));
  return Array.from(new Set(tools.map((tool) => (tool === "夸克" ? "夸克浏览器" : tool))))
    .sort((left, right) => right.length - left.length);
}

function inferLinks(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s，。；;]+/gu), (match) => match[0]);
}

function inferOutput(text: string): string {
  if (text.includes("成功") || text.includes("解决")) return "问题有阶段性结果";
  if (text.includes("失败") || text.includes("不行")) return "当前输出不可用";
  return "待整理";
}

function inferIssue(text: string, marker: WorkflowRecordInput["marker"]): string {
  if (marker === "issue" || PROBLEM_SIGNALS.some((signal) => text.includes(signal))) return text;
  return "";
}

function inferSolution(text: string, marker: WorkflowRecordInput["marker"]): string {
  if (marker === "resolved" || text.includes("解决") || text.includes("成功")) return text;
  return "";
}

function inferNextStep(text: string): string {
  const match = /下一步[，,:：]?\s*([^。.!?\n]+)/u.exec(text);
  return match?.[1]?.trim() ?? "待确认";
}

function isInboxRecord(value: unknown): value is WorkflowInboxRecord {
  return Boolean(value && typeof value === "object" && "id" in value && "text" in value && "status" in value);
}

function isWorkflowEvent(value: unknown): value is WorkflowEvent {
  return Boolean(value && typeof value === "object" && "event_id" in value && "raw_input" in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendUnique(existing: string[] | undefined, next: string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...next])).filter(Boolean);
}
