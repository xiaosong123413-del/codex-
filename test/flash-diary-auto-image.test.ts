/**
 * Verifies the flash diary daily image generator writes a generated PNG into
 * the real diary markdown so the visual editor can render it inline.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateTodayFlashDiaryImage } from "../web/server/services/flash-diary-auto-image.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("generateTodayFlashDiaryImage", () => {
  it("inserts a generated image into today's diary when it has text and no image", async () => {
    const root = makeDir();
    const diaryPath = writeDiary(root, "2026-04-28", [
      "# 2026-04-28 闪念日记",
      "",
      "## 21:10",
      "",
      "今天主要在整理个人知识系统，也在复盘考研期间如何减少电脑使用。",
      "",
    ].join("\n"));

    const result = await generateTodayFlashDiaryImage(root, {
      now: new Date(2026, 3, 28, 23, 30, 0),
    });

    expect(result.generated).toBe(true);
    expect(result.imagePath).toBe("raw/闪念日记/assets/2026-04-28/daily-summary.png");
    expect(fs.readFileSync(diaryPath, "utf-8")).toContain("![每日自动配图](./assets/2026-04-28/daily-summary.png)");
    expect(readPngSignature(path.join(root, "raw", "闪念日记", "assets", "2026-04-28", "daily-summary.png"))).toBe("89504e470d0a1a0a");
  });

  it("skips today's diary when it already contains an image", async () => {
    const root = makeDir();
    writeDiary(root, "2026-04-28", "# 2026-04-28\n\n![已有图](./assets/2026-04-28/a.png)\n\n正文。\n");

    const result = await generateTodayFlashDiaryImage(root, {
      now: new Date(2026, 3, 28, 23, 30, 0),
    });

    expect(result.generated).toBe(false);
    expect(result.skippedReason).toBe("already-has-image");
    expect(fs.existsSync(path.join(root, "raw", "闪念日记", "assets", "2026-04-28", "daily-summary.png"))).toBe(false);
  });
});

function makeDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flash-diary-auto-image-"));
  tempRoots.push(root);
  return root;
}

function writeDiary(root: string, date: string, raw: string): string {
  const diaryPath = path.join(root, "raw", "闪念日记", `${date}.md`);
  fs.mkdirSync(path.dirname(diaryPath), { recursive: true });
  fs.writeFileSync(diaryPath, raw, "utf-8");
  return diaryPath;
}

function readPngSignature(filePath: string): string {
  return fs.readFileSync(filePath).subarray(0, 8).toString("hex");
}
