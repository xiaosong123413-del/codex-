/**
 * Cloudflare Pages single wiki comment endpoint.
 *
 * Supports the edit, resolve, and delete actions used by the desktop wiki
 * comments panel when it runs on the hosted Pages site.
 */
import { json, readJson, requireDb } from "../../_lib/store.js";

// fallow-ignore-next-line complexity
export async function onRequestPatch(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const id = context.params.id;
  const payload = await readJson(context.request);
  if (!payload) return json({ success: false, error: "Invalid JSON body." }, 400);
  const path = stringValue(payload.path);
  const text = stringValue(payload.text);
  const resolved = payload.resolved === true ? 1 : 0;
  const result = await context.env.DB.prepare(
    "UPDATE wiki_comments SET comment = ?, resolved = ?, updated_at = ? WHERE id = ? AND page_path = ?",
  ).bind(text, resolved, new Date().toISOString(), id, path).run();
  if (result.meta?.changes === 0) {
    return json({ success: false, error: "comment_not_found" }, 404);
  }
  return json({ success: true, data: await readComment(context.env.DB, id) });
}

export async function onRequestDelete(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  await context.env.DB.prepare("DELETE FROM wiki_comments WHERE id = ?").bind(context.params.id).run();
  return json({ success: true, data: null });
}

async function readComment(db, id) {
  const row = await db.prepare(
    "SELECT id, page_path AS path, quote, comment AS text, resolved, created_at AS createdAt, updated_at AS updatedAt FROM wiki_comments WHERE id = ?",
  ).bind(id).first();
  if (!row) return null;
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

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
