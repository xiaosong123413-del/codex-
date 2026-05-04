/**
 * Reads and normalizes markdown pages for the Wiki home Graphy pipeline.
 *
 * The parser resolves the active wiki root, parses YAML frontmatter, extracts
 * Obsidian-style wikilinks, and builds lookup keys for title/path/alias matching.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ServerConfig } from "../config.js";
import { runtimePath, sourcePath } from "../runtime-paths.js";
import { NODE_COLORS, type ParsedWikiPage, type WikiGraphNodeType } from "./wiki-graph-model.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/gu;
const PATH_NODE_TYPES: Readonly<Record<string, WikiGraphNodeType>> = {
  concept: "concept",
  concepts: "concept",
  crm: "entity",
  entities: "entity",
  entity: "entity",
  "index.md": "overview",
  "moc.md": "overview",
  overview: "overview",
  overviews: "overview",
  procedures: "synthesis",
  queries: "query",
  query: "query",
  source: "source",
  sources: "source",
  syntheses: "synthesis",
  synthesis: "synthesis",
  comparison: "comparison",
  comparisons: "comparison",
  个人信息档案: "entity",
  聊天记录: "source",
};

/** Reads all eligible markdown pages from the configured wiki root. */
export function readWikiPages(cfg: ServerConfig): ParsedWikiPage[] {
  const wikiRoot = resolveWikiRoot(cfg);
  if (!fs.existsSync(wikiRoot) || !fs.statSync(wikiRoot).isDirectory()) {
    return [];
  }
  return listMarkdownFiles(wikiRoot).map((filePath) => parseWikiPage(wikiRoot, filePath));
}

/** Builds a normalized lookup table for wikilink target resolution. */
export function buildPageLookup(pages: readonly ParsedWikiPage[]): Map<string, ParsedWikiPage> {
  const lookup = new Map<string, ParsedWikiPage>();
  for (const page of pages) {
    for (const key of lookupKeys(page)) {
      if (!lookup.has(key)) {
        lookup.set(key, page);
      }
    }
  }
  return lookup;
}

/** Normalizes titles, paths, and aliases to a comparable key. */
export function normalizeLookupKey(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/\.(md|markdown|txt)$/iu, "").toLowerCase();
}

function resolveWikiRoot(cfg: ServerConfig): string {
  const sourceWikiRoot = sourcePath(cfg, "wiki");
  if (fs.existsSync(sourceWikiRoot)) {
    return sourceWikiRoot;
  }
  return runtimePath(cfg, "wiki");
}

function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "_已录入") {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
    } else if (/\.(md|markdown|txt)$/iu.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseWikiPage(wikiRoot: string, filePath: string): ParsedWikiPage {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  const logicalPath = toWikiLogicalPath(wikiRoot, filePath);
  return {
    path: logicalPath,
    title: readString(frontmatter, "title") || readFirstHeading(body) || titleFromPath(logicalPath),
    type: readNodeType(frontmatter, logicalPath),
    sources: readStringArray(frontmatter, "sources"),
    aliases: readStringArray(frontmatter, "aliases"),
    links: extractWikilinks(body),
  };
}

function parseMarkdownFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/^\uFEFF/u, "");
  const match = FRONTMATTER_RE.exec(normalized);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }
  return {
    frontmatter: parseYamlObject(match[1] ?? ""),
    body: normalized.slice(match[0].length),
  };
}

function parseYamlObject(value: string): Record<string, unknown> {
  try {
    const parsed = yaml.load(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readNodeType(frontmatter: Record<string, unknown>, logicalPath: string): WikiGraphNodeType {
  const value = readString(frontmatter, "type").toLowerCase();
  return value in NODE_COLORS ? (value as WikiGraphNodeType) : inferNodeTypeFromPath(logicalPath);
}

function inferNodeTypeFromPath(logicalPath: string): WikiGraphNodeType {
  const segment = logicalPath.split("/")[1]?.toLowerCase() ?? "";
  return PATH_NODE_TYPES[segment] ?? "other";
}

function readString(frontmatter: Record<string, unknown>, key: string): string {
  const value = frontmatter[key];
  return typeof value === "string" ? value.trim().replace(/^['"]|['"]$/gu, "") : "";
}

function readStringArray(frontmatter: Record<string, unknown>, key: string): string[] {
  const value = frontmatter[key];
  if (Array.isArray(value)) {
    return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
  }
  return typeof value === "string" && value.trim() ? uniqueStrings([value]) : [];
}

function extractWikilinks(body: string): string[] {
  const links: string[] = [];
  for (const match of body.matchAll(WIKILINK_RE)) {
    const target = normalizeWikilinkTarget(match[1] ?? "");
    if (target) {
      links.push(target);
    }
  }
  return uniqueStrings(links);
}

function normalizeWikilinkTarget(target: string): string {
  return target.split("|")[0]!.split("#")[0]!.trim();
}

function lookupKeys(page: ParsedWikiPage): string[] {
  const pathWithoutExt = page.path.replace(/\.(md|markdown|txt)$/iu, "");
  return uniqueStrings([
    page.path,
    pathWithoutExt,
    pathWithoutExt.replace(/^wiki\//u, ""),
    titleFromPath(page.path),
    page.title,
    ...page.aliases,
  ]).map(normalizeLookupKey);
}

function toWikiLogicalPath(wikiRoot: string, filePath: string): string {
  return `wiki/${path.relative(wikiRoot, filePath).split(path.sep).join("/")}`;
}

function readFirstHeading(body: string): string {
  return /^#\s+(.+?)\s*$/mu.exec(body)?.[1]?.trim() ?? "";
}

function titleFromPath(value: string): string {
  const base = value.split("/").pop() ?? value;
  return base.replace(/\.(md|markdown|txt)$/iu, "").replace(/[-_]+/gu, " ");
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
