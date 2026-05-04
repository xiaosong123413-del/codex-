import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { calculateConfidence } from "../../../src/compiler/claims.js";
import type { RunKind, RunSnapshot } from "./run-manager.js";

const DEEP_RESEARCH_FILE = "deep-research-items.json";
const GENERIC_DEEP_RESEARCH_PATTERNS = [
  /^-?\s*需要网络搜索补证的数据空白$/u,
  /^-?\s*新问题\/新来源建议$/u,
  /^-?\s*引用缺失$/u,
  /^-?\s*新来源已取代的过时表述$/u,
  /^-?\s*需要外部补证[:：].+$/u,
  /^原因[:：]联网搜索会引入新来源和外部信息，需要你确认是否值得补证。?$/u,
  /^需要你确认[:：]是否进一步网络搜索补证？?$/u,
  /^原因[:：]这会改变后续调查范围和收录边界，需要你确认是否接受。?$/u,
  /^需要你确认[:：]是否接受新问题、新来源建议？?$/u,
];

const BACKGROUND_STEP_DELAYS_MS = [15, 20, 20, 15];
const MIN_CONFIRMED_DEEP_RESEARCH_CONFIDENCE = 0.61;
const backgroundTasks = new Map<string, Promise<void>>();

export type DeepResearchCategory =
  | "outdated-source"
  | "missing-citation"
  | "needs-deep-research"
  | "suggestion";

export type DeepResearchScope = "claim" | "page";
export type DeepResearchStatus = "pending" | "running" | "done-await-confirm" | "failed" | "ignored" | "completed";
export type DeepResearchAction = "start-rewrite" | "add-citation" | "deep-research" | "accept-suggestion" | "ignore";

export interface DeepResearchDraftResult {
  mode: "append" | "rewrite-citations";
  pagePath: string;
  summary: string;
  preview: string;
  content: string;
  citationTarget?: string;
  replacementCitation?: string;
}

export interface DeepResearchItem {
  id: string;
  kind: RunKind;
  title: string;
  detail: string;
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
  createdAt: string;
  updatedAt: string;
}

interface DeepResearchBulkAdvanceResult {
  started: number;
  confirmed: number;
  skipped: number;
}

interface DeepResearchBulkConfirmResult {
  confirmed: number;
  failed: number;
  skipped: number;
}

interface ParsedDeepResearchDiagnostic {
  category: DeepResearchCategory;
  scope: DeepResearchScope;
  pagePath: string;
  line?: number;
  factText?: string;
  gapText: string;
  triggerReason: string;
  sourceExcerpt: string;
}

interface CitationSourceIndex {
  fileNames: Set<string>;
  hashes: Map<string, string[]>;
}

interface ClaimLifecycleRecord {
  id: string;
  conceptSlug: string;
  claimText: string;
  lastConfirmedAt: string;
  lastAccessedAt?: string;
  retention: number;
  status: "active" | "contested" | "superseded" | "stale";
}

export function needsDeepResearch(text: string): boolean {
  return text
    .split(/\r?\n/u)
    .map(normalizeLine)
    .some((line) => Boolean(parseDeepResearchDiagnostic(line)) || GENERIC_DEEP_RESEARCH_PATTERNS.some((pattern) => pattern.test(line)));
}

function deriveDeepResearchItems(run: RunSnapshot | null, wikiRoot?: string): DeepResearchItem[] {
  if (!run) {
    return [];
  }
  const createdAt = run.endedAt ?? run.startedAt;
  const diagnostics = run.lines
    .map((line) => parseDeepResearchDiagnostic(line.text, wikiRoot))
    .filter((item): item is ParsedDeepResearchDiagnostic => Boolean(item));

  const deduped = new Map<string, DeepResearchItem>();
  for (const diagnostic of diagnostics) {
    const item = deepResearchItemFromDiagnostic(run.kind, diagnostic, createdAt);
    deduped.set(item.id, item);
  }
  return [...deduped.values()];
}

export function readDeepResearchItems(wikiRoot: string): DeepResearchItem[] {
  const filePath = resolveDeepResearchPath(wikiRoot);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeDeepResearchItem(item, wikiRoot)).filter((item): item is DeepResearchItem => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

export async function reconcileDeepResearchItems(wikiRoot: string, run: RunSnapshot): Promise<DeepResearchItem[]> {
  const currentItems = readDeepResearchItems(wikiRoot);
  const nextItems = [
    ...currentItems.filter((item) => item.kind !== run.kind),
    ...deriveDeepResearchItems(run, wikiRoot),
  ];
  writeDeepResearchItems(wikiRoot, nextItems);
  return sortDeepResearchItems(nextItems);
}

export function getDeepResearchItem(wikiRoot: string, id: string): DeepResearchItem | null {
  return readDeepResearchItems(wikiRoot).find((item) => item.id === id) ?? null;
}

export function resumeRunningDeepResearchItems(runtimeRoot: string, sourceVaultRoot: string): number {
  const items = readDeepResearchItems(runtimeRoot);
  let resumed = 0;
  let hasRunningCitationBatch = false;
  for (const item of items) {
    if (item.status !== "running") {
      continue;
    }
    resumed += 1;
    if (item.category === "missing-citation") {
      hasRunningCitationBatch = true;
      continue;
    }
    enqueueDeepResearchTask(runtimeRoot, sourceVaultRoot, item.id);
  }
  if (hasRunningCitationBatch) {
    enqueueMissingCitationBatch(runtimeRoot, sourceVaultRoot);
  }
  return resumed;
}

export async function startDeepResearchAction(
  runtimeRoot: string,
  sourceVaultRoot: string,
  id: string,
  action: DeepResearchAction,
): Promise<DeepResearchItem> {
  if (action === "ignore") {
    const ignored = mutateDeepResearchItem(runtimeRoot, id, (item) => ({
      ...item,
      status: "ignored",
      progress: 0,
      selectedAction: action,
      errorMessage: undefined,
      draftResult: undefined,
      updatedAt: nowIso(),
    }));
    if (!ignored) {
      throw new Error("deep research item not found");
    }
    return ignored;
  }

  const started = mutateDeepResearchItem(runtimeRoot, id, (item) => {
    assertActionMatchesCategory(item.category, action);
    return {
      ...item,
      status: "running",
      progress: 10,
      selectedAction: action,
      errorMessage: undefined,
      draftResult: undefined,
      updatedAt: nowIso(),
    };
  });
  if (!started) {
    throw new Error("deep research item not found");
  }

  if (started.category === "missing-citation") {
    enqueueMissingCitationBatch(runtimeRoot, sourceVaultRoot);
  } else {
    enqueueDeepResearchTask(runtimeRoot, sourceVaultRoot, id);
  }
  return started;
}

export async function confirmDeepResearchWrite(runtimeRoot: string, sourceVaultRoot: string, id: string): Promise<DeepResearchItem> {
  const item = getDeepResearchItem(runtimeRoot, id);
  if (!item) {
    throw new Error("deep research item not found");
  }
  if (item.status !== "done-await-confirm" || !item.draftResult) {
    throw new Error("deep research item is not ready for confirmation");
  }
  applyDeepResearchDraftToTarget(runtimeRoot, sourceVaultRoot, item);
  refreshConfirmedDeepResearchClaimLifecycle(runtimeRoot, sourceVaultRoot, item);

  const completedItem: DeepResearchItem = {
    ...item,
    status: "completed",
    progress: 100,
    updatedAt: nowIso(),
  };
  if (!(item.category === "missing-citation" && item.draftResult.mode === "rewrite-citations")) {
    const completed = mutateDeepResearchItem(runtimeRoot, id, (current) => ({
      ...current,
      status: "completed",
      progress: 100,
      updatedAt: completedItem.updatedAt,
    }));
    if (!completed) {
      throw new Error("deep research item not found");
    }
  }
  return completedItem;
}

export function backfillLegacyOutdatedSourceRepairs(runtimeRoot: string, sourceVaultRoot: string): number {
  const items = readDeepResearchItems(runtimeRoot);
  let repaired = 0;
  const updatedAt = nowIso();
  const nextItems = items.map((item) => {
    if (!shouldBackfillLegacyOutdatedSourceItem(item, sourceVaultRoot)) {
      return item;
    }
    const refreshed = refreshOutdatedSourceClaimLifecycle(runtimeRoot, sourceVaultRoot, item);
    if (!refreshed) {
      return item;
    }
    repaired += 1;
    return {
      ...item,
      status: "completed",
      progress: 100,
      updatedAt,
    };
  });
  if (repaired > 0) {
    writeDeepResearchItems(runtimeRoot, nextItems);
  }
  return repaired;
}

export function backfillLegacyNeedsDeepResearchRepairs(runtimeRoot: string, sourceVaultRoot: string): number {
  const items = readDeepResearchItems(runtimeRoot);
  let repaired = 0;
  const updatedAt = nowIso();
  const nextItems = items.map((item) => {
    if (!shouldBackfillLegacyNeedsDeepResearchItem(item, sourceVaultRoot)) {
      return item;
    }
    const refreshed = refreshNeedsDeepResearchClaimLifecycle(runtimeRoot, sourceVaultRoot, item);
    if (!refreshed) {
      return item;
    }
    repaired += 1;
    return {
      ...item,
      status: "completed",
      progress: 100,
      updatedAt,
    };
  });
  if (repaired > 0) {
    writeDeepResearchItems(runtimeRoot, nextItems);
  }
  return repaired;
}

export function setDeepResearchChatId(wikiRoot: string, id: string, chatId: string): DeepResearchItem | null {
  return mutateDeepResearchItem(wikiRoot, id, (item) => ({
    ...item,
    chatId,
    updatedAt: nowIso(),
  }));
}

export async function bulkAdvanceDeepResearchItems(
  runtimeRoot: string,
  sourceVaultRoot: string,
): Promise<DeepResearchBulkAdvanceResult> {
  const items = readDeepResearchItems(runtimeRoot);
  let started = 0;
  let confirmed = 0;
  let skipped = 0;
  const startedIds: string[] = [];
  let hasPendingCitationBatch = false;
  let nextItems = items;

  for (const item of items) {
    if (item.status !== "pending") {
      skipped += 1;
    }
  }

  if (items.some((item) => item.status === "pending")) {
    nextItems = items.map((item) => {
      if (item.status !== "pending") {
        return item;
      }
      started += 1;
      if (item.category === "missing-citation") {
        hasPendingCitationBatch = true;
      } else {
        startedIds.push(item.id);
      }
      return {
        ...item,
        status: "running",
        progress: 10,
        selectedAction: primaryActionForCategory(item.category),
        errorMessage: undefined,
        draftResult: undefined,
        updatedAt: nowIso(),
      };
    });
    writeDeepResearchItems(runtimeRoot, nextItems);
  }

  for (const id of startedIds) {
    enqueueDeepResearchTask(runtimeRoot, sourceVaultRoot, id);
  }
  if (hasPendingCitationBatch) {
    enqueueMissingCitationBatch(runtimeRoot, sourceVaultRoot);
  }

  return { started, confirmed, skipped };
}

export async function bulkConfirmDeepResearchItems(
  runtimeRoot: string,
  sourceVaultRoot: string,
): Promise<DeepResearchBulkConfirmResult> {
  const items = readDeepResearchItems(runtimeRoot);
  let confirmed = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.status !== "done-await-confirm" || !item.draftResult) {
      skipped += 1;
      continue;
    }
    if (!getDeepResearchItem(runtimeRoot, item.id)) {
      skipped += 1;
      continue;
    }
    try {
      await confirmDeepResearchWrite(runtimeRoot, sourceVaultRoot, item.id);
      confirmed += 1;
    } catch (error) {
      failed += 1;
      mutateDeepResearchItem(runtimeRoot, item.id, (current) => ({
        ...current,
        status: "failed",
        progress: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso(),
      }));
    }
  }
  return { confirmed, failed, skipped };
}

function resolveDeepResearchPath(wikiRoot: string): string {
  return path.join(wikiRoot, ".llmwiki", DEEP_RESEARCH_FILE);
}

function writeDeepResearchItems(wikiRoot: string, items: readonly DeepResearchItem[]): void {
  const filePath = resolveDeepResearchPath(wikiRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(sortDeepResearchItems(items), null, 2)}\n`, "utf8");
}

function sortDeepResearchItems(items: readonly DeepResearchItem[]): DeepResearchItem[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function mutateDeepResearchItem(
  wikiRoot: string,
  id: string,
  mutator: (item: DeepResearchItem) => DeepResearchItem,
): DeepResearchItem | null {
  const currentItems = readDeepResearchItems(wikiRoot);
  let nextItem: DeepResearchItem | null = null;
  const nextItems = currentItems.map((item) => {
    if (item.id !== id) {
      return item;
    }
    nextItem = mutator(item);
    return nextItem;
  });
  if (!nextItem) {
    return null;
  }
  writeDeepResearchItems(wikiRoot, nextItems);
  return nextItem;
}

function enqueueDeepResearchTask(runtimeRoot: string, sourceVaultRoot: string, id: string): void {
  const key = `${runtimeRoot}:${id}`;
  if (backgroundTasks.has(key)) {
    return;
  }
  const task = runDeepResearchTask(runtimeRoot, sourceVaultRoot, id).finally(() => {
    backgroundTasks.delete(key);
  });
  backgroundTasks.set(key, task);
}

function enqueueMissingCitationBatch(runtimeRoot: string, sourceVaultRoot: string): void {
  const key = `${runtimeRoot}:missing-citation-batch`;
  if (backgroundTasks.has(key)) {
    return;
  }
  const task = Promise.resolve()
    .then(() => runMissingCitationBatch(runtimeRoot, sourceVaultRoot))
    .finally(() => {
      backgroundTasks.delete(key);
    });
  backgroundTasks.set(key, task);
}

function applyDeepResearchDraftToTarget(runtimeRoot: string, sourceVaultRoot: string, item: DeepResearchItem): void {
  const draft = requireDraftResult(item);
  const targetPath = resolveDraftTargetPath(sourceVaultRoot, draft.pagePath);
  if (shouldRewriteCitationDraft(item, draft)) {
    applyCitationRewriteDraft(runtimeRoot, sourceVaultRoot, item, draft, targetPath);
    return;
  }
  appendDraftContentIfMissing(targetPath, item.id, draft.content);
}

function shouldBackfillLegacyOutdatedSourceItem(item: DeepResearchItem, sourceVaultRoot: string): boolean {
  if (item.category !== "outdated-source" || item.status === "completed" || item.status === "ignored" || !item.factText) {
    return false;
  }
  const targetPath = path.join(sourceVaultRoot, ...item.pagePath.split("/"));
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  return pageHasLegacyOutdatedSourceDraft(fs.readFileSync(targetPath, "utf8"), item.factText);
}

function shouldBackfillLegacyNeedsDeepResearchItem(item: DeepResearchItem, sourceVaultRoot: string): boolean {
  if (item.category !== "needs-deep-research" || item.status === "completed" || item.status === "ignored" || !item.factText) {
    return false;
  }
  const targetPath = path.join(sourceVaultRoot, ...item.pagePath.split("/"));
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  return pageHasLegacyNeedsDeepResearchDraft(fs.readFileSync(targetPath, "utf8"), item.factText);
}

function refreshConfirmedDeepResearchClaimLifecycle(runtimeRoot: string, sourceVaultRoot: string, item: DeepResearchItem): boolean {
  switch (item.category) {
    case "outdated-source":
      return refreshOutdatedSourceClaimLifecycle(runtimeRoot, sourceVaultRoot, item);
    case "needs-deep-research":
      return refreshNeedsDeepResearchClaimLifecycle(runtimeRoot, sourceVaultRoot, item);
    default:
      return false;
  }
}

function refreshOutdatedSourceClaimLifecycle(runtimeRoot: string, sourceVaultRoot: string, item: DeepResearchItem): boolean {
  const context = outdatedSourceClaimContext(item);
  if (!context) {
    return false;
  }

  const refreshedAt = nowIso();
  let refreshed = false;
  for (const root of claimStoreRoots(runtimeRoot, sourceVaultRoot)) {
    refreshed = refreshOutdatedSourceClaimStore(root, context, refreshedAt) || refreshed;
  }
  return refreshed;
}

function refreshNeedsDeepResearchClaimLifecycle(runtimeRoot: string, sourceVaultRoot: string, item: DeepResearchItem): boolean {
  const context = needsDeepResearchClaimContext(item);
  if (!context) {
    return false;
  }

  const refreshedAt = nowIso();
  let refreshed = false;
  for (const root of claimStoreRoots(runtimeRoot, sourceVaultRoot)) {
    refreshed = refreshNeedsDeepResearchClaimStore(root, context, refreshedAt) || refreshed;
  }
  return refreshed;
}

function claimStoreRoots(runtimeRoot: string, sourceVaultRoot: string): string[] {
  return [...new Set([sourceVaultRoot, runtimeRoot])];
}

function outdatedSourceClaimContext(item: DeepResearchItem): { conceptSlug: string; factText: string } | null {
  if (item.category !== "outdated-source" || !item.factText) {
    return null;
  }
  const conceptSlug = conceptSlugFromPagePath(item.pagePath);
  if (!conceptSlug) {
    return null;
  }
  return {
    conceptSlug,
    factText: item.factText,
  };
}

function needsDeepResearchClaimContext(item: DeepResearchItem): { conceptSlug: string; factText: string } | null {
  if (item.category !== "needs-deep-research" || !item.factText) {
    return null;
  }
  const conceptSlug = conceptSlugFromPagePath(item.pagePath);
  if (!conceptSlug) {
    return null;
  }
  return {
    conceptSlug,
    factText: item.factText,
  };
}

function refreshOutdatedSourceClaimStore(
  root: string,
  context: { conceptSlug: string; factText: string },
  refreshedAt: string,
): boolean {
  const claimsPath = path.join(root, ".llmwiki", "claims.json");
  const claims = readClaimLifecycleRecords(claimsPath);
  if (!claims) {
    return false;
  }
  if (!refreshMatchingOutdatedSourceClaims(claims, context, refreshedAt)) {
    return false;
  }
  fs.writeFileSync(claimsPath, `${JSON.stringify(claims, null, 2)}\n`, "utf8");
  return true;
}

function refreshNeedsDeepResearchClaimStore(
  root: string,
  context: { conceptSlug: string; factText: string },
  refreshedAt: string,
): boolean {
  const claimsPath = path.join(root, ".llmwiki", "claims.json");
  const claims = readClaimLifecycleRecords(claimsPath);
  if (!claims) {
    return false;
  }
  if (!refreshMatchingNeedsDeepResearchClaims(claims, context, refreshedAt)) {
    return false;
  }
  fs.writeFileSync(claimsPath, `${JSON.stringify(claims, null, 2)}\n`, "utf8");
  return true;
}

function readClaimLifecycleRecords(claimsPath: string): ClaimLifecycleRecord[] | null {
  if (!fs.existsSync(claimsPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(claimsPath, "utf8")) as ClaimLifecycleRecord[];
  } catch {
    return null;
  }
}

function refreshMatchingOutdatedSourceClaims(
  claims: ClaimLifecycleRecord[],
  context: { conceptSlug: string; factText: string },
  refreshedAt: string,
): boolean {
  let changed = false;
  for (const claim of claims) {
    if (!isMatchingOutdatedSourceClaim(claim, context.conceptSlug, context.factText)) {
      continue;
    }
    claim.lastConfirmedAt = refreshedAt;
    claim.lastAccessedAt = refreshedAt;
    claim.retention = 1;
    if (claim.status === "stale") {
      claim.status = "active";
    }
    changed = true;
  }
  return changed;
}

function refreshMatchingNeedsDeepResearchClaims(
  claims: ClaimLifecycleRecord[],
  context: { conceptSlug: string; factText: string },
  refreshedAt: string,
): boolean {
  let changed = false;
  for (const claim of claims) {
    if (!isMatchingOutdatedSourceClaim(claim, context.conceptSlug, context.factText)) {
      continue;
    }
    const nextStatus = claim.status === "stale" ? "active" : claim.status;
    const nextSupportCount = Math.max(claim.supportCount ?? 1, 2);
    claim.lastConfirmedAt = refreshedAt;
    claim.lastAccessedAt = refreshedAt;
    claim.retention = 1;
    claim.status = nextStatus;
    claim.supportCount = nextSupportCount;
    claim.confidence = Math.max(
      claim.confidence ?? 0,
      MIN_CONFIRMED_DEEP_RESEARCH_CONFIDENCE,
      calculateConfidence({
        supportCount: nextSupportCount,
        reinforcementCount: Math.max(0, claim.sourceFiles.length - 1),
        contradictionCount: claim.contradictionCount ?? 0,
        daysSinceConfirmed: 0,
        halfLifeDays: claim.halfLifeDays,
        status: nextStatus,
      }),
    );
    changed = true;
  }
  return changed;
}

function conceptSlugFromPagePath(pagePath: string): string | null {
  const normalized = pagePath.replace(/\\/g, "/");
  if (!normalized.startsWith("wiki/concepts/") || !normalized.endsWith(".md")) {
    return null;
  }
  return normalized.slice("wiki/concepts/".length, -".md".length);
}

function isMatchingOutdatedSourceClaim(
  claim: ClaimLifecycleRecord,
  conceptSlug: string,
  factText: string,
): boolean {
  return claim.conceptSlug === conceptSlug
    && normalizeComparableClaimText(claim.claimText) === normalizeComparableClaimText(factText);
}

function normalizeComparableClaimText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function pageHasLegacyOutdatedSourceDraft(content: string, factText: string): boolean {
  return pageHasLegacyDraft(content, "发起改写草案", factText);
}

function pageHasLegacyNeedsDeepResearchDraft(content: string, factText: string): boolean {
  return pageHasLegacyDraft(content, "Deep Research草案", factText);
}

function pageHasLegacyDraft(content: string, heading: string, factText: string): boolean {
  const normalizedFactText = normalizeComparableClaimText(factText);
  for (const subject of extractLegacyDraftSubjects(content, heading)) {
    if (subject === normalizedFactText) {
      return true;
    }
  }
  return false;
}

function extractLegacyDraftSubjects(content: string, heading: string): string[] {
  const subjects: string[] = [];
  const pattern = new RegExp(
    `<!-- deep-research:[^\\n]*\\r?\\n## ${escapeRegex(heading)}\\r?\\n(?:- .*\\r?\\n)*?- 对象：(.+)\\r?\\n`,
    "gu",
  );
  for (const match of content.matchAll(pattern)) {
    const subject = match[1]?.trim();
    if (subject) {
      subjects.push(normalizeComparableClaimText(subject));
    }
  }
  return subjects;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function runDeepResearchTask(runtimeRoot: string, sourceVaultRoot: string, id: string): Promise<void> {
  try {
    const collecting = mutateDeepResearchItem(runtimeRoot, id, (item) => ({
      ...item,
      progress: Math.max(item.progress, 18),
      updatedAt: nowIso(),
    }));
    if (!collecting) {
      return;
    }

    const targetPath = path.join(sourceVaultRoot, ...collecting.pagePath.split("/"));
    if (!fs.existsSync(targetPath)) {
      mutateDeepResearchItem(runtimeRoot, id, (item) => ({
        ...item,
        status: "failed",
        progress: 0,
        errorMessage: `找不到目标页面：${item.pagePath}`,
        updatedAt: nowIso(),
      }));
      return;
    }

    const targetContent = fs.readFileSync(targetPath, "utf8");
    for (const [index, progress] of [35, 68, 90].entries()) {
      await delay(BACKGROUND_STEP_DELAYS_MS[index] ?? 10);
      mutateDeepResearchItem(runtimeRoot, id, (item) => ({
        ...item,
        progress: Math.max(item.progress, progress),
        updatedAt: nowIso(),
      }));
    }

    mutateDeepResearchItem(runtimeRoot, id, (item) => ({
      ...item,
      status: "done-await-confirm",
      progress: 100,
      draftResult: buildDraftResult(item, sourceVaultRoot, targetContent),
      errorMessage: undefined,
      updatedAt: nowIso(),
    }));
  } catch (error) {
    mutateDeepResearchItem(runtimeRoot, id, (item) => ({
      ...item,
      status: "failed",
      progress: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt: nowIso(),
    }));
  }
}

function buildDraftResult(item: DeepResearchItem, sourceVaultRoot: string, targetContent: string): DeepResearchDraftResult {
  if (item.category === "missing-citation" && item.selectedAction === "add-citation") {
    return buildCitationRewriteDraftResult(item, sourceVaultRoot, targetContent);
  }
  const actionLabel = item.selectedAction ? actionLabelForAction(item.selectedAction) : "处理";
  const factOrGap = item.factText?.trim() || item.gapText.trim();
  const summary = `${actionLabel}草案`;
  const preview = [
    `页面：${item.pagePath}`,
    item.line ? `定位：第 ${item.line} 行` : "",
    `对象：${factOrGap}`,
    `依据：${item.triggerReason}`,
  ].filter(Boolean).join("\n");
  const content = [
    `<!-- deep-research:${item.id} -->`,
    `## ${summary}`,
    `- 问题类型：${item.title}`,
    `- 页面：${item.pagePath}`,
    item.line ? `- 行号：${item.line}` : "",
    `- 处理动作：${actionLabel}`,
    `- 对象：${factOrGap}`,
    `- 触发依据：${item.triggerReason}`,
    item.sourceExcerpt ? `- 原始诊断：${item.sourceExcerpt}` : "",
    `- 建议写入：${buildDraftSuggestion(item)}`,
  ].filter(Boolean).join("\n");
  return {
    mode: "append",
    pagePath: item.pagePath,
    summary,
    preview,
    content,
  };
}

function buildDraftSuggestion(item: DeepResearchItem): string {
  switch (item.category) {
    case "missing-citation":
      return `补上一条稳定来源，并把“${item.factText?.trim() || item.gapText.trim()}”对应的引用位置改成可追溯来源。`;
    case "needs-deep-research":
      return `补齐外部来源后，再确认“${item.factText?.trim() || item.gapText.trim()}”是否仍然成立。`;
    case "outdated-source":
      return `用更新来源替换“${item.factText?.trim() || item.gapText.trim()}”的旧表述。`;
    case "suggestion":
      return `接受这条新问题/新来源建议，并补充到后续整理范围。`;
  }
}

function buildCitationRewriteDraftResult(
  item: DeepResearchItem,
  sourceVaultRoot: string,
  targetContent: string,
): DeepResearchDraftResult {
  const citationTarget = extractBrokenCitationTarget(item);
  if (!citationTarget) {
    throw new Error("无法解析失效引用目标");
  }

  return buildCitationRewriteDraftResultWithIndex(
    item,
    targetContent,
    buildCitationSourceIndex(sourceVaultRoot),
    citationTarget,
  );
}

function buildCitationRewriteDraftResultWithIndex(
  item: DeepResearchItem,
  targetContent: string,
  sourceIndex: CitationSourceIndex,
  citationTarget = extractBrokenCitationTarget(item),
): DeepResearchDraftResult {
  if (!citationTarget) {
    throw new Error("无法解析失效引用目标");
  }

  const replacementCitation = findCitationReplacementInIndex(sourceIndex, citationTarget);
  const rewrite = rewriteBrokenCitationsInPage(targetContent, citationTarget, replacementCitation);
  if (!rewrite.changed) {
    throw new Error("页面里没有可修复的失效引用");
  }

  const actionSummary = replacementCitation
    ? `将失效引用替换为 ${replacementCitation}`
    : `删除失效引用 ${citationTarget}`;
  const preview = [
    `页面：${item.pagePath}`,
    `失效来源：${citationTarget}`,
    `处理动作：${actionSummary}`,
    rewrite.citationChanges > 0 ? `正文引用命中：${rewrite.citationChanges} 处` : "",
    rewrite.legacyBlockCount > 0 ? `旧补引用草案清理：${rewrite.legacyBlockCount} 块` : "",
  ].filter(Boolean).join("\n");
  const content = [
    `- 失效来源：${citationTarget}`,
    replacementCitation ? `- 替换为：${replacementCitation}` : "- 处理方式：删除失效引用",
    `- 正文修复：${rewrite.citationChanges} 处`,
    rewrite.listLineChanges > 0 ? `- 来源清单同步：${rewrite.listLineChanges} 行` : "",
    rewrite.legacyBlockCount > 0 ? `- 清理旧补引用草案：${rewrite.legacyBlockCount} 块` : "",
  ].filter(Boolean).join("\n");

  return {
    mode: "rewrite-citations",
    pagePath: item.pagePath,
    summary: "补引用修改草案",
    preview,
    content,
    citationTarget,
    replacementCitation,
  };
}

function extractBrokenCitationTarget(item: Pick<DeepResearchItem, "gapText" | "sourceExcerpt">): string | null {
  const match = (item.sourceExcerpt ?? item.gapText).match(/Broken citation \^\[([^\]]+)\] - source file not found/u);
  return match?.[1]?.trim() || null;
}

function findCitationReplacement(sourceVaultRoot: string, citationTarget: string): string | undefined {
  return findCitationReplacementInIndex(buildCitationSourceIndex(sourceVaultRoot), citationTarget);
}

function findCitationReplacementInIndex(sourceIndex: CitationSourceIndex, citationTarget: string): string | undefined {
  if (citationExists(citationTarget, sourceIndex)) {
    return citationTarget;
  }

  const targetKeys = buildCitationLookupKeys(citationTarget);
  if (targetKeys.size === 0) {
    return undefined;
  }

  const matches = [...sourceIndex.fileNames].filter((fileName) => {
    if (fileName === citationTarget) {
      return false;
    }
    for (const key of buildCitationLookupKeys(fileName)) {
      if (targetKeys.has(key)) {
        return true;
      }
    }
    return false;
  });

  return matches.length === 1 ? matches[0] : undefined;
}

function buildCitationLookupKeys(fileName: string): Set<string> {
  const trimmed = fileName.trim().replace(/\\/g, "/");
  const baseName = path.basename(trimmed, ".md");
  if (!baseName) {
    return new Set();
  }

  const withoutHash = baseName.replace(/(?:__)?[a-f0-9]{8,32}$/iu, "").replace(/__$/u, "");
  const parts = withoutHash.split("__").map((part) => part.trim()).filter(Boolean);
  const keys = new Set<string>();
  keys.add(normalizeCitationLookupKey(withoutHash));
  if (parts.length > 0) {
    keys.add(normalizeCitationLookupKey(parts.at(-1) ?? ""));
  }
  if (parts.length > 1) {
    keys.add(normalizeCitationLookupKey(parts.slice(-2).join("__")));
  }
  keys.delete("");
  return keys;
}

function normalizeCitationLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function rewriteBrokenCitationsInPage(
  content: string,
  citationTarget: string,
  replacementCitation?: string,
): {
  content: string;
  changed: boolean;
  citationChanges: number;
  listLineChanges: number;
  legacyBlockCount: number;
} {
  const stripped = stripLegacyCitationDraftBlocks(content);
  let citationChanges = 0;
  const replacedCitations = stripped.content.replace(/\^\[([^\]]+)\]/gu, (_whole, captured: string) => {
    const parts = expandCitationParts(captured);
    if (!parts.includes(citationTarget)) {
      return `^[${captured}]`;
    }
    citationChanges += parts.filter((part) => part === citationTarget).length;
    const nextParts: string[] = [];
    for (const part of parts) {
      if (part === citationTarget) {
        if (replacementCitation && !nextParts.includes(replacementCitation)) {
          nextParts.push(replacementCitation);
        }
        continue;
      }
      if (!nextParts.includes(part)) {
        nextParts.push(part);
      }
    }
    return nextParts.length > 0 ? `^[${nextParts.join(", ")}]` : "";
  });

  let listLineChanges = 0;
  const lines = replacedCitations.split(/\r?\n/u);
  const nextLines: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(\s*-\s*)(.+?)\s*$/u);
    if (match?.[2]?.trim() === citationTarget) {
      listLineChanges += 1;
      if (replacementCitation) {
        const replacementLine = `${match[1]}${replacementCitation}`;
        if (nextLines.at(-1) !== replacementLine) {
          nextLines.push(replacementLine);
        }
      }
      continue;
    }
    nextLines.push(line);
  }

  const nextContent = cleanupMarkdownSpacing(nextLines.join("\n"));
  return {
    content: nextContent,
    changed: nextContent !== content,
    citationChanges,
    listLineChanges,
    legacyBlockCount: stripped.removedBlockCount,
  };
}

function stripLegacyCitationDraftBlocks(content: string): { content: string; removedBlockCount: number } {
  const lines = content.split(/\r?\n/u);
  const kept: string[] = [];
  let removedBlockCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("<!-- deep-research:") && lines[index + 1] === "## 补引用草案") {
      removedBlockCount += 1;
      index += 2;
      while (index < lines.length && !lines[index]?.startsWith("<!-- deep-research:")) {
        index += 1;
      }
      index -= 1;
      while (kept.at(-1) === "") {
        kept.pop();
      }
      continue;
    }
    kept.push(lines[index] ?? "");
  }

  return {
    content: kept.join("\n"),
    removedBlockCount,
  };
}

function cleanupMarkdownSpacing(content: string): string {
  return `${content
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]+\n/gu, "\n")
    .trimEnd()}\n`;
}

function runMissingCitationBatch(runtimeRoot: string, sourceVaultRoot: string): void {
  const currentItems = readDeepResearchItems(runtimeRoot);
  const sourceIndex = buildCitationSourceIndex(sourceVaultRoot);
  const pageContentCache = new Map<string, string | null>();
  const updatedAt = nowIso();
  const nextItems = currentItems.map((item) =>
    shouldFinalizeMissingCitation(item)
      ? finalizeMissingCitationItem(item, sourceVaultRoot, sourceIndex, pageContentCache, updatedAt)
      : item);
  writeDeepResearchItems(runtimeRoot, nextItems);
}

function shouldFinalizeMissingCitation(item: DeepResearchItem): boolean {
  return item.category === "missing-citation" && item.status === "running";
}

function finalizeMissingCitationItem(
  item: DeepResearchItem,
  sourceVaultRoot: string,
  sourceIndex: CitationSourceIndex,
  pageContentCache: Map<string, string | null>,
  updatedAt: string,
): DeepResearchItem {
  const targetContent = readDeepResearchPageContent(sourceVaultRoot, item.pagePath, pageContentCache);
  if (targetContent === null) {
    return {
      ...item,
      status: "failed",
      progress: 0,
      errorMessage: `找不到目标页面：${item.pagePath}`,
      updatedAt,
    };
  }
  try {
    const normalizedItem = item.selectedAction
      ? item
      : { ...item, selectedAction: "add-citation" as const };
    return {
      ...normalizedItem,
      status: "done-await-confirm",
      progress: 100,
      draftResult: buildCitationRewriteDraftResultWithIndex(normalizedItem, targetContent, sourceIndex),
      errorMessage: undefined,
      updatedAt,
    };
  } catch (error) {
    return {
      ...item,
      status: "failed",
      progress: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
      updatedAt,
    };
  }
}

function readDeepResearchPageContent(
  sourceVaultRoot: string,
  pagePath: string,
  pageContentCache: Map<string, string | null>,
): string | null {
  if (pageContentCache.has(pagePath)) {
    return pageContentCache.get(pagePath) ?? null;
  }
  const targetPath = path.join(sourceVaultRoot, ...pagePath.split("/"));
  const content = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, "utf8")
    : null;
  pageContentCache.set(pagePath, content);
  return content;
}

function assertActionMatchesCategory(category: DeepResearchCategory, action: DeepResearchAction): void {
  const expected = primaryActionForCategory(category);
  if (action !== expected) {
    throw new Error(`invalid action "${action}" for category "${category}"`);
  }
}

function primaryActionForCategory(category: DeepResearchCategory): DeepResearchAction {
  switch (category) {
    case "outdated-source":
      return "start-rewrite";
    case "missing-citation":
      return "add-citation";
    case "needs-deep-research":
      return "deep-research";
    case "suggestion":
      return "accept-suggestion";
  }
}

function actionLabelForAction(action: DeepResearchAction): string {
  switch (action) {
    case "start-rewrite":
      return "发起改写";
    case "add-citation":
      return "补引用";
    case "deep-research":
      return "Deep Research";
    case "accept-suggestion":
      return "接受建议";
    case "ignore":
      return "忽略";
  }
}

function categoryTitle(category: DeepResearchCategory): string {
  switch (category) {
    case "outdated-source":
      return "新来源已取代的过时表述";
    case "missing-citation":
      return "引用缺失";
    case "needs-deep-research":
      return "需要网络搜索补证的数据空白";
    case "suggestion":
      return "新问题/新来源建议";
  }
}

function parseDeepResearchDiagnostic(line: string, wikiRoot?: string): ParsedDeepResearchDiagnostic | null {
  const normalized = normalizeLine(line);
  if (!normalized) {
    return null;
  }
  if (!hasDiagnosticPrefix(normalized)) {
    return null;
  }
  const body = stripDiagnosticPrefix(normalized);
  if (!body) {
    return null;
  }

  return parseBrokenCitationDiagnostic(body, normalized, wikiRoot)
    ?? parseLowConfidenceDiagnostic(body, normalized, wikiRoot)
    ?? parseStaleClaimDiagnostic(body, normalized, wikiRoot)
    ?? parseSuggestionDiagnostic(body, normalized, wikiRoot);
}

function parseBrokenCitationDiagnostic(
  body: string,
  sourceExcerpt: string,
  wikiRoot?: string,
): ParsedDeepResearchDiagnostic | null {
  const marker = " Broken citation ";
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const location = parseLocation(body.slice(0, markerIndex), wikiRoot);
  if (!location) {
    return null;
  }
  const message = `Broken citation ${body.slice(markerIndex + marker.length)}`.trim();
  return {
    category: "missing-citation",
    scope: location.line ? "claim" : "page",
    pagePath: location.pagePath,
    line: location.line,
    factText: location.line ? `第 ${location.line} 行引用无法追溯到现有来源文件。` : undefined,
    gapText: message,
    triggerReason: "原文引用指向的来源文件不存在。",
    sourceExcerpt,
  };
}

function parseLowConfidenceDiagnostic(
  body: string,
  sourceExcerpt: string,
  wikiRoot?: string,
): ParsedDeepResearchDiagnostic | null {
  const marker = " Low-confidence claim: ";
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const location = parseLocation(body.slice(0, markerIndex), wikiRoot);
  if (!location) {
    return null;
  }
  const payload = body.slice(markerIndex + marker.length).trim();
  const confidenceMatch = payload.match(/^(.*)\s+\(confidence\s+([0-9.]+),\s*status\s+([^)]+)\)$/u);
  const factText = confidenceMatch?.[1]?.trim() || payload;
  const confidence = confidenceMatch?.[2]?.trim();
  const status = confidenceMatch?.[3]?.trim();
  return {
    category: "needs-deep-research",
    scope: "claim",
    pagePath: location.pagePath,
    line: location.line,
    factText,
    gapText: `Low-confidence claim: ${factText}`,
    triggerReason: confidence && status
      ? `当前结论置信度只有 ${confidence}，状态为 ${status}，需要补充外部证据后再确认。`
      : "当前结论缺少足够证据，需要进一步补充来源。",
    sourceExcerpt,
  };
}

function parseStaleClaimDiagnostic(
  body: string,
  sourceExcerpt: string,
  wikiRoot?: string,
): ParsedDeepResearchDiagnostic | null {
  const marker = " Stale claim: ";
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const location = parseLocation(body.slice(0, markerIndex), wikiRoot);
  if (!location) {
    return null;
  }
  const payload = body.slice(markerIndex + marker.length).trim();
  const staleMatch = payload.match(/^(.*)\s+\(retention\s+([0-9.]+),\s*last confirmed\s+([^)]+)\)$/u);
  const factText = staleMatch?.[1]?.trim() || payload;
  const retention = staleMatch?.[2]?.trim();
  const confirmedAt = staleMatch?.[3]?.trim();
  return {
    category: "outdated-source",
    scope: "claim",
    pagePath: location.pagePath,
    line: location.line,
    factText,
    gapText: `Stale claim: ${factText}`,
    triggerReason: retention && confirmedAt
      ? `这条结论保留度只有 ${retention}，最近确认时间是 ${confirmedAt}，需要用新来源替换旧表述。`
      : "这条结论已经过时，需要确认新来源是否已经取代旧表述。",
    sourceExcerpt,
  };
}

function parseSuggestionDiagnostic(
  body: string,
  sourceExcerpt: string,
  wikiRoot?: string,
): ParsedDeepResearchDiagnostic | null {
  const marker = " New source suggestion: ";
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const location = parseLocation(body.slice(0, markerIndex), wikiRoot);
  if (!location) {
    return null;
  }
  const factText = body.slice(markerIndex + marker.length).trim();
  if (!factText) {
    return null;
  }
  return {
    category: "suggestion",
    scope: "page",
    pagePath: location.pagePath,
    line: location.line,
    gapText: factText,
    triggerReason: "系统检查发现了值得接受的新问题或新来源建议。",
    sourceExcerpt,
  };
}

function parseLocation(rawLocation: string, wikiRoot?: string): { pagePath: string; line?: number } | null {
  const trimmed = rawLocation.trim();
  const lineMatch = trimmed.match(/^(.*?\.md):(\d+)$/u);
  const rawPath = lineMatch?.[1] ?? trimmed;
  const pagePath = normalizePagePath(rawPath, wikiRoot);
  if (!pagePath) {
    return null;
  }
  return {
    pagePath,
    line: lineMatch ? Number.parseInt(lineMatch[2] ?? "", 10) : undefined,
  };
}

function normalizePagePath(rawPath: string, wikiRoot?: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed.toLowerCase().endsWith(".md")) {
    return null;
  }
  const normalizedSlashes = trimmed.replace(/\\/g, "/");
  if (wikiRoot) {
    const absoluteCandidate = path.isAbsolute(trimmed)
      ? trimmed
      : path.join(wikiRoot, trimmed);
    const relative = path.relative(wikiRoot, absoluteCandidate).replace(/\\/g, "/");
    if (relative && !relative.startsWith("..")) {
      return relative;
    }
  }
  const wikiIndex = normalizedSlashes.toLowerCase().lastIndexOf("/wiki/");
  if (wikiIndex >= 0) {
    return normalizedSlashes.slice(wikiIndex + 1);
  }
  return normalizedSlashes.startsWith("wiki/") ? normalizedSlashes : null;
}

function stripDiagnosticPrefix(line: string): string {
  return line.replace(/^[!xi*]\s+(?:error|warning|info)\s+/iu, "").trim();
}

function hasDiagnosticPrefix(line: string): boolean {
  return /^[!xi*]\s+(?:error|warning|info)\s+/iu.test(line);
}

function buildDeepResearchId(
  kind: RunKind,
  category: DeepResearchCategory,
  pagePath: string,
  line: number | undefined,
  subject: string,
): string {
  const hash = createHash("sha1")
    .update(`${category}\n${pagePath}\n${line ?? ""}\n${subject}`)
    .digest("hex")
    .slice(0, 12);
  return `deep-research-${kind}-${hash}`;
}

function deepResearchItemFromDiagnostic(
  kind: RunKind,
  diagnostic: ParsedDeepResearchDiagnostic,
  createdAt: string,
  updatedAt = createdAt,
): DeepResearchItem {
  return {
    id: buildDeepResearchId(kind, diagnostic.category, diagnostic.pagePath, diagnostic.line, diagnostic.factText ?? diagnostic.gapText),
    kind,
    title: categoryTitle(diagnostic.category),
    detail: diagnostic.triggerReason,
    category: diagnostic.category,
    scope: diagnostic.scope,
    pagePath: diagnostic.pagePath,
    line: diagnostic.line,
    factText: diagnostic.factText,
    gapText: diagnostic.gapText,
    triggerReason: diagnostic.triggerReason,
    sourceExcerpt: diagnostic.sourceExcerpt,
    status: "pending",
    progress: 0,
    createdAt,
    updatedAt,
  };
}

function syncMissingCitationItemsForPage(
  runtimeRoot: string,
  sourceVaultRoot: string,
  kind: RunKind,
  pagePath: string,
): void {
  const currentItems = readDeepResearchItems(runtimeRoot);
  const untouchedItems = currentItems.filter((item) => !(item.category === "missing-citation" && item.pagePath === pagePath));
  const targetPath = path.join(sourceVaultRoot, ...pagePath.split("/"));
  if (!fs.existsSync(targetPath)) {
    writeDeepResearchItems(runtimeRoot, untouchedItems);
    return;
  }

  const existingById = new Map(
    currentItems
      .filter((item) => item.category === "missing-citation" && item.pagePath === pagePath)
      .map((item) => [item.id, item] as const),
  );
  const diagnostics = collectBrokenCitationDiagnosticsForPage(
    sourceVaultRoot,
    pagePath,
    fs.readFileSync(targetPath, "utf8"),
  );
  const rebuiltItems = diagnostics.map((diagnostic) => {
    const nextId = buildDeepResearchId(kind, diagnostic.category, diagnostic.pagePath, diagnostic.line, diagnostic.factText ?? diagnostic.gapText);
    const existing = existingById.get(nextId);
    return deepResearchItemFromDiagnostic(
      kind,
      diagnostic,
      existing?.createdAt ?? nowIso(),
      nowIso(),
    );
  });
  writeDeepResearchItems(runtimeRoot, [...untouchedItems, ...rebuiltItems]);
}

function collectBrokenCitationDiagnosticsForPage(
  sourceVaultRoot: string,
  pagePath: string,
  content: string,
): ParsedDeepResearchDiagnostic[] {
  const sourceIndex = buildCitationSourceIndex(sourceVaultRoot);
  const diagnostics: ParsedDeepResearchDiagnostic[] = [];
  const lines = content.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const match of line.matchAll(/\^\[([^\]]+)\]/gu)) {
      const captured = match[1] ?? "";
      for (const citation of expandCitationParts(captured)) {
        if (citationExists(citation, sourceIndex)) {
          continue;
        }
        diagnostics.push({
          category: "missing-citation",
          scope: "claim",
          pagePath,
          line: index + 1,
          factText: `第 ${index + 1} 行引用无法追溯到现有来源文件。`,
          gapText: `Broken citation ^[${citation}] - source file not found`,
          triggerReason: "原文引用指向的来源文件不存在。",
          sourceExcerpt: `x error ${pagePath}:${index + 1} Broken citation ^[${citation}] - source file not found`,
        });
      }
    }
  }

  return diagnostics;
}

function buildCitationSourceIndex(root: string): CitationSourceIndex {
  const fileNames = new Set<string>();
  const hashes = new Map<string, string[]>();

  for (const directory of ["sources", "sources_full"]) {
    const dirPath = path.join(root, directory);
    if (!fs.existsSync(dirPath)) {
      continue;
    }
    for (const fileName of fs.readdirSync(dirPath)) {
      if (!fileName.endsWith(".md")) {
        continue;
      }
      fileNames.add(fileName);
      const hash = extractTrailingHash(fileName);
      if (!hash) {
        continue;
      }
      const existing = hashes.get(hash) ?? [];
      existing.push(fileName);
      hashes.set(hash, existing);
    }
  }

  return { fileNames, hashes };
}

function citationExists(citation: string, index: CitationSourceIndex): boolean {
  if (index.fileNames.has(citation)) {
    return true;
  }
  const citationHash = extractTrailingHash(citation);
  if (!citationHash) {
    return false;
  }
  return (index.hashes.get(citationHash) ?? []).length > 0;
}

function extractTrailingHash(fileName: string): string | null {
  const match = fileName.match(/(?:__)?([a-f0-9]{8,32})\.md$/iu);
  return match?.[1]?.toLowerCase() ?? null;
}

function expandCitationParts(captured: string): string[] {
  return captured
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// fallow-ignore-next-line complexity
function normalizeDeepResearchItem(value: unknown, wikiRoot?: string): DeepResearchItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const required = normalizeRequiredDeepResearchFields(value, wikiRoot);
  if (!required) {
    return null;
  }
  return {
    id: required.id,
    kind: required.kind,
    title: stringField(value.title) || categoryTitle(required.category),
    detail: stringField(value.detail) || required.triggerReason,
    category: required.category,
    scope: value.scope === "page" ? "page" : "claim",
    pagePath: required.pagePath,
    line: numberField(value.line),
    factText: stringField(value.factText) || undefined,
    gapText: required.gapText,
    triggerReason: required.triggerReason,
    sourceExcerpt: stringField(value.sourceExcerpt) || undefined,
    status: required.status,
    progress: clampProgress(numberField(value.progress) ?? 0),
    selectedAction: isDeepResearchAction(value.selectedAction) ? value.selectedAction : undefined,
    draftResult: normalizeDraftResult(value.draftResult, required.pagePath),
    errorMessage: stringField(value.errorMessage) || undefined,
    chatId: stringField(value.chatId) || undefined,
    createdAt: required.createdAt,
    updatedAt: required.updatedAt,
  };
}

function normalizeDraftResult(value: unknown, fallbackPagePath: string): DeepResearchDraftResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const required = normalizeRequiredDraftFields(value, fallbackPagePath);
  if (!required) {
    return undefined;
  }
  return {
    mode: required.mode,
    pagePath: required.pagePath,
    summary: required.summary,
    preview: required.preview,
    content: required.content,
    citationTarget: stringField(value.citationTarget) || undefined,
    replacementCitation: stringField(value.replacementCitation) || undefined,
  };
}

function requireDraftResult(item: DeepResearchItem): DeepResearchDraftResult {
  if (!item.draftResult) {
    throw new Error("deep research item is not ready for confirmation");
  }
  return item.draftResult;
}

function resolveDraftTargetPath(sourceVaultRoot: string, pagePath: string): string {
  const targetPath = path.join(sourceVaultRoot, ...pagePath.split("/"));
  if (!fs.existsSync(targetPath)) {
    throw new Error(`target page not found: ${pagePath}`);
  }
  return targetPath;
}

function shouldRewriteCitationDraft(item: DeepResearchItem, draft: DeepResearchDraftResult): boolean {
  return draft.mode === "rewrite-citations" && item.category === "missing-citation";
}

function applyCitationRewriteDraft(
  runtimeRoot: string,
  sourceVaultRoot: string,
  item: DeepResearchItem,
  draft: DeepResearchDraftResult,
  targetPath: string,
): void {
  const updated = rewriteBrokenCitationsInPage(
    fs.readFileSync(targetPath, "utf8"),
    draft.citationTarget ?? extractBrokenCitationTarget(item) ?? "",
    draft.replacementCitation,
  );
  if (!updated.changed) {
    throw new Error("页面里没有可修复的失效引用");
  }
  fs.writeFileSync(targetPath, updated.content, "utf8");
  syncMissingCitationItemsForPage(runtimeRoot, sourceVaultRoot, item.kind, item.pagePath);
}

function appendDraftContentIfMissing(targetPath: string, itemId: string, draftContent: string): void {
  const existing = fs.readFileSync(targetPath, "utf8").trimEnd();
  if (existing.includes(`deep-research:${itemId}`)) {
    return;
  }
  const separator = existing.length > 0 ? "\n\n" : "";
  fs.writeFileSync(targetPath, `${existing}${separator}${draftContent.trim()}\n`, "utf8");
}

// fallow-ignore-next-line complexity
function normalizeRequiredDeepResearchFields(
  value: Record<string, unknown>,
  wikiRoot?: string,
): {
  id: string;
  kind: RunKind;
  category: DeepResearchCategory;
  status: DeepResearchStatus;
  pagePath: string;
  gapText: string;
  triggerReason: string;
  createdAt: string;
  updatedAt: string;
} | null {
  const id = stringField(value.id);
  const kind = isRunKind(value.kind) ? value.kind : null;
  const category = isDeepResearchCategory(value.category) ? value.category : null;
  const status = isDeepResearchStatus(value.status) ? value.status : null;
  const pagePath = normalizePagePath(stringField(value.pagePath), wikiRoot);
  const gapText = stringField(value.gapText);
  const triggerReason = stringField(value.triggerReason);
  const createdAt = stringField(value.createdAt);
  const updatedAt = stringField(value.updatedAt) || createdAt;
  if (!id || !kind || !category || !status || !pagePath || !gapText || !triggerReason || !createdAt || !updatedAt) {
    return null;
  }
  return { id, kind, category, status, pagePath, gapText, triggerReason, createdAt, updatedAt };
}

function normalizeRequiredDraftFields(
  value: Record<string, unknown>,
  fallbackPagePath: string,
): {
  mode: "append" | "rewrite-citations";
  pagePath: string;
  summary: string;
  preview: string;
  content: string;
} | null {
  const summary = stringField(value.summary);
  const preview = stringField(value.preview);
  const content = stringField(value.content);
  const pagePath = normalizePagePath(stringField(value.pagePath), undefined) || fallbackPagePath;
  if (!summary || !preview || !content || !pagePath) {
    return null;
  }
  return {
    mode: value.mode === "rewrite-citations" ? "rewrite-citations" : "append",
    pagePath,
    summary,
    preview,
    content,
  };
}

function isRunKind(value: unknown): value is RunKind {
  return value === "sync" || value === "check";
}

function isDeepResearchCategory(value: unknown): value is DeepResearchCategory {
  return value === "outdated-source"
    || value === "missing-citation"
    || value === "needs-deep-research"
    || value === "suggestion";
}

function isDeepResearchStatus(value: unknown): value is DeepResearchStatus {
  return value === "pending"
    || value === "running"
    || value === "done-await-confirm"
    || value === "failed"
    || value === "ignored"
    || value === "completed";
}

function isDeepResearchAction(value: unknown): value is DeepResearchAction {
  return value === "start-rewrite"
    || value === "add-citation"
    || value === "deep-research"
    || value === "accept-suggestion"
    || value === "ignore";
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeLine(value: string): string {
  return value.trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
