/**
 * Workflow artifact read model and scaffold helpers.
 *
 * Runtime JSON files are the working queues for workflow events and candidates.
 * Wiki folders are the long-term destinations where execution records, cases,
 * reusable methods, and tool evidence can later be promoted.
 */
import fs from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { ServerConfig } from "../config.js";
import { readWorkflowEvents, readWorkflowInbox } from "./workflow-recorder.js";

const RUNTIME_FILES = [
  "workflow-events.json",
  "workflow-resource-candidates.json",
  "workflow-validation-candidates.json",
  "workflow-method-candidates.json",
] as const;

const WIKI_FOLDERS = [
  { path: path.join("wiki", "专题", "00-执行现场"), title: "00-执行现场" },
  { path: path.join("wiki", "专题", "01-案例库"), title: "01-案例库" },
  { path: path.join("wiki", "专题", "02-方法库"), title: "02-方法库" },
  { path: path.join("wiki", "专题", "03-工具箱"), title: "03-工具箱" },
] as const;

interface WorkflowArtifactFolder {
  kind: "folder";
  title: string;
  path: string;
  indexPath: string;
  exists: boolean;
}

interface WorkflowArtifactRuntimeFile {
  kind: "runtime-file";
  title: string;
  path: string;
  count: number;
}

interface WorkflowArtifactsSnapshot {
  folders: WorkflowArtifactFolder[];
  runtimeFiles: WorkflowArtifactRuntimeFile[];
  events: unknown[];
  pendingConfirm: unknown[];
  pendingArchive: unknown[];
  resources: unknown[];
  validations: unknown[];
  methods: unknown[];
}

export async function readWorkflowArtifactsSnapshot(cfg: ServerConfig): Promise<WorkflowArtifactsSnapshot> {
  await ensureWorkflowArtifactScaffold(cfg);
  const inbox = readWorkflowInbox(cfg.runtimeRoot);
  return {
    folders: readWorkflowArtifactFolders(cfg),
    runtimeFiles: readRuntimeFileSummaries(cfg),
    events: readWorkflowEvents(cfg.runtimeRoot),
    pendingConfirm: inbox.filter((record) => record.confidence === "medium"),
    pendingArchive: inbox.filter((record) => record.confidence !== "medium"),
    resources: readRuntimeJson(cfg.runtimeRoot, "workflow-resource-candidates.json"),
    validations: readRuntimeJson(cfg.runtimeRoot, "workflow-validation-candidates.json"),
    methods: readRuntimeJson(cfg.runtimeRoot, "workflow-method-candidates.json"),
  };
}

async function ensureWorkflowArtifactScaffold(cfg: ServerConfig): Promise<void> {
  await mkdir(path.join(cfg.runtimeRoot, ".llmwiki"), { recursive: true });
  await Promise.all([
    ...RUNTIME_FILES.map((fileName) => ensureRuntimeJson(cfg.runtimeRoot, fileName)),
    ...WIKI_FOLDERS.map((folder) => ensureWikiFolder(cfg.sourceVaultRoot, folder.path, folder.title)),
  ]);
}

async function ensureRuntimeJson(runtimeRoot: string, fileName: string): Promise<void> {
  const filePath = path.join(runtimeRoot, ".llmwiki", fileName);
  if (fs.existsSync(filePath)) return;
  await writeFile(filePath, "[]\n", "utf8");
}

async function ensureWikiFolder(sourceVaultRoot: string, folderPath: string, title: string): Promise<void> {
  const fullDir = path.join(sourceVaultRoot, folderPath);
  const indexPath = path.join(fullDir, "index.md");
  await mkdir(fullDir, { recursive: true });
  if (fs.existsSync(indexPath)) return;
  await writeFile(indexPath, `${renderFolderIndex(title)}\n`, "utf8");
}

function renderFolderIndex(title: string): string {
  return [
    `# ${title}`,
    "",
    `这里存放从行动记录、任务卡和 Workflow Event 中沉淀出的${title}。`,
    "",
    "| 条目 | 状态 | 来源 |",
    "|---|---|---|",
    "| 待补充 | 待整理 | Workflow Event |",
  ].join("\n");
}

function readWorkflowArtifactFolders(cfg: ServerConfig): WorkflowArtifactFolder[] {
  return WIKI_FOLDERS.map((folder) => {
    const indexPath = path.join(folder.path, "index.md").replace(/\\/g, "/");
    return {
      kind: "folder",
      title: folder.title,
      path: folder.path.replace(/\\/g, "/"),
      indexPath,
      exists: fs.existsSync(path.join(cfg.sourceVaultRoot, indexPath)),
    };
  });
}

function readRuntimeFileSummaries(cfg: ServerConfig): WorkflowArtifactRuntimeFile[] {
  return RUNTIME_FILES.map((fileName) => ({
    kind: "runtime-file",
    title: runtimeTitle(fileName),
    path: `.llmwiki/${fileName}`,
    count: readRuntimeJson(cfg.runtimeRoot, fileName).length,
  }));
}

function runtimeTitle(fileName: string): string {
  if (fileName.includes("resource")) return "资源与工具候选";
  if (fileName.includes("validation")) return "资料验证候选";
  if (fileName.includes("method")) return "方法候选";
  return "Workflow Event 事件池";
}

function readRuntimeJson(runtimeRoot: string, fileName: string): unknown[] {
  const filePath = path.join(runtimeRoot, ".llmwiki", fileName);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
