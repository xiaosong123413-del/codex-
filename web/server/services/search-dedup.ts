import type { SearchResult } from "./search-router.js";

export function dedupSearchResults(results: SearchResult[]): SearchResult[] {
  const chosen = new Map<string, { result: SearchResult; priority: number; order: number }>();

  results.forEach((result, order) => {
    const key = dedupKey(result);
    const priority = layerPriority(result);
    const existing = chosen.get(key);
    if (!existing || priority < existing.priority || (priority === existing.priority && order < existing.order)) {
      chosen.set(key, { result: mergeResultSources(result, existing?.result), priority, order });
    } else {
      existing.result = mergeResultSources(existing.result, result);
    }
  });

  return [...chosen.values()]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.result);
}

function mergeResultSources(primary: SearchResult, secondary?: SearchResult): SearchResult {
  return {
    ...primary,
    retrievalSources: [...new Set([
      ...readRetrievalSources(primary),
      ...readRetrievalSources(secondary),
    ])],
  };
}

function readRetrievalSources(result: SearchResult | undefined): SearchResult["retrievalSources"] {
  return Array.isArray(result?.retrievalSources) ? result.retrievalSources : [];
}

function dedupKey(result: SearchResult): string {
  const normalizedPath = result.path.replaceAll("\\", "/").toLowerCase();
  const baseName = normalizedPath.split("/").pop() ?? "";
  const stem = baseName.replace(/\.(md|markdown|html|txt)$/i, "");
  return stem || result.title.toLowerCase().trim() || result.id.toLowerCase();
}

function layerPriority(result: SearchResult): number {
  const normalizedPath = result.path.replaceAll("\\", "/").toLowerCase();

  if (normalizedPath.includes("/procedures/")) return 0;
  if (normalizedPath.includes("/concepts/")) return 1;
  if (normalizedPath.includes("/sources/") || normalizedPath.includes("/sources_full/")) return 3;
  if (result.layer === "source" || result.layer === "raw") return 3;
  if (result.layer === "wiki") return 2;
  return 4;
}
