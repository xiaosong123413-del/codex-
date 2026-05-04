/**
 * Workspace relation store.
 *
 * Relations are stored once and rendered from both endpoint pages. This keeps
 * work-log backlinks editable without duplicating links into two markdown files.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { ensureWorkspaceDocScaffold, listWorkspaceDocSummaries, type WorkspaceDocRecord } from "../routes/pages.js";

type WorkspaceRelationType =
  | "uses_method"
  | "uses_tool"
  | "produces_case"
  | "validates_success"
  | "validates_failed"
  | "references"
  | "records"
  | "from_event";

interface WorkspaceRelationRecord {
  id: string;
  sourceId: string;
  targetId: string;
  type: WorkspaceRelationType;
  createdAt: string;
  updatedAt: string;
  createdBy: "user" | "ai";
}

interface WorkspaceRelationNode {
  id: string;
  label: string;
  type: string;
  path: string;
}

interface WorkspaceRelationView {
  id: string;
  type: WorkspaceRelationType;
  typeLabel: string;
  source: WorkspaceRelationNode;
  target: WorkspaceRelationNode;
}

interface WorkspaceRelationState {
  current: WorkspaceRelationNode | null;
  relations: WorkspaceRelationView[];
  candidates: WorkspaceRelationNode[];
  types: Array<{ value: WorkspaceRelationType; label: string }>;
}

const WORKSPACE_RELATIONS_FILE = path.join(".llmwiki", "workspace-relations.json");

const RELATION_TYPES: Array<{ value: WorkspaceRelationType; label: string }> = [
  { value: "uses_method", label: "使用方法" },
  { value: "uses_tool", label: "使用工具" },
  { value: "produces_case", label: "产生案例" },
  { value: "validates_success", label: "验证成功" },
  { value: "validates_failed", label: "验证失败" },
  { value: "references", label: "引用" },
  { value: "records", label: "记录" },
  { value: "from_event", label: "来自事件" },
];

export async function readWorkspaceRelations(cfg: ServerConfig): Promise<WorkspaceRelationRecord[]> {
  const filePath = workspaceRelationsPath(cfg);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isWorkspaceRelationRecord);
}

export async function listWorkspaceRelationState(
  cfg: ServerConfig,
  nodeId: string,
): Promise<WorkspaceRelationState> {
  ensureWorkspaceDocScaffold(cfg.sourceVaultRoot);
  const documents = await listWorkspaceDocSummaries(cfg);
  const nodes = documents.map(workspaceRelationNode);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedId = nodeId.trim() || "root";
  const current = nodeById.get(selectedId) ?? null;
  const relations = relationViews(await readWorkspaceRelations(cfg), nodeById, selectedId);
  return {
    current,
    relations,
    candidates: nodes.filter((node) => node.id !== selectedId).sort(compareRelationNodes),
    types: RELATION_TYPES,
  };
}

export async function createWorkspaceRelation(
  cfg: ServerConfig,
  input: { sourceId: string; targetId: string; type: string },
): Promise<WorkspaceRelationRecord> {
  const sourceId = input.sourceId.trim();
  const targetId = input.targetId.trim();
  const type = normalizeRelationType(input.type);
  if (!sourceId || !targetId || sourceId === targetId || !type) {
    throw new Error("invalid workspace relation");
  }
  const now = new Date().toISOString();
  const nextRelation: WorkspaceRelationRecord = {
    id: relationId(sourceId, targetId, type),
    sourceId,
    targetId,
    type,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
  };
  const existing = await readWorkspaceRelations(cfg);
  const next = [
    ...existing.filter((relation) => relation.id !== nextRelation.id),
    nextRelation,
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  writeWorkspaceRelations(cfg, next);
  return nextRelation;
}

export async function deleteWorkspaceRelation(cfg: ServerConfig, relationIdValue: string): Promise<void> {
  const relationIdToDelete = relationIdValue.trim();
  if (!relationIdToDelete) {
    throw new Error("missing workspace relation id");
  }
  const next = (await readWorkspaceRelations(cfg)).filter((relation) => relation.id !== relationIdToDelete);
  writeWorkspaceRelations(cfg, next);
}

export function workspaceRelationTypeLabel(type: WorkspaceRelationType): string {
  return RELATION_TYPES.find((item) => item.value === type)?.label ?? type;
}

function relationViews(
  relations: readonly WorkspaceRelationRecord[],
  nodeById: ReadonlyMap<string, WorkspaceRelationNode>,
  selectedId: string,
): WorkspaceRelationView[] {
  return relations
    .filter((relation) => relation.sourceId === selectedId || relation.targetId === selectedId)
    .map((relation) => relationView(relation, nodeById))
    .filter((view): view is WorkspaceRelationView => Boolean(view));
}

function relationView(
  relation: WorkspaceRelationRecord,
  nodeById: ReadonlyMap<string, WorkspaceRelationNode>,
): WorkspaceRelationView | null {
  const source = nodeById.get(relation.sourceId);
  const target = nodeById.get(relation.targetId);
  if (!source || !target) {
    return null;
  }
  return {
    id: relation.id,
    type: relation.type,
    typeLabel: workspaceRelationTypeLabel(relation.type),
    source,
    target,
  };
}

function workspaceRelationNode(document: WorkspaceDocRecord): WorkspaceRelationNode {
  return {
    id: document.id,
    label: document.title ?? document.label,
    type: workspaceDocRelationType(document),
    path: document.path,
  };
}

function workspaceDocRelationType(document: WorkspaceDocRecord): string {
  if (document.gallery?.type) return document.gallery.type;
  if (/^work-log:01-项目工作区\/action\/[^/]+\//u.test(document.id)) return "action";
  if (document.kind === "work-log" && document.project === "案例库") return "case";
  if (document.kind === "work-log" && document.path.includes("/tasks/")) return "task";
  return document.kind;
}

function compareRelationNodes(left: WorkspaceRelationNode, right: WorkspaceRelationNode): number {
  const typeOrder = left.type.localeCompare(right.type, "zh-Hans-CN");
  return typeOrder || left.label.localeCompare(right.label, "zh-Hans-CN");
}

function writeWorkspaceRelations(cfg: ServerConfig, relations: readonly WorkspaceRelationRecord[]): void {
  const filePath = workspaceRelationsPath(cfg);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(relations, null, 2)}\n`, "utf8");
}

function workspaceRelationsPath(cfg: ServerConfig): string {
  return path.join(cfg.sourceVaultRoot, WORKSPACE_RELATIONS_FILE);
}

function relationId(sourceId: string, targetId: string, type: WorkspaceRelationType): string {
  const hash = createHash("sha1").update(`${sourceId}\0${targetId}\0${type}`).digest("hex").slice(0, 16);
  return `rel_${hash}`;
}

function normalizeRelationType(value: string): WorkspaceRelationType | null {
  const type = value.trim();
  return RELATION_TYPES.some((item) => item.value === type) ? type as WorkspaceRelationType : null;
}

function isWorkspaceRelationRecord(value: unknown): value is WorkspaceRelationRecord {
  const record = value && typeof value === "object" ? value as Partial<WorkspaceRelationRecord> : null;
  return Boolean(
    record
      && typeof record.id === "string"
      && typeof record.sourceId === "string"
      && typeof record.targetId === "string"
      && normalizeRelationType(String(record.type)) !== null,
  );
}
