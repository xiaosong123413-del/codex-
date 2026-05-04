/**
 * File and state helpers for flash-diary Memory.
 *
 * Centralizes Memory file locations, persisted refresh state, and the small
 * date helpers shared by the Memory orchestration layer.
 */

import fs from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const STATE_DIR = ".llmwiki";
const STATE_FILE = "flash-diary-memory.json";

export const MEMORY_PATH = "wiki/journal-memory.md";
export const MEMORY_TITLE = "Memory";

export interface FlashDiaryMemoryPage {
  path: string;
  title: string;
  raw: string;
  modifiedAt: string;
  sourceEditable: true;
  lastAppliedDiaryDate: string | null;
}

export interface FlashDiaryMemoryState {
  version: number;
  memoryPath: string;
  lastAppliedDiaryDate: string | null;
  lastShortTermRefreshOn: string | null;
  builtAt: string;
  updatedAt: string;
}

export function resolveMemoryFilePath(sourceVaultRoot: string): string {
  return path.join(sourceVaultRoot, ...MEMORY_PATH.split("/"));
}

function resolveRuntimeMemoryFilePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, ...MEMORY_PATH.split("/"));
}

export async function writeFlashDiaryMemoryCopies(
  sourceVaultRoot: string,
  runtimeRoot: string,
  raw: string,
): Promise<void> {
  const normalizedRaw = raw.endsWith("\n") ? raw : `${raw}\n`;
  await Promise.all([
    writeMemoryFileIfChanged(resolveMemoryFilePath(sourceVaultRoot), normalizedRaw),
    writeMemoryFileIfChanged(resolveRuntimeMemoryFilePath(runtimeRoot), normalizedRaw),
  ]);
}

export function buildFlashDiaryMemoryPage(
  filePath: string,
  raw: string,
  lastAppliedDiaryDate: string | null,
): FlashDiaryMemoryPage {
  return {
    path: MEMORY_PATH,
    title: MEMORY_TITLE,
    raw,
    modifiedAt: fs.statSync(filePath).mtime.toISOString(),
    sourceEditable: true,
    lastAppliedDiaryDate,
  };
}

export function readFlashDiaryMemoryState(runtimeRoot: string): FlashDiaryMemoryState | null {
  const filePath = resolveStateFilePath(runtimeRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FlashDiaryMemoryState>;
    if (!isValidMemoryState(parsed)) {
      return null;
    }
    return normalizeMemoryState(parsed);
  } catch {
    return null;
  }
}

export async function writeFlashDiaryMemoryState(runtimeRoot: string, state: FlashDiaryMemoryState): Promise<void> {
  const filePath = resolveStateFilePath(runtimeRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatLocalDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function resolveStateFilePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, STATE_DIR, STATE_FILE);
}

async function writeMemoryFileIfChanged(filePath: string, raw: string): Promise<void> {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === raw) {
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, raw, "utf8");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

// fallow-ignore-next-line complexity
function isValidMemoryState(parsed: Partial<FlashDiaryMemoryState>): boolean {
  return typeof parsed.version === "number"
    && typeof parsed.memoryPath === "string"
    && typeof parsed.builtAt === "string"
    && typeof parsed.updatedAt === "string"
    && parsed.lastAppliedDiaryDate !== undefined
    && (parsed.lastAppliedDiaryDate === null || typeof parsed.lastAppliedDiaryDate === "string")
    && (
      parsed.lastShortTermRefreshOn === undefined
      || parsed.lastShortTermRefreshOn === null
      || typeof parsed.lastShortTermRefreshOn === "string"
    );
}

function normalizeMemoryState(parsed: Partial<FlashDiaryMemoryState>): FlashDiaryMemoryState {
  return {
    version: parsed.version as number,
    memoryPath: parsed.memoryPath as string,
    lastAppliedDiaryDate: parsed.lastAppliedDiaryDate as string | null,
    lastShortTermRefreshOn: parsed.lastShortTermRefreshOn ?? null,
    builtAt: parsed.builtAt as string,
    updatedAt: parsed.updatedAt as string,
  };
}
