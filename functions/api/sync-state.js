import {
  json,
  listComments,
  listConversations,
  normalizeComment,
  normalizeConversation,
  readJson,
  requireDb,
  upsertComment,
  upsertConversation,
} from "../_lib/store.js";

export async function onRequestGet(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const conversations = await listConversations(context.env.DB);
  const comments = await listComments(context.env.DB);
  return json({ success: true, data: { conversations, comments } });
}

// fallow-ignore-next-line complexity
export async function onRequestPost(context) {
  const missing = requireDb(context.env);
  if (missing) return missing;
  const payload = await readJson(context.request);
  if (!payload) return json({ success: false, error: "Invalid JSON body." }, 400);

  const conversations = Array.isArray(payload.conversations) ? payload.conversations.map(normalizeConversation) : [];
  const comments = Array.isArray(payload.comments) ? payload.comments.map(normalizeComment) : [];
  for (const conversation of conversations) {
    await upsertConversation(context.env.DB, conversation);
  }
  for (const comment of comments.filter((item) => item.pagePath && item.quote)) {
    await upsertComment(context.env.DB, item);
  }
  return json({ success: true, data: { conversationCount: conversations.length, commentCount: comments.length } });
}
