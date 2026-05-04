/**
 * Graphy Deep Research service.
 *
 * The service turns a detected graph knowledge gap into an editable research
 * topic, searches the configured web-search provider, asks the active LLM app
 * to synthesize the findings, and saves the result as a wiki query page.
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { runtimePath, sourcePath } from "../runtime-paths.js";
import { buildAndSaveSearchIndex } from "./search-index-builder.js";
import { resolveAgentRuntimeProvider } from "./llm-agent-provider.js";
import { searchWebExternal, type WebSearchResult } from "../../../src/services/cloudflare-web-search.js";
import { atomicWrite, buildFrontmatter, slugify } from "../../../src/utils/markdown.js";

export interface GraphResearchSeed {
  title: string;
  description: string;
  type: string;
}

interface OptimizedGraphResearchTopic {
  topic: string;
  queries: string[];
  rationale: string;
}

export interface GraphResearchRunRequest {
  topic: string;
  queries: string[];
  gap: GraphResearchSeed;
}

interface GraphResearchResult {
  path: string;
  sourceCount: number;
  urls: string[];
  savedAt: string;
}

type GraphResearchPhase = "queued" | "search" | "synthesis" | "saving" | "indexing";

interface GraphResearchProgress {
  phase: GraphResearchPhase;
  message: string;
  active: number;
  queued: number;
}

interface QueuedGraphResearchTask {
  cfg: ServerConfig;
  request: GraphResearchRunRequest;
  onProgress?: (progress: GraphResearchProgress) => void;
  onToken?: (token: string) => void;
  resolve: (result: GraphResearchResult) => void;
  reject: (error: unknown) => void;
}

interface ResearchContext {
  overview: string;
  purpose: string;
}

const MAX_CONCURRENT_RESEARCH_TASKS = 3;
const MAX_QUERY_COUNT = 5;
const MAX_RESULTS_PER_QUERY = 5;
const MAX_CONTEXT_CHARS = 2400;
const RESEARCH_MAX_TOKENS = 2400;
const researchQueue: QueuedGraphResearchTask[] = [];
let activeResearchTasks = 0;

export async function optimizeGraphResearchTopic(
  cfg: ServerConfig,
  seed: GraphResearchSeed,
): Promise<OptimizedGraphResearchTopic> {
  const provider = resolveAgentRuntimeProvider(cfg.projectRoot, null, `graph-research-topic:${Date.now()}`);
  const context = readResearchContext(cfg);
  const raw = await provider.complete(
    buildTopicSystemPrompt(),
    [{ role: "user", content: buildTopicUserPrompt(seed, context) }],
    800,
  );
  return parseOptimizedTopic(raw);
}

export async function runGraphResearch(
  cfg: ServerConfig,
  request: GraphResearchRunRequest,
): Promise<GraphResearchResult> {
  return runGraphResearchNow(cfg, request);
}

export function queueGraphResearch(
  cfg: ServerConfig,
  request: GraphResearchRunRequest,
  onProgress?: (progress: GraphResearchProgress) => void,
  onToken?: (token: string) => void,
): Promise<GraphResearchResult> {
  return new Promise((resolve, reject) => {
    researchQueue.push({ cfg, request, onProgress, onToken, resolve, reject });
    emitQueueProgress(onProgress, "queued", "Research task queued.");
    drainResearchQueue();
  });
}

async function runGraphResearchNow(
  cfg: ServerConfig,
  request: GraphResearchRunRequest,
  onProgress?: (progress: GraphResearchProgress) => void,
  onToken?: (token: string) => void,
): Promise<GraphResearchResult> {
  const topic = normalizeRequiredText(request.topic, "topic");
  const queries = normalizeQueries(request.queries);
  emitQueueProgress(onProgress, "search", `Searching ${queries.length} queries.`);
  const results = await searchQueries(queries);
  emitQueueProgress(onProgress, "synthesis", `Synthesizing ${results.length} sources.`);
  const answer = await synthesizeResearch(cfg, topic, request.gap, queries, results, onToken);
  emitQueueProgress(onProgress, "saving", "Saving research page.");
  const saved = await saveResearchPage(cfg, topic, queries, results, answer);
  emitQueueProgress(onProgress, "indexing", "Refreshing search index.");
  buildAndSaveSearchIndex(cfg);
  return saved;
}

function drainResearchQueue(): void {
  while (activeResearchTasks < MAX_CONCURRENT_RESEARCH_TASKS && researchQueue.length > 0) {
    const task = researchQueue.shift();
    if (task) void runQueuedGraphResearchTask(task);
  }
}

async function runQueuedGraphResearchTask(task: QueuedGraphResearchTask): Promise<void> {
  activeResearchTasks += 1;
  try {
    const result = await runGraphResearchNow(task.cfg, task.request, task.onProgress, task.onToken);
    task.resolve(result);
  } catch (error) {
    task.reject(error);
  } finally {
    activeResearchTasks -= 1;
    drainResearchQueue();
  }
}

function emitQueueProgress(
  onProgress: ((progress: GraphResearchProgress) => void) | undefined,
  phase: GraphResearchPhase,
  message: string,
): void {
  onProgress?.({ phase, message, active: activeResearchTasks, queued: researchQueue.length });
}

function buildTopicSystemPrompt(): string {
  return [
    "You optimize research topics for a personal wiki graph.",
    "Return strict JSON only: {\"topic\":\"...\",\"queries\":[\"...\"],\"rationale\":\"...\"}.",
    "Use the user's working language. Keep 2-5 precise web search queries.",
  ].join("\n");
}

function buildTopicUserPrompt(seed: GraphResearchSeed, context: ResearchContext): string {
  return [
    `<wiki_purpose>${truncate(context.purpose, MAX_CONTEXT_CHARS)}</wiki_purpose>`,
    `<wiki_overview>${truncate(context.overview, MAX_CONTEXT_CHARS)}</wiki_overview>`,
    `<graph_gap>`,
    `title: ${seed.title}`,
    `type: ${seed.type}`,
    `description: ${seed.description}`,
    `</graph_gap>`,
    "Optimize one research topic and concrete search queries for filling this gap.",
  ].join("\n");
}

function parseOptimizedTopic(raw: string): OptimizedGraphResearchTopic {
  const parsed = parseJsonObject(raw);
  const topic = stringField(parsed, "topic");
  const normalizedQueries = normalizeQueries(stringArrayField(parsed, "queries"));
  const rationale = stringField(parsed, "rationale");
  if (!topic) throw new Error("LLM did not return a research topic.");
  return { topic, queries: normalizedQueries, rationale };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as unknown;
  if (isPlainRecord(parsed)) return parsed;
  throw new Error("LLM returned invalid topic JSON.");
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = /\{[\s\S]*\}/u.exec(trimmed);
  if (match) return match[0];
  throw new Error("LLM did not return JSON.");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function searchQueries(queries: readonly string[]): Promise<WebSearchResult[]> {
  const batches = await Promise.all(queries.map((query) => searchWebExternal(query, MAX_RESULTS_PER_QUERY)));
  const errors = batches.filter((batch) => !batch.ok).map((batch) => batch.ok ? "" : batch.error.message);
  const results = dedupeResults(batches.flatMap((batch) => batch.ok ? batch.data : []));
  if (results.length === 0) {
    throw new Error(errors[0] ?? "No web search results returned.");
  }
  return results;
}

async function synthesizeResearch(
  cfg: ServerConfig,
  topic: string,
  gap: GraphResearchSeed,
  queries: readonly string[],
  results: readonly WebSearchResult[],
  onToken?: (token: string) => void,
): Promise<string> {
  const provider = resolveAgentRuntimeProvider(cfg.projectRoot, null, `graph-research-run:${Date.now()}`);
  const context = readResearchContext(cfg);
  return provider.stream(
    buildSynthesisSystemPrompt(),
    [{ role: "user", content: buildSynthesisUserPrompt(topic, gap, queries, results, context) }],
    RESEARCH_MAX_TOKENS,
    onToken,
  );
}

function buildSynthesisSystemPrompt(): string {
  return [
    "You write concise research notes for a personal wiki.",
    "Synthesize only from the provided wiki context and web search results.",
    "Keep claims source-aware. Include wikilink suggestions when useful.",
  ].join("\n");
}

function buildSynthesisUserPrompt(
  topic: string,
  gap: GraphResearchSeed,
  queries: readonly string[],
  results: readonly WebSearchResult[],
  context: ResearchContext,
): string {
  return [
    `Topic: ${topic}`,
    `Graph gap: ${gap.title} (${gap.type}) - ${gap.description}`,
    `Queries:\n${queries.map((query) => `- ${query}`).join("\n")}`,
    `<wiki_purpose>${truncate(context.purpose, MAX_CONTEXT_CHARS)}</wiki_purpose>`,
    `<wiki_overview>${truncate(context.overview, MAX_CONTEXT_CHARS)}</wiki_overview>`,
    `<web_results>\n${formatWebResults(results)}\n</web_results>`,
    "Write a wiki-ready research note with: summary, key findings, sources, and follow-up wiki links.",
  ].join("\n\n");
}

async function saveResearchPage(
  cfg: ServerConfig,
  topic: string,
  queries: readonly string[],
  results: readonly WebSearchResult[],
  answer: string,
): Promise<GraphResearchResult> {
  const savedAt = new Date().toISOString();
  const logicalPath = uniqueResearchPath(cfg, topic, savedAt);
  const filePath = sourcePath(cfg, logicalPath);
  await atomicWrite(filePath, buildResearchMarkdown(topic, queries, results, answer, savedAt));
  return { path: logicalPath, sourceCount: results.length, urls: results.map((item) => item.url), savedAt };
}

function buildResearchMarkdown(
  topic: string,
  queries: readonly string[],
  results: readonly WebSearchResult[],
  answer: string,
  savedAt: string,
): string {
  const frontmatter = buildFrontmatter({
    title: `Research: ${topic}`,
    type: "query",
    createdAt: savedAt,
    summary: firstLine(answer),
    queries,
    sources: results.map((item) => item.url),
  });
  return `${frontmatter}\n\n# ${topic}\n\n${answer.trim()}\n\n## Search Queries\n\n${queries.map((query) => `- ${query}`).join("\n")}\n`;
}

function uniqueResearchPath(cfg: ServerConfig, topic: string, savedAt: string): string {
  const day = savedAt.slice(0, 10);
  const base = `research-${slugify(topic).slice(0, 72)}-${day}`;
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const logicalPath = `wiki/queries/${base}${suffix}.md`;
    if (!fs.existsSync(sourcePath(cfg, logicalPath))) return logicalPath;
  }
  throw new Error("Could not allocate research page path.");
}

function readResearchContext(cfg: ServerConfig): ResearchContext {
  return {
    overview: readFirstExisting([
      sourcePath(cfg, "wiki", "overview.md"),
      runtimePath(cfg, "wiki", "overview.md"),
    ]),
    purpose: readFirstExisting([
      sourcePath(cfg, "purpose.md"),
      runtimePath(cfg, "purpose.md"),
      sourcePath(cfg, "wiki", "purpose.md"),
      runtimePath(cfg, "wiki", "purpose.md"),
    ]),
  };
}

function readFirstExisting(paths: readonly string[]): string {
  for (const filePath of paths) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return fs.readFileSync(filePath, "utf8");
    }
  }
  return "";
}

function dedupeResults(results: readonly WebSearchResult[]): WebSearchResult[] {
  const byUrl = new Map<string, WebSearchResult>();
  for (const result of results) {
    const key = normalizeUrlKey(result.url);
    if (key && !byUrl.has(key)) byUrl.set(key, result);
  }
  return [...byUrl.values()];
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return value.trim();
  }
}

function formatWebResults(results: readonly WebSearchResult[]): string {
  return results.map((result, index) => [
    `${index + 1}. ${result.title}`,
    `url: ${result.url}`,
    `content: ${result.snippet}`,
  ].join("\n")).join("\n\n");
}

function normalizeQueries(values: readonly string[]): string[] {
  const queries = values.map((value) => value.trim()).filter(Boolean).slice(0, MAX_QUERY_COUNT);
  if (queries.length === 0) throw new Error("At least one search query is required.");
  return queries;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/u).find(Boolean)?.slice(0, 160) ?? "";
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}
