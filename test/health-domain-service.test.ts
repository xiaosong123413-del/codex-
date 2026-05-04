import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readHealthDomainState,
  saveHealthDomainApiConnection,
  syncHealthDomainData,
  type XiaomiHealthSyncSnapshot,
} from "../web/server/services/health-domain.js";
import {
  handleWorkspaceHealthApiConnectionSave,
  handleWorkspaceHealthState,
  handleWorkspaceHealthSync,
} from "../web/server/routes/health-domain.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("health domain service", () => {
  it("keeps the direct route handlers exported for server startup", () => {
    expect(typeof handleWorkspaceHealthState).toBe("function");
    expect(typeof handleWorkspaceHealthApiConnectionSave).toBe("function");
    expect(typeof handleWorkspaceHealthSync).toBe("function");
  });

  it("returns a sleep-focused default health state before any import", async () => {
    const projectRoot = makeTempRoot();

    const state = await readHealthDomainState(projectRoot);

    expect(state.connection.status).toBe("disconnected");
    expect(state.sleep.latest.bedTime).toBeNull();
    expect(state.sleep.latest.wakeTime).toBeNull();
    expect(state.sleep.insights).toEqual([]);
    expect(state.sleep.trends.bedTimes).toEqual([]);
    expect(state.sleep.trends.wakeTimes).toEqual([]);
    expect(state.sleep.trends.deepSleepMinutes).toEqual([]);
  });

  it("normalizes imported Xiaomi sleep data into latest metrics and trends", async () => {
    const projectRoot = makeTempRoot();
    await saveHealthDomainApiConnection(projectRoot, {
      tokenJson: "{\"userId\":\"health-user\"}",
      apiBaseUrl: "https://api.xiaomi.example",
      cookie: "serviceToken=abc",
      relativeUid: "uid-1",
    });

    const state = await syncHealthDomainData(projectRoot, async () => ({
      importedAt: "2026-04-26T11:40:00.000Z",
      sleepDays: [
        buildSleepDay("2026-04-20", "23:18", "07:05", 467, 88, 81, 58, 9124),
        buildSleepDay("2026-04-21", "23:54", "07:19", 445, 71, 75, 61, 8450),
        buildSleepDay("2026-04-22", "00:12", "07:42", 430, 62, 68, 64, 7040),
        buildSleepDay("2026-04-23", "23:41", "07:08", 447, 66, 72, 63, 8188),
        buildSleepDay("2026-04-24", "23:36", "07:31", 475, 74, 77, 62, 9311),
        buildSleepDay("2026-04-25", "23:58", "07:44", 466, 63, 69, 64, 6880),
        buildSleepDay("2026-04-26", "23:48", "07:26", 432, 62, 67, 62, 7720),
      ],
    }));

    expect(state.connection.status).toBe("connected");
    expect(state.connection.lastSyncedAt).toBe("2026-04-26T11:40:00.000Z");
    expect(state.sleep.latest.bedTime).toBe("23:48");
    expect(state.sleep.latest.wakeTime).toBe("07:26");
    expect(state.sleep.latest.totalSleep).toBe("7小时12分");
    expect(state.sleep.latest.deepSleepQuality).toBe("偏低");
    expect(state.sleep.trends.bedTimes).toEqual(["23:18", "23:54", "00:12", "23:41", "23:36", "23:58", "23:48"]);
    expect(state.sleep.trends.wakeTimes).toEqual(["07:05", "07:19", "07:42", "07:08", "07:31", "07:44", "07:26"]);
    expect(state.sleep.trends.deepSleepMinutes).toEqual([88, 71, 62, 66, 74, 63, 62]);
    expect(state.sleep.insights).toContain("入睡时间最近 7 天波动偏大");
    expect(state.sleep.insights).toContain("深度睡眠占比连续 3 天低于目标");
  });

  it("keeps Xiaomi relative UID errors visible for shared-user imports", async () => {
    const projectRoot = makeTempRoot();
    await saveHealthDomainApiConnection(projectRoot, {
      tokenJson: "{\"userId\":\"health-user\"}",
      apiBaseUrl: "https://api.xiaomi.example",
      cookie: "serviceToken=abc",
      relativeUid: "uid-1",
    });

    await expect(
      syncHealthDomainData(projectRoot, async () => {
        throw new Error("uid=3002112490 and relative_uid=3002112490 are not relatives");
      }),
    ).rejects.toThrow("not relatives");

    const state = await readHealthDomainState(projectRoot);
    expect(state.connection.lastError).toBe(
      "uid=3002112490 and relative_uid=3002112490 are not relatives",
    );
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-domain-"));
  roots.push(root);
  return root;
}

function buildSleepDay(
  date: string,
  bedTime: string,
  wakeTime: string,
  totalSleepMinutes: number,
  deepSleepMinutes: number,
  sleepScore: number,
  restingHeartRate: number,
  steps: number,
): XiaomiHealthSyncSnapshot["sleepDays"][number] {
  return {
    date,
    bedTime,
    wakeTime,
    totalSleepMinutes,
    deepSleepMinutes,
    sleepScore,
    restingHeartRate,
    sleepAverageHeartRate: restingHeartRate,
    awakeMinutes: 28,
    steps,
    intensityMinutes: 36,
  };
}
