import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { listMarkdownFilesRecursive } from "./sync-compile/file-listing.mjs";

const vaultRoot = process.argv[2];
if (!vaultRoot) {
  console.error("Usage: node scripts/translate-existing-wiki.mjs <vault-root>");
  process.exit(1);
}

dotenv.config({ path: path.join(vaultRoot, ".env") });

const wikiRoot = path.join(vaultRoot, "wiki");
const conceptsRoot = path.join(wikiRoot, "concepts");
const backupRoot = path.join(
  vaultRoot,
  `wiki_backup_before_chinese_${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is missing in the target vault .env file.");
  process.exit(1);
}

const client = new Anthropic({
  apiKey,
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});
const model = process.env.LLMWIKI_MODEL || "claude-3-7-sonnet-20250219";

// fallow-ignore-next-line complexity
function stripResponseFence(text) {
  return text
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// fallow-ignore-next-line complexity
function extractWikilinks(text) {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[0]);
}

// fallow-ignore-next-line complexity
function hasSameWikilinks(before, after) {
  const original = extractWikilinks(before);
  const translated = extractWikilinks(after);
  if (original.length !== translated.length) return false;
  return original.every((link, index) => translated[index] === link);
}

// fallow-ignore-next-line complexity
function hasFrontmatter(text) {
  return text.startsWith("---\n") && text.indexOf("\n---", 4) !== -1;
}

// fallow-ignore-next-line complexity
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fallow-ignore-next-line complexity
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

// fallow-ignore-next-line complexity
async function translateFile(filePath) {
  const original = await readFile(filePath, "utf8");
  const relative = path.relative(wikiRoot, filePath).replace(/\\/g, "/");

  if (!/## Sources?\b/.test(original) && original.includes("## \u6765\u6e90")) {
    console.log(`SKIP ${relative}: already Chinese`);
    return "already";
  }

  const system = [
    "You are a careful Obsidian Markdown wiki translator.",
    "Goal: translate the page content into natural Simplified Chinese without breaking Markdown, YAML frontmatter, wikilinks, citations, or file paths.",
    "Hard rules:",
    "1. Return only the full file content. Do not explain. Do not wrap the answer in a code block.",
    "2. Preserve YAML frontmatter delimiters and field keys.",
    "3. Do not modify frontmatter title, sources, createdAt, updatedAt, or aliases.",
    "4. You may translate frontmatter summary and tags into Chinese.",
    "5. Translate prose, headings, explanatory paragraphs, and ordinary list text into Chinese.",
    "6. Do not modify any text inside [[...]] wikilinks. Preserve every wikilink byte-for-byte.",
    "7. Do not modify ^[...] citation markers, filenames, code blocks, or URLs.",
    "8. Translate ## Sources or ## Source to ## \u6765\u6e90.",
    "9. Preserve original paragraph structure, lists, heading levels, blank lines, and Markdown formatting.",
  ].join("\n");

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await withTimeout(
        client.messages.create({
          model,
          max_tokens: 8192,
          system,
          messages: [
            {
              role: "user",
              content: `Translate this wiki page into Chinese. File path: ${relative}\n\n${original}`,
            },
          ],
        }),
        120000,
        relative,
      );

      const block = response.content.find((item) => item.type === "text");
      const translated = stripResponseFence(block?.type === "text" ? block.text : "");
      if (!translated) continue;
      if (hasFrontmatter(original) && !hasFrontmatter(translated)) continue;
      if (!hasSameWikilinks(original, translated)) continue;

      await writeFile(filePath, `${translated}\n`, "utf8");
      console.log(`OK ${relative}`);
      return "translated";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`RETRY ${relative} attempt ${attempt}: ${message}`);
      await sleep(2000 * attempt);
    }
  }

  console.warn(`SKIP ${relative}: validation failed`);
  return "skipped";
}

// fallow-ignore-next-line complexity
async function main() {
  if (!existsSync(wikiRoot)) {
    console.error(`Wiki directory does not exist: ${wikiRoot}`);
    process.exit(1);
  }

  await mkdir(backupRoot, { recursive: true });
  await cp(wikiRoot, backupRoot, { recursive: true });
  console.log(`Backup: ${backupRoot}`);

  const files = (await listMarkdownFilesRecursive(conceptsRoot, { ignoreMissing: true }))
    .map((relativePath) => path.join(conceptsRoot, relativePath))
    .filter((file) => path.basename(file) !== ".md")
    .sort();

  let translated = 0;
  let already = 0;
  let skipped = 0;
  for (const file of files) {
    const status = await translateFile(file);
    if (status === "translated") translated += 1;
    else if (status === "already") already += 1;
    else skipped += 1;
  }

  console.log(`Translated: ${translated}`);
  console.log(`Already Chinese: ${already}`);
  console.log(`Skipped: ${skipped}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
