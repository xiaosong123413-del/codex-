import type { RouteName } from "../../router.js";
import { showRunProgress, type RunProgressHandle } from "../../run-progress.js";
import {
  nextObservedLineProgressPercent,
  readRunLineProgress,
} from "../../run-progress-metrics.js";

type RunKind = "check" | "sync";
type RunStatus = "running" | "succeeded" | "failed" | "stopped";

interface RunLine {
  at: string;
  source: "stdout" | "stderr" | "system";
  text: string;
}

interface RunSnapshot {
  id: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  lines: RunLine[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface IntakePlanRow {
  file: string;
  suggestedLocation: string;
  action: string;
  reason: string;
}

interface IntakeScan {
  items: Array<{ kind: "clipping" | "flash" | "source" | "inbox"; channel?: string; title: string }>;
  plan: IntakePlanRow[];
}

const COPY: Record<RunKind, { title: string; eyebrow: string; copy: string; button: string }> = {
  check: {
    title: "\u7cfb\u7edf\u68c0\u67e5",
    eyebrow: "SYSTEM CHECK",
    copy: "\u626b\u63cf wiki \u7684\u65ad\u94fe\u3001\u5b64\u7acb\u9875\u3001\u7f3a\u6458\u8981\u3001\u91cd\u590d\u6982\u5ff5\u548c\u5f15\u7528\u7f3a\u5931\uff0c\u7ed3\u679c\u4f1a\u5199\u5165\u8fd0\u884c\u65e5\u5fd7\u3002",
    button: "\u5f00\u59cb\u7cfb\u7edf\u68c0\u67e5",
  },
  sync: {
    title: "\u540c\u6b65\u7f16\u8bd1",
    eyebrow: "SYNC + COMPILE",
    copy: "\u4ece\u5df2\u914d\u7f6e\u7684\u540c\u6b65\u6e90\u6587\u4ef6\u5939\u590d\u5236\u5185\u5bb9\uff0c\u5206\u6279\u7f16\u8bd1\u5e76\u91cd\u5efa wiki \u7ed3\u6784\u3002",
    button: "\u5f00\u59cb\u540c\u6b65\u7f16\u8bd1",
  },
};

const STARTING_PROGRESS_PERCENT = 3;
const ACTIVE_PROGRESS_PERCENT = 8;

export function renderRunPage(routeName: RouteName): HTMLElement {
  const kind: RunKind = routeName === "sync" ? "sync" : "check";
  const copy = COPY[kind];
  const root = document.createElement("section");
  root.className = "run-page";
  root.dataset.runKind = kind;
  root.innerHTML = `
    <div class="run-page__hero">
      <div>
        <div class="eyebrow">${copy.eyebrow}</div>
        <h1 class="run-page__title">${copy.title}</h1>
        <p class="run-page__copy">${copy.copy}</p>
      </div>
      <button type="button" class="btn btn-primary run-page__start" data-run-start>${copy.button}</button>
    </div>
    <div class="run-page__grid">
      <article class="run-card">
        <div class="run-card__label">\u5f53\u524d\u72b6\u6001</div>
        <div class="run-status" data-run-status>\u672a\u8fd0\u884c</div>
        <div class="run-meta" data-run-meta>\u70b9\u51fb\u4e0a\u65b9\u6309\u94ae\u540e\uff0c\u4efb\u52a1\u4f1a\u5728\u540e\u7aef\u8fd0\u884c\u3002</div>
      </article>
      <article class="run-card run-card--wide">
        <div class="run-card__label">\u8fd0\u884c\u65e5\u5fd7</div>
        <pre class="run-log" data-run-log>\u6682\u65e0\u8f93\u51fa</pre>
      </article>
    </div>
  `;
  bindRunPage(root, kind);
  return root;
}

function bindRunPage(root: HTMLElement, kind: RunKind): void {
  const startButton = root.querySelector<HTMLButtonElement>("[data-run-start]")!;
  const statusNode = root.querySelector<HTMLElement>("[data-run-status]")!;
  const metaNode = root.querySelector<HTMLElement>("[data-run-meta]")!;
  const logNode = root.querySelector<HTMLElement>("[data-run-log]")!;
  let eventSource: EventSource | null = null;

  startButton.addEventListener("click", async () => {
    const progress = showRunProgress({
      key: kind,
      title: readRunProgressTitle(kind),
      message: readRunPreparingMessage(kind),
      percent: 1,
    });
    startButton.disabled = true;
    statusNode.textContent = "\u542f\u52a8\u4e2d";
    metaNode.textContent = "\u6b63\u5728\u8bf7\u6c42\u540e\u7aef\u542f\u52a8\u4efb\u52a1...";
    logNode.textContent = "";
    eventSource?.close();
    eventSource = null;

    try {
      const syncDecision = kind === "sync" ? await confirmSyncPlan(root) : "confirm";
      if (syncDecision !== "confirm") {
        statusNode.textContent = syncDecision === "inbox" ? "inbox \u6709\u5f85\u5904\u7406\u539f\u6599" : "\u672a\u68c0\u6d4b\u5230\u65b0\u6e90\u6599";
        metaNode.textContent = syncDecision === "inbox"
          ? "\u8bf7\u5230\u5ba1\u67e5\u9875\u9009\u62e9\u4eb2\u81ea\u6307\u5bfc\u5f55\u5165\u6216\u4f18\u5148\u6279\u91cf\u5f55\u5165\u3002"
          : "\u5982\u679c\u8981\u6279\u91cf\u5f55\u5165\uff0c\u8bf7\u628a\u6587\u4ef6\u653e\u5230 raw/\u526a\u85cf \u6216 raw/\u95ea\u5ff5\u65e5\u8bb0\u3002";
        progress.complete(readRunSkippedProgressMessage(kind));
        startButton.disabled = false;
        return;
      }
      progress.update(readRunStartingMessage(kind), STARTING_PROGRESS_PERCENT);
      attachRunStream(await startRun(kind), progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusNode.textContent = "\u542f\u52a8\u5931\u8d25";
      metaNode.textContent = message;
      progress.fail(`\u542f\u52a8\u5931\u8d25\uff1a${message}`);
      startButton.disabled = false;
    }
  });

  function attachRunStream(run: RunSnapshot, progress: RunProgressHandle): void {
    statusNode.textContent = formatStatus(run.status);
    metaNode.textContent = `${formatKind(run.kind)} \u00b7 ${formatTime(run.startedAt)}`;
    let runningPercent = ACTIVE_PROGRESS_PERCENT;
    progress.update(readRunActiveProgressMessage(run.kind), runningPercent);
    eventSource = new EventSource(`/api/runs/${encodeURIComponent(run.id)}/events`);
    eventSource.addEventListener("line", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { line: RunLine };
      appendLogLine(logNode, payload.line);
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
      statusNode.textContent = formatStatus(payload.run.status);
      metaNode.textContent = payload.run.endedAt
        ? `${formatKind(payload.run.kind)} \u00b7 ${formatTime(payload.run.startedAt)} - ${formatTime(payload.run.endedAt)}`
        : `${formatKind(payload.run.kind)} \u00b7 ${formatTime(payload.run.startedAt)}`;
      if (payload.run.status !== "running") {
        settleRunProgress(progress, payload.run);
        startButton.disabled = false;
        eventSource?.close();
        eventSource = null;
      }
    });
    eventSource.onerror = () => {
      progress.fail("\u8fd0\u884c\u8fdb\u5ea6\u8fde\u63a5\u4e2d\u65ad");
      startButton.disabled = false;
      eventSource?.close();
      eventSource = null;
    };
  }
}

async function startRun(kind: RunKind): Promise<RunSnapshot> {
  const response = await fetch(`/api/runs/${kind}`, { method: "POST" });
  const payload = (await response.json()) as ApiResponse<RunSnapshot>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "run start failed");
  }
  return payload.data;
}

async function confirmSyncPlan(root: HTMLElement): Promise<"confirm" | "none" | "inbox"> {
  const scan = await loadIntakeScan();
  if (scan.items.length === 0) return "none";
  if (scan.plan.length === 0) return "inbox";
  return (await showIntakePlanDialog(root, scan.plan)) ? "confirm" : "none";
}

async function loadIntakeScan(): Promise<IntakeScan> {
  const response = await fetch("/api/intake/scan");
  const payload = (await response.json()) as ApiResponse<IntakeScan>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "intake scan failed");
  }
  return payload.data;
}

function showIntakePlanDialog(root: HTMLElement, plan: IntakePlanRow[]): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "intake-dialog";
    overlay.innerHTML = `
      <section class="intake-dialog__panel">
        <div class="intake-dialog__header">
          <div>
            <div class="eyebrow">SYNC COMPILE PLAN</div>
            <h2>\u540c\u6b65\u7f16\u8bd1\u65b9\u6848</h2>
          </div>
          <button type="button" class="btn btn-secondary btn-inline" data-intake-cancel>\u53d6\u6d88</button>
        </div>
        <div class="intake-dialog__table-wrap">
          <table class="intake-plan-table">
            <thead><tr><th>\u6587\u4ef6</th><th>\u5efa\u8bae\u653e\u54ea</th><th>\u600e\u4e48\u5904\u7406</th><th>\u4e3a\u4ec0\u4e48</th></tr></thead>
            <tbody>${plan.map(renderPlanRow).join("")}</tbody>
          </table>
        </div>
        <div class="intake-dialog__footer">
          <span>\u786e\u8ba4\u540e\u6267\u884c\uff1a\u590d\u5236\u6e90\u6587\u4ef6 \u2192 sources_full \u2192 \u5206\u6279 sources \u2192 compile \u2192 review</span>
          <button type="button" class="btn btn-primary" data-intake-confirm>\u786e\u8ba4\u5f00\u59cb\u540c\u6b65\u7f16\u8bd1</button>
        </div>
      </section>
    `;
    root.appendChild(overlay);
    bindIntakeDialog(overlay, resolve);
  });
}

function renderPlanRow(row: IntakePlanRow): string {
  return `
    <tr>
      <td>${escapeHtml(row.file)}</td>
      <td>${escapeHtml(row.suggestedLocation)}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.reason)}</td>
    </tr>
  `;
}

function bindIntakeDialog(overlay: HTMLElement, resolve: (value: boolean) => void): void {
  overlay.querySelector("[data-intake-cancel]")?.addEventListener("click", () => {
    overlay.remove();
    resolve(false);
  });
  overlay.querySelector("[data-intake-confirm]")?.addEventListener("click", () => {
    overlay.remove();
    resolve(true);
  });
}

function appendLogLine(logNode: HTMLElement, line: RunLine): void {
  if (logNode.textContent === "\u6682\u65e0\u8f93\u51fa") {
    logNode.textContent = "";
  }
  logNode.textContent += `[${formatTime(line.at)}] ${line.source}: ${line.text}\n`;
  logNode.scrollTop = logNode.scrollHeight;
}

function formatStatus(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    running: "\u8fd0\u884c\u4e2d",
    succeeded: "\u5df2\u5b8c\u6210",
    failed: "\u5931\u8d25",
    stopped: "\u5df2\u505c\u6b62",
  };
  return labels[status];
}

function formatKind(kind: RunKind): string {
  return kind === "sync" ? "\u540c\u6b65\u7f16\u8bd1" : "\u7cfb\u7edf\u68c0\u67e5";
}

function settleRunProgress(progress: RunProgressHandle, run: RunSnapshot): void {
  const message = `${formatKind(run.kind)}${formatStatus(run.status)}`;
  if (run.status === "succeeded") {
    progress.complete(message);
    return;
  }
  progress.fail(message);
}

function readRunPreparingMessage(kind: RunKind): string {
  return kind === "sync" ? "\u6b63\u5728\u68c0\u67e5\u540c\u6b65\u6e90..." : readRunStartingMessage(kind);
}

function readRunStartingMessage(kind: RunKind): string {
  return kind === "sync" ? "\u6b63\u5728\u542f\u52a8\u540c\u6b65\u7f16\u8bd1..." : "\u6b63\u5728\u542f\u52a8\u7cfb\u7edf\u68c0\u67e5...";
}

function readRunActiveProgressMessage(kind: RunKind): string {
  return kind === "sync" ? "\u540c\u6b65\u7f16\u8bd1\u8fd0\u884c\u4e2d..." : "\u7cfb\u7edf\u68c0\u67e5\u8fd0\u884c\u4e2d...";
}

function readRunProgressTitle(kind: RunKind): string {
  return kind === "sync" ? "\u540c\u6b65\u7f16\u8bd1\u8fdb\u5ea6" : "\u7cfb\u7edf\u68c0\u67e5\u8fdb\u5ea6";
}

function readRunSkippedProgressMessage(kind: RunKind): string {
  return kind === "sync" ? "\u672a\u542f\u52a8\u540c\u6b65\u7f16\u8bd1" : "\u672a\u542f\u52a8\u7cfb\u7edf\u68c0\u67e5";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return escaped[character] ?? character;
  });
}
