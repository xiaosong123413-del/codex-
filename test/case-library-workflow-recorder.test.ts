import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import { refreshCaseLibrarySource } from "../web/server/services/case-library.js";
import { readTaskPlanState, writeTaskPlanState } from "../web/server/services/task-plan-store.js";
import { readWorkflowEvents, readWorkflowInbox, recordWorkflowInput } from "../web/server/services/workflow-recorder.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("case library and workflow recorder", () => {
  it("creates factual cases from changed source content and skips unchanged content", async () => {
    const cfg = makeConfig("case-refresh");
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "## 中国庭审网视频下载失败后换工具成功\n\nyt-dlp 失败，夸克成功。\n", "utf8");

    const first = await refreshCaseLibrarySource(cfg, { label: "日记", entries: ["raw/闪念日记"] });
    const second = await refreshCaseLibrarySource(cfg, { label: "日记", entries: ["raw/闪念日记"] });

    expect(first.status).toBe("written");
    expect(first.changedCases).toBe(1);
    expect(second.status).toBe("no-increment");
    const caseFiles = fs.readdirSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "01-案例库"));
    expect(caseFiles.some((file) => file.includes("中国庭审网视频下载失败后换工具成功"))).toBe(true);
  });

  it("names timestamp diary cases from their source text", async () => {
    const cfg = makeConfig("case-readable-title");
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-27.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(
      diaryPath,
      "## 02:06\n\n我觉得现在不需要去解决一个难点就在于。你输入其实是有两个源头的，一个是剪藏，一个是日记。\n",
      "utf8",
    );

    await refreshCaseLibrarySource(cfg, { label: "日记", entries: ["raw/闪念日记"] });

    const caseFiles = fs.readdirSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "01-案例库"));
    expect(caseFiles).not.toContain("02-06案例.md");
    expect(caseFiles.some((file) => file.includes("输入其实是有两个源头"))).toBe(true);
  });

  it("archives high-confidence records to task workflow logs and leaves unclear records in inbox", async () => {
    const cfg = makeConfig("workflow-recorder");
    const taskPlanOptions = { storageRoot: path.join(cfg.sourceVaultRoot, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [{
      id: "task-ppt",
      title: "推优大会 PPT",
      priority: "mid",
      source: "手动新增",
      createdAt: "2026-04-29T08:00:00.000Z",
    }];
    await writeTaskPlanState(state, taskPlanOptions);

    const archived = await recordWorkflowInput(cfg, {
      text: "推优大会 PPT 用 ChatGPT 生成大纲失败，下一步让 Gemini 改成视觉化提示词。",
      attachments: ["screenshots/chatgpt.png"],
      marker: "issue",
    });
    const pending = await recordWorkflowInput(cfg, { text: "这个页面还是太乱了", attachments: [], marker: "normal" });
    const saved = await readTaskPlanState(taskPlanOptions);

    expect(archived.status).toBe("archived");
    expect(saved.pool.items[0]?.workflowLog?.[0]?.input).toContain("推优大会 PPT");
    expect(saved.pool.items[0]?.currentProgress).toContain("当前输出不可用");
    expect(saved.pool.items[0]?.lastStop).toContain("推优大会 PPT");
    expect(saved.pool.items[0]?.nextStep).toBe("让 Gemini 改成视觉化提示词");
    expect(pending.status).toBe("pending");
    expect(pending.record.confidence).toBe("low");
    expect(readWorkflowInbox(cfg.runtimeRoot)[0]?.text).toBe("这个页面还是太乱了");
  });

  it("stores workflow events and distillation candidates for tools, validation, and methods", async () => {
    const cfg = makeConfig("workflow-event");
    const taskPlanOptions = { storageRoot: path.join(cfg.sourceVaultRoot, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [{
      id: "task-download",
      title: "下载庭审网视频",
      priority: "mid",
      source: "手动新增",
      domain: "个人知识库",
      project: "资料整理",
      zone: "mine",
    }];
    await writeTaskPlanState(state, taskPlanOptions);

    const result = await recordWorkflowInput(cfg, {
      text: "下载庭审网视频 用夸克浏览器解决了，按教程做但部分错误，下一步整理成稳定方法。链接 https://example.com/guide",
      attachments: [],
      marker: "resolved",
    });

    const events = readWorkflowEvents(cfg.runtimeRoot);
    const resources = readRuntimeJson(cfg.runtimeRoot, "workflow-resource-candidates.json");
    const validations = readRuntimeJson(cfg.runtimeRoot, "workflow-validation-candidates.json");
    const methods = readRuntimeJson(cfg.runtimeRoot, "workflow-method-candidates.json");

    expect(result.status).toBe("archived");
    expect(events[0]).toEqual(expect.objectContaining({
      matched_area: "个人知识库",
      matched_project: "资料整理",
      matched_task: "下载庭审网视频",
      confidence: "high",
      tools: expect.arrayContaining(["夸克浏览器"]),
    }));
    expect(resources[0]?.tools).toContain("夸克浏览器");
    expect(resources[0]?.links).toContain("https://example.com/guide");
    expect(validations[0]?.eventId).toBe(events[0]?.event_id);
    expect(methods[0]?.evidenceKinds).toEqual(expect.arrayContaining(["workflowLog", "case", "validation"]));
    const workLogPath = path.join(cfg.sourceVaultRoot, "领域", "个人知识库", "资料整理", "工作日志.md");
    expect(fs.readFileSync(workLogPath, "utf8")).toContain("Workflow Event：workflow-event/");
    expect(fs.readFileSync(workLogPath, "utf8")).toContain("- 行动：");
    const toolbox = JSON.parse(fs.readFileSync(path.join(cfg.projectRoot, "工具箱", "toolbox.json"), "utf8")) as {
      assets: Array<{ id: string; title: string; badge: string }>;
    };
    expect(toolbox.assets).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: `resource-${events[0]?.event_id}`, title: "夸克浏览器", badge: "待验证" }),
    ]));
  expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "02-方法库", "待验证", `validation-${events[0]?.event_id}.md`))).toBe(true);
  expect(fs.existsSync(path.join(cfg.sourceVaultRoot, "wiki", "专题", "02-方法库", "待验证", `method-${events[0]?.event_id}.md`))).toBe(true);
  });

  it("archives directly to the selected task-pool task", async () => {
    const cfg = makeConfig("workflow-selected-task");
    const taskPlanOptions = { storageRoot: path.join(cfg.sourceVaultRoot, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [
      {
        id: "task-selected",
        title: "整理任务池映射",
        priority: "high",
        source: "手动新增",
        domain: "产品",
        project: "LLM Wiki WebUI",
        zone: "mine",
      },
      {
        id: "task-other",
        title: "无关任务",
        priority: "low",
        source: "手动新增",
        domain: "产品",
        project: "其他项目",
        zone: "mine",
      },
    ];
    await writeTaskPlanState(state, taskPlanOptions);

    const result = await recordWorkflowInput(cfg, {
      text: "刚刚修了快捷记录窗口，下一步验证任务映射。",
      taskId: "task-selected",
      attachments: [],
      marker: "normal",
    });

    const updatedState = await readTaskPlanState(taskPlanOptions);
    const selectedTask = updatedState.pool.items.find((item) => item.id === "task-selected");
    const workLogPath = path.join(cfg.sourceVaultRoot, "领域", "产品", "LLM Wiki WebUI", "工作日志.md");
    const workLog = fs.readFileSync(workLogPath, "utf8");

    expect(result.status).toBe("archived");
    expect(selectedTask?.workflowLog?.[0]?.input).toContain("快捷记录窗口");
    expect(workLog).toContain("- 任务：整理任务池映射");
    expect(workLog).toContain("- 任务 ID：task-selected");
    expect(workLog).toContain("- 任务卡：task-pool/task-selected");
  });

  it("treats method-plan records as method candidates waiting for validation", async () => {
    const cfg = makeConfig("workflow-method-plan");
    const taskPlanOptions = { storageRoot: path.join(cfg.sourceVaultRoot, "task plan") };
    const state = await readTaskPlanState(taskPlanOptions);
    state.pool.items = [{
      id: "task-method",
      title: "沉淀手机号验证方案",
      priority: "mid",
      source: "手动新增",
      domain: "账号体系",
      project: "注册验证",
      zone: "mine",
    }];
    await writeTaskPlanState(state, taskPlanOptions);

    const result = await recordWorkflowInput(cfg, {
      text: "手机号验证可以先试 Google Voice，再比较 eSIM 方案。",
      taskId: "task-method",
      attachments: [],
      marker: "method",
    });

    const events = readWorkflowEvents(cfg.runtimeRoot);
    const methods = readRuntimeJson(cfg.runtimeRoot, "workflow-method-candidates.json");
    const methodPath = path.join(
      cfg.sourceVaultRoot,
      "wiki",
      "专题",
      "02-方法库",
      "待验证",
      `method-${events[0]?.event_id}.md`,
    );

    expect(result.status).toBe("archived");
    expect(events[0]?.event_type).toBe("方法方案");
    expect(methods[0]?.eventId).toBe(events[0]?.event_id);
    expect(fs.existsSync(methodPath)).toBe(true);
  });
});

function makeConfig(label: string): ServerConfig {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `llmwiki-${label}-source-`));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), `llmwiki-${label}-runtime-`));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `llmwiki-${label}-project-`));
  roots.push(sourceVaultRoot, runtimeRoot, projectRoot);
  fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "专题"), { recursive: true });
  return { sourceVaultRoot, runtimeRoot, projectRoot, author: "test", host: "127.0.0.1", port: 4175 };
}

function readRuntimeJson(runtimeRoot: string, filename: string): Array<Record<string, unknown>> {
  const filePath = path.join(runtimeRoot, ".llmwiki", filename);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Array<Record<string, unknown>>;
}
