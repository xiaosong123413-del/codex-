import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleWorkspaceDocs,
  handleWorkspaceDocsDelete,
  handleWorkspaceDocsSave,
  handleWorkspaceDocsStatusMove,
} from "../web/server/routes/pages.js";
import { handleWorkspaceGraph } from "../web/server/routes/workspace-graph.js";
import {
  handleWorkspaceRelationCreate,
  handleWorkspaceRelationDelete,
  handleWorkspaceRelations,
} from "../web/server/routes/workspace-relations.js";
import { readTaskPlanState, writeTaskPlanState } from "../web/server/services/task-plan-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("workspace docs route", () => {
  it("creates and returns the default domain document scaffold", async () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-runtime-"));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-project-"));
    tempDirs.push(sourceVaultRoot, runtimeRoot, projectRoot);
    const json = vi.fn();
    const handler = handleWorkspaceDocs(makeServerConfig(sourceVaultRoot, runtimeRoot, projectRoot));

    await handler({} as never, { json } as never);

    expect(fs.existsSync(path.join(sourceVaultRoot, "领域.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "领域", "产品.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "领域", "产品", "LLM Wiki WebUI.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "领域", "产品", "LLM Wiki WebUI", "工作日志.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "专题", "00-执行现场", "今日行动.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "专题", "01-案例库", "示例-信息消费失控案例.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "专题", "02-方法库", "待验证", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "专题", "03-工具箱", "待验证", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "专题", "03-归档", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "专题", "03-归档", "失败的方法", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourceVaultRoot, "wiki", "专题", "03-归档", "已完成领域、项目、任务", "index.md"))).toBe(true);
    expect(fs.readFileSync(path.join(sourceVaultRoot, "wiki", "专题", "index.md"), "utf8")).toContain("AI 维护工作日志的操作规范");
    expect(fs.existsSync(path.join(projectRoot, "领域.md"))).toBe(false);
    expect(readSearchIndexPaths(runtimeRoot)).toContain("领域/产品/LLM Wiki WebUI/工作日志.md");
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        documents: expect.arrayContaining([
          expect.objectContaining({
            kind: "root",
            path: "wiki/专题/index.md",
            label: "工作日志",
            html: expect.stringContaining("<h1"),
            sourceEditable: true,
          }),
          expect.objectContaining({
            kind: "domain",
            path: "wiki/专题/00-执行现场/index.md",
            label: "00-执行现场",
          }),
          expect.objectContaining({
            kind: "domain",
            path: "wiki/专题/01-项目工作区/index.md",
            label: "01-项目工作区",
          }),
          expect.objectContaining({
            kind: "project",
            path: "领域/产品.md",
            label: "产品",
          }),
          expect.objectContaining({
            kind: "work-log",
            path: "领域/产品/LLM Wiki WebUI.md",
          }),
          expect.objectContaining({
            kind: "work-log",
            path: "领域/产品/LLM Wiki WebUI/工作日志.md",
          }),
          expect.objectContaining({
            kind: "domain",
            path: "wiki/专题/02-沉淀库/index.md",
            label: "02-沉淀库",
          }),
          expect.objectContaining({
            kind: "domain",
            path: "wiki/专题/01-案例库/index.md",
            label: "01-案例库",
          }),
          expect.objectContaining({
            kind: "work-log",
            path: "wiki/专题/01-案例库/示例-信息消费失控案例.md",
            label: "示例-信息消费失控案例",
          }),
          expect.objectContaining({
            kind: "domain",
            path: "wiki/专题/03-归档/index.md",
            label: "03-归档",
          }),
        ]),
      },
    });
    const payload = json.mock.calls[0]?.[0] as { data: { documents: Array<{ path?: string }> } };
    expect(payload.data.documents.map((document) => document.path)).not.toContain("wiki/专题/00-执行现场/待归档记录.md");
    expect(payload.data.documents.map((document) => document.path)).not.toContain("wiki/专题/02-方法库/index.md");
    expect(payload.data.documents.map((document) => document.path)).not.toContain("wiki/专题/02-方法库/待验证/index.md");
    expect(payload.data.documents.map((document) => document.path)).not.toContain("wiki/专题/03-工具箱/index.md");
  });

  it("migrates the old workspace topic placeholder into the AI maintenance guide", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-guide-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-guide-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "wiki", "专题"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "wiki", "专题", "index.md"),
      "# 专题\n\n这些页面只在工作日志页展示，用来承接执行记录沉淀出的案例、资源、资料验证和方法。\n",
      "utf8",
    );
    const json = vi.fn();
    const handler = handleWorkspaceDocs(makeServerConfig(root, runtimeRoot, runtimeRoot));

    await handler({} as never, { json } as never);

    const content = fs.readFileSync(path.join(root, "wiki", "专题", "index.md"), "utf8");
    expect(content).toContain("# 工作日志维护指南");
    expect(content).toContain("主事实源");
    expect(content).toContain("新增沉淀是否已经补齐双链");
  });

  it("renders existing markdown documents in hierarchy order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-existing-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-existing-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "领域", "产品", "LLM Wiki WebUI"), { recursive: true });
    fs.writeFileSync(path.join(root, "领域.md"), "# 领域\n\n总览。\n", "utf8");
    fs.writeFileSync(path.join(root, "领域", "产品.md"), "# 产品\n\n领域说明。\n", "utf8");
    fs.writeFileSync(path.join(root, "领域", "产品", "LLM Wiki WebUI.md"), "# LLM Wiki WebUI\n\n项目文档。\n", "utf8");
    fs.writeFileSync(
      path.join(root, "领域", "产品", "LLM Wiki WebUI", "工作日志.md"),
      "# 工作日志\n\n- 完成工作日志文档视图\n",
      "utf8",
    );
    const json = vi.fn();
    const handler = handleWorkspaceDocs(makeServerConfig(root, runtimeRoot, runtimeRoot));

    await handler({} as never, { json } as never);

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        documents: expect.arrayContaining([
          expect.objectContaining({
            kind: "root",
            path: "wiki/专题/index.md",
          }),
          expect.objectContaining({
            kind: "project",
            path: "领域/产品.md",
          }),
          expect.objectContaining({
            kind: "work-log",
            path: "领域/产品/LLM Wiki WebUI.md",
          }),
          expect.objectContaining({
            kind: "work-log",
            path: "领域/产品/LLM Wiki WebUI/工作日志.md",
            html: expect.stringContaining("完成工作日志文档视图"),
            sourceEditable: true,
          }),
        ]),
      },
    });
  });

  it("saves edited workspace markdown back to the selected file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-save-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-save-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "领域", "产品", "LLM Wiki WebUI"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "领域", "产品", "LLM Wiki WebUI", "工作日志.md"),
      "# 工作日志\n\n旧内容\n",
      "utf8",
    );
    const json = vi.fn();
    const status = vi.fn().mockReturnThis();
    const handler = handleWorkspaceDocsSave(makeServerConfig(root, runtimeRoot, runtimeRoot));

    await handler(
      {
        body: {
          path: "领域/产品/LLM Wiki WebUI/工作日志.md",
          raw: "# 工作日志\n\n新内容\n",
        },
      } as never,
      { json, status } as never,
    );

    expect(fs.readFileSync(path.join(root, "领域", "产品", "LLM Wiki WebUI", "工作日志.md"), "utf8")).toContain(
      "新内容",
    );
    expect(JSON.stringify(readSearchIndex(runtimeRoot))).toContain("新内容");
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it("allows topic placeholder pages to be edited from the work-log page", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-topic-save-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-topic-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "wiki", "专题", "01-案例库"), { recursive: true });
    fs.writeFileSync(path.join(root, "wiki", "专题", "01-案例库", "index.md"), "# 案例库\n", "utf8");
    const json = vi.fn();
    const status = vi.fn().mockReturnThis();
    const handler = handleWorkspaceDocsSave(makeServerConfig(root, runtimeRoot, runtimeRoot));

    await handler(
      {
        body: {
          path: "wiki/专题/01-案例库/index.md",
          raw: "# 案例库\n\n占位页已更新\n",
        },
      } as never,
      { json, status } as never,
    );

    expect(fs.readFileSync(path.join(root, "wiki", "专题", "01-案例库", "index.md"), "utf8")).toContain("占位页已更新");
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it("keeps work-log task pages synced with the task pool", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-task-sync-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-task-sync-runtime-"));
    tempDirs.push(root, runtimeRoot);
    const taskPlanOptions = { storageRoot: path.join(root, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [{
      id: "task-sync-1",
      title: "旧任务名",
      priority: "high",
      source: "手动新增",
      domain: "产品功能",
      project: "个人App开发",
    }];
    await writeTaskPlanState(state, taskPlanOptions);
    const json = vi.fn();
    const cfg = makeServerConfig(root, runtimeRoot, runtimeRoot);

    await handleWorkspaceDocs(cfg)({ query: { mode: "tree" } } as never, { json } as never);

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        documents: expect.arrayContaining([
          expect.objectContaining({
            kind: "project",
            label: "个人App开发",
            path: "wiki/专题/01-项目工作区/projects/%E4%B8%AA%E4%BA%BAApp%E5%BC%80%E5%8F%91/index.md".replace(/%/g, "~"),
          }),
          expect.objectContaining({
            kind: "work-log",
            label: "旧任务名",
            path: "wiki/专题/01-项目工作区/tasks/task-sync-1.md",
            raw: expect.stringContaining("项目：个人App开发"),
            html: "",
          }),
        ]),
      },
    });
    const pageJson = vi.fn();
    await handleWorkspaceDocs(cfg)({
      query: { path: "wiki/专题/01-项目工作区/tasks/task-sync-1.md" },
    } as never, { json: pageJson } as never);
    expect(pageJson).toHaveBeenCalledWith({
      success: true,
      data: {
        document: expect.objectContaining({
          path: "wiki/专题/01-项目工作区/tasks/task-sync-1.md",
          html: expect.stringContaining("旧任务名"),
          contentLoaded: true,
        }),
      },
    });

    await handleWorkspaceDocsSave(cfg)({
      body: {
        path: "wiki/专题/01-项目工作区/tasks/task-sync-1.md",
        raw: "# 新任务名\n\n项目：个人知识库\n领域：知识管理\n优先级：中\n",
      },
    } as never, { json: vi.fn(), status: vi.fn().mockReturnThis() } as never);

    const updated = await readTaskPlanState(taskPlanOptions);
    expect(updated.pool.items[0]).toMatchObject({
      title: "新任务名",
      project: "个人知识库",
      domain: "知识管理",
      priority: "mid",
    });
  });

  it("adds failed methods and completed task cards to the archive branch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-archive-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-archive-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "wiki", "专题", "02-方法库", "已验证但失败"), { recursive: true });
    fs.writeFileSync(path.join(root, "wiki", "专题", "02-方法库", "已验证但失败", "失败方法.md"), "# 失败方法\n", "utf8");
    const taskPlanOptions = { storageRoot: path.join(root, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [{
      id: "task-done-1",
      title: "完成归档测试",
      priority: "mid",
      source: "手动新增",
      domain: "代码质量",
      project: "WebUI",
      completedAt: "2026-05-03T10:00:00.000Z",
    }];
    await writeTaskPlanState(state, taskPlanOptions);
    const json = vi.fn();

    await handleWorkspaceDocs(makeServerConfig(root, runtimeRoot, runtimeRoot))(
      { query: { mode: "tree" } } as never,
      { json } as never,
    );

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        documents: expect.arrayContaining([
          expect.objectContaining({ kind: "domain", label: "03-归档", title: "归档" }),
          expect.objectContaining({ kind: "project", label: "失败的方法", domain: "03-归档" }),
          expect.objectContaining({
            kind: "work-log",
            label: "失败方法",
            project: "失败的方法",
            path: "wiki/专题/03-归档/失败的方法/失败方法.md",
          }),
          expect.objectContaining({ kind: "project", label: "已完成领域、项目、任务", domain: "03-归档" }),
          expect.objectContaining({
            kind: "work-log",
            label: "完成归档测试",
            project: "已完成领域、项目、任务",
            path: "wiki/专题/03-归档/已完成领域、项目、任务/task-done-1.md",
          }),
        ]),
      },
    });
    expect(fs.readFileSync(path.join(root, "wiki", "专题", "03-归档", "失败的方法", "失败方法.md"), "utf8")).toContain("# 失败方法");
    expect(fs.readFileSync(path.join(root, "wiki", "专题", "03-归档", "已完成领域、项目、任务", "task-done-1.md"), "utf8")).toContain("# 完成归档测试");
  });

  it("keeps work-log toolbox asset pages synced with the workspace toolbox model", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-toolbox-sync-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-toolbox-sync-runtime-"));
    tempDirs.push(root, runtimeRoot);
    const cfg = makeServerConfig(root, runtimeRoot, root);
    const json = vi.fn();
    const figmaId = encodeURIComponent("legacy:工具箱/网站软件/Figma.md");
    const figmaPath = `wiki/专题/03-工具箱/待验证/${figmaId}.md`;

    await handleWorkspaceDocs(cfg)({ query: { mode: "tree" } } as never, { json } as never);

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        documents: expect.arrayContaining([
          expect.objectContaining({
            kind: "work-log",
            path: figmaPath,
            raw: expect.stringContaining("Figma"),
            html: "",
          }),
        ]),
      },
    });

    await handleWorkspaceDocsSave(cfg)({
      body: {
        path: figmaPath,
        raw: "# Figma Pro\n\n分类：网站软件\n摘要：快速完成界面设计和协作评审。\n链接：https://figma.com/pro\n标记：待验证\n",
      },
    } as never, { json: vi.fn(), status: vi.fn().mockReturnThis() } as never);

    const updated = fs.readFileSync(path.join(root, "工具箱", "网站软件", "Figma.md"), "utf8");
    expect(updated).toContain("# Figma Pro");
    expect(updated).toContain("快速完成界面设计和协作评审。");
    expect(updated).toContain("https://figma.com/pro");
  });

  it("moves deposit-library method cards between validation status folders", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-status-move-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-status-move-runtime-"));
    tempDirs.push(root, runtimeRoot);
    const sourcePath = path.join(root, "wiki", "专题", "02-方法库", "待验证", "方法候选.md");
    const targetPath = path.join(root, "wiki", "专题", "02-方法库", "已验证但成功", "方法候选.md");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "# 方法候选\n", "utf8");
    const json = vi.fn();

    await handleWorkspaceDocsStatusMove(makeServerConfig(root, runtimeRoot, runtimeRoot))({
      body: {
        path: "wiki/专题/02-方法库/待验证/方法候选.md",
        status: "已验证但成功",
      },
    } as never, { json, status: vi.fn().mockReturnThis() } as never);

    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.existsSync(targetPath)).toBe(true);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        previousPath: "wiki/专题/02-方法库/待验证/方法候选.md",
        path: "wiki/专题/02-方法库/已验证但成功/方法候选.md",
        status: "已验证但成功",
      },
    });
  });

  it("builds workspace graph backlinks from task pages to projects and methods", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-graph-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-graph-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "wiki", "专题", "02-方法库", "待验证"), { recursive: true });
    fs.writeFileSync(path.join(root, "wiki", "专题", "02-方法库", "待验证", "方法候选.md"), "# 方法候选\n", "utf8");
    const taskPlanOptions = { storageRoot: path.join(root, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [{
      id: "task-graph-1",
      title: "验证双链图谱",
      priority: "high",
      source: "手动新增",
      domain: "个人知识库",
      project: "Graphy 改造",
      linkedMethods: ["方法候选"],
      actions: [{ id: "action-link-method", title: "把方法候选连回任务", order: 0 }],
    }];
    await writeTaskPlanState(state, taskPlanOptions);
    const json = vi.fn();

    await handleWorkspaceGraph(makeServerConfig(root, runtimeRoot, runtimeRoot))({
      query: { nodeId: "work-log:01-项目工作区/task/task-graph-1" },
    } as never, { json } as never);

    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "work-log:01-项目工作区/task/task-graph-1", label: "验证双链图谱" }),
          expect.objectContaining({ label: "Graphy 改造", type: "project" }),
          expect.objectContaining({ label: "把方法候选连回任务", type: "action" }),
          expect.objectContaining({ label: "方法候选", type: "method" }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ label: "双链" }),
          expect.objectContaining({ label: "行动" }),
          expect.objectContaining({ label: "使用方法" }),
        ]),
      },
    });
  });

  it("edits workspace relations from either endpoint through one relation table", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-relations-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-relations-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "wiki", "专题", "02-方法库", "待验证"), { recursive: true });
    fs.writeFileSync(path.join(root, "wiki", "专题", "02-方法库", "待验证", "方法候选.md"), "# 方法候选\n", "utf8");
    const cfg = makeServerConfig(root, runtimeRoot, runtimeRoot);
    const sourceId = "work-log:01-项目工作区/task/task-relation-1";
    const targetId = "work-log:02-沉淀库/方法库/待验证/方法候选.md";
    const taskPlanOptions = { storageRoot: path.join(root, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [{
      id: "task-relation-1",
      title: "双链编辑任务",
      priority: "high",
      source: "手动新增",
      domain: "个人知识库",
      project: "Graphy 改造",
    }];
    await writeTaskPlanState(state, taskPlanOptions);

    await handleWorkspaceRelationCreate(cfg)({
      body: { sourceId, targetId, type: "uses_method" },
    } as never, { json: vi.fn(), status: vi.fn().mockReturnThis() } as never);

    const listFromTarget = vi.fn();
    await handleWorkspaceRelations(cfg)({ query: { nodeId: targetId } } as never, { json: listFromTarget } as never);
    expect(listFromTarget).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        relations: [expect.objectContaining({
          typeLabel: "使用方法",
          source: expect.objectContaining({ id: sourceId }),
          target: expect.objectContaining({ id: targetId }),
        })],
      }),
    });

    const graphJson = vi.fn();
    await handleWorkspaceGraph(cfg)({ query: { nodeId: targetId } } as never, { json: graphJson } as never);
    expect(graphJson).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        edges: expect.arrayContaining([expect.objectContaining({ label: "使用方法" })]),
      }),
    });

    const relationId = listFromTarget.mock.calls[0]?.[0].data.relations[0].id as string;
    await handleWorkspaceRelationDelete(cfg)({ params: { id: relationId } } as never, { json: vi.fn(), status: vi.fn().mockReturnThis() } as never);
    const listAfterDelete = vi.fn();
    await handleWorkspaceRelations(cfg)({ query: { nodeId: targetId } } as never, { json: listAfterDelete } as never);
    expect(listAfterDelete.mock.calls[0]?.[0].data.relations).toEqual([]);
  });

  it("deletes selected workspace markdown pages and refreshes search index", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-docs-delete-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-workspace-delete-runtime-"));
    tempDirs.push(root, runtimeRoot);
    fs.mkdirSync(path.join(root, "wiki", "专题", "01-案例库"), { recursive: true });
    fs.writeFileSync(path.join(root, "wiki", "专题", "01-案例库", "index.md"), "# 案例库\n\n待删除\n", "utf8");
    fs.writeFileSync(path.join(root, "wiki", "专题", "01-案例库", "示例.md"), "# 示例\n\n待删除子页\n", "utf8");
    await handleWorkspaceDocs(makeServerConfig(root, runtimeRoot, runtimeRoot))({} as never, { json: vi.fn() } as never);
    const handler = handleWorkspaceDocsDelete(makeServerConfig(root, runtimeRoot, runtimeRoot));
    const json = vi.fn();
    const status = vi.fn().mockReturnThis();

    await handler(
      {
        body: {
          paths: ["wiki/专题/01-案例库/index.md", "wiki/专题/01-案例库/示例.md"],
        },
      } as never,
      { json, status } as never,
    );

    expect(fs.existsSync(path.join(root, "wiki", "专题", "01-案例库", "index.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "wiki", "专题", "01-案例库", "示例.md"))).toBe(false);
    expect(readSearchIndexPaths(runtimeRoot)).not.toContain("wiki/专题/01-案例库/index.md");
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        paths: ["wiki/专题/01-案例库/index.md", "wiki/专题/01-案例库/示例.md"],
      },
    });
  });
});

function makeServerConfig(sourceVaultRoot: string, runtimeRoot: string, projectRoot: string) {
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "me",
  };
}

function readSearchIndexPaths(runtimeRoot: string): string[] {
  return readSearchIndex(runtimeRoot)
    .map((item) => typeof item.path === "string" ? item.path : "")
    .filter(Boolean);
}

function readSearchIndex(runtimeRoot: string): Array<{ path?: unknown; searchText?: unknown }> {
  const indexPath = path.join(runtimeRoot, ".llmwiki", "search-index.json");
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as Array<{ path?: unknown; searchText?: unknown }>;
}
