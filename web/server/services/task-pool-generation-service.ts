/**
 * Task-pool candidate generation service.
 *
 * The task-pool page is the source of truth for pooled work. This service owns
 * the server-side part of the "generate candidates from recent diaries" flow:
 * it selects only flash diaries newer than the last recorded generation batch,
 * asks the configured task-plan assistant for candidate tasks, de-duplicates
 * them against the existing pool, and persists both the candidate tasks and
 * the generation record in the shared task-plan state.
 */
import { randomUUID } from "node:crypto";
import { readAppConfig } from "./app-config.js";
import { listFlashDiaryFiles, readFlashDiaryPage } from "./flash-diary.js";
import {
  readTaskPlanState,
  writeTaskPlanState,
  type TaskPlanPoolItem,
  type TaskPlanPriority,
  type TaskPlanState,
  type TaskPlanStoreOptions,
  type TaskPoolGenerationRecord,
  type TaskPoolOwner,
} from "./task-plan-store.js";
import { TaskPlanServiceError } from "./task-plan-service.js";
import type { LLMMessage, LLMProvider } from "../../../src/utils/provider.js";

const TASK_PLAN_ASSISTANT_ID = "task-plan-assistant";
const TASK_POOL_MAX_TOKENS = 1800;
const INITIAL_DIARY_LIMIT = 3;

interface GenerateTaskPoolCandidatesInput extends TaskPlanStoreOptions {
  projectRoot: string;
  wikiRoot: string;
  provider?: LLMProvider;
  now?: Date;
}

interface DiaryContext {
  path: string;
  date: string;
  raw: string;
}

interface GeneratedCandidate {
  title: string;
  priority: TaskPlanPriority;
  owner: TaskPoolOwner;
  reason: string;
  domain?: string;
  project?: string;
  dueDate?: string;
}

export interface GenerateTaskPoolCandidatesResult {
  state: TaskPlanState;
  generationRecord: TaskPoolGenerationRecord | null;
}

export async function generateTaskPoolCandidates(
  input: GenerateTaskPoolCandidatesInput,
): Promise<GenerateTaskPoolCandidatesResult> {
  const storageRoot = input.storageRoot;
  const state = await readTaskPlanState({ storageRoot });
  const diaries = await readNewDiaryContexts(input.wikiRoot, state.pool.generationRecords);
  if (diaries.length === 0) {
    return { state, generationRecord: null };
  }

  const provider = input.provider ?? await resolveTaskPoolProvider(input.projectRoot);
  if (!provider) {
    throw new TaskPlanServiceError("task-plan-agent-not-found", "task-plan-assistant is not configured", 400);
  }

  const raw = await provider.complete(
    buildTaskPoolSystemPrompt(),
    buildTaskPoolMessages(diaries, state.pool.items),
    TASK_POOL_MAX_TOKENS,
  );
  const generated = parseGeneratedCandidates(raw);
  return persistGeneratedCandidates(state, generated, diaries, input.now ?? new Date(), storageRoot);
}

async function readNewDiaryContexts(
  wikiRoot: string,
  records: readonly TaskPoolGenerationRecord[],
): Promise<DiaryContext[]> {
  const lastDate = readLatestGeneratedDiaryDate(records);
  const files = await listFlashDiaryFiles(wikiRoot);
  const candidates = lastDate
    ? files.filter((file) => file.date > lastDate)
    : files.slice(0, INITIAL_DIARY_LIMIT);
  const ordered = [...candidates].sort((left, right) => left.date.localeCompare(right.date));
  const pages = await Promise.all(ordered.map((file) => readFlashDiaryPage(wikiRoot, file.path)));
  return pages
    .map((page) => ({ path: page.path, date: page.title, raw: page.raw.trim() }))
    .filter((page) => page.raw.length > 0);
}

function readLatestGeneratedDiaryDate(records: readonly TaskPoolGenerationRecord[]): string | null {
  const dates = records.flatMap((record) => record.diaryDates).filter(Boolean);
  return dates.length > 0 ? dates.sort().at(-1) ?? null : null;
}

async function resolveTaskPoolProvider(projectRoot: string): Promise<LLMProvider | null> {
  const agent = readAppConfig(projectRoot).apps.find((item) => item.id === TASK_PLAN_ASSISTANT_ID && item.enabled) ?? null;
  if (!agent) {
    return null;
  }
  const llmChatModule = await import("./llm-chat.js");
  return llmChatModule.resolveAgentRuntimeProvider(projectRoot, agent, "task-plan");
}

function buildTaskPoolSystemPrompt(): string {
  return [
    "You are the dedicated task-pool assistant.",
    "Return strict JSON only.",
    "Output shape: {\"tasks\":[{\"title\":\"string\",\"priority\":\"high|mid|low|neutral\",\"owner\":\"me|ai\",\"reason\":\"string\",\"domain\":\"string\",\"project\":\"string\",\"dueDate\":\"string\"}]}",
    "Generate only actionable task-pool candidates grounded in the supplied diaries.",
    "Write reason in Chinese evidence form: 结合YYYY-M-D日记说“diary evidence”，因此新增任务“task title”。",
    "If one task has multiple evidence points, put each point on a separate line in reason.",
    "Do not add markdown or commentary.",
  ].join("\n");
}

function buildTaskPoolMessages(
  diaries: readonly DiaryContext[],
  poolItems: readonly TaskPlanPoolItem[],
): LLMMessage[] {
  return [{
    role: "user",
    content: [
      "<new_diaries>",
      diaries.map((diary) => `## ${diary.date}\n${diary.raw}`).join("\n\n"),
      "</new_diaries>",
      "",
      "<existing_task_pool>",
      JSON.stringify(poolItems, null, 2),
      "</existing_task_pool>",
    ].join("\n"),
  }];
}

function parseGeneratedCandidates(raw: string): GeneratedCandidate[] {
  const parsed = JSON.parse(normalizeJsonPayload(raw)) as unknown;
  const tasks = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.tasks)
      ? parsed.tasks
      : [];
  return tasks.map(parseGeneratedCandidate).filter((item): item is GeneratedCandidate => item !== null);
}

function normalizeJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```\s*(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

function parseGeneratedCandidate(input: unknown): GeneratedCandidate | null {
  if (!isRecord(input)) {
    return null;
  }
  const title = readText(input.title);
  const reason = readText(input.reason);
  if (!title || !reason) {
    return null;
  }
  return {
    title,
    reason,
    priority: readPriority(input.priority),
    owner: input.owner === "ai" ? "ai" : "me",
    domain: readText(input.domain),
    project: readText(input.project),
    dueDate: readText(input.dueDate),
  };
}

async function persistGeneratedCandidates(
  state: TaskPlanState,
  generated: readonly GeneratedCandidate[],
  diaries: readonly DiaryContext[],
  now: Date,
  storageRoot?: string,
): Promise<GenerateTaskPoolCandidatesResult> {
  const batchId = `task-pool-generation-${now.getTime()}`;
  const existingTitles = new Set(state.pool.items.map((item) => normalizeTitle(item.title)));
  const created: TaskPlanPoolItem[] = [];
  const skippedDuplicateTitles: string[] = [];
  for (const candidate of generated) {
    const normalizedTitle = normalizeTitle(candidate.title);
    if (existingTitles.has(normalizedTitle)) {
      skippedDuplicateTitles.push(candidate.title);
      continue;
    }
    existingTitles.add(normalizedTitle);
    created.push(createCandidatePoolItem(candidate, batchId, diaries, now));
  }
  const generationRecord = createGenerationRecord(batchId, now, diaries, created, skippedDuplicateTitles);
  const nextState = createNextTaskPlanState(state, created, generationRecord);
  await writeTaskPlanState(nextState, { storageRoot });
  return { state: nextState, generationRecord };
}

function createCandidatePoolItem(
  candidate: GeneratedCandidate,
  batchId: string,
  diaries: readonly DiaryContext[],
  now: Date,
): TaskPlanPoolItem {
  return {
    id: `candidate-${randomUUID()}`,
    title: candidate.title,
    priority: candidate.priority,
    source: "AI 生成",
    domain: candidate.domain || "个人知识系统",
    project: candidate.project || "个人知识系统",
    zone: "candidate",
    owner: candidate.owner,
    createdAt: now.toISOString(),
    dueDate: candidate.dueDate,
    diaryDate: diaries.map((diary) => diary.date).join("、"),
    generationBatchId: batchId,
    generatedReason: candidate.reason,
  };
}

function createGenerationRecord(
  id: string,
  now: Date,
  diaries: readonly DiaryContext[],
  created: readonly TaskPlanPoolItem[],
  skippedDuplicateTitles: readonly string[],
): TaskPoolGenerationRecord {
  return {
    id,
    generatedAt: now.toISOString(),
    diaryPaths: diaries.map((diary) => diary.path),
    diaryDates: diaries.map((diary) => diary.date),
    createdTaskIds: created.map((item) => item.id),
    skippedDuplicateTitles: [...skippedDuplicateTitles],
  };
}

function createNextTaskPlanState(
  state: TaskPlanState,
  created: readonly TaskPlanPoolItem[],
  generationRecord: TaskPoolGenerationRecord,
): TaskPlanState {
  return {
    ...state,
    pool: {
      ...state.pool,
      items: [...state.pool.items, ...created],
      generationRecords: [generationRecord, ...state.pool.generationRecords],
    },
    morningFlow: {
      ...state.morningFlow,
      diaryDone: true,
    },
  };
}

function readPriority(value: unknown): TaskPlanPriority {
  return value === "high" || value === "mid" || value === "low" || value === "neutral" ? value : "neutral";
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
