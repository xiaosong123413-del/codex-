// @vitest-environment jsdom
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTree, clearTreeCache, handleTree } from "../web/server/routes/tree.js";
import { renderTree, type TreeNode } from "../web/client/tree.js";

const tempRoots: string[] = [];

const sampleTree: TreeNode = {
  name: "wiki",
  path: "wiki",
  kind: "dir",
  children: [
    {
      name: "concepts",
      path: "wiki/concepts",
      kind: "dir",
      children: [
        {
          name: "example.md",
          path: "wiki/concepts/example.md",
          kind: "file",
        },
      ],
    },
  ],
};

describe("renderTree", () => {
  beforeEach(() => {
    document.body.innerHTML = '<nav id="tree"></nav>';
  });

  it("renders directory toggles and highlights the active file", () => {
    const container = document.getElementById("tree") as HTMLElement;

    renderTree(container, sampleTree, vi.fn(), "wiki/concepts/example.md");

    expect(container.querySelector('[data-dir-path="wiki/concepts"]')).toBeTruthy();
    expect(container.querySelector<HTMLAnchorElement>('a[data-path="wiki/concepts/example.md"]')?.classList.contains("active")).toBe(true);
  });

  it("collapses and expands a directory when its toggle is clicked", () => {
    const container = document.getElementById("tree") as HTMLElement;

    renderTree(container, sampleTree, vi.fn(), "wiki/concepts/example.md");

    const toggle = container.querySelector<HTMLButtonElement>('[data-dir-path="wiki/concepts"]')!;
    const branch = container.querySelector<HTMLElement>('[data-branch-path="wiki/concepts"]')!;

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(branch.hidden).toBe(true);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(branch.hidden).toBe(false);
  });

  it("renders selectable file rows in multi-select mode and toggles selection", () => {
    const container = document.getElementById("tree") as HTMLElement;
    const onSelect = vi.fn();
    const onToggleSelect = vi.fn();

    renderTree(container, sampleTree, onSelect, {
      activePath: "wiki/concepts/example.md",
      multiSelectEnabled: true,
      selectedPaths: ["wiki/concepts/example.md"],
      onToggleSelect,
    });

    const checkbox = container.querySelector<HTMLInputElement>('input[data-select-path="wiki/concepts/example.md"]');
    const row = container.querySelector<HTMLElement>('label[data-row-path="wiki/concepts/example.md"]');

    expect(checkbox?.checked).toBe(true);
    expect(row?.classList.contains("selected")).toBe(true);

    row?.click();

    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggleSelect).toHaveBeenCalledWith("wiki/concepts/example.md");
  });
});

describe("server wiki tree", () => {
  beforeEach(() => {
    clearTreeCache();
  });

  it("reads wiki content from the source vault root", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-runtime-"));
    tempRoots.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "wiki", "concepts"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "source.md"), "# Source", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "concepts", "runtime.md"), "# Runtime", "utf8");

    const tree = buildTree({
      sourceVaultRoot,
      runtimeRoot,
      projectRoot: runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("wiki/concepts/source.md");
    expect(serialized).not.toContain("wiki/concepts/runtime.md");
    expect(serialized).toContain("modifiedAt");
  });

  it("hides retired episode pages from the wiki tree", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-retired-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-retired-runtime-"));
    tempRoots.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "episodes"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "source.md"), "# Source", "utf8");
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "episodes", "old.md"), "# Old Episode", "utf8");

    const tree = buildTree({
      sourceVaultRoot,
      runtimeRoot,
      projectRoot: runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("wiki/concepts/source.md");
    expect(serialized).not.toContain("wiki/episodes");
  });

  it("keeps matching parent directories when filtering by query", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-query-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-query-runtime-"));
    tempRoots.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "source.md"), "# Source", "utf8");
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "other.md"), "# Other", "utf8");

    const tree = buildTree({
      sourceVaultRoot,
      runtimeRoot,
      projectRoot: runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    }, "wiki", "source");

    expect(tree.children).toEqual([
      expect.objectContaining({
        name: "wiki",
        children: [
          expect.objectContaining({
            name: "concepts",
            children: [
              expect.objectContaining({ path: "wiki/concepts/source.md", kind: "file" }),
            ],
          }),
        ],
      }),
    ]);
  });

  it("includes workspace record pages in the wiki tree without treating them as compile sources", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-workspace-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-workspace-runtime-"));
    tempRoots.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.mkdirSync(path.join(sourceVaultRoot, "领域", "产品", "LLM Wiki WebUI"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "source.md"), "# Source", "utf8");
    fs.writeFileSync(path.join(sourceVaultRoot, "领域", "产品", "LLM Wiki WebUI", "工作日志.md"), "# 工作日志", "utf8");

    const tree = buildTree({
      sourceVaultRoot,
      runtimeRoot,
      projectRoot: runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("wiki/concepts/source.md");
    expect(serialized).toContain("领域/产品/LLM Wiki WebUI/工作日志.md");
  });

  it("hides execution-topic folders from the normal wiki tree", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-topic-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-topic-runtime-"));
    tempRoots.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "专题", "案例库"), { recursive: true });
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "个人信息档案", "案例库"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "专题", "案例库", "index.md"), "# 案例库", "utf8");
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "个人信息档案", "案例库", "旧案例.md"), "# 旧案例", "utf8");

    const tree = buildTree({
      sourceVaultRoot,
      runtimeRoot,
      projectRoot: runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const serialized = JSON.stringify(tree);
    expect(serialized).not.toContain("wiki/专题");
    expect(serialized).not.toContain("wiki/个人信息档案/案例库");
  });

  it("caches route responses until the tree cache is cleared", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-cache-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-tree-cache-runtime-"));
    tempRoots.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "source.md"), "# Source", "utf8");

    const route = handleTree({
      sourceVaultRoot,
      runtimeRoot,
      projectRoot: runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });
    const req = { query: {} } as Request;
    const res = { json: vi.fn() } as unknown as Response;
    const readdirSpy = vi.spyOn(fs, "readdirSync");

    route(req, res);
    const firstReadCount = readdirSpy.mock.calls.length;
    route(req, res);

    expect(readdirSpy.mock.calls.length).toBe(firstReadCount);

    clearTreeCache();
    route(req, res);

    expect(readdirSpy.mock.calls.length).toBeGreaterThan(firstReadCount);
  });
});

afterEach(() => {
  clearTreeCache();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
