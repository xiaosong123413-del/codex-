import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import { mutatePendingTimelineFact } from "../web/server/services/personal-timeline-pending-facts.js";
import {
  readPersonalTimelineSourceFailures,
  recordPersonalTimelineSourceFailure,
  refreshPersonalTimelineSource,
} from "../web/server/services/personal-timeline-source-refresh.js";

const tempRoots: string[] = [];

describe("personal timeline source refresh", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("detects increments by file content digest rather than file count", async () => {
    const cfg = makeConfig();
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n第一次内容", "utf8");

    const first = await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });
    const second = await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n内容变了", "utf8");
    const third = await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    expect(first.status).toBe("written");
    expect(second.status).toBe("no-increment");
    expect(third.status).toBe("written");
    expect(third.digest).not.toBe(first.digest);
  });

  it("records diary heading anchors for source refresh increments", async () => {
    const cfg = makeConfig();
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(
      diaryPath,
      [
        "# 2026-04-29 闪念日记",
        "",
        "## 让 ChatGPT 看手相",
        "",
        "ChatGPT 生成了一大段解释和两张图片。",
        "",
      ].join("\n"),
      "utf8",
    );

    await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const incrementPath = path.join(cfg.runtimeRoot, ".llmwiki", "personal-timeline-source-increments.json");
    const records = JSON.parse(fs.readFileSync(incrementPath, "utf8")) as Array<{
      headingAnchors?: Array<{ file: string; heading: string; target: string }>;
    }>;
    expect(records[0]?.headingAnchors).toContainEqual(expect.objectContaining({
      file: "raw/闪念日记/2026-04-29.md",
      heading: "让 ChatGPT 看手相",
      target: "raw/闪念日记/2026-04-29.md#让-chatgpt-看手相",
    }));
  });

  it("writes diary heading anchors into pending timeline facts", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n## 让 ChatGPT 看手相\n\n图片和解释。", "utf8");

    const result = await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(result.message).toBe("已写入待确认时间线事实");
    expect(timeline).toContain(
      "| 待确认 | 2026-04-29 | 待整理：让 ChatGPT 看手相 | 知识管理 | 个人知识库 | [[raw/闪念日记/2026-04-29.md#让-chatgpt-看手相]] |",
    );
    expect(timeline).toContain("| 事件时间 | 记录时间 | 候选片段 | 领域 | 项目 | 来源 |");
    expect(timeline).not.toContain("影响");
    expect(timeline).not.toContain("需要确认什么");
    expect(timeline).not.toContain("状态");
  });

  it("writes pending timeline facts into the source wiki page when it exists", async () => {
    const cfg = makeConfig();
    const sourceTimelinePath = writeSourceTimelineTemplate(cfg);
    const runtimeTimelinePath = writeTimelineTemplate(cfg);
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n## 13:00\n\n完成了源库可见写入。", "utf8");

    await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const sourceTimeline = fs.readFileSync(sourceTimelinePath, "utf8");
    const runtimeTimeline = fs.readFileSync(runtimeTimelinePath, "utf8");
    expect(sourceTimeline).toContain("待整理：完成了源库可见写入。");
    expect(runtimeTimeline).not.toContain("待整理：完成了源库可见写入。");
  });

  it("backfills missing pending timeline facts when the source digest is already recorded", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n## 让 ChatGPT 看手相\n\n图片和解释。", "utf8");
    await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });
    fs.writeFileSync(timelinePath, timelineTemplate(), "utf8");

    const result = await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(result.message).toBe("已补写待确认时间线事实");
    expect(timeline.match(/让 ChatGPT 看手相/gu)).toHaveLength(1);
  });

  it("uses the first diary paragraph when the evidence heading is only a timestamp", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n## 13:00:19\n\n占座引发了关于讲理和气场的反思。\n", "utf8");

    await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).toContain("待整理：占座引发了关于讲理和气场的反思。");
    expect(timeline).toContain("[[raw/闪念日记/2026-04-29.md#13:00:19]]");
    expect(timeline).not.toContain("待整理：13:00:19");
  });

  it("updates existing generated rows when the diary preview becomes cleaner", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    fs.appendFileSync(timelinePath, "| 待确认 | 2026-04-29 | 待整理：13:00 | 确认 | [[raw/闪念日记/2026-04-29.md#13:00|13:00]] | 待确认 |\n");
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n## 13:00\n\n完成了记录。## 13:30\n\n下一条。", "utf8");

    await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).toContain("待整理：完成了记录。");
    expect(timeline).not.toContain("待整理：13:00");
    expect(timeline).not.toContain("## 13:30");
  });

  it("does not write pure attachment headings as timeline facts", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n## 13:00\n\n完成了记录。\n\n### 附件\n\n![图](a.jpg)\n", "utf8");

    await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).toContain("待整理：完成了记录。");
    expect(timeline).not.toContain("待整理：附件");
  });

  it("removes attachment-heading rows that were previously written into pending facts", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    fs.appendFileSync(timelinePath, "| 待确认 | 2026-04-29 | 待整理：附件 | 确认 | [[raw/闪念日记/2026-04-29.md#附件|附件]] | 待确认 |\n");
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-29.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(diaryPath, "# 2026-04-29\n\n## 13:00\n\n完成了记录。\n\n### 附件\n\n![图](a.jpg)\n", "utf8");

    await refreshPersonalTimelineSource(cfg, { label: "日记", entries: ["#/flash-diary"] });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).not.toContain("[[raw/闪念日记/2026-04-29.md#附件|附件]]");
  });

  it("confirms a pending timeline fact into the day table", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    fs.appendFileSync(timelinePath, "| 待确认 | 2026-04-29 | 待整理：完成了记录。 | [[raw/闪念日记/2026-04-29.md#13:00]] |\n");

    const result = await mutatePendingTimelineFact(cfg, {
      action: "confirm",
      sourceTarget: "raw/闪念日记/2026-04-29.md#13:00",
    });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(result.status).toBe("written");
    expect(timeline).toContain("| 2026-04-29 | 完成了记录。 | 日常记录 | — | [[raw/闪念日记/2026-04-29.md#13:00]] |");
    expect(timeline).not.toContain("待整理：完成了记录。");
  });

  it("infers domain and project from the diary context", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    const diaryPath = path.join(cfg.sourceVaultRoot, "raw", "闪念日记", "2026-04-19.md");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(
      diaryPath,
      "# 2026-04-19\n\n## 04:15:38\n\n可以可以，保存功能也好了，我开心了\n\n这是在调试 LLM Wiki 闪念日记页的保存功能。\n",
      "utf8",
    );
    fs.appendFileSync(
      timelinePath,
      "| 待确认 | 2026-04-19 | 待整理：可以可以，保存功能也好了，我开心了 | [[raw/闪念日记/2026-04-19.md#04:15:38]] |\n",
    );

    await mutatePendingTimelineFact(cfg, {
      action: "confirm",
      sourceTarget: "raw/闪念日记/2026-04-19.md#04:15:38",
    });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).toContain("| 2026-04-19 | 可以可以，保存功能也好了，我开心了。 | 产品功能 | 个人App开发 | [[raw/闪念日记/2026-04-19.md#04:15:38]] |");
    expect(timeline).not.toContain("验证保存功能可用");
  });

  it("infers health topic from sleep and fatigue context", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    fs.appendFileSync(
      timelinePath,
      "| 待确认 | 2026-04-20 | 待整理：好累，昨天干到一点半，睡到三点半，今天又干到十点。 | [[raw/闪念日记/2026-04-20.md#02:43:04]] |\n",
    );

    await mutatePendingTimelineFact(cfg, {
      action: "confirm",
      sourceTarget: "raw/闪念日记/2026-04-20.md#02:43:04",
    });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).toContain("| 健康 | 个人健康 | [[raw/闪念日记/2026-04-20.md#02:43:04]] |");
    expect(timeline).not.toContain("提示睡眠和精力状态波动");
  });

  it("polishes supplemented notes when confirming into the day table", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    fs.appendFileSync(
      timelinePath,
      "| 待确认 | 2026-04-19 | 待整理：嘻嘻这是我的第一条日记；补充说明：这个是我通过搭建llm wiki这个应用的闪念日记页的第一条日记 | [[raw/闪念日记/2026-04-19.md#04:11:50]] |\n",
    );

    await mutatePendingTimelineFact(cfg, {
      action: "confirm",
      sourceTarget: "raw/闪念日记/2026-04-19.md#04:11:50",
    });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).toContain("通过搭建 LLM Wiki 应用的闪念日记页，记录了第一条日记。");
    expect(timeline).not.toContain("补充说明");
    expect(timeline).not.toContain("嘻嘻这是");
  });

  it("deletes a pending timeline fact by source target", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    fs.appendFileSync(timelinePath, "| 待确认 | 2026-04-29 | 待整理：完成了记录。 | [[raw/闪念日记/2026-04-29.md#13:00]] |\n");

    await mutatePendingTimelineFact(cfg, {
      action: "delete",
      sourceTarget: "raw/闪念日记/2026-04-29.md#13:00",
    });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).not.toContain("完成了记录。");
  });

  it("adds user guidance to a pending timeline fact", async () => {
    const cfg = makeConfig();
    const timelinePath = writeTimelineTemplate(cfg);
    fs.appendFileSync(timelinePath, "| 待确认 | 2026-04-29 | 待整理：完成了记录。 | [[raw/闪念日记/2026-04-29.md#13:00]] |\n");

    await mutatePendingTimelineFact(cfg, {
      action: "supplement",
      sourceTarget: "raw/闪念日记/2026-04-29.md#13:00",
      note: "请判断这是不是项目进展。",
    });

    const timeline = fs.readFileSync(timelinePath, "utf8");
    expect(timeline).toContain("补充说明：请判断这是不是项目进展。");
  });

  it("records source refresh failures for review aggregation", async () => {
    const cfg = makeConfig();
    await recordPersonalTimelineSourceFailure(cfg.runtimeRoot, {
      label: "历史回忆",
      entries: ["missing.md"],
      error: "输入来源路径不存在",
      createdAt: "2026-04-29T04:00:00.000Z",
    });

    expect(readPersonalTimelineSourceFailures(cfg.runtimeRoot)).toEqual([
      expect.objectContaining({
        label: "历史回忆",
        status: "failed",
        error: "输入来源路径不存在",
      }),
    ]);
  });
});

function makeConfig(): ServerConfig {
  return {
    sourceVaultRoot: makeRoot(),
    runtimeRoot: makeRoot(),
    projectRoot: makeRoot(),
    port: 4175,
    host: "127.0.0.1",
    author: "test",
  };
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-source-"));
  tempRoots.push(root);
  return root;
}

function writeTimelineTemplate(cfg: ServerConfig): string {
  const timelinePath = path.join(cfg.runtimeRoot, "wiki", "个人信息档案", "个人时间线.md");
  fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
  fs.writeFileSync(timelinePath, timelineTemplate(), "utf8");
  return timelinePath;
}

function writeSourceTimelineTemplate(cfg: ServerConfig): string {
  const timelinePath = path.join(cfg.sourceVaultRoot, "wiki", "个人信息档案", "个人时间线.md");
  fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
  fs.writeFileSync(timelinePath, timelineTemplate(), "utf8");
  return timelinePath;
}

function timelineTemplate(): string {
  return [
    "# 个人时间线",
    "",
    "## 按日",
    "",
    "| 事件时间 | 事实 | 领域 | 项目 | 来源 |",
    "|---|---|---|---|---|",
    "| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |",
    "",
    "## 待确认时间线事实",
    "",
    "| 事件时间 | 记录时间 | 候选片段 | 领域 | 项目 | 来源 |",
    "|---|---|---|---|---|---|",
    "| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |",
    "",
  ].join("\n");
}
