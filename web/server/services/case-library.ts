/**
 * Maintains the topic case library from source records.
 *
 * Case pages intentionally separate facts from delayed judgement. Automatic
 * ingestion only writes the factual layer and marks the case as pending
 * distillation so method, rule, and ability claims are not created too early.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { ServerConfig } from "../config.js";
import { extractMarkdownHeadingAnchors, type MarkdownHeadingAnchor } from "../render/heading-anchors.js";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";

const TOPIC_DIR = path.join("wiki", "专题");
const CASE_LIBRARY_DIR = path.join(TOPIC_DIR, "01-案例库");
const CASE_LIBRARY_INDEX = path.join(CASE_LIBRARY_DIR, "index.md");
const TOPIC_INDEX = path.join(TOPIC_DIR, "index.md");
const STATE_FILE_NAME = "case-library-source-state.json";
const PROBLEM_SIGNALS = ["失败", "卡住", "不行", "解决", "成功", "报错", "换工具", "反复尝试", "终于", "错误"];
const MAX_DERIVED_TITLE_LENGTH = 28;

// fallow-ignore-next-line unused-type
export type CaseStatus = "事实已记录" | "待沉淀" | "已沉淀" | "已写入规则" | "已转能力证据";

interface CaseSourceInput {
  label: string;
  entries: string[];
}

interface CaseLibraryResult {
  status: "missing-entry" | "no-increment" | "written";
  message: string;
  changedFiles: number;
  changedCases: number;
  digest?: string;
}

interface SourceSnapshot {
  digest: string;
  files: string[];
  anchors: MarkdownHeadingAnchor[];
}

interface CaseSeed {
  title: string;
  source: string;
  context: string;
  label: string;
}

interface CaseActionInput {
  action: "confirm" | "delete" | "mark-distilled" | "mark-rule" | "mark-ability";
  casePath: string;
}

export async function refreshCaseLibrarySource(
  cfg: ServerConfig,
  input: CaseSourceInput,
): Promise<CaseLibraryResult> {
  await ensureCaseLibraryScaffold(cfg);
  const entries = input.entries.map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return { status: "missing-entry", message: "没有对应路径", changedFiles: 0, changedCases: 0 };
  const snapshot = readSourceSnapshot(cfg, entries);
  const state = readSourceState(cfg.runtimeRoot);
  const key = `${input.label}::${entries.join("|")}`;
  if (state[key] === snapshot.digest) return noIncrementResult(snapshot);
  const changedCases = await writeCaseSeeds(cfg, buildCaseSeeds(input.label, snapshot));
  await writeSourceState(cfg.runtimeRoot, { ...state, [key]: snapshot.digest });
  await rebuildCaseLibraryIndex(cfg);
  return {
    status: "written",
    message: changedCases > 0 ? "已写入案例事实层，等待沉淀" : "已记录来源变更，未发现案例信号",
    changedFiles: snapshot.files.length,
    changedCases,
    digest: snapshot.digest,
  };
}

export async function mutateCaseLibraryCase(cfg: ServerConfig, input: CaseActionInput): Promise<{ status: string; message: string }> {
  const fullPath = resolveCasePath(cfg, input.casePath);
  if (!fullPath || !fs.existsSync(fullPath)) return { status: "not-found", message: "没有找到案例" };
  if (input.action === "delete") {
    fs.rmSync(fullPath, { force: true });
  } else {
    await updateCaseStatus(fullPath, statusForAction(input.action));
  }
  await rebuildCaseLibraryIndex(cfg);
  return { status: "written", message: "案例库已更新" };
}

export async function appendCaseFromWorkflow(
  cfg: ServerConfig,
  input: { title: string; sourceRecordId: string; text: string; taskTitle: string },
): Promise<string | null> {
  await ensureCaseLibraryScaffold(cfg);
  if (!hasProblemSignal(input.text)) return null;
  const title = input.title || `${input.taskTitle}过程问题`;
  const casePath = await writeCaseSeed(cfg, {
    title,
    source: `工作流记录/${input.sourceRecordId}`,
    context: input.text,
    label: "当前执行记录器",
  });
  await rebuildCaseLibraryIndex(cfg);
  return casePath;
}

async function ensureCaseLibraryScaffold(cfg: ServerConfig): Promise<void> {
  await mkdir(path.join(cfg.sourceVaultRoot, CASE_LIBRARY_DIR), { recursive: true });
  await ensureFile(cfg, TOPIC_INDEX, topicIndexTemplate());
  await ensureFile(cfg, CASE_LIBRARY_INDEX, caseLibraryIndexTemplate());
  await ensureTopicIndexLinks(cfg);
}

function readSourceSnapshot(cfg: ServerConfig, entries: string[]): SourceSnapshot {
  const files = entries.flatMap((entry) => resolveEntryFiles(cfg, entry)).sort();
  if (files.length === 0) throw new Error("输入来源路径下没有可读取的 Markdown 文件。");
  return {
    files: files.map((file) => displayPath(cfg, file)),
    digest: hashFiles(files),
    anchors: files.flatMap((file) => extractMarkdownHeadingAnchors(displayPath(cfg, file), fs.readFileSync(file, "utf8"))),
  };
}

function resolveEntryFiles(cfg: ServerConfig, entry: string): string[] {
  const fullPath = resolveEntryPath(cfg, entry);
  if (!fs.existsSync(fullPath)) throw new Error(`输入来源路径不存在：${entry}`);
  if (fs.statSync(fullPath).isFile()) return [fullPath];
  return listMarkdownFilesRecursive(fullPath, { ignoreMissing: false, skipHidden: true });
}

function resolveEntryPath(cfg: ServerConfig, entry: string): string {
  if (entry === "#/flash-diary") return path.join(cfg.sourceVaultRoot, "raw", "闪念日记");
  const cleanEntry = entry.replace(/^#\/wiki\//u, "").replace(/\\/g, "/").replace(/^\/+/u, "");
  return path.isAbsolute(cleanEntry) ? cleanEntry : path.join(cfg.sourceVaultRoot, cleanEntry);
}

function buildCaseSeeds(label: string, snapshot: SourceSnapshot): CaseSeed[] {
  return snapshot.anchors
    .filter((anchor) => hasProblemSignal(`${anchor.heading}\n${anchor.preview ?? ""}`))
    .map((anchor) => ({
      title: caseTitle(anchor),
      source: anchor.target,
      context: anchor.preview || anchor.heading,
      label,
    }));
}

async function writeCaseSeeds(cfg: ServerConfig, seeds: CaseSeed[]): Promise<number> {
  let count = 0;
  for (const seed of seeds) {
    const written = await writeCaseSeed(cfg, seed);
    if (written) count += 1;
  }
  return count;
}

async function writeCaseSeed(cfg: ServerConfig, seed: CaseSeed): Promise<string | null> {
  if (caseSourceExists(cfg, seed.source)) return null;
  const relative = path.join(CASE_LIBRARY_DIR, `${slugify(seed.title)}.md`);
  const fullPath = path.join(cfg.sourceVaultRoot, relative);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, caseDetailTemplate(seed), "utf8");
  return relative.replace(/\\/g, "/");
}

function caseSourceExists(cfg: ServerConfig, source: string): boolean {
  return listCasePages(cfg).some((file) => fs.readFileSync(file, "utf8").includes(source));
}

async function rebuildCaseLibraryIndex(cfg: ServerConfig): Promise<void> {
  const cases = listCasePages(cfg).map(readCaseSummary);
  await writeFile(path.join(cfg.sourceVaultRoot, CASE_LIBRARY_INDEX), renderCaseLibraryIndex(cases), "utf8");
}

function listCasePages(cfg: ServerConfig): string[] {
  const dir = path.join(cfg.sourceVaultRoot, CASE_LIBRARY_DIR);
  return listMarkdownFilesRecursive(dir, { ignoreMissing: true, skipHidden: true })
    .filter((file) => path.basename(file).toLowerCase() !== "index.md")
    .sort();
}

function readCaseSummary(filePath: string): { title: string; status: CaseStatus; path: string; source: string } {
  const markdown = fs.readFileSync(filePath, "utf8");
  return {
    title: /^#\s+(.+)$/mu.exec(markdown)?.[1]?.trim() ?? path.basename(filePath, ".md"),
    status: readCaseStatus(markdown),
    path: filePath.replace(/\\/g, "/"),
    source: /\|\s*来源\s*\|\s*([^|]+)\|/u.exec(markdown)?.[1]?.trim() ?? "待确认",
  };
}

function renderCaseLibraryIndex(cases: Array<{ title: string; status: CaseStatus; path: string; source: string }>): string {
  const rows = cases.map((item) => `| [[${path.basename(item.path, ".md")}]] | ${item.status} | ${item.source} |`).join("\n");
  return `${caseLibraryIndexTemplate()}\n${rows || "| 待填写 | 待填写 | 待填写 |"}\n`;
}

function caseLibraryIndexTemplate(): string {
  return [
    "# 案例库",
    "",
    "本页用于收纳从日记、个人时间线和工作台任务过程里发现的问题解决案例。",
    "",
    "## 状态看板",
    "",
    "| 案例 | 状态 | 来源 |",
    "|---|---|---|",
  ].join("\n");
}

function topicIndexTemplate(): string {
  return [
    "# 专题",
    "",
    "这里收纳从执行记录、任务卡和工作日志中沉淀出来的专题资产。",
    "",
    "- [[00-执行现场/index|执行现场]]",
    "- [[01-案例库/index|案例库]]",
    "- [[02-方法库/index|方法库]]",
    "- [[03-工具箱/index|工具箱]]",
  ].join("\n");
}

function caseDetailTemplate(seed: CaseSeed): string {
  return [
    "---",
    `status: 待沉淀`,
    `source_channel: ${seed.label}`,
    `created: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${seed.title}`,
    "",
    "## 事实层",
    "",
    `| 字段 | 内容 |`,
    "|---|---|",
    `| 问题 | ${escapeTableCell(seed.context)} |`,
    `| 背景 | 待补充 |`,
    `| 尝试过程 | ${escapeTableCell(seed.context)} |`,
    `| 失败路径 | 待确认 |`,
    `| 成功路径 | 待确认 |`,
    `| 当前结果 | 待确认 |`,
    `| 来源 | [[${escapeTableCell(seed.source)}]] |`,
    `| 附件 | 待确认 |`,
    `| 不确定点 | 方法、边界和规则等待复盘后再写 |`,
    "",
    "## 判断层",
    "",
    "### 可复用方法",
    "待沉淀。",
    "",
    "### 适用边界",
    "待沉淀。",
    "",
    "### 风险提醒",
    "待沉淀。",
    "",
    "### AI 协作规则",
    "待沉淀。",
    "",
    "### 能力证据",
    "待沉淀。",
    "",
    "### 后续验证",
    "- [ ] 复盘这个案例是否稳定可复用",
  ].join("\n");
}

async function ensureFile(cfg: ServerConfig, relative: string, content: string): Promise<void> {
  const fullPath = path.join(cfg.sourceVaultRoot, relative);
  if (fs.existsSync(fullPath)) return;
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${content}\n`, "utf8");
}

async function ensureTopicIndexLinks(cfg: ServerConfig): Promise<void> {
  const fullPath = path.join(cfg.sourceVaultRoot, TOPIC_INDEX);
  if (!fs.existsSync(fullPath)) return;
  let markdown = fs.readFileSync(fullPath, "utf8");
  for (const link of ["[[00-执行现场/index|执行现场]]", "[[01-案例库/index|案例库]]", "[[02-方法库/index|方法库]]", "[[03-工具箱/index|工具箱]]"]) {
    if (!markdown.includes(link)) markdown = `${markdown.trim()}\n- ${link}\n`;
  }
  await writeFile(fullPath, markdown, "utf8");
}

function readSourceState(runtimeRoot: string): Record<string, string> {
  const filePath = path.join(runtimeRoot, ".llmwiki", STATE_FILE_NAME);
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

async function writeSourceState(runtimeRoot: string, state: Record<string, string>): Promise<void> {
  const filePath = path.join(runtimeRoot, ".llmwiki", STATE_FILE_NAME);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function hashFiles(files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update("\0").update(fs.readFileSync(file)).update("\0");
  return hash.digest("hex");
}

function noIncrementResult(snapshot: SourceSnapshot): CaseLibraryResult {
  return { status: "no-increment", message: "暂无更多增量", changedFiles: 0, changedCases: 0, digest: snapshot.digest };
}

function resolveCasePath(cfg: ServerConfig, casePath: string): string | null {
  const clean = casePath.replace(/\\/g, "/").replace(/^\/+/u, "");
  if (!clean.startsWith(CASE_LIBRARY_DIR.replace(/\\/g, "/"))) return null;
  return path.join(cfg.sourceVaultRoot, clean);
}

async function updateCaseStatus(fullPath: string, status: CaseStatus): Promise<void> {
  const markdown = fs.readFileSync(fullPath, "utf8");
  const next = markdown.includes("status:")
    ? markdown.replace(/^status:\s*.+$/mu, `status: ${status}`)
    : `---\nstatus: ${status}\n---\n\n${markdown}`;
  await writeFile(fullPath, next, "utf8");
}

function statusForAction(action: CaseActionInput["action"]): CaseStatus {
  if (action === "mark-distilled") return "已沉淀";
  if (action === "mark-rule") return "已写入规则";
  if (action === "mark-ability") return "已转能力证据";
  return "待沉淀";
}

function readCaseStatus(markdown: string): CaseStatus {
  const status = /^status:\s*(.+)$/mu.exec(markdown)?.[1]?.trim();
  return isCaseStatus(status) ? status : "待沉淀";
}

function isCaseStatus(value: string | undefined): value is CaseStatus {
  return value === "事实已记录" || value === "待沉淀" || value === "已沉淀" || value === "已写入规则" || value === "已转能力证据";
}

function hasProblemSignal(text: string): boolean {
  return PROBLEM_SIGNALS.some((signal) => text.includes(signal));
}

function caseTitle(anchor: MarkdownHeadingAnchor): string {
  const heading = readableTitleText(anchor.heading);
  const title = isReadableCaseHeading(heading) ? heading : titleFromContext(anchor.preview);
  return appendCaseSuffix(title || "未命名");
}

function isReadableCaseHeading(heading: string): boolean {
  return /[\p{Letter}\p{Script=Han}]/u.test(heading) && !/^[\d\s:：.\-_/]+$/u.test(heading) && !heading.includes("%");
}

function titleFromContext(context: string | undefined): string | null {
  const focused = focusTitleSource(context ?? "");
  const candidates = focused.split(/[。！？!?；;\r\n]+/u);
  for (const candidate of candidates) {
    const title = readableTitleText(candidate);
    if (title.length >= 4) return truncateDerivedTitle(title);
  }
  const fallback = readableTitleText(focused);
  return fallback ? truncateDerivedTitle(fallback) : null;
}

function focusTitleSource(text: string): string {
  const marker = /(难点就在于|问题就在于|问题是|原因是|就比如说|比如说|场景下)[。:：，,、\s]*/u.exec(text);
  return marker ? text.slice((marker.index ?? 0) + marker[0].length) : text;
}

function readableTitleText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/[“”"'（）()《》【】[\]{}#*_~`|<>]+/gu, " ")
    .replace(/[，,、：:；;。！？!?]+/gu, " ")
    .replace(/\s+/gu, "")
    .replace(/^(我觉得|感觉|其实|现在|这个|那个|就是|那么|然后|嗯|呃|有时候|真的|比较常见的内容|就比如说?|你)+/u, "")
    .trim();
}

function truncateDerivedTitle(value: string): string {
  return Array.from(value).slice(0, MAX_DERIVED_TITLE_LENGTH).join("");
}

function appendCaseSuffix(title: string): string {
  return title.endsWith("案例") ? title : `${title}案例`;
}

function slugify(value: string): string {
  const clean = value.replace(/[\\/:*?"<>|#\[\]]/gu, " ").trim().replace(/\s+/gu, "-");
  return clean.slice(0, 60) || randomUUID();
}

function displayPath(cfg: ServerConfig, file: string): string {
  const relative = path.relative(cfg.sourceVaultRoot, file);
  return relative.startsWith("..") ? file.replace(/\\/g, "/") : relative.replace(/\\/g, "/");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim();
}
