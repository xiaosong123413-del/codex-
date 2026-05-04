// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderWorkflowArtifactsPage } from "../web/client/src/pages/workflow-artifacts/index.js";

describe("workflow artifacts page", () => {
  it("shows folders separately from runtime files and queues", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
        data: {
          folders: [
            { title: "03-工具箱", path: "wiki/专题/03-工具箱", indexPath: "wiki/专题/03-工具箱/index.md", exists: true },
        ],
        runtimeFiles: [
          { title: "Workflow Event 事件池", path: ".llmwiki/workflow-events.json", count: 1 },
        ],
        events: [{ event_id: "we_1", raw_input: "记录了一次执行", confidence: "high" }],
        pendingConfirm: [{ id: "medium-1", text: "候选任务不确定", confidence: "medium" }],
        pendingArchive: [],
        resources: [],
        validations: [],
        methods: [],
      },
    }))));

    const page = renderWorkflowArtifactsPage();
    await waitForPage();

    expect(page.textContent).toContain("长期文件夹");
    expect(page.textContent).toContain("运行时文件");
    expect(page.textContent).toContain("03-工具箱");
    expect(page.textContent).toContain("Workflow Event 事件池");
    expect(page.textContent).toContain("待确认队列");
    expect(page.textContent).toContain("候选任务不确定");
  });
});

function waitForPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
