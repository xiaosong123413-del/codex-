/**
 * Graph expansion for chat retrieval.
 *
 * Starting from top lexical/vector hits, this adds nearby wiki pages using the
 * same four legacy signals: direct links, shared sources, Adamic-Adar common
 * neighbors, and type affinity.
 */
import type { ServerConfig } from "../config.js";
import { loadSearchIndex, type SearchIndexEntry } from "./search-index.js";
import type { SearchResult } from "./search-router.js";
import { readWikiPages, buildPageLookup, normalizeLookupKey } from "./wiki-graph-pages.js";
import type { ParsedWikiPage } from "./wiki-graph-model.js";

const MIN_RELEVANCE = 2.0;
const MAX_SEEDS = 10;
const RELATED_PER_SEED = 3;

/** Adds graph-related pages after the current search results. */
export function expandSearchResultsWithGraph(
  cfg: ServerConfig | undefined,
  results: readonly SearchResult[],
): SearchResult[] {
  if (!cfg || results.length === 0) return [...results];
  const pages = readWikiPages(cfg);
  const relatedPaths = findRelatedPaths(pages, results.slice(0, MAX_SEEDS));
  const indexed = new Map(loadSearchIndex(cfg).map((entry) => [normalizePath(entry.path), entry]));
  const seen = new Set(results.map((result) => normalizePath(result.path)));
  return [...results, ...materializeRelatedResults(relatedPaths, indexed, seen)];
}

function findRelatedPaths(pages: readonly ParsedWikiPage[], seeds: readonly SearchResult[]): string[] {
  const lookup = buildPageLookup(pages);
  const pageByPath = new Map(pages.map((page) => [normalizePath(page.path), page]));
  const out: string[] = [];
  for (const seed of seeds) {
    const page = pageByPath.get(normalizePath(seed.path));
    if (!page) continue;
    out.push(...rankRelatedPages(page, pages, lookup).slice(0, RELATED_PER_SEED).map((item) => item.path));
  }
  return [...new Set(out)];
}

function rankRelatedPages(
  source: ParsedWikiPage,
  pages: readonly ParsedWikiPage[],
  lookup: ReadonlyMap<string, ParsedWikiPage>,
): Array<{ path: string; score: number }> {
  return pages
    .filter((page) => page.path !== source.path)
    .map((page) => ({ path: page.path, score: relevance(source, page, pages, lookup) }))
    .filter((item) => item.score >= MIN_RELEVANCE)
    .sort((left, right) => right.score - left.score);
}

function relevance(
  left: ParsedWikiPage,
  right: ParsedWikiPage,
  pages: readonly ParsedWikiPage[],
  lookup: ReadonlyMap<string, ParsedWikiPage>,
): number {
  return directLinkScore(left, right, lookup) * 3
    + sourceOverlap(left, right) * 4
    + commonNeighborScore(left, right, pages, lookup) * 1.5
    + typeAffinity(left, right);
}

function directLinkScore(left: ParsedWikiPage, right: ParsedWikiPage, lookup: ReadonlyMap<string, ParsedWikiPage>): number {
  return Number(linksTo(left, right, lookup)) + Number(linksTo(right, left, lookup));
}

function linksTo(left: ParsedWikiPage, right: ParsedWikiPage, lookup: ReadonlyMap<string, ParsedWikiPage>): boolean {
  return left.links.some((link) => lookup.get(normalizeLookupKey(link))?.path === right.path);
}

function sourceOverlap(left: ParsedWikiPage, right: ParsedWikiPage): number {
  const sources = new Set(left.sources.map((source) => source.toLowerCase()));
  return right.sources.filter((source) => sources.has(source.toLowerCase())).length;
}

function commonNeighborScore(
  left: ParsedWikiPage,
  right: ParsedWikiPage,
  pages: readonly ParsedWikiPage[],
  lookup: ReadonlyMap<string, ParsedWikiPage>,
): number {
  const leftNeighbors = neighborPaths(left, lookup);
  const rightNeighbors = neighborPaths(right, lookup);
  return [...leftNeighbors].filter((id) => rightNeighbors.has(id)).reduce((sum, id) => sum + adamicAdar(id, pages, lookup), 0);
}

function neighborPaths(page: ParsedWikiPage, lookup: ReadonlyMap<string, ParsedWikiPage>): Set<string> {
  return new Set(page.links.flatMap((link) => lookup.get(normalizeLookupKey(link))?.path ?? []));
}

function adamicAdar(pathValue: string, pages: readonly ParsedWikiPage[], lookup: ReadonlyMap<string, ParsedWikiPage>): number {
  const page = pages.find((item) => item.path === pathValue);
  const degree = page ? Math.max(2, neighborPaths(page, lookup).size) : 2;
  return 1 / Math.log(degree);
}

function typeAffinity(left: ParsedWikiPage, right: ParsedWikiPage): number {
  if (left.type === "concept" && right.type === "entity") return 1.2;
  if (left.type === "entity" && right.type === "concept") return 1.2;
  if (left.type === right.type) return 0.8;
  return 0.5;
}

function materializeRelatedResults(
  paths: readonly string[],
  indexed: ReadonlyMap<string, SearchIndexEntry>,
  seen: Set<string>,
): SearchResult[] {
  return paths.flatMap((pathValue) => {
    const normalized = normalizePath(pathValue);
    const entry = indexed.get(normalized);
    if (!entry || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ ...entry, images: entry.images ?? [], retrievalSources: ["graph"] }];
  });
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").toLowerCase();
}
