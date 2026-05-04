import type { MobileDbEnv } from "./mobile-shared.js";
import { json, safeJson } from "./worker-support.js";

interface MobileDocumentPayload {
  ownerUid?: string;
  path?: string;
  title?: string;
  raw?: string;
}

const ALLOWED_DOCUMENTS = new Map([
  ["wiki/journal-memory.md", "Memory"],
  ["wiki/journal-twelve-questions.md", "十二个问题"],
]);

export async function handleMobileDocumentGet(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  await ensureDocumentTable(db);
  const payload = await safeJson<MobileDocumentPayload>(request);
  const path = normalizeDocumentPath(payload.path);
  if (!path) return json({ ok: false, error: "invalid_document_path" }, 400);
  const storagePath = storageDocumentPath(payload.ownerUid, path);
  const row = await db.prepare(
    "SELECT path, title, raw, updated_at AS updatedAt FROM mobile_documents WHERE path = ?",
  ).bind(storagePath).first();
  return json({
    ok: true,
    document: row ? documentFromRow(row, path) : createEmptyDocument(path),
  });
}

export async function handleMobileDocumentSave(request: Request, env: MobileDbEnv): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "missing_d1_binding" }, 500);
  await ensureDocumentTable(db);
  const payload = await safeJson<MobileDocumentPayload>(request);
  const path = normalizeDocumentPath(payload.path);
  if (!path) return json({ ok: false, error: "invalid_document_path" }, 400);
  const title = String(payload.title || ALLOWED_DOCUMENTS.get(path) || "");
  const raw = String(payload.raw ?? "");
  const updatedAt = new Date().toISOString();
  const storagePath = storageDocumentPath(payload.ownerUid, path);
  await db.prepare(
    "INSERT INTO mobile_documents (path, title, raw, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET title = excluded.title, raw = excluded.raw, updated_at = excluded.updated_at",
  ).bind(storagePath, title, raw, updatedAt).run();
  return json({ ok: true, document: { path, title, raw, updatedAt } });
}

async function ensureDocumentTable(db: D1Database): Promise<void> {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS mobile_documents (path TEXT PRIMARY KEY, title TEXT NOT NULL, raw TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
}

function normalizeDocumentPath(value: unknown): string {
  const path = String(value ?? "").replace(/\\/g, "/").trim();
  return ALLOWED_DOCUMENTS.has(path) ? path : "";
}

function storageDocumentPath(ownerUid: unknown, path: string): string {
  const owner = String(ownerUid ?? "").trim();
  return owner ? `accounts/${owner}/${path}` : path;
}

function documentFromRow(row: Record<string, unknown>, path: string): Record<string, unknown> {
  return {
    path,
    title: String(row.title ?? ""),
    raw: String(row.raw ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function createEmptyDocument(path: string): Record<string, unknown> {
  const title = ALLOWED_DOCUMENTS.get(path) || path;
  return {
    path,
    title,
    raw: `# ${title}\n\n`,
    updatedAt: "",
  };
}
