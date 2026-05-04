/**
 * Flash-diary Memory orchestration.
 *
 * Maintains one tiered Memory markdown file with a short-term 7-day summary
 * above long-term memory sections, plus refresh state for daily rebuilds.
 */
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import type { LLMProvider } from "../../../src/utils/provider.js";
import { listFlashDiaryFiles, readFlashDiaryPage } from "./flash-diary.js";
import { resolveAgentRuntimeProvider } from "./llm-chat.js";
import {
  buildTieredMemoryMarkdown,
  extractLongTermSections,
  hasLegacyShortTermPlaceholder,
  hasTieredMemoryStructure,
  mergeLongTermSections,
  MEMORY_TEMPLATE,
  normalizeMemoryMarkdown,
  readShortTermSectionLines,
  SHORT_TERM_WINDOW_DAYS,
} from "./flash-diary-memory-markdown.js";
import { buildShortTermMemoryLines } from "./flash-diary-short-term-memory.js";
import {
  addDays,
  buildFlashDiaryMemoryPage,
  formatLocalDate,
  MEMORY_PATH,
  MEMORY_TITLE,
  readFlashDiaryMemoryState,
  resolveMemoryFilePath,
  type FlashDiaryMemoryPage,
  type FlashDiaryMemoryState,
  writeFlashDiaryMemoryCopies,
  writeFlashDiaryMemoryState,
} from "./flash-diary-memory-files.js";

const MEMORY_DESCRIPTION = "根据日记沉淀的分层记忆";
const STATE_VERSION = 1;
const MEMORY_MAX_TOKENS = 2200;

interface FlashDiaryMemorySummary {
  kind: "memory";
  title: string;
  path: string;
  description: string;
  exists: boolean;
  modifiedAt: string | null;
  lastAppliedDiaryDate: string | null;
}

interface FlashDiaryMemoryOptions {
  projectRoot: string;
  sourceVaultRoot: string;
  runtimeRoot: string;
  now?: Date;
  provider?: LLMProvider;
}

interface DiaryInput {
  date: string;
  raw: string;
}

interface MemoryUpdateResult {
  raw: string;
  appliedPendingDates: boolean;
}

interface MemoryReadSnapshot {
  now: Date;
  filePath: string;
  exists: boolean;
  state: FlashDiaryMemoryState | null;
  baseRaw: string;
  refreshDay: string;
  shortTermDiaries: readonly DiaryInput[];
  pendingDates: readonly DiaryInput[];
  requiresShortTermRefresh: boolean;
}

export function readFlashDiaryMemorySummary(sourceVaultRoot: string, runtimeRoot: string): FlashDiaryMemorySummary {
  const filePath = resolveMemoryFilePath(sourceVaultRoot);
  const exists = fs.existsSync(filePath);
  const modifiedAt = exists ? fs.statSync(filePath).mtime.toISOString() : null;
  const state = readFlashDiaryMemoryState(runtimeRoot);
  return {
    kind: "memory",
    title: MEMORY_TITLE,
    path: MEMORY_PATH,
    description: MEMORY_DESCRIPTION,
    exists,
    modifiedAt,
    lastAppliedDiaryDate: state?.lastAppliedDiaryDate ?? null,
  };
}

export function readStoredFlashDiaryMemoryPage(
  sourceVaultRoot: string,
  runtimeRoot: string,
): FlashDiaryMemoryPage | null {
  const filePath = resolveMemoryFilePath(sourceVaultRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const state = readFlashDiaryMemoryState(runtimeRoot);
  return {
    path: MEMORY_PATH,
    title: MEMORY_TITLE,
    raw: fs.readFileSync(filePath, "utf8"),
    modifiedAt: fs.statSync(filePath).mtime.toISOString(),
    sourceEditable: true,
    lastAppliedDiaryDate: state?.lastAppliedDiaryDate ?? null,
  };
}

export function isLegacyShortTermMemory(raw: string): boolean {
  return hasLegacyShortTermPlaceholder(raw);
}

export async function refreshStoredFlashDiaryShortTermPage(options: {
  projectRoot: string;
  sourceVaultRoot: string;
  runtimeRoot: string;
  now?: Date;
  provider?: LLMProvider;
}): Promise<FlashDiaryMemoryPage | null> {
  const filePath = resolveMemoryFilePath(options.sourceVaultRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const now = options.now ?? new Date();
  const state = readFlashDiaryMemoryState(options.runtimeRoot);
  const diaries = await listDiaryInputs(options.sourceVaultRoot);
  const shortTermDiaries = listEligibleDiaries(diaries, now).slice(-SHORT_TERM_WINDOW_DAYS);
  const baseRaw = await readFile(filePath, "utf8");
  const shortTermLines = await resolveShortTermLines({
    projectRoot: options.projectRoot,
    provider: options.provider,
    shortTermDiaries,
    fallbackRaw: baseRaw,
    preserveExistingOnError: true,
  });
  const effectiveRaw = normalizeMemoryMarkdown(baseRaw, shortTermLines);
  await writeFlashDiaryMemoryCopies(options.sourceVaultRoot, options.runtimeRoot, effectiveRaw);
  await writeFlashDiaryMemoryState(options.runtimeRoot, {
    version: STATE_VERSION,
    memoryPath: MEMORY_PATH,
    lastAppliedDiaryDate: state?.lastAppliedDiaryDate ?? null,
    lastShortTermRefreshOn: formatLocalDate(now),
    builtAt: state?.builtAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  });
  return {
    path: MEMORY_PATH,
    title: MEMORY_TITLE,
    raw: effectiveRaw,
    modifiedAt: fs.statSync(filePath).mtime.toISOString(),
    sourceEditable: true,
    lastAppliedDiaryDate: state?.lastAppliedDiaryDate ?? null,
  };
}

export async function readFlashDiaryMemoryPage(options: FlashDiaryMemoryOptions): Promise<FlashDiaryMemoryPage> {
  const diaries = await listDiaryInputs(options.sourceVaultRoot);
  const snapshot = await createMemoryReadSnapshot(options, diaries);
  const updateResult = snapshot.pendingDates.length > 0
    ? await readUpdatedMemoryRaw(options, snapshot.baseRaw, snapshot.pendingDates, snapshot.exists)
    : { raw: snapshot.baseRaw, appliedPendingDates: false };
  const updatedRaw = updateResult.raw;
  const shortTermLines = snapshot.requiresShortTermRefresh
    ? await resolveShortTermLines({
      projectRoot: options.projectRoot,
      provider: options.provider,
      shortTermDiaries: snapshot.shortTermDiaries,
      fallbackRaw: updatedRaw,
      preserveExistingOnError: snapshot.exists,
    })
    : readShortTermSectionLines(updatedRaw);
  const effectiveRaw = normalizeMemoryMarkdown(updatedRaw, shortTermLines);
  await writeFlashDiaryMemoryCopies(options.sourceVaultRoot, options.runtimeRoot, effectiveRaw);
  const lastAppliedDiaryDate = resolveLastAppliedDiaryDate(updateResult, snapshot);
  await writeFlashDiaryMemoryState(options.runtimeRoot, {
    version: STATE_VERSION,
    memoryPath: MEMORY_PATH,
    lastAppliedDiaryDate,
    lastShortTermRefreshOn: resolveShortTermRefreshOn(snapshot),
    builtAt: snapshot.state?.builtAt ?? snapshot.now.toISOString(),
    updatedAt: snapshot.now.toISOString(),
  });

  return buildFlashDiaryMemoryPage(snapshot.filePath, effectiveRaw, lastAppliedDiaryDate);
}

async function resolveShortTermLines(input: {
  projectRoot: string;
  shortTermDiaries: readonly DiaryInput[];
  fallbackRaw: string;
  preserveExistingOnError: boolean;
  provider?: LLMProvider;
}): Promise<string[]> {
  try {
    return await buildShortTermMemoryLines({
      projectRoot: input.projectRoot,
      diaries: input.shortTermDiaries,
      provider: input.provider,
    });
  } catch (error) {
    if (input.preserveExistingOnError) {
      return readShortTermSectionLines(input.fallbackRaw);
    }
    throw error;
  }
}

export async function refreshFlashDiaryMemoryIfDue(options: FlashDiaryMemoryOptions): Promise<void> {
  const now = options.now ?? new Date();
  const state = readFlashDiaryMemoryState(options.runtimeRoot);
  const filePath = resolveMemoryFilePath(options.sourceVaultRoot);
  const memoryExists = fs.existsSync(filePath);
  if (
    memoryExists
    && state?.lastShortTermRefreshOn === formatLocalDate(now)
    && !hasLegacyShortTermPlaceholder(fs.readFileSync(filePath, "utf8"))
  ) {
    return;
  }
  await readFlashDiaryMemoryPage({ ...options, now });
}

async function readUpdatedMemoryRaw(
  options: FlashDiaryMemoryOptions,
  baseRaw: string,
  pendingDates: readonly DiaryInput[],
  memoryExists: boolean,
): Promise<MemoryUpdateResult> {
  try {
    return {
      raw: await applyDiaryInputs(
      options.provider ?? resolveAgentRuntimeProvider(options.projectRoot, null, "flash-diary-memory"),
      baseRaw,
      pendingDates,
      ),
      appliedPendingDates: true,
    };
  } catch (error) {
    if (memoryExists) {
      return { raw: baseRaw, appliedPendingDates: false };
    }
    throw error;
  }
}

async function listDiaryInputs(sourceVaultRoot: string): Promise<DiaryInput[]> {
  const items = await listFlashDiaryFiles(sourceVaultRoot);
  const sortedItems = [...items].sort((left, right) => left.date.localeCompare(right.date));
  const diaries: DiaryInput[] = [];
  for (const item of sortedItems) {
    const page = await readFlashDiaryPage(sourceVaultRoot, item.path);
    diaries.push({ date: item.date, raw: page.raw });
  }
  return diaries;
}

function shouldApplyDiaryDay(date: string, lastAppliedDiaryDate: string | null, now: Date): boolean {
  if (lastAppliedDiaryDate && date <= lastAppliedDiaryDate) {
    return false;
  }
  return date <= formatLocalDate(addDays(now, -1));
}

async function applyDiaryInputs(provider: LLMProvider, baseRaw: string, diaries: readonly DiaryInput[]): Promise<string> {
  let currentRaw = normalizeMemoryMarkdown(baseRaw, []);
  for (const diary of diaries) {
    const providerRaw = normalizeMemoryMarkdown(await provider.complete(
      buildMemorySystemPrompt(),
      [{ role: "user", content: buildMemoryUserPrompt(currentRaw, diary) }],
      MEMORY_MAX_TOKENS,
    ), []);
    currentRaw = buildTieredMemoryMarkdown(
      mergeLongTermSections(
        extractLongTermSections(currentRaw),
        extractLongTermSections(providerRaw),
      ),
      [],
    );
  }
  return currentRaw;
}

function buildMemorySystemPrompt(): string {
  return [
    "你负责维护一份基于闪念日记沉淀出的 Memory 页面。",
    "保持现有 Markdown 结构，不要删除已有人工修订，除非新的日记明确要求改写。",
    "页面必须保留以下结构：# Memory、## 短期记忆（最近 7 天）、## 长期记忆，以及长期记忆下的 ### 人物与关系、### 项目与系统、### 方法论与偏好、### 长期问题与矛盾、### 近期变化、### 来源范围。",
    "结合当前 Memory 和单天日记，输出完整更新后的 Markdown，仅返回 Markdown 本文。",
  ].join("\n");
}

function buildMemoryUserPrompt(currentMemory: string, diary: DiaryInput): string {
  return [
    `Diary Date: ${diary.date}`,
    "",
    "Current Memory Markdown:",
    currentMemory,
    "",
    "Diary Markdown:",
    diary.raw,
  ].join("\n");
}

function listEligibleDiaries(diaries: readonly DiaryInput[], now: Date): readonly DiaryInput[] {
  const latestEligibleDate = formatLocalDate(addDays(now, -1));
  return diaries.filter((diary) => diary.date <= latestEligibleDate);
}

async function createMemoryReadSnapshot(
  options: FlashDiaryMemoryOptions,
  diaries: readonly DiaryInput[],
): Promise<MemoryReadSnapshot> {
  const now = options.now ?? new Date();
  const filePath = resolveMemoryFilePath(options.sourceVaultRoot);
  const exists = fs.existsSync(filePath);
  const persistedState = readFlashDiaryMemoryState(options.runtimeRoot);
  const state = exists ? persistedState : null;
  const baseRaw = exists ? await readFile(filePath, "utf8") : MEMORY_TEMPLATE;
  const refreshDay = formatLocalDate(now);
  const shortTermDiaries = listEligibleDiaries(diaries, now).slice(-SHORT_TERM_WINDOW_DAYS);
  const pendingDates = diaries.filter((diary) => shouldApplyDiaryDay(diary.date, state?.lastAppliedDiaryDate ?? null, now));
  return {
    now,
    filePath,
    exists,
    state,
    baseRaw,
    refreshDay,
    shortTermDiaries,
    pendingDates,
    requiresShortTermRefresh: shouldRefreshShortTermMemory(baseRaw, exists, state, refreshDay, pendingDates),
  };
}

function shouldRefreshShortTermMemory(
  baseRaw: string,
  exists: boolean,
  state: FlashDiaryMemoryState | null,
  refreshDay: string,
  pendingDates: readonly DiaryInput[],
): boolean {
  return !exists
    || !hasTieredMemoryStructure(baseRaw)
    || hasLegacyShortTermPlaceholder(baseRaw)
    || state?.lastShortTermRefreshOn !== refreshDay
    || pendingDates.length > 0;
}

function resolveLastAppliedDiaryDate(
  updateResult: MemoryUpdateResult,
  snapshot: MemoryReadSnapshot,
): string | null {
  return updateResult.appliedPendingDates
    ? snapshot.pendingDates[snapshot.pendingDates.length - 1]!.date
    : snapshot.state?.lastAppliedDiaryDate ?? null;
}

function resolveShortTermRefreshOn(snapshot: MemoryReadSnapshot): string | null {
  return snapshot.requiresShortTermRefresh
    ? snapshot.refreshDay
    : snapshot.state?.lastShortTermRefreshOn ?? null;
}
