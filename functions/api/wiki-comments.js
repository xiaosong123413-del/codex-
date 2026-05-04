/**
 * Cloudflare Pages wiki comments endpoint.
 *
 * The hosted wiki reuses the desktop comment panel API shape while storing
 * comments in the existing remote `wiki_comments` table.
 */
import { json, readJson, requireDb } from "../_lib/store.js";

export async function onRequestGet(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path") || "";
  const result = await context.env.DB.prepare(
    "SELECT id, page_path AS path, quote, comment AS text, resolved, created_at AS createdAt, updated_at AS updatedAt FROM wiki_comments WHERE page_path = ? ORDER BY updated_at DESC LIMIT 300",
  ).bind(path).all();
  return json({ success: true, data: (result.results ?? []).map(commentFromRow) });
}

// fallow-ignore-next-line complexity
export async function onRequestPost(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const payload = await readJson(context.request);
  if (!payload) return json({ success: false, error: "Invalid JSON body." }, 400);
  const comment = normalizeCommentPayload(payload);
  if (!comment.path || !comment.quote) {
    return json({ success: false, error: "path and quote are required." }, 400);
  }
  await context.env.DB.prepare(
    "INSERT INTO wiki_comments (id, page_path, quote, comment, resolved, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    comment.id,
    comment.path,
    comment.quote,
    comment.text,
    comment.resolved ? 1 : 0,
    "web",
    comment.createdAt,
    comment.updatedAt,
  ).run();
  return json({ success: true, data: comment }, 201);
}

function normalizeCommentPayload(payload) {
  const now = new Date().toISOString();
  const quote = stringValue(payload.quote);
  return {
    id: stringValue(payload.id) || crypto.randomUUID(),
    path: stringValue(payload.path),
    quote,
    text: stringValue(payload.text),
    start: numberValue(payload.start, 0),
    end: numberValue(payload.end, quote.length),
    resolved: payload.resolved === true,
    createdAt: stringValue(payload.createdAt) || now,
    updatedAt: now,
  };
}

function commentFromRow(row) {
  const quote = stringValue(row.quote);
  return {
    id: stringValue(row.id),
    path: stringValue(row.path),
    quote,
    text: stringValue(row.text),
    start: 0,
    end: quote.length,
    resolved: row.resolved === 1 || row.resolved === true,
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
  };
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
