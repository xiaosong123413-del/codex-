// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  repairUntouchedTaskPlanPoolDraft,
  renderWorkspacePage,
} from "../web/client/src/pages/workspace/index.js";
import {
  WORKFLOW_RECORDER_OPEN_EVENT,
  WORKFLOW_RECORDER_PENDING_KEY,
} from "../web/client/src/keyboard-shortcuts.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (document.elementFromPoint && vi.isMockFunction(document.elementFromPoint)) {
    Reflect.deleteProperty(document, "elementFromPoint");
  }
  document.body.innerHTML = "";
  window.location.hash = "";
  window.sessionStorage.clear();
});

describe("workspace page", () => {
  it("defaults to the task plan tab", async () => {
    const { fetchMock } = installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/task-plan/state");
    expect(page.querySelector("[data-workspace-sidebar]")).not.toBeNull();
    expect(page.querySelector("[data-workspace-sidebar-toggle]")).toBeNull();
    expect(page.querySelector(".workspace-page__sidebar-nav > :first-child")?.getAttribute("data-workspace-tab")).toBe("task-plan");
    expect(page.querySelector("[data-workspace-tab='task-plan']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-workspace-tab='project-progress']")).toBeNull();
    expect(page.querySelector("[data-workspace-tab='toolbox']")).toBeNull();
    expect(page.querySelector("[data-workspace-view='task-plan']")).not.toBeNull();
    expect(page.querySelector("[data-workspace-view='project-progress']")).toBeNull();
  });

  it("routes the removed project progress section to the task plan tab", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage({ routeSection: "project-progress" });
    document.body.appendChild(page);
    await flush();

    expect(page.querySelector("[data-workspace-tab='project-progress']")).toBeNull();
    expect(page.querySelector("[data-workspace-tab='task-plan']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-workspace-view='task-plan']")).not.toBeNull();
    expect(page.querySelector("[data-workspace-view='project-progress']")).toBeNull();
  });

  it("hydrates the task plan tab from backend state", async () => {
    const { fetchMock } = installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/task-plan/state");
    expect(page.querySelector("[data-workspace-tab='task-plan']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-workspace-tab='task-plan']")?.getAttribute("aria-label")).toBe("\u4efb\u52a1\u8ba1\u5212\u9875");
    expect(page.querySelector("[data-workspace-view='task-plan']")).not.toBeNull();
    expect(page.textContent).toContain("AI \u667a\u80fd\u6392\u671f\u52a9\u624b");
    expect(page.textContent).toContain("\u6668\u95f4\u6d41\u7a0b\u5efa\u8bae");
    expect(page.textContent).toContain("\u5f55\u97f3\u540e\u7684\u65b0\u60f3\u6cd5");
    expect(page.textContent).toContain("\u4eca\u5929\u5148\u63a8\u8fdb\u53ef\u4ea4\u4ed8\u4efb\u52a1");
    expect(page.textContent).toContain("\u4eca\u65e5\u5efa\u8bae\u65f6\u95f4\u8868");
    expect(page.textContent).toContain("\u6765\u81ea\u540e\u7aef\u7684\u6392\u671f A");
    expect(page.textContent).toContain("\u6587\u5b57\u8f93\u5165");
    expect(page.textContent).toContain("AI \u751f\u6210");
    expect(page.querySelector("[data-task-plan-layout]")).not.toBeNull();
    expect(page.querySelector("[data-task-plan-split-handle]")).toBeNull();
    expect(page.querySelector("[data-task-plan-bottom]")).toBeNull();
    expect(page.textContent).not.toContain("\u9886\u57df\u4e0e\u9879\u76ee\u63a8\u8fdb");
    expect(page.querySelector("[data-task-plan-text-input]")).not.toBeNull();
    expect(page.querySelector("[data-task-plan-status-input]")).not.toBeNull();
    expect(page.querySelector("[data-task-plan-voice-file]")).toBeNull();
    expect(page.querySelector("[data-task-plan-viewport]")).toBeNull();
    expect(page.querySelector("[data-task-plan-artboard]")).toBeNull();
    expect(page.querySelector("[data-task-plan-assistant-actions]")?.textContent).not.toContain("保存文本输入");
    expect(
      page
        .querySelector("[data-task-plan-card='text']")
        ?.querySelector<HTMLButtonElement>("[data-task-plan-text-save]")?.textContent,
    ).toContain("保存");
  });

  it("opens the task pool board from the existing pool title", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage({ routeSection: "task-plan" });
    document.body.appendChild(page);
    await flush();

    const poolTitle = page.querySelector<HTMLButtonElement>("[data-task-plan-open-task-pool]");
    expect(poolTitle?.textContent).toBe("已有任务池");
    poolTitle?.click();
    await flush();

    expect(window.location.hash).toBe("#/workspace/task-pool");
    expect(page.querySelector("[data-workspace-tab='task-pool']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-workspace-view='task-pool']")).not.toBeNull();
    expect(page.textContent).toContain("当前任务区");
  });

  it("generates task-pool candidates from the task plan existing-pool card", async () => {
    const taskPlan = createMockTaskPlanFixture();
    const generatedState: MockTaskPlanState = {
      ...taskPlan.state,
      pool: {
        ...taskPlan.state.pool,
        items: [
          ...taskPlan.state.pool.items,
          {
            id: "candidate-from-task-plan",
            title: "从任务计划页生成的候选任务",
            priority: "high",
            source: "AI 生成",
            zone: "candidate",
            owner: "ai",
          },
        ],
        generationRecords: [{
          id: "task-pool-generation-task-plan",
          generatedAt: "2026-04-28T14:20:00.000Z",
          diaryPaths: ["raw/闪念日记/2026-04-28.md"],
          diaryDates: ["2026-04-28"],
          createdTaskIds: ["candidate-from-task-plan"],
          skippedDuplicateTitles: [],
        }],
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/task-plan/state") {
        return jsonResponse({ success: true, data: { state: taskPlan.state } });
      }
      if (url === "/api/task-plan/pool/generate" && init?.method === "POST") {
        taskPlan.state = generatedState;
        return jsonResponse({
          success: true,
          data: { state: generatedState, generationRecord: generatedState.pool.generationRecords?.[0] },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderWorkspacePage({ routeSection: "task-plan" });
    document.body.appendChild(page);
    await flush();

    const generateButton = page.querySelector<HTMLButtonElement>("[data-task-pool-generate]");
    expect(generateButton).not.toBeNull();
    expect(generateButton?.textContent?.trim()).toBe("");
    expect(generateButton?.getAttribute("aria-label")).toBe("根据近日日记生成任务");
    generateButton?.click();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/task-plan/pool/generate", { method: "POST" });
    expect(page.textContent).not.toContain("从任务计划页生成的候选任务");
    expect(page.textContent).toContain("已根据新日记生成候选任务");
  });

  it("shows only current task-pool zones on the task plan card and sorts them", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-candidate-hidden",
        title: "不应显示的备选任务",
        priority: "high",
        source: "AI 生成",
        zone: "candidate",
        createdAt: "2026-04-28T08:00:00.000Z",
      },
      {
        id: "pool-current-low",
        title: "低优当前任务",
        priority: "low",
        source: "文字输入",
        zone: "mine",
        createdAt: "2026-04-27T08:00:00.000Z",
      },
      {
        id: "pool-ai-high",
        title: "高优 AI 当前任务",
        priority: "high",
        source: "AI 生成",
        zone: "ai",
        owner: "ai",
        createdAt: "2026-04-26T08:00:00.000Z",
      },
    ];

    const page = renderWorkspacePage({ routeSection: "task-plan" });
    document.body.appendChild(page);
    await flush();

    expect(page.textContent).not.toContain("不应显示的备选任务");
    expect(page.querySelector("[data-task-plan-pool-sort]")).not.toBeNull();
    changeTaskPlanPoolSort(page, "priority-desc");
    await flush();

    expect(readFirstTaskPlanPoolTitle(page)).toBe("高优 AI 当前任务");
  });

  it("renders shared pool items on the task pool page", async () => {
    const { fetchMock } = installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/task-plan/state");
    expect(page.querySelector("[data-workspace-tab='task-pool']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-workspace-view='task-pool']")).not.toBeNull();
    expect(page.textContent).toContain("\u4efb\u52a1\u6c60");
    expect(page.textContent).toContain("\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 1");
    expect(page.textContent).toContain("\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 2");
    expect(page.textContent).not.toContain("\u540e\u7eed\u4f1a\u5728\u8fd9\u91cc\u63a5\u5165");
  });

  it("renders the source-of-truth task pool board with candidate reasons", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-current-1",
        title: "完善任务池拖拽逻辑",
        priority: "high",
        source: "文字输入",
        zone: "mine",
      },
      {
        id: "pool-ai-1",
        title: "实现任务状态同步接口",
        priority: "mid",
        source: "AI 生成",
        zone: "ai",
        owner: "ai",
      },
      {
        id: "pool-candidate-1",
        title: "开发个人信息页",
        priority: "high",
        source: "AI 生成",
        zone: "candidate",
        generatedReason: "想要去开发个人信息页\n需要先独立验证功能可用性",
        diaryDate: "2026-04-26、2026-04-27",
        domain: "个人效率系统",
        project: "个人App开发",
      },
    ];
    taskPlan.state.pool.generationRecords = [{
      id: "task-pool-generation-test",
      generatedAt: "2026-04-28T02:30:00.000Z",
      diaryPaths: ["raw/闪念日记/2026-04-26.md", "raw/闪念日记/2026-04-27.md"],
      diaryDates: ["2026-04-26", "2026-04-27"],
      createdTaskIds: ["pool-candidate-1"],
      skippedDuplicateTitles: [],
    }];

    const page = renderWorkspacePage({ routeSection: "task-pool" });
    document.body.appendChild(page);
    await flush();

    expect(page.querySelector("[data-workspace-view='task-pool']")).not.toBeNull();
    expect(page.hasAttribute("data-task-pool-direct")).toBe(false);
    expect(page.querySelector(".workspace-page__sidebar")).not.toBeNull();
    expect(page.querySelector("[data-workspace-tab='task-pool']")?.getAttribute("data-active")).toBe("true");
    expect(page.textContent).toContain("当前任务区");
    expect(page.textContent).toContain("我要做的");
    expect(page.textContent).toContain("AI 要做的");
    expect(page.textContent).toContain("备选区");
    expect(page.textContent).toContain("生成批次");
    const candidateCard = page.querySelector<HTMLElement>("[data-task-pool-card='pool-candidate-1']");
    expect(candidateCard?.textContent).not.toContain("日记：");
    expect(candidateCard?.textContent).not.toContain("批次：");

    candidateCard?.click();
    await flush();

    const candidateDrawer = page.querySelector<HTMLElement>(".workspace-task-pool-board__drawer.is-open");
    expect(candidateDrawer).not.toBeNull();
    expect(candidateDrawer?.querySelectorAll(".workspace-task-pool-board__reason-card")).toHaveLength(4);
    expect(candidateDrawer?.textContent).toContain("任务定义：这是“开发个人信息页”下需要持续跟踪、能验收、通常由多个行动完成的工作单元。");
    expect(candidateDrawer?.textContent).toContain("层级关系：领域“个人效率系统” → 项目“个人App开发” → 任务“开发个人信息页” → 行动与执行记录。");
    expect(candidateDrawer?.textContent).toContain("生成依据：结合2026-4-26日记说“想要去开发个人信息页”，因此新增任务“开发个人信息页”。");
    expect(candidateDrawer?.textContent?.indexOf("所属领域")).toBeLessThan(candidateDrawer?.textContent?.indexOf("所属项目") ?? 0);
    expect(candidateDrawer?.textContent?.indexOf("所属项目")).toBeLessThan(candidateDrawer?.textContent?.indexOf("来源日记") ?? 0);

    page.querySelector<HTMLElement>("[data-task-pool-card='pool-current-1']")?.click();
    await flush();

    const currentDrawer = page.querySelector<HTMLElement>(".workspace-task-pool-board__drawer.is-open");
    expect(currentDrawer?.textContent).toContain("任务池来源“文字输入”");
  });

  it("opens the workflow recorder from the shortcut request instead of a toolbar button", async () => {
    installTaskPlanFetchMock();
    window.sessionStorage.setItem(WORKFLOW_RECORDER_PENDING_KEY, "1");
    const page = renderWorkspacePage({ routeSection: "task-pool" });
    document.body.appendChild(page);
    await flush();

    expect(page.querySelector("[data-workflow-recorder-open]")).toBeNull();
    expect(page.querySelector("[data-workflow-recorder-input]")).not.toBeNull();
    expect(window.sessionStorage.getItem(WORKFLOW_RECORDER_PENDING_KEY)).toBeNull();

    page.querySelector<HTMLButtonElement>("[data-workflow-recorder-close]")?.click();
    await flush();
    expect(page.querySelector("[data-workflow-recorder-input]")).toBeNull();

    window.dispatchEvent(new CustomEvent(WORKFLOW_RECORDER_OPEN_EVENT));
    await flush();
    expect(page.querySelector("[data-workflow-recorder-input]")).not.toBeNull();
  });

  it("sorts each task-pool board zone independently", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      { id: "mine-late", title: "较晚截止", priority: "low", source: "文字输入", zone: "mine", dueDate: "2026-05-20" },
      { id: "mine-near", title: "较近截止", priority: "low", source: "文字输入", zone: "mine", dueDate: "2026-05-02" },
      { id: "ai-new", title: "较新设立", priority: "mid", source: "AI 生成", zone: "ai", owner: "ai", createdAt: "2026-04-28T08:00:00.000Z" },
      { id: "ai-old", title: "较早设立", priority: "mid", source: "AI 生成", zone: "ai", owner: "ai", createdAt: "2026-04-20T08:00:00.000Z" },
      { id: "candidate-low", title: "低优候选", priority: "low", source: "AI 生成", zone: "candidate" },
      { id: "candidate-high", title: "高优候选", priority: "high", source: "AI 生成", zone: "candidate" },
    ];

    const page = renderWorkspacePage({ routeSection: "task-pool" });
    document.body.appendChild(page);
    await flush();

    expect(page.querySelectorAll("[data-task-pool-sort-zone]")).toHaveLength(3);
    changeTaskPoolSort(page, "mine", "due-asc");
    changeTaskPoolSort(page, "ai", "created-asc");
    changeTaskPoolSort(page, "candidate", "priority-desc");
    await flush();

    expect(readFirstTaskPoolCardTitle(page, "mine")).toBe("较近截止");
    expect(readFirstTaskPoolCardTitle(page, "ai")).toBe("较早设立");
    expect(readFirstTaskPoolCardTitle(page, "candidate")).toBe("高优候选");
  });

  it("groups each task-pool board zone by project or priority", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      { id: "mine-project-a", title: "项目 A 当前任务", priority: "high", source: "文字输入", zone: "mine", project: "项目 A" },
      { id: "mine-project-b", title: "项目 B 当前任务", priority: "low", source: "文字输入", zone: "mine", project: "项目 B" },
      { id: "ai-mid", title: "中优 AI 任务", priority: "mid", source: "AI 生成", zone: "ai", owner: "ai", project: "AI 项目" },
      { id: "candidate-high", title: "高优候选任务", priority: "high", source: "AI 生成", zone: "candidate", project: "候选项目" },
      { id: "candidate-low", title: "低优候选任务", priority: "low", source: "AI 生成", zone: "candidate", project: "候选项目" },
    ];

    const page = renderWorkspacePage({ routeSection: "task-pool" });
    document.body.appendChild(page);
    await flush();

    expect(page.querySelectorAll("[data-task-pool-group-zone]")).toHaveLength(3);
    changeTaskPoolGroup(page, "mine", "project");
    changeTaskPoolGroup(page, "candidate", "priority");
    await flush();

    expect(page.querySelector("[data-task-pool-drop-zone='mine']")?.textContent).toContain("项目 A");
    expect(page.querySelector("[data-task-pool-drop-zone='mine']")?.textContent).toContain("项目 B");
    expect(page.querySelector("[data-task-pool-drop-zone='candidate']")?.textContent).toContain("高优先级");
    expect(page.querySelector("[data-task-pool-drop-zone='candidate']")?.textContent).toContain("低优先级");
  });

  it("completes and deletes task-pool board items from card actions", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.pool.items = [
      { id: "pool-complete", title: "可以完成的任务", priority: "high", source: "文字输入", zone: "mine" },
      { id: "pool-delete", title: "可以删除的任务", priority: "low", source: "AI 生成", zone: "candidate" },
      { id: "pool-keep-scroll", title: "保留当前位置的任务", priority: "mid", source: "AI 生成", zone: "candidate" },
    ];
    installTaskPlanPoolSaveFetchMock(taskPlan);

    const page = renderWorkspacePage({ routeSection: "task-pool" });
    document.body.appendChild(page);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-pool-complete='pool-complete']")?.click();
    await flush();

    expect(taskPlan.state.pool.items.find((item) => item.id === "pool-complete")?.completedAt).toMatch(/^\d{4}-/);
    expect(page.textContent).not.toContain("可以完成的任务");

    const candidateScroller = page.querySelector<HTMLElement>(
      "[data-task-pool-drop-zone='candidate'] .workspace-task-pool-board__cards",
    );
    expect(candidateScroller).not.toBeNull();
    candidateScroller!.scrollTop = 320;

    page.querySelector<HTMLButtonElement>("[data-task-pool-delete='pool-delete']")?.click();
    await flush();

    expect(taskPlan.state.pool.items.some((item) => item.id === "pool-delete")).toBe(false);
    expect(page.textContent).not.toContain("可以删除的任务");
    expect(
      page.querySelector<HTMLElement>("[data-task-pool-drop-zone='candidate'] .workspace-task-pool-board__cards")
        ?.scrollTop,
    ).toBe(320);
  });

  it("persists task-pool board drops as zone changes", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.pool.items = [
      {
        id: "pool-candidate-1",
        title: "建立任务生成记录表",
        priority: "high",
        source: "AI 生成",
        zone: "candidate",
        owner: "ai",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/task-plan/state") {
        return jsonResponse({ success: true, data: { state: taskPlan.state } });
      }
      if (url === "/api/task-plan/pool" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as { items: MockTaskPlanState["pool"]["items"] };
        taskPlan.state = { ...taskPlan.state, pool: { ...taskPlan.state.pool, items: payload.items } };
        return jsonResponse({ success: true, data: { state: taskPlan.state } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderWorkspacePage({ routeSection: "task-pool" });
    document.body.appendChild(page);
    await flush();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(page.querySelector<HTMLElement>("[data-task-pool-card='pool-candidate-1']")!, "dragstart", transfer);
    dispatchDragEvent(page.querySelector<HTMLElement>("[data-task-pool-drop-zone='mine']")!, "drop", transfer);
    await flush();

    expect(taskPlan.state.pool.items[0]).toMatchObject({
      id: "pool-candidate-1",
      zone: "mine",
      owner: "me",
    });
  });

  it("renders the task pool safely when shared priority is malicious", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool = {
      items: [
        {
          id: "pool-malicious-priority",
          title: "\u810f priority \u4efb\u52a1",
          priority: 'high" data-priority-hacked="true' as unknown as MockTaskPlanPriority,
          source: "\u6587\u5b57\u8f93\u5165",
        },
      ],
    };

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();

    const priorityPill = page.querySelector<HTMLElement>(".workspace-task-pool-board__priority");
    expect(priorityPill?.textContent).toBe("\u4f4e");
    expect(priorityPill?.className).toContain("workspace-task-pool-board__priority--neutral");
    expect(priorityPill?.className).not.toContain('data-priority-hacked="true');
    expect(priorityPill?.getAttribute("data-priority-hacked")).toBeNull();
    expect(page.querySelector("[data-priority-hacked='true']")).toBeNull();
    expect(page.textContent).toContain("\u810f priority \u4efb\u52a1");
    expect(page.textContent).not.toContain("undefined");
  });

  it.skip("saves shared pool edits from the task pool page", async () => {
    const taskPlan = createMockTaskPlanFixture();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/task-plan/state") {
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/pool" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as {
          items: Array<{ id: string; title: string; priority: MockTaskPlanPriority; source: MockTaskPlanSource }>;
        };
        taskPlan.state = {
          ...taskPlan.state,
          pool: {
            items: payload.items,
          },
        };
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-filter='AI 生成']")?.click();
    expect(page.textContent).toContain("\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 2");
    expect(page.textContent).not.toContain("\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 1");

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-filter='全部']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-remove='pool-2']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-add]")?.click();

    const existingTitleInput = page.querySelector<HTMLInputElement>("[data-task-plan-pool-title-input='pool-1']");
    const draftTitleInput = page.querySelector<HTMLInputElement>("[data-task-plan-pool-title-input='draft-pool-1']");
    const draftSourceInput = page.querySelector<HTMLSelectElement>("[data-task-plan-pool-source-input='draft-pool-1']");
    const draftPriorityInput = page.querySelector<HTMLSelectElement>("[data-task-plan-pool-priority-input='draft-pool-1']");

    expect(existingTitleInput).not.toBeNull();
    expect(draftTitleInput).not.toBeNull();
    expect(draftSourceInput).not.toBeNull();
    expect(draftPriorityInput).not.toBeNull();

    existingTitleInput!.value = "\u4efb\u52a1\u6c60\u9996\u9879\uff08\u5df2\u7f16\u8f91\uff09";
    existingTitleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    draftTitleInput!.value = "\u4efb\u52a1\u6c60\u65b0\u589e\u9879";
    draftTitleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    draftSourceInput!.value = "\u5de5\u4f5c\u65e5\u5fd7";
    draftSourceInput!.dispatchEvent(new Event("change", { bubbles: true }));
    draftPriorityInput!.value = "low";
    draftPriorityInput!.dispatchEvent(new Event("change", { bubbles: true }));

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.click();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-plan/pool",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: "pool-1",
              title: "\u4efb\u52a1\u6c60\u9996\u9879\uff08\u5df2\u7f16\u8f91\uff09",
              priority: "high",
              source: "\u6587\u5b57\u8f93\u5165",
            },
            {
              id: "draft-pool-1",
              title: "\u4efb\u52a1\u6c60\u65b0\u589e\u9879",
              priority: "low",
              source: "\u5de5\u4f5c\u65e5\u5fd7",
            },
          ],
        }),
      }),
    );
    expect(page.textContent).toContain("\u4efb\u52a1\u6c60\u9996\u9879\uff08\u5df2\u7f16\u8f91\uff09");
    expect(page.textContent).toContain("\u4efb\u52a1\u6c60\u65b0\u589e\u9879");
    expect(page.textContent).not.toContain("\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 2");
  });

  it("repairs an untouched empty pool draft from the shared task pool", () => {
    const fixture = createMockTaskPlanFixture();

    const repaired = repairUntouchedTaskPlanPoolDraft({
      state: fixture.state,
      poolDraft: [],
      poolEditMode: true,
      poolDraftTouched: false,
    });

    expect(repaired).toEqual(fixture.state.pool.items);
    expect(repaired).not.toBe(fixture.state.pool.items);
  });

  it("keeps an intentionally cleared pool draft empty", () => {
    const fixture = createMockTaskPlanFixture();

    const repaired = repairUntouchedTaskPlanPoolDraft({
      state: fixture.state,
      poolDraft: [],
      poolEditMode: true,
      poolDraftTouched: true,
    });

    expect(repaired).toEqual([]);
  });

  it.skip("disables pool editing controls while shared pool save is in flight", async () => {
    const taskPlan = createMockTaskPlanFixture();
    const { resolvePoolSave } = installPendingTaskPlanPoolSaveFetchMock(taskPlan);
    const page = renderWorkspacePage();
    document.body.appendChild(page);
    await openTaskPoolEditor(page);
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.click();
    await flush();

    const controls = getTaskPlanPoolBusyControls(page);
    expectTaskPlanPoolControlsDisabled(controls, true);
    exerciseDisabledTaskPlanPoolControls(controls);

    expect(page.querySelector("[data-task-plan-pool-title-input='draft-pool-1']")).toBeNull();
    expect(page.querySelector("[data-task-plan-pool-remove='pool-2']")).not.toBeNull();
    expect(page.querySelector("[data-task-plan-pool-filter='AI 生成']")?.className).not.toContain("is-active");
    resolvePoolSave?.();
  });

  it.skip("renders the task-pool tree view with project-level checkbox filtering", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool = {
      items: [
        {
          id: "pool-1",
          title: "完成任务池树状图视图",
          priority: "high",
          source: "文字输入",
          domain: "产品设计",
          project: "工作台改版",
        },
        {
          id: "pool-2",
          title: "联通项目推进页同步",
          priority: "mid",
          source: "AI 生成",
          domain: "产品设计",
          project: "任务同步",
        },
        {
          id: "pool-3",
          title: "统一健康卡片视觉",
          priority: "low",
          source: "工作日志",
          domain: "产品设计",
          project: "视觉梳理",
        },
      ],
    };

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();

    expect(page.querySelector("[data-task-pool-tree-level='project']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-task-pool-tree-options]")?.textContent).toContain("工作台改版");
    expect(page.querySelector("[data-task-pool-tree-options]")?.textContent).toContain("任务同步");
    expect(page.querySelector("[data-task-pool-tree-options]")?.textContent).toContain("视觉梳理");

    const visualToggle = Array.from(
      page.querySelectorAll<HTMLLabelElement>(".workspace-task-pool-tree__option"),
    ).find((label) => label.textContent?.includes("视觉梳理"))?.querySelector<HTMLInputElement>(
      "[data-task-pool-tree-option]",
    );
    expect(visualToggle).not.toBeNull();
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).not.toContain("视觉梳理");

    visualToggle!.click();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("视觉梳理");
  });

  it.skip("renders editable tree controls when the shared pool editor is enabled in tree mode", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")).not.toBeNull();
    expect(page.querySelector("[data-task-pool-tree-root]")).not.toBeNull();
    expect(page.querySelector("[data-task-pool-tree-node-type='domain']")).not.toBeNull();
    expect(page.querySelector("[data-task-pool-tree-save-indicator]")).not.toBeNull();
    expect(page.querySelector("[data-task-plan-pool-save]")).not.toBeNull();
    expect(page.querySelector("[data-task-plan-pool-add]")).toBeNull();
  });

  it.skip("marks selected, editing, and drag target tree nodes with visual state classes", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
      {
        id: "pool-2",
        title: "联通项目推进页同步",
        priority: "mid",
        source: "AI 生成",
        domain: "产品设计",
        project: "任务同步",
      },
    ];
    installTaskPlanPoolSaveFetchMock(taskPlan);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    page
      .querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-1']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    const selectedTaskNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-1']");
    expect(selectedTaskNode?.className).toContain("is-selected");

    selectedTaskNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    const editingTaskNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-1']");
    expect(editingTaskNode?.className).toContain("is-editing");
    expect(page.querySelector("[data-task-pool-tree-edit-input]")).not.toBeNull();

    const draggingTaskNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-2']");
    const transfer = createMockDataTransfer();
    dispatchDragEvent(draggingTaskNode!, "dragstart", transfer);
    await flush();

    dispatchDragEvent(
      page.querySelector<HTMLElement>("[data-task-pool-tree-node-project='工作台改版']")!,
      "dragover",
      transfer,
    );
    await flush();

    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-node-project='工作台改版']")?.className).toContain(
      "is-drop-target",
    );

    dispatchDragEvent(page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-2']")!, "dragend", transfer);
    await flush();

    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-node-project='工作台改版']")?.className).not.toContain(
      "is-drop-target",
    );
  });

  it.skip("keeps a visible tree sidebar toggle when the filter sidebar is collapsed", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-sidebar-toggle]")?.click();
    await flush();

    expect(page.style.getPropertyValue("--task-pool-tree-sidebar-width")).toBe("56px");
    expect(page.querySelector<HTMLButtonElement>("[data-task-pool-tree-sidebar-toggle]")).not.toBeNull();
    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-sidebar]")?.className).toContain("is-collapsed");
  });

  it.skip("adds a child task when pressing Enter on a project node", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const projectNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='project']");
    projectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    projectNode?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("");
    expect(page.querySelector("[data-task-pool-tree-level='task']")?.getAttribute("data-active")).toBe("true");
    expect(page.textContent).toContain("树状图有未保存更改");
  });

  it.skip("commits project edits and creates a child task when pressing Enter inside the tree edit input", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const projectNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='project']");
    projectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    projectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    input!.value = "交互改版";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const nextInput = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(nextInput).not.toBeNull();
    expect(nextInput?.value).toBe("");
    expect(page.querySelector("[data-task-pool-tree-level='task']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("交互改版");
    expect(page.textContent).toContain("树状图有未保存更改");
  });

  it.skip("creates a project-level editor when pressing Enter on a domain node", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const domainNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='domain']");
    domainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    domainNode?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    expect(page.querySelector("[data-task-pool-tree-level='project']")?.getAttribute("data-active")).toBe("true");
    const input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("");
  });

  it.skip("moves project tasks into the same domain's 待分组 bucket when deleting a project", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const projectNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='project']");
    projectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    projectNode?.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await flush();

    expect(page.textContent).toContain("待分组");
    expect(page.textContent).toContain("完成任务池树状图视图");
  });

  it.skip("moves domain tasks into 未归类 / 待分组 when deleting a domain", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const domainNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='domain']");
    domainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    domainNode?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await flush();

    expect(page.textContent).toContain("未归类");
    expect(page.textContent).toContain("待分组");
    expect(page.textContent).toContain("完成任务池树状图视图");
  });

  it.skip("does not delete fallback domain or project buckets in tree mode", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "未归类任务",
        priority: "high",
        source: "文字输入",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const fallbackDomainNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='domain']");
    fallbackDomainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fallbackDomainNode?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("未归类");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("未归类任务");

    const fallbackProjectNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='project']");
    fallbackProjectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fallbackProjectNode?.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("待分组");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("未归类任务");
  });

  it.skip("preserves task-pool tree expansion depth by tree level", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-node-type='domain']")).not.toBeNull();
    expect(page.querySelector("[data-task-pool-tree-node-type='project']")).toBeNull();
    expect(page.querySelector("[data-task-pool-tree-node-type='task']")).toBeNull();

    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-node-type='project']")).not.toBeNull();
    expect(page.querySelector("[data-task-pool-tree-node-type='task']")).toBeNull();

    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-node-type='task']")).not.toBeNull();
  });

  it.skip("relinks a task to the drop target project when dragging a task node onto another project", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
      {
        id: "pool-2",
        title: "联通项目推进页同步",
        priority: "mid",
        source: "AI 生成",
        domain: "产品设计",
        project: "任务同步",
      },
    ];
    installTaskPlanPoolSaveFetchMock(taskPlan);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const transfer = createMockDataTransfer();
    const taskNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-1']");
    const projectNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-project='任务同步']");
    expect(taskNode).not.toBeNull();
    expect(projectNode).not.toBeNull();

    dispatchDragEvent(taskNode!, "dragstart", transfer);
    dispatchDragEvent(projectNode!, "dragover", transfer);
    dispatchDragEvent(projectNode!, "drop", transfer);
    dispatchDragEvent(taskNode!, "dragend", transfer);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.click();
    await flush();

    const moved = taskPlan.state.pool.items.find((item) => item.id === "pool-1");
    expect(moved?.project).toBe("任务同步");
    expect(moved?.domain).toBe("产品设计");
  });

  it.skip("ignores project drops when no task drag is active", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
      {
        id: "pool-2",
        title: "联通项目推进页同步",
        priority: "mid",
        source: "AI 生成",
        domain: "产品设计",
        project: "任务同步",
      },
    ];
    installTaskPlanPoolSaveFetchMock(taskPlan);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const transfer = createMockDataTransfer();
    transfer.setData("text/plain", "pool-1");
    const projectNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-project='任务同步']");
    expect(projectNode).not.toBeNull();

    dispatchDragEvent(projectNode!, "dragover", transfer);
    dispatchDragEvent(projectNode!, "drop", transfer);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.click();
    await flush();

    const unchanged = taskPlan.state.pool.items.find((item) => item.id === "pool-1");
    expect(unchanged?.project).toBe("工作台改版");
    expect(unchanged?.domain).toBe("产品设计");
  });

  it.skip("updates the tree zoom percentage when wheeling over the canvas", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    await flush();

    expect(page.textContent).toContain("90%");
    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-canvas]")?.style.getPropertyValue("--task-pool-zoom")).toBe(
      "0.9",
    );

    const canvasWrap = page.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]");
    canvasWrap?.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: false, deltaY: -120 }),
    );
    await flush();

    expect(page.textContent).toContain("100%");
    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-canvas]")?.style.getPropertyValue("--task-pool-zoom")).toBe(
      "1",
    );
  });

  it.skip("updates the tree zoom percentage when pinching over the canvas", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    await flush();

    expect(page.textContent).toContain("90%");
    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-canvas]")?.style.getPropertyValue("--task-pool-zoom")).toBe(
      "0.9",
    );

    const canvasWrap = page.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]");
    dispatchGestureEvent(canvasWrap!, "gesturestart", 1);
    dispatchGestureEvent(canvasWrap!, "gesturechange", 1.2);
    await flush();

    expect(page.textContent).toContain("100%");
    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-canvas]")?.style.getPropertyValue("--task-pool-zoom")).toBe(
      "1",
    );
  });

  it.skip("does not compound pinch zoom across a single gesture sequence", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    await flush();

    expect(page.textContent).toContain("90%");
    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-canvas]")?.style.getPropertyValue("--task-pool-zoom")).toBe(
      "0.9",
    );

    const canvasWrap = page.querySelector<HTMLElement>("[data-task-pool-tree-canvas-wrap]");
    dispatchGestureEvent(canvasWrap!, "gesturestart", 1);
    dispatchGestureEvent(canvasWrap!, "gesturechange", 1.1);
    dispatchGestureEvent(canvasWrap!, "gesturechange", 1.2);
    dispatchGestureEvent(canvasWrap!, "gesturechange", 1.3);
    await flush();

    expect(page.textContent).toContain("100%");
    expect(page.textContent).not.toContain("110%");
    expect(page.querySelector<HTMLElement>("[data-task-pool-tree-canvas]")?.style.getPropertyValue("--task-pool-zoom")).toBe(
      "1",
    );
  });

  it.skip("renaming the active task-pool domain keeps the edited branch visible", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "域内任务",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
      {
        id: "pool-2",
        title: "其他域任务",
        priority: "mid",
        source: "AI 生成",
        domain: "工程效率",
        project: "自动化",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    const scopedChip = Array.from(page.querySelectorAll<HTMLButtonElement>("[data-task-pool-domain-chip]")).find(
      (button) => button.textContent?.trim() === "产品设计",
    );
    scopedChip?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const domainNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='domain']");
    domainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    domainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    input!.value = "体验设计";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new Event("blur", { bubbles: true }));
    await flush();

    expect(page.querySelector<HTMLElement>("[data-workspace-view='task-pool'] h2")?.textContent).toBe("体验设计");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("体验设计");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("域内任务");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).not.toContain("工程效率");
    expect(window.location.hash).toBe("#/workspace/task-pool/domain/%E4%BD%93%E9%AA%8C%E8%AE%BE%E8%AE%A1");
  });

  it.skip("keeps same-named projects in different domains independently filterable at project level", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "设计一部任务",
        priority: "high",
        source: "文字输入",
        domain: "设计一部",
        project: "周会",
      },
      {
        id: "pool-2",
        title: "设计二部任务",
        priority: "mid",
        source: "AI 生成",
        domain: "设计二部",
        project: "周会",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();
    await flush();

    const projectOptions = Array.from(
      page.querySelectorAll<HTMLLabelElement>(".workspace-task-pool-tree__option"),
    );
    expect(projectOptions).toHaveLength(2);
    expect(projectOptions.map((option) => option.textContent?.trim())).toEqual([
      "周会（设计一部）",
      "周会（设计二部）",
    ]);
    expect(
      new Set(
        projectOptions.map((option) => option.querySelector<HTMLInputElement>("[data-task-pool-tree-option]")?.dataset.taskPoolTreeOption),
      ).size,
    ).toBe(2);
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("设计一部");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("设计二部");

    projectOptions
      .find((option) => option.textContent?.includes("周会（设计一部）"))
      ?.querySelector<HTMLInputElement>("[data-task-pool-tree-option]")
      ?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).not.toContain("设计一部");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("设计二部");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("周会");
  });

  it.skip("keeps single-domain project labels plain when only one project option exists", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "任务一",
        priority: "high",
        source: "文字输入",
        domain: "设计一部",
        project: "周会",
      },
      {
        id: "pool-2",
        title: "任务二",
        priority: "mid",
        source: "AI 生成",
        domain: "设计一部",
        project: "周会",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();
    await flush();

    const projectOptions = Array.from(
      page.querySelectorAll<HTMLLabelElement>(".workspace-task-pool-tree__option"),
    );
    expect(projectOptions).toHaveLength(1);
    expect(projectOptions[0]?.textContent?.trim()).toBe("周会");
  });

  it.skip("keeps unsaved list edits visible when switching back to the task-pool tree", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "旧列表标题",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();

    const titleInput = page.querySelector<HTMLInputElement>("[data-task-plan-pool-title-input='pool-1']");
    expect(titleInput).not.toBeNull();
    titleInput!.value = "未保存列表标题";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));

    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("未保存列表标题");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).not.toContain("旧列表标题");
  });

  it.skip("keeps duplicate task titles independently filterable in task-level tree mode", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "重复任务",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
      {
        id: "pool-2",
        title: "重复任务",
        priority: "mid",
        source: "AI 生成",
        domain: "产品设计",
        project: "任务同步",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-option='pool-1']")).not.toBeNull();
    expect(page.querySelector("[data-task-pool-tree-option='pool-2']")).not.toBeNull();

    page.querySelector<HTMLInputElement>("[data-task-pool-tree-option='pool-2']")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("工作台改版");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).not.toContain("任务同步");

    page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-1']")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-1']")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    const input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    input!.value = "已重命名任务";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new Event("blur", { bubbles: true }));
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("已重命名任务");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).not.toContain("任务同步");

    page.querySelector<HTMLInputElement>("[data-task-pool-tree-option='pool-2']")?.click();
    await flush();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("已重命名任务");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("重复任务");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("任务同步");
  });

  it.skip("keeps tree edits local until the shared pool save button is clicked", async () => {
    const { taskPlan } = installTaskPlanFetchMock();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='task']")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    page.querySelector<HTMLElement>("[data-task-pool-tree-node-type='task']")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    const input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    input!.value = "树状图草稿任务";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new Event("blur", { bubbles: true }));
    await flush();

    expect(page.textContent).toContain("树状图有未保存更改");
    expect(taskPlan.state.pool.items[0]?.title).toBe("完成任务池树状图视图");
  });

  it.skip("persists tree edits through the shared pool save action", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "完成任务池树状图视图",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
      {
        id: "pool-2",
        title: "同步项目任务",
        priority: "mid",
        source: "AI 生成",
        domain: "产品设计",
        project: "工作台改版",
      },
      {
        id: "pool-3",
        title: "未归类任务",
        priority: "low",
        source: "工作日志",
      },
    ];
    installTaskPlanPoolSaveFetchMock(taskPlan);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    await flush();

    const domainNode = Array.from(page.querySelectorAll<HTMLElement>("[data-task-pool-tree-node-type='domain']")).find(
      (node) => node.textContent?.trim() === "产品设计",
    );
    domainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    domainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    input!.value = "体验设计";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new Event("blur", { bubbles: true }));
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();
    await flush();

    const projectNode = Array.from(page.querySelectorAll<HTMLElement>("[data-task-pool-tree-node-type='project']")).find(
      (node) => node.textContent?.trim() === "工作台改版",
    );
    projectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    projectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    input!.value = "交互改版";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new Event("blur", { bubbles: true }));
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();
    await flush();

    const taskNode = page.querySelector<HTMLElement>("[data-task-pool-tree-node-task-id='pool-1']");
    taskNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    taskNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    input = page.querySelector<HTMLInputElement>("[data-task-pool-tree-edit-input]");
    expect(input).not.toBeNull();
    input!.value = "树状图已保存任务";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new Event("blur", { bubbles: true }));
    await flush();

    const fallbackDomainNode = Array.from(
      page.querySelectorAll<HTMLElement>("[data-task-pool-tree-node-type='domain']"),
    ).find((node) => node.textContent?.trim() === "未归类");
    fallbackDomainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fallbackDomainNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(page.querySelector("[data-task-pool-tree-edit-input]")).toBeNull();

    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='project']")?.click();
    await flush();

    const fallbackProjectNode = Array.from(
      page.querySelectorAll<HTMLElement>("[data-task-pool-tree-node-type='project']"),
    ).find((node) => node.textContent?.trim() === "待分组");
    fallbackProjectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fallbackProjectNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(page.querySelector("[data-task-pool-tree-edit-input]")).toBeNull();

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.click();
    await flush();

    const renamedTask = taskPlan.state.pool.items.find((item) => item.id === "pool-1");
    const renamedProjectSibling = taskPlan.state.pool.items.find((item) => item.id === "pool-2");
    const fallbackTask = taskPlan.state.pool.items.find((item) => item.id === "pool-3");

    expect(renamedTask?.title).toBe("树状图已保存任务");
    expect(renamedTask?.domain).toBe("体验设计");
    expect(renamedTask?.project).toBe("交互改版");
    expect(renamedProjectSibling?.domain).toBe("体验设计");
    expect(renamedProjectSibling?.project).toBe("交互改版");
    expect(fallbackTask?.domain).toBeUndefined();
    expect(fallbackTask?.project).toBeUndefined();
    expect(page.textContent).not.toContain("树状图有未保存更改");
  });

  it.skip("does not leave the task-pool tree filtered to stale options after saving shared pool edits", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.pool.items = [
      {
        id: "pool-1",
        title: "旧任务标题",
        priority: "high",
        source: "文字输入",
        domain: "产品设计",
        project: "工作台改版",
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/task-plan/state") {
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/pool" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as {
          items: Array<{
            id: string;
            title: string;
            priority: MockTaskPlanPriority;
            source: MockTaskPlanSource;
            domain?: string;
            project?: string;
          }>;
        };
        taskPlan.state = {
          ...taskPlan.state,
          pool: {
            items: payload.items,
          },
        };
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-tree-level='task']")?.click();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("旧任务标题");

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='list']")?.click();

    const titleInput = page.querySelector<HTMLInputElement>("[data-task-plan-pool-title-input='pool-1']");
    expect(titleInput).not.toBeNull();
    titleInput!.value = "新任务标题";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-pool-view-mode='tree']")?.click();

    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).toContain("新任务标题");
    expect(page.querySelector("[data-task-pool-tree-canvas]")?.textContent).not.toContain("旧任务标题");
  });

  it("renders the health domain page with sleep-focused metrics and import controls", async () => {
    installWorkspaceHealthFetchMock();
    window.location.hash = "#/workspace/task-pool/domain/health";
    const page = renderWorkspacePage({ routeSection: "task-pool/domain/health" });
    document.body.appendChild(page);
    await flush();

    expect(page.querySelector("[data-workspace-tab='task-pool']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-workspace-domain-view='health']")).not.toBeNull();
    expect(page.textContent).toContain("健康");
    expect(page.textContent).toContain("入睡时间");
    expect(page.textContent).toContain("23:48");
    expect(page.textContent).toContain("起床时间");
    expect(page.textContent).toContain("07:26");
    expect(page.textContent).toContain("深度睡眠质量");
    expect(page.textContent).toContain("偏低");
    expect(page.textContent).toContain("影响睡眠的因素");
    expect(page.textContent).toContain("入睡时间最近?7 天波动偏大");
    expect(page.querySelector("[data-health-import-open]")).not.toBeNull();

    page.querySelector<HTMLButtonElement>("[data-health-import-open]")?.click();

    expect(page.querySelector("[data-health-import-modal]")).not.toBeNull();
    expect(page.textContent).toContain("验证码连接");
    expect(page.textContent).toContain("高级连接");
    expect(page.querySelector("[data-health-import-tab='account']")).not.toBeNull();
    expect(page.querySelector("[data-health-import-tab='api']")).not.toBeNull();
    expect(page.querySelector("[data-health-account-input='relativeUid']")).not.toBeNull();

    page.querySelector<HTMLButtonElement>("[data-health-import-tab='api']")?.click();

    expect(page.textContent).toContain("二维码登录生成 token");
    expect(page.textContent).toContain("先填写亲友共享 UID");
    expect(page.querySelector("[data-health-qr-login]")).not.toBeNull();
    expect(page.querySelector("[data-health-api-input='relativeUid']")).not.toBeNull();
  });

  it("shows a captcha challenge instead of mojibake when Xiaomi asks for image verification", async () => {
    installWorkspaceHealthCaptchaFetchMock();
    window.location.hash = "#/workspace/task-pool/domain/health";
    const page = renderWorkspacePage({ routeSection: "task-pool/domain/health" });
    document.body.appendChild(page);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-health-import-open]")?.click();
    page.querySelector<HTMLInputElement>("[data-health-account-input='username']")!.value = "19000000000";
    page.querySelector<HTMLInputElement>("[data-health-account-input='username']")!.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-health-send-code]")?.click();
    await flush();

    expect(page.textContent).toContain("获取验证码前需要先完成图形验证码。");
    expect(page.textContent).toContain("验证码连接");
    expect(page.querySelector("[data-health-captcha-challenge]")).not.toBeNull();
    expect(page.querySelector<HTMLImageElement>(".workspace-health-domain__captcha-image")?.src).toContain("data:image/png;base64,");
    expect(page.querySelector<HTMLInputElement>("[data-health-account-input='captchaCode']")).not.toBeNull();
    expect(page.querySelector("[data-health-account-input='password']")).toBeNull();
  });

  it("treats Xiaomi phone-info failures as a partial success when the sms has already been sent", async () => {
    installWorkspaceHealthPartialVerificationFetchMock();
    window.location.hash = "#/workspace/task-pool/domain/health";
    const page = renderWorkspacePage({ routeSection: "task-pool/domain/health" });
    document.body.appendChild(page);
    await flush();

    page.querySelector<HTMLButtonElement>("[data-health-import-open]")?.click();
    page.querySelector<HTMLInputElement>("[data-health-account-input='username']")!.value = "19000000000";
    page.querySelector<HTMLInputElement>("[data-health-account-input='username']")!.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-health-send-code]")?.click();
    await flush();

    page.querySelector<HTMLInputElement>("[data-health-account-input='captchaCode']")!.value = "aBcD";
    page.querySelector<HTMLInputElement>("[data-health-account-input='captchaCode']")!.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-health-send-code]")?.click();
    await flush();

    expect(page.textContent).toContain("短信验证码已经发到你的手机");
    expect(page.textContent).toContain("验证码登录并连接");
    expect(page.querySelector("[data-health-captcha-challenge]")).not.toBeNull();
    expect(page.querySelector<HTMLInputElement>("[data-health-account-input='captchaCode']")?.value).toBe("aBcD");
  });

  it("keeps the active content visible with the workspace sidebar icon navigation", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    expect(page.querySelector("[data-workspace-sidebar-toggle]")).toBeNull();
    expect(page.querySelector("[data-workspace-sidebar]")?.className).not.toContain("is-collapsed");
    expect(page.querySelector("[data-workspace-view='task-plan']")).not.toBeNull();
    expect(page.querySelector("[data-task-plan-layout]")).not.toBeNull();
    expect(page.textContent).toContain("\u5f55\u97f3\u540e\u7684\u65b0\u60f3\u6cd5");
  });

  it("wires task plan actions to backend routes", async () => {
    const taskPlan = createMockTaskPlanFixture();
    // fallow-ignore-next-line complexity
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/task-plan/state") {
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/text" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as { text: string };
        taskPlan.state = {
          ...taskPlan.state,
          voice: {
            transcript: payload.text,
            audioPath: null,
            updatedAt: "2026-04-24T09:15:00.000Z",
          },
          morningFlow: {
            ...taskPlan.state.morningFlow,
            voiceDone: true,
          },
        };
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/status" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as { statusSummary: string };
        taskPlan.state = {
          ...taskPlan.state,
          statusSummary: payload.statusSummary,
        };
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/status/refresh" && init?.method === "POST") {
        taskPlan.state = {
          ...taskPlan.state,
          statusSummary: "\u7531\u540e\u7aef\u5237\u65b0\u7684\u8fd1\u65e5\u72b6\u6001",
        };
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/pool" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as {
          items: Array<{ id: string; title: string; priority: MockTaskPlanPriority; source: MockTaskPlanSource }>;
        };
        taskPlan.state = {
          ...taskPlan.state,
          pool: {
            items: payload.items,
          },
        };
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/generate" && init?.method === "POST") {
        taskPlan.state = {
          ...taskPlan.state,
          schedule: {
            generationId: "task-plan-generation-2",
            revisionId: taskPlan.state.schedule.revisionId,
            confirmed: false,
            items: [
              {
                id: "schedule-generated-1",
                title: "\u7ecf AI \u91cd\u65b0\u7f16\u6392\u7684\u65e5\u7a0b",
                startTime: "08:30",
                priority: "high",
              },
            ],
          },
          morningFlow: {
            ...taskPlan.state.morningFlow,
            diaryDone: true,
            planningDone: true,
            fineTuneDone: false,
          },
        };
        return jsonResponse({
          success: true,
          data: {
            schedule: taskPlan.state.schedule,
          },
        });
      }
      if (url === "/api/task-plan/schedule" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as {
          items: Array<{ id: string; title: string; startTime: string; priority: string }>;
          confirmed: boolean;
        };
        taskPlan.state = {
          ...taskPlan.state,
          schedule: {
            generationId: taskPlan.state.schedule.generationId,
            revisionId: "schedule-revision-2",
            items: payload.items.map((item) => ({
              id: item.id,
              title: item.title,
              startTime: item.startTime,
              priority: normalizeTaskPlanPriority(item.priority),
            })),
            confirmed: payload.confirmed,
          },
          morningFlow: {
            ...taskPlan.state.morningFlow,
            fineTuneDone: payload.confirmed,
          },
        };
        return jsonResponse({
          success: true,
          data: {
            schedule: taskPlan.state.schedule,
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    const textInput = page.querySelector<HTMLTextAreaElement>("[data-task-plan-text-input]");
    expect(textInput).not.toBeNull();
    textInput!.value = "\u65b0\u7684\u6587\u5b57\u60f3\u6cd5";
    textInput!.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-task-plan-text-save]")?.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-plan/text",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "\u65b0\u7684\u6587\u5b57\u60f3\u6cd5",
        }),
      }),
    );
    expect(page.textContent).toContain("\u65b0\u7684\u6587\u5b57\u60f3\u6cd5");

    const statusInput = page.querySelector<HTMLTextAreaElement>("[data-task-plan-status-input]");
    expect(statusInput).not.toBeNull();
    statusInput!.value = "\u624b\u52a8\u7f16\u8f91\u7684\u8fd1\u65e5\u72b6\u6001";
    statusInput!.dispatchEvent(new Event("input", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-task-plan-status-save]")?.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-plan/status",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          statusSummary: "\u624b\u52a8\u7f16\u8f91\u7684\u8fd1\u65e5\u72b6\u6001",
        }),
      }),
    );
    expect(page.textContent).toContain("\u624b\u52a8\u7f16\u8f91\u7684\u8fd1\u65e5\u72b6\u6001");

    page.querySelector<HTMLButtonElement>("[data-task-plan-status-refresh]")?.click();
    expect(page.querySelector("[data-task-plan-feedback-inline]")?.textContent).toContain("\u6b63\u5728\u5237\u65b0\u8fd1\u65e5\u72b6\u6001");
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-plan/status/refresh",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(page.textContent).toContain("\u7531\u540e\u7aef\u5237\u65b0\u7684\u8fd1\u65e5\u72b6\u6001");

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-filter=\"AI 生成\"]")?.click();
    expect(page.textContent).toContain("\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 2");
    expect(page.textContent).not.toContain("\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 1");

    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-add]")?.click();
    const poolTitleInput = page.querySelector<HTMLInputElement>("[data-task-plan-pool-title-input='draft-pool-1']");
    const poolSourceInput = page.querySelector<HTMLSelectElement>("[data-task-plan-pool-source-input='draft-pool-1']");
    const poolPriorityInput = page.querySelector<HTMLSelectElement>("[data-task-plan-pool-priority-input='draft-pool-1']");
    expect(poolTitleInput).not.toBeNull();
    expect(poolSourceInput).not.toBeNull();
    expect(poolPriorityInput).not.toBeNull();
    poolTitleInput!.value = "\u624b\u52a8\u65b0\u589e\u7684\u4efb\u52a1";
    poolTitleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    poolSourceInput!.value = "\u624b\u52a8\u65b0\u589e";
    poolSourceInput!.dispatchEvent(new Event("change", { bubbles: true }));
    poolPriorityInput!.value = "mid";
    poolPriorityInput!.dispatchEvent(new Event("change", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]")?.click();
    await flush();
    const poolSaveCall = fetchMock.mock.calls.find(([url]) => url === "/api/task-plan/pool");
    expect(poolSaveCall?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      headers: { "content-type": "application/json" },
    }));
    const poolSaveRequest = poolSaveCall?.[1] as RequestInit | undefined;
    const poolSaveBody = JSON.parse(String(poolSaveRequest?.body)) as { items: MockTaskPlanState["pool"]["items"] };
    expect(poolSaveBody.items).toEqual([
      { id: "pool-1", title: "\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 1", priority: "high", source: "\u6587\u5b57\u8f93\u5165" },
      { id: "pool-2", title: "\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 2", priority: "mid", source: "AI \u751f\u6210" },
      expect.objectContaining({
        id: "draft-pool-1",
        title: "\u624b\u52a8\u65b0\u589e\u7684\u4efb\u52a1",
        priority: "mid",
        source: "\u624b\u52a8\u65b0\u589e",
        createdAt: expect.any(String),
      }),
    ]);
    expect(page.textContent).toContain("\u624b\u52a8\u65b0\u589e\u7684\u4efb\u52a1");

    page.querySelector<HTMLButtonElement>("[data-task-plan-generate]")?.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-plan/generate",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(page.textContent).toContain("\u7ecf AI \u91cd\u65b0\u7f16\u6392\u7684\u65e5\u7a0b");

    page.querySelector<HTMLButtonElement>("[data-task-plan-schedule-edit-toggle]")?.click();
    const addButton = page.querySelector<HTMLButtonElement>("[data-task-plan-schedule-add]");
    expect(addButton).not.toBeNull();
    addButton!.click();
    const timeInput = page.querySelector<HTMLInputElement>("[data-task-plan-schedule-time-input='schedule-generated-1']");
    const titleInput = page.querySelector<HTMLInputElement>("[data-task-plan-schedule-title-input='schedule-generated-1']");
    const priorityInput = page.querySelector<HTMLSelectElement>("[data-task-plan-schedule-priority-input='schedule-generated-1']");
    expect(timeInput).not.toBeNull();
    expect(titleInput).not.toBeNull();
    expect(priorityInput).not.toBeNull();
    timeInput!.value = "10:15";
    timeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    titleInput!.value = "\u624b\u52a8\u5fae\u8c03\u540e\u7684\u65e5\u7a0b";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    priorityInput!.value = "mid";
    priorityInput!.dispatchEvent(new Event("change", { bubbles: true }));
    const newTimeInput = page.querySelector<HTMLInputElement>("[data-task-plan-schedule-time-input='draft-schedule-1']");
    const newTitleInput = page.querySelector<HTMLInputElement>("[data-task-plan-schedule-title-input='draft-schedule-1']");
    const newPriorityInput = page.querySelector<HTMLSelectElement>("[data-task-plan-schedule-priority-input='draft-schedule-1']");
    expect(newTimeInput).not.toBeNull();
    expect(newTitleInput).not.toBeNull();
    expect(newPriorityInput).not.toBeNull();
    newTimeInput!.value = "18:30";
    newTimeInput!.dispatchEvent(new Event("input", { bubbles: true }));
    newTitleInput!.value = "\u65b0\u589e\u7684\u665a\u95f4\u590d\u76d8";
    newTitleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    newPriorityInput!.value = "low";
    newPriorityInput!.dispatchEvent(new Event("change", { bubbles: true }));
    page.querySelector<HTMLButtonElement>("[data-task-plan-schedule-remove='schedule-generated-1']")?.click();
    page.querySelector<HTMLButtonElement>("[data-task-plan-schedule-save]")?.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-plan/schedule",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: "draft-schedule-1",
              title: "\u65b0\u589e\u7684\u665a\u95f4\u590d\u76d8",
              startTime: "18:30",
              priority: "low",
            },
          ],
          confirmed: true,
        }),
      }),
    );
    expect(page.textContent).toContain("\u5fae\u8c03\u5df2\u4fdd\u5b58");
    expect(page.textContent).toContain("\u65b0\u589e\u7684\u665a\u95f4\u590d\u76d8");

    expect(page.querySelector("[data-task-plan-roadmap-nav='prev']")).toBeNull();
    expect(page.querySelector("[data-task-plan-bottom]")).toBeNull();
    expect(page.textContent).not.toContain("\u9886\u57df\u4e0e\u9879\u76ee\u63a8\u8fdb");
    expect(page.querySelector("[data-task-plan-execute]")).toBeNull();
    expect(page.textContent).not.toContain("\u5f00\u59cb\u6267\u884c");
  });

  it("adds a new editable schedule row when Enter is pressed in edit mode", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-plan-schedule-edit-toggle]")?.click();

    const titleInput = page.querySelector<HTMLInputElement>("[data-task-plan-schedule-title-input='schedule-a']");
    expect(titleInput).not.toBeNull();
    titleInput!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush();

    expect(page.querySelectorAll("[data-task-plan-schedule-row]")).toHaveLength(2);
    expect(page.querySelector("[data-task-plan-schedule-row='draft-schedule-1']")).not.toBeNull();
  });

  it("reorders editable schedule rows by drag-and-drop and remaps time slots to the new order", async () => {
    const taskPlan = createMockTaskPlanFixture();
    taskPlan.state.schedule.items = [
      { id: "schedule-a", title: "\u6392\u671f A", startTime: "09:00", priority: "high" },
      { id: "schedule-b", title: "\u6392\u671f B", startTime: "10:30", priority: "mid" },
      { id: "schedule-c", title: "\u6392\u671f C", startTime: "14:00", priority: "low" },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/task-plan/state") {
        return jsonResponse({
          success: true,
          data: {
            state: taskPlan.state,
          },
        });
      }
      if (url === "/api/task-plan/schedule" && init?.method === "PUT") {
        return jsonResponse({
          success: true,
          data: {
            schedule: taskPlan.state.schedule,
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-task-plan-schedule-edit-toggle]")?.click();

    const firstRow = page.querySelector<HTMLElement>("[data-task-plan-schedule-row='schedule-a']");
    const lastRow = page.querySelector<HTMLElement>("[data-task-plan-schedule-row='schedule-c']");
    expect(firstRow).not.toBeNull();
    expect(lastRow).not.toBeNull();

    dispatchDragEvent(firstRow!, "dragstart");
    dispatchDragEvent(lastRow!, "dragover");
    dispatchDragEvent(lastRow!, "drop");
    dispatchDragEvent(firstRow!, "dragend");
    await flush();

    page.querySelector<HTMLButtonElement>("[data-task-plan-schedule-save]")?.click();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/task-plan/schedule",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: "schedule-b", title: "\u6392\u671f B", startTime: "09:00", priority: "mid" },
            { id: "schedule-c", title: "\u6392\u671f C", startTime: "10:30", priority: "low" },
            { id: "schedule-a", title: "\u6392\u671f A", startTime: "14:00", priority: "high" },
          ],
          confirmed: true,
        }),
      }),
    );
  });

  it("renders the task-plan feedback inside the top action row", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    const actions = page.querySelector("[data-task-plan-assistant-actions]");
    const feedback = page.querySelector("[data-task-plan-feedback-inline]");
    expect(actions).not.toBeNull();
    expect(feedback).not.toBeNull();
    expect(actions?.contains(feedback as Node)).toBe(true);
  });

  it("renders the task plan assistant without the old roadmap split pane", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    const layout = page.querySelector<HTMLElement>("[data-task-plan-layout]");
    const handle = page.querySelector<HTMLElement>("[data-task-plan-split-handle]");
    expect(layout).not.toBeNull();
    expect(handle).toBeNull();
    expect(page.querySelector("[data-task-plan-bottom]")).toBeNull();
    expect(page.querySelector("[data-task-plan-assistant-layout]")).not.toBeNull();
    expect(page.textContent).not.toContain("\u9886\u57df\u4e0e\u9879\u76ee\u63a8\u8fdb");
  });

  it("keeps the task plan assistant expanded when local split state exists", async () => {
    localStorage.setItem("workspace.taskPlanSplitRatio", "0.1");
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    const layout = page.querySelector<HTMLElement>("[data-task-plan-layout]");
    const handle = page.querySelector<HTMLElement>("[data-task-plan-split-handle]");
    expect(layout).not.toBeNull();
    expect(handle).toBeNull();
    expect(layout?.dataset.taskPlanCollapse).toBeUndefined();
    expect(page.querySelector("[data-task-plan-assistant-layout]")).not.toBeNull();
  });

  it("keeps assistant feedback on a compact row so dragging down expands the card grid instead of blank space", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    const assistant = page.querySelector<HTMLElement>(".workspace-task-plan-poster__assistant");
    expect(assistant).not.toBeNull();
    expect(assistant?.dataset.taskPlanAssistantLayout).toBe("compact-feedback");
  });

  it("marks pool and schedule scrollers as flexible regions that can grow with the split layout", async () => {
    installTaskPlanFetchMock();
    const page = renderWorkspacePage();
    document.body.appendChild(page);

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();

    expect(page.querySelector("[data-task-plan-pool-list]")?.getAttribute("data-task-plan-scroll-mode")).toBe("flex");
    expect(page.querySelector("[data-task-plan-schedule-list]")?.getAttribute("data-task-plan-scroll-mode")).toBe("flex");
  });

  it("opens legacy toolbox workspace routes on the work-log source of truth", async () => {
    const savedDocs: Array<{ path?: string; raw?: string }> = [];
    const deletedDocs: Array<{ paths?: string[] }> = [];
    const fetchMock = installWorkspaceDocsFetchMock(savedDocs, deletedDocs);

    window.location.hash = "#/workspace/toolbox/assets";
    const page = renderWorkspacePage({ routeSection: "toolbox/assets" });
    document.body.appendChild(page);
    await flush();
    await flush();

    expect(page.querySelector("[data-workspace-tab='toolbox']")).toBeNull();
    expect(page.querySelector("[data-workspace-view='toolbox']")).toBeNull();
    expect(page.querySelector("[data-workspace-tab='work-log']")?.getAttribute("data-active")).toBe("true");
    expect(page.querySelector("[data-workspace-view='work-log']")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/workspace/docs?mode=tree");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/toolbox");
  });

  it("renders work-log documents in place with the wiki shell", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    expect(page.querySelector("[data-workspace-tab='work-log']")?.getAttribute("data-active")).toBe("true");
    expect(fetch).toHaveBeenCalledWith("/api/workspace/docs?mode=tree");
    expect(page.querySelector("[data-workspace-tree]")?.textContent).toContain("案例库");
    expect(page.querySelector(".workspace-doc-tree__children--project .workspace-doc-tree__children--log")).not.toBeNull();
    expect(page.querySelector("[data-wiki-chrome]")).toBeNull();
    expect(page.querySelector(".wiki-page__lead")).toBeNull();
    expect(page.querySelector("[data-workspace-doc-editor]")?.classList.contains("wiki-page__article")).toBe(true);
    expect(page.querySelector("[data-workspace-work-log-toolbar]")).not.toBeNull();
    expect(page.querySelectorAll("[data-workspace-block-command]")).toHaveLength(8);
    expect(page.querySelector("[data-workspace-graphy]")).not.toBeNull();
    expect(page.querySelector("[data-workspace-stage]")).toBeNull();
  });

  it("renders the default work-log document before the tree request completes", async () => {
    const documents = workspaceDocsFixture();
    let resolveTree: (response: Response) => void = () => {};
    const treeResponse = new Promise<Response>((resolve) => {
      resolveTree = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/workspace/docs?mode=tree") {
        return treeResponse;
      }
      if (url.startsWith("/api/workspace/docs?path=")) {
        return workspaceDocumentContentResponse(url, documents);
      }
      if (url.startsWith("/api/workspace/graph?")) {
        return workspaceGraphResponse(url);
      }
      const relationResponse = workspaceRelationRequestResponse(url, undefined, documents, []);
      if (relationResponse) return relationResponse;
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderWorkspacePage({ routeSection: "work-log" });
    document.body.appendChild(page);
    await flush();
    await flush();

    expect(page.querySelector("[data-workspace-doc-editor]")?.textContent).toContain("总览");
    expect(page.querySelector("[data-workspace-tree]")?.textContent).not.toContain("示例：信息消费失控案例");

    resolveTree(jsonOk({ success: true, data: { documents: documents.map(toWorkspaceDocSummary) } }));
    await flush();

    expect(page.querySelector("[data-workspace-tree]")?.textContent).toContain("案例库");
  });

  it("opens work-log wikilinks through the shared knowledge preview handler", async () => {
    const savedDocs: Array<{ path?: string; raw?: string }> = [];
    const deletedDocs: Array<{ paths?: string[] }> = [];
    const fetchMock = installWorkspaceDocsFetchMock(savedDocs, deletedDocs);
    const onOpenKnowledgePreview = vi.fn();
    const outerClick = vi.fn();
    const page = renderWorkspacePage({ routeSection: "work-log", onOpenKnowledgePreview });
    document.body.appendChild(page);
    await flush();
    await flush();

    page.querySelector<HTMLButtonElement>(
      "[data-workspace-doc-id='work-log:01-项目工作区/产品/LLM Wiki WebUI/工作日志']",
    )?.click();
    await flush();
    await flush();

    const link = page.querySelector<HTMLAnchorElement>(
      "[data-knowledge-preview-path='wiki/专题/01-案例库/示例-信息消费失控案例.md']",
    );
    document.body.addEventListener("click", outerClick);
    link?.click();
    document.body.removeEventListener("click", outerClick);

    expect(link?.classList.contains("wikilink")).toBe(true);
    expect(onOpenKnowledgePreview).toHaveBeenCalledWith("wiki/专题/01-案例库/示例-信息消费失控案例.md");
    expect(outerClick).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/workspace/docs?path="));
  });

  it("loads work-log Graphy from the workspace graph endpoint", async () => {
    const { fetchMock } = await setupWorkspaceDocsPage();
    await flush();

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.some((url) => url.startsWith("/api/workspace/graph?nodeId=root"))).toBe(true);
    expect(requestedUrls.some((url) => url.startsWith("/api/workspace/relations?nodeId=root"))).toBe(true);
    expect(requestedUrls.some((url) => url.startsWith("/api/wiki/graph"))).toBe(false);
  });

  it("adds editable work-log relations from the Graphy panel", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();
    for (let attempt = 0; attempt < 6 && !page.querySelector("[data-workspace-relation-type]"); attempt += 1) {
      await flush();
    }

    const typeSelect = page.querySelector<HTMLSelectElement>("[data-workspace-relation-type]");
    const targetSelect = page.querySelector<HTMLSelectElement>("[data-workspace-relation-target]");
    const addButton = page.querySelector<HTMLButtonElement>("[data-workspace-relation-add]");
    expect(typeSelect).not.toBeNull();
    expect(targetSelect).not.toBeNull();
    expect(addButton?.disabled).toBe(false);
    typeSelect!.value = "uses_method";
    targetSelect!.value = "work-log:02-沉淀库/方法库/方法候选";
    addButton?.click();
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/workspace/relations", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("uses_method"),
    }));
    expect(page.querySelector("[data-workspace-relations]")?.textContent).toContain("方法候选");
  });

  it("keeps work-log Graphy floated and reflows while dragging", async () => {
    window.localStorage.removeItem("workspace.graphyFloatPosition");
    const { page, fetchMock } = await setupWorkspaceDocsPage();
    const panel = page.querySelector<HTMLElement>("[data-workspace-graphy]");
    const handle = page.querySelector<HTMLElement>("[data-workspace-graphy-handle]");

    expect(page.querySelector("[data-workspace-article-layout]")).not.toBeNull();
    expect(panel?.style.getPropertyValue("--workspace-graphy-right")).toBe("0px");
    expect(panel?.style.getPropertyValue("--workspace-graphy-top")).toBe("0px");
    expect(handle).not.toBeNull();

    Object.defineProperty(handle!, "setPointerCapture", { value: vi.fn(), configurable: true });
    Object.defineProperty(handle!, "releasePointerCapture", { value: vi.fn(), configurable: true });
    handle!.dispatchEvent(createWorkspacePointerEvent("pointerdown", {
      bubbles: true,
      clientX: 500,
      clientY: 20,
      pointerId: 7,
    }));
    handle!.dispatchEvent(createWorkspacePointerEvent("pointermove", {
      bubbles: true,
      clientX: 440,
      clientY: 68,
      pointerId: 7,
    }));

    expect(panel?.style.getPropertyValue("--workspace-graphy-right")).toBe("60px");
    expect(panel?.style.getPropertyValue("--workspace-graphy-top")).toBe("48px");

    handle!.dispatchEvent(createWorkspacePointerEvent("pointerup", {
      bubbles: true,
      clientX: 440,
      clientY: 68,
      pointerId: 7,
    }));

    expect(window.localStorage.getItem("workspace.graphyFloatPosition")).toBe(JSON.stringify({ x: 60, y: 48 }));
  });

  it("collapses and expands work-log tree branches from explicit toggles", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    const domainDetails = page.querySelector<HTMLDetailsElement>(
      "[data-workspace-domain-details='01-项目工作区']",
    );
    expect(domainDetails?.open).toBe(true);
    page.querySelector<HTMLButtonElement>("[data-workspace-domain-toggle='01-项目工作区']")?.click();
    await flush();
    expect(page.querySelector<HTMLDetailsElement>("[data-workspace-domain-details='01-项目工作区']")?.open).toBe(false);

    page.querySelector<HTMLButtonElement>("[data-workspace-domain-toggle='01-项目工作区']")?.click();
    await flush();
    expect(page.querySelector<HTMLDetailsElement>("[data-workspace-domain-details='01-项目工作区']")?.open).toBe(true);

    page.querySelector<HTMLButtonElement>("[data-workspace-project-toggle='01-项目工作区/产品']")?.click();
    await flush();
    expect(page.querySelector<HTMLDetailsElement>("[data-workspace-project-details='01-项目工作区/产品']")?.open).toBe(false);
  });

  it("shows failed methods and completed tasks under the archive branch", async () => {
    const { page } = await setupWorkspaceDocsPage();
    const archiveTree = page.querySelector<HTMLDetailsElement>("[data-workspace-domain-details='03-归档']");

    expect(archiveTree?.textContent).toContain("失败的方法");
    expect(archiveTree?.textContent).toContain("失败方法");
    expect(archiveTree?.textContent).toContain("已完成领域、项目、任务");
    expect(archiveTree?.textContent).toContain("上线后对全部代码做一次review");

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='work-log:03-归档/失败的方法/method-failed.md']")?.click();
    await flush();
    await flush();

    expect(page.querySelector("[data-workspace-doc-editor]")?.textContent).toContain("记录失败条件");
  });

  it("keeps the work-log tree scroll position when selecting documents", async () => {
    const { page } = await setupWorkspaceDocsPage();
    const tree = page.querySelector<HTMLElement>("[data-workspace-tree]");
    expect(tree).not.toBeNull();
    tree!.scrollTop = 720;

    page.querySelector<HTMLButtonElement>(
      "[data-workspace-doc-id='work-log:01-项目工作区/产品/LLM Wiki WebUI/工作日志']",
    )?.click();
    await flush();
    await flush();

    expect(page.querySelector<HTMLElement>("[data-workspace-tree]")?.scrollTop).toBe(720);
    expect(page.querySelector("[data-workspace-doc-editor]")?.textContent).toContain("Updated the workspace documents.");
  });

  it("renders the execution-site workbench as one page", async () => {
    const { page } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:00-执行现场']")?.click();
    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledWith("/api/workflow-artifacts");
    expect(fetch).toHaveBeenCalledWith("/api/task-plan/state");
    expect(page.querySelector("[data-execution-workbench]")?.textContent).toContain("待处理队列");
    expect(page.querySelector("[data-execution-workbench]")?.textContent).toContain("待绑定任务");
    expect(page.querySelector("[data-workspace-doc-editor]")).toBeNull();
    page.querySelector<HTMLButtonElement>("[data-execution-tab='archive']")?.click();
    expect(page.querySelector("[data-execution-queue='archive']")?.classList.contains("is-active")).toBe(true);
    expect(page.querySelector<HTMLSelectElement>("[data-execution-archive-task='pending-archive-1']")).not.toBeNull();
    expect(page.querySelector<HTMLButtonElement>("[data-execution-archive-record='pending-archive-1']")).not.toBeNull();
  });

  it("archives execution-site pending records into a selected task", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:00-执行现场']")?.click();
    await flush();
    await flush();
    page.querySelector<HTMLButtonElement>("[data-execution-tab='archive']")?.click();

    const select = page.querySelector<HTMLSelectElement>("[data-execution-archive-task='pending-archive-1']");
    const button = page.querySelector<HTMLButtonElement>("[data-execution-archive-record='pending-archive-1']");
    expect(select?.textContent).toContain("工作日志整合");
    expect(button?.disabled).toBe(true);

    select!.value = "task-work-log";
    select!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(button?.disabled).toBe(false);
    button?.click();
    await flush();
    await flush();

    const archiveCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/workflow-recorder/archive");
    expect(archiveCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(archiveCall?.[1]?.body))).toEqual({
      recordId: "pending-archive-1",
      taskId: "task-work-log",
    });
  });

  it("renders the project workspace as a connected execution hierarchy with time windows", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/task-plan/state");
    expectProjectWorkspaceGraph(page);
    expect(page.querySelector("[data-workspace-doc-editor]")).toBeNull();
  });

  it("filters the project workspace to unfinished items by default", async () => {
    const { page } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const completedTask = page.querySelector<HTMLElement>("[data-project-node-id='task-completed-review']");
    expect(completedTask?.closest<HTMLElement>("[data-project-filter-scope]")?.hidden).toBe(true);
    expect(page.querySelector<HTMLButtonElement>("button[data-project-workspace-filter='unfinished']")?.className)
      .toContain("is-active");

    page.querySelector<HTMLButtonElement>("button[data-project-workspace-filter='all']")?.click();
    expect(completedTask?.closest<HTMLElement>("[data-project-filter-scope]")?.hidden).toBe(false);
  });

  it("collapses and expands project workspace hierarchy branches", async () => {
    const { page } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const domainToggle = findProjectWorkspaceCollapseToggle(page, "domain:个人知识库");
    const domainTarget = readProjectWorkspaceCollapseTarget(domainToggle);
    expect(domainToggle).not.toBeNull();
    expect(domainTarget?.textContent).toContain("LLM Wiki");

    domainToggle!.click();
    expect(domainToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(domainTarget?.hidden).toBe(true);

    domainToggle!.click();
    expect(domainToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(domainTarget?.hidden).toBe(false);

    const projectToggle = findProjectWorkspaceCollapseToggle(page, "project:个人知识库:LLM Wiki");
    const projectTarget = readProjectWorkspaceCollapseTarget(projectToggle);
    expect(projectTarget?.textContent).toContain("Graphy 布局卡点");

    projectToggle!.click();
    expect(projectToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(projectTarget?.hidden).toBe(true);
  });

  it("links project workspace time windows back to graph nodes and persists split width", async () => {
    window.localStorage.removeItem("workspace.projectWorkspaceSplit");
    window.localStorage.removeItem("workspace.projectWorkspaceGraphScale");
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    page.querySelector<HTMLButtonElement>("[data-project-window-task='task-graphy-layout']")?.click();
    expect(page.querySelector("[data-project-node-id='task-graphy-layout']")?.className).toContain("is-highlighted");
    expect(fetchMock.mock.calls.some(([url, init]) =>
      url === "/api/task-plan/pool" && (init as RequestInit | undefined)?.method === "PUT"
    )).toBe(false);

    const layout = page.querySelector<HTMLElement>("[data-project-workspace-layout]");
    const handle = page.querySelector<HTMLElement>("[data-project-workspace-split]");
    expect(layout).not.toBeNull();
    expect(handle).not.toBeNull();

    vi.spyOn(layout!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON() {
        return {};
      },
    } as DOMRect);

    handle!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 600 }));
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 650 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 650 }));

    expect(layout?.style.getPropertyValue("--project-workspace-left-ratio")).toBe("0.65");
    expect(window.localStorage.getItem("workspace.projectWorkspaceSplit")).toBe("0.65");

    page.querySelector<HTMLButtonElement>("[data-project-graph-zoom='out']")?.click();
    expect(page.querySelector<HTMLElement>("[data-project-graph-layer]")?.style.getPropertyValue("--project-workspace-graph-scale")).toBe("0.9");
    expect(window.localStorage.getItem("workspace.projectWorkspaceGraphScale")).toBe("0.9");
  });

  it("drags project workspace tasks into today windows and syncs the task plan schedule", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const taskNode = page.querySelector<HTMLElement>("[data-project-task-node='task-method-review']");
    const windowList = page.querySelector<HTMLElement>("[data-project-workspace-window-list]");
    expect(taskNode).not.toBeNull();
    expect(windowList).not.toBeNull();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(taskNode!, "dragstart", transfer);
    dispatchDragEvent(windowList!, "drop", transfer);
    await flush();
    await flush();

    const scheduleCall = fetchMock.mock.calls.find(([url, init]) =>
      url === "/api/task-plan/schedule" && (init as RequestInit | undefined)?.method === "PUT"
    );
    expect(scheduleCall).toBeTruthy();
    const body = JSON.parse(String((scheduleCall?.[1] as RequestInit).body)) as {
      items: Array<{ id: string; title: string; priority: MockTaskPlanPriority }>;
    };
    expect(body.items.at(-1)).toMatchObject({ id: "task-method-review", title: "方法库验收", priority: "low" });
    expect(page.querySelector("[data-project-workspace-window-list]")?.textContent).toContain("方法库验收");

    page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-plan']")?.click();
    await flush();
    expect(page.querySelector("[data-task-plan-schedule-list]")?.textContent).toContain("方法库验收");
  });

  it("creates project workspace stages tasks and actions from keyboard shortcuts", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const projectNode = page.querySelector<HTMLElement>("[data-project-node-id='project:个人知识库:LLM Wiki']");
    expect(projectNode).not.toBeNull();
    dispatchProjectWorkspaceShortcut(projectNode!, "Tab");
    await flush();
    await flush();

    let body = readProjectWorkspacePoolSaveBody(fetchMock);
    const stage = body.stages?.find((item) => item.title === "新阶段" && item.project === "LLM Wiki");
    expect(stage).toBeTruthy();

    const stageNode = page.querySelector<HTMLElement>(`[data-project-stage-node='${stage?.id}']`);
    expect(stageNode).not.toBeNull();
    dispatchProjectWorkspaceShortcut(stageNode!, "Tab");
    await flush();
    await flush();

    body = readProjectWorkspacePoolSaveBody(fetchMock);
    const task = body.items.find((item) => item.title === "新任务" && item.stageId === stage?.id);
    expect(task).toBeTruthy();

    const taskNode = page.querySelector<HTMLElement>(`[data-project-task-node='${task?.id}']`);
    expect(taskNode).not.toBeNull();
    dispatchProjectWorkspaceShortcut(taskNode!, "Tab");
    await flush();

    body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === task?.id)?.actions?.at(0)?.title).toBe("新行动");
  });

  it("previews project workspace stage moves and persists the stage after drop", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const dragged = page.querySelector<HTMLElement>("[data-project-task-node='task-method-review']");
    const stage = Array.from(page.querySelectorAll<HTMLElement>("[data-project-stage-node]"))
      .find((node) => node.textContent?.includes("同步推进"));
    expect(dragged).not.toBeNull();
    expect(stage).not.toBeNull();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(dragged!, "dragstart", transfer);
    dispatchDragEvent(stage!, "dragover", transfer);

    expect(stage?.className).toContain("is-drop-preview");
    expect(fetchMock.mock.calls.some(([url, init]) =>
      url === "/api/task-plan/pool" && (init as RequestInit | undefined)?.method === "PUT"
    )).toBe(false);

    dispatchDragEvent(stage!, "drop", transfer);
    await flush();

    const body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-method-review")).toMatchObject({
      domain: "个人知识库",
      project: "LLM Wiki",
      stageId: stage?.dataset.projectStageNode,
    });
  });

  it("drops project workspace task cards onto phase columns", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const dragged = page.querySelector<HTMLElement>("[data-project-task-node='task-method-review']");
    const phase = page.querySelector<HTMLElement>("[data-project-workspace-phase='阶段 2 · 同步推进']");
    expect(dragged).not.toBeNull();
    expect(phase).not.toBeNull();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(dragged!, "dragstart", transfer);
    dispatchDragEvent(phase!, "dragover", transfer);

    expect(phase?.className).toContain("is-drop-preview");

    dispatchDragEvent(phase!, "drop", transfer);
    await flush();

    const body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-method-review")).toMatchObject({
      domain: "个人知识库",
      project: "LLM Wiki",
      stageId: phase?.dataset.projectStageDropNode,
    });
  });

  it("moves project workspace tasks with mouse drag onto phase columns", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const dragged = page.querySelector<HTMLElement>("[data-project-task-node='task-method-review']");
    const phase = page.querySelector<HTMLElement>("[data-project-workspace-phase='阶段 2 · 同步推进']");
    expect(dragged).not.toBeNull();
    expect(phase).not.toBeNull();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => phase),
    });

    dispatchMouseEvent(dragged!, "mousedown", { clientX: 10, clientY: 10 });
    dispatchMouseEvent(document, "mousemove", { clientX: 40, clientY: 40 });

    expect(phase?.className).toContain("is-drop-preview");

    dispatchMouseEvent(document, "mouseup", { clientX: 40, clientY: 40 });
    await flush();

    const body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-method-review")).toMatchObject({
      domain: "个人知识库",
      project: "LLM Wiki",
      stageId: phase?.dataset.projectStageDropNode,
    });
  });

  it("moves project workspace action cards between tasks without moving the source task", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const action = page.querySelector<HTMLElement>("[data-project-action-node='action-work-log-outline']");
    const target = page.querySelector<HTMLElement>("[data-project-task-node='task-graphy-layout']");
    expect(action).not.toBeNull();
    expect(target).not.toBeNull();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(action!, "dragstart", transfer);
    dispatchDragEvent(target!, "drop", transfer);
    await flush();

    const body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-work-log")?.actions ?? []).toHaveLength(0);
    expect(body.items.find((item) => item.id === "task-graphy-layout")?.actions?.at(-1)?.id)
      .toBe("action-work-log-outline");
    expect(body.items.find((item) => item.id === "task-work-log")?.project).toBe("LLM Wiki");
  });

  it("deletes project workspace task and action cards", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const actionDelete = page
      .querySelector<HTMLElement>("[data-project-action-node='action-work-log-outline']")
      ?.closest<HTMLElement>(".project-workspace-node-frame")
      ?.querySelector<HTMLButtonElement>("[data-project-node-delete]");
    expect(actionDelete).not.toBeNull();
    actionDelete?.click();
    await flush();

    let body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-work-log")?.actions ?? []).toHaveLength(0);
    expect(body.items.find((item) => item.id === "task-work-log")).toBeTruthy();

    const taskDelete = page
      .querySelector<HTMLElement>("[data-project-task-node='task-method-review']")
      ?.closest<HTMLElement>(".project-workspace-node-frame")
      ?.querySelector<HTMLButtonElement>("[data-project-node-delete]");
    expect(taskDelete).not.toBeNull();
    taskDelete?.click();
    await flush();

    body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.some((item) => item.id === "task-method-review")).toBe(false);
  });

  it("moves project workspace task cards onto empty stages", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const projectNode = page.querySelector<HTMLElement>("[data-project-node-id='project:个人知识库:LLM Wiki']");
    expect(projectNode).not.toBeNull();
    dispatchProjectWorkspaceShortcut(projectNode!, "Tab");
    await flush();
    await flush();

    const bodyAfterCreate = readProjectWorkspacePoolSaveBody(fetchMock);
    const emptyStage = bodyAfterCreate.stages?.find((item) => item.title === "新阶段" && item.project === "LLM Wiki");
    const dragged = page.querySelector<HTMLElement>("[data-project-task-node='task-method-review']");
    const phase = page.querySelector<HTMLElement>(`[data-project-stage-drop-node='${emptyStage?.id}']`);
    expect(dragged).not.toBeNull();
    expect(phase).not.toBeNull();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(dragged!, "dragstart", transfer);
    dispatchDragEvent(phase!, "drop", transfer);
    await flush();

    const body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-method-review")).toMatchObject({
      domain: "个人知识库",
      project: "LLM Wiki",
      stageId: emptyStage?.id,
    });
  });

  it("moves project workspace task cards across projects", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const dragged = page.querySelector<HTMLElement>("[data-project-task-node='task-graphy-layout']");
    const target = page.querySelector<HTMLElement>("[data-project-task-node='task-method-review']");
    expect(dragged).not.toBeNull();
    expect(target).not.toBeNull();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(dragged!, "dragstart", transfer);
    dispatchDragEvent(target!, "drop", transfer);
    await flush();

    const body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-graphy-layout")?.projectOrder).toBe(1);
    expect(body.items.find((item) => item.id === "task-method-review")?.projectOrder).toBe(2);
    expect(body.items.find((item) => item.id === "task-graphy-layout")).toMatchObject({
      domain: "个人知识库",
      project: "知识沉淀",
    });
  });

  it("moves project workspace project cards across domains", async () => {
    const { page, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:01-项目工作区']")?.click();
    await flush();
    await flush();

    const dragged = page.querySelector<HTMLElement>("[data-project-node-id='project:个人知识库:知识沉淀']");
    const target = page.querySelector<HTMLElement>("[data-project-node-id='domain:健康']");
    expect(dragged).not.toBeNull();
    expect(target).not.toBeNull();

    const transfer = createMockDataTransfer();
    dispatchDragEvent(dragged!, "dragstart", transfer);
    dispatchDragEvent(target!, "drop", transfer);
    await flush();

    const body = readProjectWorkspacePoolSaveBody(fetchMock);
    expect(body.items.find((item) => item.id === "task-method-review")).toMatchObject({
      domain: "健康",
      project: "知识沉淀",
    });
  });

  it("renders the deposit library as method and tool lanes with draggable validation columns", async () => {
    const { page, savedDocs, fetchMock } = await setupWorkspaceDocsPage();

    page.querySelector<HTMLButtonElement>("[data-workspace-doc-id='domain:02-沉淀库']")?.click();
    await flush();

    expect(page.querySelector("[data-workspace-library-gallery]")).not.toBeNull();
    expect(page.querySelector("[data-workspace-tree]")?.textContent).toContain("案例库");
    expect(page.querySelector("[data-workspace-tree]")?.textContent).not.toContain("工具箱");
    expect(page.querySelector("[data-workspace-tree]")?.textContent).not.toContain("方法候选");
    expect(page.querySelector("[data-workspace-library-kind='case']")).toBeNull();
    expect(page.querySelector("[data-workspace-library-kind='method']")?.textContent).toContain("待验证");
    expect(page.querySelector("[data-workspace-library-kind='method']")?.textContent).toContain("方法候选");
    expect(page.querySelector("[data-workspace-library-kind='tool']")?.textContent).toContain("Figma");
    page.querySelector<HTMLButtonElement>(
      "[data-workspace-gallery-card='wiki/专题/02-方法库/待验证/method-1.md']",
    )?.click();
    await flush();
    expect(page.querySelector(".workspace-library-detail")?.textContent).toContain("用于验证画册视图。");

    const editor = page.querySelector<HTMLElement>("[data-workspace-gallery-editor]");
    editor!.innerHTML = "<h1>方法候选 Pro</h1><p>保存详情。</p>";
    page.querySelector<HTMLButtonElement>("[data-workspace-gallery-save]")?.click();
    await flush();

    expect(savedDocs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "wiki/专题/02-方法库/待验证/method-1.md",
        raw: expect.stringContaining("保存详情。"),
      }),
    ]));

    const transfer = createMockDataTransfer();
    const methodCard = page.querySelector<HTMLElement>(
      "[data-workspace-gallery-card='wiki/专题/02-方法库/待验证/method-1.md']",
    );
    const successColumn = page.querySelector<HTMLElement>(
      "[data-workspace-gallery-drop-status='已验证但成功']",
    );
    expect(methodCard).not.toBeNull();
    expect(successColumn).not.toBeNull();

    dispatchDragEvent(methodCard!, "dragstart", transfer);
    dispatchDragEvent(successColumn!, "dragover", transfer);
    expect(successColumn?.className).toContain("is-drop-preview");
    dispatchDragEvent(successColumn!, "drop", transfer);
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/workspace/docs/status", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        path: "wiki/专题/02-方法库/待验证/method-1.md",
        status: "已验证但成功",
      }),
    }));
    expect(page.querySelector(
      "[data-workspace-gallery-card='wiki/专题/02-方法库/已验证但成功/method-1.md']",
    )).not.toBeNull();
  });

  it("saves edited work-log documents from the workspace page", async () => {
    const { page, savedDocs } = await setupWorkspaceDocsPage();
    page.querySelector<HTMLButtonElement>(
      "[data-workspace-doc-id='work-log:01-项目工作区/产品/LLM Wiki WebUI/工作日志']",
    )?.click();
    await flush();
    const editor = page.querySelector<HTMLElement>("[data-workspace-doc-editor]");

    expect(window.location.hash).toBe("#/workspace/work-log");
    expect(editor?.textContent).toContain("Updated the workspace documents.");
    editWorkspaceDoc(editor!);
    await flush();

    expect(savedDocs).toEqual([
      expect.objectContaining({
        path: "领域/产品/LLM Wiki WebUI/工作日志.md",
        raw: expect.stringContaining("Edited in workspace"),
      }),
    ]);
    expect(savedDocs[0]?.raw).toContain("[link](https://example.com)");
    expect(savedDocs[0]?.raw).toContain("- [x] Ship task block");
    expect(savedDocs[0]?.raw).toContain("> Quoted note");
    expect(savedDocs[0]?.raw).toContain("```");
    expect(savedDocs[0]?.raw).toContain("![Diagram](./asset.png)");
    expect(page.querySelector("[data-workspace-doc-id='work-log:01-项目工作区/产品/LLM Wiki WebUI/工作日志']")?.textContent).toContain("Work Log");
  });

  it("deletes topic pages with their child work-log documents", async () => {
    const { page, deletedDocs } = await setupWorkspaceDocsPage();
    page.querySelector<HTMLButtonElement>("[data-workspace-doc-delete='domain:01-案例库']")?.click();
    await flush();

    expect(page.querySelector(".workspace-doc-delete-dialog")?.textContent).toContain("包括 1 个子页面");
    page.querySelector<HTMLButtonElement>("[data-workspace-doc-delete-confirm='children']")?.click();
    await flush();

    expect(deletedDocs).toEqual([
      {
        paths: [
          "wiki/专题/01-案例库/index.md",
          "wiki/专题/01-案例库/示例-信息消费失控案例.md",
        ],
      },
    ]);
    expect(page.querySelector("[data-workspace-doc-id='domain:01-案例库']")).toBeNull();
    expect(page.querySelector("[data-workspace-doc-id='work-log:01-案例库/示例-信息消费失控案例']")).toBeNull();
  });
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function findProjectWorkspaceCollapseToggle(page: ParentNode, id: string): HTMLButtonElement | null {
  return Array.from(page.querySelectorAll<HTMLButtonElement>("[data-project-collapse-toggle]"))
    .find((toggle) => toggle.dataset.projectCollapseToggle === id) ?? null;
}

function readProjectWorkspaceCollapseTarget(toggle: HTMLElement | null): HTMLElement | null {
  const group = toggle?.closest<HTMLElement>("[data-project-collapse-group]");
  if (!group) return null;
  return Array.from(group.children).find((child): child is HTMLElement =>
    child instanceof HTMLElement && child.hasAttribute("data-project-collapse-target")
  ) ?? null;
}

function expectProjectWorkspaceGraph(page: HTMLElement): void {
  const graph = page.querySelector("[data-project-workspace-graph]");
  const windowList = page.querySelector("[data-project-workspace-window-list]");
  expect(page.querySelector("[data-project-workspace]")).not.toBeNull();
  expect(graph).not.toBeNull();
  expect(windowList).not.toBeNull();
  const graphText = graph!.textContent ?? "";
  const windowText = windowList!.textContent ?? "";
  expect(graphText).toContain("个人知识库");
  expect(graphText).toContain("LLM Wiki");
  expect(graphText).toContain("工作日志整合");
  expect(graphText).toContain("确认项目工作区布局");
  expect(graphText).toContain("阶段 2 · 同步推进");
  expect(graphText).toContain("2 个任务同步");
  expect(graphText).not.toContain("补充下一步行动");
  const activePhase = Array.from(page.querySelectorAll<HTMLElement>("[data-project-workspace-phase='阶段 2 · 同步推进']"))
    .find((phase) => phase.textContent?.includes("工作日志整合"));
  expect(activePhase?.textContent).toContain("Graphy 布局卡点");
  expect(page.querySelectorAll("[data-project-workspace-link]")).toHaveLength(13);
  expect(windowText).toContain("10:30");
  expect(windowText).toContain("Graphy 布局卡点");
  expect(readProjectNodeText(page, "task-graphy-layout")).toContain("正在进行");
  expect(readProjectNodeText(page, "task-method-review")).toContain("未确定");
}

function readProjectNodeText(page: HTMLElement, nodeId: string): string {
  const node = page.querySelector(`[data-project-node-id='${nodeId}']`);
  expect(node).not.toBeNull();
  return node!.textContent ?? "";
}

function createWorkspacePointerEvent(
  type: string,
  init: MouseEventInit & { pointerId: number },
): Event {
  const EventConstructor = typeof window.PointerEvent === "function" ? window.PointerEvent : MouseEvent;
  const event = new EventConstructor(type, init);
  if (!("pointerId" in event)) {
    Object.defineProperty(event, "pointerId", { value: init.pointerId });
  }
  return event;
}

async function setupWorkspaceDocsPage(): Promise<{
  page: HTMLElement;
  fetchMock: ReturnType<typeof vi.fn>;
  savedDocs: Array<{ path?: string; raw?: string }>;
  deletedDocs: Array<{ paths?: string[] }>;
}> {
  const savedDocs: Array<{ path?: string; raw?: string }> = [];
  const deletedDocs: Array<{ paths?: string[] }> = [];
  const fetchMock = installWorkspaceDocsFetchMock(savedDocs, deletedDocs);
  const page = renderWorkspacePage();
  document.body.appendChild(page);
  page.querySelector<HTMLButtonElement>("[data-workspace-tab='work-log']")?.click();
  await flush();
  return { page, fetchMock, savedDocs, deletedDocs };
}

function editWorkspaceDoc(editor: HTMLElement): void {
  editor.innerHTML = `
    <h1>Work Log</h1>
    <p>Edited in workspace with <a href="https://example.com">link</a>.</p>
    <ul><li><input type="checkbox" checked> Ship task block</li></ul>
    <blockquote><p>Quoted note</p></blockquote>
    <pre><code>const ok = true;</code></pre>
    <p><img src="./asset.png" alt="Diagram"></p>
  `;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.dispatchEvent(new Event("blur", { bubbles: true }));
}

function installWorkspaceDocsFetchMock(
  savedDocs: Array<{ path?: string; raw?: string }>,
  deletedDocs: Array<{ paths?: string[] }>,
): ReturnType<typeof vi.fn> {
  const documents = workspaceDocsFixture();
  const taskPlan = { state: projectWorkspaceTaskPlanFixture() as MockTaskPlanState };
  const relations: Array<{ id: string; sourceId: string; targetId: string; type: string }> = [];
  // Route-style mock keeps workspace docs fixture behavior in one place.
  // fallow-ignore-next-line complexity
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const taskPlanResponse = projectWorkspaceTaskPlanResponse(url, init, taskPlan);
    if (taskPlanResponse) return taskPlanResponse;
    if (url === "/api/workspace/docs?mode=tree" || url === "/api/workspace/docs") {
      return workspaceDocsResponse(init, savedDocs, deletedDocs, documents);
    }
    if (url === "/api/workspace/docs/status" && init?.method === "POST") {
      return workspaceGalleryStatusResponse(init, documents);
    }
    if (url.startsWith("/api/workspace/docs?path=")) {
      return workspaceDocumentContentResponse(url, documents);
    }
    if (url.startsWith("/api/workspace/graph?")) {
      return workspaceGraphResponse(url);
    }
    const relationResponse = workspaceRelationRequestResponse(url, init, documents, relations);
    if (relationResponse) {
      return relationResponse;
    }
    if (url.startsWith("/api/page?")) {
      return workspacePageResponse(url, documents);
    }
    if (url === "/api/workflow-artifacts") {
      return jsonOk({ success: true, data: workflowArtifactsFixture() });
    }
    if (url === "/api/workflow-recorder/archive" && init?.method === "POST") {
      return jsonOk({ success: true, data: { status: "archived", message: "已写入任务卡和项目工作日志" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function projectWorkspaceTaskPlanResponse(
  url: string,
  init: RequestInit | undefined,
  taskPlan: { state: MockTaskPlanState },
): Response | null {
  if (url === "/api/task-plan/state") {
    return jsonOk({ success: true, data: { state: taskPlan.state } });
  }
  if (url === "/api/task-plan/schedule" && init?.method === "PUT") {
    return updateProjectWorkspaceScheduleFixture(init, taskPlan);
  }
  if (url === "/api/task-plan/pool" && init?.method === "PUT") {
    return updateProjectWorkspacePoolFixture(init, taskPlan);
  }
  return null;
}

function updateProjectWorkspaceScheduleFixture(
  init: RequestInit,
  taskPlan: { state: MockTaskPlanState },
): Response {
  const payload = JSON.parse(String(init.body)) as {
    items: MockTaskPlanState["schedule"]["items"];
    confirmed: boolean;
  };
  taskPlan.state = { ...taskPlan.state, schedule: { ...taskPlan.state.schedule, ...payload } };
  return jsonOk({ success: true, data: { schedule: taskPlan.state.schedule } });
}

function updateProjectWorkspacePoolFixture(
  init: RequestInit,
  taskPlan: { state: MockTaskPlanState },
): Response {
  const payload = JSON.parse(String(init.body)) as {
    items: MockTaskPlanState["pool"]["items"];
    stages?: MockTaskPlanState["pool"]["stages"];
  };
  taskPlan.state = {
    ...taskPlan.state,
    pool: { ...taskPlan.state.pool, items: payload.items, stages: payload.stages ?? taskPlan.state.pool.stages },
  };
  return jsonOk({ success: true, data: { state: taskPlan.state } });
}

function workspaceRelationRequestResponse(
  url: string,
  init: RequestInit | undefined,
  documents: unknown[],
  relations: Array<{ id: string; sourceId: string; targetId: string; type: string }>,
): Response | null {
  if (url.startsWith("/api/workspace/relations/") && init?.method === "DELETE") {
    deleteWorkspaceRelationFixture(url, relations);
    return jsonOk({ success: true });
  }
  if (url === "/api/workspace/relations" && init?.method === "POST") {
    return createWorkspaceRelationFixture(init, relations);
  }
  return url.startsWith("/api/workspace/relations?") ? workspaceRelationsResponse(url, documents, relations) : null;
}

function deleteWorkspaceRelationFixture(
  url: string,
  relations: Array<{ id: string; sourceId: string; targetId: string; type: string }>,
): void {
  const id = decodeURIComponent(url.split("/").at(-1) ?? "");
  const index = relations.findIndex((relation) => relation.id === id);
  if (index >= 0) relations.splice(index, 1);
}

function createWorkspaceRelationFixture(
  init: RequestInit,
  relations: Array<{ id: string; sourceId: string; targetId: string; type: string }>,
): Response {
  const body = JSON.parse(String(init.body ?? "{}")) as { sourceId: string; targetId: string; type: string };
  relations.push({ id: `relation-${relations.length + 1}`, ...body });
  return jsonOk({ success: true, data: relations.at(-1) });
}

function workspaceRelationsResponse(
  url: string,
  documents: unknown[],
  relations: Array<{ id: string; sourceId: string; targetId: string; type: string }>,
): Response {
  const nodeId = new URL(url, "http://localhost").searchParams.get("nodeId") ?? "root";
  const nodes = documents.map(workspaceRelationNode).filter((node): node is WorkspaceRelationNodeFixture => Boolean(node));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return jsonOk({
    success: true,
    data: {
      current: nodeById.get(nodeId) ?? null,
      relations: relations
        .filter((relation) => relation.sourceId === nodeId || relation.targetId === nodeId)
        .map((relation) => ({
          id: relation.id,
          type: relation.type,
          typeLabel: relation.type === "uses_method" ? "使用方法" : "引用",
          source: nodeById.get(relation.sourceId),
          target: nodeById.get(relation.targetId),
        })),
      candidates: nodes.filter((node) => node.id !== nodeId),
      types: [{ value: "uses_method", label: "使用方法" }, { value: "references", label: "引用" }],
    },
  });
}

interface WorkspaceRelationNodeFixture {
  id: string;
  label: string;
  type: string;
  path: string;
}

function workspaceRelationNode(document: unknown): WorkspaceRelationNodeFixture | null {
  if (typeof document !== "object" || document === null) {
    return null;
  }
  const record = document as { id?: unknown; title?: unknown; label?: unknown; kind?: unknown; path?: unknown };
  if (typeof record.id !== "string" || typeof record.path !== "string") {
    return null;
  }
  return {
    id: record.id,
    label: String(record.title ?? record.label ?? record.id),
    type: String(record.kind ?? "work-log"),
    path: record.path,
  };
}

function workspaceGraphResponse(url: string): Response {
  const nodeId = new URL(url, "http://localhost").searchParams.get("nodeId") ?? "root";
  return jsonOk({
    success: true,
    data: {
      nodes: [
        {
          id: nodeId,
          label: "当前对象",
          path: "wiki/专题/index.md",
          type: "root",
          size: 11,
          color: "#111827",
        },
        {
          id: "domain:01-项目工作区",
          label: "项目工作区",
          path: "wiki/专题/01-项目工作区/index.md",
          type: "domain",
          size: 8,
          color: "#2563eb",
        },
      ],
      edges: [{ id: `${nodeId}::domain:01-项目工作区::双链`, source: nodeId, target: "domain:01-项目工作区", weight: 1, label: "双链" }],
    },
  });
}

function workspaceDocsResponse(
  init: RequestInit | undefined,
  savedDocs: Array<{ path?: string; raw?: string }>,
  deletedDocs: Array<{ paths?: string[] }>,
  documents: unknown[],
): Response {
  if (!init || init.method === undefined) {
    return jsonOk({ success: true, data: { documents: documents.map(toWorkspaceDocSummary) } });
  }
  if (init.method === "PUT") {
    savedDocs.push(JSON.parse(String(init.body ?? "{}")) as { path?: string; raw?: string });
    return jsonOk({ success: true });
  }
  if (init.method === "DELETE") {
    deletedDocs.push(JSON.parse(String(init.body ?? "{}")) as { paths?: string[] });
    return jsonOk({ success: true, data: deletedDocs.at(-1) });
  }
  throw new Error(`unexpected workspace docs method ${init.method}`);
}

function workspaceGalleryStatusResponse(init: RequestInit, documents: unknown[]): Response {
  const payload = JSON.parse(String(init.body ?? "{}")) as { path?: string; status?: string };
  const previousPath = payload.path ?? "";
  const status = payload.status ?? "";
  const nextPath = previousPath.replace(
    /\/(已验证但成功|待验证|已验证但失败)\//u,
    `/${status}/`,
  );
  const document = documents.find((item): item is { path: string; gallery?: { status?: string | null } } => {
    const record = item && typeof item === "object" ? item as { path?: unknown } : null;
    return record?.path === previousPath;
  });
  if (document) {
    document.path = nextPath;
    if (document.gallery) document.gallery.status = status;
  }
  return jsonOk({ success: true, data: { previousPath, path: nextPath, status } });
}

function workspaceDocumentContentResponse(url: string, documents: unknown[]): Response {
  const document = findWorkspaceDocumentByPath(url, documents);
  if (!document) {
    return { ok: false, json: async () => ({ success: false, error: "not found" }) } as Response;
  }
  return jsonOk({ success: true, data: { document } });
}

function workspacePageResponse(url: string, documents: unknown[]): Response {
  const document = findWorkspaceDocumentByPath(url, documents);
  if (!document) {
    return { ok: false, json: async () => ({}) } as Response;
  }
  return jsonOk(document);
}

function findWorkspaceDocumentByPath(url: string, documents: unknown[]): unknown | null {
  const path = new URL(url, "http://localhost").searchParams.get("path") ?? "";
  const document = documents.find((item) =>
    typeof item === "object"
      && item !== null
      && "path" in item
      && (item as { path?: unknown }).path === path
  );
  return document ?? null;
}

function toWorkspaceDocSummary(document: unknown): unknown {
  if (typeof document !== "object" || document === null) {
    return document;
  }
  if ((document as { contentLoaded?: unknown }).contentLoaded === true) {
    return document;
  }
  return {
    ...(document as Record<string, unknown>),
    html: "",
    raw: "",
  };
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function workspaceDocsFixture(): unknown[] {
  return [
    workspaceDoc("root", "root", "工作日志", "wiki/专题/index.md", "工作日志", "<h1>工作日志</h1><p>总览。</p>", "# 工作日志", null, null),
    workspaceDoc("domain:00-执行现场", "domain", "00-执行现场", "wiki/专题/00-执行现场/index.md", "执行现场", "<h1>执行现场</h1><p>行动队列。</p>", "# 执行现场", "00-执行现场", null),
    workspaceDoc("domain:01-项目工作区", "domain", "01-项目工作区", "wiki/专题/01-项目工作区/index.md", "项目工作区", "<h1>项目工作区</h1>", "# 项目工作区", "01-项目工作区", null),
    workspaceDoc(
      "project:01-项目工作区/产品",
      "project",
      "产品",
      "领域/产品.md",
      "产品",
      "<h1>产品</h1><p>产品领域说明。</p>",
      "# 产品",
      "01-项目工作区",
      "产品",
    ),
    workspaceDoc(
      "work-log:01-项目工作区/产品/LLM Wiki WebUI/项目概览",
      "work-log",
      "LLM Wiki WebUI",
      "领域/产品/LLM Wiki WebUI.md",
      "LLM Wiki WebUI",
      "<h1>LLM Wiki WebUI</h1><h2>项目文档</h2><p>项目文档。</p>",
      "# LLM Wiki WebUI\n\n## Overview\n\nProject notes.",
      "01-项目工作区",
      "产品",
    ),
    workspaceDoc(
      "work-log:01-项目工作区/产品/LLM Wiki WebUI/工作日志",
      "work-log",
      "LLM Wiki WebUI / 工作日志",
      "领域/产品/LLM Wiki WebUI/工作日志.md",
      "Work Log",
      "<h1>Work Log</h1><h2>Today</h2><p>Updated the workspace documents. <a class=\"wikilink wikilink-alive\" href=\"/?page=wiki%2F%E4%B8%93%E9%A2%98%2F01-%E6%A1%88%E4%BE%8B%E5%BA%93%2F%E7%A4%BA%E4%BE%8B-%E4%BF%A1%E6%81%AF%E6%B6%88%E8%B4%B9%E5%A4%B1%E6%8E%A7%E6%A1%88%E4%BE%8B.md\" data-wikilink-target=\"示例：信息消费失控案例\">案例库案例</a></p>",
      "# Work Log\n\n## Today\n\nUpdated the workspace documents.",
      "01-项目工作区",
      "产品",
    ),
    workspaceDoc("domain:01-案例库", "domain", "01-案例库", "wiki/专题/01-案例库/index.md", "案例库", "<h1>案例库</h1><p>案例占位页。</p>", "# 案例库", "01-案例库", null),
    workspaceDoc("domain:02-沉淀库", "domain", "02-沉淀库", "wiki/专题/02-沉淀库/index.md", "沉淀库", "<h1>沉淀库</h1><p>资产沉淀。</p>", "# 沉淀库", "02-沉淀库", null),
    workspaceDoc(
      "work-log:01-案例库/示例-信息消费失控案例",
      "work-log",
      "示例-信息消费失控案例",
      "wiki/专题/01-案例库/示例-信息消费失控案例.md",
      "示例：信息消费失控案例",
      "<h1>示例：信息消费失控案例</h1><p>浏览记录诊断示例。</p>",
      "# 示例：信息消费失控案例",
      "01-案例库",
      null,
      { gallery: { type: "case", status: null }, contentLoaded: true },
    ),
    workspaceDoc(
      "work-log:02-沉淀库/方法库/方法候选",
      "work-log",
      "方法候选",
      "wiki/专题/02-方法库/待验证/method-1.md",
      "方法候选",
      "<h1>方法候选</h1><p>用于验证画册视图。</p>",
      "# 方法候选\n\n用于验证画册视图。",
      "02-沉淀库",
      "方法库",
      { treeHidden: true, gallery: { type: "method", status: "待验证" }, contentLoaded: true },
    ),
    workspaceDoc(
      "work-log:02-沉淀库/方法库/失败方法",
      "work-log",
      "失败方法",
      "wiki/专题/02-方法库/已验证但失败/method-failed.md",
      "失败方法",
      "<h1>失败方法</h1><p>记录失败条件。</p>",
      "# 失败方法\n\n记录失败条件。",
      "02-沉淀库",
      "方法库",
      { treeHidden: true, gallery: { type: "method", status: "已验证但失败" }, contentLoaded: true },
    ),
    workspaceDoc(
      "work-log:02-沉淀库/工具箱/待验证/figma",
      "work-log",
      "Figma",
      "wiki/专题/03-工具箱/待验证/figma.md",
      "Figma",
      "<h1>Figma</h1><p>界面协作工具。</p>",
      "# Figma\n\n界面协作工具。",
      "02-沉淀库",
      "工具箱",
      { treeHidden: true, gallery: { type: "tool", status: "待验证" }, contentLoaded: true },
    ),
    workspaceDoc("domain:03-归档", "domain", "03-归档", "wiki/专题/03-归档/index.md", "归档", "<h1>归档</h1>", "# 归档", "03-归档", null),
    workspaceDoc("project:03-归档/失败的方法", "project", "失败的方法", "wiki/专题/03-归档/失败的方法/index.md", "失败的方法", "<h1>失败的方法</h1>", "# 失败的方法", "03-归档", "失败的方法"),
    workspaceDoc(
      "work-log:03-归档/失败的方法/method-failed.md",
      "work-log",
      "失败方法",
      "wiki/专题/03-归档/失败的方法/method-failed.md",
      "失败方法",
      "<h1>失败方法</h1><p>记录失败条件。</p>",
      "# 失败方法\n\n记录失败条件。",
      "03-归档",
      "失败的方法",
    ),
    workspaceDoc("project:03-归档/已完成领域、项目、任务", "project", "已完成领域、项目、任务", "wiki/专题/03-归档/已完成领域、项目、任务/index.md", "已完成领域、项目、任务", "<h1>已完成领域、项目、任务</h1>", "# 已完成领域、项目、任务", "03-归档", "已完成领域、项目、任务"),
    workspaceDoc(
      "work-log:03-归档/completed/task-completed-review",
      "work-log",
      "上线后对全部代码做一次review",
      "wiki/专题/03-归档/已完成领域、项目、任务/task-completed-review.md",
      "上线后对全部代码做一次review",
      "<h1>上线后对全部代码做一次review</h1><p>已完成代码 review。</p>",
      "# 上线后对全部代码做一次review\n\n已完成代码 review。",
      "03-归档",
      "已完成领域、项目、任务",
    ),
  ];
}

function projectWorkspaceTaskPlanFixture(): unknown {
  const recordedAt = "2026-05-03T09:00:00.000Z";
  return {
    voice: { transcript: "", audioPath: null, updatedAt: null },
    statusSummary: "项目工作区执行现场",
    pool: {
      items: [
        {
          id: "task-work-log",
          title: "工作日志整合",
          priority: "high",
          source: "工作日志",
          domain: "个人知识库",
          project: "LLM Wiki",
          currentProgress: "执行现场已经合并为单页",
          nextStep: "确认项目工作区布局",
          workflowLog: [{
            id: "log-merge-execution",
            recordedAt,
            node: "推进",
            tool: "workspace",
            input: "执行现场合并",
            output: "合并执行现场页面",
            issue: "",
            nextStep: "确认项目工作区布局",
            attachments: [],
            sourceRecordId: "we_1",
          }],
          actions: [{ id: "action-work-log-outline", title: "确认日志输入", order: 0 }],
        },
        {
          id: "task-graphy-layout",
          title: "Graphy 布局卡点",
          priority: "mid",
          source: "工作日志",
          domain: "个人知识库",
          project: "LLM Wiki",
          lastStop: "Graphy 与正文布局互相抢占空间",
          nextStep: "确定 Graphy 在项目工作区中的辅助边界",
          workflowLog: [{
            id: "log-graphy-blocker",
            recordedAt,
            node: "卡点",
            tool: "workspace",
            input: "Graphy 默认右上角",
            output: "",
            issue: "Graphy 与正文布局互相抢占空间",
            nextStep: "确定 Graphy 在项目工作区中的辅助边界",
            attachments: [],
            sourceRecordId: "we_2",
          }],
        },
        {
          id: "task-method-review",
          title: "方法库验收",
          priority: "low",
          source: "AI 生成",
          domain: "个人知识库",
          project: "知识沉淀",
          nextStep: "沉淀方法库验收规则",
          workflowLog: [],
        },
        {
          id: "task-health-sleep",
          title: "排查睡眠质量问题",
          priority: "low",
          source: "工作日志",
          domain: "健康",
          project: "个人健康",
          nextStep: "整理睡眠记录",
          workflowLog: [],
        },
        {
          id: "task-completed-review",
          title: "上线后对全部代码做一次review",
          priority: "mid",
          source: "工作日志",
          domain: "代码质量",
          project: "个人App开发",
          completedAt: recordedAt,
          currentProgress: "已完成代码 review",
          workflowLog: [],
        },
      ],
    },
    schedule: {
      generationId: null,
      revisionId: null,
      confirmed: true,
      items: [{ id: "task-graphy-layout", title: "Graphy 布局卡点", startTime: "10:30", priority: "mid" }],
    },
    roadmap: { view: "week", windowStart: "2026-05-03", topLabel: "", windowLabel: "", groups: [] },
    morningFlow: { voiceDone: false, diaryDone: false, planningDone: false },
  };
}

function workflowArtifactsFixture(): unknown {
  const now = new Date().toISOString();
  return {
    folders: [],
    runtimeFiles: [],
    events: [
      { event_id: "we_1", raw_input: "完成执行现场页面整合", matched_task: "整合执行现场", confidence: "high", createdAt: now },
      { event_id: "we_2", raw_input: "记录一条待绑定行动", event_type: "过程记录", confidence: "medium", createdAt: now },
    ],
    pendingConfirm: [
      { id: "pending-bind-1", text: "绑定任务来源", confidence: "medium", eventId: "we_2", createdAt: now },
    ],
    pendingArchive: [
      { id: "pending-archive-1", text: "确认沉淀位置", confidence: "low", eventId: "we_3", createdAt: now },
    ],
    resources: [],
    validations: [],
    methods: [],
  };
}

function workspaceDoc(
  id: string,
  kind: string,
  label: string,
  path: string,
  title: string,
  html: string,
  raw: string,
  domain: string | null,
  project: string | null,
  extras: Record<string, unknown> = {},
): unknown {
  return {
    id,
    kind,
    label,
    path,
    title,
    html,
    raw,
    modifiedAt: "2026-04-23T10:00:00.000Z",
    domain,
    project,
    ...extras,
  };
}

function changeTaskPoolSort(page: HTMLElement, zone: string, value: string): void {
  const input = page.querySelector<HTMLSelectElement>(`[data-task-pool-sort-zone='${zone}']`);
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}

function changeTaskPoolGroup(page: HTMLElement, zone: string, value: string): void {
  const input = page.querySelector<HTMLSelectElement>(`[data-task-pool-group-zone='${zone}']`);
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}

function readFirstTaskPoolCardTitle(page: HTMLElement, zone: string): string | null {
  return page
    .querySelector(`[data-task-pool-drop-zone='${zone}'] [data-task-pool-card] h4`)
    ?.textContent ?? null;
}

function changeTaskPlanPoolSort(page: HTMLElement, value: string): void {
  const input = page.querySelector<HTMLSelectElement>("[data-task-plan-pool-sort]");
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("change", { bubbles: true }));
}

function readFirstTaskPlanPoolTitle(page: HTMLElement): string | null {
  return page.querySelector("[data-task-plan-pool-list] .workspace-task-plan-poster__pool-text")?.textContent ?? null;
}

function readProjectWorkspacePoolSaveBody(fetchMock: ReturnType<typeof vi.fn>): {
  readonly items: Array<{
    id: string;
    domain?: string;
    project?: string;
    projectOrder?: number;
    stageId?: string;
    actions?: Array<{ id: string; title: string; order: number }>;
  }>;
  readonly stages?: Array<{ id: string; title: string; domain: string; project: string; order: number }>;
} {
  const poolCall = fetchMock.mock.calls.filter(([url, init]) =>
    url === "/api/task-plan/pool" && (init as RequestInit | undefined)?.method === "PUT"
  ).at(-1);
  expect(poolCall).toBeTruthy();
  return JSON.parse(String((poolCall?.[1] as RequestInit).body)) as {
    items: Array<{
      id: string;
      domain?: string;
      project?: string;
      projectOrder?: number;
      stageId?: string;
      actions?: Array<{ id: string; title: string; order: number }>;
    }>;
    stages?: Array<{ id: string; title: string; domain: string; project: string; order: number }>;
  };
}

type MockTaskPlanPriority = "high" | "mid" | "low" | "cool" | "neutral";
type MockTaskPlanSource = string;

interface MockTaskPlanState {
  voice: {
    transcript: string;
    audioPath: string | null;
    updatedAt: string | null;
  };
  statusSummary: string;
  pool: {
    items: Array<{
      id: string;
      title: string;
      priority: MockTaskPlanPriority;
      source: MockTaskPlanSource;
      domain?: string;
      project?: string;
      projectOrder?: number;
      stageId?: string;
      taskOrder?: number;
      zone?: "mine" | "ai" | "candidate";
      owner?: "me" | "ai";
      createdAt?: string;
      completedAt?: string;
      dueDate?: string;
      diaryDate?: string;
      generationBatchId?: string;
      generatedReason?: string;
      duplicateOfTitle?: string;
      actions?: Array<{ id: string; title: string; order: number; completedAt?: string }>;
    }>;
    stages?: Array<{ id: string; title: string; domain: string; project: string; order: number; note?: string }>;
    generationRecords?: Array<{
      id: string;
      generatedAt: string;
      diaryPaths: string[];
      diaryDates: string[];
      createdTaskIds: string[];
      skippedDuplicateTitles: string[];
    }>;
  };
  schedule: {
    generationId: string | null;
    revisionId: string | null;
    items: Array<{ id: string; title: string; startTime: string; priority: MockTaskPlanPriority }>;
    confirmed: boolean;
  };
  roadmap: {
    view: "week";
    windowStart: string;
    topLabel: string;
    windowLabel: string;
    groups: Array<{
      id: string;
      title: string;
      items: Array<{ id: string; title: string }>;
    }>;
  };
  morningFlow: {
    voiceDone: boolean;
    diaryDone: boolean;
    planningDone: boolean;
    fineTuneDone: boolean;
  };
}

interface TaskPlanPoolBusyControls {
  editToggle: HTMLButtonElement | null;
  addButton: HTMLButtonElement | null;
  saveButton: HTMLButtonElement | null;
  removeButton: HTMLButtonElement | null;
  titleInput: HTMLInputElement | null;
  sourceInput: HTMLSelectElement | null;
  priorityInput: HTMLSelectElement | null;
  filterButton: HTMLButtonElement | null;
}

function installTaskPlanFetchMock() {
  const taskPlan = createMockTaskPlanFixture();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/task-plan/state") {
      return jsonResponse({
        success: true,
        data: {
          state: taskPlan.state,
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, taskPlan };
}

function installWorkspaceHealthFetchMock() {
  const taskPlan = createMockTaskPlanFixture();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/task-plan/state") {
      return jsonResponse({
        success: true,
        data: {
          state: taskPlan.state,
        },
      });
    }
    if (url === "/api/workspace/health/state") {
      return jsonResponse({
        success: true,
        data: {
          state: {
            connection: {
              mode: "api",
              status: "connected",
              label: "小米运动健康",
              lastSyncedAt: "2026-04-26T11:40:00.000Z",
            },
            sleep: {
              latest: {
                bedTime: "23:48",
                wakeTime: "07:26",
                totalSleep: "7小时12分",
                deepSleepQuality: "偏低",
                deepSleepMinutes: 62,
                restingHeartRate: "62 bpm",
              },
              insights: [
                "入睡时间最近?7 天波动偏大",
                "深度睡眠占比连续 3 天低于目标",
              ],
              trends: {
                bedTimes: ["23:18", "23:54", "00:12"],
                wakeTimes: ["07:05", "07:26", "07:42"],
                deepSleepMinutes: [88, 71, 62],
              },
            },
          },
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, taskPlan };
}

function installWorkspaceHealthCaptchaFetchMock() {
  const taskPlan = createMockTaskPlanFixture();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/task-plan/state") {
      return jsonResponse({
        success: true,
        data: {
          state: taskPlan.state,
        },
      });
    }
    if (url === "/api/workspace/health/state") {
      return jsonResponse({
        success: true,
        data: {
          state: {
            connection: {
              mode: null,
              status: "disconnected",
              label: null,
              lastSyncedAt: null,
              lastError: null,
            },
            sleep: {
              latest: {
                bedTime: null,
                wakeTime: null,
                totalSleep: null,
                deepSleepQuality: null,
                deepSleepMinutes: null,
                restingHeartRate: null,
              },
              insights: [],
              trends: {
                bedTimes: [],
                wakeTimes: [],
                deepSleepMinutes: [],
              },
            },
          },
        },
      });
    }
    if (url === "/api/workspace/health/connection/account/send-code" && init?.method === "POST") {
      return jsonResponse({
        success: false,
        error: {
          code: "captcha_required",
          message: "获取验证码前需要先完成图形验证码。",
          captchaImageDataUrl: "data:image/png;base64,ZmFrZQ==",
        },
      }, 409);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, taskPlan };
}

function installWorkspaceHealthPartialVerificationFetchMock() {
  const taskPlan = createMockTaskPlanFixture();
  let sendCodeCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/task-plan/state") {
      return jsonResponse({
        success: true,
        data: {
          state: taskPlan.state,
        },
      });
    }
    if (url === "/api/workspace/health/state") {
      return jsonResponse({
        success: true,
        data: {
          state: {
            connection: {
              mode: null,
              status: "disconnected",
              label: null,
              lastSyncedAt: null,
              lastError: null,
            },
            sleep: {
              latest: {
                bedTime: null,
                wakeTime: null,
                totalSleep: null,
                deepSleepQuality: null,
                deepSleepMinutes: null,
                restingHeartRate: null,
              },
              insights: [],
              trends: {
                bedTimes: [],
                wakeTimes: [],
                deepSleepMinutes: [],
              },
            },
          },
        },
      });
    }
    if (url === "/api/workspace/health/connection/account/send-code" && init?.method === "POST") {
      sendCodeCalls += 1;
      if (sendCodeCalls === 1) {
        return jsonResponse({
          success: false,
          error: {
            code: "captcha_required",
            message: "获取验证码前需要先完成图形验证码。",
            captchaImageDataUrl: "data:image/png;base64,ZmFrZQ==",
          },
        }, 409);
      }
      return jsonResponse({
        success: true,
        data: {
          maskedPhone: "190******00",
          ticketReady: false,
          message: "短信验证码已经发到你的手机；如果已经收到，请直接填写短信验证码并点“验证码登录并连接”。",
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, taskPlan };
}

function createMockTaskPlanFixture(): { state: MockTaskPlanState } {
  return {
    state: {
      voice: {
        transcript: "\u5f55\u97f3\u540e\u7684\u65b0\u60f3\u6cd5",
        audioPath: null,
        updatedAt: "2026-04-24T08:00:00.000Z",
      },
      statusSummary: "\u4eca\u5929\u5148\u63a8\u8fdb\u53ef\u4ea4\u4ed8\u4efb\u52a1\uff0c\u4e0b\u5348\u96c6\u4e2d\u5904\u7406\u6c9f\u901a\u4e0e\u6574\u7406\u5de5\u4f5c\u3002",
      pool: {
        items: [
          { id: "pool-1", title: "\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 1", priority: "high", source: "\u6587\u5b57\u8f93\u5165" },
          { id: "pool-2", title: "\u6765\u81ea\u540e\u7aef\u7684\u4efb\u52a1\u6c60 2", priority: "mid", source: "AI \u751f\u6210" },
        ],
        generationRecords: [],
      },
      schedule: {
        generationId: "task-plan-generation-1",
        revisionId: "schedule-revision-1",
        confirmed: false,
        items: [
          {
            id: "schedule-a",
            title: "\u6765\u81ea\u540e\u7aef\u7684\u6392\u671f A",
            startTime: "09:00",
            priority: "high",
          },
        ],
      },
      roadmap: {
        view: "week",
        windowStart: "2024-06-01",
        topLabel: "\u9886\u57df / \u8de8\u56e2\u961f\u9879\u76ee",
        windowLabel: "2024\u5e746\u6708",
        groups: [
          {
            id: "roadmap-group-1",
            title: "1. \u4ea7\u54c1 & \u8bbe\u8ba1",
            items: [{ id: "roadmap-item-1", title: "\u5de5\u4f5c\u53f0\u6539\u7248" }],
          },
        ],
      },
      morningFlow: {
        voiceDone: true,
        diaryDone: true,
        planningDone: false,
        fineTuneDone: false,
      },
    },
  };
}

function installPendingTaskPlanPoolSaveFetchMock(taskPlan: { state: MockTaskPlanState }): {
  resolvePoolSave: (() => void) | null;
} {
  let resolvePoolSave: (() => void) | null = null;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/task-plan/state") {
      return jsonResponse({ success: true, data: { state: taskPlan.state } });
    }
    if (url === "/api/task-plan/pool" && init?.method === "PUT") {
      const payload = JSON.parse(String(init.body)) as {
        items: Array<{ id: string; title: string; priority: MockTaskPlanPriority; source: MockTaskPlanSource }>;
      };
      await new Promise<void>((resolve) => {
        resolvePoolSave = () => {
          taskPlan.state = { ...taskPlan.state, pool: { items: payload.items } };
          resolve();
        };
      });
      return jsonResponse({ success: true, data: { state: taskPlan.state } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { resolvePoolSave };
}

function installTaskPlanPoolSaveFetchMock(taskPlan: { state: MockTaskPlanState }): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/task-plan/state") {
      return jsonResponse({ success: true, data: { state: taskPlan.state } });
    }
    if (url === "/api/task-plan/pool" && init?.method === "PUT") {
      const payload = JSON.parse(String(init.body)) as {
        items: Array<{
          id: string;
          title: string;
          priority: MockTaskPlanPriority;
          source: MockTaskPlanSource;
          domain?: string;
          project?: string;
        }>;
      };
      taskPlan.state = { ...taskPlan.state, pool: { items: payload.items } };
      return jsonResponse({ success: true, data: { state: taskPlan.state } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

async function openTaskPoolEditor(page: HTMLElement): Promise<void> {
  page.querySelector<HTMLButtonElement>("[data-workspace-tab='task-pool']")?.click();
  await flush();
  page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]")?.click();
}

function getTaskPlanPoolBusyControls(page: HTMLElement): TaskPlanPoolBusyControls {
  return {
    editToggle: page.querySelector<HTMLButtonElement>("[data-task-plan-pool-edit-toggle]"),
    addButton: page.querySelector<HTMLButtonElement>("[data-task-plan-pool-add]"),
    saveButton: page.querySelector<HTMLButtonElement>("[data-task-plan-pool-save]"),
    removeButton: page.querySelector<HTMLButtonElement>("[data-task-plan-pool-remove='pool-1']"),
    titleInput: page.querySelector<HTMLInputElement>("[data-task-plan-pool-title-input='pool-1']"),
    sourceInput: page.querySelector<HTMLSelectElement>("[data-task-plan-pool-source-input='pool-1']"),
    priorityInput: page.querySelector<HTMLSelectElement>("[data-task-plan-pool-priority-input='pool-1']"),
    filterButton: page.querySelector<HTMLButtonElement>("[data-task-plan-pool-filter='AI 生成']"),
  };
}

function expectTaskPlanPoolControlsDisabled(controls: TaskPlanPoolBusyControls, disabled: boolean): void {
  const elements = [
    controls.editToggle,
    controls.addButton,
    controls.saveButton,
    controls.removeButton,
    controls.titleInput,
    controls.sourceInput,
    controls.priorityInput,
    controls.filterButton,
  ];
  for (const element of elements) {
    expect(element?.disabled).toBe(disabled);
  }
}

function exerciseDisabledTaskPlanPoolControls(controls: TaskPlanPoolBusyControls): void {
  controls.addButton?.click();
  controls.editToggle?.click();
  controls.removeButton?.click();
  controls.filterButton?.click();
  controls.titleInput!.value = "\u4fdd\u5b58\u4e2d\u4e0d\u5e94\u518d\u6539";
  controls.titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
  controls.sourceInput!.value = "\u5de5\u4f5c\u65e5\u5fd7";
  controls.sourceInput?.dispatchEvent(new Event("change", { bubbles: true }));
  controls.priorityInput!.value = "low";
  controls.priorityInput?.dispatchEvent(new Event("change", { bubbles: true }));
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

interface MockDataTransfer {
  effectAllowed: string;
  dropEffect: string;
  setData: (format: string, value: string) => void;
  getData: (format: string) => string;
}

function createMockDataTransfer(): MockDataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: "move",
    dropEffect: "move",
    setData(format: string, value: string) {
      store.set(format, value);
    },
    getData(format: string) {
      return store.get(format) ?? "";
    },
  };
}

function dispatchDragEvent(target: Element, type: string, dataTransfer?: MockDataTransfer): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer?: MockDataTransfer;
  };
  event.dataTransfer = dataTransfer ?? createMockDataTransfer();
  target.dispatchEvent(event);
}

function dispatchMouseEvent(target: EventTarget, type: string, init: MouseEventInit): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
}

function dispatchProjectWorkspaceShortcut(target: Element, key: "Enter" | "Tab"): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function dispatchGestureEvent(target: Element, type: string, scale: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    scale?: number;
  };
  event.scale = scale;
  target.dispatchEvent(event);
}

function normalizeTaskPlanPriority(value: string): MockTaskPlanPriority {
  return value === "high" || value === "mid" || value === "low" || value === "cool" || value === "neutral"
    ? value
    : "neutral";
}
