/**
 * Local LanceDB chunk vector store for WebUI retrieval.
 *
 * This is the Web server equivalent of the legacy Tauri Rust vector commands:
 * rows live under `.llm-wiki/lancedb`, table `wiki_chunks_v2`, one row per
 * markdown chunk, and query results are grouped back into page-level hits.
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { resolveContentPath } from "../runtime-paths.js";
import type { SearchIndexEntry } from "./search-index.js";
import { readLocalVectorConfig, type LocalVectorConfig } from "./search-vector-config.js";
import { chunkMarkdown } from "./search-text-chunker.js";

export interface LocalVectorPageHit {
  id: string;
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

interface ChunkRow extends Record<string, unknown> {
  chunk_id: string;
  page_id: string;
  chunk_index: number;
  chunk_text: string;
  heading_path: string;
  path: string;
  title: string;
  excerpt: string;
  vector: number[];
}

interface LanceDistanceRow extends ChunkRow {
  _distance?: number;
}

interface LocalVectorIndexStatus {
  enabled: boolean;
  configured: boolean;
  dbExists: boolean;
  tableExists: boolean;
  chunkCount: number;
  pageCount: number;
  sizeBytes: number;
  updatedAt: string | null;
}

const TABLE_V2 = "wiki_chunks_v2";
const DB_DIR = ".llm-wiki/lancedb";
const EMBEDDING_CONCURRENCY = 4;

/** Embeds all indexed local pages into the legacy-compatible LanceDB table. */
export async function syncLocalVectorIndex(cfg: ServerConfig, entries: readonly SearchIndexEntry[]): Promise<void> {
  const vectorCfg = readLocalVectorConfig();
  if (!vectorCfg.enabled || entries.length === 0) return;
  for (const batch of chunkArray(entries, EMBEDDING_CONCURRENCY)) {
    await Promise.all(batch.map((entry) => upsertEntryChunks(cfg, entry, vectorCfg)));
  }
}

/** Rebuilds the LanceDB table from the current search index. */
export async function rebuildLocalVectorIndex(cfg: ServerConfig, entries: readonly SearchIndexEntry[]): Promise<LocalVectorIndexStatus> {
  await dropVectorTableIfExists(cfg);
  await syncLocalVectorIndex(cfg, entries);
  return readLocalVectorIndexStatus(cfg);
}

/** Searches local LanceDB chunks and returns page-level semantic hits. */
export async function searchLocalVectors(
  cfg: ServerConfig | undefined,
  query: string,
  topK = 10,
): Promise<LocalVectorPageHit[]> {
  if (!cfg) return [];
  const vectorCfg = readLocalVectorConfig();
  if (!vectorCfg.enabled) return [];
  const queryEmbedding = await fetchEmbedding(query, vectorCfg);
  if (!queryEmbedding) return [];
  const rows = await vectorSearchChunks(cfg, queryEmbedding, Math.max(topK * 3, 30));
  return aggregateChunkRows(rows).slice(0, topK);
}

/** Verifies that the configured embedding endpoint returns a usable vector. */
export async function testLocalVectorEmbedding(): Promise<boolean> {
  const vectorCfg = readLocalVectorConfig();
  if (!vectorCfg.enabled) return false;
  const embedding = await fetchEmbeddingStrict("LLM Wiki vector search connectivity test", vectorCfg);
  return Boolean(embedding && embedding.length > 0);
}

/** Reads current local vector table size and freshness for the settings UI. */
export async function readLocalVectorIndexStatus(cfg: ServerConfig): Promise<LocalVectorIndexStatus> {
  const vectorCfg = readLocalVectorConfig();
  const dbPath = vectorDbPath(cfg);
  const table = await openTableIfExists(cfg);
  const rows = table ? await readAllRows(table) : [];
  return {
    enabled: vectorCfg.enabled,
    configured: Boolean(vectorCfg.endpoint && vectorCfg.model),
    dbExists: fs.existsSync(dbPath),
    tableExists: Boolean(table),
    chunkCount: rows.length,
    pageCount: new Set(rows.map((row) => row.page_id)).size,
    sizeBytes: directorySize(dbPath),
    updatedAt: readUpdatedAt(dbPath),
  };
}

async function upsertEntryChunks(
  cfg: ServerConfig,
  entry: SearchIndexEntry,
  vectorCfg: LocalVectorConfig,
): Promise<void> {
  const content = readEntryContent(cfg, entry);
  if (!content.trim()) return;
  const chunks = chunkMarkdown(content, {
    targetChars: vectorCfg.maxChunkChars,
    overlapChars: vectorCfg.overlapChunkChars,
  });
  const rows = await buildChunkRows(entry, chunks, vectorCfg);
  if (rows.length > 0) await vectorUpsertChunks(cfg, entry.path, rows);
}

async function buildChunkRows(
  entry: SearchIndexEntry,
  chunks: ReturnType<typeof chunkMarkdown>,
  cfg: LocalVectorConfig,
): Promise<ChunkRow[]> {
  const rows: ChunkRow[] = [];
  for (const chunk of chunks) {
    const vector = await fetchEmbedding(enrichChunkText(entry.title, chunk.text, chunk.headingPath), cfg);
    if (!vector) continue;
    rows.push({
      chunk_id: `${entry.path}#${chunk.index}`,
      page_id: entry.path,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      heading_path: chunk.headingPath,
      path: entry.path,
      title: entry.title,
      excerpt: entry.excerpt,
      vector,
    });
  }
  return rows;
}

async function vectorUpsertChunks(cfg: ServerConfig, pagePath: string, rows: ChunkRow[]): Promise<void> {
  const table = await openOrCreateTable(cfg, rows);
  await table.delete(`page_id = '${escapeSqlString(pagePath)}'`);
  await table.add(rows);
}

async function vectorSearchChunks(
  cfg: ServerConfig,
  queryEmbedding: number[],
  topK: number,
): Promise<LanceDistanceRow[]> {
  const table = await openTableIfExists(cfg);
  if (!table) return [];
  const rows = await table.vectorSearch(queryEmbedding).limit(topK).toArray();
  return rows.filter(isDistanceRow);
}

async function openOrCreateTable(cfg: ServerConfig, rows: ChunkRow[]): Promise<LanceTable> {
  const db = await connectDb(cfg);
  const names = await db.tableNames();
  return names.includes(TABLE_V2)
    ? await db.openTable(TABLE_V2)
    : await db.createTable(TABLE_V2, rows);
}

async function openTableIfExists(cfg: ServerConfig): Promise<LanceTable | null> {
  const db = await connectDb(cfg);
  return (await db.tableNames()).includes(TABLE_V2) ? await db.openTable(TABLE_V2) : null;
}

async function connectDb(cfg: ServerConfig): Promise<LanceConnection> {
  const lancedb = await import("@lancedb/lancedb");
  const dbPath = vectorDbPath(cfg);
  fs.mkdirSync(dbPath, { recursive: true });
  return await lancedb.connect(dbPath);
}

async function dropVectorTableIfExists(cfg: ServerConfig): Promise<void> {
  const db = await connectDb(cfg);
  if ((await db.tableNames()).includes(TABLE_V2)) await db.dropTable(TABLE_V2);
}

async function readAllRows(table: LanceTable): Promise<LanceDistanceRow[]> {
  const rows = await table.query().limit(100000).toArray();
  return rows.filter(isDistanceRow);
}

async function fetchEmbedding(text: string, cfg: LocalVectorConfig): Promise<number[] | null> {
  const response = await fetch(cfg.endpoint, {
    method: "POST",
    headers: embeddingHeaders(cfg),
    body: JSON.stringify({ model: cfg.model, input: text }),
  });
  if (!response.ok) return null;
  const payload = await readEmbeddingPayload(response);
  const embedding = payload.data?.[0]?.embedding;
  return Array.isArray(embedding) ? embedding.filter((item): item is number => typeof item === "number") : null;
}

async function fetchEmbeddingStrict(text: string, cfg: LocalVectorConfig): Promise<number[] | null> {
  const response = await fetch(cfg.endpoint, {
    method: "POST",
    headers: embeddingHeaders(cfg),
    body: JSON.stringify({ model: cfg.model, input: text }),
  });
  if (!response.ok) {
    throw new Error(await readEmbeddingError(response));
  }
  const payload = await readEmbeddingPayload(response);
  const embedding = payload.data?.[0]?.embedding;
  return Array.isArray(embedding) ? embedding.filter((item): item is number => typeof item === "number") : null;
}

async function readEmbeddingError(response: Response): Promise<string> {
  const text = await response.text();
  const parsed = parseEmbeddingError(text);
  if (parsed) return `Embedding endpoint 返回 HTTP ${response.status}：${parsed}`;
  return `Embedding endpoint 返回 HTTP ${response.status}，请检查 endpoint、模型名和 API Key。`;
}

function parseEmbeddingError(text: string): string | null {
  try {
    const payload = JSON.parse(text) as { error?: { message?: unknown; code?: unknown } };
    const message = typeof payload.error?.message === "string" ? payload.error.message : "";
    const code = typeof payload.error?.code === "string" ? payload.error.code : "";
    return [code, message].filter(Boolean).join(" - ") || null;
  } catch {
    return null;
  }
}

async function readEmbeddingPayload(response: Response): Promise<{ data?: Array<{ embedding?: unknown }> }> {
  const text = await response.text();
  if (looksLikeHtml(text)) {
    throw new Error("Embedding endpoint 返回了网页 HTML。请填写 API 地址，例如 https://xiaoma.best/v1/embeddings。");
  }
  try {
    return JSON.parse(text) as { data?: Array<{ embedding?: unknown }> };
  } catch {
    throw new Error("Embedding endpoint 没有返回合法 JSON，请检查 endpoint、模型名和 API Key。");
  }
}

function looksLikeHtml(text: string): boolean {
  return text.trimStart().toLowerCase().startsWith("<!doctype")
    || text.trimStart().toLowerCase().startsWith("<html");
}

function aggregateChunkRows(rows: readonly LanceDistanceRow[]): LocalVectorPageHit[] {
  const grouped = new Map<string, LanceDistanceRow[]>();
  for (const row of rows) grouped.set(row.page_id, [...(grouped.get(row.page_id) ?? []), row]);
  return [...grouped.values()].map(scorePageRows).sort((left, right) => right.score - left.score);
}

function scorePageRows(rows: LanceDistanceRow[]): LocalVectorPageHit {
  rows.sort((left, right) => distanceScore(right) - distanceScore(left));
  const top = distanceScore(rows[0]!);
  const tail = rows.slice(1).reduce((sum, row) => sum + distanceScore(row), 0);
  return {
    id: rows[0]!.page_id,
    path: rows[0]!.path,
    title: rows[0]!.title,
    excerpt: rows[0]!.excerpt || rows[0]!.chunk_text.slice(0, 300),
    score: top + Math.min(tail * 0.3, Math.max(0, 1 - top)),
  };
}

function readEntryContent(cfg: ServerConfig, entry: SearchIndexEntry): string {
  const filePath = resolveContentPath(cfg, entry.path);
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : entry.searchText ?? "";
  } catch {
    return entry.searchText ?? "";
  }
}

function enrichChunkText(title: string, text: string, headingPath: string): string {
  return [title, headingPath, text].map((part) => part.trim()).filter(Boolean).join("\n\n");
}

function distanceScore(row: LanceDistanceRow): number {
  return 1 / (1 + Math.max(0, row._distance ?? 0));
}

function embeddingHeaders(cfg: LocalVectorConfig): Record<string, string> {
  return cfg.apiKey ? { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` } : { "Content-Type": "application/json" };
}

function isDistanceRow(value: unknown): value is LanceDistanceRow {
  return Boolean(value && typeof value === "object" && typeof (value as Partial<LanceDistanceRow>).page_id === "string");
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function vectorDbPath(cfg: ServerConfig): string {
  return path.join(cfg.runtimeRoot, ...DB_DIR.split("/"));
}

function directorySize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, item) => {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) return sum + directorySize(fullPath);
    return sum + fs.statSync(fullPath).size;
  }, 0);
}

function readUpdatedAt(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const mtime = fs.statSync(dir).mtime;
  return Number.isNaN(mtime.getTime()) ? null : mtime.toISOString();
}

type LanceConnection = Awaited<ReturnType<typeof import("@lancedb/lancedb").connect>>;
type LanceTable = Awaited<ReturnType<LanceConnection["openTable"]>>;
