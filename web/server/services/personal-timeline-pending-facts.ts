/**
 * Mutates the visible pending-facts table inside the personal timeline page.
 *
 * Source refresh produces candidates from diary and memory headings. This module
 * keeps those candidates readable, clickable, and actionable without treating
 * them as confirmed facts before the user acts on them.
 */

import fs from "node:fs";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { ServerConfig } from "../config.js";
import type { MarkdownHeadingAnchor } from "../render/heading-anchors.js";
import { classifyTimelineFact, readTimelineSourceContext } from "./personal-timeline-classification.js";
import { readSharedTaskTaxonomy, registerSharedTaskTaxonomy } from "./task-taxonomy.js";
import type { TaskTaxonomy } from "./task-taxonomy.js";

const TIMELINE_FILE = path.join("wiki", "个人信息档案", "个人时间线.md");
const PENDING_TIMELINE_HEADING = "## 待确认时间线事实";
const PENDING_TABLE_HEADER = "| 事件时间 | 记录时间 | 候选片段 | 领域 | 项目 | 来源 |";
const PENDING_TABLE_SEPARATOR = "|---|---|---|---|---|---|";
const DAY_TIMELINE_HEADING = "## 按日";

interface PendingSourceSnapshot {
  files: string[];
  headingAnchors: MarkdownHeadingAnchor[];
}

interface MutatePendingTimelineFactInput {
  action: "confirm" | "delete" | "supplement";
  sourceTarget: string;
  note?: string;
}

interface MutatePendingTimelineFactResult {
  status: "written" | "not-found";
  message: string;
}

interface PendingTimelineCandidate {
  target: string;
  row: string;
}

interface PendingTimelineRow {
  eventTime: string;
  recordTime: string;
  content: string;
  domain: string;
  project: string;
  source: string;
}

export async function appendPendingTimelineFacts(
  cfg: ServerConfig,
  label: string,
  snapshot: PendingSourceSnapshot,
): Promise<number> {
  const timelinePath = resolveTimelineWritePath(cfg);
  if (!timelinePath) return 0;
  const markdown = fs.readFileSync(timelinePath, "utf8");
  const candidates = buildPendingTimelineCandidates(cfg, label, snapshot);
  const result = insertPendingTimelineRows(markdown, candidates);
  if (result.addedRows === 0) return 0;
  await writeFile(timelinePath, result.markdown, "utf8");
  return result.addedRows;
}

export async function mutatePendingTimelineFact(
  cfg: ServerConfig,
  input: MutatePendingTimelineFactInput,
): Promise<MutatePendingTimelineFactResult> {
  const timelinePath = resolveTimelineWritePath(cfg);
  if (!timelinePath || !input.sourceTarget.trim()) return pendingFactNotFound();
  const markdown = fs.readFileSync(timelinePath, "utf8");
  const sourceContext = readTimelineSourceContext(cfg, input.sourceTarget);
  const taxonomy = readSharedTaskTaxonomy(cfg.sourceVaultRoot);
  const result = mutatePendingTimelineMarkdown(markdown, input, sourceContext, taxonomy, cfg.sourceVaultRoot);
  if (!result.changed) return pendingFactNotFound();
  await writeFile(timelinePath, result.markdown, "utf8");
  return { status: "written", message: pendingFactActionMessage(input.action) };
}

function resolveTimelineWritePath(cfg: ServerConfig): string | null {
  const sourceTimeline = path.join(cfg.sourceVaultRoot, TIMELINE_FILE);
  if (fs.existsSync(sourceTimeline)) return sourceTimeline;
  const runtimeTimeline = path.join(cfg.runtimeRoot, TIMELINE_FILE);
  return fs.existsSync(runtimeTimeline) ? runtimeTimeline : null;
}

function buildPendingTimelineCandidates(
  cfg: ServerConfig,
  label: string,
  snapshot: PendingSourceSnapshot,
): PendingTimelineCandidate[] {
  const anchors = snapshot.headingAnchors.length > 0
    ? snapshot.headingAnchors
    : snapshot.files.map((file) => ({ file, heading: path.basename(file, path.extname(file)), target: file }));
  const taxonomy = readSharedTaskTaxonomy(cfg.sourceVaultRoot);
  return anchors.filter((anchor) => !isAttachmentHeading(anchor.heading)).map((anchor) => ({
    target: anchor.target,
    row: pendingTimelineRow(cfg, label, anchor, taxonomy),
  }));
}

function pendingTimelineRow(
  cfg: ServerConfig,
  _label: string,
  anchor: MarkdownHeadingAnchor,
  taxonomy: TaskTaxonomy,
): string {
  const recordTime = dateFromSourceFile(anchor.file);
  const contentText = timelineCandidateContent(anchor);
  const classification = classifyTimelineFact(contentText, sourceContextForAnchor(cfg, anchor), taxonomy);
  registerSharedTaskTaxonomy(cfg.sourceVaultRoot, { domain: classification.domain, name: classification.project });
  const content = escapeTableCell(contentText);
  const source = `[[${escapeTableCell(anchor.target)}]]`;
  return `| 待确认 | ${recordTime} | 待整理：${content} | ${classification.domain} | ${classification.project} | ${source} |`;
}

function insertPendingTimelineRows(
  markdown: string,
  candidates: PendingTimelineCandidate[],
): { markdown: string; addedRows: number } {
  const lines = markdown.split(/\r?\n/u);
  const separatorIndex = findPendingTimelineSeparator(lines);
  if (separatorIndex === -1) return { markdown, addedRows: 0 };
  const candidateByTarget = new Map(candidates.map((candidate) => [candidate.target, candidate]));
  const seenTargets = new Set<string>();
  const sectionEnd = findNextMarkdownHeading(lines, separatorIndex + 1);
  const synced = syncPendingTimelineSection(lines.slice(separatorIndex + 1, sectionEnd), candidateByTarget, seenTargets);
  const missing = candidates.filter((candidate) => !seenTargets.has(candidate.target) && !markdown.includes(candidate.target));
  const headerChanged = lines[separatorIndex - 1]?.trim() !== PENDING_TABLE_HEADER;
  if (missing.length + synced.changedRows === 0 && !headerChanged) return { markdown, addedRows: 0 };
  return buildPendingTimelineMarkdown(lines, separatorIndex, sectionEnd, missing, synced);
}

function buildPendingTimelineMarkdown(
  lines: string[],
  separatorIndex: number,
  sectionEnd: number,
  missing: PendingTimelineCandidate[],
  synced: { rows: string[]; changedRows: number },
): { markdown: string; addedRows: number } {
  const nextLines = [
    ...lines.slice(0, Math.max(0, separatorIndex - 1)),
    PENDING_TABLE_HEADER,
    PENDING_TABLE_SEPARATOR,
    ...missing.map((candidate) => candidate.row),
    ...synced.rows,
    ...lines.slice(sectionEnd),
  ];
  return { markdown: `${nextLines.join("\n").replace(/\n*$/u, "")}\n`, addedRows: missing.length + synced.changedRows };
}

function syncPendingTimelineSection(
  lines: string[],
  candidates: Map<string, PendingTimelineCandidate>,
  seenTargets: Set<string>,
): { rows: string[]; changedRows: number } {
  let changedRows = 0;
  const rows: string[] = [];
  for (const line of lines) {
    const candidate = candidateForTimelineRow(line, candidates);
    if (shouldRemovePendingTimelineRow(line)) changedRows += 1;
    else if (candidate) {
      seenTargets.add(candidate.target);
      rows.push(candidate.row);
      changedRows += candidate.row === line ? 0 : 1;
    } else rows.push(line);
  }
  return { rows, changedRows };
}

function mutatePendingTimelineMarkdown(
  markdown: string,
  input: MutatePendingTimelineFactInput,
  sourceContext: string,
  taxonomy: TaskTaxonomy,
  sourceVaultRoot: string,
): { markdown: string; changed: boolean } {
  const lines = markdown.split(/\r?\n/u);
  const separatorIndex = findPendingTimelineSeparator(lines);
  if (separatorIndex === -1) return { markdown, changed: false };
  const sectionEnd = findNextMarkdownHeading(lines, separatorIndex + 1);
  const rowIndex = findPendingRowIndex(lines, separatorIndex + 1, sectionEnd, input.sourceTarget);
  if (rowIndex === -1) return { markdown, changed: false };
  const pending = readPendingTimelineRow(lines[rowIndex]!, input.sourceTarget);
  const nextLines = lines.filter((_, index) => index !== rowIndex);
  if (input.action === "confirm") insertConfirmedDayRow(nextLines, pending, sourceContext, taxonomy, sourceVaultRoot);
  if (input.action === "supplement") nextLines.splice(rowIndex, 0, supplementedPendingRow(pending, input.note ?? "", sourceContext, taxonomy, sourceVaultRoot));
  return { markdown: `${nextLines.join("\n").replace(/\n*$/u, "")}\n`, changed: true };
}

function findPendingRowIndex(lines: string[], start: number, end: number, sourceTarget: string): number {
  return lines.findIndex((line, index) => index >= start && index < end && line.includes(sourceTarget));
}

// fallow-ignore-next-line complexity
function readPendingTimelineRow(line: string, sourceTarget: string): PendingTimelineRow {
  const cells = splitMarkdownTableRow(line);
  const hasCurrentMetadata = cells.length >= 6;
  const hasLegacyImpact = cells.length >= 7;
  return {
    eventTime: cells[0] || "待确认",
    recordTime: cells[1] || "待确认",
    content: cleanPendingContent(cells[2] || "待整理"),
    domain: hasCurrentMetadata ? cells[3] || "日常记录" : "日常记录",
    project: hasCurrentMetadata ? cells[4] || "—" : "—",
    source: hasLegacyImpact ? cells[6] || `[[${sourceTarget}]]` : `[[${sourceTarget}]]`,
  };
}

function findPendingTimelineSeparator(lines: string[]): number {
  const headingIndex = lines.findIndex((line) => line.trim() === PENDING_TIMELINE_HEADING);
  if (headingIndex === -1) return -1;
  return lines.findIndex((line, index) => index > headingIndex && isMarkdownTableSeparator(line));
}

function findNextMarkdownHeading(lines: string[], start: number): number {
  const index = lines.findIndex((line, lineIndex) => lineIndex > start && /^##\s+/u.test(line.trim()));
  return index === -1 ? lines.length : index;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line.trim());
}

function shouldRemovePendingTimelineRow(line: string): boolean {
  return isPendingTimelinePlaceholder(line) || isAttachmentTimelineRow(line);
}

function candidateForTimelineRow(
  line: string,
  candidates: Map<string, PendingTimelineCandidate>,
): PendingTimelineCandidate | undefined {
  for (const [target, candidate] of candidates) {
    if (line.includes(target)) return candidate;
  }
  return undefined;
}

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
}

function cleanPendingContent(value: string): string {
  return value.replace(/^待整理：/u, "").trim();
}

function confirmedFactText(content: string): string {
  const note = supplementNoteFromContent(content);
  const source = note || content;
  return ensureChinesePeriod(polishFactText(source));
}

function supplementNoteFromContent(content: string): string | null {
  const marker = "；补充说明：";
  const index = content.lastIndexOf(marker);
  return index === -1 ? null : content.slice(index + marker.length).trim();
}

function polishFactText(value: string): string {
  const cleaned = value
    .replace(/^这个是/u, "")
    .replace(/^这是/u, "")
    .replace(/^我通过/u, "通过")
    .replace(/这个应用/u, "应用")
    .replace(/^通过(.+?)的第一条日记$/u, "通过$1，记录了第一条日记")
    .trim();
  return normalizeLlmWikiPhrase(cleaned);
}

function normalizeLlmWikiPhrase(value: string): string {
  return value
    .replace(/llm\s*wiki/giu, "LLM Wiki")
    .replace(/搭建LLM Wiki/u, "搭建 LLM Wiki")
    .replace(/LLM Wiki应用/u, "LLM Wiki 应用");
}

function ensureChinesePeriod(value: string): string {
  return /[。！？.!?]$/u.test(value) ? value : `${value}。`;
}

function supplementedPendingRow(
  row: PendingTimelineRow,
  note: string,
  sourceContext: string,
  taxonomy: TaskTaxonomy,
  sourceVaultRoot: string,
): string {
  const noteText = note.trim();
  const content = noteText ? `${row.content}；补充说明：${escapeTableCell(noteText)}` : row.content;
  const next = rowWithClassification({ ...row, content }, sourceContext, taxonomy, sourceVaultRoot);
  return `| ${next.eventTime} | ${next.recordTime} | 待整理：${escapeTableCell(content)} | ${next.domain} | ${next.project} | ${next.source} |`;
}

function insertConfirmedDayRow(
  lines: string[],
  row: PendingTimelineRow,
  sourceContext: string,
  taxonomy: TaskTaxonomy,
  sourceVaultRoot: string,
): void {
  const separatorIndex = findSectionTableSeparator(lines, DAY_TIMELINE_HEADING);
  if (separatorIndex === -1) return;
  const eventTime = row.eventTime === "待确认" ? row.recordTime : row.eventTime;
  lines.splice(separatorIndex + 1, 0, confirmedDayRow({ ...row, eventTime }, sourceContext, taxonomy, sourceVaultRoot));
  removeDayPlaceholder(lines, separatorIndex + 2);
}

function confirmedDayRow(
  row: PendingTimelineRow,
  sourceContext: string,
  taxonomy: TaskTaxonomy,
  sourceVaultRoot: string,
): string {
  const fact = confirmedFactText(row.content);
  const next = rowWithClassification({ ...row, content: fact }, sourceContext, taxonomy, sourceVaultRoot);
  return `| ${next.eventTime} | ${escapeTableCell(fact)} | ${next.domain} | ${next.project} | ${next.source} |`;
}

function rowWithClassification(
  row: PendingTimelineRow,
  sourceContext: string,
  taxonomy: TaskTaxonomy,
  sourceVaultRoot: string,
): PendingTimelineRow {
  const classification = classifyTimelineFact(row.content, sourceContext, taxonomy);
  registerSharedTaskTaxonomy(sourceVaultRoot, { domain: classification.domain, name: classification.project });
  return { ...row, ...classification };
}

function removeDayPlaceholder(lines: string[], start: number): void {
  const index = lines.findIndex((line, lineIndex) => lineIndex >= start && isDayTimelinePlaceholder(line));
  if (index !== -1) lines.splice(index, 1);
}

function findSectionTableSeparator(lines: string[], heading: string): number {
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) return -1;
  return lines.findIndex((line, index) => index > headingIndex && isMarkdownTableSeparator(line));
}

function isPendingTimelinePlaceholder(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  const legacy = cells.length === 6 && cells.slice(0, 5).every((cell) => cell === "待填写") && cells[5] === "待确认";
  const withImpact = cells.length === 7 && cells.every((cell) => cell === "待填写");
  const current = cells.length === 6 && cells.every((cell) => cell === "待填写");
  return legacy || withImpact || current;
}

function isDayTimelinePlaceholder(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return (cells.length === 5 || cells.length === 6) && cells.every((cell) => cell === "待填写");
}

function isAttachmentTimelineRow(line: string): boolean {
  return /\[\[[^\]]*#附件\|附件\]\]/u.test(line);
}

function dateFromSourceFile(file: string): string {
  return /(?:^|\/)(\d{4}-\d{2}-\d{2})\.md$/u.exec(file)?.[1] ?? "待确认";
}

function timelineCandidateContent(anchor: MarkdownHeadingAnchor): string {
  if (isUtilityHeading(anchor.heading) && anchor.preview) return anchor.preview;
  return anchor.heading;
}

function sourceContextForAnchor(cfg: ServerConfig, anchor: MarkdownHeadingAnchor): string {
  const sourceContext = readTimelineSourceContext(cfg, anchor.target);
  return sourceContext || anchor.preview || anchor.heading;
}

function isUtilityHeading(heading: string): boolean {
  return isTimestampHeading(heading) || isAttachmentHeading(heading);
}

function isAttachmentHeading(heading: string): boolean {
  return heading === "附件" || heading.endsWith(" 附件");
}

function isTimestampHeading(heading: string): boolean {
  return /^(\[§\]\([^)]+\)\s*)?\d{1,2}:\d{2}(:\d{2})?$/u.test(heading.trim());
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim();
}

function pendingFactNotFound(): MutatePendingTimelineFactResult {
  return { status: "not-found", message: "没有找到这条候选片段" };
}

function pendingFactActionMessage(action: MutatePendingTimelineFactInput["action"]): string {
  if (action === "confirm") return "已写入时间线事实";
  if (action === "delete") return "已删除候选片段";
  return "已写入补充说明";
}
