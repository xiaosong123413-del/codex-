/**
 * Regression coverage for the standalone task-pool board renderer.
 *
 * The workspace route can render this board while older runtime state is still
 * missing recently added view preferences. These tests keep the renderer
 * tolerant of that shape so route switches do not blank the page.
 */
import { describe, expect, it } from "vitest";

import { renderTaskPoolBoard } from "../web/client/src/pages/workspace/task-pool-board.js";

describe("task-pool board renderer", () => {
  it("uses default view modes when sort and group state is missing", () => {
    const html = renderTaskPoolBoard({
      pool: {
        items: [
          {
            id: "manual-task",
            title: "整理日记任务",
            priority: "mid",
            source: "文字输入",
            zone: "mine",
          },
        ],
        generationRecords: [],
      },
      selectedCandidateId: null,
      recordsOpen: false,
      recorderOpen: false,
      recorderDraft: "",
      recorderFeedback: null,
      busy: false,
      feedback: null,
      error: null,
      sortModes: undefined,
      groupModes: undefined,
    });

    expect(html).toContain("我要做的");
    expect(html).toContain("整理日记任务");
    expect(html).toContain("设立时间近");
    expect(html).toContain("不分组");
    expect(html).not.toContain("当前执行记录</span>");
    expect(html).not.toContain("data-workflow-recorder-open");
  });
});
