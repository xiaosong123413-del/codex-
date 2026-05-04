/**
 * Builds the local search index from wiki and raw markdown files.
 *
 * Writes `.llmwiki/search-index.json` on server startup so the search
 * routes can match titles, excerpts, tags, and full body text.
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { runtimePath, sourcePath } from "../runtime-paths.js";
import type { SearchIndexEntry } from "./search-index.js";
import { extractMarkdownImages } from "./markdown-images.js";
import { syncLocalVectorIndex } from "./local-vector-search.js";

interface Frontmatter {
  title?: string;
  tags?: string[];
  aliases?: string[];
  summary?: string;
  [key: string]: unknown;
}

interface SearchEntryPaths {
  logicalPath: string;
  relativePath: string;
}

interface YamlArrayState {
  key: string;
  items: string[];
}

const WIKI_LAYERS: Array<{ layer: SearchIndexEntry["layer"]; dir: string }> = [
  { layer: "wiki", dir: "wiki" },
  { layer: "raw", dir: "raw" },
  { layer: "source", dir: "sources_full" },
];

const EXCERPT_MAX_LENGTH = 200;
const SEARCH_TEXT_MAX_LENGTH = 5000;

export function buildAndSaveSearchIndex(cfg: ServerConfig): void {
  const entries = buildSearchIndex(cfg);
  const indexPath = runtimePath(cfg, ".llmwiki", "search-index.json");
  const dir = path.dirname(indexPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), "utf8");
  void syncLocalVectorIndex(cfg, entries).catch((error: unknown) => {
    console.warn("local vector index sync failed:", error instanceof Error ? error.message : String(error));
  });
}

function buildSearchIndex(cfg: ServerConfig): SearchIndexEntry[] {
  const entries: SearchIndexEntry[] = [];
  for (const layerRoot of searchLayerRoots(cfg)) {
    collectEntries(layerRoot.root, layerRoot.root, layerRoot.layer, entries);
  }
  return entries;
}

function searchLayerRoots(cfg: ServerConfig): Array<{ layer: SearchIndexEntry["layer"]; root: string }> {
  return WIKI_LAYERS
    .map(({ layer, dir }) => ({
      layer,
      root: layer === "source" ? sourcePath(cfg) : runtimePath(cfg, dir),
    }))
    .filter(({ root }) => isReadableDirectory(root));
}

function isReadableDirectory(root: string): boolean {
  return fs.existsSync(root) && fs.statSync(root).isDirectory();
}

function collectEntries(
  baseDir: string,
  currentDir: string,
  layer: SearchIndexEntry["layer"],
  entries: SearchIndexEntry[],
): void {
  for (const item of readDirectoryItems(currentDir)) {
    const fullPath = path.join(currentDir, item.name);
    if (item.isDirectory()) {
      collectEntries(baseDir, fullPath, layer, entries);
      continue;
    }
    pushMarkdownEntry(baseDir, fullPath, item.name, layer, entries);
  }
}

function readDirectoryItems(currentDir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function pushMarkdownEntry(
  baseDir: string,
  fullPath: string,
  fileName: string,
  layer: SearchIndexEntry["layer"],
  entries: SearchIndexEntry[],
): void {
  if (!/\.md$/i.test(fileName)) return;
  const entry = readEntry(baseDir, fullPath, layer);
  if (entry) entries.push(entry);
}

function readEntry(
  baseDir: string,
  fullPath: string,
  layer: SearchIndexEntry["layer"],
): SearchIndexEntry | null {
  try {
    const content = fs.readFileSync(fullPath, "utf8");
    return createSearchEntry(baseDir, fullPath, layer, content);
  } catch {
    return null;
  }
}

function createSearchEntry(
  baseDir: string,
  fullPath: string,
  layer: SearchIndexEntry["layer"],
  content: string,
): SearchIndexEntry {
  const paths = createSearchEntryPaths(baseDir, fullPath, layer);
  const { frontmatter, body } = parseFrontmatter(content);
  return {
    id: paths.logicalPath,
    title: resolveEntryTitle(frontmatter, body, paths.relativePath),
    path: paths.logicalPath,
    layer,
    excerpt: buildEntryExcerpt(frontmatter, body),
    tags: normalizeTags(frontmatter.tags),
    modifiedAt: readModifiedAt(fullPath),
    searchText: buildSearchText(body),
    images: extractMarkdownImages(body),
  };
}

function createSearchEntryPaths(
  baseDir: string,
  fullPath: string,
  layer: SearchIndexEntry["layer"],
): SearchEntryPaths {
  const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
  return {
    relativePath,
    logicalPath: layer === "wiki" ? `wiki/${relativePath}` : relativePath,
  };
}

function resolveEntryTitle(frontmatter: Frontmatter, body: string, relativePath: string): string {
  return frontmatter.title ?? extractH1(body) ?? stemToTitle(relativePath);
}

function buildEntryExcerpt(frontmatter: Frontmatter, body: string): string {
  return buildExcerpt(frontmatter.summary ?? body);
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  try {
    const yaml = match[1];
    const parsed = parseSimpleYaml(yaml);
    return { frontmatter: parsed, body: match[2] };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

function parseSimpleYaml(yaml: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = yaml.split("\n");
  let arrayState: YamlArrayState | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    arrayState = applyYamlLine(result, lines[index] ?? "", lines[index + 1], arrayState);
  }

  finishYamlArray(result, arrayState);
  return result;
}

function applyYamlLine(
  result: Frontmatter,
  line: string,
  nextLine: string | undefined,
  arrayState: YamlArrayState | null,
): YamlArrayState | null {
  if (appendYamlArrayItem(line, arrayState)) return arrayState;
  finishYamlArray(result, arrayState);
  const parsed = parseKeyValue(line);
  if (!parsed) return null;
  return writeYamlEntry(result, parsed, nextLine);
}

function appendYamlArrayItem(line: string, arrayState: YamlArrayState | null): boolean {
  if (!arrayState) return false;
  const arrayValue = parseArrayItem(line);
  if (!arrayValue) return false;
  arrayState.items.push(arrayValue);
  return true;
}

function finishYamlArray(result: Frontmatter, arrayState: YamlArrayState | null): void {
  if (arrayState) result[arrayState.key] = arrayState.items;
}

function writeYamlEntry(
  result: Frontmatter,
  parsed: { key: string; value: string },
  nextLine: string | undefined,
): YamlArrayState | null {
  if (startsBlockArray(parsed.value, nextLine)) {
    return { key: parsed.key, items: [] };
  }
  result[parsed.key] = normalizeYamlValue(parsed.value);
  return null;
}

function parseArrayItem(line: string): string | null {
  const match = line.match(/^\s+-\s+(.+)$/);
  return match ? unquoteYamlString(match[1]).trim() : null;
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
  return match ? { key: match[1], value: match[2].trim() } : null;
}

function startsBlockArray(value: string, nextLine: string | undefined): boolean {
  return value === "" && Boolean(nextLine && /^\s+-\s+/.test(nextLine));
}

function normalizeYamlValue(value: string): unknown {
  if (value === "[]") return [];
  if (value === "") return "";
  return unquoteYamlString(value);
}

function unquoteYamlString(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function extractH1(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function stemToTitle(relativePath: string): string {
  const stem = path.basename(relativePath, ".md");
  return stem.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildExcerpt(text: string): string {
  const clean = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .trim();

  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const excerpt = lines.slice(0, 2).join(" ");
  return excerpt.length > EXCERPT_MAX_LENGTH
    ? `${excerpt.slice(0, EXCERPT_MAX_LENGTH)}…`
    : excerpt;
}

function buildSearchText(body: string): string {
  const clean = body
    .replace(/^---\n[\s\S]*?\n---\n?/u, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/[*_~]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .trim();

  return clean.length > SEARCH_TEXT_MAX_LENGTH
    ? clean.slice(0, SEARCH_TEXT_MAX_LENGTH)
    : clean;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .map((tag) => tag.trim());
}

function readModifiedAt(fullPath: string): string | null {
  try {
    const stat = fs.statSync(fullPath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}
