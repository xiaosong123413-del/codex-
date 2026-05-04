/**
 * Verifies the flash diary image scheduler waits for 23:30 local time and
 * continues scheduling future daily runs.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import {
  millisecondsUntilNextLocalTime,
  startFlashDiaryImageScheduler,
} from "../web/server/services/flash-diary-image-scheduler.js";

const tempRoots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("flash diary image scheduler", () => {
  it("runs at 23:30 and then schedules the next daily run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 28, 23, 29, 0));
    const run = vi.fn();

    const scheduler = startFlashDiaryImageScheduler({ cfg: createConfig(), run });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });

  it("calculates tomorrow's 23:30 after today's slot has passed", () => {
    const now = new Date(2026, 3, 28, 23, 31, 0);
    expect(millisecondsUntilNextLocalTime(now, 23, 30)).toBe(23 * 60 * 60 * 1000 + 59 * 60 * 1000);
  });
});

function createConfig(): ServerConfig {
  const projectRoot = makeDir("flash-diary-image-scheduler-project-");
  const sourceVaultRoot = makeDir("flash-diary-image-scheduler-source-");
  const runtimeRoot = makeDir("flash-diary-image-scheduler-runtime-");
  return {
    projectRoot,
    sourceVaultRoot,
    runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "tester",
  };
}

function makeDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}
