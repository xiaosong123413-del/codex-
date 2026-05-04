/**
 * Local file ingestion module.
 * Reads .md and .txt files from the local filesystem and returns their
 * content as markdown. Markdown files are returned as-is; plain text files
 * are wrapped in a markdown code block. DOCX/PPTX/PDF files are represented
 * by a lightweight markdown stub plus extracted embedded images.
 */

import { readFile } from "fs/promises";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "path";
import { SOURCES_DIR } from "../utils/constants.js";
import { slugify } from "../utils/markdown.js";
import { extractDocumentImages } from "./document-images.js";
import { extractDocumentMarkdown } from "./document-text.js";

const DOCUMENT_EXTENSIONS = new Set([".docx", ".pptx", ".pdf", ".xlsx", ".xls", ".ods"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const SUPPORTED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
]);

interface FileIngestResult {
  title: string;
  content: string;
}

/** Derive a human-readable title from a filename (without extension). */
function titleFromFilename(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  return basename.replace(/[-_]+/g, " ").trim();
}

/** Wrap plain text content in a markdown fenced block. */
function wrapPlainText(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

/**
 * Ingest a local file and return its content as markdown.
 * @param filePath - Absolute or relative path to a .md or .txt file.
 * @returns An object with a title derived from the filename and the markdown content.
 * @throws On unsupported file type or read failure.
 */
export default async function ingestFile(filePath: string): Promise<FileIngestResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file type "${ext}". Supported types: markdown, text, PDF, Office documents, images, audio, and video.`
    );
  }

  const title = titleFromFilename(filePath);
  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return {
      title,
      content: await readOrBuildCache(filePath, () => ingestStructuredDocument(filePath, title, ext)),
    };
  }
  if (isMediaExtension(ext)) {
    return {
      title,
      content: await ingestMediaFile(filePath, title, ext),
    };
  }
  const raw = await readFile(filePath, "utf-8");
  const content = ext === ".md" ? raw : wrapPlainText(raw);

  return { title, content };
}

async function ingestStructuredDocument(filePath: string, title: string, ext: string): Promise<string> {
  const slug = slugify(title);
  const relDir = path.posix.join("media", slug);
  const outputDir = path.join(SOURCES_DIR, ...relDir.split("/"));
  const images = await extractDocumentImages(filePath, outputDir, relDir);
  const documentText = await extractDocumentMarkdown(filePath);
  const lines = [
    `# ${title}`,
    "",
    `Imported local ${ext.slice(1).toUpperCase()} document: \`${path.basename(filePath)}\`.`,
  ];
  if (documentText.trim()) {
    lines.push("", "## Extracted Text", "", documentText.trim());
  }
  if (images.length === 0) {
    return lines.join("\n");
  }
  lines.push("", "## Embedded Images", "");
  for (const image of images) {
    const size = image.width && image.height ? ` ${image.width}x${image.height}` : "";
    lines.push(`![](./${image.relPath})`, "");
    lines.push(`<!-- image: ${image.mimeType}${size}; sha256: ${image.sha256} -->`, "");
  }
  return lines.join("\n").trimEnd();
}

async function ingestMediaFile(filePath: string, title: string, ext: string): Promise<string> {
  const slug = slugify(title);
  const relDir = path.posix.join("media", slug);
  const outputDir = path.join(SOURCES_DIR, ...relDir.split("/"));
  await mkdir(outputDir, { recursive: true });
  const fileName = path.basename(filePath);
  const relPath = path.posix.join(relDir, fileName);
  await copyFile(filePath, path.join(outputDir, fileName));
  return mediaMarkdown(title, ext, relPath);
}

function mediaMarkdown(title: string, ext: string, relPath: string): string {
  const source = `./${relPath}`;
  if (IMAGE_EXTENSIONS.has(ext)) return `# ${title}\n\n![](${source})`;
  if (VIDEO_EXTENSIONS.has(ext)) return `# ${title}\n\n<video controls src="${source}"></video>`;
  return `# ${title}\n\n<audio controls src="${source}"></audio>`;
}

function isMediaExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext);
}

async function readOrBuildCache(filePath: string, build: () => Promise<string>): Promise<string> {
  const cachePath = documentCachePath(filePath);
  if (await isCacheFresh(filePath, cachePath)) {
    return readFile(cachePath, "utf-8");
  }
  const content = await build();
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, content, "utf-8");
  return content;
}

function documentCachePath(filePath: string): string {
  return path.join(path.dirname(filePath), ".cache", `${path.basename(filePath)}.txt`);
}

async function isCacheFresh(filePath: string, cachePath: string): Promise<boolean> {
  try {
    const [sourceInfo, cacheInfo] = await Promise.all([stat(filePath), stat(cachePath)]);
    return cacheInfo.mtimeMs >= sourceInfo.mtimeMs;
  } catch {
    return false;
  }
}
