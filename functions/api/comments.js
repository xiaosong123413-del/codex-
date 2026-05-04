import {
  json,
  listComments,
  normalizeComment,
  readJson,
  requireDb,
  upsertComment,
} from "../_lib/store.js";

export async function onRequestGet(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const url = new URL(context.request.url);
  const pagePath = url.searchParams.get("pagePath") || "";
  const comments = await listComments(context.env.DB, pagePath);
  return json({ success: true, data: comments });
}

// fallow-ignore-next-line complexity
export async function onRequestPost(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const payload = await readJson(context.request);
  if (!payload) return json({ success: false, error: "Invalid JSON body." }, 400);
  const comment = normalizeComment(payload);
  if (!comment.pagePath || !comment.quote || !comment.comment) {
    return json({ success: false, error: "pagePath, quote and comment are required." }, 400);
  }
  await upsertComment(context.env.DB, comment);
  return json({ success: true, data: comment }, 201);
}
