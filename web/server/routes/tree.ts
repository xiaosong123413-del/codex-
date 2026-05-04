/**
 * File-tree route for the WebUI sidebar and wiki reader.
 *
 * The tree includes lightweight file metadata so callers can build lists like
 * "recently updated" without rendering each Markdown page separately.
 */
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { runtimePath, sourcePath } from "../runtime-paths.js";

interface TreeRoot {
  rel: string;
  dir: string;
}

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  modifiedAt?: string;
  children?: TreeNode[];
}

type TreeLayer = "wiki" | "raw";
type TreeWatcher = fs.FSWatcher & { unref?: () => void };

const treeCache = new Map<string, TreeNode>();
const treeWatchers = new Map<string, TreeWatcher[]>();
const RETIRED_WIKI_DIRS = new Set([
  "wiki/episodes",
  "wiki/专题",
  "wiki/个人信息档案/案例库",
  "wiki/个人信息档案/资源库",
  "wiki/个人信息档案/资料验证记录",
  "wiki/个人信息档案/方法库",
  "wiki/个人信息档案/当前执行记录器.md",
]);

export function buildTree(cfg: ServerConfig, layer: TreeLayer = "wiki", q = ""): TreeNode {
  const roots = getTreeRoots(cfg, layer);

  const query = q.trim().toLowerCase();
  const rootNode: TreeNode = {
    name: layer,
    path: layer,
    kind: "dir",
    children: [],
  };

  for (const root of roots) {
    if (!fs.existsSync(root.dir)) {
      if (root.rel === layer) {
        rootNode.children!.push({ name: root.rel, path: root.rel, kind: "dir", children: [] });
      }
      continue;
    }

    const child = walk(root.dir, root.rel, query);
    if (child) {
      rootNode.children!.push(child);
    }
  }

  return rootNode;
}

export function clearTreeCache(): void {
  treeCache.clear();
  for (const watchers of treeWatchers.values()) {
    for (const watcher of watchers) {
      watcher.close();
    }
  }
  treeWatchers.clear();
}

function readCachedTree(cfg: ServerConfig, layer: TreeLayer, q: string): TreeNode {
  const cacheKey = getTreeCacheKey(cfg, layer, q);
  const cached = treeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const tree = buildTree(cfg, layer, q);
  if (ensureTreeCacheInvalidation(cfg, layer)) {
    treeCache.set(cacheKey, tree);
  }
  return tree;
}

function getTreeRoots(cfg: ServerConfig, layer: TreeLayer): TreeRoot[] {
  return layer === "raw"
    ? [
        { rel: "raw", dir: sourcePath(cfg, "raw") },
        { rel: "inbox", dir: sourcePath(cfg, "inbox") },
        { rel: "sources", dir: runtimePath(cfg, "sources") },
        { rel: "sources_full", dir: runtimePath(cfg, "sources_full") },
      ]
    : [
        { rel: "wiki", dir: sourcePath(cfg, "wiki") },
        { rel: "领域", dir: sourcePath(cfg, "领域") },
      ];
}

function ensureTreeCacheInvalidation(cfg: ServerConfig, layer: TreeLayer): boolean {
  const prefix = getTreeCachePrefix(cfg, layer);
  if (treeWatchers.has(prefix)) {
    return true;
  }

  const watchedRoots = getTreeRoots(cfg, layer).filter((root) => isDirectory(root.dir));
  if (watchedRoots.length === 0) {
    return false;
  }

  const watchers: TreeWatcher[] = [];
  try {
    for (const root of watchedRoots) {
      const watcher = fs.watch(root.dir, { recursive: true }, () => {
        clearTreeCachePrefix(prefix);
      }) as TreeWatcher;
      watcher.on("error", () => clearTreeCachePrefix(prefix));
      watcher.unref?.();
      watchers.push(watcher);
    }
  } catch {
    for (const watcher of watchers) {
      watcher.close();
    }
    return false;
  }

  treeWatchers.set(prefix, watchers);
  return true;
}

function clearTreeCachePrefix(prefix: string): void {
  for (const key of treeCache.keys()) {
    if (key.startsWith(prefix)) {
      treeCache.delete(key);
    }
  }
}

function getTreeCacheKey(cfg: ServerConfig, layer: TreeLayer, q: string): string {
  return `${getTreeCachePrefix(cfg, layer)}${q.trim().toLowerCase()}`;
}

function getTreeCachePrefix(cfg: ServerConfig, layer: TreeLayer): string {
  return `${path.resolve(cfg.sourceVaultRoot)}\0${path.resolve(cfg.runtimeRoot)}\0${layer}\0`;
}

function walk(dir: string, rel: string, query: string): TreeNode | null {
  const children: TreeNode[] = [];
  for (const entry of listVisibleEntries(dir)) {
    const child = buildTreeChild(dir, rel, query, entry);
    if (child) {
      children.push(child);
    }
  }

  if (query && children.length === 0 && !matchesTreeQuery(path.basename(dir), rel, query)) {
    return null;
  }

  return { name: path.basename(dir), path: rel, kind: "dir", children };
}

function isBrowsableFile(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}

function listVisibleEntries(dir: string): fs.Dirent[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== "_\u5df2\u5f55\u5165")
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function buildTreeChild(dir: string, rel: string, query: string, entry: fs.Dirent): TreeNode | null {
  const fullPath = path.join(dir, entry.name);
  const nodeRel = path.posix.join(rel, entry.name);
  if (isRetiredWikiPath(nodeRel)) {
    return null;
  }
  if (entry.isDirectory()) {
    return walk(fullPath, nodeRel, query);
  }
  if (!isBrowsableFile(entry.name)) {
    return null;
  }
  const displayName = stripBrowsableExtension(entry.name);
  if (!matchesTreeQuery(displayName, nodeRel, query)) {
    return null;
  }
  return {
    name: displayName,
    path: nodeRel,
    kind: "file",
    modifiedAt: fs.statSync(fullPath).mtime.toISOString(),
  };
}

function stripBrowsableExtension(name: string): string {
  return name.replace(/\.(md|markdown|txt)$/i, "");
}

function matchesTreeQuery(name: string, nodeRel: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return name.toLowerCase().includes(query) || nodeRel.toLowerCase().includes(query);
}

function isRetiredWikiPath(nodeRel: string): boolean {
  return RETIRED_WIKI_DIRS.has(nodeRel.replace(/\\/g, "/").toLowerCase());
}

export function handleTree(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const layer = ((req.query.layer as string | undefined) ?? "wiki").toLowerCase() === "raw"
      ? "raw"
      : "wiki";
    const q = (req.query.q as string | undefined) ?? "";
    res.json(readCachedTree(cfg, layer, q));
  };
}
