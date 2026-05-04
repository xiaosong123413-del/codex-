/**
 * Aggregates review-page items from persisted queues and the latest sync/check run.
 * The summary favors actionable problem lines so failed runs surface real issues first.
 */
import fs from "node:fs";
import path from "node:path";
import type { Severity } from "audit-shared";
import {
  needsDeepResearch,
  readDeepResearchItems,
  type DeepResearchAction,
  type DeepResearchCategory,
  type DeepResearchDraftResult,
  type DeepResearchItem,
  type DeepResearchScope,
  type DeepResearchStatus,
} from "./deep-research.js";
import type { RunSnapshot } from "./run-manager.js";
import { readFlashDiaryFailures } from "./flash-diary.js";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";
import { readPersonalTimelineSourceFailures } from "./personal-timeline-source-refresh.js";
import { readXhsSyncFailures } from "./xhs-sync.js";

type ReviewKind = "deep-research" | "run" | "state" | "inbox" | "flash-diary-failure" | "xhs-sync-failure" | "personal-timeline-source-failure";

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  severity: Severity;
  title: string;
  detail: string;
  createdAt: string;
  target?: string;
  deepResearch?: DeepResearchReviewData;
  stateInfo?: ReviewStateData;
  run?: ReviewRunData;
  webSearchSuggestions?: Array<{ title: string; url: string; snippet: string }>;
}

interface DeepResearchReviewData {
  category: DeepResearchCategory;
  scope: DeepResearchScope;
  pagePath: string;
  line?: number;
  factText?: string;
  gapText: string;
  triggerReason: string;
  sourceExcerpt?: string;
  status: DeepResearchStatus;
  progress: number;
  selectedAction?: DeepResearchAction;
  draftResult?: DeepResearchDraftResult;
  errorMessage?: string;
  chatId?: string;
  updatedAt: string;
}

interface ReviewStateData {
  frozenSlugs: string[];
  suspiciousFrozenSlugs: string[];
}

interface ReviewRunData {
  kind: RunSnapshot["kind"];
  status: RunSnapshot["status"];
  exitCode?: number | null;
}

interface ReviewStateSummary {
  sourceCount: number;
  frozenCount: number;
  latestCompiledAt: string | null;
  frozenSlugs: string[];
  suspiciousFrozenSlugs: string[];
}

export interface ReviewSummary {
  items: ReviewItem[];
  state: ReviewStateSummary | null;
}

interface ReviewContext {
  sourceVaultRoot: string;
  runtimeRoot: string;
  projectRoot: string;
  currentRun?: RunSnapshot | null;
}

export function aggregateReviewItems(context: ReviewContext): ReviewSummary {
  const items = [
    ...loadDeepResearchReviewItems(context.runtimeRoot, context.currentRun ?? null),
    ...loadRunItems(context.currentRun ?? null),
    ...loadInboxItems(context.sourceVaultRoot),
    ...loadFlashDiaryFailureItems(context.runtimeRoot),
    ...loadPersonalTimelineSourceFailureItems(context.runtimeRoot),
    ...loadXhsSyncFailureItems(context.runtimeRoot),
  ];
  const state = loadStateSummary(context.runtimeRoot);

  if (state && state.frozenCount > 0) {
    items.push({
      id: "state-frozen-slugs",
      kind: "state",
      severity: "warn",
      title: "\u5b58\u5728\u51bb\u7ed3\u9875\u9762",
      detail: buildFrozenSlugDetail(state),
      createdAt: state.latestCompiledAt ?? new Date(0).toISOString(),
      stateInfo: {
        frozenSlugs: state.frozenSlugs,
        suspiciousFrozenSlugs: state.suspiciousFrozenSlugs,
      },
    });
  }

  const deduped = new Map<string, ReviewItem>();
  for (const item of items) {
    deduped.set(item.id, item);
  }
  return {
    items: [...deduped.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    state,
  };
}

function loadDeepResearchReviewItems(wikiRoot: string, run: RunSnapshot | null): ReviewItem[] {
  void run;
  return readDeepResearchItems(wikiRoot)
    .filter((item) => item.status !== "completed" && item.status !== "ignored")
    .map(mapDeepResearchItemToReviewItem);
}

export function mapDeepResearchItemToReviewItem(item: DeepResearchItem): ReviewItem {
  return {
    id: item.id,
    kind: "deep-research",
    severity: item.status === "failed" ? "error" : "warn",
    title: item.title,
    detail: item.detail,
    createdAt: item.createdAt,
    target: item.pagePath,
    deepResearch: {
      category: item.category,
      scope: item.scope,
      pagePath: item.pagePath,
      line: item.line,
      factText: item.factText,
      gapText: item.gapText,
      triggerReason: item.triggerReason,
      sourceExcerpt: item.sourceExcerpt,
      status: item.status,
      progress: item.progress,
      selectedAction: item.selectedAction,
      draftResult: item.draftResult,
      errorMessage: item.errorMessage,
      chatId: item.chatId,
      updatedAt: item.updatedAt,
    },
  };
}

function loadXhsSyncFailureItems(wikiRoot: string): ReviewItem[] {
  return readXhsSyncFailures(wikiRoot)
    .map((item) => ({
      id: item.id,
      kind: "xhs-sync-failure" as const,
      severity: "error" as const,
      title: "小红书同步失败",
      detail: `${item.url ?? item.keyword ?? item.command}\n\n错误：${item.error}`,
      createdAt: item.createdAt,
      target: "raw/剪藏/小红书",
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function loadPersonalTimelineSourceFailureItems(wikiRoot: string): ReviewItem[] {
  return readPersonalTimelineSourceFailures(wikiRoot)
    .map((item) => ({
      id: item.id,
      kind: "personal-timeline-source-failure" as const,
      severity: "error" as const,
      title: "个人时间线来源刷新失败",
      detail: `${item.label}\n${item.entries.join("\n")}\n\n错误：${item.error}`,
      createdAt: item.createdAt,
      target: "wiki/个人信息档案/个人时间线.md",
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function loadInboxItems(wikiRoot: string): ReviewItem[] {
  const inboxDir = path.join(wikiRoot, "inbox");
  if (!fs.existsSync(inboxDir)) return [];
  return listMarkdownFilesRecursive(inboxDir, { relative: true, excludeDirs: ["_已录入"] })
    .map((file) => inboxToReviewItem(wikiRoot, inboxDir, file))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function loadFlashDiaryFailureItems(wikiRoot: string): ReviewItem[] {
  return readFlashDiaryFailures(wikiRoot)
    .map((item) => ({
      id: item.id,
      kind: "flash-diary-failure" as const,
      severity: "error" as const,
      title: "\u95ea\u5ff5\u65e5\u8bb0\u63d0\u4ea4\u5931\u8d25",
      detail: `${item.text}\n\n\u9519\u8bef\uff1a${item.error}`,
      createdAt: item.createdAt,
      target: `raw/\u95ea\u5ff5\u65e5\u8bb0/${item.targetDate}.md`,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function inboxToReviewItem(wikiRoot: string, inboxDir: string, file: string): ReviewItem {
  const fullPath = path.join(inboxDir, file);
  const content = fs.readFileSync(fullPath, "utf8");
  const stat = fs.statSync(fullPath);
  const title = extractTitle(content, path.basename(file, path.extname(file)));
  return {
    id: `inbox-${file.replace(/[\\/]/g, "-")}`,
    kind: "inbox",
    severity: "suggest",
    title,
    detail: "\u8fd9\u6761\u539f\u6599\u4ecd\u5728 inbox\uff0c\u9700\u8981\u9009\u62e9\u4eb2\u81ea\u6307\u5bfc\u5f55\u5165\u6216\u4f18\u5148\u6279\u91cf\u5f55\u5165\u3002",
    createdAt: stat.mtime.toISOString(),
    target: path.relative(wikiRoot, fullPath).replace(/\\/g, "/"),
  };
}

function extractTitle(content: string, fallback: string): string {
  const frontmatterTitle = content.match(/^---[\s\S]*?\ntitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/i)?.[1];
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return (frontmatterTitle ?? heading ?? fallback).replace(/^["']|["']$/g, "").trim();
}

function loadRunItems(run: RunSnapshot | null): ReviewItem[] {
  if (!run || run.status === "running") return [];
  return run.status === "succeeded" ? loadSuccessfulRunItems(run) : loadFailedRunItems(run);
}

function loadFailedRunItems(run: RunSnapshot): ReviewItem[] {
  const detail = summarizeFailedRunDetail(run);
  if (!detail) return [];
  return [
    {
      id: `run-${run.id}`,
      kind: "run",
      severity: "error",
      title: run.kind === "sync" ? "\u540c\u6b65\u7f16\u8bd1\u5931\u8d25" : "\u7cfb\u7edf\u68c0\u67e5\u5931\u8d25",
      detail,
      createdAt: run.endedAt ?? run.startedAt,
      run: toReviewRunData(run),
    },
  ];
}

function loadSuccessfulRunItems(run: RunSnapshot): ReviewItem[] {
  const problemLines = collectProblemLines(run);
  if (problemLines.length === 0) return [];
  return [
    {
      id: `run-${run.id}-issues`,
      kind: "run",
      severity: problemLines.some(isErrorLine) ? "error" : "warn",
      title: run.kind === "sync" ? "\u540c\u6b65\u7f16\u8bd1\u5b58\u5728\u5f85\u786e\u8ba4\u95ee\u9898" : "\u7cfb\u7edf\u68c0\u67e5\u53d1\u73b0\u5f85\u5904\u7406\u4e8b\u9879",
      detail: problemLines.slice(0, 12).join("\n"),
      createdAt: run.endedAt ?? run.startedAt,
      run: toReviewRunData(run),
    },
  ];
}

function toReviewRunData(run: RunSnapshot): ReviewRunData {
  return {
    kind: run.kind,
    status: run.status,
    exitCode: run.exitCode,
  };
}

function summarizeFailedRunDetail(run: RunSnapshot): string {
  const problemLines = collectProblemLines(run);
  if (problemLines.length > 0) {
    return prioritizeFailedRunProblemLines(problemLines).slice(0, 12).join("\n");
  }
  return run.lines
    .slice(-8)
    .map((line) => line.text.trim())
    .filter(Boolean)
    .filter((line) => !needsDeepResearch(line))
    .filter((line) => !isIgnorableRunNoiseLine(line))
    .filter((line) => !isGenericFailedRunTailLine(line))
    .join("\n")
    .trim();
}

function prioritizeFailedRunProblemLines(problemLines: string[]): string[] {
  const countLine = problemLines.find(isIssueCountLine);
  const primaryLines = problemLines.filter((line) => !isIssueCountLine(line));
  return countLine ? [...primaryLines.slice(0, 11), countLine] : primaryLines;
}

function collectProblemLines(run: RunSnapshot): string[] {
  return run.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .filter((line) => !needsDeepResearch(line))
    .filter((line) => !isIgnorableRunNoiseLine(line))
    .filter((line) => isWarningLine(line) || isErrorLine(line));
}

function isWarningLine(line: string): boolean {
  return /\b(warn|warning|warnings)\b/i.test(line) || /\b[1-9]\d*\s+warning\(s\)/i.test(line);
}

function isErrorLine(line: string): boolean {
  return /\b(error|errors|failed|failure|exception)\b/i.test(line) || /\b[1-9]\d*\s+error\(s\)/i.test(line);
}

function isIssueCountLine(line: string): boolean {
  return /^\*\s+\d+\s+error\(s\),\s+\d+\s+warning\(s\),\s+\d+\s+info$/iu.test(line);
}

function isIgnorableRunNoiseLine(line: string): boolean {
  return /^\(node:\d+\)\s+\[DEP\d+\]\s+DeprecationWarning:/u.test(line)
    || line.includes("node --trace-deprecation");
}

function isGenericFailedRunTailLine(line: string): boolean {
  return line === "需要你确认后再继续：" || /^process exited with code /iu.test(line);
}

function loadStateSummary(root: string): ReviewStateSummary | null {
  const statePath = path.join(root, ".llmwiki", "state.json");
  if (!fs.existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      sources?: Record<string, { compiledAt?: string }>;
      frozenSlugs?: unknown[];
    };
    const sources = parsed.sources ?? {};
    const frozenSlugs = Array.isArray(parsed.frozenSlugs)
      ? parsed.frozenSlugs.filter((value): value is string => typeof value === "string").map((value) => value.trim())
      : [];
    const compiled = Object.values(sources)
      .map((source) => source.compiledAt)
      .filter((value): value is string => typeof value === "string")
      .sort();
    return {
      sourceCount: Object.keys(sources).length,
      frozenCount: frozenSlugs.length,
      latestCompiledAt: compiled.at(-1) ?? null,
      frozenSlugs,
      suspiciousFrozenSlugs: frozenSlugs.filter(isSuspiciousFrozenSlug),
    };
  } catch {
    return null;
  }
}

function buildFrozenSlugDetail(state: ReviewStateSummary): string {
  const frozenSummary = state.frozenSlugs.map(formatFrozenSlug).join("、");
  const suspiciousSummary = state.suspiciousFrozenSlugs.length > 0
    ? ` 异常项：${state.suspiciousFrozenSlugs.map(formatFrozenSlug).join("、")}。`
    : "";
  return `当前有 ${state.frozenCount} 个 frozen slug：${frozenSummary}。需要确认这些冻结页面是否仍有有效来源。${suspiciousSummary}`.trim();
}

function formatFrozenSlug(value: string): string {
  return value.trim() ? value : "空 slug";
}

function isSuspiciousFrozenSlug(value: string): boolean {
  const normalized = value.trim();
  return normalized.length === 0 || /^[a-z0-9]{1,2}$/i.test(normalized);
}
