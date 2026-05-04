import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import type { RunKind, RunManager } from "../services/run-manager.js";
import { refreshReviewWebSearchSuggestions } from "../services/review-web-search.js";

export function handleRunCurrent(manager: RunManager) {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: manager.getCurrent() });
  };
}

export function handleRunStart(cfg: ServerConfig, manager: RunManager, kind: RunKind) {
  return (_req: Request, res: Response) => {
    try {
      const currentRun = manager.getCurrent();
      if (currentRun?.status === "running") {
        if (currentRun.kind === kind) {
          res.status(202).json({ success: true, data: currentRun });
          return;
        }
        res.status(409).json({
          success: false,
          error: `${formatRunKind(currentRun.kind)}已在后台运行，请等待结束后再启动${formatRunKind(kind)}。`,
        });
        return;
      }

      const run = manager.start(kind, {
        sourceVaultRoot: cfg.sourceVaultRoot,
        runtimeRoot: cfg.runtimeRoot,
        projectRoot: cfg.projectRoot,
      });
      if (kind === "check") {
        void manager.waitForRun(run.id)
          .then(async (completedRun) => {
            await refreshReviewWebSearchSuggestions({
              sourceVaultRoot: cfg.sourceVaultRoot,
              runtimeRoot: cfg.runtimeRoot,
              projectRoot: cfg.projectRoot,
              currentRun: completedRun,
            });
          })
          .catch(() => undefined);
      }
      res.status(202).json({ success: true, data: run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(message.includes("already active") ? 409 : 500).json({
        success: false,
        error: message,
      });
    }
  };
}

function formatRunKind(kind: RunKind): string {
  return kind === "sync" ? "同步编译" : "系统检查";
}

export function handleRunEvents(manager: RunManager) {
  return (req: Request, res: Response) => {
    const id = req.params.id;
    const run = manager.getRun(id);
    if (!run) {
      res.status(404).json({ success: false, error: "run not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    writeSse(res, "status", { run });
    for (const line of run.lines) {
      writeSse(res, "line", { line });
    }

    const unsubscribe = manager.onEvent(id, (event) => {
      if (event.type === "line") {
        writeSse(res, "line", { line: event.line });
      } else {
        writeSse(res, "status", { run: event.run });
      }
    });

    req.on("close", () => {
      unsubscribe();
    });
  };
}

export function handleRunStop(manager: RunManager) {
  return (req: Request, res: Response) => {
    const id = req.params.id;
    const run = manager.getRun(id);
    if (!run) {
      res.status(404).json({ success: false, error: "run not found" });
      return;
    }

    manager.stop(id);
    res.json({ success: true, data: manager.getRun(id) });
  };
}

function writeSse(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
