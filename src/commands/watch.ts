/**
 * Commander action for `llmwiki watch`.
 *
 * Monitors sources/ for file changes via chokidar and triggers incremental
 * recompilation automatically. Uses a debounce to batch rapid changes into
 * a single compile pass. Respects the .llmwiki/lock file — queues changes
 * if a compile is already running.
 */

import { watch as chokidarWatch } from "chokidar";
import { existsSync } from "fs";
import path from "path";
import { compile } from "../compiler/index.js";
import { SOURCES_DIR } from "../utils/constants.js";
import * as output from "../utils/output.js";

const DEBOUNCE_MS = 500;

/** Check that the sources/ directory exists, returning its resolved path or null. */
function validateSourcesPath(): string | null {
  const sourcesPath = path.resolve(SOURCES_DIR);
  if (!existsSync(sourcesPath)) {
    output.status(
      "!",
      output.warn('No sources/ directory found. Run `llmwiki ingest <url>` first.'),
    );
    return null;
  }
  return sourcesPath;
}

/** Print the watch-mode banner with the monitored path. */
function printWatchBanner(sourcesPath: string): void {
  output.header("llmwiki watch");
  output.status("👁", output.info(`Watching ${sourcesPath} for changes...`));
  output.status("i", output.dim("Press Ctrl+C to stop.\n"));
}

/** Run a single compile pass, swallowing errors so the watcher stays alive. */
async function executeCompileSafe(): Promise<void> {
  try {
    await compile(process.cwd());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.status("!", output.error(`Compile failed: ${msg}`));
  }
}

/** Create the debounced compile scheduler with re-compile-on-overlap logic. */
function createCompileScheduler(): {
  triggerCompile: () => Promise<void>;
  scheduleCompile: (eventPath: string, event: string) => void;
} {
  let compiling = false;
  let pendingRecompile = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerCompile = async () => {
    if (compiling) {
      pendingRecompile = true;
      return;
    }

    compiling = true;
    await executeCompileSafe();
    compiling = false;

    if (pendingRecompile) {
      pendingRecompile = false;
      await triggerCompile();
    }
  };

  const scheduleCompile = (eventPath: string, event: string) => {
    output.status("~", output.dim(`${event}: ${path.basename(eventPath)}`));
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(triggerCompile, DEBOUNCE_MS);
  };

  return { triggerCompile, scheduleCompile };
}

/** Attach chokidar file watchers for add/change/unlink events. */
function startFileWatcher(
  sourcesPath: string,
  scheduleCompile: (eventPath: string, event: string) => void,
): void {
  const watcher = chokidarWatch(sourcesPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  });

  watcher
    .on("add", (p) => scheduleCompile(p, "added"))
    .on("change", (p) => scheduleCompile(p, "changed"))
    .on("unlink", (p) => scheduleCompile(p, "deleted"));
}

/**
 * Start watching sources/ for changes and auto-recompile.
 * Runs until the process is killed (Ctrl+C).
 */
export default async function watchCommand(): Promise<void> {
  const sourcesPath = validateSourcesPath();
  if (!sourcesPath) return;

  printWatchBanner(sourcesPath);
  const { scheduleCompile } = createCompileScheduler();
  startFileWatcher(sourcesPath, scheduleCompile);

  // Keep process alive
  await new Promise<void>(() => {});
}
