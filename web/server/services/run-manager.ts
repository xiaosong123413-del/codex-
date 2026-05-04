import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { reconcileDeepResearchItems } from "./deep-research.js";

export type RunKind = "check" | "sync";
type RunStatus = "running" | "succeeded" | "failed" | "stopped";
type RunLineSource = "stdout" | "stderr" | "system";

interface RunLine {
  at: string;
  source: RunLineSource;
  text: string;
}

export interface RunSnapshot {
  id: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  lines: RunLine[];
}

interface RunContext {
  sourceVaultRoot: string;
  runtimeRoot: string;
  projectRoot: string;
}

interface FinalCompileResult {
  status: "succeeded" | "failed";
  syncedMarkdownCount: number;
  syncedAssetCount: number;
  completedFilesCount: number;
  notSyncedCount?: number;
  notCompiledCount?: number;
  internalBatchCount: number;
  batchLimit: number;
  claimsUpdated: number;
  proceduresUpdated: number;
  wikiOutputDir: string;
  publishedAt?: string;
  error?: string;
}

interface RunCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

type RunEvent =
  | { type: "line"; runId: string; line: RunLine }
  | { type: "status"; runId: string; run: RunSnapshot };

export interface RunManager {
  start(kind: RunKind, context: RunContext): RunSnapshot;
  stop(id: string): void;
  getCurrent(): RunSnapshot | null;
  getRun(id: string): RunSnapshot | null;
  onEvent(id: string, listener: (event: RunEvent) => void): () => void;
  waitForRun(id: string): Promise<RunSnapshot>;
}

interface RunningRun {
  snapshot: RunSnapshot;
  context: RunContext;
  process: ChildProcessWithoutNullStreams | null;
  listeners: Set<(event: RunEvent) => void>;
  waiters: Array<(run: RunSnapshot) => void>;
}

interface RunManagerOptions {
  resolveCommand?: (kind: RunKind, context: RunContext) => RunCommand;
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 2000;

function pushSummaryLine(run: RunningRun, source: RunLineSource, text: string): void {
  const cleaned = stripAnsi(text).trimEnd();
  if (!cleaned) return;
  run.snapshot.lines.push({ at: new Date().toISOString(), source, text: cleaned });
}

export function createRunManager(options: RunManagerOptions = {}): RunManager {
  const runs = new Map<string, RunningRun>();
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  let currentId: string | null = null;

  function getRunning(id: string): RunningRun | null {
    return runs.get(id) ?? null;
  }

  function snapshot(run: RunningRun): RunSnapshot {
    return {
      ...run.snapshot,
      lines: [...run.snapshot.lines],
    };
  }

  function emit(run: RunningRun, event: RunEvent): void {
    for (const listener of run.listeners) {
      listener(event);
    }
  }

  function appendLine(run: RunningRun, source: RunLineSource, text: string): void {
    const cleaned = stripAnsi(text).trimEnd();
    if (!cleaned) return;
    const line = { at: new Date().toISOString(), source, text: cleaned };
    run.snapshot.lines.push(line);
    if (run.snapshot.lines.length > maxLines) {
      run.snapshot.lines.splice(0, run.snapshot.lines.length - maxLines);
    }
    emit(run, { type: "line", runId: run.snapshot.id, line });
  }

  function finish(run: RunningRun, status: RunStatus, exitCode?: number | null): void {
    if (run.snapshot.status !== "running") return;
    run.snapshot.status = status;
    run.snapshot.exitCode = exitCode;
    run.snapshot.endedAt = new Date().toISOString();
    if (currentId === run.snapshot.id) {
      currentId = null;
    }
    const finalSnapshot = snapshot(run);
    emit(run, { type: "status", runId: run.snapshot.id, run: finalSnapshot });
    const waiters = [...run.waiters];
    run.waiters.length = 0;
    for (const waiter of waiters) {
      waiter(finalSnapshot);
    }
  }

  return {
    start(kind, context) {
      const active = currentId ? getRunning(currentId) : null;
      if (active && active.snapshot.status === "running") {
        throw new Error("run already active");
      }

      const id = `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const run: RunningRun = {
        snapshot: {
          id,
          kind,
          status: "running",
          startedAt: new Date().toISOString(),
          lines: [],
        },
        context,
        process: null,
        listeners: new Set(),
        waiters: [],
      };
      runs.set(id, run);
      currentId = id;

      const command = (options.resolveCommand ?? resolveDefaultCommand)(kind, context);
      appendLine(run, "system", `starting ${kind}: ${command.command} ${command.args.join(" ")}`);

      const child = spawn(command.command, command.args, {
        cwd: command.cwd,
        env: command.env ?? process.env,
        windowsHide: true,
      });
      run.process = child;

      pipeLines(child.stdout, (line) => appendLine(run, "stdout", line));
      pipeLines(child.stderr, (line) => appendLine(run, "stderr", line));
      child.on("error", (error) => {
        appendLine(run, "stderr", error.message);
        finish(run, "failed", null);
      });
      child.on("close", async (code) => {
        if (kind === "sync") {
          await appendFinalCompileSummary(run);
        }
        if (run.snapshot.status === "running") {
          await reconcileDeepResearchItems(run.context.runtimeRoot, {
            ...snapshot(run),
            status: code === 0 ? "succeeded" : "failed",
            endedAt: new Date().toISOString(),
            exitCode: code,
          });
        }
        appendLine(run, "system", `process exited with code ${code ?? "null"}`);
        finish(run, code === 0 ? "succeeded" : "failed", code);
      });

      return snapshot(run);
    },
    stop(id) {
      const run = getRunning(id);
      if (!run || run.snapshot.status !== "running") return;
      appendLine(run, "system", "stopping run");
      run.process?.kill();
      finish(run, "stopped", null);
    },
    getCurrent() {
      if (currentId) {
        const current = getRunning(currentId);
        if (current) return snapshot(current);
      }
      const latest = [...runs.values()].at(-1);
      return latest ? snapshot(latest) : null;
    },
    getRun(id) {
      const run = getRunning(id);
      return run ? snapshot(run) : null;
    },
    onEvent(id, listener) {
      const run = getRunning(id);
      if (!run) return () => undefined;
      run.listeners.add(listener);
      return () => {
        run.listeners.delete(listener);
      };
    },
    waitForRun(id) {
      const run = getRunning(id);
      if (!run) {
        return Promise.reject(new Error("run not found"));
      }
      if (run.snapshot.status !== "running") {
        return Promise.resolve(snapshot(run));
      }
      return new Promise((resolve) => {
        run.waiters.push(resolve);
      });
    },
  };
}

async function appendFinalCompileSummary(run: RunningRun): Promise<void> {
  const result = await readFinalCompileResult(run.context.runtimeRoot);
  if (!result) return;

  pushSummaryLine(run, "system", `final result: ${result.status}`);
  pushSummaryLine(run, "system", buildStatusCountLine(result));
  pushSummaryLine(
    run,
    "system",
    `claims ${result.claimsUpdated}, procedures ${result.proceduresUpdated}`,
  );
  pushSummaryLine(
    run,
    "system",
    `markdown ${result.syncedMarkdownCount}, assets ${result.syncedAssetCount}, completed ${result.completedFilesCount}, batches ${result.internalBatchCount}`,
  );
  if (result.error) {
    pushSummaryLine(run, "stderr", result.error);
  }
}

function buildStatusCountLine(result: FinalCompileResult): string {
  const notCompiled = result.notCompiledCount
    ?? Math.max(0, result.syncedMarkdownCount - result.completedFilesCount);
  const notSynced = result.notSyncedCount ?? 0;
  return `status counts: synced ${result.syncedMarkdownCount}, compiled ${result.completedFilesCount}, not synced ${notSynced}, not compiled ${notCompiled}`;
}

async function readFinalCompileResult(runtimeRoot: string): Promise<FinalCompileResult | null> {
  try {
    const raw = await readFile(path.join(runtimeRoot, ".llmwiki", "final-compile-result.json"), "utf8");
    return JSON.parse(raw) as FinalCompileResult;
  } catch {
    return null;
  }
}

function resolveDefaultCommand(kind: RunKind, context: RunContext): RunCommand {
  if (kind === "sync") {
    return {
      command: process.execPath,
      args: [path.join(context.projectRoot, "scripts", "sync-compile.mjs")],
      cwd: context.projectRoot,
    };
  }
  return {
    command: process.execPath,
    args: [path.join(context.projectRoot, "dist", "cli.js"), "lint"],
    cwd: context.sourceVaultRoot,
  };
}

function pipeLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  });
  stream.on("end", () => {
    if (buffer) {
      onLine(buffer);
      buffer = "";
    }
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
