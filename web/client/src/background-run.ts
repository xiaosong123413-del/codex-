/**
 * Background run startup helpers for the desktop shell.
 *
 * The shell can launch check/sync runs without navigating to the dedicated
 * runs page. This module keeps that flow testable by isolating the intake
 * confirmation step and the run-start request from the rest of `main.ts`.
 */

import {
  loadIntakeScan,
  showIntakeDetectionDialog,
} from "./intake-sync.js";
import { showRunProgress, type RunProgressHandle } from "./run-progress.js";
import {
  nextObservedLineProgressPercent,
  normalizeRunningProgressPercent,
  readRunLineProgress,
} from "./run-progress-metrics.js";

type RunKind = "check" | "sync";
type RunStatus = "running" | "succeeded" | "failed" | "stopped";
type ToastTone = "info" | "error";

interface RunSnapshot {
  id: string;
  kind: RunKind;
  status: RunStatus;
}

interface RunLine {
  source?: string;
  text: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface BackgroundRunDependencies {
  confirmSync?: () => Promise<boolean>;
  eventSourceFactory?: (url: string) => EventSource;
  fetchImpl?: typeof fetch;
}

interface ConfirmSyncDependencies {
  loadScan?: typeof loadIntakeScan;
  showDialog?: typeof showIntakeDetectionDialog;
}

type ToastPresenter = (message: string, tone?: ToastTone) => void;

const STARTING_PROGRESS_PERCENT = 3;
const ACTIVE_PROGRESS_PERCENT = 8;

export async function startBackgroundRun(
  kind: "check" | "sync",
  root: HTMLElement,
  showToast: ToastPresenter,
  dependencies: BackgroundRunDependencies = {},
): Promise<void> {
  const progress = showRunProgress({
    key: kind,
    title: readRunProgressTitle(kind),
    message: readRunPreparingMessage(kind),
    percent: 1,
  });
  const confirmSync = dependencies.confirmSync ?? (() => confirmBackgroundSync(root, showToast));
  try {
    if (kind === "sync" && !(await confirmSync())) {
      progress.complete(readRunSkippedProgressMessage(kind));
      return;
    }
    progress.update(readRunStartingMessage(kind), STARTING_PROGRESS_PERCENT);
    showToast(readRunStartingMessage(kind));
    const run = await startRunRequest(kind, dependencies.fetchImpl ?? fetch);
    attachRunCompletionProgress(run, progress, dependencies.eventSourceFactory);
    showToast(readRunStartedMessage(kind));
  } catch (error) {
    const message = `启动失败：${error instanceof Error ? error.message : String(error)}`;
    progress.fail(message);
    showToast(message, "error");
  }
}

function attachRunCompletionProgress(
  run: RunSnapshot,
  progress: RunProgressHandle,
  eventSourceFactory: BackgroundRunDependencies["eventSourceFactory"],
): void {
  if (run.status !== "running") {
    settleRunProgress(progress, run);
    return;
  }
  let runningPercent = ACTIVE_PROGRESS_PERCENT;
  progress.update(readRunActiveProgressMessage(run.kind), runningPercent);
  const createEventSource = eventSourceFactory ?? ((url: string) => new EventSource(url));
  const eventSource = createEventSource(`/api/runs/${encodeURIComponent(run.id)}/events`);
  eventSource.addEventListener("line", (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { line?: RunLine };
    if (!payload.line) return;
    const lineProgress = readRunLineProgress(payload.line.text);
    if (lineProgress) {
      runningPercent = Math.max(runningPercent, lineProgress.percent);
      progress.update(lineProgress.message, runningPercent);
      return;
    }
    if (payload.line.source !== "system") {
      runningPercent = nextObservedLineProgressPercent(runningPercent);
      progress.update(readRunActiveProgressMessage(run.kind), runningPercent);
    }
  });
  eventSource.addEventListener("status", (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { run: RunSnapshot };
    if (payload.run.status === "running") {
      runningPercent = normalizeRunningProgressPercent(runningPercent);
      progress.update(readRunActiveProgressMessage(payload.run.kind), runningPercent);
      return;
    }
    settleRunProgress(progress, payload.run);
    eventSource.close();
  });
  eventSource.onerror = () => {
    progress.fail("\u8fd0\u884c\u8fdb\u5ea6\u8fde\u63a5\u4e2d\u65ad");
    eventSource.close();
  };
}

function settleRunProgress(progress: RunProgressHandle, run: RunSnapshot): void {
  const message = `${formatRunKind(run.kind)}${formatRunStatus(run.status)}`;
  if (run.status === "succeeded") {
    progress.complete(message);
    return;
  }
  progress.fail(message);
}

export async function confirmBackgroundSync(
  root: HTMLElement,
  showToast: ToastPresenter,
  dependencies: ConfirmSyncDependencies = {},
): Promise<boolean> {
  const loadScan = dependencies.loadScan ?? loadIntakeScan;
  const showDialog = dependencies.showDialog ?? showIntakeDetectionDialog;
  try {
    const scan = await loadScan();
    if (scan.items.length === 0) {
      showToast("未检测到新源料");
      return false;
    }
    return await showDialog(root, scan);
  } catch (error) {
    showToast(`新源料检测失败：${error instanceof Error ? error.message : String(error)}`, "error");
    return false;
  }
}

async function startRunRequest(kind: RunKind, fetchImpl: typeof fetch): Promise<RunSnapshot> {
  const response = await fetchImpl(`/api/runs/${kind}`, { method: "POST" });
  const payload = (await response.json()) as ApiResponse<RunSnapshot>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "run start failed");
  }
  return payload.data;
}

function readRunStartingMessage(kind: RunKind): string {
  return kind === "sync" ? "正在启动同步编译..." : "正在启动系统检查...";
}

function readRunPreparingMessage(kind: RunKind): string {
  return kind === "sync" ? "正在检查同步源..." : readRunStartingMessage(kind);
}

function readRunStartedMessage(kind: RunKind): string {
  return kind === "sync"
    ? "同步编译已在后台运行，结果会进入运行日志和审查。"
    : "系统检查已在后台运行，结果会进入运行日志和审查。";
}

function readRunProgressTitle(kind: RunKind): string {
  return kind === "sync" ? "同步编译进度" : "系统检查进度";
}

function readRunSkippedProgressMessage(kind: RunKind): string {
  return kind === "sync" ? "未启动同步编译" : "未启动系统检查";
}

function readRunActiveProgressMessage(kind: RunKind): string {
  return kind === "sync" ? "\u540c\u6b65\u7f16\u8bd1\u8fd0\u884c\u4e2d..." : "\u7cfb\u7edf\u68c0\u67e5\u8fd0\u884c\u4e2d...";
}

function formatRunKind(kind: RunKind): string {
  return kind === "sync" ? "\u540c\u6b65\u7f16\u8bd1" : "\u7cfb\u7edf\u68c0\u67e5";
}

function formatRunStatus(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    running: "\u8fd0\u884c\u4e2d",
    succeeded: "\u5df2\u5b8c\u6210",
    failed: "\u5931\u8d25",
    stopped: "\u5df2\u505c\u6b62",
  };
  return labels[status];
}
