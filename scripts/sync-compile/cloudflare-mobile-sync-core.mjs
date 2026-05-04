/**
 * Cloudflare mobile sync core helpers.
 *
 * Keeps the main mobile sync script focused on orchestration while the record
 * building and media persistence logic lives in a smaller implementation module.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { listMarkdownFilesRecursive } from "./file-listing.mjs";

// fallow-ignore-next-line complexity
export async function buildWikiPageRecords(vaultRoot, version = new Date().toISOString()) {
  const wikiRoot = path.join(vaultRoot, "wiki");
  const files = await listMarkdownFilesRecursive(wikiRoot, {
    ignoreMissing: true,
    normalizeSlashes: true,
  });
  const records = [];

  for (const relativePath of files) {
    const fullPath = path.join(wikiRoot, relativePath);
    const contentMarkdown = await readFile(fullPath, "utf8");
    const fileStat = await stat(fullPath);
    const frontmatter = parseFrontmatter(contentMarkdown);
    const title = frontmatter.title ?? extractHeading(contentMarkdown) ?? path.basename(relativePath, ".md");
    records.push({
      id: encodeRecordId(relativePath),
      path: toSlash(relativePath),
      slug: path.basename(relativePath, ".md"),
      title,
      contentMarkdown,
      pageType: getPageType(relativePath),
      aliases: frontmatter.aliases,
      links: extractWikiLinks(contentMarkdown),
      backlinks: [],
      updatedAt: fileStat.mtime.toISOString(),
      version,
    });
  }

  const titleToPath = new Map();
  for (const record of records) {
    titleToPath.set(record.title.toLowerCase(), record.path);
    titleToPath.set(record.slug.toLowerCase(), record.path);
    for (const alias of record.aliases) titleToPath.set(alias.toLowerCase(), record.path);
  }

  for (const record of records) {
    for (const link of record.links) {
      const targetPath = titleToPath.get(link.toLowerCase());
      if (!targetPath || targetPath === record.path) continue;
      const target = records.find((candidate) => candidate.path === targetPath);
      if (target && !target.backlinks.includes(record.path)) {
        target.backlinks.push(record.path);
      }
    }
  }

  return records;
}

export async function prepareEntryMedia(entry, markdownDir, entryKey) {
  const mediaFiles = Array.isArray(entry.mediaFiles) ? entry.mediaFiles.map(String).filter(Boolean) : [];
  if (mediaFiles.length === 0) return [];
  const assetDir = path.join(markdownDir, "assets", sanitizeFileName(entryKey));
  await mkdir(assetDir, { recursive: true });
  const out = [];
  for (let index = 0; index < mediaFiles.length; index += 1) {
    const media = mediaFiles[index];
    if (!/^https?:\/\//i.test(media)) {
      out.push(media);
      continue;
    }
    try {
      const response = await fetch(media);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const buffer = Buffer.from(await response.arrayBuffer());
      const fileName = `${String(index + 1).padStart(2, "0")}${extensionFromMedia(media, contentType)}`;
      const target = path.join(assetDir, fileName);
      await writeFile(target, buffer);
      out.push(toSlash(path.relative(markdownDir, target)));
    } catch {
      out.push(media);
    }
  }
  return out;
}

export function sanitizeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "mobile-entry";
}

export function toSlash(value) {
  return value.replace(/\\/g, "/");
}

// fallow-ignore-next-line complexity
function extensionFromMedia(url, contentType) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext && ext.length <= 8) return ext;
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("quicktime")) return ".mov";
  if (contentType.includes("video")) return ".mp4";
  return ".bin";
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { aliases: [] };
  const body = match[1];
  const title = body.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  const aliases = [];
  const inlineAliases = body.match(/^aliases:\s*\[(.*?)\]\s*$/m)?.[1];
  if (inlineAliases) {
    aliases.push(...inlineAliases.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
  }
  const blockAliases = body.match(/^aliases:\s*\r?\n((?:\s+-\s+.+\r?\n?)+)/m)?.[1];
  if (blockAliases) {
    aliases.push(...blockAliases.split(/\r?\n/).map((line) => line.replace(/^\s+-\s+/, "").trim()).filter(Boolean));
  }
  return { title, aliases };
}

function extractHeading(content) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function extractWikiLinks(content) {
  const links = new Set();
  const regex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  for (const match of content.matchAll(regex)) {
    links.add(match[1].trim());
  }
  return [...links];
}

function getPageType(relativePath) {
  const normalized = toSlash(relativePath);
  if (normalized === "index.md") return "index";
  if (normalized === "MOC.md") return "moc";
  if (normalized.startsWith("concepts/")) return "concept";
  if (normalized.startsWith("procedures/")) return "procedure";
  return "other";
}

function encodeRecordId(relativePath) {
  return createHash("sha1").update(toSlash(relativePath)).digest("hex");
}
