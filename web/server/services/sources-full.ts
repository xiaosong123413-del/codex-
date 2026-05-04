import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { appendFlashDiaryEntry } from "./flash-diary.js";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";
import { createRenderer } from "../render/markdown.js";

const SOURCES_FULL_DIR = "sources_full";
const LLMWIKI_DIR = ".llmwiki";
const INDEX_FILE = "sources-full-index.json";
const HIGHLIGHTS_FILE = "source-highlights.json";

type SourceKind = "clipping" | "flash-diary" | "inbox" | "attachment" | "source";

interface SourcesFullItem {
  id: string;
  path: string;
  title: string;
  kind: SourceKind;
  sourceUrl?: string;
  sourceChannel?: string;
  importedAt?: string;
  syncSource?: string;
  tags: string[];
  lists: string[];
  compiled: boolean;
  concepts: string[];
  attachments: string[];
  ocrTextPath?: string;
  archivePath?: string;
  note?: string;
  modifiedAt: string;
  excerpt: string;
}

interface SourcesFullDetail extends SourcesFullItem {
  raw: string;
  html: string;
  ocrText: string;
  highlights: SourceHighlight[];
}

interface SourcesFullListOptions {
  query?: string;
  filter?: string;
  tag?: string;
  list?: string;
}

interface SourceMetaPatch {
  title?: string;
  sourceUrl?: string;
  sourceChannel?: string;
  tags?: string[];
  lists?: string[];
  note?: string;
}

interface SourceHighlight {
  id: string;
  text: string;
  note?: string;
  createdAt: string;
}

interface SourceIndexFile {
  version: 1;
  records: Record<string, SourceIndexRecord>;
}

interface SourceIndexRecord {
  path: string;
  title?: string;
  sourceUrl?: string;
  sourceChannel?: string;
  importedAt?: string;
  syncSource?: string;
  tags?: string[];
  lists?: string[];
  compiled?: boolean;
  concepts?: string[];
  attachments?: string[];
  ocrTextPath?: string;
  archivePath?: string;
  note?: string;
}

type HighlightFile = Record<string, SourceHighlight[]>;

interface ScanCacheEntry {
  signature: string;
  items: SourcesFullItem[];
}

interface SourcesFullRuntimeState {
  root: string;
  index: SourceIndexFile;
  completed: Set<string>;
}

const scanCache = new Map<string, ScanCacheEntry>();

export async function listSourcesFullItems(
  runtimeRoot: string,
  options: SourcesFullListOptions = {},
): Promise<{ items: SourcesFullItem[] }> {
  const scanned = await scanSourcesFull(runtimeRoot);
  const query = normalizeSearch(options.query ?? "");
  const filter = options.filter ?? "all";
  const tag = options.tag?.trim();
  const list = options.list?.trim();
  const items = scanned
    .filter((item) => matchesFilter(item, filter))
    .filter((item) => !tag || item.tags.includes(tag))
    .filter((item) => !list || item.lists.includes(list))
    .filter((item) => !query || searchableText(runtimeRoot, item).includes(query))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { items };
}

export async function getSourcesFullItem(sourceVaultRoot: string, runtimeRoot: string, id: string): Promise<SourcesFullDetail> {
  const found = await findSourceFullEntry(runtimeRoot, id);
  if (!found) throw new Error("source not found");
  const { item, raw } = found;
  const renderer = createRenderer({ pageLookupRoot: sourceVaultRoot });
  const rendered = renderer.render(raw);
  return {
    ...item,
    raw,
    html: rendered.html,
    ocrText: readOcrText(runtimeRoot, id),
    highlights: readHighlights(runtimeRoot)[id] ?? [],
  };
}

export async function archiveSourceItem(
  sourceVaultRoot: string,
  runtimeRoot: string,
  id: string,
): Promise<{ path: string }> {
  const detail = await getSourcesFullItem(sourceVaultRoot, runtimeRoot, id);
  const archivePath = `.llmwiki/archives/${id}.html`;
  const archiveHtml = [
    "<!doctype html>",
    "<html>",
    "<head>",
    '  <meta charset="utf-8" />',
    `  <title>${escapeHtml(detail.title)}</title>`,
    "</head>",
    "<body>",
    detail.html,
    "</body>",
    "</html>",
    "",
  ].join("\n");
  const archiveFile = path.join(runtimeRoot, ...archivePath.split("/"));
  await mkdir(path.dirname(archiveFile), { recursive: true });
  await writeFile(archiveFile, archiveHtml, "utf8");
  const index = readIndex(runtimeRoot);
  index.records[id] = {
    ...(index.records[id] ?? { path: detail.path }),
    path: detail.path,
    archivePath,
  };
  await writeJson(getIndexPath(runtimeRoot), index);
  return { path: archivePath };
}

export async function updateSourcesFullMeta(
  runtimeRoot: string,
  id: string,
  patch: SourceMetaPatch,
): Promise<SourcesFullItem> {
  const item = (await listSourcesFullItems(runtimeRoot)).items.find((candidate) => candidate.id === id);
  if (!item) throw new Error("source not found");
  const index = readIndex(runtimeRoot);
  const current = index.records[id] ?? { path: item.path };
  index.records[id] = {
    ...current,
    path: item.path,
    title: patch.title ?? current.title,
    sourceUrl: patch.sourceUrl ?? current.sourceUrl,
    sourceChannel: patch.sourceChannel ?? current.sourceChannel,
    tags: patch.tags ? normalizeList(patch.tags) : current.tags,
    lists: patch.lists ? normalizeList(patch.lists) : current.lists,
    note: patch.note ?? current.note,
  };
  await writeJson(getIndexPath(runtimeRoot), index);
  const raw = await findSourceFullEntry(runtimeRoot, id);
  if (!raw) throw new Error("source not found");
  return raw.item;
}

export async function addSourceHighlight(
  runtimeRoot: string,
  id: string,
  input: { text: string; note?: string; createdAt?: string },
): Promise<SourceHighlight> {
  const existing = await findSourceFullEntry(runtimeRoot, id);
  if (!existing) throw new Error("source not found");
  const highlights = readHighlights(runtimeRoot);
  const record: SourceHighlight = {
    id: crypto.randomUUID(),
    text: input.text.trim(),
    note: input.note?.trim() || undefined,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  highlights[id] = [record, ...(highlights[id] ?? [])];
  await writeJson(getHighlightsPath(runtimeRoot), highlights);
  return record;
}

export async function runSourceOcr(
  runtimeRoot: string,
  id: string,
  input: { text?: string } = {},
): Promise<{ path: string; text: string }> {
  const found = await findSourceFullEntry(runtimeRoot, id);
  if (!found) throw new Error("source not found");
  const { item, raw } = found;
  const extracted = input.text?.trim() || extractOcrTextFromMarkdown(raw);
  const ocrDir = path.join(runtimeRoot, LLMWIKI_DIR, "ocr");
  await mkdir(ocrDir, { recursive: true });
  const relativePath = `.llmwiki/ocr/${id}.txt`;
  await writeFile(path.join(runtimeRoot, ...relativePath.split("/")), `${extracted}\n`, "utf8");
  const index = readIndex(runtimeRoot);
  index.records[id] = { ...(index.records[id] ?? { path: item.path }), path: item.path, ocrTextPath: relativePath };
  await writeJson(getIndexPath(runtimeRoot), index);
  return { path: relativePath, text: extracted };
}

export async function createSourceBookmark(
  sourceVaultRoot: string,
  input: { url: string; title?: string; description?: string; now?: Date },
): Promise<{ path: string }> {
  const now = input.now ?? new Date();
  const title = (input.title || input.url).trim();
  const fileName = `${formatDate(now)}-${safeFileName(title)}.md`;
  const relativePath = `raw/\u526a\u85cf/${fileName}`;
  const markdown = [
    "---",
    `title: ${title}`,
    `source_url: ${input.url.trim()}`,
    "source_channel: web",
    `imported_at: ${now.toISOString()}`,
    "---",
    "",
    input.description?.trim() || "",
    "",
  ].join("\n");
  await writeRawEntry(sourceVaultRoot, relativePath, markdown);
  return { path: relativePath };
}

export async function createSourceNote(
  sourceVaultRoot: string,
  input: { title: string; body: string; target: "clipping" | "flash-diary"; now?: Date },
): Promise<{ path: string }> {
  const now = input.now ?? new Date();
  if (input.target === "flash-diary") {
    const result = await appendFlashDiaryEntry(sourceVaultRoot, {
      text: `### ${input.title.trim()}\n\n${input.body.trim()}`,
      mediaPaths: [],
      now,
    });
    return { path: result.path };
  }
  const fileName = `${formatDate(now)}-${safeFileName(input.title)}.md`;
  const relativePath = `raw/\u526a\u85cf/${fileName}`;
  await writeRawEntry(sourceVaultRoot, relativePath, `# ${input.title.trim()}\n\n${input.body.trim()}\n`);
  return { path: relativePath };
}

async function scanSourcesFull(runtimeRoot: string): Promise<SourcesFullItem[]> {
  const state = readSourcesFullRuntimeState(runtimeRoot);
  if (!state) return [];
  const files = listSourceMarkdownFiles(state.root);
  const signature = buildScanSignature(runtimeRoot, files);
  const cached = scanCache.get(runtimeRoot);
  if (cached?.signature === signature) return cached.items.map(cloneSourceItem);

  const items = files.map((full) => readSourceFullFile(runtimeRoot, full, state).item);
  scanCache.set(runtimeRoot, { signature, items: items.map(cloneSourceItem) });
  return items;
}

function buildScanSignature(runtimeRoot: string, files: string[]): string {
  const sourceParts = files.map((full) => {
    const stat = fs.statSync(full);
    return `${toPosix(path.relative(runtimeRoot, full))}:${stat.size}:${stat.mtimeMs}`;
  });
  return [
    ...sourceParts,
    sidecarSignature(getIndexPath(runtimeRoot)),
    sidecarSignature(path.join(runtimeRoot, ".llmwiki-batch-state.json")),
    sidecarSignature(path.join(runtimeRoot, LLMWIKI_DIR, "batch-state.json")),
  ].join("|");
}

function sidecarSignature(file: string): string {
  if (!fs.existsSync(file)) return `${file}:missing`;
  const stat = fs.statSync(file);
  return `${file}:${stat.size}:${stat.mtimeMs}`;
}

function cloneSourceItem(item: SourcesFullItem): SourcesFullItem {
  return {
    ...item,
    tags: [...item.tags],
    lists: [...item.lists],
    concepts: [...item.concepts],
    attachments: [...item.attachments],
  };
}

async function findSourceFullEntry(
  runtimeRoot: string,
  id: string,
): Promise<{ item: SourcesFullItem; raw: string } | undefined> {
  const state = readSourcesFullRuntimeState(runtimeRoot);
  if (!state) return undefined;
  for (const full of listSourceMarkdownFiles(state.root)) {
    const relativePath = toPosix(path.relative(runtimeRoot, full));
    if (sourceId(relativePath) !== id) continue;
    return readSourceFullFile(runtimeRoot, full, state);
  }
  return undefined;
}

function readSourcesFullRuntimeState(runtimeRoot: string): SourcesFullRuntimeState | null {
  const root = path.join(runtimeRoot, SOURCES_FULL_DIR);
  if (!fs.existsSync(root)) {
    return null;
  }
  return {
    root,
    index: readIndex(runtimeRoot),
    completed: readCompletedFiles(runtimeRoot),
  };
}

function listSourceMarkdownFiles(root: string): string[] {
  return listMarkdownFilesRecursive(root)
    .filter((full) => !isAttachmentCopyMarkdown(root, full));
}

function isAttachmentCopyMarkdown(root: string, fullPath: string): boolean {
  return toPosix(path.relative(root, fullPath)).startsWith("\u9644\u4ef6\u526f\u672c\uff08\u975eMarkdown\uff09/");
}

function readSourceFullFile(
  runtimeRoot: string,
  fullPath: string,
  state: SourcesFullRuntimeState,
): { item: SourcesFullItem; raw: string } {
  const relativePath = toPosix(path.relative(runtimeRoot, fullPath));
  const id = sourceId(relativePath);
  const raw = fs.readFileSync(fullPath, "utf8");
  const item = buildSourceFullItem(runtimeRoot, fullPath, relativePath, raw, state.index.records[id], state.completed);
  return { item, raw };
}

// fallow-ignore-next-line complexity
function buildSourceFullItem(
  runtimeRoot: string,
  fullPath: string,
  relativePath: string,
  raw: string,
  record: SourceIndexRecord | undefined,
  completed: ReadonlySet<string>,
): SourcesFullItem {
  const frontmatter = parseFrontmatter(raw);
  const stat = fs.statSync(fullPath);
  return {
    id: sourceId(relativePath),
    path: relativePath,
    title: resolveSourceTitle(record, frontmatter, raw, fullPath),
    kind: detectKind(relativePath),
    sourceUrl: resolveSourceUrl(record, frontmatter),
    sourceChannel: resolveOptionalText(record?.sourceChannel, frontmatter.source_channel),
    importedAt: resolveOptionalText(record?.importedAt, frontmatter.imported_at),
    syncSource: record?.syncSource,
    tags: resolveSourceList(record?.tags, frontmatter.tags),
    lists: resolveSourceList(record?.lists, frontmatter.lists),
    compiled: resolveCompiledFlag(record?.compiled, completed, relativePath),
    concepts: normalizeList(record?.concepts ?? []),
    attachments: resolveSourceAttachments(record?.attachments, raw),
    ocrTextPath: record?.ocrTextPath,
    archivePath: record?.archivePath,
    note: record?.note,
    modifiedAt: stat.mtime.toISOString(),
    excerpt: makeExcerpt(raw),
  };
}

function resolveSourceTitle(
  record: SourceIndexRecord | undefined,
  frontmatter: Record<string, string>,
  raw: string,
  fullPath: string,
): string {
  return record?.title || frontmatter.title || firstHeading(raw) || path.basename(fullPath, path.extname(fullPath));
}

function resolveSourceUrl(
  record: SourceIndexRecord | undefined,
  frontmatter: Record<string, string>,
): string | undefined {
  return record?.sourceUrl ?? frontmatter.source_url ?? frontmatter.url;
}

function resolveOptionalText(primary: string | undefined, fallback: string | undefined): string | undefined {
  return primary ?? fallback;
}

function resolveSourceList(values: string[] | undefined, frontmatterValue: string | undefined): string[] {
  return normalizeList(values ?? splitFrontmatterList(frontmatterValue));
}

function resolveCompiledFlag(
  compiled: boolean | undefined,
  completed: ReadonlySet<string>,
  relativePath: string,
): boolean {
  return compiled ?? completed.has(relativePath);
}

function resolveSourceAttachments(attachments: string[] | undefined, raw: string): string[] {
  return attachments ?? extractAttachments(raw);
}

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (parts) out[parts[1]!] = parts[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function firstHeading(raw: string): string | undefined {
  return raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function makeExcerpt(raw: string): string {
  return raw
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function sourceId(relativePath: string): string {
  return crypto.createHash("sha1").update(relativePath.replace(/\\/g, "/").toLowerCase()).digest("hex").slice(0, 20);
}

function detectKind(relativePath: string): SourceKind {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/\u526a\u85cf/")) return "clipping";
  if (normalized.includes("/\u95ea\u5ff5\u65e5\u8bb0/")) return "flash-diary";
  if (normalized.includes("/inbox/")) return "inbox";
  if (normalized.includes("/\u9644\u4ef6\u526f\u672c")) return "attachment";
  return "source";
}

function matchesFilter(item: SourcesFullItem, filter: string): boolean {
  switch (filter) {
    case "clipping":
      return item.kind === "clipping";
    case "flash-diary":
      return item.kind === "flash-diary";
    case "inbox":
      return item.kind === "inbox";
    case "assets":
      return item.attachments.length > 0 || item.kind === "attachment";
    case "compiled":
      return item.compiled;
    case "uncompiled":
      return !item.compiled;
    case "all":
    default:
      return true;
  }
}

function searchableText(runtimeRoot: string, item: SourcesFullItem): string {
  const raw = fs.readFileSync(path.join(runtimeRoot, ...item.path.split("/")), "utf8");
  return normalizeSearch([
    item.title,
    item.sourceUrl,
    item.sourceChannel,
    item.tags.join(" "),
    item.lists.join(" "),
    item.note,
    raw,
    readOcrText(runtimeRoot, item.id),
  ].filter(Boolean).join("\n"));
}

function normalizeSearch(value: string): string {
  return value.toLowerCase();
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function splitFrontmatterList(value: string | undefined): string[] {
  if (!value) return [];
  return value.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim()).filter(Boolean);
}

function extractAttachments(raw: string): string[] {
  const markdownLinks = [...raw.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
  return markdownLinks.filter((link) => /\.(png|jpe?g|gif|webp|bmp|svg|pdf)$/i.test(link));
}

function extractOcrTextFromMarkdown(raw: string): string {
  const imageRefs = [...raw.matchAll(/!\[([^\]]*)]\(([^)]+)\)/g)].map((match) =>
    [match[1], path.basename(match[2] ?? "")].filter(Boolean).join(" "),
  );
  return imageRefs.join("\n");
}

function readOcrText(wikiRoot: string, id: string): string {
  const full = path.join(wikiRoot, LLMWIKI_DIR, "ocr", `${id}.txt`);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function readIndex(wikiRoot: string): SourceIndexFile {
  const file = getIndexPath(wikiRoot);
  if (!fs.existsSync(file)) return { version: 1, records: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SourceIndexFile;
    return { version: 1, records: parsed.records ?? {} };
  } catch {
    return { version: 1, records: {} };
  }
}

function readHighlights(wikiRoot: string): HighlightFile {
  const file = getHighlightsPath(wikiRoot);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as HighlightFile;
  } catch {
    return {};
  }
}

function readCompletedFiles(wikiRoot: string): Set<string> {
  const candidates = [
    path.join(wikiRoot, ".llmwiki-batch-state.json"),
    path.join(wikiRoot, LLMWIKI_DIR, "batch-state.json"),
  ];
  const completed = new Set<string>();
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { completed_files?: string[] };
      for (const item of parsed.completed_files ?? []) completed.add(toPosix(item));
    } catch {
      // Ignore corrupt batch-state files; the source library should still render.
    }
  }
  return completed;
}

async function writeRawEntry(wikiRoot: string, relativePath: string, markdown: string): Promise<void> {
  const full = path.join(wikiRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, markdown, "utf8");
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function getIndexPath(wikiRoot: string): string {
  return path.join(wikiRoot, LLMWIKI_DIR, INDEX_FILE);
}

function getHighlightsPath(wikiRoot: string): string {
  return path.join(wikiRoot, LLMWIKI_DIR, HIGHLIGHTS_FILE);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").replace(/\s+/g, "-").slice(0, 80) || "untitled";
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
