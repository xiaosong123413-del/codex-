/**
 * Wiki side-image generation helpers.
 *
 * These helpers are called when a brand-new wiki page is created. They do not
 * scan or mutate old pages. If the new page has no existing image reference,
 * the helper writes one PNG under `wiki/.page-media/` and returns markdown with
 * `side_image` frontmatter added.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFrontmatter, parseFrontmatter } from "./markdown.js";
import { renderContentImagePng, type ContentImageContext } from "./content-image.js";

interface WikiSideImageAttachResult {
  content: string;
  generated: boolean;
  sideImagePath: string | null;
}

interface WikiSideImageAttachOptions {
  generator?: (context: ContentImageContext) => Buffer | Promise<Buffer>;
}

const MARKDOWN_IMAGE_RE = /!\[[^\]\n]*\]\([^)]+\)/u;
const HTML_IMAGE_RE = /<img\b[^>]*>/iu;
const PAGE_MEDIA_DIR = "wiki/.page-media";
const AUTO_CAPTION = "根据页面内容自动生成的配图。";

export async function attachGeneratedWikiSideImage(
  root: string,
  logicalPath: string,
  raw: string,
  options: WikiSideImageAttachOptions = {},
): Promise<WikiSideImageAttachResult> {
  const context = buildContext(logicalPath, raw);
  if (!context || hasAnyPageImage(raw)) {
    return { content: raw, generated: false, sideImagePath: null };
  }
  const sideImagePath = buildGeneratedSideImagePath(logicalPath);
  const image = await (options.generator ?? renderContentImagePng)(context);
  await writeSideImage(root, sideImagePath, image);
  return {
    content: upsertSideImageFrontmatter(raw, sideImagePath),
    generated: true,
    sideImagePath,
  };
}

export function toWikiLogicalPath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function buildContext(logicalPath: string, raw: string): ContentImageContext | null {
  const { meta, body } = parseFrontmatter(raw);
  const summary = cleanMarkdownText(body);
  if (!summary) {
    return null;
  }
  return {
    logicalPath,
    title: readTitle(meta, body, logicalPath),
    summary: summary.slice(0, 180),
    keywords: extractKeywords(meta, body),
    label: "WIKI IMAGE",
  };
}

function hasAnyPageImage(raw: string): boolean {
  const { meta, body } = parseFrontmatter(raw);
  return Boolean(readMetaString(meta, "side_image") || MARKDOWN_IMAGE_RE.test(body) || HTML_IMAGE_RE.test(body));
}

function readTitle(meta: Record<string, unknown>, body: string, logicalPath: string): string {
  return readMetaString(meta, "title")
    || /^#\s+(.+?)\s*$/mu.exec(body)?.[1]?.trim()
    || path.posix.basename(logicalPath, ".md");
}

function extractKeywords(meta: Record<string, unknown>, body: string): string[] {
  const candidates = [
    ...readMetaList(meta, "tags"),
    ...Array.from(body.matchAll(/^#{2,4}\s+(.+?)\s*$/gmu), (match) => match[1] ?? ""),
    ...Array.from(body.matchAll(/\[\[([^\]|#\n]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/gu), (match) => match[2] ?? match[1] ?? ""),
  ];
  return uniqueCleanValues(candidates).slice(0, 6);
}

function upsertSideImageFrontmatter(raw: string, sideImagePath: string): string {
  const { meta, body } = parseFrontmatter(raw);
  const nextMeta = {
    ...meta,
    side_image: sideImagePath,
    side_image_caption: readMetaString(meta, "side_image_caption") || AUTO_CAPTION,
  };
  return `${buildFrontmatter(nextMeta)}\n\n${body.trimStart()}`;
}

function buildGeneratedSideImagePath(logicalPagePath: string): string {
  const pageWithoutPrefix = logicalPagePath.replace(/^wiki\//u, "");
  const pageDirectory = path.posix.dirname(pageWithoutPrefix);
  const pageStem = sanitizeFileName(path.posix.basename(pageWithoutPrefix, path.posix.extname(pageWithoutPrefix)));
  const relativePath = pageDirectory === "." ? `${pageStem}-auto.png` : `${pageDirectory}/${pageStem}-auto.png`;
  return `${PAGE_MEDIA_DIR}/${relativePath}`;
}

async function writeSideImage(root: string, logicalPath: string, image: Buffer): Promise<void> {
  const fullPath = path.join(root, ...logicalPath.split("/"));
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, image);
}

function cleanMarkdownText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(MARKDOWN_IMAGE_RE, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/\[\[([^\]|#\n]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/gu, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/[#>*_`~-]+/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function readMetaString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  return typeof value === "string" ? value.trim().replace(/^['"]|['"]$/gu, "") : "";
}

function readMetaList(meta: Record<string, unknown>, key: string): string[] {
  const value = meta[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return readMetaString(meta, key).replace(/^\[|\]$/gu, "").split(/[,，、\s]+/u);
}

function uniqueCleanValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.map((value) => value.replace(/[#*`_[\]]/gu, "").trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"|?*\x00-\x1F]/gu, "-").trim() || "page";
}
