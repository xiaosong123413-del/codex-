import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";

type XiaohongshuImportStatus = "idle" | "queued" | "importing" | "success" | "error";
type XiaohongshuImportFetcher = (url: string, init: RequestInit) => Promise<Response>;

interface XiaohongshuImportTask {
  id: string;
  progress: number;
  status: XiaohongshuImportStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}

interface XiaohongshuImportProgress {
  taskId: string | null;
  progress: number;
  status: XiaohongshuImportStatus;
  message: string;
  hasCookie: boolean;
  importDirPath: string;
}

export interface XiaohongshuImportOptions {
  fetcher?: XiaohongshuImportFetcher;
  now?: Date;
  wikiRoot?: string;
  runInline?: boolean;
}

interface XiaohongshuImportConfig {
  importDirPath: string;
}

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameParty: boolean;
  sourceScheme: string;
  sourcePort: number;
}

const STATE_DIR = ".llmwiki";
const TASK_FILE = "xiaohongshu-import-task.json";
const COOKIE_METADATA_FILE = "xiaohongshu-cookie-meta.json";
const CONFIG_FILE = "xiaohongshu-import-config.json";
const HOME_COOKIE_FILE = "cookies.json";

export async function saveXiaohongshuCookie(projectRoot: string, cookie: string, now: Date = new Date()): Promise<void> {
  const normalized = parseCookieString(cookie);
  const metadataPath = path.join(projectRoot, STATE_DIR, COOKIE_METADATA_FILE);
  const homeCookiePath = resolveCookieFilePath();
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(homeCookiePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await writeFile(metadataPath, `${JSON.stringify({
    updatedAt: now.toISOString(),
    count: normalized.length,
    path: homeCookiePath,
  }, null, 2)}\n`, "utf8");
}

export function readXiaohongshuImportConfig(projectRoot: string): XiaohongshuImportConfig {
  const raw = readJson(configPath(projectRoot));
  if (!isRecord(raw)) {
    return { importDirPath: "" };
  }
  return {
    importDirPath: stringField(raw.importDirPath),
  };
}

export async function saveXiaohongshuImportConfig(projectRoot: string, importDirPath: string): Promise<XiaohongshuImportConfig> {
  const normalized = path.resolve(importDirPath.trim());
  if (!normalized) {
    throw new Error("导入文件夹地址不能为空");
  }
  await mkdir(normalized, { recursive: true });
  const config: XiaohongshuImportConfig = { importDirPath: normalized };
  const file = configPath(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export async function clearXiaohongshuImportConfig(projectRoot: string): Promise<void> {
  const file = configPath(projectRoot);
  if (!fs.existsSync(file)) {
    return;
  }
  await fs.promises.rm(file, { force: true });
}

export async function startXiaohongshuImport(projectRoot: string, options: XiaohongshuImportOptions = {}): Promise<XiaohongshuImportTask> {
  const createdAt = (options.now ?? new Date()).toISOString();
  if (!hasSavedCookie(projectRoot)) {
    throw new Error("请先保存小红书 Cookie");
  }
  const task: XiaohongshuImportTask = {
    id: crypto.createHash("sha1").update(`xiaohongshu-import:${createdAt}`).digest("hex").slice(0, 16),
    progress: 0,
    status: "queued",
    message: "导入任务已创建",
    createdAt,
    updatedAt: createdAt,
  };
  await writeTask(projectRoot, task);
  // fallow-ignore-next-line complexity
  const job = async () => {
    await updateTask(projectRoot, task.id, {
      progress: 20,
      status: "queued",
      message: "正在准备导入环境",
    });
    try {
      await updateTask(projectRoot, task.id, {
        progress: 45,
        status: "importing",
        message: "正在校验小红书 Cookie",
      });
      await verifyCookie(projectRoot, options.fetcher ?? fetch);
      const importConfig = readXiaohongshuImportConfig(projectRoot);
      const importDirPath = importConfig.importDirPath;
      if (importDirPath) {
        await mkdir(importDirPath, { recursive: true });
      }
      const existingCount = importDirPath
        ? countMarkdownFilesInDir(importDirPath)
        : countSavedXiaohongshuNotes(options.wikiRoot);
      await updateTask(projectRoot, task.id, {
        progress: 75,
        status: "importing",
        message: existingCount > 0
          ? `Cookie 校验通过，正在同步导入环境（已检测到 ${existingCount} 条已保存内容）`
          : "Cookie 校验通过，正在同步导入环境",
      });
      await updateTask(projectRoot, task.id, {
        progress: 100,
        status: "success",
        message: existingCount > 0
          ? `导入环境已就绪，当前目录已有 ${existingCount} 条小红书内容${importDirPath ? `：${importDirPath}` : ""}`
          : `导入环境已就绪，可以开始小红书导入${importDirPath ? `：${importDirPath}` : ""}`,
      });
    } catch (error) {
      await updateTask(projectRoot, task.id, {
        progress: 0,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  if (options.runInline) {
    await job();
  } else {
    queueMicrotask(() => {
      void job();
    });
  }
  return task;
}

export function getXiaohongshuImportProgress(projectRoot: string, taskId?: string): XiaohongshuImportProgress {
  const task = readTask(projectRoot);
  const matches = !taskId || task?.id === taskId;
  const config = readXiaohongshuImportConfig(projectRoot);
  return {
    taskId: matches ? task?.id ?? null : null,
    progress: matches ? task?.progress ?? 0 : 0,
    status: matches ? task?.status ?? "idle" : "idle",
    message: matches ? task?.message ?? "未开始" : "未开始",
    hasCookie: hasSavedCookie(projectRoot),
    importDirPath: config.importDirPath,
  };
}

function parseCookieString(cookie: string): CookieEntry[] {
  const segments = cookie
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const pairs = segments.flatMap((segment) => {
    const separator = segment.indexOf("=");
    if (separator <= 0) return [];
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    return name && value ? [{ name, value }] : [];
  });
  if (pairs.length === 0) {
    throw new Error("Cookie 不能为空，且需要是 name=value; name2=value2 的格式");
  }
  const expires = Math.floor(Date.now() / 1000) + 86400 * 30;
  return pairs.map((pair) => ({
    name: pair.name,
    value: pair.value,
    domain: ".xiaohongshu.com",
    path: "/",
    expires,
    size: pair.name.length + pair.value.length,
    httpOnly: false,
    secure: true,
    session: false,
    sameParty: false,
    sourceScheme: "Secure",
    sourcePort: 443,
  }));
}

function hasSavedCookie(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, STATE_DIR, COOKIE_METADATA_FILE))
    && fs.existsSync(resolveCookieFilePath());
}

async function verifyCookie(projectRoot: string, fetcher: XiaohongshuImportFetcher): Promise<void> {
  const cookieHeader = readCookieHeader(resolveCookieFilePath());
  const response = await fetcher("https://www.xiaohongshu.com/explore", {
    headers: {
      Cookie: cookieHeader,
      Referer: "https://www.xiaohongshu.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Cookie 校验失败：${response.status}`);
  }
  const html = await response.text();
  if (!html.includes("window.__INITIAL_STATE__")) {
    throw new Error("Cookie 可能已失效，未能读取到小红书页面状态");
  }
  const metadataPath = path.join(projectRoot, STATE_DIR, COOKIE_METADATA_FILE);
  const previous = readJson(metadataPath);
  await writeFile(metadataPath, `${JSON.stringify({
    ...(isRecord(previous) ? previous : {}),
    verifiedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
}

function resolveCookieFilePath(): string {
  const override = process.env.LLM_WIKI_XHS_COOKIE_PATH?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), HOME_COOKIE_FILE);
}

function countSavedXiaohongshuNotes(basePath?: string): number {
  if (!basePath) return 0;
  const root = path.join(basePath, "raw", "剪藏", "小红书");
  if (!fs.existsSync(root)) return 0;
  return listMarkdownFilesRecursive(root).length;
}

function countMarkdownFilesInDir(root: string): number {
  if (!fs.existsSync(root)) return 0;
  return listMarkdownFilesRecursive(root).length;
}

function readCookieHeader(cookiePath: string): string {
  if (!fs.existsSync(cookiePath)) {
    throw new Error("未找到已保存的小红书 Cookie");
  }
  const raw = JSON.parse(fs.readFileSync(cookiePath, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("本地 cookies.json 格式无效");
  }
  const cookiePairs = raw
    .map((item) => isRecord(item) ? `${stringField(item.name)}=${stringField(item.value)}` : "")
    .filter((item) => item !== "=" && item !== "");
  if (cookiePairs.length === 0) {
    throw new Error("本地 cookies.json 中没有有效 Cookie");
  }
  return cookiePairs.join("; ");
}

function readTask(projectRoot: string): XiaohongshuImportTask | null {
  const file = taskPath(projectRoot);
  const raw = readJson(file);
  if (!isRecord(raw)) return null;
  const id = stringField(raw.id);
  if (!id) return null;
  return {
    id,
    progress: numberField(raw.progress),
    status: isStatus(raw.status) ? raw.status : "idle",
    message: stringField(raw.message) || "未开始",
    createdAt: stringField(raw.createdAt),
    updatedAt: stringField(raw.updatedAt),
  };
}

async function updateTask(projectRoot: string, taskId: string, patch: Partial<XiaohongshuImportTask>): Promise<void> {
  const current = readTask(projectRoot);
  if (!current || current.id !== taskId) return;
  await writeTask(projectRoot, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

async function writeTask(projectRoot: string, task: XiaohongshuImportTask): Promise<void> {
  const file = taskPath(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

function taskPath(projectRoot: string): string {
  return path.join(projectRoot, STATE_DIR, TASK_FILE);
}

function configPath(projectRoot: string): string {
  return path.join(projectRoot, STATE_DIR, CONFIG_FILE);
}

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isStatus(value: unknown): value is XiaohongshuImportStatus {
  return value === "idle" || value === "queued" || value === "importing" || value === "success" || value === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
