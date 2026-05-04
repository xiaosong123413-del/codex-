/**
 * Normalization helpers for web sync state.
 *
 * The CLI wrapper script only coordinates local files and the remote sync
 * endpoint. These helpers keep the record-shaping logic deterministic and
 * directly testable.
 */

// fallow-ignore-next-line complexity
export function normalizeConversation(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanString(value.id);
  if (!id) return null;
  const now = new Date().toISOString();
  return {
    id,
    title: cleanString(value.title) || "新对话",
    createdAt: cleanString(value.createdAt) || cleanString(value.created_at) || now,
    updatedAt: cleanString(value.updatedAt) || cleanString(value.updated_at) || now,
    webSearchEnabled: Boolean(value.webSearchEnabled ?? value.web_search_enabled),
    searchScope: normalizeSearchScope(value.searchScope || value.search_scope),
    agentId: cleanString(value.agentId) || cleanString(value.agent_id) || null,
    articleRefs: normalizeArray(value.articleRefs ?? value.article_refs ?? value.article_refs_json),
    messages: normalizeMessages(value.messages ?? value.messages_json),
  };
}

// fallow-ignore-next-line complexity
export function normalizeComment(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanString(value.id);
  const pagePath = cleanString(value.pagePath) || cleanString(value.page_path);
  if (!id || !pagePath) return null;
  const now = new Date().toISOString();
  return {
    id,
    pagePath,
    quote: cleanString(value.quote),
    comment: cleanString(value.comment),
    resolved: Boolean(value.resolved),
    source: cleanString(value.source) || "desktop",
    createdAt: cleanString(value.createdAt) || cleanString(value.created_at) || now,
    updatedAt: cleanString(value.updatedAt) || cleanString(value.updated_at) || now,
  };
}

// fallow-ignore-next-line complexity
export function mergeByUpdatedAt(localItems, remoteItems) {
  const merged = new Map();
  for (const item of [...remoteItems, ...localItems]) {
    const existing = merged.get(item.id);
    if (!existing || Date.parse(item.updatedAt || "") >= Date.parse(existing.updatedAt || "")) {
      merged.set(item.id, item);
    }
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}

// fallow-ignore-next-line complexity
export function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// fallow-ignore-next-line complexity
function normalizeMessages(value) {
  const items = normalizeArray(value);
  return items
    .filter((item) => item && typeof item === "object")
    // fallow-ignore-next-line complexity
    .map((item) => ({
      id: cleanString(item.id) || randomId("msg"),
      role: cleanString(item.role) || "assistant",
      content: cleanString(item.content),
      createdAt: cleanString(item.createdAt) || cleanString(item.created_at) || new Date().toISOString(),
      articleRefs: normalizeArray(item.articleRefs ?? item.article_refs ?? []),
      citations: normalizeArray(item.citations ?? []),
      searchResults: normalizeArray(item.searchResults ?? item.search_results ?? []),
      error: cleanString(item.error) || null,
    }));
}

// fallow-ignore-next-line complexity
function normalizeSearchScope(value) {
  return value === "web" || value === "all" || value === "both" ? value : "local";
}

// fallow-ignore-next-line complexity
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// fallow-ignore-next-line complexity
function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
