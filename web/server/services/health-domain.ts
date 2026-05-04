/**
 * Workspace health-domain state, connection persistence, and sleep summary sync.
 *
 * The workspace health page is intentionally sleep-first. This module stores the
 * Xiaomi connection profile plus the latest derived sleep summary so the client
 * can render bedtime, wake time, deep-sleep quality, sleep-impact factors, and
 * short-term trends without re-deriving them on every request.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const HEALTH_DOMAIN_FILE = path.join(".llmwiki", "health-domain.json");
const HEALTH_CONNECTION_LABEL = "小米运动健康";
const DEEP_SLEEP_TARGET_RATIO = 0.18;
const BEDTIME_VARIANCE_THRESHOLD_MINUTES = 40;
const LOW_ACTIVITY_THRESHOLD_STEPS = 4000;

type HealthConnectionMode = "account" | "api" | null;
type HealthConnectionStatus = "disconnected" | "connected" | "error";

interface XiaomiHealthSyncSnapshotDay {
  date: string;
  bedTime: string;
  wakeTime: string;
  totalSleepMinutes: number;
  deepSleepMinutes: number;
  sleepScore: number;
  restingHeartRate: number;
  sleepAverageHeartRate: number;
  awakeMinutes: number;
  steps: number;
  intensityMinutes: number;
}

export interface XiaomiHealthSyncSnapshot {
  importedAt: string;
  sleepDays: XiaomiHealthSyncSnapshotDay[];
}

interface HealthDomainStoredConnection {
  mode: HealthConnectionMode;
  status: HealthConnectionStatus;
  label: string | null;
  lastSyncedAt: string | null;
  tokenJson: string | null;
  apiBaseUrl: string | null;
  relativeUid: string | null;
  lastError: string | null;
}

interface HealthDomainConnectionState {
  mode: HealthConnectionMode;
  status: HealthConnectionStatus;
  label: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface HealthDomainSleepLatestState {
  bedTime: string | null;
  wakeTime: string | null;
  totalSleep: string | null;
  deepSleepQuality: string | null;
  deepSleepMinutes: number | null;
  restingHeartRate: string | null;
  sleepScore: string | null;
  awakeDuration: string | null;
  sleepAverageHeartRate: string | null;
  steps: string | null;
  intensityMinutes: string | null;
}

interface HealthDomainSleepTrendsState {
  bedTimes: string[];
  wakeTimes: string[];
  deepSleepMinutes: number[];
  sleepScores: number[];
  steps: number[];
  intensityMinutes: number[];
}

interface HealthDomainSleepState {
  latest: HealthDomainSleepLatestState;
  insights: string[];
  trends: HealthDomainSleepTrendsState;
}

interface HealthDomainState {
  connection: HealthDomainConnectionState;
  sleep: HealthDomainSleepState;
}

interface HealthDomainStoredState {
  connection: HealthDomainStoredConnection;
  sleep: HealthDomainSleepState;
}

interface HealthDomainApiConnectionInput {
  tokenJson: string;
  apiBaseUrl: string;
  relativeUid: string;
}

interface HealthDomainAccountConnectionInput {
  tokenJson: string;
  relativeUid: string;
}

interface XiaomiHealthSyncRunnerInput {
  tokenJson: string;
  apiBaseUrl: string | null;
  relativeUid: string | null;
}

// fallow-ignore-next-line unused-type
export type XiaomiHealthSyncRunner = (
  input: XiaomiHealthSyncRunnerInput,
) => Promise<XiaomiHealthSyncSnapshot>;

export async function readHealthDomainState(
  projectRoot: string,
): Promise<HealthDomainState> {
  const stored = await readStoredHealthDomainState(projectRoot);
  return toPublicHealthDomainState(stored);
}

export async function saveHealthDomainApiConnection(
  projectRoot: string,
  input: HealthDomainApiConnectionInput,
): Promise<HealthDomainState> {
  return saveHealthDomainTokenConnection(projectRoot, {
    mode: "api",
    tokenJson: input.tokenJson,
    apiBaseUrl: input.apiBaseUrl,
    relativeUid: input.relativeUid,
  });
}

export async function saveHealthDomainAccountConnection(
  projectRoot: string,
  input: HealthDomainAccountConnectionInput,
): Promise<HealthDomainState> {
  return saveHealthDomainTokenConnection(projectRoot, {
    mode: "account",
    tokenJson: input.tokenJson,
    apiBaseUrl: "",
    relativeUid: input.relativeUid,
  });
}

export async function syncHealthDomainData(
  projectRoot: string,
  runner: XiaomiHealthSyncRunner,
): Promise<HealthDomainState> {
  const stored = await readStoredHealthDomainState(projectRoot);
  const tokenJson = stored.connection.tokenJson?.trim();
  if (!tokenJson) {
    throw new Error("请先完成小米运动健康连接。");
  }
  try {
    const snapshot = await runner({
      tokenJson,
      apiBaseUrl: stored.connection.apiBaseUrl,
      relativeUid: stored.connection.relativeUid,
    });
    const nextState: HealthDomainStoredState = {
      connection: {
        ...stored.connection,
        status: "connected",
        label: HEALTH_CONNECTION_LABEL,
        lastSyncedAt: snapshot.importedAt,
        lastError: null,
      },
      sleep: buildHealthSleepState(snapshot.sleepDays),
    };
    await writeStoredHealthDomainState(projectRoot, nextState);
    return toPublicHealthDomainState(nextState);
  } catch (error) {
    const failedState: HealthDomainStoredState = {
      ...stored,
      connection: {
        ...stored.connection,
        status: "error",
        lastError: normalizeHealthConnectionError(
          error instanceof Error ? error.message : String(error),
        ),
      },
    };
    await writeStoredHealthDomainState(projectRoot, failedState);
    throw error;
  }
}

async function saveHealthDomainTokenConnection(
  projectRoot: string,
  input: {
    mode: Exclude<HealthConnectionMode, null>;
    tokenJson: string;
    apiBaseUrl: string;
    relativeUid: string;
  },
): Promise<HealthDomainState> {
  const stored = await readStoredHealthDomainState(projectRoot);
  const nextState: HealthDomainStoredState = {
    ...stored,
    connection: {
      ...stored.connection,
      mode: input.mode,
      status: "connected",
      label: HEALTH_CONNECTION_LABEL,
      tokenJson: input.tokenJson.trim(),
      apiBaseUrl: normalizeOptionalText(input.apiBaseUrl),
      relativeUid: normalizeOptionalText(input.relativeUid),
      lastError: null,
    },
  };
  await writeStoredHealthDomainState(projectRoot, nextState);
  return toPublicHealthDomainState(nextState);
}

function buildHealthSleepState(
  days: readonly XiaomiHealthSyncSnapshotDay[],
): HealthDomainSleepState {
  const normalizedDays = [...days].sort((left, right) =>
    left.date.localeCompare(right.date)
  );
  const latest = normalizedDays.at(-1) ?? null;
  return {
    latest: latest
      ? {
          bedTime: latest.bedTime,
          wakeTime: latest.wakeTime,
          totalSleep: formatDuration(latest.totalSleepMinutes),
          deepSleepQuality: describeDeepSleepQuality(
            latest.deepSleepMinutes,
            latest.totalSleepMinutes,
          ),
          deepSleepMinutes: latest.deepSleepMinutes,
          restingHeartRate: formatBpm(latest.restingHeartRate),
          sleepScore: `${latest.sleepScore} 分`,
          awakeDuration: formatDuration(latest.awakeMinutes),
          sleepAverageHeartRate: formatBpm(latest.sleepAverageHeartRate),
          steps: formatSteps(latest.steps),
          intensityMinutes: formatDuration(latest.intensityMinutes),
        }
      : createEmptySleepLatestState(),
    insights: buildSleepInsights(normalizedDays),
    trends: {
      bedTimes: normalizedDays.map((day) => day.bedTime),
      wakeTimes: normalizedDays.map((day) => day.wakeTime),
      deepSleepMinutes: normalizedDays.map((day) => day.deepSleepMinutes),
      sleepScores: normalizedDays.map((day) => day.sleepScore),
      steps: normalizedDays.map((day) => day.steps),
      intensityMinutes: normalizedDays.map((day) => day.intensityMinutes),
    },
  };
}

function buildSleepInsights(days: readonly XiaomiHealthSyncSnapshotDay[]): string[] {
  if (days.length === 0) {
    return [];
  }
  const insights: string[] = [];
  if (
    computeTimeSpreadMinutes(days.map((day) => day.bedTime)) >=
    BEDTIME_VARIANCE_THRESHOLD_MINUTES
  ) {
    insights.push("入睡时间最近 7 天波动偏大");
  }
  if (hasRecentLowDeepSleepRatio(days, 3)) {
    insights.push("深度睡眠占比连续 3 天低于目标");
  }
  if (hasRecentLowActivity(days, 3)) {
    insights.push("近 3 天活动量偏低，可能影响夜间睡眠驱动力");
  }
  return insights;
}

function hasRecentLowDeepSleepRatio(
  days: readonly XiaomiHealthSyncSnapshotDay[],
  count: number,
): boolean {
  const recentDays = days.slice(-count);
  return (
    recentDays.length === count &&
    recentDays.every(
      (day) =>
        day.totalSleepMinutes > 0 &&
        day.deepSleepMinutes / day.totalSleepMinutes < DEEP_SLEEP_TARGET_RATIO,
    )
  );
}

function hasRecentLowActivity(
  days: readonly XiaomiHealthSyncSnapshotDay[],
  count: number,
): boolean {
  const recentDays = days.slice(-count);
  return (
    recentDays.length === count &&
    recentDays.every((day) => day.steps < LOW_ACTIVITY_THRESHOLD_STEPS)
  );
}

function computeTimeSpreadMinutes(times: readonly string[]): number {
  const minuteValues = times
    .map(parseClockMinutes)
    .filter((value): value is number => value !== null);
  if (minuteValues.length === 0) {
    return 0;
  }
  return Math.max(...minuteValues) - Math.min(...minuteValues);
}

function parseClockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes} 分钟`;
  }
  return `${hours}小时${minutes}分`;
}

function formatBpm(value: number): string {
  return `${value} bpm`;
}

function formatSteps(value: number): string {
  return `${value.toLocaleString("zh-CN")} 步`;
}

function describeDeepSleepQuality(
  deepSleepMinutes: number,
  totalSleepMinutes: number,
): string {
  if (totalSleepMinutes <= 0) {
    return "暂无";
  }
  const ratio = deepSleepMinutes / totalSleepMinutes;
  if (ratio >= 0.22) {
    return "良好";
  }
  if (ratio >= DEEP_SLEEP_TARGET_RATIO) {
    return "一般";
  }
  return "偏低";
}

function createEmptySleepLatestState(): HealthDomainSleepLatestState {
  return {
    bedTime: null,
    wakeTime: null,
    totalSleep: null,
    deepSleepQuality: null,
    deepSleepMinutes: null,
    restingHeartRate: null,
    sleepScore: null,
    awakeDuration: null,
    sleepAverageHeartRate: null,
    steps: null,
    intensityMinutes: null,
  };
}

async function readStoredHealthDomainState(
  projectRoot: string,
): Promise<HealthDomainStoredState> {
  const filePath = path.join(projectRoot, HEALTH_DOMAIN_FILE);
  if (!existsSync(filePath)) {
    const defaults = createDefaultStoredHealthDomainState();
    await writeStoredHealthDomainState(projectRoot, defaults);
    return defaults;
  }
  const raw = JSON.parse(
    await readFile(filePath, "utf8"),
  ) as Partial<HealthDomainStoredState>;
  return normalizeStoredHealthDomainState(raw);
}

async function writeStoredHealthDomainState(
  projectRoot: string,
  state: HealthDomainStoredState,
): Promise<void> {
  const filePath = path.join(projectRoot, HEALTH_DOMAIN_FILE);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizeStoredHealthDomainState(
  input: Partial<HealthDomainStoredState>,
): HealthDomainStoredState {
  const defaults = createDefaultStoredHealthDomainState();
  return {
    connection: normalizeStoredConnection(input.connection, defaults.connection),
    sleep: {
      latest: normalizeStoredSleepLatest(input.sleep?.latest, defaults.sleep.latest),
      insights: Array.isArray(input.sleep?.insights)
        ? input.sleep.insights.filter(isNonEmptyString)
        : defaults.sleep.insights,
      trends: normalizeStoredSleepTrends(input.sleep?.trends, defaults.sleep.trends),
    },
  };
}

// fallow-ignore-next-line complexity
function normalizeStoredConnection(
  input: Partial<HealthDomainStoredConnection> | undefined,
  defaults: HealthDomainStoredConnection,
): HealthDomainStoredConnection {
  const opt = (value: unknown, fallback: string | null): string | null =>
    normalizeOptionalText(value) ?? fallback;
  return {
    mode:
      input?.mode === "account" || input?.mode === "api"
        ? input.mode
        : defaults.mode,
    status:
      input?.status === "connected" || input?.status === "error"
        ? input.status
        : defaults.status,
    label: opt(input?.label, defaults.label),
    lastSyncedAt: opt(input?.lastSyncedAt, defaults.lastSyncedAt),
    tokenJson: opt(input?.tokenJson, defaults.tokenJson),
    apiBaseUrl: opt(input?.apiBaseUrl, defaults.apiBaseUrl),
    relativeUid: opt(input?.relativeUid, defaults.relativeUid),
    lastError: opt(input?.lastError, defaults.lastError),
  };
}

// fallow-ignore-next-line complexity
function normalizeStoredSleepLatest(
  input: Partial<HealthDomainSleepLatestState> | undefined,
  defaults: HealthDomainSleepLatestState,
): HealthDomainSleepLatestState {
  const opt = (value: unknown, fallback: string | null): string | null =>
    normalizeOptionalText(value) ?? fallback;
  return {
    bedTime: opt(input?.bedTime, defaults.bedTime),
    wakeTime: opt(input?.wakeTime, defaults.wakeTime),
    totalSleep: opt(input?.totalSleep, defaults.totalSleep),
    deepSleepQuality: opt(input?.deepSleepQuality, defaults.deepSleepQuality),
    deepSleepMinutes:
      typeof input?.deepSleepMinutes === "number"
        ? input.deepSleepMinutes
        : defaults.deepSleepMinutes,
    restingHeartRate: opt(input?.restingHeartRate, defaults.restingHeartRate),
    sleepScore: opt(input?.sleepScore, defaults.sleepScore),
    awakeDuration: opt(input?.awakeDuration, defaults.awakeDuration),
    sleepAverageHeartRate: opt(input?.sleepAverageHeartRate, defaults.sleepAverageHeartRate),
    steps: opt(input?.steps, defaults.steps),
    intensityMinutes: opt(input?.intensityMinutes, defaults.intensityMinutes),
  };
}

function normalizeStoredSleepTrends(
  input: Partial<HealthDomainSleepTrendsState> | undefined,
  defaults: HealthDomainSleepTrendsState,
): HealthDomainSleepTrendsState {
  return {
    bedTimes: normalizeNumberlessTrend(input?.bedTimes, defaults.bedTimes),
    wakeTimes: normalizeNumberlessTrend(input?.wakeTimes, defaults.wakeTimes),
    deepSleepMinutes: normalizeNumericTrend(input?.deepSleepMinutes, defaults.deepSleepMinutes),
    sleepScores: normalizeNumericTrend(input?.sleepScores, defaults.sleepScores),
    steps: normalizeNumericTrend(input?.steps, defaults.steps),
    intensityMinutes: normalizeNumericTrend(input?.intensityMinutes, defaults.intensityMinutes),
  };
}

function createDefaultStoredHealthDomainState(): HealthDomainStoredState {
  return {
    connection: {
      mode: null,
      status: "disconnected",
      label: null,
      lastSyncedAt: null,
      tokenJson: null,
      apiBaseUrl: null,
      relativeUid: null,
      lastError: null,
    },
    sleep: {
      latest: createEmptySleepLatestState(),
      insights: [],
      trends: {
        bedTimes: [],
        wakeTimes: [],
        deepSleepMinutes: [],
        sleepScores: [],
        steps: [],
        intensityMinutes: [],
      },
    },
  };
}

function toPublicHealthDomainState(
  stored: HealthDomainStoredState,
): HealthDomainState {
  return {
    connection: {
      mode: stored.connection.mode,
      status: stored.connection.status,
      label: stored.connection.label,
      lastSyncedAt: stored.connection.lastSyncedAt,
      lastError: normalizeHealthConnectionError(stored.connection.lastError),
    },
    sleep: stored.sleep,
  };
}

function normalizeHealthConnectionError(error: string | null): string | null {
  if (!error) {
    return null;
  }
  return error;
}

function normalizeNumberlessTrend(
  input: unknown,
  fallback: string[],
): string[] {
  return Array.isArray(input) ? input.filter(isNonEmptyString) : fallback;
}

function normalizeNumericTrend(input: unknown, fallback: number[]): number[] {
  return Array.isArray(input)
    ? input.filter((value): value is number => typeof value === "number")
    : fallback;
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
