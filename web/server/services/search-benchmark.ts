/**
 * Deterministic search benchmark runner for the settings UI.
 *
 * Uses the repository sample qrels to compare the old plain substring baseline
 * against the current tokenized hybrid ranker without making network calls.
 */

import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import type { SearchIndexEntry } from "./search-index.js";
import { hybridSearch } from "./search-hybrid.js";

interface SearchBenchmarkResult {
  queryCount: number;
  documentCount: number;
  k: number;
  baseline: SearchBenchmarkMetrics;
  current: SearchBenchmarkMetrics;
}

interface SearchBenchmarkMetrics {
  precision: number;
  recall: number;
  mrr: number;
  ndcg: number;
}

interface BenchmarkQuery {
  id: string;
  query: string;
}

/** Runs the bundled local retrieval benchmark. */
export function runSearchBenchmark(cfg: ServerConfig, k = 5): SearchBenchmarkResult {
  const root = cfg.projectRoot || process.cwd();
  const queriesData = readJson(path.join(root, "search", "queries.sample.json"));
  const qrels = readJson(path.join(root, "search", "qrels.sample.json")) as Record<string, Record<string, number>>;
  const documents = normalizeDocuments(queriesData.documents);
  const queries = normalizeQueries(queriesData.queries);
  return {
    queryCount: queries.length,
    documentCount: documents.length,
    k,
    baseline: summarize(queries.map((query) => evaluate(rankBaseline(documents, query.query), query, qrels, k))),
    current: summarize(queries.map((query) => evaluate(hybridSearch(documents, query.query, { limit: k }), query, qrels, k))),
  };
}

function evaluate(
  ranked: readonly SearchIndexEntry[],
  query: BenchmarkQuery,
  qrels: Record<string, Record<string, number>>,
  k: number,
): SearchBenchmarkMetrics {
  const rels = qrels[query.id] ?? {};
  const topK = ranked.slice(0, k);
  const relevant = Object.entries(rels).filter(([, gain]) => Number(gain) > 0).map(([id]) => id);
  const hits = topK.filter((doc) => Number(rels[doc.id] ?? 0) > 0);
  return {
    precision: topK.length === 0 ? 0 : hits.length / k,
    recall: relevant.length === 0 ? 0 : hits.length / relevant.length,
    mrr: reciprocalRank(ranked, rels),
    ndcg: ndcg(topK, rels, k),
  };
}

function summarize(items: readonly SearchBenchmarkMetrics[]): SearchBenchmarkMetrics {
  const count = items.length || 1;
  return {
    precision: average(items, "precision", count),
    recall: average(items, "recall", count),
    mrr: average(items, "mrr", count),
    ndcg: average(items, "ndcg", count),
  };
}

function rankBaseline(documents: readonly SearchIndexEntry[], query: string): SearchIndexEntry[] {
  const normalizedQuery = query.toLowerCase();
  return documents
    .map((doc) => ({ doc, score: baselineScore(doc, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.doc);
}

function baselineScore(doc: SearchIndexEntry, query: string): number {
  const text = [doc.id, doc.title, doc.path, doc.excerpt, doc.tags.join(" ")].join(" ").toLowerCase();
  return text.includes(query) ? 1 : 0;
}

function reciprocalRank(ranked: readonly SearchIndexEntry[], rels: Record<string, number>): number {
  const index = ranked.findIndex((doc) => Number(rels[doc.id] ?? 0) > 0);
  return index < 0 ? 0 : 1 / (index + 1);
}

function ndcg(rankedDocs: readonly SearchIndexEntry[], rels: Record<string, number>, k: number): number {
  const dcg = rankedDocs.slice(0, k).reduce((sum, doc, index) => sum + discountedGain(Number(rels[doc.id] ?? 0), index), 0);
  const ideal = Object.values(rels).map(Number).filter((gain) => gain > 0).sort((a, b) => b - a);
  const idcg = ideal.slice(0, k).reduce((sum, gain, index) => sum + discountedGain(gain, index), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

function discountedGain(gain: number, index: number): number {
  return (2 ** gain - 1) / Math.log2(index + 2);
}

function average(items: readonly SearchBenchmarkMetrics[], key: keyof SearchBenchmarkMetrics, count: number): number {
  return items.reduce((sum, item) => sum + item[key], 0) / count;
}

function normalizeDocuments(value: unknown): SearchIndexEntry[] {
  return Array.isArray(value) ? value.flatMap(normalizeDocument) : [];
}

// fallow-ignore-next-line complexity
function normalizeDocument(value: unknown): SearchIndexEntry[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Partial<SearchIndexEntry>;
  if (!item.id || !item.title || !item.path) return [];
  return [{
    id: String(item.id),
    title: String(item.title),
    path: String(item.path),
    layer: item.layer === "wiki" || item.layer === "raw" || item.layer === "source" ? item.layer : "unknown",
    excerpt: String(item.excerpt ?? ""),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    modifiedAt: null,
  }];
}

function normalizeQueries(value: unknown): BenchmarkQuery[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const query = item as Partial<BenchmarkQuery>;
    return query.id && query.query ? [{ id: String(query.id), query: String(query.query) }] : [];
  });
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}
