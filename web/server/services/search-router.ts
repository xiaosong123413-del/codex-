import type { ServerConfig } from "../config.js";
import { loadSearchIndex, type SearchIndexEntry } from "./search-index.js";
import type { MarkdownImageRef } from "./markdown-images.js";
import { dedupSearchResults } from "./search-dedup.js";
import { chooseSearchMode, type IntentSearchMode } from "./search-intent.js";
import { hybridSearch, rrfFusion, type RankedHit } from "./search-hybrid.js";
import type { SearchRetrievalSource } from "./search-hybrid.js";
import { searchLocalVectors, type LocalVectorPageHit } from "./local-vector-search.js";

export type SearchMode = IntentSearchMode;

export interface SearchResult {
  id: string;
  title: string;
  path: string;
  layer: SearchIndexEntry["layer"];
  excerpt: string;
  tags: string[];
  modifiedAt: string | null;
  images: MarkdownImageRef[];
  retrievalSources: SearchRetrievalSource[];
}

export interface SearchResponse {
  mode: SearchMode;
  results: SearchResult[];
}

interface SearchIndexLookups {
  byPath: Map<string, SearchIndexEntry>;
  byId: Map<string, SearchIndexEntry>;
}

export async function runSearch(cfg: ServerConfig | undefined, query: string, mode: SearchMode): Promise<SearchResponse> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { mode: chooseSearchMode(normalizedQuery), results: [] };
  }

  const effectiveMode = mode === "direct" || mode === "hybrid" ? mode : chooseSearchMode(normalizedQuery);
  const index = loadSearchIndex(cfg);
  if (effectiveMode === "hybrid") {
    const hybridResults = await runHybridSearch(cfg, index, normalizedQuery);
    return {
      mode: effectiveMode,
      results: dedupSearchResults(hybridResults.map((entry) => ({
        ...toSearchResult(entry),
        retrievalSources: readEntryRetrievalSources(entry, ["token"]),
      }))),
    };
  }
  const results = dedupSearchResults(index
    .filter((entry) => matches(entry, normalizedQuery, effectiveMode))
    .slice(0, 20)
    .map((entry) => toSearchResult(entry)));

  return { mode: effectiveMode, results };
}

function toSearchResult(entry: SearchIndexEntry): SearchResult {
  return {
    id: entry.id,
    title: entry.title,
    path: entry.path,
    layer: entry.layer,
    excerpt: entry.excerpt,
    tags: entry.tags,
    modifiedAt: entry.modifiedAt,
    images: entry.images ?? [],
    retrievalSources: readEntryRetrievalSources(entry, ["token"]),
  };
}

async function runHybridSearch(
  cfg: ServerConfig | undefined,
  index: SearchIndexEntry[],
  query: string,
): Promise<SearchIndexEntry[]> {
  const localResults = hybridSearch(index, query, { limit: 30 });
  const localRanked: RankedHit[] = localResults.map((entry) => ({
    ...entry,
    score: 1,
  }));
  const vectorRanked = await runVectorSearch(cfg, index, query);
  const fused = vectorRanked.length ? rrfFusion([vectorRanked, localRanked]) : localRanked;
  return fused.slice(0, 20).map((hit) => ({
    id: hit.id,
    title: hit.title ?? hit.id,
    path: hit.path ?? hit.id,
    layer: hit.layer ?? "unknown",
    excerpt: hit.excerpt ?? "",
    tags: hit.tags ?? [],
    modifiedAt: hit.modifiedAt ?? null,
    images: hit.images ?? [],
    retrievalSources: hit.retrievalSources ?? ["token"],
  }));
}

async function runVectorSearch(
  cfg: ServerConfig | undefined,
  index: SearchIndexEntry[],
  query: string,
): Promise<RankedHit[]> {
  const matches = await searchLocalVectors(cfg, query, 30);
  if (matches.length === 0) return [];
  const lookups = createSearchIndexLookups(index);
  return matches.map((match) => toRankedVectorHit(match, lookups));
}

function matches(entry: SearchIndexEntry, query: string, mode: SearchMode): boolean {
  const values = [
    entry.id,
    entry.title,
    entry.path,
    entry.excerpt,
    entry.searchText ?? "",
    entry.tags.join(" "),
  ].map((value) => value.toLowerCase());

  const normalizedQuery = query.toLowerCase();

  if (mode === "direct") {
    return matchesDirect(entry, normalizedQuery);
  }

  if (mode === "hybrid") {
    return matchesHybrid(values, normalizedQuery);
  }

  return values.some((value) => value.includes(normalizedQuery));
}

function matchesDirect(entry: SearchIndexEntry, query: string): boolean {
  const path = normalizeSearchPath(entry.path);
  const title = entry.title.toLowerCase();
  const id = entry.id.toLowerCase();
  const baseName = path.split("/").pop() ?? "";
  const trimmedQuery = trimMarkdownExtension(query);

  if (matchesExactCandidate([path, title, id, baseName], query)) {
    return true;
  }

  if (trimmedQuery === trimMarkdownExtension(baseName)) {
    return true;
  }

  return matchesPathSuffix(path, [query, trimmedQuery]);
}

function matchesHybrid(values: string[], query: string): boolean {
  const tokens = query
    .split(/[\s,，。！？?/.\\_-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length <= 1) {
    return values.some((value) => value.includes(query));
  }

  return tokens.every((token) => values.some((value) => value.includes(token)));
}

function normalizeSearchPath(pathValue: string): string {
  return pathValue.toLowerCase().replaceAll("\\", "/");
}

function trimMarkdownExtension(value: string): string {
  return value.replace(/\.md$/, "");
}

function matchesExactCandidate(candidates: readonly string[], query: string): boolean {
  return candidates.some((candidate) => candidate === query);
}

function matchesPathSuffix(pathValue: string, queries: readonly string[]): boolean {
  return queries.some((query) => Boolean(query) && pathValue.endsWith(`/${query}`));
}

function createSearchIndexLookups(index: SearchIndexEntry[]): SearchIndexLookups {
  return {
    byPath: new Map(index.map((entry) => [normalizeSearchPath(entry.path), entry])),
    byId: new Map(index.map((entry) => [entry.id, entry])),
  };
}

function toRankedVectorHit(match: LocalVectorPageHit, lookups: SearchIndexLookups): RankedHit {
  const normalizedPath = normalizeSearchPath(match.path);
  const indexed = findIndexedVectorEntry(lookups, match.id, normalizedPath);
  const base = indexedVectorHitBase(indexed, match.id, { ...match, path: normalizedPath });
  return {
    ...base,
    searchText: indexed?.searchText,
    images: indexed?.images ?? [],
    score: match.score,
    retrievalSources: ["vector"],
  };
}

function readEntryRetrievalSources(
  entry: SearchIndexEntry,
  fallback: SearchRetrievalSource[],
): SearchRetrievalSource[] {
  const value = (entry as SearchIndexEntry & { retrievalSources?: unknown }).retrievalSources;
  return Array.isArray(value) && value.every(isSearchRetrievalSource) ? value : fallback;
}

function isSearchRetrievalSource(value: unknown): value is SearchRetrievalSource {
  return value === "token" || value === "vector" || value === "graph";
}

function indexedVectorHitBase(
  indexed: SearchIndexEntry | null,
  fallbackId: string,
  metadata: LocalVectorPageHit,
): Omit<RankedHit, "score" | "searchText" | "images"> {
  return {
    id: pickIndexedValue(indexed?.id, fallbackId),
    title: pickIndexedValue(indexed?.title, metadata.title),
    path: pickIndexedValue(indexed?.path, metadata.path),
    layer: pickIndexedValue(indexed?.layer, "wiki"),
    excerpt: pickIndexedValue(indexed?.excerpt, metadata.excerpt),
    tags: pickIndexedValue(indexed?.tags, []),
    modifiedAt: pickIndexedValue(indexed?.modifiedAt, null),
  };
}

function findIndexedVectorEntry(
  lookups: SearchIndexLookups,
  id: string,
  path: string,
): SearchIndexEntry | null {
  return lookups.byPath.get(path) ?? lookups.byId.get(id) ?? null;
}

function pickIndexedValue<T>(indexed: T | null | undefined, fallback: T): T {
  return indexed ?? fallback;
}
