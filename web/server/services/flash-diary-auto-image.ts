/**
 * Daily generated-image insertion for flash diary markdown.
 *
 * At the scheduled time, this service looks only at today's diary file. If the
 * file has written content and no image reference yet, it writes a generated PNG
 * under the day's asset folder and inserts a markdown image near the top of the
 * diary so the visual editor renders it inline.
 */

import fs from "node:fs";
import path from "node:path";
import { renderContentImagePng, type ContentImageContext } from "../../../src/utils/content-image.js";

interface FlashDiaryAutoImageResult {
  path: string;
  generated: boolean;
  imagePath: string | null;
  skippedReason: "missing-diary" | "empty-diary" | "already-has-image" | null;
}

interface GenerateFlashDiaryAutoImageOptions {
  now?: Date;
  generator?: (context: ContentImageContext) => Buffer | Promise<Buffer>;
}

const DIARY_ROOT = "raw/闪念日记";
const MARKDOWN_IMAGE_RE = /!\[[^\]\n]*\]\([^)]+\)/u;
const HTML_IMAGE_RE = /<img\b[^>]*>/iu;

export async function generateTodayFlashDiaryImage(
  sourceVaultRoot: string,
  options: GenerateFlashDiaryAutoImageOptions = {},
): Promise<FlashDiaryAutoImageResult> {
  const now = options.now ?? new Date();
  const date = formatDate(now);
  const diaryPath = `${DIARY_ROOT}/${date}.md`;
  const fullDiaryPath = path.join(sourceVaultRoot, ...diaryPath.split("/"));
  if (!fs.existsSync(fullDiaryPath)) {
    return skipped(diaryPath, "missing-diary");
  }

  const raw = fs.readFileSync(fullDiaryPath, "utf-8");
  if (hasAnyImage(raw)) {
    return skipped(diaryPath, "already-has-image");
  }
  const context = buildDiaryImageContext(diaryPath, date, raw);
  if (!context) {
    return skipped(diaryPath, "empty-diary");
  }

  const imagePath = `${DIARY_ROOT}/assets/${date}/daily-summary.png`;
  const image = await (options.generator ?? renderContentImagePng)(context);
  fs.mkdirSync(path.dirname(path.join(sourceVaultRoot, ...imagePath.split("/"))), { recursive: true });
  fs.writeFileSync(path.join(sourceVaultRoot, ...imagePath.split("/")), image);
  fs.writeFileSync(fullDiaryPath, ensureTrailingNewline(insertImageAfterTitle(raw, date)), "utf-8");
  return { path: diaryPath, generated: true, imagePath, skippedReason: null };
}

function buildDiaryImageContext(
  diaryPath: string,
  date: string,
  raw: string,
): ContentImageContext | null {
  const summary = cleanDiaryText(raw);
  if (!summary) {
    return null;
  }
  return {
    logicalPath: diaryPath,
    title: `${date} 闪念日记`,
    summary: summary.slice(0, 180),
    keywords: extractDiaryKeywords(raw),
    label: "FLASH DIARY",
  };
}

function insertImageAfterTitle(raw: string, date: string): string {
  const imageMarkdown = `![每日自动配图](./assets/${date}/daily-summary.png)`;
  const heading = /^# .+\r?\n\r?\n/u.exec(raw);
  if (!heading) {
    return `${imageMarkdown}\n\n${raw.trimStart()}`;
  }
  return `${heading[0]}${imageMarkdown}\n\n${raw.slice(heading[0].length).trimStart()}`;
}

function hasAnyImage(raw: string): boolean {
  return MARKDOWN_IMAGE_RE.test(raw) || HTML_IMAGE_RE.test(raw);
}

function cleanDiaryText(raw: string): string {
  return raw
    .replace(MARKDOWN_IMAGE_RE, " ")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/^# .+$/gmu, " ")
    .replace(/^##\s+\d{2}:\d{2}(?::\d{2})?.*$/gmu, " ")
    .replace(/[#>*_`~-]+/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function extractDiaryKeywords(raw: string): string[] {
  const headings = Array.from(raw.matchAll(/^#{2,4}\s+(.+?)\s*$/gmu), (match) => match[1] ?? "")
    .filter((heading) => !/^\d{2}:\d{2}/u.test(heading));
  const fallback = ["今日记录", "状态总结", "自动配图"];
  return uniqueCleanValues(headings).slice(0, 4).concat(fallback).slice(0, 4);
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

function skipped(
  diaryPath: string,
  reason: FlashDiaryAutoImageResult["skippedReason"],
): FlashDiaryAutoImageResult {
  return { path: diaryPath, generated: false, imagePath: null, skippedReason: reason };
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
