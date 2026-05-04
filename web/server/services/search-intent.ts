export type IntentSearchMode = "direct" | "keyword" | "hybrid";

export function chooseSearchMode(query: string): IntentSearchMode {
  const trimmed = query.trim();
  if (!trimmed) return "keyword";

  if (looksDirect(trimmed)) return "direct";
  if (looksHybrid(trimmed)) return "hybrid";
  return "keyword";
}

function looksDirect(query: string): boolean {
  const lower = query.toLowerCase();
  return lower.includes("/")
    || lower.includes("\\")
    || lower.endsWith(".md")
    || lower.endsWith(".markdown")
    || /^[a-z0-9_-]+(?:\/[a-z0-9._-]+)+$/i.test(query);
}

function looksHybrid(query: string): boolean {
  return /\s/.test(query)
    || /[？?。.!！？]/.test(query)
    || (/[一-龥]/.test(query) && query.length > 8)
    || query.length > 24;
}
