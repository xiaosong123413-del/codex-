import {
  isExternalMobileAiProvider,
  runMobileAiText,
} from "./mobile-ai-provider.js";
import type { MobileAiProviderRequest, MobileChatEnv, MobileDbEnv } from "./mobile-shared.js";
import { json, safeJson } from "./worker-support.js";

type MobileTaskPriority = "high" | "mid" | "low" | "cool" | "neutral";
type MobileTaskKind = "todo" | "done";
type MobileTaskSource = "manual" | "ai" | "drag";

interface MobileTaskItem {
  id: string;
  title: string;
  ownerUid: string;
  kind: MobileTaskKind;
  startTime: string;
  endTime?: string;
  priority: MobileTaskPriority;
  done: boolean;
  note?: string;
  source: MobileTaskSource;
  updatedAt: string;
}

interface MobileTaskSavePayload {
  items?: unknown;
  ownerUid?: string;
}

interface MobileTaskReviewSettingPayload {
  ownerUid?: string;
  enabled?: unknown;
}

interface MobileTaskAiDonePayload {
  text?: string;
  ownerUid?: string;
  aiProvider?: MobileAiProviderRequest;
}

const TASK_SELECT =
  "SELECT id, owner_uid AS ownerUid, title, kind, start_time AS startTime, end_time AS endTime, priority, done, note, source, updated_at AS updatedAt FROM mobile_task_schedule";

export async function handleMobileTaskList(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  await ensureTaskTable(db);
  const payload = await safeJson<MobileTaskSavePayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  const result = ownerUid
    ? await db.prepare(`${TASK_SELECT} WHERE owner_uid = ? OR owner_uid = '' ORDER BY start_time ASC, updated_at ASC`).bind(ownerUid).all()
    : await db.prepare(`${TASK_SELECT} ORDER BY start_time ASC, updated_at ASC`).all();
  return json({
    ok: true,
    items: (result.results ?? []).map(taskItemFromRow),
    reviewEnabled: ownerUid ? await readReviewEnabled(db, ownerUid) : false,
    syncedAt: new Date().toISOString(),
  });
}

export async function handleMobileTaskSave(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  await ensureTaskTable(db);
  const payload = await safeJson<MobileTaskSavePayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  const items = parseTaskItems(payload.items, ownerUid);
  if (!items.length) return json({ ok: false, error: "missing_task_items" }, 400);
  if (ownerUid) {
    await db.prepare("DELETE FROM mobile_task_schedule WHERE owner_uid = ? OR owner_uid = ''").bind(ownerUid).run();
  } else {
    await db.prepare("DELETE FROM mobile_task_schedule").run();
  }
  await db.batch(items.map((item) =>
    db.prepare(
      "INSERT INTO mobile_task_schedule (id, owner_uid, title, kind, start_time, end_time, priority, done, note, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(item.id, item.ownerUid, item.title, item.kind, item.startTime, item.endTime ?? null, item.priority, item.done ? 1 : 0, item.note ?? null, item.source, item.updatedAt),
  ));
  return json({ ok: true, items, syncedAt: new Date().toISOString() });
}

export async function handleMobileTaskAiDone(request: Request, env: MobileChatEnv): Promise<Response> {
  const payload = await safeJson<MobileTaskAiDonePayload>(request);
  const text = String(payload.text ?? "").trim();
  if (!text) return json({ ok: false, error: "missing_text" }, 400);
  const titles = await parseDoneTitlesWithAi(env, text, payload.aiProvider, payload.ownerUid);
  return json({ ok: true, titles });
}

export async function handleMobileTaskReviewSettingSave(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  await ensureTaskReviewSettingsTable(db);
  const payload = await safeJson<MobileTaskReviewSettingPayload>(request);
  const ownerUid = String(payload.ownerUid ?? "").trim();
  if (!ownerUid) return json({ ok: false, error: "missing_owner_uid" }, 400);
  const enabled = payload.enabled === true;
  await db.prepare(
    "INSERT INTO mobile_task_review_settings (owner_uid, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_uid) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
  ).bind(ownerUid, enabled ? 1 : 0, new Date().toISOString()).run();
  return json({ ok: true, reviewEnabled: enabled });
}

export async function writeDailyTaskReview(env: MobileDbEnv, now = new Date()): Promise<number> {
  const db = env.DB;
  if (!db) return 0;
  await ensureTaskTable(db);
  await ensureTaskReviewSettingsTable(db);
  const rows = await db.prepare(`${TASK_SELECT} ORDER BY owner_uid ASC, start_time ASC, updated_at ASC`).all();
  const items = (rows.results ?? []).map(taskItemFromRow);
  const ownerUids = [...new Set(items.map((item) => item.ownerUid).filter(Boolean))];
  let written = 0;
  for (const ownerUid of ownerUids) {
    if (!(await readReviewEnabled(db, ownerUid))) continue;
    const ownerItems = items.filter((item) => item.ownerUid === ownerUid);
    if (!ownerItems.length) continue;
    const text = buildDailyTaskReviewText(ownerItems);
    const createdAt = now.toISOString();
    const targetDate = createdAt.slice(0, 10);
    const existing = await db.prepare("SELECT id FROM mobile_entries WHERE owner_uid = ? AND channel = ? AND target_date = ? LIMIT 1")
      .bind(ownerUid, "mobile-task-review", targetDate)
      .first();
    await db.prepare(
      "INSERT INTO mobile_entries (id, owner_uid, type, title, text, media_files_json, created_at, target_date, status, channel, source_name, source_url, desktop_path, synced_at, failed_at, error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = CURRENT_TIMESTAMP",
    ).bind(
      String(existing?.id ?? crypto.randomUUID()),
      ownerUid,
      "flash_diary",
      "任务复盘",
      text,
      "[]",
      createdAt,
      targetDate,
      "new",
      "mobile-task-review",
      "手机端任务",
      null,
      null,
      null,
      null,
      null,
    ).run();
    written += 1;
  }
  return written;
}

async function ensureTaskTable(db: D1Database): Promise<void> {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS mobile_task_schedule (id TEXT PRIMARY KEY, owner_uid TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'todo', start_time TEXT NOT NULL, end_time TEXT, priority TEXT NOT NULL DEFAULT 'neutral', done INTEGER NOT NULL DEFAULT 0, note TEXT, source TEXT NOT NULL DEFAULT 'manual', updated_at TEXT NOT NULL)",
  ).run();
  await addColumnIfMissing(db, "owner_uid", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "kind", "TEXT NOT NULL DEFAULT 'todo'");
  await addColumnIfMissing(db, "end_time", "TEXT");
  await addColumnIfMissing(db, "note", "TEXT");
  await addColumnIfMissing(db, "source", "TEXT NOT NULL DEFAULT 'manual'");
}

async function ensureTaskReviewSettingsTable(db: D1Database): Promise<void> {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS mobile_task_review_settings (owner_uid TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)",
  ).run();
}

async function readReviewEnabled(db: D1Database, ownerUid: string): Promise<boolean> {
  await ensureTaskReviewSettingsTable(db);
  const row = await db.prepare("SELECT enabled FROM mobile_task_review_settings WHERE owner_uid = ?").bind(ownerUid).first();
  return row?.enabled === 1 || row?.enabled === true;
}

async function addColumnIfMissing(db: D1Database, column: string, definition: string): Promise<void> {
  try {
    await db.prepare(`ALTER TABLE mobile_task_schedule ADD COLUMN ${column} ${definition}`).run();
  } catch {
    // D1 throws when the column already exists; the schema is already usable.
  }
}

function parseTaskItems(value: unknown, ownerUid: string): MobileTaskItem[] {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  return value.map((item) => normalizeTaskItem(item, now, ownerUid)).filter((item): item is MobileTaskItem => item !== null).slice(0, 100);
}

// fallow-ignore-next-line complexity
function normalizeTaskItem(value: unknown, fallbackUpdatedAt: string, ownerUid: string): MobileTaskItem | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<MobileTaskItem>;
  const title = String(input.title ?? "").trim();
  const startTime = normalizeStartTime(input.startTime);
  if (!title || !startTime) return null;
  const kind = normalizeKind(input.kind, input.done);
  return {
    id: String(input.id || crypto.randomUUID()),
    ownerUid: String(ownerUid || input.ownerUid || "").trim(),
    title,
    kind,
    startTime,
    endTime: normalizeStartTime(input.endTime) || undefined,
    priority: normalizePriority(input.priority),
    done: kind === "done" || input.done === true,
    note: input.note ? String(input.note).trim() : undefined,
    source: normalizeSource(input.source),
    updatedAt: String(input.updatedAt || fallbackUpdatedAt),
  };
}

// fallow-ignore-next-line complexity
function taskItemFromRow(row: Record<string, unknown>): MobileTaskItem {
  const done = row.done === 1 || row.done === true;
  const kind = normalizeKind(row.kind, done);
  return {
    id: String(row.id ?? ""),
    ownerUid: String(row.ownerUid ?? ""),
    title: String(row.title ?? ""),
    kind,
    startTime: normalizeStartTime(row.startTime) || "09:00",
    endTime: normalizeStartTime(row.endTime) || undefined,
    priority: normalizePriority(row.priority),
    done: kind === "done" || done,
    note: row.note ? String(row.note) : undefined,
    source: normalizeSource(row.source),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

async function parseDoneTitlesWithAi(
  env: MobileChatEnv,
  text: string,
  aiProvider?: MobileAiProviderRequest,
  ownerUid?: string,
): Promise<string[]> {
  if (!isExternalMobileAiProvider(aiProvider) && (!env.AI || !env.LLM_MODEL)) return splitDoneTitles(text);
  try {
    const result = await runMobileAiText(env, aiProvider, [
      { role: "system", content: "把用户输入拆成今日已完成事项。只返回 JSON 字符串数组，不要解释。" },
      { role: "user", content: text },
    ], { ownerUid });
    const parsed = JSON.parse(result.trim()) as unknown;
    if (Array.isArray(parsed)) {
      const titles = parsed.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8);
      if (titles.length) return titles;
    }
  } catch {
    return splitDoneTitles(text);
  }
  return splitDoneTitles(text);
}

function splitDoneTitles(text: string): string[] {
  return text.split(/\n|；|;/).map((item) => item.trim().replace(/^[-*]\s*/, "")).filter(Boolean).slice(0, 8);
}

function buildDailyTaskReviewText(items: readonly MobileTaskItem[]): string {
  const todos = items.filter((item) => item.kind === "todo");
  const done = items.filter((item) => item.kind === "done");
  const unfinished = todos.filter((todo) => !done.some((item) => item.title === todo.title));
  return [
    "【任务复盘】",
    "",
    "今日计划：",
    todos.length ? todos.map(formatTaskLine).join("\n") : "- 无",
    "",
    "顺利进行：",
    done.length ? done.map(formatTaskLine).join("\n") : "- 无",
    "",
    "没有顺利进行：",
    unfinished.length ? unfinished.map(formatTaskLine).join("\n") : "- 无",
    "",
    "卡点：",
    unfinished.length ? "- 计划中仍未进入 Done 的事项需要复盘原因。" : "- 今日计划基本推进。",
    "",
    "可以怎么做得更好：",
    "- 明天把未完成事项提前安排到明确时间格，并在完成后及时写入 Done。",
  ].join("\n");
}

function formatTaskLine(item: MobileTaskItem): string {
  return `- ${item.startTime}${item.endTime ? `-${item.endTime}` : ""} ${item.title}`;
}

function normalizeKind(value: unknown, done?: boolean): MobileTaskKind {
  if (value === "done") return "done";
  if (value === "todo") return "todo";
  return done ? "done" : "todo";
}

function normalizeSource(value: unknown): MobileTaskSource {
  return value === "ai" || value === "drag" || value === "manual" ? value : "manual";
}

function normalizePriority(value: unknown): MobileTaskPriority {
  return value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral"
    ? value
    : "neutral";
}

function normalizeStartTime(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : "";
}
