/**
 * Regression coverage for review summary aggregation across persisted review queues
 * and failed or successful run snapshots shown on the review page.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aggregateReviewItems } from "../web/server/services/review-aggregator.js";
import type { RunSnapshot } from "../web/server/services/run-manager.js";

const tempRoots: string[] = [];

describe("review-aggregator", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns deep-research entries and wiki state stats with frozen slug details", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "deep-research-items.json"),
      JSON.stringify([
        {
          id: "deep-research-check-citation-gap",
          kind: "check",
          title: "引用缺失",
          detail: "原文引用指向的来源文件不存在。",
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在。",
          sourceExcerpt: "Broken citation ^[clip.md] - source file not found",
          status: "pending",
          progress: 0,
          createdAt: "2026-04-17T01:02:03.000Z",
          updatedAt: "2026-04-17T01:02:03.000Z",
        },
      ]),
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, ".llmwiki", "state.json"),
      JSON.stringify({ sources: { a: { compiledAt: "2026-04-17T01:00:00.000Z" } }, frozenSlugs: ["react", "", "vs"] }),
      "utf8",
    );

    const result = aggregateReviewItems({ sourceVaultRoot: root, runtimeRoot: root, projectRoot: root });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "deep-research",
        title: "引用缺失",
        target: "wiki/concepts/example.md",
        deepResearch: expect.objectContaining({
          category: "missing-citation",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑。",
          status: "pending",
        }),
      }),
    );
    expect(result.state?.sourceCount).toBe(1);
    expect(result.state?.frozenCount).toBe(3);
    expect(result.state?.frozenSlugs).toEqual(["react", "", "vs"]);
    expect(result.state?.suspiciousFrozenSlugs).toEqual(["", "vs"]);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        id: "state-frozen-slugs",
        kind: "state",
        stateInfo: expect.objectContaining({
          frozenSlugs: ["react", "", "vs"],
          suspiciousFrozenSlugs: ["", "vs"],
        }),
      }),
    );
  });

  it("does not surface completed deep-research entries after confirmation write", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "deep-research-items.json"),
      JSON.stringify([
        {
          id: "deep-research-check-completed",
          kind: "check",
          title: "引用缺失",
          detail: "补引用已经写入。",
          category: "missing-citation",
          scope: "claim",
          pagePath: "wiki/concepts/example.md",
          line: 22,
          factText: "这段结论缺少来源文件支撑。",
          gapText: "Broken citation ^[clip.md] - source file not found",
          triggerReason: "原文引用指向的来源文件不存在。",
          sourceExcerpt: "Broken citation ^[clip.md] - source file not found",
          status: "completed",
          progress: 100,
          createdAt: "2026-04-17T01:02:03.000Z",
          updatedAt: "2026-04-17T01:05:03.000Z",
        },
      ]),
      "utf8",
    );

    const result = aggregateReviewItems({ sourceVaultRoot: root, runtimeRoot: root, projectRoot: root });

    expect(result.items.some((item) => item.id === "deep-research-check-completed")).toBe(false);
  });

  it("includes successful check runs that reported problems", () => {
    const root = makeRoot();
    const result = aggregateReviewItems({
      sourceVaultRoot: root,
      runtimeRoot: root,
      projectRoot: root,
      currentRun: makeRun({
        kind: "check",
        status: "succeeded",
        lines: ["526 error(s), 0 warning(s), 0 info"],
      }),
    });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "run",
        severity: "error",
        title: "\u7cfb\u7edf\u68c0\u67e5\u53d1\u73b0\u5f85\u5904\u7406\u4e8b\u9879",
      }),
    );
  });

  it("does not include clean successful sync runs", () => {
    const root = makeRoot();
    const result = aggregateReviewItems({
      sourceVaultRoot: root,
      runtimeRoot: root,
      projectRoot: root,
      currentRun: makeRun({
        kind: "sync",
        status: "succeeded",
        lines: ["Imported raw files: 10", "Compilation complete"],
      }),
    });

    expect(result.items.some((item) => item.kind === "run")).toBe(false);
  });

  it("does not surface transient deep-research cards from a running check before they are persisted", () => {
    const root = makeRoot();
    const result = aggregateReviewItems({
      sourceVaultRoot: root,
      runtimeRoot: root,
      projectRoot: root,
      currentRun: {
        id: "check-running",
        kind: "check",
        status: "running",
        startedAt: "2026-04-17T01:00:00.000Z",
        lines: [
          {
            at: "2026-04-17T01:00:00.000Z",
            source: "stdout",
            text: "x error wiki/concepts/example.md:22 Broken citation ^[clip.md] - source file not found",
          },
        ],
      },
    });

    expect(result.items.some((item) => item.kind === "deep-research")).toBe(false);
  });

  it("includes inbox source materials that still need an ingest decision", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "inbox"), { recursive: true });
    fs.writeFileSync(path.join(root, "inbox", "guided.md"), "# Guided Source\n\nNeed me.", "utf8");

    const result = aggregateReviewItems({ sourceVaultRoot: root, runtimeRoot: root, projectRoot: root });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "inbox",
        severity: "suggest",
        title: "Guided Source",
        target: expect.stringContaining("inbox"),
      }),
    );
  });

  it("excludes inbox materials that have already been guided-ingested", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "inbox", "_\u5df2\u5f55\u5165"), { recursive: true });
    fs.writeFileSync(path.join(root, "inbox", "_\u5df2\u5f55\u5165", "done.md"), "# Done", "utf8");

    const result = aggregateReviewItems({ sourceVaultRoot: root, runtimeRoot: root, projectRoot: root });

    expect(result.items.some((item) => item.kind === "inbox")).toBe(false);
  });

  it("includes failed flash diary submissions with original content preview", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "flash-diary-failures.json"),
      JSON.stringify([
        {
          id: "flash-failure-1",
          createdAt: "2026-04-19T08:00:00.000Z",
          targetDate: "2026-04-19",
          text: "\u4eca\u5929\u60f3\u5230\u4e00\u4e2a\u65b0\u70b9\u5b50",
          mediaFiles: [],
          error: "disk full",
          status: "failed",
        },
      ]),
      "utf8",
    );

    const result = aggregateReviewItems({ sourceVaultRoot: root, runtimeRoot: root, projectRoot: root });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "flash-diary-failure",
        severity: "error",
        title: expect.stringContaining("\u95ea\u5ff5\u65e5\u8bb0"),
        detail: expect.stringContaining("\u4eca\u5929\u60f3\u5230\u4e00\u4e2a\u65b0\u70b9\u5b50"),
      }),
    );
  });

  it("includes failed xiaohongshu sync submissions", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "xhs-sync-failures.json"),
      JSON.stringify([
        {
          id: "xhs-fail-1",
          command: "xhs",
          url: "https://www.xiaohongshu.com/explore/64f000000000000001234567",
          error: "__INITIAL_STATE__ not found",
          createdAt: "2026-04-23T08:00:00.000Z",
        },
      ]),
      "utf8",
    );

    const summary = aggregateReviewItems({ sourceVaultRoot: root, runtimeRoot: root, projectRoot: root });

    expect(summary.items).toEqual([
      expect.objectContaining({
        id: "xhs-fail-1",
        kind: "xhs-sync-failure",
        severity: "error",
        title: "小红书同步失败",
        detail: expect.stringContaining("__INITIAL_STATE__ not found"),
      }),
    ]);
  });

  it("includes failed personal timeline source refreshes", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "personal-timeline-source-failures.json"),
      JSON.stringify([
        {
          id: "timeline-source-fail-1",
          label: "历史回忆",
          entries: ["wiki/个人信息档案/历史回忆.md"],
          error: "输入来源路径不存在",
          createdAt: "2026-04-29T04:00:00.000Z",
          status: "failed",
        },
      ]),
      "utf8",
    );

    const summary = aggregateReviewItems({ sourceVaultRoot: root, runtimeRoot: root, projectRoot: root });

    expect(summary.items).toContainEqual(
      expect.objectContaining({
        id: "timeline-source-fail-1",
        kind: "personal-timeline-source-failure",
        title: "个人时间线来源刷新失败",
        detail: expect.stringContaining("历史回忆"),
      }),
    );
  });

  it("reads runtime review state but keeps inbox materials in the source vault", () => {
    const sourceVaultRoot = makeRoot();
    const runtimeRoot = makeRoot();
    fs.mkdirSync(path.join(sourceVaultRoot, "inbox"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "inbox", "source.md"), "# Source Inbox\n\nBody", "utf8");
    fs.writeFileSync(
      path.join(runtimeRoot, ".llmwiki", "flash-diary-failures.json"),
      JSON.stringify([
        {
          id: "flash-failure-runtime",
          createdAt: "2026-04-19T08:00:00.000Z",
          targetDate: "2026-04-19",
          text: "runtime failure",
          mediaFiles: [],
          error: "disk full",
          status: "failed",
        },
      ]),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, ".llmwiki", "state.json"),
      JSON.stringify({ sources: { a: { compiledAt: "2026-04-17T01:00:00.000Z" } }, frozenSlugs: [] }),
      "utf8",
    );

    const result = aggregateReviewItems({
      sourceVaultRoot,
      runtimeRoot,
      projectRoot: sourceVaultRoot,
    });

    expect(result.state?.sourceCount).toBe(1);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "inbox",
        title: "Source Inbox",
        target: "inbox/source.md",
      }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "flash-diary-failure",
        detail: expect.stringContaining("runtime failure"),
      }),
    );
  });

  it("ignores deep-research lines when also building the generic run issue card", () => {
    const root = makeRoot();
    const result = aggregateReviewItems({
      sourceVaultRoot: root,
      runtimeRoot: root,
      projectRoot: root,
      currentRun: makeRun({
        kind: "check",
        status: "succeeded",
        lines: [
          "引用缺失：缓存段落缺少外部来源",
          "3 warning(s)",
        ],
      }),
    });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "run",
        detail: "3 warning(s)",
      }),
    );
    expect(result.items.some((item) => item.kind === "run" && item.detail.includes("引用缺失"))).toBe(false);
  });

  it("surfaces actionable failed check lines instead of the generic process-exit tail", () => {
    const root = makeRoot();
    const result = aggregateReviewItems({
      sourceVaultRoot: root,
      runtimeRoot: root,
      projectRoot: root,
      currentRun: makeRun({
        kind: "check",
        status: "failed",
        lines: [
          "系统检查",
          "x error wiki/concepts/example.md:22 Broken wikilink [[Missing Page]] - no matching page found",
          "x error wiki/concepts/example.md:31 Broken wikilink [[Another Missing Page]] - no matching page found",
          "* 736 error(s), 260 warning(s), 110 info",
          "需要你确认后再继续：",
          "- 需要网络搜索补证的数据空白",
          "  原因：联网搜索会引入新来源和外部信息，需要你确认是否值得补证。",
          "  需要你确认：是否进一步网络搜索补证？",
          "process exited with code 1",
        ],
      }),
    });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "run",
        title: "系统检查失败",
        detail: [
          "x error wiki/concepts/example.md:22 Broken wikilink [[Missing Page]] - no matching page found",
          "x error wiki/concepts/example.md:31 Broken wikilink [[Another Missing Page]] - no matching page found",
          "* 736 error(s), 260 warning(s), 110 info",
        ].join("\n"),
      }),
    );
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-"));
  tempRoots.push(root);
  return root;
}

function makeRun(input: {
  kind: "check" | "sync";
  status: "succeeded" | "failed";
  lines: string[];
}): RunSnapshot {
  return {
    id: `${input.kind}-test`,
    kind: input.kind,
    status: input.status,
    startedAt: "2026-04-17T01:00:00.000Z",
    endedAt: "2026-04-17T01:01:00.000Z",
    exitCode: input.status === "succeeded" ? 0 : 1,
    lines: input.lines.map((text, index) => ({
      at: `2026-04-17T01:00:${String(index).padStart(2, "0")}.000Z`,
      source: "stdout",
      text,
    })),
  };
}
