/**
 * Toolbox page routes.
 *
 * The redesigned workspace toolbox page needs a richer dashboard model than
 * the legacy Markdown-per-item CRUD view. This route keeps `/api/toolbox`
 * stable while moving the primary page state into `工具箱/toolbox.json` and
 * importing older Markdown entries as legacy-backed tool assets.
 */

import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";

const LEGACY_TOOLBOX_CATEGORIES = ["检查清单", "AI工作流", "模板", "网站软件"] as const;
const TOOLBOX_MODES = ["工作流", "工具资产"] as const;
const DEFAULT_ASSET_CATEGORIES = ["全部", "软件", "模板", "检查清单", "自动化", "标准资料"] as const;

type LegacyToolboxKind = typeof LEGACY_TOOLBOX_CATEGORIES[number];
type ToolboxMode = typeof TOOLBOX_MODES[number];
type ToolboxAccent = "violet" | "green" | "orange" | "blue" | "pink";
type ToolboxEntityType = "workflow" | "asset";

interface ToolboxPageMeta {
  title: string;
  subtitle: string;
  defaultMode: ToolboxMode;
  modes: ToolboxMode[];
  assetCategories: string[];
}

interface ToolboxWorkflowRecord {
  id: string;
  entityType: "workflow";
  title: string;
  summary: string;
  ratioLabel: string;
  agentName: string;
  accent: ToolboxAccent;
}

interface ToolboxAssetSource {
  type: "managed" | "legacy-markdown";
  path?: string;
}

export interface ToolboxAssetRecord {
  id: string;
  entityType: "asset";
  title: string;
  summary: string;
  category: string;
  badge: string;
  href: string;
  source: ToolboxAssetSource;
}

interface ToolboxRecentRunRecord {
  id: string;
  agentName: string;
  ranAtLabel: string;
  accent: ToolboxAccent;
}

interface ToolboxFavoriteRecord {
  id: string;
  title: string;
  accent: ToolboxAccent;
}

interface ToolboxPrimaryModel {
  workflows: ToolboxWorkflowRecord[];
  assets: ToolboxAssetRecord[];
  recentRuns: ToolboxRecentRunRecord[];
  favorites: ToolboxFavoriteRecord[];
}

interface LegacyToolboxItemRecord {
  path: string;
  kind: LegacyToolboxKind;
  title: string;
  solves: string;
  url: string;
  tags: string[];
  body: string;
  raw: string;
  modifiedAt: string | null;
}

interface ToolboxPageData {
  page: ToolboxPageMeta;
  workflows: ToolboxWorkflowRecord[];
  assets: ToolboxAssetRecord[];
  recentRuns: ToolboxRecentRunRecord[];
  favorites: ToolboxFavoriteRecord[];
}

type ToolboxManagedRecord = ToolboxWorkflowRecord | ToolboxAssetRecord;

interface ToolboxWorkspacePatch {
  title?: string;
  summary?: string;
  category?: string;
  href?: string;
  badge?: string;
  agentName?: string;
  ratioLabel?: string;
}

interface ToolboxCandidateAssetInput {
  id: string;
  title: string;
  summary: string;
  href: string;
}

const DEFAULT_WORKFLOWS: readonly ToolboxWorkflowRecord[] = [
  {
    id: "workflow-collect",
    entityType: "workflow",
    title: "资料收集流",
    summary: "收集候选资料并进入后续整理。",
    ratioLabel: "1:1",
    agentName: "收集 Agent",
    accent: "violet",
  },
  {
    id: "workflow-organize",
    entityType: "workflow",
    title: "内容整理流",
    summary: "把原始材料整理成可复用结构。",
    ratioLabel: "1:1",
    agentName: "整理 Agent",
    accent: "green",
  },
  {
    id: "workflow-retrieve",
    entityType: "workflow",
    title: "检索问答流",
    summary: "把索引能力接到问答与定位。",
    ratioLabel: "1:1",
    agentName: "检索 Agent",
    accent: "blue",
  },
  {
    id: "workflow-publish",
    entityType: "workflow",
    title: "编译发布流",
    summary: "整理输出并进入编译与发布结果。",
    ratioLabel: "1:1",
    agentName: "发布 Agent",
    accent: "orange",
  },
];

const DEFAULT_RECENT_RUNS: readonly ToolboxRecentRunRecord[] = [
  {
    id: "run-collect",
    agentName: "收集 Agent",
    ranAtLabel: "2 分钟前",
    accent: "green",
  },
  {
    id: "run-organize",
    agentName: "整理 Agent",
    ranAtLabel: "15 分钟前",
    accent: "pink",
  },
  {
    id: "run-publish",
    agentName: "发布 Agent",
    ranAtLabel: "1 小时前",
    accent: "orange",
  },
  {
    id: "run-retrieve",
    agentName: "检索 Agent",
    ranAtLabel: "昨天 16:20",
    accent: "blue",
  },
];

const DEFAULT_FAVORITES: readonly ToolboxFavoriteRecord[] = [
  {
    id: "favorite-notes",
    title: "想法速记",
    accent: "pink",
  },
  {
    id: "favorite-publish-template",
    title: "编译发布模板",
    accent: "orange",
  },
  {
    id: "favorite-review-checklist",
    title: "审校检查清单",
    accent: "green",
  },
];

export function handleToolboxList(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    const payload = readToolboxPageData(cfg.projectRoot, String(_req.query.q ?? ""));
    res.json({
      success: true,
      data: payload,
    });
  };
}

export function readToolboxPageData(projectRoot: string, query = ""): ToolboxPageData {
  ensureToolboxScaffold(projectRoot);
  const primaryModel = loadPrimaryModel(projectRoot);
  return buildToolboxListPayload(projectRoot, primaryModel, query);
}

export function updateToolboxWorkflowFromWorkspace(projectRoot: string, id: string, raw: string): boolean {
  ensureToolboxScaffold(projectRoot);
  const model = loadPrimaryModel(projectRoot);
  const index = model.workflows.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const patch = parseToolboxWorkspacePatch(raw);
  const workflow = model.workflows[index];
  model.workflows[index] = {
    ...workflow,
    title: patch.title ?? workflow.title,
    summary: patch.summary ?? workflow.summary,
    agentName: patch.agentName ?? workflow.agentName,
    ratioLabel: patch.ratioLabel ?? workflow.ratioLabel,
  };
  savePrimaryModel(projectRoot, model);
  return true;
}

export function updateToolboxAssetFromWorkspace(projectRoot: string, id: string, raw: string): boolean {
  ensureToolboxScaffold(projectRoot);
  const patch = parseToolboxWorkspacePatch(raw);
  if (id.startsWith("legacy:")) return updateLegacyToolboxAsset(projectRoot, id.slice("legacy:".length), patch);
  return updateManagedToolboxAsset(projectRoot, id, patch);
}

export function updateToolboxAssetBadge(projectRoot: string, id: string, badge: string): boolean {
  ensureToolboxScaffold(projectRoot);
  const model = loadPrimaryModel(projectRoot);
  const index = model.assets.findIndex((item) => item.id === id);
  if (index >= 0) {
    model.assets[index] = { ...model.assets[index], badge };
    savePrimaryModel(projectRoot, model);
    return true;
  }
  const legacyRecord = readLegacyToolboxAsset(projectRoot, id);
  if (!legacyRecord) return false;
  savePrimaryModel(projectRoot, {
    ...model,
    assets: [{ ...legacyRecord, badge }, ...model.assets],
  });
  return true;
}

export function upsertToolboxCandidateAsset(projectRoot: string, input: ToolboxCandidateAssetInput): ToolboxAssetRecord {
  ensureToolboxScaffold(projectRoot);
  const model = loadPrimaryModel(projectRoot);
  const existing = model.assets.find((item) => item.id === input.id);
  const record: ToolboxAssetRecord = {
    id: input.id,
    entityType: "asset",
    title: input.title,
    summary: input.summary,
    category: "软件",
      badge: "待验证",
    href: input.href,
    source: existing?.source ?? { type: "managed" },
  };
  const assets = existing
    ? model.assets.map((item) => (item.id === input.id ? { ...item, ...record } : item))
    : [record, ...model.assets];
  savePrimaryModel(projectRoot, { ...model, assets });
  return record;
}

export function handleToolboxCreate(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    ensureToolboxScaffold(cfg.projectRoot);
    const entityType = normalizeEntityType(req.body?.entityType);
    const model = loadPrimaryModel(cfg.projectRoot);
    if (!entityType) {
      res.status(400).json({ success: false, error: "invalid toolbox entity type" });
      return;
    }

    const record = createManagedRecord(entityType, req.body);
    const nextModel = prependManagedRecord(model, record);
    savePrimaryModel(cfg.projectRoot, nextModel);
    res.json({
      success: true,
      data: {
        record,
      },
    });
  };
}

export function handleToolboxSave(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    ensureToolboxScaffold(cfg.projectRoot);
    const entityType = normalizeEntityType(req.body?.entityType);
    const id = String(req.body?.id ?? "").trim();
    if (!entityType || !id) {
      res.status(400).json({ success: false, error: "missing toolbox record identity" });
      return;
    }

    const model = loadPrimaryModel(cfg.projectRoot);
    const nextModel = entityType === "workflow"
      ? saveWorkflowRecord(model, req.body)
      : saveAssetRecord(model, req.body);
    if (!nextModel) {
      res.status(404).json({ success: false, error: "toolbox record not found" });
      return;
    }
    savePrimaryModel(cfg.projectRoot, nextModel);
    res.json({ success: true });
  };
}

export function handleToolboxDelete(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    ensureToolboxScaffold(cfg.projectRoot);
    const entityType = normalizeEntityType(req.body?.entityType);
    const id = String(req.body?.id ?? "").trim();
    if (!entityType || !id) {
      res.status(400).json({ success: false, error: "missing toolbox record identity" });
      return;
    }

    const model = loadPrimaryModel(cfg.projectRoot);
    const nextModel = entityType === "workflow"
      ? { ...model, workflows: model.workflows.filter((item) => item.id !== id) }
      : { ...model, assets: model.assets.filter((item) => item.id !== id) };
    savePrimaryModel(cfg.projectRoot, nextModel);
    res.json({ success: true });
  };
}

function buildToolboxListPayload(projectRoot: string, primaryModel: ToolboxPrimaryModel, query: string): ToolboxPageData {
  const legacyItems = listLegacyToolboxItems(projectRoot);
  const assets = filterAssets(
    mergeLegacyAssets(primaryModel.assets, legacyItems),
    query,
  );
  return {
    page: {
      title: "工具箱",
      subtitle: "按工作流与工具资产组织常用能力，让编译、整理、检索与发布路径更清晰。",
      defaultMode: "工作流",
      modes: [...TOOLBOX_MODES],
      assetCategories: buildAssetCategories(assets),
    },
    workflows: filterWorkflows(primaryModel.workflows, query),
    assets,
    recentRuns: primaryModel.recentRuns,
    favorites: primaryModel.favorites,
  };
}

function filterWorkflows(workflows: readonly ToolboxWorkflowRecord[], query: string): ToolboxWorkflowRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...workflows];
  }
  return workflows.filter((workflow) => {
    const haystack = [workflow.title, workflow.summary, workflow.agentName].join("\n").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function filterAssets(assets: readonly ToolboxAssetRecord[], query: string): ToolboxAssetRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...assets];
  }
  return assets.filter((asset) => {
    const haystack = [asset.title, asset.summary, asset.category, asset.badge, asset.href].join("\n").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function buildAssetCategories(assets: readonly ToolboxAssetRecord[]): string[] {
  const categories = new Set<string>(DEFAULT_ASSET_CATEGORIES);
  for (const asset of assets) {
    categories.add(asset.category);
  }
  return [...categories];
}

function mergeLegacyAssets(
  managedAssets: readonly ToolboxAssetRecord[],
  legacyItems: readonly LegacyToolboxItemRecord[],
): ToolboxAssetRecord[] {
  const knownPaths = new Set(
    managedAssets
      .map((asset) => asset.source.path ?? null)
      .filter((value): value is string => Boolean(value)),
  );
  const knownTitles = new Set(managedAssets.map((asset) => asset.title.toLowerCase()));
  const importedAssets = legacyItems
    .filter((item) => !knownPaths.has(item.path) && !knownTitles.has(item.title.toLowerCase()))
    .map(toLegacyAssetRecord);
  return [...managedAssets, ...importedAssets];
}

function toLegacyAssetRecord(item: LegacyToolboxItemRecord): ToolboxAssetRecord {
  return {
    id: `legacy:${item.path}`,
    entityType: "asset",
    title: item.title,
    summary: item.solves || item.body.split(/\r?\n/).find((line) => line.trim().length > 0) || "",
    category: mapLegacyKindToAssetCategory(item.kind),
    badge: mapLegacyKindToAssetCategory(item.kind),
    href: item.url,
    source: {
      type: "legacy-markdown",
      path: item.path,
    },
  };
}

function readLegacyToolboxAsset(projectRoot: string, id: string): ToolboxAssetRecord | null {
  if (!id.startsWith("legacy:")) return null;
  const relativePath = id.slice("legacy:".length);
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  return toLegacyAssetRecord(readLegacyToolboxItem(projectRoot, relativePath));
}

function mapLegacyKindToAssetCategory(kind: LegacyToolboxKind): string {
  switch (kind) {
    case "网站软件":
      return "软件";
    case "模板":
      return "模板";
    case "检查清单":
      return "检查清单";
    case "AI工作流":
      return "自动化";
    default:
      return "标准资料";
  }
}

function createWorkflowRecord(title: string): ToolboxWorkflowRecord {
  const normalizedTitle = title || "新工作流";
  const agentRoot = normalizedTitle.replace(/流$/, "").trim() || "新";
  return {
    id: createId("workflow"),
    entityType: "workflow",
    title: normalizedTitle,
    summary: "",
    ratioLabel: "1:1",
    agentName: `${agentRoot} Agent`,
    accent: "blue",
  };
}

function createAssetRecord(title: string, category: string): ToolboxAssetRecord {
  return {
    id: createId("asset"),
    entityType: "asset",
    title: title || "新建工具",
    summary: "",
    category: category || "标准资料",
    badge: category || "标准资料",
    href: "",
    source: {
      type: "managed",
    },
  };
}

function saveWorkflowRecord(model: ToolboxPrimaryModel, body: unknown): ToolboxPrimaryModel | null {
  const recordBody = normalizeRecordBody(body);
  const existing = model.workflows.find((item) => item.id === recordBody.id);
  if (!existing) {
    return null;
  }
  const nextRecord: ToolboxWorkflowRecord = {
    ...existing,
    title: recordBody.title || existing.title,
    summary: recordBody.summary,
    ratioLabel: recordBody.ratioLabel || existing.ratioLabel,
    agentName: recordBody.agentName || existing.agentName,
    accent: normalizeAccent(recordBody.accent) ?? existing.accent,
  };
  return {
    ...model,
    workflows: model.workflows.map((item) => (item.id === nextRecord.id ? nextRecord : item)),
  };
}

function saveAssetRecord(model: ToolboxPrimaryModel, body: unknown): ToolboxPrimaryModel | null {
  const recordBody = normalizeRecordBody(body);
  const existing = model.assets.find((item) => item.id === recordBody.id);
  if (!existing) {
    return null;
  }
  const nextCategory = recordBody.category || existing.category;
  const nextRecord: ToolboxAssetRecord = {
    ...existing,
    title: recordBody.title || existing.title,
    summary: recordBody.summary,
    category: nextCategory,
    badge: recordBody.badge || nextCategory,
    href: recordBody.href,
    source: existing.source.type === "legacy-markdown" ? existing.source : { type: "managed", path: existing.source.path },
  };
  return {
    ...model,
    assets: model.assets.map((item) => (item.id === nextRecord.id ? nextRecord : item)),
  };
}

function normalizeRecordBody(body: unknown): {
  id: string;
  title: string;
  summary: string;
  ratioLabel: string;
  agentName: string;
  accent: string;
  category: string;
  badge: string;
  href: string;
} {
  const value = isRecord(body) ? body : {};
  return {
    id: readRecordText(value, "id"),
    title: readRecordText(value, "title"),
    summary: readRecordText(value, "summary"),
    ratioLabel: readRecordText(value, "ratioLabel"),
    agentName: readRecordText(value, "agentName"),
    accent: readRecordText(value, "accent"),
    category: readRecordText(value, "category"),
    badge: readRecordText(value, "badge"),
    href: readRecordText(value, "href"),
  };
}

function normalizeEntityType(input: unknown): ToolboxEntityType | null {
  return input === "workflow" || input === "asset" ? input : null;
}

function normalizeAccent(input: string): ToolboxAccent | null {
  return input === "violet" || input === "green" || input === "orange" || input === "blue" || input === "pink"
    ? input
    : null;
}

function ensureToolboxScaffold(projectRoot: string): void {
  const root = path.join(projectRoot, "工具箱");
  fs.mkdirSync(root, { recursive: true });
  for (const category of LEGACY_TOOLBOX_CATEGORIES) {
    fs.mkdirSync(path.join(root, category), { recursive: true });
  }
  ensureLegacyToolboxFile(
    projectRoot,
    "网站软件",
    "Figma",
    "快速完成界面设计、原型协作和评审交付",
    "https://www.figma.com/",
    ["design", "ui"],
    "## 简介\n\n适合做界面设计、原型和协作评审。",
  );
  ensureLegacyToolboxFile(
    projectRoot,
    "模板",
    "周报模板",
    "快速复用每周项目同步与复盘结构",
    "",
    ["weekly", "report"],
    "## 简介\n\n适合每周固定汇报和复盘。",
  );
  const primaryPath = getPrimaryModelPath(projectRoot);
  if (!fs.existsSync(primaryPath)) {
    savePrimaryModel(projectRoot, buildDefaultPrimaryModel());
  }
}

function buildDefaultPrimaryModel(): ToolboxPrimaryModel {
  return {
    workflows: cloneRecords(DEFAULT_WORKFLOWS),
    assets: [],
    recentRuns: cloneRecords(DEFAULT_RECENT_RUNS),
    favorites: cloneRecords(DEFAULT_FAVORITES),
  };
}

function getPrimaryModelPath(projectRoot: string): string {
  return path.join(projectRoot, "工具箱", "toolbox.json");
}

function loadPrimaryModel(projectRoot: string): ToolboxPrimaryModel {
  const file = getPrimaryModelPath(projectRoot);
  if (!fs.existsSync(file)) {
    return buildDefaultPrimaryModel();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<ToolboxPrimaryModel>;
    return normalizePrimaryModel(parsed);
  } catch {
    return buildDefaultPrimaryModel();
  }
}

function savePrimaryModel(projectRoot: string, model: ToolboxPrimaryModel): void {
  const file = getPrimaryModelPath(projectRoot);
  fs.writeFileSync(file, JSON.stringify(model, null, 2), "utf-8");
}

function normalizePrimaryModel(input: Partial<ToolboxPrimaryModel>): ToolboxPrimaryModel {
  return {
    workflows: Array.isArray(input.workflows) ? input.workflows.map(normalizeWorkflowRecord).filter(Boolean) : [],
    assets: Array.isArray(input.assets) ? input.assets.map(normalizeAssetRecord).filter(Boolean) : [],
    recentRuns: Array.isArray(input.recentRuns) ? input.recentRuns.map(normalizeRecentRunRecord).filter(Boolean) : [],
    favorites: Array.isArray(input.favorites) ? input.favorites.map(normalizeFavoriteRecord).filter(Boolean) : [],
  };
}

function normalizeWorkflowRecord(input: unknown): ToolboxWorkflowRecord | null {
  if (!isRecord(input)) {
    return null;
  }
  return {
    id: readRecordText(input, "id") || createId("workflow"),
    entityType: "workflow",
    title: readRecordText(input, "title") || "未命名工作流",
    summary: readRecordText(input, "summary"),
    ratioLabel: readRecordText(input, "ratioLabel") || "1:1",
    agentName: readRecordText(input, "agentName") || "未命名 Agent",
    accent: normalizeAccent(readRecordText(input, "accent")) ?? "blue",
  };
}

function normalizeAssetRecord(input: unknown): ToolboxAssetRecord | null {
  if (!isRecord(input)) {
    return null;
  }
  const category = readRecordText(input, "category") || "标准资料";
  const sourceInput = isRecord(input.source) ? input.source : {};
  return {
    id: readRecordText(input, "id") || createId("asset"),
    entityType: "asset",
    title: readRecordText(input, "title") || "未命名工具",
    summary: readRecordText(input, "summary"),
    category,
    badge: readRecordText(input, "badge") || category,
    href: readRecordText(input, "href"),
    source: normalizeAssetSource(sourceInput),
  };
}

function normalizeRecentRunRecord(input: unknown): ToolboxRecentRunRecord | null {
  if (!isRecord(input)) {
    return null;
  }
  return {
    id: String(input.id ?? createId("run")),
    agentName: String(input.agentName ?? "").trim() || "未命名 Agent",
    ranAtLabel: String(input.ranAtLabel ?? "").trim() || "刚刚",
    accent: normalizeAccent(String(input.accent ?? "")) ?? "blue",
  };
}

function normalizeFavoriteRecord(input: unknown): ToolboxFavoriteRecord | null {
  if (!isRecord(input)) {
    return null;
  }
  return {
    id: String(input.id ?? createId("favorite")),
    title: String(input.title ?? "").trim() || "未命名入口",
    accent: normalizeAccent(String(input.accent ?? "")) ?? "blue",
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneRecords<T extends Record<string, unknown>>(records: readonly T[]): T[] {
  return records.map((record) => ({ ...record }));
}

function readRecordText(record: Record<string, unknown>, key: string): string {
  return String(record[key] ?? "").trim();
}

function createManagedRecord(entityType: ToolboxEntityType, body: unknown): ToolboxManagedRecord {
  const recordBody = isRecord(body) ? body : {};
  const title = readRecordText(recordBody, "title");
  if (entityType === "workflow") {
    return createWorkflowRecord(title);
  }
  return createAssetRecord(title, readRecordText(recordBody, "category"));
}

function prependManagedRecord(model: ToolboxPrimaryModel, record: ToolboxManagedRecord): ToolboxPrimaryModel {
  if (record.entityType === "workflow") {
    return { ...model, workflows: [record, ...model.workflows] };
  }
  return { ...model, assets: [record, ...model.assets] };
}

function normalizeAssetSource(sourceInput: Record<string, unknown>): ToolboxAssetSource {
  return {
    type: sourceInput.type === "legacy-markdown" ? "legacy-markdown" : "managed",
    path: typeof sourceInput.path === "string" ? sourceInput.path : undefined,
  };
}

function updateManagedToolboxAsset(projectRoot: string, id: string, patch: ToolboxWorkspacePatch): boolean {
  const model = loadPrimaryModel(projectRoot);
  const index = model.assets.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const asset = model.assets[index];
  model.assets[index] = {
    ...asset,
    title: patch.title ?? asset.title,
    summary: patch.summary ?? asset.summary,
    category: patch.category ?? asset.category,
    badge: patch.badge ?? patch.category ?? asset.badge,
    href: patch.href ?? asset.href,
  };
  savePrimaryModel(projectRoot, model);
  return true;
}

function updateLegacyToolboxAsset(projectRoot: string, relativePath: string, patch: ToolboxWorkspacePatch): boolean {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return false;
  const current = readLegacyToolboxItem(projectRoot, relativePath);
  const kind = normalizeLegacyKind(patch.category ?? current.kind) ?? current.kind;
  const next = stringifyLegacyToolboxItem({
    kind,
    title: patch.title ?? current.title,
    solves: patch.summary ?? current.solves,
    url: patch.href ?? current.url,
    tags: current.tags,
    body: current.body,
  });
  fs.writeFileSync(fullPath, next, "utf-8");
  return true;
}

function parseToolboxWorkspacePatch(raw: string): ToolboxWorkspacePatch {
  return {
    title: readMarkdownTitle(raw),
    summary: readLineValue(raw, "摘要"),
    category: readLineValue(raw, "分类"),
    href: readLineValue(raw, "链接"),
    badge: readLineValue(raw, "标记"),
    agentName: readLineValue(raw, "Agent"),
    ratioLabel: readLineValue(raw, "比例"),
  };
}

function readMarkdownTitle(raw: string): string | undefined {
  const title = /^#\s+(.+)$/mu.exec(raw)?.[1]?.trim();
  return title || undefined;
}

function readLineValue(raw: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = new RegExp(`^${escaped}[:：]\\s*(.+)$`, "mu").exec(raw)?.[1]?.trim();
  return value || undefined;
}

function ensureLegacyToolboxFile(
  projectRoot: string,
  kind: LegacyToolboxKind,
  title: string,
  solves: string,
  url: string,
  tags: string[],
  body: string,
): void {
  const relativePath = path.join("工具箱", kind, `${sanitizeToolboxFilename(title)}.md`).split(path.sep).join("/");
  const fullPath = path.join(projectRoot, relativePath);
  if (fs.existsSync(fullPath)) {
    return;
  }
  fs.writeFileSync(fullPath, stringifyLegacyToolboxItem({ kind, title, solves, url, tags, body }), "utf-8");
}

function listLegacyToolboxItems(projectRoot: string): LegacyToolboxItemRecord[] {
  const root = path.join(projectRoot, "工具箱");
  const items: LegacyToolboxItemRecord[] = [];
  for (const category of LEGACY_TOOLBOX_CATEGORIES) {
    const directory = path.join(root, category);
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      items.push(readLegacyToolboxItem(projectRoot, path.join("工具箱", category, entry.name).split(path.sep).join("/")));
    }
  }
  return items.sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
}

function readLegacyToolboxItem(projectRoot: string, relativePath: string): LegacyToolboxItemRecord {
  const raw = fs.readFileSync(path.join(projectRoot, relativePath), "utf-8");
  const parsed = parseLegacyToolboxMarkdown(raw);
  const stat = fs.statSync(path.join(projectRoot, relativePath));
  return {
    path: relativePath,
    kind: normalizeLegacyKind(parsed.kind) ?? "检查清单",
    title: parsed.title || path.basename(relativePath, ".md"),
    solves: parsed.solves || "",
    url: parsed.url || "",
    tags: parsed.tags,
    body: parsed.body,
    raw,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function parseLegacyToolboxMarkdown(raw: string): {
  title: string;
  kind: string;
  solves: string;
  url: string;
  tags: string[];
  body: string;
} {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalized);
  const body = normalized.slice(match?.[0]?.length ?? 0).trim();
  const values = parseLegacyFrontmatterValues(match?.[1] ?? "");
  return {
    title: values.get("title") ?? "",
    kind: values.get("kind") ?? "",
    solves: values.get("solves") ?? "",
    url: values.get("url") ?? "",
    tags: splitLegacyTags(values.get("tags")),
    body,
  };
}

function parseLegacyFrontmatterValues(frontmatter: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    values.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }
  return values;
}

function splitLegacyTags(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function stringifyLegacyToolboxItem(input: {
  kind: LegacyToolboxKind;
  title: string;
  solves: string;
  url: string;
  tags: string[];
  body: string;
}): string {
  return [
    "---",
    `title: ${input.title}`,
    `kind: ${input.kind}`,
    `solves: ${input.solves}`,
    `url: ${input.url}`,
    `tags: ${input.tags.join(", ")}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    "## 可解决啥需求",
    "",
    input.solves,
    "",
    input.body || "## 简介\n",
    "",
  ].join("\n");
}

function sanitizeToolboxFilename(input: string): string {
  return input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "未命名条目";
}

function normalizeLegacyKind(input: string): LegacyToolboxKind | null {
  return (LEGACY_TOOLBOX_CATEGORIES as readonly string[]).includes(input)
    ? (input as LegacyToolboxKind)
    : null;
}
