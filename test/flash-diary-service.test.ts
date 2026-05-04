import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendFlashDiaryEntry,
  listFlashDiaryFiles,
  readFlashDiaryFailures,
  recordFlashDiaryFailure,
  saveFlashDiaryPage,
} from "../web/server/services/flash-diary.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("flash diary service", () => {
  it("creates today's diary file when appending the first entry", async () => {
    const root = makeRoot();

    const result = await appendFlashDiaryEntry(root, {
      text: "\u7b2c\u4e00\u6761\u95ea\u5ff5",
      mediaPaths: [],
      now: new Date("2026-04-19T08:30:00.000Z"),
    });

    expect(result.path).toBe("raw/\u95ea\u5ff5\u65e5\u8bb0/2026-04-19.md");
    const full = path.join(root, "raw", "\u95ea\u5ff5\u65e5\u8bb0", "2026-04-19.md");
    expect(fs.existsSync(full)).toBe(true);
    expect(fs.readFileSync(full, "utf8")).toContain("\u7b2c\u4e00\u6761\u95ea\u5ff5");
    expect(fs.readFileSync(full, "utf8")).toContain("16:30");
  });

  it("prepends newer entries to keep same-day diary in reverse chronological order", async () => {
    const root = makeRoot();
    await appendFlashDiaryEntry(root, {
      text: "\u8f83\u65e9\u7684\u8bb0\u5f55",
      mediaPaths: [],
      now: new Date("2026-04-19T08:00:00.000Z"),
    });

    await appendFlashDiaryEntry(root, {
      text: "\u8f83\u665a\u7684\u8bb0\u5f55",
      mediaPaths: [],
      now: new Date("2026-04-19T09:00:00.000Z"),
    });

    const full = path.join(root, "raw", "\u95ea\u5ff5\u65e5\u8bb0", "2026-04-19.md");
    const content = fs.readFileSync(full, "utf8");
    expect(content.indexOf("\u8f83\u665a\u7684\u8bb0\u5f55")).toBeLessThan(content.indexOf("\u8f83\u65e9\u7684\u8bb0\u5f55"));
  });

  it("copies selected media into the per-day assets directory and references them relatively", async () => {
    const root = makeRoot();
    const mediaDir = path.join(root, "fixtures");
    fs.mkdirSync(mediaDir, { recursive: true });
    const imagePath = path.join(mediaDir, "idea.png");
    fs.writeFileSync(imagePath, "image", "utf8");

    const result = await appendFlashDiaryEntry(root, {
      text: "\u56fe\u7247\u60f3\u6cd5",
      mediaPaths: [imagePath],
      now: new Date("2026-04-19T10:00:00.000Z"),
    });

    expect(result.mediaFiles).toHaveLength(1);
    expect(result.mediaFiles[0]).toContain("raw/\u95ea\u5ff5\u65e5\u8bb0/assets/2026-04-19/");
    const markdown = fs.readFileSync(path.join(root, result.path), "utf8");
    expect(markdown).toContain("./assets/2026-04-19/idea.png");
  });

  it("records failed submissions for later review", async () => {
    const root = makeRoot();

    await recordFlashDiaryFailure(root, {
      createdAt: "2026-04-19T11:00:00.000Z",
      targetDate: "2026-04-19",
      text: "\u5931\u8d25\u7684\u95ea\u5ff5",
      mediaFiles: ["C:/temp/demo.png"],
      error: "write denied",
      status: "failed",
    });

    const failures = readFlashDiaryFailures(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.text).toBe("\u5931\u8d25\u7684\u95ea\u5ff5");
    expect(failures[0]?.error).toBe("write denied");
  });

  it("lists diary files in reverse chronological order with entry counts", async () => {
    const root = makeRoot();
    const mediaDir = path.join(root, "fixtures");
    fs.mkdirSync(mediaDir, { recursive: true });
    const imagePath = path.join(mediaDir, "today.png");
    fs.writeFileSync(imagePath, "image", "utf8");
    await appendFlashDiaryEntry(root, {
      text: "\u4eca\u5929",
      mediaPaths: [imagePath],
      now: new Date("2026-04-19T09:00:00.000Z"),
    });
    await appendFlashDiaryEntry(root, {
      text: "\u6628\u5929",
      mediaPaths: [],
      now: new Date("2026-04-18T09:00:00.000Z"),
    });

    const items = await listFlashDiaryFiles(root);
    expect(items.map((item) => item.path)).toEqual([
      "raw/\u95ea\u5ff5\u65e5\u8bb0/2026-04-19.md",
      "raw/\u95ea\u5ff5\u65e5\u8bb0/2026-04-18.md",
    ]);
    expect(items[0]?.entryCount).toBe(1);
    expect(items[0]?.thumbnailUrl).toContain("/api/flash-diary/media?path=");
    expect(items[1]?.thumbnailUrl).toBeNull();
  });

  it("deletes an orphaned diary image file when the saved markdown no longer references it", async () => {
    const root = makeRoot();
    const diaryPath = path.join(root, "raw", "闪念日记", "2026-04-27.md");
    const assetPath = path.join(root, "raw", "闪念日记", "assets", "2026-04-27", "pasted.png");
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, "image", "utf8");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(
      diaryPath,
      [
        "# 2026-04-27 闪念日记",
        "",
        "![图片 1](./assets/2026-04-27/pasted.png)",
        "",
        "今天只留下文字。",
      ].join("\n"),
      "utf8",
    );

    await saveFlashDiaryPage(root, "raw/闪念日记/2026-04-27.md", "# 2026-04-27 闪念日记\n\n今天只留下文字。\n");

    expect(fs.existsSync(assetPath)).toBe(false);
  });

  it("keeps a diary image file when the saved markdown still references the same path elsewhere", async () => {
    const root = makeRoot();
    const diaryPath = path.join(root, "raw", "闪念日记", "2026-04-27.md");
    const assetPath = path.join(root, "raw", "闪念日记", "assets", "2026-04-27", "shared.png");
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, "image", "utf8");
    fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
    fs.writeFileSync(
      diaryPath,
      [
        "# 2026-04-27 闪念日记",
        "",
        "![图片 1](./assets/2026-04-27/shared.png)",
        "",
        "![图片 2](./assets/2026-04-27/shared.png)",
      ].join("\n"),
      "utf8",
    );

    await saveFlashDiaryPage(
      root,
      "raw/闪念日记/2026-04-27.md",
      [
        "# 2026-04-27 闪念日记",
        "",
        "![图片 2](./assets/2026-04-27/shared.png)",
      ].join("\n"),
    );

    expect(fs.existsSync(assetPath)).toBe(true);
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flash-diary-"));
  tempRoots.push(root);
  return root;
}
