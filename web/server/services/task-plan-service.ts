import {
  DEFAULT_TASK_PLAN_STORAGE_ROOT,
  readTaskPlanState,
  writeTaskPlanState,
} from "./task-plan-store.js";
import fs from "node:fs";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { listFlashDiaryFiles, readFlashDiaryPage } from "./flash-diary.js";
import { readAppConfig } from "./app-config.js";
import type {
  TaskPlanPoolItem,
  TaskPlanPriority,
  TaskPlanRoadmapState,
  TaskPlanScheduleItem,
  TaskPlanScheduleState,
  TaskPlanStageItem,
  TaskPlanState,
  TaskPlanStoreOptions,
} from "./task-plan-store.js";
import type { LLMMessage, LLMProvider } from "../../../src/utils/provider.js";
import { postJson } from "../../../src/utils/cloudflare-http.js";
import { readCloudflareRemoteBrainConfig } from "./cloudflare-remote-brain-config.js";
import { registerSharedTaskTaxonomy } from "./task-taxonomy.js";

const taskPlanMutationQueues = new Map<string, Promise<void>>();
const TASK_PLAN_MAX_TOKENS = 1200;
const TASK_PLAN_ASSISTANT_ID = "task-plan-assistant";

interface TaskPlanScheduleSaveInput {
  items: TaskPlanScheduleItem[];
  confirmed: boolean;
}

interface TaskPlanScheduleSaveResult {
  schedule: TaskPlanScheduleState;
}

interface GenerateTaskPlanInput extends TaskPlanStoreOptions {
  projectRoot: string;
  wikiRoot: string;
  provider?: LLMProvider;
}

interface GenerateTaskPlanSuccess {
  ok: true;
  data: {
    schedule: TaskPlanScheduleState;
  };
}

interface SaveTaskPlanVoiceInput extends TaskPlanStoreOptions {
  filename: string;
  mimeType: string;
  audioBase64: string;
}

interface SaveTaskPlanVoiceResult {
  state: TaskPlanState;
}

interface SaveTaskPlanTextInput extends TaskPlanStoreOptions {
  text: string;
}

interface SaveTaskPlanTextResult {
  state: TaskPlanState;
}

interface SaveTaskPlanStatusSummaryInput extends TaskPlanStoreOptions {
  statusSummary: string;
}

interface SaveTaskPlanStatusSummaryResult {
  state: TaskPlanState;
}

interface SaveTaskPlanPoolInput extends TaskPlanStoreOptions {
  items: TaskPlanPoolItem[];
  stages?: TaskPlanStageItem[];
}

interface SaveTaskPlanPoolResult {
  state: TaskPlanState;
}

interface RefreshTaskPlanStatusSummaryInput extends TaskPlanStoreOptions {
  projectRoot: string;
  wikiRoot: string;
  provider?: LLMProvider;
}

interface RefreshTaskPlanStatusSummaryResult {
  state: TaskPlanState;
}

interface GenerateTaskPlanFailure {
  ok: false;
  error: {
    code: "missing-voice-input" | "missing-diary-context" | "missing-task-pool-context" | "task-plan-agent-not-found";
    message: string;
  };
}

type GenerateTaskPlanResult = GenerateTaskPlanSuccess | GenerateTaskPlanFailure;

export class TaskPlanServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function readCurrentTaskPlanState(
  options: TaskPlanStoreOptions = {},
): Promise<TaskPlanState> {
  const state = await readTaskPlanState(options);
  if (options.storageRoot) return state;
  const cloudSchedule = await readCloudTaskSchedule();
  if (!cloudSchedule.length) return state;
  const nextState: TaskPlanState = {
    ...state,
    schedule: {
      ...state.schedule,
      items: cloudSchedule,
    },
  };
  await writeTaskPlanState(nextState, options);
  return nextState;
}

export async function saveTaskPlanSchedule(
  input: TaskPlanScheduleSaveInput,
  options: TaskPlanStoreOptions = {},
): Promise<TaskPlanScheduleSaveResult> {
  validateTaskPlanScheduleSaveInput(input);
  const storageRoot = resolveStorageRoot(options);
  return enqueueTaskPlanMutation(storageRoot, async () => {
    const state = await readTaskPlanState({ storageRoot });
    const nextSchedule: TaskPlanScheduleState = {
      generationId: state.schedule.generationId,
      revisionId: createRevisionId(),
      items: input.items,
      confirmed: input.confirmed,
    };
    const nextState: TaskPlanState = {
      ...state,
      schedule: nextSchedule,
      morningFlow: {
        ...state.morningFlow,
        fineTuneDone: input.confirmed,
      },
    };
    await writeTaskPlanState(nextState, { storageRoot });
    if (!options.storageRoot) {
      await saveCloudTaskSchedule(input.items);
    }
    return { schedule: nextSchedule };
  });
}

export async function readCurrentTaskPlanRoadmap(
  options: TaskPlanStoreOptions = {},
): Promise<TaskPlanRoadmapState> {
  const state = await readTaskPlanState(options);
  return state.roadmap;
}

export async function generateTaskPlan(
  input: GenerateTaskPlanInput,
): Promise<GenerateTaskPlanResult> {
  const storageRoot = resolveStorageRoot(input);
  const state = await readTaskPlanState({ storageRoot });
  const voiceTranscript = state.voice.transcript.trim();
  const currentPoolItems = state.pool.items.filter((item) => item.zone !== "candidate");
  if (!voiceTranscript) {
    return {
      ok: false,
      error: {
        code: "missing-voice-input",
        message: "latest voice transcript is required for generation",
      },
    };
  }
  if (currentPoolItems.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing-task-pool-context",
        message: "task pool context is required for generation",
      },
    };
  }

  const diaryContext = await readPlanningContext(input.projectRoot, input.wikiRoot);
  if (!diaryContext) {
    return {
      ok: false,
      error: {
        code: "missing-diary-context",
        message: "recent diary or work-log context is required for generation",
      },
    };
  }

  const provider = input.provider ?? await resolveTaskPlanProvider(input.projectRoot);
  if (!provider) {
    return {
      ok: false,
      error: {
        code: "task-plan-agent-not-found",
        message: "task-plan-assistant is not configured",
      },
    };
  }

  const raw = await provider.complete(
    buildTaskPlanSystemPrompt(),
    buildTaskPlanMessages(voiceTranscript, diaryContext, currentPoolItems),
    TASK_PLAN_MAX_TOKENS,
  );
  const parsedItems = parseGeneratedScheduleItems(raw);

  return enqueueTaskPlanMutation(storageRoot, async () => {
    const nextState = await readTaskPlanState({ storageRoot });
    const nextSchedule: TaskPlanScheduleState = {
      generationId: createGenerationId(),
      revisionId: nextState.schedule.revisionId,
      items: parsedItems,
      confirmed: false,
    };
    await writeTaskPlanState({
      ...nextState,
      schedule: nextSchedule,
      morningFlow: {
        ...nextState.morningFlow,
        diaryDone: true,
        planningDone: true,
        fineTuneDone: false,
      },
    }, { storageRoot });
    return {
      ok: true,
      data: {
        schedule: nextSchedule,
      },
    };
  });
}

export async function saveTaskPlanVoice(
  input: SaveTaskPlanVoiceInput,
): Promise<SaveTaskPlanVoiceResult> {
  const storageRoot = resolveStorageRoot(input);
  const audioFilePath = await writeTaskPlanAudioFile(storageRoot, input.filename, input.audioBase64);
  try {
    const { transcribeFileWithCloudflare } = await import("./transcript-service.js");
    const transcript = await transcribeFileWithCloudflare({ filePath: audioFilePath });
    if (!transcript.ok) {
      throw new TaskPlanServiceError("transcription_failed", transcript.error.message, 503);
    }

    return enqueueTaskPlanMutation(storageRoot, async () => {
      const state = await readTaskPlanState({ storageRoot });
      const nextState: TaskPlanState = {
        ...state,
        voice: {
          transcript: transcript.text,
          audioPath: toStorageRelativePath(storageRoot, audioFilePath),
          updatedAt: new Date().toISOString(),
        },
        morningFlow: {
          ...state.morningFlow,
          voiceDone: true,
        },
      };
      await writeTaskPlanState(nextState, { storageRoot });
      return { state: nextState };
    });
  } catch (error) {
    await cleanupTaskPlanAudioFile(audioFilePath);
    throw error;
  }
}

export async function saveTaskPlanText(
  input: SaveTaskPlanTextInput,
): Promise<SaveTaskPlanTextResult> {
  const text = input.text.trim();
  if (!text) {
    throw new TaskPlanServiceError("invalid_request", "text is required", 400);
  }

  const storageRoot = resolveStorageRoot(input);
  return enqueueTaskPlanMutation(storageRoot, async () => {
    const state = await readTaskPlanState({ storageRoot });
    const nextState: TaskPlanState = {
      ...state,
      voice: {
        transcript: text,
        audioPath: null,
        updatedAt: new Date().toISOString(),
      },
      morningFlow: {
        ...state.morningFlow,
        voiceDone: true,
      },
    };
    await writeTaskPlanState(nextState, { storageRoot });
    return { state: nextState };
  });
}

export async function refreshTaskPlanStatusSummary(
  input: RefreshTaskPlanStatusSummaryInput,
): Promise<RefreshTaskPlanStatusSummaryResult> {
  const storageRoot = resolveStorageRoot(input);
  const state = await readTaskPlanState({ storageRoot });
  const planningInput = state.voice.transcript.trim();
  if (!planningInput) {
    return { state };
  }

  const planningContext = await readPlanningContext(input.projectRoot, input.wikiRoot);
  if (!planningContext) {
    throw new TaskPlanServiceError(
      "missing-diary-context",
      "recent diary or work-log context is required for generation",
      400,
    );
  }

  const provider = input.provider ?? await resolveTaskPlanProvider(input.projectRoot);
  if (!provider) {
    throw new TaskPlanServiceError(
      "task-plan-agent-not-found",
      "task-plan-assistant is not configured",
      400,
    );
  }

  const raw = await provider.complete(
    buildTaskPlanStatusSummarySystemPrompt(),
    buildTaskPlanStatusSummaryMessages(planningInput, planningContext, state.pool.items),
    TASK_PLAN_MAX_TOKENS,
  );
  const statusSummary = raw.trim();
  if (!statusSummary) {
    throw new Error("task plan status refresh returned empty content");
  }

  return enqueueTaskPlanMutation(storageRoot, async () => {
    const nextState = await readTaskPlanState({ storageRoot });
    const updatedState: TaskPlanState = {
      ...nextState,
      statusSummary,
    };
    await writeTaskPlanState(updatedState, { storageRoot });
    return { state: updatedState };
  });
}

export async function saveTaskPlanStatusSummary(
  input: SaveTaskPlanStatusSummaryInput,
): Promise<SaveTaskPlanStatusSummaryResult> {
  const statusSummary = input.statusSummary.trim();
  if (!statusSummary) {
    throw new TaskPlanServiceError("invalid_request", "statusSummary is required", 400);
  }

  const storageRoot = resolveStorageRoot(input);
  return enqueueTaskPlanMutation(storageRoot, async () => {
    const state = await readTaskPlanState({ storageRoot });
    const nextState: TaskPlanState = {
      ...state,
      statusSummary,
    };
    await writeTaskPlanState(nextState, { storageRoot });
    return { state: nextState };
  });
}

export async function saveTaskPlanPool(
  input: SaveTaskPlanPoolInput,
): Promise<SaveTaskPlanPoolResult> {
  validateTaskPlanPoolSaveInput(input.items);
  const storageRoot = resolveStorageRoot(input);
  return enqueueTaskPlanMutation(storageRoot, async () => {
    const state = await readTaskPlanState({ storageRoot });
    const nextState: TaskPlanState = {
      ...state,
      pool: {
        ...state.pool,
        items: input.items,
        stages: input.stages ?? [],
      },
    };
    const savedState = await writeTaskPlanState(nextState, { storageRoot });
    registerTaskPlanPoolTaxonomy(storageRoot, input.items);
    return { state: savedState };
  });
}

function registerTaskPlanPoolTaxonomy(storageRoot: string, items: TaskPlanPoolItem[]): void {
  for (const item of items) {
    if (!item.domain || !item.project) continue;
    registerSharedTaskTaxonomy("", { domain: item.domain, name: item.project }, storageRoot);
  }
}

function createRevisionId(): string {
  return `schedule-revision-${Date.now()}`;
}

interface CloudTaskListResponse {
  ok?: boolean;
  items?: Array<{
    id?: string;
    title?: string;
    kind?: string;
    startTime?: string;
    priority?: string;
    done?: boolean;
    updatedAt?: string;
  }>;
}

async function readCloudTaskSchedule(): Promise<TaskPlanScheduleItem[]> {
  const cfg = readCloudflareRemoteBrainConfig();
  if (!cfg.enabled || !cfg.workerUrl || !cfg.remoteToken) return [];
  const result = await postJson<CloudTaskListResponse>(
    new URL("mobile/tasks/list", cfg.workerUrl).toString(),
    {},
    { Authorization: `Bearer ${cfg.remoteToken}` },
  );
  if (!result.ok || result.data.ok === false) return [];
  return normalizeCloudTaskItems(result.data.items);
}

async function saveCloudTaskSchedule(items: TaskPlanScheduleItem[]): Promise<void> {
  const cfg = readCloudflareRemoteBrainConfig();
  if (!cfg.enabled || !cfg.workerUrl || !cfg.remoteToken) return;
  const now = new Date().toISOString();
  await postJson<CloudTaskListResponse>(
    new URL("mobile/tasks/save", cfg.workerUrl).toString(),
    {
      items: items.map((item) => ({
        ...item,
        kind: "todo",
        done: false,
        updatedAt: now,
      })),
    },
    { Authorization: `Bearer ${cfg.remoteToken}` },
  );
}

function normalizeCloudTaskItems(items: CloudTaskListResponse["items"]): TaskPlanScheduleItem[] {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeCloudTaskItem).filter((item): item is TaskPlanScheduleItem => item !== null);
}

function normalizeCloudTaskItem(item: NonNullable<CloudTaskListResponse["items"]>[number]): TaskPlanScheduleItem | null {
  const title = String(item.title ?? "").trim();
  const kind = String(item.kind ?? "todo").trim();
  const startTime = String(item.startTime ?? "").trim();
  if (kind === "done") return null;
  if (!title || !/^\d{2}:\d{2}$/.test(startTime)) return null;
  return {
    id: String(item.id || `schedule-${crypto.randomUUID()}`),
    title,
    startTime,
    priority: normalizeTaskPlanPriority(item.priority),
  };
}

function normalizeTaskPlanPriority(value: unknown): TaskPlanPriority {
  return value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral"
    ? value
    : "neutral";
}

function createGenerationId(): string {
  return `task-plan-generation-${Date.now()}`;
}

function resolveStorageRoot(options: TaskPlanStoreOptions): string {
  return options.storageRoot ?? DEFAULT_TASK_PLAN_STORAGE_ROOT;
}

function validateTaskPlanScheduleSaveInput(input: TaskPlanScheduleSaveInput): void {
  if (input.confirmed && input.items.length === 0) {
    throw new TaskPlanServiceError(
      "invalid_request",
      "confirmed schedule must include at least one item",
      400,
    );
  }
}

function validateTaskPlanPoolSaveInput(items: readonly TaskPlanPoolItem[]): void {
  if (items.length === 0) {
    throw new TaskPlanServiceError("invalid_request", "pool must include at least one item", 400);
  }
  for (const item of items) {
    if (!item.id.trim() || !item.title.trim()) {
      throw new TaskPlanServiceError("invalid_request", "pool item is invalid", 400);
    }
  }
}

function enqueueTaskPlanMutation<T>(
  storageRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  const tail = taskPlanMutationQueues.get(storageRoot) ?? Promise.resolve();
  const run = tail.catch(() => undefined).then(operation);
  const nextTail = run.then(() => undefined, () => undefined);
  taskPlanMutationQueues.set(storageRoot, nextTail);
  return run.finally(() => {
    if (taskPlanMutationQueues.get(storageRoot) === nextTail) {
      taskPlanMutationQueues.delete(storageRoot);
    }
  });
}

async function readPlanningContext(projectRoot: string, wikiRoot: string): Promise<string | null> {
  const parts: string[] = [];
  const flashDiaryContext = await readLatestFlashDiaryContext(wikiRoot);
  if (flashDiaryContext) {
    parts.push([
      "<recent_flash_diary>",
      flashDiaryContext,
      "</recent_flash_diary>",
    ].join("\n"));
  }
  const workLogContext = readProjectWorkLogContext(projectRoot, wikiRoot);
  if (workLogContext) {
    parts.push([
      "<recent_work_log>",
      workLogContext,
      "</recent_work_log>",
    ].join("\n"));
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

async function readLatestFlashDiaryContext(wikiRoot: string): Promise<string | null> {
  const files = await listFlashDiaryFiles(wikiRoot);
  const latest = files[0];
  if (!latest) {
    return null;
  }
  const page = await readFlashDiaryPage(wikiRoot, latest.path);
  const raw = page.raw.trim();
  return raw ? raw : null;
}

function readProjectWorkLogContext(projectRoot: string, wikiRoot: string): string | null {
  const candidates = [
    path.join(projectRoot, "docs", "project-log.md"),
    path.join(wikiRoot, "log.md"),
    path.join(projectRoot, "log.md"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }
    const raw = fs.readFileSync(candidate, "utf8").trim();
    if (raw) {
      return raw;
    }
  }
  return null;
}

async function resolveTaskPlanProvider(projectRoot: string): Promise<LLMProvider | null> {
  const agent = readAppConfig(projectRoot).apps.find((item) => item.id === TASK_PLAN_ASSISTANT_ID && item.enabled) ?? null;
  if (!agent) {
    return null;
  }
  const llmChatModule = await import("./llm-chat.js");
  return llmChatModule.resolveAgentRuntimeProvider(projectRoot, agent, "task-plan");
}

function buildTaskPlanSystemPrompt(): string {
  return [
    "You are the dedicated task-plan assistant.",
    "Return strict JSON only.",
    "Output shape: {\"items\":[{\"id\":\"string\",\"title\":\"string\",\"startTime\":\"HH:MM\",\"priority\":\"high|mid|low|cool|neutral\"}]}",
    "Do not add markdown or commentary.",
  ].join("\n");
}

function buildTaskPlanStatusSummarySystemPrompt(): string {
  return [
    "You are the dedicated task-plan assistant.",
    "Summarize the user's recent working status in plain text only.",
    "Keep it concise and directly usable in the UI.",
    "Do not add markdown, bullets, or labels.",
  ].join("\n");
}

function buildTaskPlanMessages(
  voiceTranscript: string,
  diaryContext: string,
  poolItems: TaskPlanState["pool"]["items"],
): LLMMessage[] {
  return [{
    role: "user",
    content: [
      "<voice_transcript>",
      voiceTranscript,
      "</voice_transcript>",
      "",
      "<recent_diary>",
      diaryContext,
      "</recent_diary>",
      "",
      "<task_pool>",
      JSON.stringify(poolItems, null, 2),
      "</task_pool>",
    ].join("\n"),
  }];
}

function buildTaskPlanStatusSummaryMessages(
  planningInput: string,
  planningContext: string,
  poolItems: TaskPlanState["pool"]["items"],
): LLMMessage[] {
  return [{
    role: "user",
    content: [
      "<planning_input>",
      planningInput,
      "</planning_input>",
      "",
      "<recent_context>",
      planningContext,
      "</recent_context>",
      "",
      "<task_pool>",
      JSON.stringify(poolItems, null, 2),
      "</task_pool>",
    ].join("\n"),
  }];
}

function parseGeneratedScheduleItems(raw: string): TaskPlanScheduleItem[] {
  const parsed = JSON.parse(normalizeGeneratedJsonPayload(raw)) as unknown;
  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : null;
  if (!items) {
    throw new Error("task plan generation returned invalid JSON shape");
  }
  return items.map(parseGeneratedScheduleItem);
}

function normalizeGeneratedJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```\s*(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

function parseGeneratedScheduleItem(input: unknown): TaskPlanScheduleItem {
  if (!isRecord(input)) {
    throw new Error("task plan generation item must be an object");
  }
  const id = readGeneratedScheduleString(input.id);
  const title = readGeneratedScheduleString(input.title);
  const startTime = readGeneratedScheduleString(input.startTime);
  const priority = isTaskPlanPriority(input.priority) ? input.priority : null;
  if (!id || !title || !isTaskPlanStartTime(startTime) || !priority) {
    throw new Error("task plan generation item is invalid");
  }
  return { id, title, startTime, priority };
}

function readGeneratedScheduleString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTaskPlanPriority(value: unknown): value is TaskPlanPriority {
  return value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral";
}

function isTaskPlanStartTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeTaskPlanAudioFile(
  storageRoot: string,
  filename: string,
  audioBase64: string,
): Promise<string> {
  const audioDir = path.join(storageRoot, "audio");
  const safeFilename = createAudioFilename(filename);
  const filePath = path.join(audioDir, safeFilename);
  const audioBuffer = Buffer.from(audioBase64, "base64");
  await mkdir(audioDir, { recursive: true });
  await writeFile(filePath, audioBuffer);
  return filePath;
}

function createAudioFilename(filename: string): string {
  const extension = path.extname(filename).trim();
  const baseName = path.basename(filename, extension).trim().replace(/[^a-zA-Z0-9-_]+/g, "-") || "voice";
  return `${Date.now()}-${baseName}${extension}`;
}

function toStorageRelativePath(storageRoot: string, filePath: string): string {
  return path.relative(storageRoot, filePath).split(path.sep).join("/");
}

async function cleanupTaskPlanAudioFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
